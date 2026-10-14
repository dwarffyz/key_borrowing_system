# Key Borrowing System

<p align="center">
  <img src="public/images/logo.png" alt="Key Borrowing System Logo" width="120">
</p>

<p align="center">
  <strong>QR-based key borrowing, admin tracking, and ESP32 locker control for campus key management.</strong>
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-16%2B-339933?logo=node.js&logoColor=white">
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-Required-47A248?logo=mongodb&logoColor=white">
  <img alt="ESP32" src="https://img.shields.io/badge/ESP32-Supported-E7352C?logo=espressif&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg">
  <img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey">
</p>

## Overview

Key Borrowing System is a full-stack Node.js and MongoDB application for managing keys, lockers, QR codes, borrowing/return transactions, admin activity logs, announcements, and optional ESP32-controlled locker unlocking.

The web app lives in `public/`. The ESP32 firmware lives in `hardware/esp32-locker-controller/`.

## Features

- 🔐 Admin and user authentication with JWT and bcrypt password hashing
- 🔑 Key, locker, room, and building management
- 📱 QR code generation, scanning, download, and transaction tracking
- 📊 Admin dashboard with logs, reports, and system status
- 🧾 Borrow/return history with user and key metadata
- 📣 Announcement and notification management
- 🧰 Local, LAN, and Cloudflare Tunnel launch helpers
- ⚡ ESP32 locker controller integration through HTTP and USB serial fallback
- 🚀 One-click ESP32 flashing and automatic portal/WiFi configuration

## Supported Platforms

| Platform | Web App | ESP Flash | One-Click Scripts | Notes |
|---|---:|---:|---:|---|
| Windows 10/11 | ✅ | ✅ | ✅ | Best supported through PowerShell scripts |
| Ubuntu/Debian/Kali | ✅ | ✅ | ✅ | Uses `apt`, Node.js, MongoDB, ESP-IDF |
| Arch Linux | ✅ | ✅ | ✅ | Uses `pacman` |
| Fedora | ✅ | ✅ | ✅ | Uses `dnf` |
| macOS | ✅ | ✅ | ✅ | Uses Homebrew and ESP-IDF |

## Requirements

- Node.js 16 or newer
- npm
- Docker Desktop (Windows/macOS) or Docker Engine with Compose v2 (Linux), for the bundled MongoDB database
- MongoDB Atlas is supported as an alternative to Docker
- Git
- Python 3 and pip, required for ESP serial provisioning
- ESP-IDF, required only for ESP32 firmware build/flash
- ESP32 development board with a USB serial driver

## Quick Start

Use this section for a new PC. The application runs on the computer; Docker is
used only for MongoDB. That keeps USB/COM access and ESP32 networking available
to the application.

### Windows 10/11

1. Clone or download this repository, then open a terminal in its folder.
2. Run the first-time setup. It installs required packages, prepares `public/.env`,
   installs npm packages, and starts Docker/MongoDB when Docker is available.

```bat
setup-new-pc.bat
```

3. Start the complete system:

```bat
start-complete-system.bat
```

Open [http://localhost:3000](http://localhost:3000). To stop it and disable
Windows recovery/autostart, run `stop-complete-system.bat`.

### Linux: complete setup and run guide

The commands below work best on Ubuntu, Debian, and Linux Mint. Run them as a
normal user—not as `root`. The installer asks for your password only when it
needs `sudo` to install packages.

1. Clone the project and enter it:

```bash
git clone https://github.com/dwarffyz/key_borrowing_system.git
cd key_borrowing_system
```

2. Install Docker Engine and the Compose plugin if Docker is not already
   installed. On Ubuntu/Debian, the distribution packages are sufficient:

```bash
sudo apt update
sudo apt install -y docker.io
if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
  sudo apt install -y docker-compose-plugin
else
  sudo apt install -y docker-compose-v2
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and sign in again after `usermod`, then confirm that Docker works
without `sudo`:

```bash
docker run --rm hello-world
```

If your Linux distribution uses another package manager, install Docker Engine
and Docker Compose v2 through that distribution's official Docker instructions.

3. Make the launchers executable and run the installer:

```bash
chmod +x install.sh start.sh update.sh uninstall.sh \
  start-complete-system.sh stop-complete-system.sh flash-esp.sh \
  ONE-CLICK-FLASH-ESP32.sh
./install.sh
```

`./install.sh` installs Node.js/npm/Git/Python where supported, copies
`public/.env.example` to `public/.env` when necessary, installs npm packages,
and starts the MongoDB container.

4. Review `public/.env` before production use. At minimum, replace
`JWT_SECRET`, `SESSION_SECRET`, and `ADMIN_PASSWORD`; configure SMTP only if
password-reset emails are needed.

5. Start the app:

```bash
./start.sh
```

Keep that terminal open while the app is running. Visit:

```text
http://localhost:3000
http://localhost:3000/admin
```

To stop a foreground run, press `Ctrl+C`. MongoDB data remains safely stored in
the Docker volume. To start the app again later, open the project folder and
run `./start.sh` again.

### macOS

Install Docker Desktop first, then run:

```bash
brew install node python git
chmod +x install.sh start.sh start-complete-system.sh stop-complete-system.sh flash-esp.sh ONE-CLICK-FLASH-ESP32.sh
SKIP_SYSTEM_PACKAGES=1 ./install.sh
./start.sh
```

### First-run checklist

- Docker is running: `docker info`
- MongoDB is healthy: `docker compose ps`
- `public/.env` exists and does not contain development secrets
- Port 3000 is available
- The browser opens `http://localhost:3000`

### Flash the ESP32 controller

On Windows, double-click `ONE-CLICK-FLASH-ESP32.bat`. It automatically finds
the connected ESP controller, shows live build and upload progress (0%–100%),
then verifies and provisions it. On Linux/macOS, run:

```bash
chmod +x ONE-CLICK-FLASH-ESP32.sh
./ONE-CLICK-FLASH-ESP32.sh
```

The Linux/macOS launcher auto-detects the serial device. To specify one, use
`ESP_PORT=/dev/ttyUSB0 ./ONE-CLICK-FLASH-ESP32.sh`.

The flash launchers prevent two flashing sessions from using the same ESP at
once, recover an abandoned lock after an interrupted run, and use short build
paths to avoid ESP-IDF path-length errors.

Open:

```text
http://localhost:3000
http://localhost:3000/admin
```

Default development admin values are controlled by `public/.env`. Change them before real deployment.

## MongoDB with Docker

The app runs directly on the computer so it can access ESP32 networking and Windows COM ports. Only MongoDB runs in Docker. Its data is stored in persistent Docker volumes and is exposed only on `localhost:27017`.

On Windows, `setup-new-pc.ps1` automatically installs Docker Desktop with `winget` when needed, starts it, and waits for its engine. On macOS/Linux, install and start Docker Desktop or Docker Engine with Compose v2 first. Then start the app normally; the launcher starts and waits for MongoDB automatically.

Useful database commands:

```bash
docker compose ps
docker compose logs -f mongodb
docker compose stop mongodb
docker compose up -d mongodb
```

Do not run `docker compose down -v` unless you intentionally want to permanently delete all database data.

### Linux Docker troubleshooting

If `./start.sh` says Docker is unavailable or not running, run:

```bash
sudo systemctl start docker
docker info
docker compose ps
```

If `docker info` works only with `sudo`, the current account has not yet picked
up the `docker` group membership. Sign out and sign back in, or run
`newgrp docker`, then retry `docker info`. Do not use `sudo ./start.sh`; it can
create root-owned project files.

If MongoDB does not become healthy, inspect its logs:

```bash
docker compose logs --tail=100 mongodb
docker compose up -d mongodb
```

## Start Automatically After Restart

Autostart is opt-in. It restores the app after an unexpected shutdown or restart: Windows starts the complete system after sign-in (local app plus Cloudflare in Hybrid mode), Linux starts the local service after boot, and macOS starts it after sign-in. MongoDB is started by the normal launcher. Windows retries temporary Docker, WiFi, and Cloudflare startup failures; its log is saved in `.tools/autostart.log`. The app must have been set up successfully once first.

On Windows, simply double-click `start-complete-system.bat`: it starts the system and enables recovery automatically. Double-click `stop-complete-system.bat` to stop the system and disable recovery. The PowerShell switches remain available if you start the `.ps1` files directly.

Enable it directly through PowerShell only when needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-complete-system.ps1 -EnableAutostart
```

### Linux

On Linux, this installs a `systemd` service. It starts after networking becomes
available, restarts after a failure, and starts again when the PC boots:

```bash
./start-complete-system.sh
```

Check its health or live logs:

```bash
sudo systemctl status key-borrowing-system
sudo journalctl -u key-borrowing-system -f
```

Disable it and stop the app:

```bash
./stop-complete-system.sh
```

### macOS

The same commands install or remove a LaunchAgent, which starts after sign-in:

```bash
./start-complete-system.sh
./stop-complete-system.sh
```

Disable it directly through PowerShell only when needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\stop-complete-system.ps1 -DisableAutostart
```

## Installation

Full installation instructions are available in [INSTALLATION.md](INSTALLATION.md).

Common commands:

```bash
./install.sh
./start.sh
./update.sh
./uninstall.sh
```

Windows equivalents:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

## ESP One-Click Flash

The ESP32 firmware exposes:

| Endpoint | Purpose |
|---|---|
| `GET /status` | Controller health and configuration |
| `GET /unlock?lock=N` | Trigger lock number `N` |
| `GET /portal-target?url=...` | Configure phone portal target |
| `GET /portal-mode?mode=buttons` | Configure portal behavior |

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\flash-esp.ps1 -InstallIfMissing -InstallDrivers
```

### Linux/macOS

```bash
chmod +x flash-esp.sh
./flash-esp.sh --ssid "Your WiFi" --password "Your Password" --portal-mode buttons
```

With manual serial port:

```bash
./flash-esp.sh --port /dev/ttyUSB0 --app-url http://192.168.1.50:3000
```

The flash script builds the ESP-IDF project, flashes the ESP32, saves the detected serial port to `public/.env`, configures station WiFi if provided, configures the ESP portal URL, sets portal mode, and verifies the controller with `STATUS`.

See [docs/ESP_FLASHING.md](docs/ESP_FLASHING.md) for drivers, recovery steps, and common errors.

## Everyday Commands

| Need | Windows | Linux/macOS |
|---|---|---|
| First setup | `setup-new-pc.bat` | `./install.sh` |
| Start normally | `start-complete-system.bat` | `./start.sh` |
| Stop and remove autostart | `stop-complete-system.bat` | `./stop-complete-system.sh` |
| Enable boot recovery | Run `start-complete-system.bat` once | `./start-complete-system.sh` |
| Update project packages | `powershell -ExecutionPolicy Bypass -File .\\scripts\\update.ps1` | `./update.sh` |
| Flash ESP32 | `ONE-CLICK-FLASH-ESP32.bat` | `./ONE-CLICK-FLASH-ESP32.sh` |
| View MongoDB health | `docker compose ps` | `docker compose ps` |

## Troubleshooting

| Problem | What to do |
|---|---|
| Browser cannot open the app | Confirm `./start.sh` is still running and open `http://localhost:3000`. |
| Port 3000 is already in use | Stop the other Node.js app using port 3000, or change `PORT` in `public/.env`. |
| MongoDB connection error | Start Docker, run `docker compose up -d mongodb`, then check `docker compose logs mongodb`. |
| `permission denied: ./start.sh` | Run `chmod +x start.sh` once. |
| Linux says `docker: permission denied` | Run `sudo usermod -aG docker "$USER"`, sign out/in, and run `docker info`. |
| ESP flasher cannot find a device | Reconnect the ESP USB cable, close serial monitors, then run the one-click launcher again. On Linux, try `ESP_PORT=/dev/ttyUSB0 ./ONE-CLICK-FLASH-ESP32.sh`. |
| ESP serial permission error on Linux | Add the user to the appropriate serial group, normally `sudo usermod -aG dialout "$USER"`, then sign out/in. |

## Usage

1. Start Docker if you use the bundled MongoDB database.
2. Start the app with `./start.sh` or `scripts/start.ps1`. When Docker is available, the launcher starts MongoDB automatically.
3. Visit `/admin` and log in.
4. Add users, keys, lockers, and hardware lock numbers.
5. Generate QR codes.
6. Scan QR codes from `/scan`.
7. If ESP integration is enabled, the mapped hardware lock triggers before the transaction is completed.

## Screenshots

Add screenshots to `docs/screenshots/` and list them in [docs/screenshots/README.md](docs/screenshots/README.md).

Suggested screenshots:

- Login page
- Admin dashboard
- Key management
- QR scanner
- ESP controller status

## GitHub Publishing

Before pushing, confirm that `public/.env`, certificates, logs, `node_modules`, and ESP build outputs are ignored.

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

Recommended repository topics:

```text
nodejs mongodb express qr-code esp32 key-management locker-system campus-project
```

## Documentation

- [Quick Start](QUICK_START.md)
- [Installation Guide](INSTALLATION.md)
- [Windows Setup](docs/WINDOWS_SETUP.md)
- [Linux Setup](docs/LINUX_SETUP.md)
- [macOS Setup](docs/MACOS_SETUP.md)
- [ESP Flashing Guide](docs/ESP_FLASHING.md)
- [GitHub Publishing Guide](docs/GITHUB_PUBLISHING.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [FAQ](FAQ.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Security Notice

Do not commit real secrets. Keep these out of Git:

- `public/.env`
- WiFi passwords
- SMTP passwords
- JWT secrets
- MongoDB credentials
- certificates and private keys
- Cloudflare tokens

Use `public/.env.example` as the public template.

## License

This project is released under the MIT License. See [LICENSE](LICENSE).

## Credits

Built for a BatStateU key borrowing and locker control workflow using Node.js, Express, MongoDB, QR codes, and ESP32 firmware.
