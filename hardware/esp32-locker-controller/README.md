# ESP32 Locker Controller

This project is wired to an ESP32 locker controller firmware based on your `main .c` file and is now laid out as a real ESP-IDF project so the ESP-IDF VS Code extension can detect it.

## ESP-IDF project layout

- Open `hardware/esp32-locker-controller` as the VS Code folder when working with the ESP-IDF extension.
- Root project file:
  - `hardware/esp32-locker-controller/CMakeLists.txt`
- ESP-IDF component entry:
  - `hardware/esp32-locker-controller/main/CMakeLists.txt`
- Build entry source used by ESP-IDF:
  - `hardware/esp32-locker-controller/main/main.c`
- Firmware source of truth:
  - `hardware/esp32-locker-controller/main.c`

`main/main.c` only includes the root `main.c`, so you still maintain one actual firmware file.

## What is connected

- The web app QR scan route calls the locker controller before marking a key as borrowed or returned.
- The controller endpoint used by the server is:
  - `GET /unlock?lock=N`
- The firmware status endpoint expected by the admin panel is:
  - `GET /status`
- Each locker in the admin panel keeps its own `hardwareLockNumber` mapping so new lockers and key QR codes stay connected to the correct ESP32 lock.

## Current firmware source

The firmware source is stored here:

- `hardware/esp32-locker-controller/main.c`

The original source you asked to connect is still here on your machine:

- `C:\Users\ewart\Downloads\main .c`

Both versions expose `/status` in addition to `/unlock`.

## Web app integration points

- Server-side QR + hardware trigger:
  - `public/server/server.js`
- Admin connection status card:
  - `public/html/admin.html`
  - `public/js/admin-script.js`

## Default controller settings

If you do not override anything in `public/.env`, the server will try to reach:

- `http://192.168.4.1`

That matches the usual ESP32 SoftAP default IP for the firmware in `main.c`.

## Build and flash

From `hardware/esp32-locker-controller`:

1. Run `idf.py set-target esp32` once.
2. Run `idf.py build`.
3. Run `idf.py -p COMx flash monitor` with your ESP32 port.

If `idf.py` is not recognized in the terminal, install ESP-IDF first and open the project from an ESP-IDF PowerShell or the ESP-IDF VS Code extension before building.

## What changed in the firmware

- The project now declares its ESP-IDF component dependencies explicitly in `main/CMakeLists.txt`.
- VS Code CMake now points at the real ESP-IDF project root instead of the `main` subfolder.
- The controller now exposes:
  - `GET /`
  - `GET /status`
  - `GET /unlock?lock=N`
- Button inputs are debounced to avoid accidental double-triggering.
- Startup now samples the input chain once so locks do not falsely trigger during boot.
- `/status` now reports the SSID, default controller IP, lock count, active lock count, and timing values.

## Important note

For the full connection to work:

1. Flash the ESP32 from the `hardware/esp32-locker-controller` project folder.
2. Connect the computer or server running Node.js to the ESP32 network if you are using SoftAP mode.
3. Make sure the key's locker label matches the hardware lock number, such as `Locker 1`, `Locker 2`, and so on.
