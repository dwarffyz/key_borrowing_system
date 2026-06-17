# Windows Setup

## Automatic Installer

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

## One-Click Launch

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

CMD alternatives:

```bat
setup-new-pc.bat
start-complete-system.bat
```

## ESP Flash

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\flash-esp.ps1 -InstallIfMissing -InstallDrivers
```

## Manual Dependency Checklist

- Node.js LTS
- MongoDB Community Server
- Git
- ESP-IDF for ESP flashing
- CP210x or CH340 driver if your board needs it

