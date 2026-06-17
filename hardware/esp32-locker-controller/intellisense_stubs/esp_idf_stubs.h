#ifndef ESP_IDF_INTELLISENSE_STUBS_H
#define ESP_IDF_INTELLISENSE_STUBS_H

/*
 * Editor-only shim for VS Code IntelliSense.
 * This keeps hardware/esp32-locker-controller/main.c readable in this repo
 * even when ESP-IDF is not installed on the current machine.
 *
 * Real firmware builds still use the actual ESP-IDF headers because this file
 * is only included when __INTELLISENSE__ is defined by the editor.
 */

typedef unsigned char uint8_t;
typedef unsigned long long uint64_t;
typedef unsigned long size_t;
typedef int bool;

#ifndef true
#define true 1
#endif

#ifndef false
#define false 0
#endif

#ifndef NULL
#define NULL ((void *)0)
#endif

typedef int esp_err_t;
typedef unsigned int TickType_t;
typedef void *SemaphoreHandle_t;
typedef void *httpd_handle_t;
typedef struct httpd_req httpd_req_t;
typedef int gpio_int_type_t;

typedef struct {
    uint64_t pin_bit_mask;
    int mode;
    int pull_up_en;
    int pull_down_en;
    gpio_int_type_t intr_type;
} gpio_config_t;

typedef struct {
    int dummy;
} esp_netif_t;

typedef struct {
    struct {
        char ssid[33];
        unsigned char ssid_len;
        unsigned char channel;
        char password[65];
        unsigned char max_connection;
        int authmode;
    } ap;
} wifi_config_t;

typedef struct {
    int dummy;
} wifi_init_config_t;

typedef struct {
    int dummy;
} httpd_config_t;

typedef struct {
    const char *uri;
    int method;
    esp_err_t (*handler)(httpd_req_t *req);
    void *user_ctx;
} httpd_uri_t;

#define ESP_OK 0
#define ESP_ERR_NVS_NO_FREE_PAGES 0x1001
#define ESP_ERR_NVS_NEW_VERSION_FOUND 0x1002

#define pdTRUE 1
#define pdFALSE 0
#define pdMS_TO_TICKS(ms) (ms)

#define GPIO_MODE_OUTPUT 1
#define GPIO_MODE_INPUT 2
#define GPIO_PULLUP_DISABLE 0
#define GPIO_PULLDOWN_DISABLE 0
#define GPIO_INTR_DISABLE 0

#define WIFI_MODE_AP 1
#define WIFI_IF_AP 0
#define WIFI_AUTH_OPEN 0
#define WIFI_AUTH_WPA_WPA2_PSK 1

#define HTTP_GET 0

#define HTTPD_DEFAULT_CONFIG() ((httpd_config_t){0})
#define WIFI_INIT_CONFIG_DEFAULT() ((wifi_init_config_t){0})
#define ESP_ERROR_CHECK(x) ((void)(x))

int printf(const char *format, ...);
int snprintf(char *buffer, size_t size, const char *format, ...);
int atoi(const char *str);
size_t strlen(const char *str);
void *memset(void *dest, int ch, size_t count);
void *memcpy(void *dest, const void *src, size_t count);

void esp_rom_delay_us(unsigned int us);
TickType_t xTaskGetTickCount(void);
int xSemaphoreTake(SemaphoreHandle_t semaphore, TickType_t ticks_to_wait);
int xSemaphoreGive(SemaphoreHandle_t semaphore);
SemaphoreHandle_t xSemaphoreCreateMutex(void);
void vTaskDelay(TickType_t ticks_to_delay);

int gpio_set_level(int gpio_num, int level);
int gpio_get_level(int gpio_num);
esp_err_t gpio_config(const gpio_config_t *config);
int uart_driver_install(int uart_num, int rx_buffer_size, int tx_buffer_size, int queue_size, void *uart_queue, int intr_alloc_flags);
int uart_read_bytes(int uart_num, void *buf, unsigned int length, TickType_t ticks_to_wait);

esp_err_t esp_netif_init(void);
esp_err_t esp_event_loop_create_default(void);
esp_netif_t *esp_netif_create_default_wifi_ap(void);
esp_err_t esp_wifi_init(const wifi_init_config_t *config);
esp_err_t esp_wifi_set_mode(int mode);
esp_err_t esp_wifi_set_config(int interface_id, wifi_config_t *config);
esp_err_t esp_wifi_start(void);

esp_err_t httpd_start(httpd_handle_t *handle, const httpd_config_t *config);
esp_err_t httpd_register_uri_handler(httpd_handle_t handle, const httpd_uri_t *uri_handler);
esp_err_t httpd_req_get_url_query_str(httpd_req_t *req, char *buffer, size_t length);
esp_err_t httpd_query_key_value(const char *query, const char *key, char *value, size_t length);
esp_err_t httpd_resp_set_hdr(httpd_req_t *req, const char *field, const char *value);
esp_err_t httpd_resp_set_status(httpd_req_t *req, const char *status);
esp_err_t httpd_resp_set_type(httpd_req_t *req, const char *type);
esp_err_t httpd_resp_sendstr(httpd_req_t *req, const char *str);

esp_err_t nvs_flash_init(void);
esp_err_t nvs_flash_erase(void);

#endif
