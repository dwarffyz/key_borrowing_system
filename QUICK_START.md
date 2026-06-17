# Quick Start

## Windows

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

