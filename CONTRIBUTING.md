# Contributing

Thank you for improving this project.

## Local Development

```bash
./install.sh
./start.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

## Pull Request Checklist

- Keep `public/.env`, certificates, logs, and build outputs out of Git.
- Match the existing Node.js, Express, and frontend style.
- Test login, admin pages, QR generation, and QR scanning when changing app behavior.
- Test ESP status/unlock when changing locker controller behavior.
- Update docs when setup, environment variables, or hardware steps change.

## Commit Style

Use clear messages:

```text
Add ESP flash verification guide
Fix QR scan transaction status
Update Linux setup instructions
```

