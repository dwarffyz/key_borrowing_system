# Security Policy

## Supported Versions

This repository currently documents security fixes for the latest `main` branch.

## Reporting a Vulnerability

If you find a vulnerability, do not open a public issue with exploit details. Contact the maintainer privately or use GitHub private vulnerability reporting if enabled.

## Secrets Policy

Never commit:

- `public/.env`
- WiFi passwords
- SMTP credentials
- JWT or session secrets
- MongoDB credentials
- private certificates or keys
- Cloudflare tunnel tokens
- production admin passwords

Use `public/.env.example` for documentation.

## Production Checklist

- Change default admin credentials.
- Use a long random `JWT_SECRET`.
- Use strong MongoDB authentication.
- Restrict CORS to trusted origins.
- Enable HTTPS for public access.
- Review Cloudflare Tunnel access settings.
- Keep ESP controller access limited to trusted networks.

