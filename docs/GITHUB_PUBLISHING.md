# GitHub Publishing Guide

Use this guide when you are ready to upload the project to GitHub.

## 1. Review Secrets

Do not push:

- `public/.env`
- WiFi passwords
- SMTP passwords
- MongoDB passwords
- JWT secrets
- certificates and private keys
- `node_modules`
- ESP-IDF build output
- `.tools` runtime logs

This repository includes `.gitignore` rules for those files. Still review before pushing.

## 2. Create the Repository on GitHub

Create a new empty repository on GitHub. Do not initialize it with a README if this local repo already has one.

## 3. Initialize and Push

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

Replace `USERNAME` and `REPOSITORY`.

## 4. Repository Settings

Recommended description:

```text
QR-based key borrowing and ESP32 locker control system built with Node.js, MongoDB, and ESP-IDF.
```

Recommended topics:

```text
nodejs mongodb express qr-code esp32 esp-idf key-management locker-system campus-project
```

## 5. First Release

1. Go to GitHub Releases.
2. Click `Draft a new release`.
3. Tag version: `v1.0.0`.
4. Title: `Key Borrowing System v1.0.0`.
5. Use `.github/RELEASE_TEMPLATE.md`.

