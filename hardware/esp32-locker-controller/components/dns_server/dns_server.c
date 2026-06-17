/*
 * SPDX-FileCopyrightText: 2021-2023 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Unlicense OR CC0-1.0
 */

#include <sys/param.h>
#include <inttypes.h>

#include "esp_log.h"
#include "esp_system.h"
#include "esp_check.h"
#include "esp_netif.h"

#include "lwip/err.h"
#include "lwip/ip_addr.h"
#include "lwip/sockets.h"
#include "lwip/sys.h"
#include "lwip/netdb.h"
#include "dns_server.h"

#define DNS_PORT (53)
#define DNS_MAX_LEN (256)

#define OPCODE_MASK (0x7800)
#define QR_FLAG (1 << 7)
#define QD_TYPE_A (0x0001)
#define ANS_TTL_SEC (300)

static const char *TAG = "dns_redirect_server";

typedef struct __attribute__((__packed__))
{
    uint16_t id;
    uint16_t flags;
    uint16_t qd_count;
    uint16_t an_count;
    uint16_t ns_count;
    uint16_t ar_count;
} dns_header_t;

typedef struct {
    uint16_t type;
    uint16_t class;
} dns_question_t;

typedef struct __attribute__((__packed__))
{
    uint16_t ptr_offset;
    uint16_t type;
    uint16_t class;
    uint32_t ttl;
    uint16_t addr_len;
    uint32_t ip_addr;
} dns_answer_t;

struct dns_server_handle {
    bool started;
    bool captive_all;
    TaskHandle_t task;
    int num_of_entries;
    const char *fallback_if_key;
    esp_ip4_addr_t fallback_ip;
    dns_entry_pair_t entry[];
};

static char *parse_dns_name(char *raw_name, char *parsed_name, size_t parsed_name_max_len)
{
    char *label = raw_name;
    char *name_itr = parsed_name;
    int name_len = 0;

    do {
        int sub_name_len = *label;
        name_len += (sub_name_len + 1);
        if (name_len > parsed_name_max_len) {
            return NULL;
        }

        memcpy(name_itr, label + 1, sub_name_len);
        name_itr[sub_name_len] = '.';
        name_itr += (sub_name_len + 1);
        label += sub_name_len + 1;
    } while (*label != 0);

    parsed_name[name_len - 1] = '\0';
    return label + 1;
}

static bool resolve_fallback_dns_server(dns_server_handle_t handle, ip4_addr_t *dns_server_addr)
{
    if (handle == NULL || dns_server_addr == NULL) {
        return false;
    }

    if (handle->fallback_if_key != NULL) {
        esp_netif_t *netif = esp_netif_get_handle_from_ifkey(handle->fallback_if_key);
        if (netif != NULL) {
            esp_netif_dns_info_t dns = { 0 };
            if (esp_netif_get_dns_info(netif, ESP_NETIF_DNS_MAIN, &dns) == ESP_OK && dns.ip.u_addr.ip4.addr != 0) {
                dns_server_addr->addr = dns.ip.u_addr.ip4.addr;
                return true;
            }
            if (esp_netif_get_dns_info(netif, ESP_NETIF_DNS_BACKUP, &dns) == ESP_OK && dns.ip.u_addr.ip4.addr != 0) {
                dns_server_addr->addr = dns.ip.u_addr.ip4.addr;
                return true;
            }

            esp_netif_ip_info_t ip_info = { 0 };
            if (esp_netif_get_ip_info(netif, &ip_info) == ESP_OK && ip_info.gw.addr != 0) {
                dns_server_addr->addr = ip_info.gw.addr;
                return true;
            }
        }
    }

    if (handle->fallback_ip.addr != IPADDR_ANY) {
        dns_server_addr->addr = handle->fallback_ip.addr;
        return true;
    }

    return false;
}

static int parse_dns_request(char *req, size_t req_len, char *dns_reply, size_t dns_reply_max_len, dns_server_handle_t h)
{
    if (req_len > dns_reply_max_len) {
        return -1;
    }

    memset(dns_reply, 0, dns_reply_max_len);
    memcpy(dns_reply, req, req_len);

    dns_header_t *header = (dns_header_t *)dns_reply;
    if ((header->flags & OPCODE_MASK) != 0) {
        return 0;
    }

    header->flags |= QR_FLAG;

    uint16_t qd_count = ntohs(header->qd_count);
    int max_reply_len = qd_count * sizeof(dns_answer_t) + req_len;
    if (max_reply_len > dns_reply_max_len) {
        return -1;
    }

    char *cur_ans_ptr = dns_reply + req_len;
    char *cur_qd_ptr = dns_reply + sizeof(dns_header_t);
    char name[128];
    int answer_count = 0;

    for (int qd_i = 0; qd_i < qd_count; qd_i++) {
        char *name_end_ptr = parse_dns_name(cur_qd_ptr, name, sizeof(name));
        if (name_end_ptr == NULL) {
            return -1;
        }

        dns_question_t *question = (dns_question_t *)(name_end_ptr);
        uint16_t qd_type = ntohs(question->type);
        uint16_t qd_class = ntohs(question->class);

        if (qd_type == QD_TYPE_A) {
            esp_ip4_addr_t ip = { .addr = IPADDR_ANY };
            if (h->captive_all && h->num_of_entries > 0) {
                if (h->entry[0].if_key) {
                    esp_netif_ip_info_t ip_info;
                    esp_netif_get_ip_info(esp_netif_get_handle_from_ifkey(h->entry[0].if_key), &ip_info);
                    ip.addr = ip_info.ip.addr;
                } else if (h->entry[0].ip.addr != IPADDR_ANY) {
                    ip.addr = h->entry[0].ip.addr;
                }
            } else {
                for (int i = 0; i < h->num_of_entries; ++i) {
                    if (strcmp(h->entry[i].name, "*") == 0 || strcmp(h->entry[i].name, name) == 0) {
                        if (h->entry[i].if_key) {
                            esp_netif_ip_info_t ip_info;
                            esp_netif_get_ip_info(esp_netif_get_handle_from_ifkey(h->entry[i].if_key), &ip_info);
                            ip.addr = ip_info.ip.addr;
                            break;
                        } else if (h->entry[i].ip.addr != IPADDR_ANY) {
                            ip.addr = h->entry[i].ip.addr;
                            break;
                        }
                    }
                }
            }

            if (ip.addr == IPADDR_ANY) {
                continue;
            }

            dns_answer_t *answer = (dns_answer_t *)cur_ans_ptr;
            answer->ptr_offset = htons(0xC000 | (cur_qd_ptr - dns_reply));
            answer->type = htons(qd_type);
            answer->class = htons(qd_class);
            answer->ttl = htonl(ANS_TTL_SEC);
            answer->addr_len = htons(sizeof(ip.addr));
            answer->ip_addr = ip.addr;
            cur_ans_ptr += sizeof(dns_answer_t);
            answer_count++;
        }

        cur_qd_ptr = (char *)(question + 1);
    }

    header->an_count = htons(answer_count);
    if (answer_count == 0) {
        return 0;
    }

    return (int)(cur_ans_ptr - dns_reply);
}

static int forward_dns_request(int server_sock, const char *request, int request_len, struct sockaddr_storage *source_addr, socklen_t source_len, dns_server_handle_t handle)
{
    ip4_addr_t upstream_dns = { 0 };
    if (!resolve_fallback_dns_server(handle, &upstream_dns) || upstream_dns.addr == 0) {
        return 0;
    }

    struct sockaddr_in upstream_addr = { 0 };
    upstream_addr.sin_family = AF_INET;
    upstream_addr.sin_port = htons(DNS_PORT);
    upstream_addr.sin_addr.s_addr = upstream_dns.addr;

    int upstream_sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (upstream_sock < 0) {
        return 0;
    }

    struct timeval timeout = {
        .tv_sec = 1,
        .tv_usec = 0
    };
    setsockopt(upstream_sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

    int err = sendto(upstream_sock, request, request_len, 0, (struct sockaddr *)&upstream_addr, sizeof(upstream_addr));
    if (err < 0) {
        close(upstream_sock);
        return 0;
    }

    char upstream_reply[DNS_MAX_LEN];
    struct sockaddr_storage reply_addr = { 0 };
    socklen_t reply_len = sizeof(reply_addr);
    int len = recvfrom(upstream_sock, upstream_reply, sizeof(upstream_reply), 0, (struct sockaddr *)&reply_addr, &reply_len);
    close(upstream_sock);
    if (len < 0) {
        return 0;
    }

    sendto(server_sock, upstream_reply, len, 0, (struct sockaddr *)source_addr, source_len);
    return len;
}

static void dns_server_task(void *pvParameters)
{
    char rx_buffer[128];
    char addr_str[128];
    dns_server_handle_t handle = pvParameters;

    while (handle->started) {
        struct sockaddr_in dest_addr = { 0 };
        dest_addr.sin_addr.s_addr = htonl(INADDR_ANY);
        dest_addr.sin_family = AF_INET;
        dest_addr.sin_port = htons(DNS_PORT);

        int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
        if (sock < 0) {
            ESP_LOGE(TAG, "Unable to create socket: errno %d", errno);
            break;
        }

        int err = bind(sock, (struct sockaddr *)&dest_addr, sizeof(dest_addr));
        if (err < 0) {
            ESP_LOGE(TAG, "Socket unable to bind: errno %d", errno);
        }

        while (handle->started) {
            struct sockaddr_in6 source_addr;
            socklen_t socklen = sizeof(source_addr);
            int len = recvfrom(sock, rx_buffer, sizeof(rx_buffer) - 1, 0, (struct sockaddr *)&source_addr, &socklen);

            if (len < 0) {
                ESP_LOGE(TAG, "recvfrom failed: errno %d", errno);
                close(sock);
                break;
            }

            if (source_addr.sin6_family == PF_INET) {
                inet_ntoa_r(((struct sockaddr_in *)&source_addr)->sin_addr.s_addr, addr_str, sizeof(addr_str) - 1);
            } else {
                inet6_ntoa_r(source_addr.sin6_addr, addr_str, sizeof(addr_str) - 1);
            }

            rx_buffer[len] = 0;

            char reply[DNS_MAX_LEN];
            int reply_len = parse_dns_request(rx_buffer, len, reply, DNS_MAX_LEN, handle);
            if (reply_len > 0) {
                err = sendto(sock, reply, reply_len, 0, (struct sockaddr *)&source_addr, sizeof(source_addr));
                if (err < 0) {
                    ESP_LOGE(TAG, "Error occurred during sending: errno %d", errno);
                    break;
                }
            } else if (reply_len == 0) {
                forward_dns_request(sock, rx_buffer, len, (struct sockaddr_storage *)&source_addr, sizeof(source_addr), handle);
            }
        }

        shutdown(sock, 0);
        close(sock);
    }

    vTaskDelete(NULL);
}

dns_server_handle_t start_dns_server(dns_server_config_t *config)
{
    dns_server_handle_t handle = calloc(1, sizeof(struct dns_server_handle) + config->num_of_entries * sizeof(dns_entry_pair_t));
    ESP_RETURN_ON_FALSE(handle, NULL, TAG, "Failed to allocate dns server handle");

    handle->started = true;
    handle->captive_all = true;
    handle->num_of_entries = config->num_of_entries;
    handle->fallback_if_key = config->fallback_if_key;
    handle->fallback_ip = config->fallback_ip;
    memcpy(handle->entry, config->item, config->num_of_entries * sizeof(dns_entry_pair_t));

    xTaskCreate(dns_server_task, "dns_server", 4096, handle, 5, &handle->task);
    return handle;
}

void stop_dns_server(dns_server_handle_t handle)
{
    if (handle) {
        handle->started = false;
        vTaskDelete(handle->task);
        free(handle);
    }
}

void dns_server_set_captive_all(dns_server_handle_t handle, bool enabled)
{
    if (handle == NULL) {
        return;
    }

    handle->captive_all = enabled;
}
