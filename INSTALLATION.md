# Installation Guide

## Project Layout

| Path | Purpose |
|---|---|
| `public/` | Node.js web application |
| `public/server/server.js` | Express server entry point |
| `hardware/esp32-locker-controller/` | ESP-IDF firmware project |
| `install.sh`, `start.sh` | Linux/macOS setup and launch |
| `scripts/*.ps1` | Windows setup, launch, update, flash helpers |

## Windows Setup

### PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

### CMD

```bat
setup-new-pc.bat
start-complete-system.bat
```

The Windows setup checks Node.js, installs npm packages, installs Docker Desktop with `winget` when missing, starts the bundled MongoDB Docker container, auto-detects ESP serial ports, and writes setup summaries into `.tools/`. Docker Desktop may show a first-run agreement or require a restart; complete that prompt and run setup again if requested.

## Linux Setup

### Ubuntu, Debian, Kali

```bash
sudo apt update
sudo apt install -y curl git ca-certificates nodejs npm python3 python3-pip python3-venv build-essential
chmod +x install.sh start.sh update.sh uninstall.sh flash-esp.sh
./install.sh
./start.sh
```

Install Docker Engine and the Docker Compose v2 plugin. The installer starts the bundled MongoDB container automatically. MongoDB Atlas remains supported if you prefer a managed database.

### Arch Linux

```bash
sudo pacman -Sy --needed curl git nodejs npm python python-pip base-devel
chmod +x install.sh start.sh update.sh uninstall.sh flash-esp.sh
./install.sh
./start.sh
```

### Fedora

```bash
sudo dnf install -y curl git nodejs npm python3 python3-pip gcc gcc-c++ make
chmod +x install.sh start.sh update.sh uninstall.sh flash-esp.sh
./install.sh
./start.sh
```

## macOS Setup

```bash
brew install node python git
chmod +x install.sh start.sh flash-esp.sh
SKIP_SYSTEM_PACKAGES=1 ./install.sh
./start.sh
```

Install and start Docker Desktop. MongoDB Atlas is also supported if you prefer a managed database.

## Environment Configuration

The installer creates `public/.env` from `public/.env.example` when missing.

Minimum local settings:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/key_borrowing_system
JWT_SECRET=change-this-to-a-long-random-secret
ADMIN_USERNAME=CPETadmin
ADMIN_PASSWORD=change-this-admin-password
LOCKER_CONTROLLER_BASE_URL=http://192.168.4.1
```

## Dependency Installation

Manual npm install:

```bash
npm install
cd public
npm install
```

## One-Click Launch

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

Linux/macOS:

```bash
./start.sh
```

## Update

```bash
./update.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1
```

## Uninstall Local Runtime Files

```bash
./uninstall.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

This removes installed packages and local logs only. It keeps `public/.env` and MongoDB data for safety.

## Docker MongoDB

MongoDB is defined in the repository's `docker-compose.yml` and persists its data in the named Docker volumes `key-borrowing-mongodb-data` and `key-borrowing-mongodb-config`.

```bash
docker compose ps
docker compose logs -f mongodb
docker compose stop mongodb
docker compose up -d mongodb
```

The database port is bound to `127.0.0.1:27017`, so it is not exposed to other devices on the network. Do not use `docker compose down -v` unless you intentionally want to delete all database data.
