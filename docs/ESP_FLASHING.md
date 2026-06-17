# ESP One-Click Flash

The ESP32 controller is an ESP-IDF project located at:

```text
hardware/esp32-locker-controller
```

It serves a locker control API over WiFi and supports USB serial commands for automatic configuration.

## What One-Click Flash Does

1. Detects the ESP32 serial port.
2. Builds the ESP-IDF firmware.
3. Flashes the firmware.
4. Saves the serial port to `public/.env`.
5. Optionally saves router WiFi credentials to the ESP32.
6. Sets the ESP portal target URL.
7. Sets portal mode.
8. Verifies the flash with `STATUS`.

## Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\flash-esp.ps1 -InstallIfMissing -InstallDrivers
```

Manual port:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\flash-esp.ps1 -Port COM5 -InstallIfMissing
```

Erase first:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\flash-esp.ps1 -Port COM5 -EraseFlash
```

## Linux

```bash
chmod +x flash-esp.sh
./flash-esp.sh --ssid "Your WiFi" --password "Your Password"
```

Manual port:

```bash
./flash-esp.sh --port /dev/ttyUSB0 --app-url http://192.168.1.50:3000
```

Erase first:

```bash
./flash-esp.sh --port /dev/ttyUSB0 --erase
```

## macOS

```bash
./flash-esp.sh --port /dev/cu.usbserial-0001
```

## Driver Installation

Common ESP32 USB serial chips:

| Chip | Windows | Linux | macOS |
|---|---|---|---|
| CP210x | Silicon Labs CP210x driver | Usually built in | Silicon Labs CP210x driver |
| CH340/CH341 | WCH CH340 driver | Usually built in | WCH CH340 driver |
| Native USB ESP32-Sx/Cx | Usually built in | Usually built in | Usually built in |

Linux serial permission fix:

```bash
sudo usermod -aG dialout,uucp $USER
```

Log out and log back in after changing groups.

## ESP-IDF Setup

Windows users can use:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-esp-idf-for-flashing.ps1 -InstallIfMissing -InstallDrivers
```

Linux/macOS users should install ESP-IDF, then source `export.sh` before flashing:

```bash
. $HOME/esp/esp-idf/export.sh
./flash-esp.sh
```

## Automatic Configuration

The firmware accepts these serial commands:

```text
SET_STA wifi-name|wifi-password
SET_URL http://192.168.1.50:3000
SET_PORTAL_MODE buttons
STATUS
```

`flash-esp.sh` and `scripts/flash-esp.ps1` send these automatically when possible.

## Flash Verification

After flashing, verify over HTTP:

```bash
curl http://192.168.4.1/status
curl "http://192.168.4.1/unlock?lock=1"
```

Expected status includes:

```json
{
  "success": true,
  "device": "esp32-locker-controller",
  "status": "online",
  "locks": 32
}
```

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `idf.py not found` | ESP-IDF not installed or exported | Install ESP-IDF and source `export.sh` |
| `Permission denied /dev/ttyUSB0` | Linux serial group missing | Add user to `dialout`/`uucp` and relogin |
| `No serial port detected` | USB cable, driver, or port issue | Try a data USB cable and install CP210x/CH340 driver |
| `Failed to connect` | ESP not in bootloader mode | Hold BOOT, tap EN/RESET, release BOOT |
| App cannot reach ESP | Wrong network or IP | Connect to `LockerSystem` or set `LOCKER_CONTROLLER_BASE_URL` |
| Lock does not trigger | Hardware number not mapped | Set hardware lock number in Admin key/locker settings |

## Recovery Steps

1. Use a known data-capable USB cable.
2. Install the USB serial driver.
3. Put ESP32 in boot mode: hold `BOOT`, press `EN`/`RESET`, release `BOOT`.
4. Run erase flash:

```bash
./flash-esp.sh --erase --port /dev/ttyUSB0
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\flash-esp.ps1 -Port COM5 -EraseFlash
```

5. Flash again.
6. Open `http://192.168.4.1/status`.

