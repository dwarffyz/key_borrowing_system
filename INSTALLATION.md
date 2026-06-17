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

The Windows setup checks or installs Node.js, installs npm packages, checks MongoDB, auto-detects ESP serial ports, and writes setup summaries into `.tools/`.

## Linux Setup

### Ubuntu, Debian, Kali

```bash
sudo apt update
sudo apt install -y curl git ca-certificates nodejs npm python3 python3-pip python3-venv build-essential
chmod +x install.sh start.sh update.sh uninstall.sh flash-esp.sh
./install.sh
./start.sh
```

Install MongoDB Community Server from MongoDB's official packages if your distribution does not provide it.

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

Use MongoDB Community Server, MongoDB Atlas, or Homebrew MongoDB services depending on your local setup.

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

