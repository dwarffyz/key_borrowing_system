#if defined(__INTELLISENSE__)
#include "intellisense_stubs/esp_idf_stubs.h"
#else
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <ctype.h>
#include <stdarg.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_rom_sys.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_http_server.h"
#include "lwip/inet.h"
#include "lwip/ip_addr.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "dns_server.h"
#endif

// ================= PIN DEFINITIONS =================
#define SR_DATA   23   // 74HC595 DS
#define SR_CLOCK  5    // 74HC595 SH_CP
#define SR_LATCH  18   // 74HC595 ST_CP

#define BTN_DATA  33   // 74HC165 Q7
#define BTN_CLOCK 32   // 74HC165 CP
#define BTN_LOAD  25   // 74HC165 PL#

// ================= WIFI SETTINGS ===================
#define WIFI_SSID      "LockerSystem"
#define WIFI_PASSWORD  "12345678"
#define WIFI_CHANNEL   1
#define MAX_STA_CONN   4
#define WIFI_STA_NAMESPACE        "wifi_sta"
#define WIFI_STA_SSID_MAX_LEN     33
#define WIFI_STA_PASSWORD_MAX_LEN 65
#define WIFI_STA_IP_MAX_LEN       16
#define DHCPS_OFFER_DNS           0x02

// ============== SYSTEM SIZE ========================
#define NUM_INPUT_BYTES    4
#define NUM_OUTPUT_BYTES   4
#define NUM_LOCKS          (NUM_OUTPUT_BYTES * 8)

#define LOCK_PULSE_MS      3000
#define LOOP_DELAY_MS      20
#define SERIAL_UART_NUM    UART_NUM_0
#define SERIAL_RX_BUFFER   1024
#define SERIAL_CMD_MAX_LEN 256
#define PORTAL_URL_MAX_LEN 160
#define DEBUG_IO_LOG       0

static const char *TAG = "locker_portal";

// ============== BUFFERS / STATE ====================
static uint8_t input_bytes[NUM_INPUT_BYTES];
static uint8_t prev_input_bytes[NUM_INPUT_BYTES];
static uint8_t output_bytes[NUM_OUTPUT_BYTES];

static TickType_t lock_active_until[NUM_LOCKS];
static SemaphoreHandle_t g_lock_mutex = NULL;
static httpd_handle_t g_httpd = NULL;
static dns_server_handle_t g_dns_server = NULL;
static esp_netif_t *g_ap_netif = NULL;
static esp_netif_t *g_sta_netif = NULL;
static const char *DEFAULT_AP_IP = "192.168.4.1";
static char serial_command_buffer[SERIAL_CMD_MAX_LEN];
static size_t serial_command_length = 0;
static char portal_target_url[PORTAL_URL_MAX_LEN] = "";
static char sta_wifi_ssid[WIFI_STA_SSID_MAX_LEN] = "";
static char sta_wifi_password[WIFI_STA_PASSWORD_MAX_LEN] = "";
static char sta_wifi_ip[WIFI_STA_IP_MAX_LEN] = "";
static bool sta_wifi_connected = false;
static bool sta_wifi_connecting = false;
static bool nat_passthrough_active = false;
static bool captive_dns_gate_active = true;
static bool portal_redirect_mode = false;
static bool wifi_started = false;

static esp_err_t redirect_to_root_handler(httpd_req_t *req);

// ==================================================
// 74HC595 WRITE
// ==================================================
static void shift_out_byte(uint8_t data)
{
    for (int i = 7; i >= 0; i--) {
        gpio_set_level(SR_CLOCK, 0);
        gpio_set_level(SR_DATA, (data >> i) & 1);
        esp_rom_delay_us(1);
        gpio_set_level(SR_CLOCK, 1);
        esp_rom_delay_us(1);
    }
    gpio_set_level(SR_CLOCK, 0);
}

static void write_595_chain(uint8_t *data, int num_bytes)
{
    gpio_set_level(SR_LATCH, 0);

    for (int i = num_bytes - 1; i >= 0; i--) {
        shift_out_byte(data[i]);
    }

    gpio_set_level(SR_LATCH, 1);
    esp_rom_delay_us(1);
    gpio_set_level(SR_LATCH, 0);
}

// ==================================================
// 74HC165 READ
// ==================================================
static void read_165_chain(uint8_t *data, int num_bytes)
{
    gpio_set_level(BTN_LOAD, 0);
    esp_rom_delay_us(5);
    gpio_set_level(BTN_LOAD, 1);
    esp_rom_delay_us(5);

    for (int byte = 0; byte < num_bytes; byte++) {
        uint8_t value = 0;

        for (int i = 0; i < 8; i++) {
            value <<= 1;
            value |= gpio_get_level(BTN_DATA);

            gpio_set_level(BTN_CLOCK, 1);
            esp_rom_delay_us(2);
            gpio_set_level(BTN_CLOCK, 0);
            esp_rom_delay_us(2);
        }

        data[byte] = value;
    }
}

// ==================================================
// HELPERS
// ==================================================
static inline bool valid_lock_index(int lock_index)
{
    return (lock_index >= 0 && lock_index < NUM_LOCKS);
}

static inline bool get_input_bit(const uint8_t *buf, int lock_index)
{
    int byte_index = lock_index / 8;
    int bit_in_byte = lock_index % 8;
    return ((buf[byte_index] >> bit_in_byte) & 0x01) != 0;
}

static inline void set_output_bit(uint8_t *buf, int lock_index, bool state)
{
    int byte_index = lock_index / 8;
    int bit_in_byte = lock_index % 8;

    if (state) {
        buf[byte_index] |= (1U << bit_in_byte);
    } else {
        buf[byte_index] &= ~(1U << bit_in_byte);
    }
}

static void trim_in_place(char *text)
{
    if (text == NULL) {
        return;
    }

    size_t len = strlen(text);
    while (len > 0 && isspace((unsigned char)text[len - 1])) {
        text[--len] = '\0';
    }

    char *start = text;
    while (*start && isspace((unsigned char)*start)) {
        start++;
    }

    if (start != text) {
        memmove(text, start, strlen(start) + 1);
    }
}

static bool set_portal_target_url(const char *value)
{
    char candidate[PORTAL_URL_MAX_LEN];
    snprintf(candidate, sizeof(candidate), "%s", value ? value : "");
    trim_in_place(candidate);

    if (candidate[0] == '\0') {
        portal_target_url[0] = '\0';
        ESP_LOGI(TAG, "Portal target URL cleared");
        return true;
    }

    if (strncmp(candidate, "http://", 7) != 0 && strncmp(candidate, "https://", 8) != 0) {
        return false;
    }

    snprintf(portal_target_url, sizeof(portal_target_url), "%s", candidate);
    ESP_LOGI(TAG, "Portal target URL set to %s", portal_target_url);
    return true;
}

static bool set_portal_redirect_mode(const char *value)
{
    char candidate[24];
    snprintf(candidate, sizeof(candidate), "%s", value ? value : "");
    trim_in_place(candidate);
    for (size_t i = 0; candidate[i] != '\0'; i++) {
        candidate[i] = (char)tolower((unsigned char)candidate[i]);
    }

    if (strcmp(candidate, "redirect") == 0 || strcmp(candidate, "direct") == 0 || strcmp(candidate, "pure_fast") == 0) {
        portal_redirect_mode = true;
        ESP_LOGI(TAG, "Portal mode set to redirect");
        return true;
    }

    if (strcmp(candidate, "buttons") == 0 || strcmp(candidate, "button") == 0 || strcmp(candidate, "hybrid") == 0) {
        portal_redirect_mode = false;
        ESP_LOGI(TAG, "Portal mode set to buttons");
        return true;
    }

    return false;
}

static bool has_sta_wifi_credentials(void)
{
    return sta_wifi_ssid[0] != '\0';
}

static void ensure_captive_dns_server_running(void)
{
    if (g_dns_server != NULL) {
        return;
    }

    dns_server_config_t dns_config = {
        .num_of_entries = 10,
        .item = {
            { .name = "connectivitycheck.gstatic.com", .if_key = "WIFI_AP_DEF" },
            { .name = "clients3.google.com", .if_key = "WIFI_AP_DEF" },
            { .name = "connectivitycheck.android.com", .if_key = "WIFI_AP_DEF" },
            { .name = "captive.apple.com", .if_key = "WIFI_AP_DEF" },
            { .name = "www.apple.com", .if_key = "WIFI_AP_DEF" },
            { .name = "www.msftconnecttest.com", .if_key = "WIFI_AP_DEF" },
            { .name = "msftconnecttest.com", .if_key = "WIFI_AP_DEF" },
            { .name = "dns.msftncsi.com", .if_key = "WIFI_AP_DEF" },
            { .name = "www.msftncsi.com", .if_key = "WIFI_AP_DEF" },
            { .name = "detectportal.firefox.com", .if_key = "WIFI_AP_DEF" }
        },
        .fallback_if_key = "WIFI_STA_DEF",
        .fallback_ip = { .addr = 0 }
    };
    g_dns_server = start_dns_server(&dns_config);
    dns_server_set_captive_all(g_dns_server, captive_dns_gate_active);
    ESP_LOGI(TAG, "Captive DNS server enabled with upstream DNS forwarding");
}

static void stop_captive_dns_server(void)
{
    if (g_dns_server == NULL) {
        return;
    }

    stop_dns_server(g_dns_server);
    g_dns_server = NULL;
    ESP_LOGI(TAG, "Captive DNS server disabled");
}

static void set_captive_dns_gate(bool enabled)
{
    captive_dns_gate_active = enabled;
    if (g_dns_server != NULL) {
        dns_server_set_captive_all(g_dns_server, enabled);
    }
    ESP_LOGI(TAG, "Captive DNS gate %s", enabled ? "enabled" : "disabled");
}

static bool configure_ap_dns_server(uint32_t dns_ipv4_addr, const char *label)
{
    if (g_ap_netif == NULL || dns_ipv4_addr == 0) {
        return false;
    }

    esp_netif_dns_info_t dns = { 0 };
    dns.ip.type = ESP_IPADDR_TYPE_V4;
    dns.ip.u_addr.ip4.addr = dns_ipv4_addr;

    uint8_t dhcps_offer_option = DHCPS_OFFER_DNS;
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_netif_dhcps_stop(g_ap_netif));
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_netif_dhcps_option(
        g_ap_netif,
        ESP_NETIF_OP_SET,
        ESP_NETIF_DOMAIN_NAME_SERVER,
        &dhcps_offer_option,
        sizeof(dhcps_offer_option)
    ));
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_netif_set_dns_info(g_ap_netif, ESP_NETIF_DNS_MAIN, &dns));
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_netif_dhcps_start(g_ap_netif));

    char dns_ip[16];
    inet_ntoa_r(dns_ipv4_addr, dns_ip, sizeof(dns_ip));
    ESP_LOGI(TAG, "Hotspot DNS set to %s (%s)", dns_ip, label ? label : "unspecified");
    return true;
}

static bool set_ap_dns_to_local_captive(void)
{
    if (g_ap_netif == NULL) {
        return false;
    }

    esp_netif_ip_info_t ap_ip_info = { 0 };
    esp_err_t err = esp_netif_get_ip_info(g_ap_netif, &ap_ip_info);
    if (err != ESP_OK || ap_ip_info.ip.addr == 0) {
        ESP_LOGW(TAG, "Unable to read hotspot IP for captive DNS restore (err=%s)", esp_err_to_name(err));
        return false;
    }

    return configure_ap_dns_server(ap_ip_info.ip.addr, "local captive portal");
}

static esp_err_t load_sta_wifi_credentials_from_nvs(void)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(WIFI_STA_NAMESPACE, NVS_READONLY, &nvs_handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }

    size_t ssid_len = sizeof(sta_wifi_ssid);
    err = nvs_get_str(nvs_handle, "ssid", sta_wifi_ssid, &ssid_len);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        sta_wifi_ssid[0] = '\0';
        sta_wifi_password[0] = '\0';
        nvs_close(nvs_handle);
        return ESP_OK;
    }
    if (err != ESP_OK) {
        nvs_close(nvs_handle);
        return err;
    }

    size_t password_len = sizeof(sta_wifi_password);
    err = nvs_get_str(nvs_handle, "password", sta_wifi_password, &password_len);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        sta_wifi_password[0] = '\0';
        err = ESP_OK;
    }

    nvs_close(nvs_handle);
    return err;
}

static esp_err_t save_sta_wifi_credentials_to_nvs(void)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(WIFI_STA_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_set_str(nvs_handle, "ssid", sta_wifi_ssid);
    if (err == ESP_OK) {
        err = nvs_set_str(nvs_handle, "password", sta_wifi_password);
    }
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }

    nvs_close(nvs_handle);
    return err;
}

static esp_err_t clear_sta_wifi_credentials_in_nvs(void)
{
    nvs_handle_t nvs_handle;
    esp_err_t err = nvs_open(WIFI_STA_NAMESPACE, NVS_READWRITE, &nvs_handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_erase_key(nvs_handle, "ssid");
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        err = ESP_OK;
    }
    if (err == ESP_OK) {
        esp_err_t password_err = nvs_erase_key(nvs_handle, "password");
        if (password_err != ESP_OK && password_err != ESP_ERR_NVS_NOT_FOUND) {
            err = password_err;
        }
    }
    if (err == ESP_OK) {
        err = nvs_commit(nvs_handle);
    }

    nvs_close(nvs_handle);
    return err;
}

static esp_err_t apply_sta_wifi_config(void)
{
    if (!has_sta_wifi_credentials()) {
        return ESP_ERR_INVALID_STATE;
    }

    wifi_config_t sta_config = { 0 };
    memcpy(sta_config.sta.ssid, sta_wifi_ssid, strnlen(sta_wifi_ssid, sizeof(sta_config.sta.ssid)));
    memcpy(sta_config.sta.password, sta_wifi_password, strnlen(sta_wifi_password, sizeof(sta_config.sta.password)));
    sta_config.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    sta_config.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
    sta_config.sta.failure_retry_cnt = 5;
    sta_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    sta_config.sta.pmf_cfg.capable = true;
    sta_config.sta.pmf_cfg.required = false;

    return esp_wifi_set_config(WIFI_IF_STA, &sta_config);
}

static void connect_sta_wifi_if_configured(void)
{
    if (!wifi_started || !has_sta_wifi_credentials()) {
        return;
    }

    if (apply_sta_wifi_config() != ESP_OK) {
        return;
    }

    sta_wifi_connecting = true;
    sta_wifi_connected = false;
    sta_wifi_ip[0] = '\0';
    esp_wifi_connect();
}

static bool set_sta_wifi_credentials(const char *ssid, const char *password, bool persist)
{
    char next_ssid[WIFI_STA_SSID_MAX_LEN];
    char next_password[WIFI_STA_PASSWORD_MAX_LEN];

    snprintf(next_ssid, sizeof(next_ssid), "%s", ssid ? ssid : "");
    snprintf(next_password, sizeof(next_password), "%s", password ? password : "");
    trim_in_place(next_ssid);
    trim_in_place(next_password);

    if (next_ssid[0] == '\0') {
        return false;
    }

    if (strlen(next_ssid) >= WIFI_STA_SSID_MAX_LEN || strlen(next_password) >= WIFI_STA_PASSWORD_MAX_LEN) {
        return false;
    }

    snprintf(sta_wifi_ssid, sizeof(sta_wifi_ssid), "%s", next_ssid);
    snprintf(sta_wifi_password, sizeof(sta_wifi_password), "%s", next_password);

    if (persist) {
        if (save_sta_wifi_credentials_to_nvs() != ESP_OK) {
            return false;
        }
    }

    if (wifi_started) {
        esp_wifi_disconnect();
        connect_sta_wifi_if_configured();
    }

    return true;
}

static void clear_sta_wifi_credentials(void)
{
    sta_wifi_ssid[0] = '\0';
    sta_wifi_password[0] = '\0';
    sta_wifi_ip[0] = '\0';
    sta_wifi_connected = false;
    sta_wifi_connecting = false;
    clear_sta_wifi_credentials_in_nvs();

    if (wifi_started) {
        esp_wifi_disconnect();
    }
}

static bool sync_ap_dns_from_sta(void)
{
    if (g_sta_netif == NULL) {
        return false;
    }

    esp_netif_dns_info_t dns = { 0 };
    if (esp_netif_get_dns_info(g_sta_netif, ESP_NETIF_DNS_MAIN, &dns) == ESP_OK && dns.ip.u_addr.ip4.addr != 0) {
        char dns_ip[16];
        inet_ntoa_r(dns.ip.u_addr.ip4.addr, dns_ip, sizeof(dns_ip));
        ESP_LOGI(TAG, "Upstream WiFi DNS available for forwarding: %s", dns_ip);
        return true;
    }

    if (esp_netif_get_dns_info(g_sta_netif, ESP_NETIF_DNS_BACKUP, &dns) == ESP_OK && dns.ip.u_addr.ip4.addr != 0) {
        char dns_ip[16];
        inet_ntoa_r(dns.ip.u_addr.ip4.addr, dns_ip, sizeof(dns_ip));
        ESP_LOGI(TAG, "Upstream WiFi backup DNS available for forwarding: %s", dns_ip);
        return true;
    }

    esp_netif_ip_info_t sta_ip_info = { 0 };
    if (esp_netif_get_ip_info(g_sta_netif, &sta_ip_info) == ESP_OK && sta_ip_info.gw.addr != 0) {
        char gateway_ip[16];
        inet_ntoa_r(sta_ip_info.gw.addr, gateway_ip, sizeof(gateway_ip));
        ESP_LOGI(TAG, "Upstream gateway available for DNS fallback forwarding: %s", gateway_ip);
        return true;
    }

    ESP_LOGW(TAG, "STA DNS unavailable, hotspot clients may need to reconnect after upstream DNS appears");
    return false;
}

static void set_nat_passthrough_active(bool enable)
{
    if (g_ap_netif == NULL) {
        return;
    }

    if (enable) {
        if (nat_passthrough_active) {
            return;
        }

        ensure_captive_dns_server_running();
        set_ap_dns_to_local_captive();
        sync_ap_dns_from_sta();
        esp_netif_set_default_netif(g_sta_netif);
        esp_err_t err = esp_netif_napt_enable(g_ap_netif);
        if (err == ESP_OK) {
            nat_passthrough_active = true;
            ESP_LOGI(TAG, "NAT internet passthrough enabled for hotspot clients");
        } else {
            ESP_LOGW(TAG, "Failed to enable NAT passthrough (err=%s)", esp_err_to_name(err));
            set_ap_dns_to_local_captive();
        }
        return;
    }

    if (!nat_passthrough_active) {
        set_ap_dns_to_local_captive();
        ensure_captive_dns_server_running();
        return;
    }

    esp_err_t err = esp_netif_napt_disable(g_ap_netif);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Failed to disable NAT passthrough cleanly (err=%s)", esp_err_to_name(err));
    }
    nat_passthrough_active = false;
    esp_netif_set_default_netif(g_ap_netif);
    set_ap_dns_to_local_captive();
    ensure_captive_dns_server_running();
    ESP_LOGI(TAG, "NAT internet passthrough disabled");
}

// ==================================================
// SHARED CONTROL LOGIC
// ==================================================
static void trigger_lock_pulse_internal(int lock_number_1_based)
{
    int lock_index = lock_number_1_based - 1;

    if (!valid_lock_index(lock_index)) {
        return;
    }

    lock_active_until[lock_index] = xTaskGetTickCount() + pdMS_TO_TICKS(LOCK_PULSE_MS);
}

static void trigger_lock_pulse(int lock_number_1_based)
{
    if (xSemaphoreTake(g_lock_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        trigger_lock_pulse_internal(lock_number_1_based);
        xSemaphoreGive(g_lock_mutex);
    }
}

static void rebuild_outputs_from_active_pulses(void)
{
    TickType_t now = xTaskGetTickCount();

    memset(output_bytes, 0, sizeof(output_bytes));

    for (int i = 0; i < NUM_LOCKS; i++) {
        if (lock_active_until[i] > now) {
            set_output_bit(output_bytes, i, true);
        }
    }

    write_595_chain(output_bytes, NUM_OUTPUT_BYTES);
}

static void process_button_edges(void)
{
    for (int lock_index = 0; lock_index < NUM_LOCKS; lock_index++) {
        bool current_level  = get_input_bit(input_bytes, lock_index);
        bool previous_level = get_input_bit(prev_input_bytes, lock_index);

        // pull-up logic:
        // released = 1
        // pressed  = 0
        bool pressed_now = (previous_level == true) && (current_level == false);

        if (pressed_now) {
            trigger_lock_pulse_internal(lock_index + 1);
        }
    }

    memcpy(prev_input_bytes, input_bytes, sizeof(input_bytes));
}

static void serial_init(void)
{
    const uart_config_t uart_config = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT
    };

    ESP_ERROR_CHECK(uart_param_config(SERIAL_UART_NUM, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(
        SERIAL_UART_NUM,
        UART_PIN_NO_CHANGE,
        UART_PIN_NO_CHANGE,
        UART_PIN_NO_CHANGE,
        UART_PIN_NO_CHANGE
    ));
    ESP_ERROR_CHECK(uart_driver_install(SERIAL_UART_NUM, SERIAL_RX_BUFFER, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_flush_input(SERIAL_UART_NUM));

    memset(serial_command_buffer, 0, sizeof(serial_command_buffer));
    serial_command_length = 0;
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;

    if (event_base == WIFI_EVENT) {
        if (event_id == WIFI_EVENT_AP_STACONNECTED) {
            wifi_event_ap_staconnected_t *event = (wifi_event_ap_staconnected_t *)event_data;
            ESP_LOGI(TAG, "Hotspot client joined: " MACSTR " AID=%d", MAC2STR(event->mac), event->aid);
            set_captive_dns_gate(true);
            return;
        }

        if (event_id == WIFI_EVENT_AP_STADISCONNECTED) {
            wifi_event_ap_stadisconnected_t *event = (wifi_event_ap_stadisconnected_t *)event_data;
            ESP_LOGI(TAG, "Hotspot client left: " MACSTR " AID=%d", MAC2STR(event->mac), event->aid);
            set_captive_dns_gate(true);
            return;
        }

        if (event_id == WIFI_EVENT_STA_START) {
            connect_sta_wifi_if_configured();
            return;
        }

        if (event_id == WIFI_EVENT_STA_CONNECTED) {
            sta_wifi_connecting = false;
            ESP_LOGI(TAG, "STA connected to WiFi SSID '%s'", sta_wifi_ssid[0] ? sta_wifi_ssid : "(unset)");
            return;
        }

        if (event_id == WIFI_EVENT_STA_DISCONNECTED) {
            sta_wifi_connected = false;
            sta_wifi_connecting = false;
            sta_wifi_ip[0] = '\0';
            set_nat_passthrough_active(false);

            if (has_sta_wifi_credentials()) {
                ESP_LOGW(TAG, "STA disconnected from WiFi. Reconnecting to '%s'...", sta_wifi_ssid);
                connect_sta_wifi_if_configured();
            }
            return;
        }
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        inet_ntoa_r(event->ip_info.ip.addr, sta_wifi_ip, sizeof(sta_wifi_ip));
        sta_wifi_connected = true;
        sta_wifi_connecting = false;
        ESP_LOGI(TAG, "STA got IP %s", sta_wifi_ip);
        sync_ap_dns_from_sta();
        set_nat_passthrough_active(true);
    }
}

static void handle_serial_command(const char *command)
{
    int lock_num = 0;
    char url_value[PORTAL_URL_MAX_LEN];
    const char *sta_prefix = "SET_STA ";

    if (sscanf(command, "UNLOCK %d", &lock_num) == 1) {
        if (lock_num >= 1 && lock_num <= NUM_LOCKS) {
            trigger_lock_pulse(lock_num);
            printf("SERIAL_OK UNLOCK %d\n", lock_num);
        } else {
            printf("SERIAL_ERROR INVALID_LOCK %d\n", lock_num);
        }
        return;
    }

    if (strcmp(command, "STATUS") == 0) {
        printf("SERIAL_STATUS SSID=%s IP=%s LOCKS=%d URL=%s STA_SSID=%s STA_CONNECTED=%d STA_IP=%s NAT=%d GATE=%d PORTAL_MODE=%s\n",
            WIFI_SSID,
            DEFAULT_AP_IP,
            NUM_LOCKS,
            portal_target_url[0] ? portal_target_url : "(unset)",
            has_sta_wifi_credentials() ? sta_wifi_ssid : "(unset)",
            sta_wifi_connected ? 1 : 0,
            sta_wifi_ip[0] ? sta_wifi_ip : "(none)",
            nat_passthrough_active ? 1 : 0,
            captive_dns_gate_active ? 1 : 0,
            portal_redirect_mode ? "redirect" : "buttons"
        );
        return;
    }

    if (strcmp(command, "CLEAR_URL") == 0) {
        set_portal_target_url("");
        printf("SERIAL_OK CLEAR_URL\n");
        return;
    }

    if (strncmp(command, "SET_URL ", 8) == 0) {
        snprintf(url_value, sizeof(url_value), "%s", command + 8);
        if (set_portal_target_url(url_value)) {
            printf("SERIAL_OK SET_URL %s\n", portal_target_url[0] ? portal_target_url : "(cleared)");
        } else {
            printf("SERIAL_ERROR INVALID_URL\n");
        }
        return;
    }

    if (strncmp(command, "SET_PORTAL_MODE ", 16) == 0) {
        if (set_portal_redirect_mode(command + 16)) {
            printf("SERIAL_OK SET_PORTAL_MODE %s\n", portal_redirect_mode ? "redirect" : "buttons");
        } else {
            printf("SERIAL_ERROR INVALID_PORTAL_MODE\n");
        }
        return;
    }

    if (strcmp(command, "CLEAR_STA") == 0) {
        clear_sta_wifi_credentials();
        printf("SERIAL_OK CLEAR_STA\n");
        return;
    }

    if (strncmp(command, sta_prefix, strlen(sta_prefix)) == 0) {
        char credentials[WIFI_STA_SSID_MAX_LEN + WIFI_STA_PASSWORD_MAX_LEN + 8];
        char *separator = NULL;

        snprintf(credentials, sizeof(credentials), "%s", command + strlen(sta_prefix));
        separator = strchr(credentials, '|');
        if (separator == NULL) {
            printf("SERIAL_ERROR INVALID_STA_FORMAT\n");
            return;
        }

        *separator = '\0';
        separator++;

        if (set_sta_wifi_credentials(credentials, separator, true)) {
            printf("SERIAL_OK SET_STA %s\n", sta_wifi_ssid);
        } else {
            printf("SERIAL_ERROR INVALID_STA_CREDENTIALS\n");
        }
        return;
    }

    printf("SERIAL_ERROR UNKNOWN_COMMAND %s\n", command);
}

static void process_serial_input(void)
{
    uint8_t rx_buffer[64];
    int bytes_read = uart_read_bytes(SERIAL_UART_NUM, rx_buffer, sizeof(rx_buffer), 0);

    if (bytes_read <= 0) {
        return;
    }

    for (int i = 0; i < bytes_read; i++) {
        char ch = (char)rx_buffer[i];

        if (ch == '\r') {
            continue;
        }

        if (ch == '\n') {
            if (serial_command_length > 0) {
                serial_command_buffer[serial_command_length] = '\0';
                handle_serial_command(serial_command_buffer);
                serial_command_length = 0;
            }
            continue;
        }

        if (serial_command_length < (SERIAL_CMD_MAX_LEN - 1)) {
            serial_command_buffer[serial_command_length++] = ch;
        } else {
            serial_command_length = 0;
            printf("SERIAL_ERROR COMMAND_TOO_LONG\n");
        }
    }
}

// ==================================================
// HTTP HANDLER
// ==================================================
static void set_common_response_headers(httpd_req_t *req)
{
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
}

static esp_err_t send_chunkf(httpd_req_t *req, const char *format, ...)
{
    char buffer[768];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);

    if (written < 0) {
        return ESP_FAIL;
    }

    if ((size_t)written >= sizeof(buffer)) {
        ESP_LOGW(TAG, "Portal HTML chunk truncated");
    }

    return httpd_resp_sendstr_chunk(req, buffer);
}

static void build_android_intent_url(const char *target, bool prefer_chrome, char *buffer, size_t buffer_size)
{
    if (buffer == NULL || buffer_size == 0) {
        return;
    }

    buffer[0] = '\0';
    if (target == NULL || target[0] == '\0') {
        return;
    }

    const char *scheme = strncmp(target, "https://", 8) == 0 ? "https" : "http";
    const char *target_no_scheme = strstr(target, "://");
    target_no_scheme = target_no_scheme ? target_no_scheme + 3 : target;

    snprintf(
        buffer,
        buffer_size,
        "intent://%s#Intent;scheme=%s;%spackage=com.android.chrome;end",
        target_no_scheme,
        scheme,
        prefer_chrome ? "" : ""
    );
}

static esp_err_t redirect_to_external_target(httpd_req_t *req, const char *target_url)
{
    if (target_url == NULL || target_url[0] == '\0') {
        return redirect_to_root_handler(req);
    }

    set_captive_dns_gate(false);
    set_common_response_headers(req);
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", target_url);
    httpd_resp_send(req, "", 0);
    return ESP_OK;
}

static esp_err_t open_target_handler(httpd_req_t *req)
{
    return redirect_to_external_target(req, portal_target_url);
}

static esp_err_t open_raw_target_handler(httpd_req_t *req)
{
    return redirect_to_external_target(req, portal_target_url);
}

static esp_err_t open_chrome_target_handler(httpd_req_t *req)
{
    if (portal_target_url[0] == '\0') {
        return redirect_to_root_handler(req);
    }

    char chrome_intent_url[PORTAL_URL_MAX_LEN + 96];
    build_android_intent_url(portal_target_url, true, chrome_intent_url, sizeof(chrome_intent_url));
    if (chrome_intent_url[0] == '\0') {
        return redirect_to_external_target(req, portal_target_url);
    }

    return redirect_to_external_target(req, chrome_intent_url);
}

static esp_err_t root_handler(httpd_req_t *req)
{
    set_captive_dns_gate(false);
    const char *target = portal_target_url[0] ? portal_target_url : "";
    if (portal_redirect_mode && target[0]) {
        return redirect_to_external_target(req, target);
    }
    const bool target_is_cloudflare = strstr(target, "trycloudflare.com") != NULL;
    const char *status_text = target[0]
        ? (target_is_cloudflare
            ? (nat_passthrough_active
                ? "Your latest cloud link is ready. Internet passthrough is active on this hotspot, so you can stay here and tap the button below to continue."
                : "Your latest cloud link is ready. Stay on this ESP page first, then tap the button below when you are ready to continue.")
            : "Your system link is ready. Stay on this ESP page first, then tap the button below when you are ready to continue.")
        : "The full system URL is not configured yet. Start the laptop launcher after connecting it to this WiFi.";
    const char *hint_text = target_is_cloudflare
        ? (nat_passthrough_active
            ? "Internet passthrough is active through the saved upstream WiFi. If your phone still shows an old captive screen, reconnect to LockerSystem once, then tap Open in Chrome again."
            : "If the cloud website does not open while this phone is on the LockerSystem hotspot, switch to mobile data or another internet-connected WiFi first, then tap the button again.")
        : "If your phone does not open this page automatically, open any browser and go to http://192.168.4.1.";

    set_common_response_headers(req);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(req,
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>LockerSystem Portal</title>"
        "<style>"
        ":root{color-scheme:light;font-family:'Segoe UI',Arial,sans-serif;}"
        "*{box-sizing:border-box}"
        "body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#ffe7d6 0,#f2cab3 28%,#871515 72%,#4d0808 100%);color:#241212;}"
        ".shell{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:22px;}"
        ".card{width:min(94vw,560px);background:rgba(255,250,247,.96);border:1px solid rgba(122,8,8,.12);border-radius:28px;padding:30px 24px 24px;box-shadow:0 22px 60px rgba(34,10,10,.28);}"
        ".badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#fff1eb;color:#8d1111;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}"
        ".dot{width:10px;height:10px;border-radius:999px;background:#16a34a;box-shadow:0 0 0 6px rgba(22,163,74,.12);}"
        "h1{margin:16px 0 10px;font-size:30px;line-height:1.1;color:#6f0d0d;}"
        "p{margin:0 0 14px;line-height:1.6;font-size:15px;}"
        ".meta{display:grid;gap:10px;margin:20px 0;padding:16px;border-radius:18px;background:#fff4ef;color:#5a4040;word-break:break-word;font-size:14px;}"
        ".meta strong{display:block;color:#7a0808;font-size:12px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px;}"
        ".actions{display:grid;gap:12px;margin-top:20px;}"
        ".actions form{margin:0;}"
        ".btn{display:block;width:100%;text-align:center;text-decoration:none;padding:15px 18px;border-radius:16px;font-weight:800;font-size:15px;border:none;cursor:pointer;-webkit-appearance:none;appearance:none;touch-action:manipulation;}"
        ".btn-primary{background:linear-gradient(135deg,#c31818 0,#8b0b0b 100%);color:#fff;box-shadow:0 14px 30px rgba(139,11,11,.25);}"
        ".btn-primary.disabled{background:#ddc7c7;color:#7b6060;pointer-events:none;box-shadow:none;}"
        ".btn-secondary{background:#fff;color:#9d1010;border:2px solid #c73838;}"
        ".btn-tertiary{background:#fff6f1;color:#6f0d0d;border:1px dashed #c75858;}"
        ".hint{margin-top:16px;font-size:13px;color:#6c5656;}"
        ".footer{margin-top:22px;padding-top:16px;border-top:1px solid rgba(122,8,8,.12);font-size:12px;color:#7a6464;}"
        "</style></head><body><div class='shell'><section class='card'>"
        "<span class='badge'><span class='dot'></span>LockerSystem Hotspot</span>"
        "<h1>Open the Key Borrowing System</h1>"
    ), TAG, "Failed to send portal header");

    ESP_RETURN_ON_ERROR(send_chunkf(req, "<p>%s</p>", status_text), TAG, "Failed to send portal status");
    ESP_RETURN_ON_ERROR(send_chunkf(
        req,
        "<div class='meta'><div><strong>ESP Portal</strong>http://%s</div><div><strong>System URL</strong>%s</div><div><strong>House WiFi</strong>%s</div><div><strong>Station IP</strong>%s</div><div><strong>Internet Passthrough</strong>%s</div></div>",
        DEFAULT_AP_IP,
        target[0] ? target : "Not configured yet",
        has_sta_wifi_credentials() ? sta_wifi_ssid : "Not configured",
        sta_wifi_ip[0] ? sta_wifi_ip : (sta_wifi_connecting ? "Connecting..." : "Not connected"),
        nat_passthrough_active ? "Active" : (has_sta_wifi_credentials() ? "Waiting for upstream WiFi" : "Not configured")
    ), TAG, "Failed to send portal meta");

    ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(req, "<div class='actions'>"), TAG, "Failed to open actions");
    if (target[0]) {
        ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(
            req,
            "<form action='/open' method='get'><button class='btn btn-primary' type='submit'>Open Key Borrowing System</button></form>"
        ), TAG, "Failed to send primary button");
        if (target_is_cloudflare) {
            ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(
                req,
                "<form action='/open-chrome' method='get'><button class='btn btn-secondary' type='submit'>Open in Chrome</button></form>"
            ), TAG, "Failed to send Chrome button");
            ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(
                req,
                "<form action='/open-raw' method='get'><button class='btn btn-tertiary' type='submit'>Open Raw Cloudflare Link</button></form>"
            ), TAG, "Failed to send cloudflare action buttons");
        }
    } else {
        ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(
            req,
            "<button class='btn btn-primary disabled' type='button'>Start the laptop launcher first</button>"
        ), TAG, "Failed to send disabled button");
    }
    ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(
        req,
        "<form action='/status' method='get'><button class='btn btn-secondary' type='submit'>View Controller Status</button></form></div>"
        "<div class='footer'>This hotspot serves the controller page. The full key system still runs on the laptop/server.</div>"
    ), TAG, "Failed to send portal footer");

    ESP_RETURN_ON_ERROR(send_chunkf(req, "<p class='hint'>%s</p>", hint_text), TAG, "Failed to send portal hint");

    ESP_RETURN_ON_ERROR(httpd_resp_sendstr_chunk(req, "</section></div></body></html>"), TAG, "Failed to send portal closing HTML");
    return httpd_resp_send_chunk(req, NULL, 0);
}

static esp_err_t redirect_to_root_handler(httpd_req_t *req)
{
    if (portal_redirect_mode && portal_target_url[0]) {
        return redirect_to_external_target(req, portal_target_url);
    }

    set_common_response_headers(req);
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/");
    httpd_resp_send(req, "", 0);
    return ESP_OK;
}

static esp_err_t unlock_handler(httpd_req_t *req)
{
    char query[64];
    char lock_value[16];

    set_common_response_headers(req);

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "Missing query string. Use /unlock?lock=N");
        return ESP_OK;
    }

    if (httpd_query_key_value(query, "lock", lock_value, sizeof(lock_value)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "Missing 'lock' parameter. Use /unlock?lock=N");
        return ESP_OK;
    }

    int lock_num = atoi(lock_value);

    if (lock_num < 1 || lock_num > NUM_LOCKS) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "Invalid lock number");
        return ESP_OK;
    }

    trigger_lock_pulse(lock_num);

    char response[64];
    snprintf(response, sizeof(response), "Lock %d triggered\n", lock_num);
    httpd_resp_set_type(req, "text/plain");
    httpd_resp_sendstr(req, response);

    return ESP_OK;
}

static esp_err_t status_handler(httpd_req_t *req)
{
    int active_locks = 0;

    set_common_response_headers(req);

    if (xSemaphoreTake(g_lock_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        TickType_t now = xTaskGetTickCount();
        for (int i = 0; i < NUM_LOCKS; i++) {
            if (lock_active_until[i] > now) {
                active_locks++;
            }
        }
        xSemaphoreGive(g_lock_mutex);
    }

    char response[704];
    snprintf(
        response,
        sizeof(response),
        "{\"success\":true,\"device\":\"esp32-locker-controller\",\"status\":\"online\",\"ssid\":\"%s\",\"ip\":\"%s\",\"channel\":%d,\"locks\":%d,\"activeLocks\":%d,\"unlockPath\":\"/unlock\",\"statusPath\":\"/status\",\"portalTargetUrl\":\"%s\",\"portalMode\":\"%s\",\"staSsid\":\"%s\",\"staConnected\":%s,\"staIp\":\"%s\",\"internetPassthroughActive\":%s,\"portalGateActive\":%s}",
        WIFI_SSID,
        DEFAULT_AP_IP,
        WIFI_CHANNEL,
        NUM_LOCKS,
        active_locks,
        portal_target_url,
        portal_redirect_mode ? "redirect" : "buttons",
        has_sta_wifi_credentials() ? sta_wifi_ssid : "",
        sta_wifi_connected ? "true" : "false",
        sta_wifi_ip,
        nat_passthrough_active ? "true" : "false",
        captive_dns_gate_active ? "true" : "false"
    );

    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, response);
    return ESP_OK;
}

static esp_err_t portal_target_handler(httpd_req_t *req)
{
    char query[256];
    char url_value[PORTAL_URL_MAX_LEN];

    set_common_response_headers(req);
    httpd_resp_set_type(req, "application/json");

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"success\":false,\"error\":\"Missing query string. Use /portal-target?url=http://... or /portal-target?clear=1\"}");
        return ESP_OK;
    }

    if (strstr(query, "clear=1") != NULL) {
        set_portal_target_url("");
        httpd_resp_sendstr(req, "{\"success\":true,\"portalTargetUrl\":\"\"}");
        return ESP_OK;
    }

    if (httpd_query_key_value(query, "url", url_value, sizeof(url_value)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"success\":false,\"error\":\"Missing url parameter\"}");
        return ESP_OK;
    }

    if (!set_portal_target_url(url_value)) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"success\":false,\"error\":\"Invalid URL. Use http:// or https://\"}");
        return ESP_OK;
    }

    char response[256];
    snprintf(response, sizeof(response), "{\"success\":true,\"portalTargetUrl\":\"%s\"}", portal_target_url);
    httpd_resp_sendstr(req, response);
    return ESP_OK;
}

static esp_err_t portal_mode_handler(httpd_req_t *req)
{
    char query[128];
    char mode_value[32];

    set_common_response_headers(req);
    httpd_resp_set_type(req, "application/json");

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        char response[96];
        snprintf(response, sizeof(response), "{\"success\":true,\"portalMode\":\"%s\"}", portal_redirect_mode ? "redirect" : "buttons");
        httpd_resp_sendstr(req, response);
        return ESP_OK;
    }

    if (httpd_query_key_value(query, "mode", mode_value, sizeof(mode_value)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"success\":false,\"error\":\"Missing mode parameter\"}");
        return ESP_OK;
    }

    if (!set_portal_redirect_mode(mode_value)) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"success\":false,\"error\":\"Invalid mode. Use buttons or redirect\"}");
        return ESP_OK;
    }

    char response[96];
    snprintf(response, sizeof(response), "{\"success\":true,\"portalMode\":\"%s\"}", portal_redirect_mode ? "redirect" : "buttons");
    httpd_resp_sendstr(req, response);
    return ESP_OK;
}

static esp_err_t http_404_error_handler(httpd_req_t *req, httpd_err_code_t err)
{
    (void)err;
    httpd_resp_set_status(req, "303 See Other");
    httpd_resp_set_hdr(req, "Location", "/");
    httpd_resp_send(req, "Redirect to the captive portal", HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

static httpd_handle_t start_webserver(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    httpd_handle_t server = NULL;

    if (httpd_start(&server, &config) == ESP_OK) {
        httpd_uri_t root_uri = {
            .uri      = "/",
            .method   = HTTP_GET,
            .handler  = root_handler,
            .user_ctx = NULL
        };

        httpd_uri_t unlock_uri = {
            .uri      = "/unlock",
            .method   = HTTP_GET,
            .handler  = unlock_handler,
            .user_ctx = NULL
        };

        httpd_uri_t status_uri = {
            .uri      = "/status",
            .method   = HTTP_GET,
            .handler  = status_handler,
            .user_ctx = NULL
        };

        httpd_uri_t portal_target_uri = {
            .uri      = "/portal-target",
            .method   = HTTP_GET,
            .handler  = portal_target_handler,
            .user_ctx = NULL
        };

        httpd_uri_t portal_mode_uri = {
            .uri      = "/portal-mode",
            .method   = HTTP_GET,
            .handler  = portal_mode_handler,
            .user_ctx = NULL
        };

        httpd_uri_t open_target_uri = {
            .uri      = "/open",
            .method   = HTTP_GET,
            .handler  = open_target_handler,
            .user_ctx = NULL
        };

        httpd_uri_t open_chrome_target_uri = {
            .uri      = "/open-chrome",
            .method   = HTTP_GET,
            .handler  = open_chrome_target_handler,
            .user_ctx = NULL
        };

        httpd_uri_t open_raw_target_uri = {
            .uri      = "/open-raw",
            .method   = HTTP_GET,
            .handler  = open_raw_target_handler,
            .user_ctx = NULL
        };

        httpd_uri_t captive_probe_uris[] = {
            { .uri = "/generate_204",            .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/gen_204",                 .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/hotspot-detect.html",     .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/library/test/success.html", .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/ncsi.txt",                .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/connecttest.txt",         .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/connectivity-check.html", .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/redirect",                .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/canonical.html",          .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/check_network_status.txt", .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/portal.html",             .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/success.txt",             .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL },
            { .uri = "/fwlink",                  .method = HTTP_GET, .handler = redirect_to_root_handler, .user_ctx = NULL }
        };

        httpd_register_uri_handler(server, &root_uri);
        httpd_register_uri_handler(server, &unlock_uri);
        httpd_register_uri_handler(server, &status_uri);
        httpd_register_uri_handler(server, &portal_target_uri);
        httpd_register_uri_handler(server, &portal_mode_uri);
        httpd_register_uri_handler(server, &open_target_uri);
        httpd_register_uri_handler(server, &open_chrome_target_uri);
        httpd_register_uri_handler(server, &open_raw_target_uri);
        for (size_t i = 0; i < sizeof(captive_probe_uris) / sizeof(captive_probe_uris[0]); i++) {
            httpd_register_uri_handler(server, &captive_probe_uris[i]);
        }
        httpd_register_err_handler(server, HTTPD_404_NOT_FOUND, http_404_error_handler);
    }

    return server;
}

// ==================================================
// WIFI AP MODE
// ==================================================
static void wifi_init_softap(void)
{
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    g_ap_netif = esp_netif_create_default_wifi_ap();
    g_sta_netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    wifi_config_t wifi_config = {
        .ap = {
            .ssid = WIFI_SSID,
            .ssid_len = strlen(WIFI_SSID),
            .channel = WIFI_CHANNEL,
            .password = WIFI_PASSWORD,
            .max_connection = MAX_STA_CONN,
            .authmode = WIFI_AUTH_WPA_WPA2_PSK
        },
    };

    if (strlen(WIFI_PASSWORD) == 0) {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    wifi_started = true;
    connect_sta_wifi_if_configured();

    printf("WiFi AP+STA started: AP_SSID=%s AP_IP=%s Channel=%d MaxLocks=%d STA_SSID=%s\n",
        WIFI_SSID,
        DEFAULT_AP_IP,
        WIFI_CHANNEL,
        NUM_LOCKS,
        has_sta_wifi_credentials() ? sta_wifi_ssid : "(unset)"
    );
}

static void dhcp_set_captiveportal_url(void)
{
    esp_netif_ip_info_t ip_info;
    esp_netif_get_ip_info(esp_netif_get_handle_from_ifkey("WIFI_AP_DEF"), &ip_info);

    char ip_addr[16];
    inet_ntoa_r(ip_info.ip.addr, ip_addr, sizeof(ip_addr));

    char captiveportal_uri[32];
    snprintf(captiveportal_uri, sizeof(captiveportal_uri), "http://%s", ip_addr);

    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_netif_dhcps_stop(netif));
    ESP_ERROR_CHECK(esp_netif_dhcps_option(
        netif,
        ESP_NETIF_OP_SET,
        ESP_NETIF_CAPTIVEPORTAL_URI,
        captiveportal_uri,
        strlen(captiveportal_uri)
    ));
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_netif_dhcps_start(netif));
}

// ==================================================
// GPIO INIT
// ==================================================
static void gpio_init_all(void)
{
    gpio_config_t out_conf = {
        .pin_bit_mask =
            (1ULL << SR_DATA) |
            (1ULL << SR_CLOCK) |
            (1ULL << SR_LATCH) |
            (1ULL << BTN_CLOCK) |
            (1ULL << BTN_LOAD),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&out_conf);

    gpio_config_t in_conf = {
        .pin_bit_mask = (1ULL << BTN_DATA),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&in_conf);

    gpio_set_level(SR_DATA, 0);
    gpio_set_level(SR_CLOCK, 0);
    gpio_set_level(SR_LATCH, 0);
    gpio_set_level(BTN_CLOCK, 0);
    gpio_set_level(BTN_LOAD, 1);
}

// ==================================================
// MAIN
// ==================================================
void app_main(void)
{
    esp_log_level_set("httpd_uri", ESP_LOG_ERROR);
    esp_log_level_set("httpd_txrx", ESP_LOG_ERROR);
    esp_log_level_set("httpd_parse", ESP_LOG_ERROR);

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    g_lock_mutex = xSemaphoreCreateMutex();
    if (g_lock_mutex == NULL) {
        return;
    }

    memset(input_bytes, 0xFF, sizeof(input_bytes));
    memset(prev_input_bytes, 0xFF, sizeof(prev_input_bytes));
    memset(output_bytes, 0x00, sizeof(output_bytes));
    memset(lock_active_until, 0, sizeof(lock_active_until));

    gpio_init_all();
    serial_init();
    write_595_chain(output_bytes, NUM_OUTPUT_BYTES);
    if (load_sta_wifi_credentials_from_nvs() != ESP_OK) {
        ESP_LOGW(TAG, "Failed to load saved STA WiFi credentials");
        sta_wifi_ssid[0] = '\0';
        sta_wifi_password[0] = '\0';
    }

    wifi_init_softap();
    dhcp_set_captiveportal_url();
    set_ap_dns_to_local_captive();
    g_httpd = start_webserver();
    ensure_captive_dns_server_running();
    printf("Locker controller ready: http://%s/ with captive portal, /status, and /unlock?lock=1..%d\n", DEFAULT_AP_IP, NUM_LOCKS);

    while (1) {
        read_165_chain(input_bytes, NUM_INPUT_BYTES);
        process_serial_input();

        if (xSemaphoreTake(g_lock_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
            process_button_edges();
            rebuild_outputs_from_active_pulses();
            xSemaphoreGive(g_lock_mutex);
        }

        if (DEBUG_IO_LOG) {
            printf("IN: ");
            for (int i = 0; i < NUM_INPUT_BYTES; i++) {
                printf("%02X ", input_bytes[i]);
            }

            printf(" | OUT: ");
            for (int i = 0; i < NUM_OUTPUT_BYTES; i++) {
                printf("%02X ", output_bytes[i]);
            }
            printf("\n");
        }

        vTaskDelay(pdMS_TO_TICKS(LOOP_DELAY_MS));
    }
}
