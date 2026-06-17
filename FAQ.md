# FAQ

## Can this run on Windows and Linux?

Yes. Windows uses PowerShell scripts. Linux uses `install.sh`, `start.sh`, `update.sh`, `uninstall.sh`, and `flash-esp.sh`.

## Is macOS supported?

Yes for the Node.js app and ESP flashing, assuming MongoDB and ESP-IDF are installed.

## Does the ESP32 host the full website?

No. The full website runs on the computer/server. The ESP32 controls locks and provides a portal page that can point phones to the app URL.

## What is the default ESP WiFi?

The firmware uses:

```text
SSID: LockerSystem
Password: 12345678
IP: 192.168.4.1
```

## Can I use MongoDB Atlas?

Yes. Set `MONGODB_URI` in `public/.env` to your Atlas connection string.

## Should I commit public/.env?

No. Commit `public/.env.example` only.

## How do I publish to GitHub?

Use the GitHub Publishing section in [README.md](README.md).

