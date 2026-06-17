# Troubleshooting

## App Will Not Start

Run:

```bash
node -v
npm -v
npm install
cd public && npm install
```

Make sure Node.js is version 16 or newer.

## MongoDB Connection Failed

Check `public/.env`:

```env
MONGODB_URI=mongodb://localhost:27017/key_borrowing_system
```

Start MongoDB:

```bash
sudo systemctl start mongod
```

Windows:

```powershell
Get-Service MongoDB
Start-Service MongoDB
```

## Login Does Not Work

Confirm these values in `public/.env`:

```env
ADMIN_USERNAME=CPETadmin
ADMIN_PASSWORD=change-this-admin-password
JWT_SECRET=change-this-to-a-long-random-secret
```

Restart the server after editing `.env`.

## Camera Scan Does Not Work

Modern browsers require HTTPS for camera access except on localhost. Use:

- `http://localhost:3000/scan` on the same computer
- local HTTPS mode
- Cloudflare Tunnel
- the upload QR photo fallback

## ESP Controller Is Offline

Check:

```bash
curl http://192.168.4.1/status
```

Then confirm:

```env
LOCKER_CONTROLLER_ENABLED=true
LOCKER_CONTROLLER_BASE_URL=http://192.168.4.1
LOCKER_CONTROLLER_SERIAL_ENABLED=true
```

If using USB fallback, confirm the serial port in `public/.env`.

## Linux Serial Permission Error

```bash
sudo usermod -aG dialout,uucp $USER
```

Log out and log back in.

## ESP Flash Fails

See [docs/ESP_FLASHING.md](docs/ESP_FLASHING.md).

