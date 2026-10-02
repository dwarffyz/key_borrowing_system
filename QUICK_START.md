# Quick Start

## Windows

Install and open Docker Desktop first. MongoDB will run in Docker; the web app and ESP32 integration still run normally on Windows.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

Alternative CMD flow:

```bat
setup-new-pc.bat
start-complete-system.bat
```

## Linux

Install Docker Engine with Docker Compose v2 first.

```bash
chmod +x install.sh start.sh flash-esp.sh
./install.sh
./start.sh
```

## ESP32 Flash

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\flash-esp.ps1 -InstallIfMissing -InstallDrivers
```

Linux/macOS:

```bash
./flash-esp.sh --ssid "Your WiFi" --password "Your Password"
```

## Open the App

```text
http://localhost:3000
http://localhost:3000/admin
```

Change `public/.env` before real deployment.
