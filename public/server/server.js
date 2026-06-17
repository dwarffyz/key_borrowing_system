const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const path = require('path');
const { execFile } = require('child_process');

let nodemailer = null;
try {
    // Optional dependency (used for password reset emails)
    nodemailer = require('nodemailer');
} catch (error) {
    nodemailer = null;
}

// Load environment variables (always relative to public/.env)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_ADMIN = {
    username: process.env.ADMIN_USERNAME || 'CPETadmin',
    password: process.env.ADMIN_PASSWORD || 'admin123!',
    email: process.env.ADMIN_EMAIL || 'admin@batstateu.edu.ph',
    fullName: process.env.ADMIN_FULL_NAME || 'System Administrator'
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const envFlag = (value, defaultValue = false) => {
    if (value === undefined) return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return defaultValue;
};

const clampInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    const num = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(Math.max(num, min), max);
};

const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();
const DEFAULT_ADMIN_USERNAME_NORM = normalizeIdentity(DEFAULT_ADMIN.username);
const DEFAULT_ADMIN_EMAIL_NORM = normalizeIdentity(DEFAULT_ADMIN.email);

const isDefaultAdminAccount = (admin) => {
    if (!admin) return false;
    if (admin.isDefault === true) return true;
    const username = normalizeIdentity(admin.username);
    const email = normalizeIdentity(admin.email);
    return (DEFAULT_ADMIN_USERNAME_NORM && username === DEFAULT_ADMIN_USERNAME_NORM)
        || (DEFAULT_ADMIN_EMAIL_NORM && email === DEFAULT_ADMIN_EMAIL_NORM);
};

const canManageAdminAccounts = (admin) => {
    if (!admin) return false;
    return admin.role === 'super_admin' || admin.permissions?.manageAdmins === true;
};

const canManageUserAccounts = (admin) => {
    if (!admin) return false;
    return admin.role === 'super_admin' || admin.permissions?.manageUsers === true;
};

const deriveLockerFromKeyId = (keyId) => {
    const match = /^KEY(\d{3})$/i.exec(String(keyId || '').trim());
    if (!match) return '';
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `Locker ${Math.ceil(num / 15)}`;
};

const normalizeTimezoneOffset = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return { tzOffset: '+00:00', minutes: 0 };

    const upper = raw.toUpperCase();
    if (upper === 'Z' || upper === 'UTC') {
        return { tzOffset: '+00:00', minutes: 0 };
    }

    const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
    if (!match) return { tzOffset: '+00:00', minutes: 0 };

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const mins = Number(match[3] || 0);
    if (!Number.isFinite(hours) || !Number.isFinite(mins) || hours > 14 || mins > 59) {
        return { tzOffset: '+00:00', minutes: 0 };
    }

    const totalMinutes = sign * ((hours * 60) + mins);
    return {
        tzOffset: `${sign === -1 ? '-' : '+'}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
        minutes: totalMinutes
    };
};

const parseLocalDateInput = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    return { year, month, day };
};

const buildUtcDateRangeFilter = ({ from = '', to = '', tzOffset = '' } = {}) => {
    const fromParts = parseLocalDateInput(from);
    const toParts = parseLocalDateInput(to);
    if (!fromParts && !toParts) return null;

    const { minutes } = normalizeTimezoneOffset(tzOffset);
    const range = {};

    if (fromParts) {
        range.$gte = new Date(Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day) - (minutes * 60 * 1000));
    }

    if (toParts) {
        range.$lt = new Date(Date.UTC(toParts.year, toParts.month - 1, toParts.day + 1) - (minutes * 60 * 1000));
    }

    return Object.keys(range).length ? range : null;
};

const buildPerformedAtQuery = (range) => {
    if (!range) return null;
    return {
        $or: [
            { performedAt: range },
            {
                performedAt: { $exists: false },
                createdAt: range
            }
        ]
    };
};

const getEntityIdString = (value) => {
    if (!value) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (typeof value === 'object') {
        const nested = value._id || value.id;
        return nested ? String(nested).trim() : '';
    }
    return String(value).trim();
};

const normalizeTransactionTimestamp = (value, fallback = new Date()) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return fallback;
};

const getTransactionMoment = (transaction) => normalizeTransactionTimestamp(
    transaction?.performedAt || transaction?.createdAt || transaction?.updatedAt,
    new Date(0)
);

const QR_CODE_NEVER_EXPIRES_AT_ISO = '2099-12-31T23:59:59.999Z';
const QR_PURPOSE_ALIASES = new Map([
    ['borrow', 'borrow'],
    ['return', 'return'],
    ['verification', 'verification'],
    ['unified', 'unified'],
    ['auto', 'unified'],
    ['auto_borrow_return', 'unified'],
    ['auto-borrow-return', 'unified'],
    ['auto borrow return', 'unified'],
    ['single_qr', 'unified'],
    ['single-qr', 'unified'],
    ['single qr', 'unified']
]);

const normalizeQrPurpose = (value, fallback = 'unified') => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    const normalized = raw.replace(/\s+/g, '_');
    return QR_PURPOSE_ALIASES.get(raw) || QR_PURPOSE_ALIASES.get(normalized) || fallback;
};

const getQrCodeExpiryDate = () => new Date(QR_CODE_NEVER_EXPIRES_AT_ISO);

const buildQrPayload = ({ keyId, room, purpose, uniqueId }) => ({
    v: 2,
    type: 'admin-key',
    keyId: String(keyId || '').trim().toUpperCase(),
    room: String(room || '').trim(),
    purpose: normalizeQrPurpose(purpose),
    uniqueId: String(uniqueId || '').trim()
});

const generateQrCodeDataUrl = (payload) => QRCode.toDataURL(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 720,
    color: {
        dark: '#111111',
        light: '#FFFFFFFF'
    }
});

const getKeyQrRoomLabel = (key) => {
    const room = String(key?.room || '').trim();
    if (room) return room;

    const building = String(key?.building || '').trim();
    const locker = String(key?.locker || '').trim();
    const fallback = [building, locker].filter(Boolean).join(' • ');
    return fallback || String(key?.keyId || '').trim().toUpperCase();
};

const ensureUnifiedQrForKey = async ({ key, adminId, roomOverride = '', forceRegenerate = false } = {}) => {
    if (!key) throw new Error('Key is required');

    const keyIdNorm = String(key.keyId || '').trim().toUpperCase();
    const roomNorm = String(roomOverride || getKeyQrRoomLabel(key)).trim();
    const normalizedPurpose = 'unified';

    if (!/^KEY\d{3}$/.test(keyIdNorm)) {
        throw new Error(`Invalid key id for QR export: ${keyIdNorm || 'unknown key'}`);
    }
    if (!roomNorm) {
        throw new Error(`Missing room for ${keyIdNorm}`);
    }

    let qrCode = await QRCodeModel.findOne({
        keyId: keyIdNorm,
        room: roomNorm,
        purpose: normalizedPurpose
    }).sort({ regeneratedAt: -1, createdAt: -1 });

    const isUpdate = Boolean(qrCode);
    const shouldReuseExisting = Boolean(qrCode) && forceRegenerate !== true;

    if (shouldReuseExisting) {
        let needsSave = false;
        let qrData = qrCode.qrData;
        let qrCodeDataUrl = String(qrCode.qrCodeImage || '').trim();

        const hasValidPayload = qrData
            && String(qrData.keyId || '').trim().toUpperCase() === keyIdNorm
            && String(qrData.room || '').trim() === roomNorm
            && normalizeQrPurpose(qrData.purpose, 'unified') === normalizedPurpose
            && String(qrData.uniqueId || '').trim();

        if (!hasValidPayload) {
            qrData = buildQrPayload({
                keyId: keyIdNorm,
                room: roomNorm,
                purpose: normalizedPurpose,
                uniqueId: new mongoose.Types.ObjectId().toString()
            });
            qrCodeDataUrl = await generateQrCodeDataUrl(qrData);
            qrCode.qrData = qrData;
            qrCode.qrCodeImage = qrCodeDataUrl;
            needsSave = true;
        } else if (!qrCodeDataUrl) {
            qrCodeDataUrl = await generateQrCodeDataUrl(qrData);
            qrCode.qrCodeImage = qrCodeDataUrl;
            needsSave = true;
        }

        if (!qrCode.expiresAt || new Date(qrCode.expiresAt).getTime() !== getQrCodeExpiryDate().getTime()) {
            qrCode.expiresAt = getQrCodeExpiryDate();
            needsSave = true;
        }
        if (!qrCode.generatedBy && adminId) {
            qrCode.generatedBy = adminId;
            needsSave = true;
        }
        if (needsSave) {
            await qrCode.save();
        }

        if (String(key.qrCode || '') !== String(qrCode._id)) {
            key.qrCode = qrCode._id;
            await key.save();
        }

        return {
            qrCode,
            qrData,
            qrCodeDataUrl: String(qrCode.qrCodeImage || qrCodeDataUrl || '').trim(),
            room: roomNorm,
            isUpdate
        };
    }

    const qrData = buildQrPayload({
        keyId: keyIdNorm,
        room: roomNorm,
        purpose: normalizedPurpose,
        uniqueId: new mongoose.Types.ObjectId().toString()
    });
    const qrCodeDataUrl = await generateQrCodeDataUrl(qrData);

    if (!qrCode) {
        qrCode = new QRCodeModel({
            keyId: keyIdNorm,
            room: roomNorm,
            purpose: normalizedPurpose,
            qrData,
            qrCodeImage: qrCodeDataUrl,
            generatedBy: adminId,
            expiresAt: getQrCodeExpiryDate()
        });
    } else {
        qrCode.keyId = keyIdNorm;
        qrCode.room = roomNorm;
        qrCode.purpose = normalizedPurpose;
        qrCode.qrData = qrData;
        qrCode.qrCodeImage = qrCodeDataUrl;
        qrCode.used = false;
        qrCode.usedAt = null;
        qrCode.usedBy = null;
        qrCode.expiresAt = getQrCodeExpiryDate();
        qrCode.regeneratedAt = forceRegenerate ? new Date() : qrCode.regeneratedAt;
        qrCode.regeneratedBy = forceRegenerate ? (adminId || null) : qrCode.regeneratedBy;
        if (!qrCode.generatedBy && adminId) {
            qrCode.generatedBy = adminId;
        }
    }

    await qrCode.save();

    await QRCodeModel.updateMany(
        {
            keyId: keyIdNorm,
            room: roomNorm,
            purpose: normalizedPurpose,
            _id: { $ne: qrCode._id }
        },
        { $set: { expiresAt: new Date(0) } }
    );

    if (String(key.qrCode || '') !== String(qrCode._id)) {
        key.qrCode = qrCode._id;
        await key.save();
    }

    return {
        qrCode,
        qrData,
        qrCodeDataUrl,
        room: roomNorm,
        isUpdate
    };
};

const generateUrlQrCodeDataUrl = (value) => QRCode.toDataURL(String(value || '').trim(), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 720,
    color: {
        dark: '#111111',
        light: '#FFFFFFFF'
    }
});

const RESET_TOKEN_EXPIRE_MINUTES = Number(process.env.RESET_TOKEN_EXPIRE_MINUTES || 15);
const EMAIL_VERIFICATION_EXPIRE_MINUTES = Number(process.env.EMAIL_VERIFICATION_EXPIRE_MINUTES || 10);
const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = Number(process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS || 30);
const EMAIL_VERIFICATION_MAX_ATTEMPTS = Number(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS || 6);
const RECAPTCHA_VERIFY_TIMEOUT_MS = Number(process.env.RECAPTCHA_VERIFY_TIMEOUT_MS || 7000);
const RECAPTCHA_ENABLED = envFlag(process.env.RECAPTCHA_ENABLED, false);
const QR_USED_STATUS_WINDOW_SECONDS = clampInt(process.env.QR_USED_STATUS_WINDOW_SECONDS, 30, { min: 0, max: 86_400 });
const REVEAL_PASSWORD_RESET_USER_EXISTS = envFlag(
    process.env.REVEAL_PASSWORD_RESET_USER_EXISTS,
    process.env.NODE_ENV !== 'production'
);

// Basic in-memory rate limiting (no external dependencies).
// Note: This is per-instance. For multi-instance deployments, use a shared store
const RATE_LIMIT_ENABLED = envFlag(process.env.RATE_LIMIT_ENABLED, true);
const RATE_LIMIT_GENERAL_WINDOW_MS = clampInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS, 60_000, { min: 5_000, max: 3_600_000 });
const RATE_LIMIT_GENERAL_MAX = clampInt(process.env.RATE_LIMIT_GENERAL_MAX, 600, { min: 20, max: 100_000 });
const RATE_LIMIT_AUTH_WINDOW_MS = clampInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 10 * 60_000, { min: 5_000, max: 3_600_000 });
const RATE_LIMIT_AUTH_MAX = clampInt(process.env.RATE_LIMIT_AUTH_MAX, 40, { min: 5, max: 10_000 });

const getClientIp = (req) => {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
    if (xff) return xff;
    return String(req.ip || req.connection?.remoteAddress || 'unknown');
};

const createRateLimiter = ({
    windowMs,
    max,
    keyPrefix,
    message
}) => {
    const hits = new Map();
    let sweepCounter = 0;

    return (req, res, next) => {
        try {
            const now = Date.now();
            const ip = getClientIp(req);
            const key = `${String(keyPrefix || 'rl')}:${ip}`;

            const entry = hits.get(key);
            if (!entry || now >= entry.resetAt) {
                hits.set(key, { count: 1, resetAt: now + windowMs });
            } else {
                entry.count += 1;
                if (entry.count > max) {
                    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
                    res.set('Cache-Control', 'no-store');
                    res.set('Retry-After', String(retryAfterSeconds));
                    return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
                }
            }

            sweepCounter += 1;
            // Light sweep to avoid unbounded growth.
            if (sweepCounter % 250 === 0 && hits.size > 2000) {
                for (const [k, v] of hits.entries()) {
                    if (!v || now >= v.resetAt) hits.delete(k);
                }
            }
        } catch (error) {
            console.error('Rate limiter error:', error);
            // Fail open.
        }
        next();
    };
};

const authRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_AUTH_WINDOW_MS,
    max: RATE_LIMIT_AUTH_MAX,
    keyPrefix: 'auth',
    message: 'Too many auth requests. Please wait and try again.'
});

const apiRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_GENERAL_WINDOW_MS,
    max: RATE_LIMIT_GENERAL_MAX,
    keyPrefix: 'api',
    message: 'Too many requests. Please slow down.'
});

const verifyRecaptchaToken = ({ token, remoteIp }) => new Promise((resolve) => {
    const secret = process.env.RECAPTCHA_SECRET_KEY || process.env.RECAPTCHA_SECRET;

    if (!secret) {
        return resolve({ success: false, 'error-codes': ['missing-input-secret'] });
    }

    const payload = new URLSearchParams({
        secret,
        response: String(token || ''),
        ...(remoteIp ? { remoteip: String(remoteIp) } : {})
    }).toString();

    const req = https.request(
        'https://www.google.com/recaptcha/api/siteverify',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: RECAPTCHA_VERIFY_TIMEOUT_MS
        },
        (res) => {
            let raw = '';
            res.on('data', (chunk) => {
                raw += chunk;
            });
            res.on('end', () => {
                try {
                    const json = JSON.parse(raw);
                    resolve(json);
                } catch {
                    resolve({ success: false, 'error-codes': ['invalid-json'] });
                }
            });
        }
    );

    req.on('timeout', () => {
        req.destroy(new Error('reCAPTCHA verify request timed out'));
    });

    req.on('error', () => {
        resolve({ success: false, 'error-codes': ['network-error'] });
    });

    req.write(payload);
    req.end();
});

const requireRecaptcha = async (req, res, next) => {
    try {
        if (!RECAPTCHA_ENABLED) {
            return next();
        }

        const secret = process.env.RECAPTCHA_SECRET_KEY || process.env.RECAPTCHA_SECRET;
        if (!secret) {
            console.error('❌ RECAPTCHA_SECRET_KEY is missing in .env');
            return res.status(500).json({ error: 'reCAPTCHA is not configured' });
        }

        const token = String(req.body?.recaptchaToken || '').trim();
        if (!token) {
            return res.status(400).json({ error: 'Please complete the reCAPTCHA verification.' });
        }

        const result = await verifyRecaptchaToken({ token, remoteIp: req.ip });
        if (!result || result.success !== true) {
            const codes = Array.isArray(result?.['error-codes']) ? result['error-codes'] : [];
            const isDuplicate = codes.includes('timeout-or-duplicate');
            const isInvalid = codes.includes('invalid-input-response');
            const message = isDuplicate || isInvalid
                ? 'Please complete the reCAPTCHA again, then try again.'
                : 'reCAPTCHA verification failed. Please try again.';
            return res.status(400).json({ error: message });
        }

        next();
    } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        res.status(500).json({ error: 'reCAPTCHA verification failed' });
    }
};

const createMailTransporter = () => {
    if (!nodemailer) return null;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return null;
    const service = process.env.SMTP_SERVICE || 'gmail';
    return nodemailer.createTransport({
        service,
        auth: { user, pass }
    });
};

const mailTransporter = createMailTransporter();

const getRequestProtocol = (req) => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return forwardedProto || req.protocol;
};

const isLocalAppBaseUrl = (value) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(value || '').trim());

const getPreferredLocalIpAddress = () => {
    const ignoredInterfacePattern = /virtual|vmware|virtualbox|hyper-v|vethernet|wireguard|loopback|bluetooth/i;
    const preferRouterNetwork = Boolean(String(process.env.ESP_STA_SSID || '').trim());
    const preferred = [];
    const others = [];

    for (const [name, entries] of Object.entries(os.networkInterfaces() || {})) {
        if (ignoredInterfacePattern.test(String(name || ''))) continue;

        for (const entry of entries || []) {
            const address = String(entry?.address || '').trim();
            if (!address || entry?.internal || entry?.family !== 'IPv4') continue;
            if (address.startsWith('127.') || address.startsWith('169.254.')) continue;
            if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) continue;

            const isPrivate = /^10\./.test(address)
                || /^192\.168\./.test(address)
                || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
            if (!isPrivate) continue;

            if (!preferRouterNetwork && address.startsWith('192.168.4.')) {
                preferred.push(address);
            } else if (preferRouterNetwork && !address.startsWith('192.168.4.')) {
                preferred.push(address);
            } else {
                others.push(address);
            }
        }
    }

    return preferred[0] || others[0] || '';
};

const getLocalNetworkAppBaseUrl = () => {
    const ip = getPreferredLocalIpAddress();
    return ip ? `http://${ip}:${HTTP_PORT}` : '';
};

const getAppBaseUrl = (req) => {
    const requestBase = `${getRequestProtocol(req)}://${req.get('host')}`;
    const envBaseRaw = String(process.env.APP_BASE_URL || '').trim();
    const strip = (value) => String(value || '').replace(/\/+$/, '');

    if (!envBaseRaw) return strip(requestBase);

    const envBase = strip(envBaseRaw);
    const envLooksLocal = isLocalAppBaseUrl(envBase);
    if (!envLooksLocal) return envBase;

    // If APP_BASE_URL points to localhost but the request is coming from a public host (e.g. Cloudflare Tunnel),
    // prefer the request host so email links work for external testers.
    const host = String(req.get('host') || '').toLowerCase();
    const requestLooksLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    if (!requestLooksLocal) return strip(requestBase);

    // Approvals are often done from the laptop at localhost. Email recipients are usually on phones,
    // where localhost points to the phone itself, so prefer the detected LAN URL when available.
    return getLocalNetworkAppBaseUrl() || envBase;
};

const HTTP_PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const PUBLIC_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(__dirname, '..', '..');

const resolveConfiguredPath = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw);
};

const localHttpsState = {
    enabled: envFlag(process.env.HTTPS_ENABLED, false),
    active: false,
    port: HTTPS_PORT,
    error: ''
};

const buildLocalHttpsOptions = () => {
    if (!localHttpsState.enabled) return null;

    const pfxFile = resolveConfiguredPath(process.env.HTTPS_PFX_FILE);
    if (pfxFile) {
        if (!fs.existsSync(pfxFile)) {
            throw new Error(`HTTPS PFX file was not found: ${pfxFile}`);
        }
        return {
            pfx: fs.readFileSync(pfxFile),
            passphrase: process.env.HTTPS_PFX_PASSWORD || undefined
        };
    }

    const certFile = resolveConfiguredPath(process.env.HTTPS_CERT_FILE);
    const keyFile = resolveConfiguredPath(process.env.HTTPS_KEY_FILE);
    if (certFile && keyFile) {
        if (!fs.existsSync(certFile)) {
            throw new Error(`HTTPS certificate file was not found: ${certFile}`);
        }
        if (!fs.existsSync(keyFile)) {
            throw new Error(`HTTPS key file was not found: ${keyFile}`);
        }
        return {
            cert: fs.readFileSync(certFile),
            key: fs.readFileSync(keyFile)
        };
    }

    throw new Error('HTTPS is enabled, but no HTTPS_PFX_FILE or HTTPS_CERT_FILE/HTTPS_KEY_FILE is configured.');
};

const buildHttpsUrlForRequest = (req, routePath = '/') => {
    const hostHeader = String(req.get('host') || '').trim();
    const hostname = (hostHeader.split(':')[0] || 'localhost').replace(/^\[|\]$/g, '');
    const bracketedHost = hostname.includes(':') ? `[${hostname}]` : hostname;
    const suffix = routePath.startsWith('/') ? routePath : `/${routePath}`;
    return `https://${bracketedHost}:${localHttpsState.port}${suffix}`;
};

const getRepoRootCandidates = () => {
    const candidates = [
        REPO_ROOT,
        path.resolve(__dirname, '..', '..'),
        process.cwd(),
        path.resolve(process.cwd(), '..')
    ];

    const seen = new Set();
    return candidates
        .map((candidate) => {
            try {
                return path.resolve(candidate);
            } catch {
                return '';
            }
        })
        .filter((candidate) => candidate && !seen.has(candidate) && seen.add(candidate));
};

const readCloudflareTunnelState = () => {
    try {
        for (const root of getRepoRootCandidates()) {
            const statePath = path.join(root, '.tools', 'cloudflare-tunnel-state.json');
            if (!fs.existsSync(statePath)) continue;
            const raw = fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, '');
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.active !== true) continue;
            const publicUrl = String(parsed.publicUrl || '').trim();
            if (!publicUrl) continue;
            return {
                active: true,
                publicUrl,
                updatedAt: parsed.updatedAt || null,
                sourcePath: statePath
            };
        }
        return null;
    } catch {
        return null;
    }
};

const readLocalSystemUrls = () => {
    try {
        for (const root of getRepoRootCandidates()) {
            const urlsPath = path.join(root, '.tools', 'local-system-urls.txt');
            if (!fs.existsSync(urlsPath)) continue;
            return fs.readFileSync(urlsPath, 'utf8')
                .split(/\r?\n/)
                .map((line) => String(line || '').trim())
                .filter(Boolean);
        }
        return [];
    } catch {
        return [];
    }
};

const isPrivateNetworkHost = (hostname = '') => /^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/i.test(String(hostname || '').trim());

const selectPreferredEspPortalUrl = ({ urls = [], fallbackUrl = '' } = {}) => {
    const candidates = Array.isArray(urls) ? urls : [];

    const findMatchingUrl = (protocol) => candidates.find((value) => {
        const raw = String(value || '').trim();
        if (!raw) return false;

        try {
            const parsed = new URL(raw);
            return parsed.protocol === `${protocol}:` && isPrivateNetworkHost(parsed.hostname);
        } catch {
            return false;
        }
    });

    return (
        findMatchingUrl('http')
        || findMatchingUrl('https')
        || String(fallbackUrl || '').trim()
    );
};

// Initialize Express
const app = express();
// Ensure req.protocol respects X-Forwarded-Proto when behind Cloudflare Tunnel / reverse proxies.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
}));
// NOTE: reCAPTCHA (and other third-party scripts like Chart.js CDN) can be blocked by strict security headers.
// Keep Helmet enabled, but disable CSP/COEP so external scripts/iframes can load.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (RATE_LIMIT_ENABLED) {
    app.use('/api/auth', authRateLimiter);
    app.use('/api', apiRateLimiter);
}

// Serve static files
// server.js is in public/server, so the public root is one level up
app.use(express.static(PUBLIC_ROOT, { dotfiles: 'deny' }));

app.get('/api/system/runtime-config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        runtime: {
            appName: process.env.APP_NAME || 'BatStateU Key Borrowing Platform',
            appVersion: process.env.APP_VERSION || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            baseUrl: getAppBaseUrl(req),
            http: {
                port: HTTP_PORT
            },
            localHttps: {
                enabled: localHttpsState.enabled,
                active: localHttpsState.active,
                port: localHttpsState.port,
                scannerUrl: localHttpsState.active ? buildHttpsUrlForRequest(req, '/scan') : '',
                error: localHttpsState.error
            }
        }
    });
});

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/key_borrowing_system', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Import Models
const User = require('./models/User');
const Key = require('./models/Key');
const Locker = require('./models/Locker');
const Transaction = require('./models/Transaction');
const QRCodeModel = require('./models/QRCode');
const Admin = require('./models/Admin');
const ActivityLog = require('./models/ActivityLog');
const Feedback = require('./models/Feedback');
const Announcement = require('./models/Announcement');
const Maintenance = require('./models/Maintenance');
const LostReport = require('./models/LostReport');

const LOCKER_CONTROLLER_ENABLED = envFlag(process.env.LOCKER_CONTROLLER_ENABLED, true);
const LOCKER_CONTROLLER_REQUIRED = envFlag(process.env.LOCKER_CONTROLLER_REQUIRED, true);
const LOCKER_CONTROLLER_TIMEOUT_MS = clampInt(process.env.LOCKER_CONTROLLER_TIMEOUT_MS, 3000, { min: 500, max: 15000 });
const LOCKER_CONTROLLER_STATUS_ATTEMPTS = clampInt(process.env.LOCKER_CONTROLLER_STATUS_ATTEMPTS, 1, { min: 1, max: 5 });
const LOCKER_CONTROLLER_UNLOCK_ATTEMPTS = clampInt(process.env.LOCKER_CONTROLLER_UNLOCK_ATTEMPTS, 2, { min: 1, max: 5 });
const LOCKER_CONTROLLER_MAX_LOCKS = clampInt(process.env.LOCKER_CONTROLLER_MAX_LOCKS, 32, { min: 1, max: 256 });
const LOCKER_CONTROLLER_SERIAL_ENABLED = envFlag(process.env.LOCKER_CONTROLLER_SERIAL_ENABLED, true);
const LOCKER_CONTROLLER_SERIAL_AUTO_DETECT = envFlag(process.env.LOCKER_CONTROLLER_SERIAL_AUTO_DETECT, true);
const LOCKER_CONTROLLER_SERIAL_TIMEOUT_MS = clampInt(process.env.LOCKER_CONTROLLER_SERIAL_TIMEOUT_MS, 4500, { min: 1000, max: 15000 });
const LOCKER_CONTROLLER_TRIGGER_ON = String(process.env.LOCKER_CONTROLLER_TRIGGER_ON || 'all').trim().toLowerCase();
const LOCKER_CONTROLLER_SSID_HINT = String(process.env.LOCKER_CONTROLLER_SSID_HINT || 'LockerSystem').trim();
const LOCKER_CONTROLLER_IP_HINT = String(process.env.LOCKER_CONTROLLER_IP_HINT || '192.168.4.1').trim();

const normalizeControllerBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const getLockerControllerBaseUrls = () => {
    const urls = [];
    const seen = new Set();
    const add = (value) => {
        const normalized = normalizeControllerBaseUrl(value);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        urls.push(normalized);
    };

    add(process.env.LOCKER_CONTROLLER_BASE_URL || 'http://192.168.4.1');
    String(process.env.LOCKER_CONTROLLER_BASE_URLS || '')
        .split(',')
        .forEach(add);
    return urls;
};

const buildControllerUrl = (baseUrl, routePath, params = {}) => {
    const url = new URL(routePath.startsWith('/') ? routePath : `/${routePath}`, `${baseUrl}/`);
    for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
};

const requestControllerJson = (url, timeoutMs = LOCKER_CONTROLLER_TIMEOUT_MS) => new Promise((resolve, reject) => {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        reject(new Error('Invalid controller URL'));
        return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
        method: 'GET',
        timeout: timeoutMs,
        headers: { Accept: 'application/json,text/plain,*/*' }
    }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 8192) req.destroy(new Error('Controller response too large'));
        });
        response.on('end', () => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                resolve({ success: true, raw });
            }
        });
    });

    req.on('timeout', () => req.destroy(new Error('Controller request timed out')));
    req.on('error', reject);
    req.end();
});

const requestControllerText = (url, timeoutMs = LOCKER_CONTROLLER_TIMEOUT_MS) => new Promise((resolve, reject) => {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        reject(new Error('Invalid controller URL'));
        return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, { method: 'GET', timeout: timeoutMs }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            resolve(raw);
        });
    });

    req.on('timeout', () => req.destroy(new Error('Controller request timed out')));
    req.on('error', reject);
    req.end();
});

const parseSerialStatusLine = (line) => {
    const raw = String(line || '').trim();
    const statusLine = raw.split(/\r?\n/).find((entry) => /^SERIAL_STATUS\b/.test(entry.trim())) || raw;
    const values = {};
    const pattern = /([A-Z_]+)=([^\s]*)/g;
    let match;
    while ((match = pattern.exec(statusLine)) !== null) {
        values[match[1]] = match[2] || '';
    }
    return {
        raw: statusLine,
        ssid: values.SSID || LOCKER_CONTROLLER_SSID_HINT,
        ip: values.IP || LOCKER_CONTROLLER_IP_HINT,
        locks: clampInt(values.LOCKS, LOCKER_CONTROLLER_MAX_LOCKS, { min: 1, max: 256 }),
        portalTargetUrl: values.URL || '',
        staSsid: values.STA_SSID || '',
        staConnected: values.STA_CONNECTED === '1',
        staIp: values.STA_IP || '',
        internetPassthroughActive: values.NAT === '1',
        portalGateActive: values.GATE === '1',
        portalMode: values.PORTAL_MODE || ''
    };
};

const execPowerShell = (script, timeoutMs = 7000) => new Promise((resolve, reject) => {
    execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024
        },
        (error, stdout, stderr) => {
            if (error) {
                const message = String(stderr || stdout || error.message || '').trim();
                reject(new Error(message || error.message));
                return;
            }
            resolve(String(stdout || '').trim());
        }
    );
});

const psQuote = (value) => `'${String(value || '').replace(/'/g, "''")}'`;

const getConfiguredSerialPorts = () => {
    const ports = [];
    const seen = new Set();
    const add = (value) => {
        const port = String(value || '').trim().toUpperCase();
        if (!/^COM\d+$/i.test(port) || seen.has(port)) return;
        seen.add(port);
        ports.push(port);
    };

    add(process.env.LOCKER_CONTROLLER_SERIAL_PORT || 'COM3');
    String(process.env.LOCKER_CONTROLLER_SERIAL_PORTS || '')
        .split(',')
        .forEach(add);
    return ports;
};

let serialPortCandidateCache = {
    loadedAt: 0,
    ports: []
};

const detectSerialPorts = async () => {
    if (!LOCKER_CONTROLLER_SERIAL_AUTO_DETECT) return [];

    const script = `
$ports = @()
try {
    $devices = Get-PnpDevice -PresentOnly -Class Ports -ErrorAction SilentlyContinue
    foreach ($device in $devices) {
        $name = [string]$device.FriendlyName
        if ($name -match '(?i)(CH340|CP210|USB Serial|UART|Silicon Labs|Espressif|ESP32)' -and $name -match '\\((COM\\d+)\\)') {
            $ports += $matches[1]
        }
    }
} catch {}
try {
    $ports += [System.IO.Ports.SerialPort]::GetPortNames()
} catch {}
$ports | Where-Object { $_ -match '^COM\\d+$' } | Select-Object -Unique
`;

    try {
        const output = await execPowerShell(script, 5000);
        return output
            .split(/\r?\n/)
            .map((line) => line.trim().toUpperCase())
            .filter((line) => /^COM\d+$/.test(line));
    } catch {
        return [];
    }
};

const getSerialPortCandidates = async () => {
    const now = Date.now();
    if (serialPortCandidateCache.ports.length > 0 && (now - serialPortCandidateCache.loadedAt) < 15000) {
        return serialPortCandidateCache.ports;
    }

    const candidates = [];
    const seen = new Set();
    const add = (value) => {
        const port = String(value || '').trim().toUpperCase();
        if (!/^COM\d+$/.test(port) || seen.has(port)) return;
        seen.add(port);
        candidates.push(port);
    };

    const detectedPorts = await detectSerialPorts();
    const detectedSet = new Set(detectedPorts);
    if (detectedPorts.length > 0) {
        detectedPorts.forEach(add);
        getConfiguredSerialPorts()
            .filter((port) => detectedSet.has(port))
            .forEach(add);
    } else {
        getConfiguredSerialPorts().forEach(add);
    }
    serialPortCandidateCache = {
        loadedAt: Date.now(),
        ports: candidates
    };
    return candidates;
};

const runSerialCommand = async (portName, command, timeoutMs = LOCKER_CONTROLLER_SERIAL_TIMEOUT_MS) => {
    const safeTimeout = Math.max(1000, Number(timeoutMs) || LOCKER_CONTROLLER_SERIAL_TIMEOUT_MS);
    const script = `
$ErrorActionPreference = 'Stop'
$portName = ${psQuote(portName)}
$command = ${psQuote(command)}
$timeoutMs = ${safeTimeout}
$serial = New-Object System.IO.Ports.SerialPort $portName,115200,'None',8,'One'
$serial.ReadTimeout = 200
$serial.WriteTimeout = 1000
$serial.DtrEnable = $false
$serial.RtsEnable = $false
$serial.Open()
try {
    Start-Sleep -Milliseconds 180
    try { $serial.DiscardInBuffer() } catch {}
    $serial.WriteLine($command)
    $deadline = (Get-Date).AddMilliseconds($timeoutMs)
    $lines = New-Object System.Collections.Generic.List[string]
    while ((Get-Date) -lt $deadline) {
        try {
            $line = $serial.ReadLine()
            if ($null -ne $line) {
                $trimmed = $line.Trim()
                if ($trimmed) {
                    $lines.Add($trimmed) | Out-Null
                    if ($trimmed -match '^SERIAL_(OK|STATUS|ERROR)') { break }
                }
            }
        } catch [System.TimeoutException] {}
    }
    $lines -join [Environment]::NewLine
} finally {
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
}
`;

    return execPowerShell(script, safeTimeout + 2500);
};

const querySerialControllerStatus = async () => {
    if (!LOCKER_CONTROLLER_SERIAL_ENABLED) {
        return { connected: false, reason: 'serial_disabled', message: 'USB serial fallback is disabled.' };
    }

    const ports = await getSerialPortCandidates();
    let lastError = null;
    for (const port of ports) {
        try {
            const output = await runSerialCommand(port, 'STATUS');
            if (/SERIAL_STATUS\b/.test(output)) {
                return {
                    connected: true,
                    port,
                    status: parseSerialStatusLine(output),
                    raw: output
                };
            }
            lastError = new Error(output || `No STATUS reply on ${port}`);
        } catch (error) {
            lastError = error;
        }
    }

    return {
        connected: false,
        port: ports[0] || '',
        reason: 'serial_unreachable',
        message: lastError?.message || 'No USB serial controller responded.'
    };
};

const getControllerStatus = async () => {
    const baseUrls = getLockerControllerBaseUrls();
    const primaryBaseUrl = baseUrls[0] || 'http://192.168.4.1';
    const controller = {
        enabled: LOCKER_CONTROLLER_ENABLED,
        required: LOCKER_CONTROLLER_REQUIRED,
        connected: false,
        reason: LOCKER_CONTROLLER_ENABLED ? 'unreachable' : 'disabled',
        message: LOCKER_CONTROLLER_ENABLED ? 'Controller has not responded yet.' : 'Locker controller checks are disabled.',
        diagnosis: '',
        baseUrl: primaryBaseUrl,
        ssidHint: LOCKER_CONTROLLER_SSID_HINT,
        ipHint: LOCKER_CONTROLLER_IP_HINT,
        configuredMaxLocks: LOCKER_CONTROLLER_MAX_LOCKS,
        maxLocks: LOCKER_CONTROLLER_MAX_LOCKS,
        serial: {
            enabled: LOCKER_CONTROLLER_SERIAL_ENABLED,
            connected: false,
            port: '',
            autoDetect: LOCKER_CONTROLLER_SERIAL_AUTO_DETECT
        }
    };

    if (!LOCKER_CONTROLLER_ENABLED) {
        return controller;
    }

    const serialStatus = await querySerialControllerStatus();
    if (serialStatus.connected) {
        const locks = clampInt(serialStatus.status?.locks, LOCKER_CONTROLLER_MAX_LOCKS, { min: 1, max: 256 });
        return {
            ...controller,
            connected: true,
            reason: 'serial_fallback',
            message: 'ESP responded over USB serial.',
            diagnosis: '',
            maxLocks: locks,
            liveStatus: serialStatus.status,
            serial: {
                ...controller.serial,
                connected: true,
                port: serialStatus.port,
                raw: serialStatus.raw
            }
        };
    }

    let lastHttpError = null;
    for (const baseUrl of baseUrls) {
        const statusUrl = buildControllerUrl(baseUrl, process.env.LOCKER_CONTROLLER_STATUS_PATH || '/status', { _ts: Date.now() });
        for (let attempt = 0; attempt < LOCKER_CONTROLLER_STATUS_ATTEMPTS; attempt += 1) {
            try {
                const status = await requestControllerJson(statusUrl, LOCKER_CONTROLLER_TIMEOUT_MS);
                const locks = clampInt(status?.locks, LOCKER_CONTROLLER_MAX_LOCKS, { min: 1, max: 256 });
                return {
                    ...controller,
                    connected: true,
                    reason: 'http',
                    message: 'Live controller /status response received.',
                    diagnosis: '',
                    baseUrl,
                    maxLocks: locks,
                    liveStatus: status,
                    serial: controller.serial
                };
            } catch (error) {
                lastHttpError = error;
            }
        }
    }

    return {
        ...controller,
        reason: lastHttpError && /timed out/i.test(lastHttpError.message) ? 'timeout' : 'unreachable',
        message: lastHttpError?.message || serialStatus.message || 'Controller is unreachable.',
        diagnosis: `Wi-Fi /status did not respond from ${primaryBaseUrl}. USB serial also did not answer${serialStatus.port ? ` on ${serialStatus.port}` : ''}.`,
        serial: {
            ...controller.serial,
            connected: false,
            port: serialStatus.port || '',
            message: serialStatus.message || ''
        }
    };
};

const unlockViaController = async (lockNumber) => {
    const safeLockNumber = clampInt(lockNumber, 0, { min: 0, max: LOCKER_CONTROLLER_MAX_LOCKS });
    if (!LOCKER_CONTROLLER_ENABLED) {
        return { success: true, mode: 'disabled', message: 'Controller disabled by configuration.' };
    }
    if (!safeLockNumber) {
        return { success: true, mode: 'unmapped', message: 'No hardware lock number assigned.' };
    }

    let lastError = null;

    if (LOCKER_CONTROLLER_SERIAL_ENABLED) {
        const ports = await getSerialPortCandidates();
        for (const port of ports) {
            try {
                const output = await runSerialCommand(port, `UNLOCK ${safeLockNumber}`);
                if (new RegExp(`SERIAL_OK\\s+UNLOCK\\s+${safeLockNumber}\\b`).test(output)) {
                    return { success: true, mode: 'server-serial', port, raw: output };
                }
                lastError = new Error(output || `No unlock reply on ${port}`);
            } catch (error) {
                lastError = error;
            }
        }
    }

    const baseUrls = getLockerControllerBaseUrls();
    const unlockPath = process.env.LOCKER_CONTROLLER_UNLOCK_PATH || '/unlock';
    for (const baseUrl of baseUrls) {
        const unlockUrl = buildControllerUrl(baseUrl, unlockPath, { lock: safeLockNumber, _ts: Date.now() });
        for (let attempt = 0; attempt < LOCKER_CONTROLLER_UNLOCK_ATTEMPTS; attempt += 1) {
            try {
                const raw = await requestControllerText(unlockUrl, LOCKER_CONTROLLER_TIMEOUT_MS);
                const normalizedRaw = String(raw || '').trim();
                const expectedText = new RegExp(`\\bLock\\s+${safeLockNumber}\\s+triggered\\b`, 'i');
                if (!expectedText.test(normalizedRaw)) {
                    throw new Error(`Unexpected controller unlock response: ${normalizedRaw.slice(0, 80) || 'empty response'}`);
                }
                return { success: true, mode: 'server-http', url: unlockUrl };
            } catch (error) {
                lastError = error;
            }
        }
    }

    return {
        success: false,
        mode: 'failed',
        message: lastError?.message || 'Locker controller did not unlock.',
        unlockUrls: baseUrls.map((baseUrl) => buildControllerUrl(baseUrl, unlockPath, { lock: safeLockNumber }))
    };
};

const normalizeHardwareLockNumberValue = (value) => {
    const num = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(num) && num > 0 ? num : null;
};

const deriveHardwareLockNumberFromLockerName = (name) => {
    const match = /^locker\s*(\d+)$/i.exec(String(name || '').trim());
    if (!match) return null;
    return normalizeHardwareLockNumberValue(match[1]);
};

const getNextHardwareLockNumber = async () => {
    const used = await Locker.find({ hardwareLockNumber: { $gte: 1 } }).select('hardwareLockNumber').lean();
    const usedSet = new Set((used || []).map((locker) => normalizeHardwareLockNumberValue(locker.hardwareLockNumber)).filter(Boolean));
    for (let i = 1; i <= LOCKER_CONTROLLER_MAX_LOCKS; i += 1) {
        if (!usedSet.has(i)) return i;
    }
    return null;
};

const getHardwareLockNumberForKey = async (key) => {
    const lockerName = String(key?.locker || '').trim();
    if (!lockerName) return null;

    const locker = await Locker.findOne({ name: new RegExp(`^${escapeRegex(lockerName)}$`, 'i') }).lean();
    const configured = normalizeHardwareLockNumberValue(locker?.hardwareLockNumber);
    if (configured) return configured;

    return deriveHardwareLockNumberFromLockerName(lockerName);
};

const shouldTriggerControllerForAction = (action) => {
    if (!LOCKER_CONTROLLER_ENABLED) return false;
    if (LOCKER_CONTROLLER_TRIGGER_ON === 'none' || LOCKER_CONTROLLER_TRIGGER_ON === 'false') return false;
    if (LOCKER_CONTROLLER_TRIGGER_ON === 'borrow') return action === 'borrow';
    if (LOCKER_CONTROLLER_TRIGGER_ON === 'return') return action === 'return';
    return true;
};

const CONTROLLER_UNLOCK_PROOF_TTL_MS = 2 * 60 * 1000;

const getControllerProofSecret = () => process.env.JWT_SECRET || process.env.SESSION_SECRET || 'key-borrowing-system-local-secret';

const signControllerUnlockProof = (payload) => crypto
    .createHmac('sha256', getControllerProofSecret())
    .update(JSON.stringify(payload))
    .digest('hex');

const createControllerUnlockProof = ({ userId, qrUniqueId, action, keyId, hardwareLockNumber }) => {
    const payload = {
        userId: String(userId || ''),
        qrUniqueId: String(qrUniqueId || ''),
        action: String(action || ''),
        keyId: String(keyId || ''),
        hardwareLockNumber: Number(hardwareLockNumber || 0) || 0,
        expiresAt: Date.now() + CONTROLLER_UNLOCK_PROOF_TTL_MS
    };
    const signature = signControllerUnlockProof(payload);
    return Buffer.from(JSON.stringify({ ...payload, signature }), 'utf8').toString('base64url');
};

const verifyControllerUnlockProof = (proof, expected) => {
    try {
        const raw = Buffer.from(String(proof || ''), 'base64url').toString('utf8');
        const decoded = JSON.parse(raw);
        const { signature, ...payload } = decoded || {};
        if (!signature || signControllerUnlockProof(payload) !== signature) return false;
        if (!Number.isFinite(Number(payload.expiresAt)) || Number(payload.expiresAt) < Date.now()) return false;

        return String(payload.userId || '') === String(expected.userId || '')
            && String(payload.qrUniqueId || '') === String(expected.qrUniqueId || '')
            && String(payload.action || '') === String(expected.action || '')
            && String(payload.keyId || '') === String(expected.keyId || '')
            && Number(payload.hardwareLockNumber || 0) === Number(expected.hardwareLockNumber || 0);
    } catch {
        return false;
    }
};

const wasTokenIssuedBeforePasswordChange = (decodedToken, passwordChangedAt) => {
    const issuedAtSeconds = Number(decodedToken?.iat || 0);
    if (!issuedAtSeconds || !passwordChangedAt) return false;

    const changedAtDate = passwordChangedAt instanceof Date
        ? passwordChangedAt
        : new Date(passwordChangedAt);
    if (Number.isNaN(changedAtDate.getTime())) return false;

    return Math.floor(changedAtDate.getTime() / 1000) > issuedAtSeconds;
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

const loadUserRecord = async (req, res, next) => {
    try {
        const user = await User.findById(req.user?.id).select('-password');
        if (!user) {
            return res.status(403).json({ error: 'User not found' });
        }
        if (user.isActive === false) {
            return res.status(403).json({ error: 'Account is inactive. Please contact the administrator.' });
        }
        if (user.emailVerified === false) {
            return res.status(403).json({ error: 'Please verify your email before continuing.' });
        }
        if (wasTokenIssuedBeforePasswordChange(req.user, user.passwordChangedAt)) {
            return res.status(403).json({ error: 'Your password was changed. Please log in again.' });
        }
        req.userRecord = user;
        next();
    } catch (error) {
        console.error('User record load error:', error);
        res.status(500).json({ error: 'Failed to validate user' });
    }
};

const requireApprovedTeacher = [authenticateToken, loadUserRecord, (req, res, next) => {
    const status = String(req.userRecord?.approvalStatus || '').trim().toLowerCase();
    if (status === 'pending') {
        return res.status(403).json({ error: 'Account is pending admin approval.' });
    }
    if (status === 'rejected') {
        return res.status(403).json({ error: 'Account registration was rejected.' });
    }
    next();
}];

// Maintenance mode (system-wide)
const DEFAULT_MAINTENANCE = {
    title: 'System Maintenance',
    message: 'The system is temporarily unavailable while we perform maintenance. Please try again later.'
};
const MAINTENANCE_SCOPE = 'global';
const MAINTENANCE_CACHE_TTL_MS = 5000;
let maintenanceCache = {
    enabled: false,
    title: DEFAULT_MAINTENANCE.title,
    message: DEFAULT_MAINTENANCE.message,
    updatedAt: null,
    updatedByName: ''
};
let maintenanceCacheLoadedAt = 0;

const normalizeMaintenanceText = (value, fallback) => {
    const text = String(value || '').trim();
    return text || fallback;
};

const buildMaintenancePayload = (doc) => ({
    enabled: Boolean(doc?.enabled),
    title: normalizeMaintenanceText(doc?.title, DEFAULT_MAINTENANCE.title),
    message: normalizeMaintenanceText(doc?.message, DEFAULT_MAINTENANCE.message),
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    updatedByName: String(doc?.updatedByName || '').trim() || ''
});

const loadMaintenanceFromDb = async () => {
    const doc = await Maintenance.findOne({ scope: MAINTENANCE_SCOPE }).lean();
    if (!doc) {
        return {
            enabled: false,
            title: DEFAULT_MAINTENANCE.title,
            message: DEFAULT_MAINTENANCE.message,
            updatedAt: null,
            updatedByName: ''
        };
    }
    return buildMaintenancePayload(doc);
};

const getMaintenanceState = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && now - maintenanceCacheLoadedAt < MAINTENANCE_CACHE_TTL_MS) {
        return maintenanceCache;
    }
    try {
        maintenanceCache = await loadMaintenanceFromDb();
        maintenanceCacheLoadedAt = now;
    } catch (error) {
        console.error('Maintenance state load error:', error);
    }
    return maintenanceCache;
};

const rejectDuringMaintenance = async (req, res, next) => {
    try {
        const state = await getMaintenanceState();
        if (state.enabled) {
            res.set('Cache-Control', 'no-store');
            return res.status(503).json({
                error: state.message || DEFAULT_MAINTENANCE.message,
                maintenance: state
            });
        }
    } catch (error) {
        console.error('Maintenance gate error:', error);
    }
    next();
};

const authenticateAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Admin token required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const admin = await Admin.findById(decoded.id);

        if (!admin || !admin.isActive) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        if (wasTokenIssuedBeforePasswordChange(decoded, admin.passwordChangedAt)) {
            return res.status(403).json({ error: 'Admin password was changed. Please log in again.' });
        }

        req.admin = admin;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid admin token' });
    }
};

const logActivity = async ({
    actorType = 'system',
    actorId = null,
    actorName = '',
    action,
    targetType = '',
    targetId = null,
    targetName = '',
    details = {}
}) => {
    try {
        await ActivityLog.create({
            actorType,
            actorId,
            actorName,
            action,
            targetType,
            targetId,
            targetName,
            details
        });

    } catch (error) {
        console.error('Activity log error:', error);
    }
};

const hasSameTransactionTimestamp = (left, right) => {
    const leftDate = normalizeTransactionTimestamp(left, null);
    const rightDate = normalizeTransactionTimestamp(right, null);
    if (!leftDate || !rightDate) return false;
    return leftDate.getTime() === rightDate.getTime();
};

const createTransactionRecord = async (payload = {}) => {
    const eventTime = normalizeTransactionTimestamp(
        payload?.performedAt || payload?.createdAt || payload?.updatedAt,
        new Date()
    );

    const transaction = new Transaction({
        ...payload,
        performedAt: eventTime,
        createdAt: eventTime,
        updatedAt: eventTime
    });

    const validationError = transaction.validateSync();
    if (validationError) {
        throw validationError;
    }

    const rawTransaction = transaction.toObject({ depopulate: true });
    rawTransaction.performedAt = eventTime;
    rawTransaction.createdAt = eventTime;
    rawTransaction.updatedAt = eventTime;
    rawTransaction.__v = Number.isFinite(rawTransaction.__v) ? rawTransaction.__v : 0;

    await Transaction.collection.insertOne(rawTransaction);
    transaction.isNew = false;
    return transaction;
};

const summarizeImageDataUrl = (value) => {
    const text = String(value || '').trim();
    if (!text) {
        return {
            present: false,
            mime: '',
            bytes: 0
        };
    }

    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(text);
    const mime = match?.[1] ? String(match[1]).toLowerCase() : '';
    const base64 = match?.[2] || '';
    const bytes = base64 ? Math.ceil((base64.length * 3) / 4) : 0;

    return {
        present: true,
        mime,
        bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0
    };
};

const forceReleaseBorrowedKeys = async ({
    userIds = [],
    reason = 'Released by admin',
    scannedBy = 'admin'
} = {}) => {
    const normalizedUserIds = [...new Set((userIds || []).map((value) => getEntityIdString(value)).filter(Boolean))];
    if (normalizedUserIds.length === 0) {
        return { releasedKeys: 0, createdTransactions: 0 };
    }

    const keys = await Key.find({
        borrowedBy: { $in: normalizedUserIds },
        status: 'borrowed'
    });

    if (!Array.isArray(keys) || keys.length === 0) {
        return { releasedKeys: 0, createdTransactions: 0 };
    }

    const now = new Date();
    let createdTransactions = 0;

    for (const key of keys) {
        const borrowerId = key?.borrowedBy;
        if (!borrowerId) continue;

        const sessionId = String(key.currentBorrowSessionId || '').trim() || new mongoose.Types.ObjectId().toString();
        const location = [String(key.building || '').trim(), String(key.room || '').trim()]
            .filter(Boolean)
            .join(' • ');

        await createTransactionRecord({
            keyId: key.keyId,
            locker: String(key.locker || '').trim(),
            userId: borrowerId,
            action: 'return',
            location,
            performedAt: now,
            sessionId,
            notes: reason,
            scannedBy
        });
        createdTransactions += 1;

        key.status = 'available';
        key.borrowedBy = null;
        key.borrowedAt = null;
        key.currentBorrowSessionId = null;
        await key.save();
    }

    return {
        releasedKeys: keys.length,
        createdTransactions
    };
};

const buildAdminTransactionQuery = async ({
    search = '',
    actionFilter = '',
    from = '',
    to = '',
    tzOffset = ''
} = {}) => {
    const conditions = [];
    const normalizedAction = String(actionFilter || '').trim().toLowerCase();

    if (normalizedAction === 'borrow' || normalizedAction === 'return') {
        conditions.push({ action: normalizedAction });
    } else if (normalizedAction) {
        const error = new Error('Invalid action filter');
        error.statusCode = 400;
        throw error;
    }

    const dateRange = buildUtcDateRangeFilter({ from, to, tzOffset });
    const timeQuery = buildPerformedAtQuery(dateRange);
    if (timeQuery) {
        conditions.push(timeQuery);
    }

    const normalizedSearch = String(search || '').trim();
    if (normalizedSearch) {
        const regex = new RegExp(escapeRegex(normalizedSearch), 'i');
        const or = [
            { keyId: regex },
            { locker: regex },
            { action: regex },
            { location: regex },
            { notes: regex },
            { scannedBy: regex }
        ];

        const matchedUsers = await User.find({
            $or: [
                { firstName: regex },
                { lastName: regex },
                { email: regex }
            ]
        })
            .select('_id')
            .limit(200)
            .lean();

        const userIds = (matchedUsers || []).map((user) => user._id).filter(Boolean);
        if (userIds.length > 0) {
            or.push({ userId: { $in: userIds } });
        }

        conditions.push({ $or: or });
    }

    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0];
    return { $and: conditions };
};

const buildAdminLogQuery = ({
    search = '',
    category = '',
    from = '',
    to = '',
    tzOffset = ''
} = {}) => {
    const conditions = [];
    const normalizedCategory = String(category || '').trim().toLowerCase();
    const normalizedSearch = String(search || '').trim();

    if (normalizedCategory === 'profile_photo') {
        conditions.push({ action: { $regex: '^user\\.profile_photo\\.', $options: 'i' } });
    }

    const dateRange = buildUtcDateRangeFilter({ from, to, tzOffset });
    if (dateRange) {
        conditions.push({ createdAt: dateRange });
    }

    if (normalizedSearch) {
        const regex = new RegExp(escapeRegex(normalizedSearch), 'i');
        conditions.push({
            $or: [
                { actorName: regex },
                { action: regex },
                { targetName: regex }
            ]
        });
    }

    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0];
    return { $and: conditions };
};

const sessionMatchesDateRange = (session, range) => {
    if (!range) return true;

    const matches = (value) => {
        if (!value) return false;
        const date = normalizeTransactionTimestamp(value, null);
        if (!date) return false;
        if (range.$gte && date < range.$gte) return false;
        if (range.$lt && date >= range.$lt) return false;
        return true;
    };

    return matches(session.borrowedAt)
        || matches(session.returnedAt)
        || matches(session.performedAt);
};

const buildTransactionSessionRows = (transactions, { range = null } = {}) => {
    const sorted = [...(transactions || [])].sort((a, b) => {
        const timeDiff = getTransactionMoment(a).getTime() - getTransactionMoment(b).getTime();
        if (timeDiff !== 0) return timeDiff;
        return String(a?._id || '').localeCompare(String(b?._id || ''));
    });

    const pendingBySessionId = new Map();
    const pendingByBorrowKey = new Map();
    const pendingSessions = new Set();
    const sessions = [];

    const getPendingKey = (transaction) => `${String(transaction?.keyId || '').trim().toUpperCase()}::${getEntityIdString(transaction?.userId)}`;
    const removePendingSession = (session) => {
        if (!session) return;
        if (session.sessionId) {
            pendingBySessionId.delete(session.sessionId);
        }
        const key = session.pendingKey;
        if (!key || !pendingByBorrowKey.has(key)) return;
        const nextStack = (pendingByBorrowKey.get(key) || []).filter((item) => item !== session);
        if (nextStack.length > 0) pendingByBorrowKey.set(key, nextStack);
        else pendingByBorrowKey.delete(key);
        pendingSessions.delete(session);
    };
    const addPendingSession = (session) => {
        if (!session) return;
        if (session.sessionId) {
            pendingBySessionId.set(session.sessionId, session);
        }
        const key = session.pendingKey;
        const stack = pendingByBorrowKey.get(key) || [];
        stack.push(session);
        pendingByBorrowKey.set(key, stack);
        pendingSessions.add(session);
    };

    sorted.forEach((transaction) => {
        const action = String(transaction?.action || '').trim().toLowerCase();
        if (action !== 'borrow' && action !== 'return') return;

        const performedAt = getTransactionMoment(transaction);
        const keyId = String(transaction?.keyId || '').trim() || '—';
        const locker = String(transaction?.locker || '').trim() || deriveLockerFromKeyId(keyId) || '—';
        const userId = getEntityIdString(transaction?.userId);
        const user = transaction?.userId && typeof transaction.userId === 'object' ? transaction.userId : null;
        const borrowerName = user
            ? `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim() || String(user.email || '').trim() || 'Unknown'
            : 'Unknown';
        const sessionId = String(transaction?.sessionId || '').trim();

        if (action === 'borrow') {
            const session = {
                sessionId: sessionId || String(transaction?._id || ''),
                pendingKey: getPendingKey(transaction),
                borrower: borrowerName,
                userId,
                keyId,
                locker,
                action: 'borrow',
                actionLabel: 'BORROW',
                performedAt,
                borrowedAt: performedAt,
                returnedAt: null,
                borrowTransactionId: String(transaction?._id || ''),
                returnTransactionId: '',
                notes: String(transaction?.notes || '').trim(),
                location: String(transaction?.location || '').trim()
            };
            addPendingSession(session);
            return;
        }

        let session = sessionId ? pendingBySessionId.get(sessionId) : null;
        if (!session) {
            const pendingKey = getPendingKey(transaction);
            const stack = pendingByBorrowKey.get(pendingKey) || [];
            session = stack.length > 0 ? stack[stack.length - 1] : null;
        }

        if (session) {
            removePendingSession(session);
            session.returnedAt = performedAt;
            session.performedAt = performedAt;
            session.returnTransactionId = String(transaction?._id || '');
            session.action = 'return';
            session.actionLabel = 'RETURN';
            if (!session.locker || session.locker === '—') {
                session.locker = locker;
            }
            if (!session.notes) {
                session.notes = String(transaction?.notes || '').trim();
            }
            sessions.push(session);
            return;
        }

        sessions.push({
            sessionId: sessionId || String(transaction?._id || ''),
            pendingKey: getPendingKey(transaction),
            borrower: borrowerName,
            userId,
            keyId,
            locker,
            action: 'return',
            actionLabel: 'RETURN',
            performedAt,
            borrowedAt: null,
            returnedAt: performedAt,
            borrowTransactionId: '',
            returnTransactionId: String(transaction?._id || ''),
            notes: String(transaction?.notes || '').trim(),
            location: String(transaction?.location || '').trim()
        });
    });

    pendingSessions.forEach((session) => {
        sessions.push(session);
    });

    return sessions
        .filter((session) => sessionMatchesDateRange(session, range))
        .sort((a, b) => {
            const left = normalizeTransactionTimestamp(b?.performedAt || b?.returnedAt || b?.borrowedAt, new Date(0)).getTime();
            const right = normalizeTransactionTimestamp(a?.performedAt || a?.returnedAt || a?.borrowedAt, new Date(0)).getTime();
            if (left !== right) return left - right;
            return String(b?.sessionId || '').localeCompare(String(a?.sessionId || ''));
        });
};

const sendPasswordResetEmail = async ({ to, resetLink, expiresMinutes = RESET_TOKEN_EXPIRE_MINUTES }) => {
    try {
        if (!mailTransporter) return false;
        const from = process.env.MAIL_FROM || `BatStateU Key System <${process.env.SMTP_USER || 'no-reply@example.com'}>`;
        const safeLink = resetLink.replace(/"/g, '&quot;');

        const html = `
            <p>We received a request to reset your password.</p>
            <p><a href="${safeLink}">Reset Password</a></p>
            <p>This link will expire in ${expiresMinutes} minutes.</p>
            <p>If you did not request this, you can ignore this email.</p>
        `;

        await mailTransporter.sendMail({
            from,
            to,
            subject: 'Reset your password',
            html
        });

        return true;
    } catch (error) {
        console.error('Email send error:', error);
        return false;
    }
};

const SUPPORT_EMAIL = String(process.env.SUPPORT_EMAIL || process.env.SMTP_USER || '').trim() || 'keybsu25@gmail.com';

const generateEmailVerificationCode = (digits = 6) => {
    const length = Number(digits) || 6;
    const max = 10 ** length;
    const value = crypto.randomInt(0, max);
    return String(value).padStart(length, '0');
};

const hashEmailVerificationCode = ({ email, code }) => {
    const secret = String(process.env.JWT_SECRET || '').trim();
    const emailNorm = normalizeIdentity(email);
    const codeNorm = String(code || '').trim();
    return crypto
        .createHash('sha256')
        .update(`${emailNorm}:${codeNorm}:${secret}`)
        .digest('hex');
};

const sendEmailVerificationCodeEmail = async ({ to, code, expiresMinutes = EMAIL_VERIFICATION_EXPIRE_MINUTES }) => {
    try {
        if (!mailTransporter) return false;
        const recipient = String(to || '').trim();
        if (!recipient) return false;

        const from = process.env.MAIL_FROM || `BatStateU Key System <${process.env.SMTP_USER || 'no-reply@example.com'}>`;
        const safeCode = String(code || '').trim().replace(/[^0-9]/g, '');

        const html = `
            <p>Your BatStateU Key System verification code is:</p>
            <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">
                ${safeCode}
            </p>
            <p>This code will expire in ${Number(expiresMinutes) || EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.</p>
            <p>If you did not request this, you can ignore this email.</p>
        `;

        await mailTransporter.sendMail({
            from,
            to: recipient,
            subject: 'Your verification code',
            html
        });

        return true;
    } catch (error) {
        console.error('Verification email send error:', error);
        return false;
    }
};

const sendAccountApprovalEmail = async ({ to, status, supportEmail = SUPPORT_EMAIL, appUrl }) => {
    try {
        if (!mailTransporter) return false;
        const recipient = String(to || '').trim();
        if (!recipient) return false;

        const from = process.env.MAIL_FROM || `BatStateU Key System <${process.env.SMTP_USER || 'no-reply@example.com'}>`;
        const baseUrl = String(appUrl || process.env.APP_BASE_URL || '').trim() || 'http://localhost:3000';
        const normalizedStatus = String(status || '').trim().toLowerCase();

        const isApproved = normalizedStatus === 'approved';
        const subject = isApproved ? 'Account approved' : 'Account status update';
        const supportLine = supportEmail ? `<p>Need help? Contact: <strong>${supportEmail}</strong></p>` : '';

        const html = isApproved
            ? `
                <p>Your BatStateU Key System account has been approved.</p>
                <p>You can now sign in and access the dashboard.</p>
                <p><a href="${baseUrl}">Open the system</a></p>
                ${supportLine}
            `
            : `
                <p>Your BatStateU Key System registration was not approved.</p>
                ${supportLine}
            `;

        await mailTransporter.sendMail({
            from,
            to: recipient,
            subject,
            html
        });

        return true;
    } catch (error) {
        console.error('Approval email send error:', error);
        return false;
    }
};

// Initialize Default Admin
const initializeDefaultAdmin = async () => {
    try {
        let defaultAdmin = await Admin.findOne({
            username: new RegExp(`^${escapeRegex(DEFAULT_ADMIN.username)}$`, 'i')
        });

        const desiredPermissions = {
            manageKeys: true,
            manageUsers: true,
            manageAdmins: true,
            generateReports: true,
            systemSettings: true
        };

        if (!defaultAdmin) {
            defaultAdmin = new Admin({
                username: DEFAULT_ADMIN.username,
                password: DEFAULT_ADMIN.password,
                email: DEFAULT_ADMIN.email,
                fullName: DEFAULT_ADMIN.fullName,
                role: 'super_admin',
                permissions: desiredPermissions,
                isActive: true,
                isDefault: true
            });
            await defaultAdmin.save();
            await logActivity({
                actorType: 'system',
                actorName: 'system',
                action: 'admin.seed_default',
                targetType: 'admin',
                targetId: defaultAdmin._id,
                targetName: defaultAdmin.username
            });
            console.log('✅ Default admin account created');
            return;
        }

        let shouldSave = false;
        let resetPasswordToEnv = false;

        if (defaultAdmin.isDefault !== true) {
            defaultAdmin.isDefault = true;
            shouldSave = true;
        }

        if (defaultAdmin.isActive === false) {
            defaultAdmin.isActive = true;
            shouldSave = true;
        }

        if (defaultAdmin.role !== 'super_admin') {
            defaultAdmin.role = 'super_admin';
            shouldSave = true;
        }

        if (!defaultAdmin.permissions) {
            defaultAdmin.permissions = {};
            shouldSave = true;
        }

        Object.keys(desiredPermissions).forEach((key) => {
            if (defaultAdmin.permissions[key] !== true) {
                defaultAdmin.permissions[key] = true;
                shouldSave = true;
            }
        });

        if (process.env.NODE_ENV !== 'production') {
            const matchesDefault = await bcrypt.compare(DEFAULT_ADMIN.password, defaultAdmin.password);
            if (!matchesDefault) {
                defaultAdmin.password = DEFAULT_ADMIN.password;
                resetPasswordToEnv = true;
                shouldSave = true;
            }
        }

        if (shouldSave) {
            await defaultAdmin.save();
            if (resetPasswordToEnv) {
                console.log('✅ Default admin password reset to match .env');
            }
        }
    } catch (error) {
        console.error('❌ Error creating default admin:', error);
    }
};

// Initialize Default Keys
const initializeDefaultKeys = async () => {
    try {
        const keyCount = await Key.countDocuments();
        if (keyCount === 0) {
            const keys = [];
            for (let i = 1; i <= 30; i++) {
                const keyId = `KEY${i.toString().padStart(3, '0')}`;
                keys.push({
                    keyId,
                    locker: deriveLockerFromKeyId(keyId),
                    room: `Room ${i}`,
                    building: 'Main Building',
                    description: `Default key for Room ${i}`,
                    status: 'available'
                });
            }
            await Key.insertMany(keys);
            await logActivity({
                actorType: 'system',
                actorName: 'system',
                action: 'key.seed_default',
                targetType: 'key',
                targetName: 'default_keys',
                details: { totalKeys: keys.length }
            });
            console.log('✅ Default keys initialized');
        } else {
            // Backfill locker grouping for existing keys (keeps UI organized without manual edits)
            const keysNeedingLocker = await Key.find({
                $or: [
                    { locker: { $exists: false } },
                    { locker: null }
                ]
            }).select('_id keyId locker');

            if (keysNeedingLocker.length > 0) {
                const ops = [];
                for (const key of keysNeedingLocker) {
                    const locker = deriveLockerFromKeyId(key.keyId);
                    if (!locker) continue;
                    ops.push({
                        updateOne: {
                            filter: { _id: key._id },
                            update: { $set: { locker } }
                        }
                    });
                }
                if (ops.length > 0) {
                    await Key.bulkWrite(ops);
                    await logActivity({
                        actorType: 'system',
                        actorName: 'system',
                        action: 'key.backfill_locker',
                        targetType: 'key',
                        targetName: 'existing_keys',
                        details: { updatedKeys: ops.length }
                    });
                    console.log(`✅ Locker assigned for ${ops.length} existing keys`);
                }
            }
        }
    } catch (error) {
        console.error('❌ Error initializing default keys:', error);
    }
};

const initializeDefaultLockers = async () => {
    try {
        const lockerNames = await Key.distinct('locker', {
            locker: { $nin: [null, ''] }
        });

        const uniqueNames = (lockerNames || [])
            .map((name) => String(name || '').trim())
            .filter(Boolean);

        if (uniqueNames.length === 0) return;

        const existing = await Locker.find({ name: { $in: uniqueNames } }).select('name hardwareLockNumber');
        const existingSet = new Set((existing || []).map((l) => String(l.name || '')));
        const usedHardwareNumbers = new Set(
            (await Locker.find({ hardwareLockNumber: { $gte: 1 } }).select('hardwareLockNumber').lean())
                .map((locker) => normalizeHardwareLockNumberValue(locker.hardwareLockNumber))
                .filter(Boolean)
        );
        const reserveHardwareNumber = (name) => {
            const derived = deriveHardwareLockNumberFromLockerName(name);
            if (derived && derived <= LOCKER_CONTROLLER_MAX_LOCKS && !usedHardwareNumbers.has(derived)) {
                usedHardwareNumbers.add(derived);
                return derived;
            }
            for (let i = 1; i <= LOCKER_CONTROLLER_MAX_LOCKS; i += 1) {
                if (!usedHardwareNumbers.has(i)) {
                    usedHardwareNumbers.add(i);
                    return i;
                }
            }
            return undefined;
        };

        const toCreate = uniqueNames
            .filter((name) => !existingSet.has(name))
            .map((name) => ({ name, hardwareLockNumber: reserveHardwareNumber(name) }))
            .filter((locker) => locker.hardwareLockNumber);

        const backfillOps = (existing || [])
            .filter((locker) => !normalizeHardwareLockNumberValue(locker.hardwareLockNumber))
            .map((locker) => {
                const hardwareLockNumber = reserveHardwareNumber(locker.name);
                if (!hardwareLockNumber) return null;
                return {
                    updateOne: {
                        filter: { _id: locker._id },
                        update: { $set: { hardwareLockNumber } }
                    }
                };
            })
            .filter(Boolean);

        if (backfillOps.length > 0) {
            await Locker.bulkWrite(backfillOps, { ordered: false });
            await logActivity({
                actorType: 'system',
                actorName: 'system',
                action: 'locker.backfill_hardware_slot',
                targetType: 'locker',
                targetName: 'existing_lockers',
                details: { updatedLockers: backfillOps.length }
            });
            console.log(`âœ… Locker hardware slots backfilled (${backfillOps.length} updated)`);
        }

        if (toCreate.length === 0) return;

        await Locker.insertMany(toCreate, { ordered: false });
        await logActivity({
            actorType: 'system',
            actorName: 'system',
            action: 'locker.seed_from_keys',
            targetType: 'locker',
            targetName: 'derived_lockers',
            details: { createdLockers: toCreate.length }
        });
        console.log(`✅ Lockers initialized (${toCreate.length} added)`);
    } catch (error) {
        // ignore duplicate errors when running in parallel or after manual DB changes
        if (error && error.code === 11000) return;
        console.error('❌ Error initializing lockers:', error);
    }
};

const backfillLegacyTransactionMetadata = async () => {
    const timelineCandidates = await Transaction.find({})
        .select('_id performedAt createdAt updatedAt')
        .lean();

    const timelineOps = timelineCandidates
        .map((transaction) => {
            const eventTime = normalizeTransactionTimestamp(
                transaction?.performedAt || transaction?.createdAt || transaction?.updatedAt,
                null
            );
            if (!eventTime) return null;

            const needsRepair = !hasSameTransactionTimestamp(transaction?.performedAt, eventTime)
                || !hasSameTransactionTimestamp(transaction?.createdAt, eventTime)
                || !hasSameTransactionTimestamp(transaction?.updatedAt, eventTime);

            if (!needsRepair) return null;

            return {
                updateOne: {
                    filter: { _id: transaction._id },
                    update: {
                        $set: {
                            performedAt: eventTime,
                            createdAt: eventTime,
                            updatedAt: eventTime
                        }
                    }
                }
            };
        })
        .filter(Boolean);

    if (timelineOps.length > 0) {
        await Transaction.collection.bulkWrite(
            timelineOps,
            { ordered: false }
        );
        await logActivity({
            actorType: 'system',
            actorName: 'system',
            action: 'transaction.backfill_timestamps',
            targetType: 'transaction',
            targetName: 'transactions',
            details: { updatedTransactions: timelineOps.length }
        });
        console.log(`Normalized performedAt/createdAt/updatedAt for ${timelineOps.length} transaction(s).`);
    }

    const transactions = await Transaction.find({})
        .select('_id keyId userId action performedAt createdAt sessionId')
        .sort({ performedAt: 1, createdAt: 1, _id: 1 })
        .lean();

    const transactionOps = [];
    const keySessionOps = [];
    const sessionStacks = new Map();
    const activeKeySessions = new Map();

    transactions.forEach((transaction) => {
        const keyId = String(transaction?.keyId || '').trim().toUpperCase();
        const userId = getEntityIdString(transaction?.userId);
        const pairKey = `${keyId}::${userId}`;
        const action = String(transaction?.action || '').trim().toLowerCase();
        const existingSessionId = String(transaction?.sessionId || '').trim();

        if (action === 'borrow') {
            const derivedSessionId = existingSessionId || String(transaction?._id || '');
            if (!existingSessionId) {
                transactionOps.push({
                    updateOne: {
                        filter: {
                            _id: transaction._id,
                            $or: [
                                { sessionId: { $exists: false } },
                                { sessionId: null },
                                { sessionId: '' }
                            ]
                        },
                        update: { $set: { sessionId: derivedSessionId } }
                    }
                });
            }

            const stack = sessionStacks.get(pairKey) || [];
            stack.push(derivedSessionId);
            sessionStacks.set(pairKey, stack);
            activeKeySessions.set(keyId, derivedSessionId);
            return;
        }

        if (action !== 'return') return;

        const stack = sessionStacks.get(pairKey) || [];
        const matchedSessionId = existingSessionId || stack.pop() || String(transaction?._id || '');
        if (stack.length > 0) sessionStacks.set(pairKey, stack);
        else sessionStacks.delete(pairKey);

        if (!existingSessionId) {
            transactionOps.push({
                updateOne: {
                    filter: {
                        _id: transaction._id,
                        $or: [
                            { sessionId: { $exists: false } },
                            { sessionId: null },
                            { sessionId: '' }
                        ]
                    },
                    update: { $set: { sessionId: matchedSessionId } }
                }
            });
        }

        if (activeKeySessions.get(keyId) === matchedSessionId) {
            activeKeySessions.delete(keyId);
        }
    });

    if (transactionOps.length > 0) {
        await Transaction.collection.bulkWrite(transactionOps, { ordered: false });
        await logActivity({
            actorType: 'system',
            actorName: 'system',
            action: 'transaction.backfill_session',
            targetType: 'transaction',
            targetName: 'transactions',
            details: { updatedTransactions: transactionOps.length }
        });
        console.log(`Backfilled sessionId for ${transactionOps.length} transaction(s).`);
    }

    const borrowedKeys = await Key.find({ status: 'borrowed' })
        .select('_id keyId currentBorrowSessionId')
        .lean();

    borrowedKeys.forEach((key) => {
        const keyId = String(key?.keyId || '').trim().toUpperCase();
        const desiredSessionId = activeKeySessions.get(keyId) || '';
        if (desiredSessionId && desiredSessionId !== String(key?.currentBorrowSessionId || '').trim()) {
            keySessionOps.push({
                updateOne: {
                    filter: { _id: key._id },
                    update: { $set: { currentBorrowSessionId: desiredSessionId } }
                }
            });
        }
    });

    const staleSessionKeys = await Key.find({
        status: { $ne: 'borrowed' },
        currentBorrowSessionId: { $exists: true, $nin: [null, ''] }
    })
        .select('_id')
        .lean();

    staleSessionKeys.forEach((key) => {
        keySessionOps.push({
            updateOne: {
                filter: { _id: key._id },
                update: { $unset: { currentBorrowSessionId: '' } }
            }
        });
    });

    if (keySessionOps.length > 0) {
        await Key.bulkWrite(keySessionOps, { ordered: false });
        await logActivity({
            actorType: 'system',
            actorName: 'system',
            action: 'key.sync_borrow_session',
            targetType: 'key',
            targetName: 'borrow_sessions',
            details: { updatedKeys: keySessionOps.length }
        });
        console.log(`Synced currentBorrowSessionId on ${keySessionOps.length} key record(s).`);
    }
};

// Backfill QR "used" tracking from transactions so charts/filters stay accurate even for older data.
const backfillQRCodeUsageFromTransactions = async () => {
    try {
        const txAgg = await Transaction.aggregate([
            { $match: { qrCodeId: { $ne: null } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$qrCodeId',
                    lastUsedAt: { $first: '$createdAt' },
                    lastUsedBy: { $first: '$userId' }
                }
            }
        ]);

        if (!Array.isArray(txAgg) || txAgg.length === 0) return;

        const ids = txAgg.map((row) => row?._id).filter(Boolean);
        if (ids.length === 0) return;

        const qrDocs = await QRCodeModel.find({ _id: { $in: ids } })
            .select(['_id', 'createdAt', 'regeneratedAt'])
            .lean();
        if (!Array.isArray(qrDocs) || qrDocs.length === 0) return;

        const byId = new Map(qrDocs.map((doc) => [String(doc._id), doc]));

        const ops = [];
        for (const row of txAgg) {
            const id = row?._id;
            if (!id) continue;

            const qr = byId.get(String(id));
            if (!qr) continue;

            const baseline = qr.regeneratedAt || qr.createdAt || null;
            const baselineTime = baseline ? new Date(baseline).getTime() : 0;

            const lastUsedAt = row?.lastUsedAt ? new Date(row.lastUsedAt) : null;
            const shouldMarkUsed = Boolean(lastUsedAt && lastUsedAt.getTime() >= baselineTime);

            ops.push({
                updateOne: {
                    filter: { _id: id },
                    update: shouldMarkUsed
                        ? { $set: { used: true, usedAt: lastUsedAt, usedBy: row?.lastUsedBy || null } }
                        : { $set: { used: false, usedAt: null, usedBy: null } }
                }
            });
        }

        if (ops.length === 0) return;

        const result = await QRCodeModel.bulkWrite(ops, { ordered: false });
        const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0) || 0;
        if (modified > 0) {
            await logActivity({
                actorType: 'system',
                actorName: 'system',
                action: 'qrcode.backfill_usage',
                targetType: 'qrcode',
                targetName: 'usage_state',
                details: { updatedQRCodes: modified }
            });
            console.log(`✅ QR code usage backfilled (${modified} updated)`);
        }
    } catch (error) {
        console.error('❌ QR code usage backfill error:', error);
    }
};

// Ensure only the latest QR per key+room+purpose remains scannable.
// Older duplicates are expired (so scans fail fast and summary counts stay consistent).
const expireDuplicateQRCodes = async () => {
    try {
        const groups = await QRCodeModel.aggregate([
            { $addFields: { __sortDate: { $ifNull: ['$regeneratedAt', '$createdAt'] } } },
            { $sort: { keyId: 1, room: 1, purpose: 1, __sortDate: -1 } },
            {
                $group: {
                    _id: { keyId: '$keyId', room: '$room', purpose: '$purpose' },
                    ids: { $push: '$_id' },
                    count: { $sum: 1 }
                }
            },
            { $match: { count: { $gt: 1 } } }
        ]);

        const dropIds = [];
        for (const group of groups || []) {
            const ids = Array.isArray(group?.ids) ? group.ids : [];
            if (ids.length > 1) dropIds.push(...ids.slice(1));
        }

        if (dropIds.length === 0) return;

        const result = await QRCodeModel.updateMany(
            { _id: { $in: dropIds } },
            { $set: { expiresAt: new Date(0) } }
        );
        const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0) || 0;
        if (modified > 0) {
            await logActivity({
                actorType: 'system',
                actorName: 'system',
                action: 'qrcode.expire_duplicates',
                targetType: 'qrcode',
                targetName: 'duplicate_qrcodes',
                details: { expiredQRCodes: modified }
            });
            console.log(`✅ QR code duplicates expired (${modified} updated)`);
        }
    } catch (error) {
        console.error('❌ QR code duplicate expiry error:', error);
    }
};

const disableLegacyQrExpiry = async () => {
    try {
        const result = await QRCodeModel.updateMany(
            { expiresAt: { $ne: new Date(0) } },
            { $set: { expiresAt: getQrCodeExpiryDate() } }
        );
        const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0) || 0;
        if (modified > 0) {
            console.log(`✅ QR code expiry removed for active codes (${modified} updated)`);
        }
    } catch (error) {
        console.error('❌ QR code expiry migration error:', error);
    }
};

// Teacher Registration (Email OTP)
app.post('/api/auth/register/request-code', requireRecaptcha, async (req, res) => {
    try {
        const firstName = String(req.body?.firstName || '').trim();
        const lastName = String(req.body?.lastName || '').trim();
        const emailRaw = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');

        if (!firstName || !lastName || !emailRaw || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const email = emailRaw.toLowerCase();
        const emailRegex = /^\S+@\S+\.\S+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Please enter a valid email address' });
        }

        let user = await User.findOne({ email });
        if (user && user.isActive === false) {
            return res.status(403).json({ error: 'This account is inactive. Please contact the administrator.' });
        }

        // Block already-verified accounts
        if (user && user.emailVerified !== false) {
            return res.status(400).json({ error: 'Email is already registered. Please log in.' });
        }

        // Cooldown between sends
        const now = new Date();
        if (user?.emailVerificationSentAt) {
            const secondsSince = Math.floor((now.getTime() - new Date(user.emailVerificationSentAt).getTime()) / 1000);
            if (Number.isFinite(secondsSince) && secondsSince < EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS) {
                const wait = EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS - secondsSince;
                return res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
            }
        }

        const code = generateEmailVerificationCode(6);
        const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRE_MINUTES * 60 * 1000);
        const codeHash = hashEmailVerificationCode({ email, code });

        if (!user) {
            user = new User({
                firstName,
                lastName,
                email,
                password,
                role: 'teacher',
                isActive: true,
                emailVerified: false,
                emailVerificationCodeHash: codeHash,
                emailVerificationExpiresAt: expiresAt,
                emailVerificationAttempts: 0,
                emailVerificationSentAt: now,
                approvalStatus: 'pending'
            });
        } else {
            user.firstName = firstName;
            user.lastName = lastName;
            user.password = password;
            user.isActive = true;
            user.emailVerified = false;
            user.emailVerificationCodeHash = codeHash;
            user.emailVerificationExpiresAt = expiresAt;
            user.emailVerificationAttempts = 0;
            user.emailVerificationSentAt = now;
            user.approvalStatus = 'pending';
            user.approvedAt = undefined;
            user.approvedBy = undefined;
            user.rejectedAt = undefined;
            user.rejectedBy = undefined;
        }

        await user.save();

        const sent = await sendEmailVerificationCodeEmail({
            to: user.email,
            code,
            expiresMinutes: EMAIL_VERIFICATION_EXPIRE_MINUTES
        });

        await logActivity({
            actorType: 'system',
            actorName: 'system',
            action: 'user.email_verification.request',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email,
            details: { sent }
        });

        if (!sent && process.env.NODE_ENV !== 'production') {
            console.log('🔐 DEV email verification code:', user.email, code);
        }

        res.json({
            success: true,
            sent,
            expiresMinutes: EMAIL_VERIFICATION_EXPIRE_MINUTES,
            message: 'Verification code sent'
        });
    } catch (error) {
        console.error('Registration code request error:', error);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
});

app.post('/api/auth/register/resend-code', async (req, res) => {
    try {
        const emailRaw = String(req.body?.email || '').trim();
        const email = emailRaw.toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Please request a verification code first.' });
        }
        if (user.isActive === false) {
            return res.status(403).json({ error: 'This account is inactive. Please contact the administrator.' });
        }
        if (user.emailVerified !== false) {
            return res.status(400).json({ error: 'Email is already verified. Please log in.' });
        }

        const now = new Date();
        if (user.emailVerificationSentAt) {
            const secondsSince = Math.floor((now.getTime() - new Date(user.emailVerificationSentAt).getTime()) / 1000);
            if (Number.isFinite(secondsSince) && secondsSince < EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS) {
                const wait = EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS - secondsSince;
                return res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
            }
        }

        const code = generateEmailVerificationCode(6);
        const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRE_MINUTES * 60 * 1000);
        const codeHash = hashEmailVerificationCode({ email, code });

        user.emailVerificationCodeHash = codeHash;
        user.emailVerificationExpiresAt = expiresAt;
        user.emailVerificationAttempts = 0;
        user.emailVerificationSentAt = now;
        await user.save();

        const sent = await sendEmailVerificationCodeEmail({
            to: user.email,
            code,
            expiresMinutes: EMAIL_VERIFICATION_EXPIRE_MINUTES
        });

        await logActivity({
            actorType: 'system',
            actorName: 'system',
            action: 'user.email_verification.resend',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email,
            details: { sent }
        });

        if (!sent && process.env.NODE_ENV !== 'production') {
            console.log('🔐 DEV email verification code (resend):', user.email, code);
        }

        res.json({
            success: true,
            sent,
            expiresMinutes: EMAIL_VERIFICATION_EXPIRE_MINUTES,
            message: 'Verification code resent'
        });
    } catch (error) {
        console.error('Registration resend error:', error);
        res.status(500).json({ error: 'Failed to resend verification code' });
    }
});

app.post('/api/auth/register/verify-code', async (req, res) => {
    try {
        const emailRaw = String(req.body?.email || '').trim();
        const codeRaw = String(req.body?.code || req.body?.verificationCode || '').trim();

        if (!emailRaw) {
            return res.status(400).json({ error: 'Email is required' });
        }
        if (!codeRaw) {
            return res.status(400).json({ error: 'Verification code is required' });
        }

        const email = emailRaw.toLowerCase();
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Please request a verification code first.' });
        }
        if (user.isActive === false) {
            return res.status(403).json({ error: 'This account is inactive. Please contact the administrator.' });
        }

        if (user.emailVerified !== false) {
            return res.json({ success: true, message: 'Email already verified.' });
        }

        const expiresAt = user.emailVerificationExpiresAt ? new Date(user.emailVerificationExpiresAt) : null;
        if (!user.emailVerificationCodeHash || !expiresAt) {
            return res.status(400).json({ error: 'Please request a new verification code.' });
        }
        if (expiresAt.getTime() < Date.now()) {
            return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
        }

        const attempts = Number(user.emailVerificationAttempts || 0);
        if (Number.isFinite(attempts) && attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
            return res.status(429).json({ error: 'Too many attempts. Please request a new code.' });
        }

        const providedHash = hashEmailVerificationCode({ email, code: codeRaw });
        if (providedHash !== user.emailVerificationCodeHash) {
            user.emailVerificationAttempts = attempts + 1;
            await user.save();
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        user.emailVerified = true;
        user.emailVerificationCodeHash = undefined;
        user.emailVerificationExpiresAt = undefined;
        user.emailVerificationAttempts = 0;
        user.approvalStatus = 'pending';
        user.isActive = true;
        await user.save();

        await logActivity({
            actorType: 'user',
            actorId: user._id,
            actorName: `${user.firstName} ${user.lastName}`,
            action: 'user.register',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email,
            details: { email: user.email }
        });

        res.json({
            success: true,
            message: 'Email verified. Your account is pending admin approval.'
        });
    } catch (error) {
        console.error('Registration verify error:', error);
        res.status(500).json({ error: 'Failed to verify code' });
    }
});

// User Login
app.post('/api/auth/login', requireRecaptcha, async (req, res) => {
    try {
        const emailRaw = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        const email = emailRaw.toLowerCase();
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.isActive === false) {
            return res.status(403).json({ error: 'Account is inactive. Please contact the administrator.' });
        }
        if (user.emailVerified === false) {
            return res.status(403).json({ error: 'Please verify your email before logging in.' });
        }
        if (String(user.approvalStatus || '').trim().toLowerCase() === 'rejected') {
            return res.status(403).json({ error: 'Account registration was rejected. Please contact the administrator.' });
        }

        // Check password
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified !== false,
                approvalStatus: user.approvalStatus || 'approved',
                profilePhoto: user.profilePhoto || null
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Admin Login
app.post('/api/auth/admin/login', requireRecaptcha, async (req, res) => {
    try {
        const { username, password } = req.body;
        const usernameInput = (username || '').trim();
        const emailInput = usernameInput.toLowerCase();

        // Find admin (case-insensitive username or email)
        let admin = await Admin.findOne({
            $or: [
                { username: new RegExp(`^${escapeRegex(usernameInput)}$`, 'i') },
                { email: emailInput }
            ]
        });

        // In development, auto-create default admin if logging in with default creds
        if (!admin && process.env.NODE_ENV !== 'production') {
            const matchesDefault =
                [DEFAULT_ADMIN.username, DEFAULT_ADMIN.email]
                    .filter(Boolean)
                    .some((value) => value.toLowerCase() === usernameInput.toLowerCase()) &&
                password === DEFAULT_ADMIN.password;

            if (matchesDefault) {
                admin = new Admin({
                    username: DEFAULT_ADMIN.username,
                    password: DEFAULT_ADMIN.password,
                    email: DEFAULT_ADMIN.email,
                    fullName: DEFAULT_ADMIN.fullName,
                    role: 'super_admin',
                    permissions: {
                        manageKeys: true,
                        manageUsers: true,
                        manageAdmins: true,
                        generateReports: true,
                        systemSettings: true
                    },
                    isActive: true,
                    isDefault: true
                });
                await admin.save();
                console.log('✅ Default admin account created via login');
            }
        }

        if (!admin || !admin.isActive) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check password
        let isPasswordValid = await admin.comparePassword(password);
        if (!isPasswordValid) {
            const isDefaultIdentity = [DEFAULT_ADMIN.username, DEFAULT_ADMIN.email]
                .filter(Boolean)
                .some((value) => value.toLowerCase() === usernameInput.toLowerCase());

            // In development, allow resetting default admin password if it mismatched
            if (process.env.NODE_ENV !== 'production' && isDefaultIdentity && password === DEFAULT_ADMIN.password) {
                admin.password = DEFAULT_ADMIN.password;
                admin.isActive = true;
                await admin.save();
                isPasswordValid = true;
                console.log('✅ Default admin password reset to match .env');
            }
        }

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        admin.lastLogin = new Date();
        await admin.save();

        // Generate JWT token
        const token = jwt.sign(
            { id: admin._id, username: admin.username, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Admin login successful',
            token,
            admin: {
                id: admin._id,
                username: admin.username,
                fullName: admin.fullName,
                role: admin.role,
                permissions: admin.permissions
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Admin login failed' });
    }
});

// Password Reset (Teacher/User Only)
// Request a one-time reset link via email.
app.post('/api/auth/password-reset/request', async (req, res) => {
    try {
        const { email } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();

        if (!normalizedEmail) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        // Always return a generic message (avoid account enumeration)
        const message =
            "If that email exists, we'll send a one-time secure link to reset your password. " +
            `This link will expire in ${RESET_TOKEN_EXPIRE_MINUTES} minutes.`;

        const user = await User.findOne({ email: normalizedEmail, isActive: { $ne: false } });

        if (!user && REVEAL_PASSWORD_RESET_USER_EXISTS) {
            return res.status(404).json({ error: 'Email is not registered. Please create an account first.' });
        }

        // If user exists, generate + store token and attempt to send email.
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

            user.resetPasswordTokenHash = tokenHash;
            user.resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRE_MINUTES * 60 * 1000);
            await user.save();

            const resetLink = `${getAppBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
            const sent = await sendPasswordResetEmail({ to: user.email, resetLink });

            await logActivity({
                actorType: 'system',
                actorName: 'system',
                action: 'user.password_reset.request',
                targetType: 'user',
                targetId: user._id,
                targetName: user.email,
                details: { sent }
            });

            // Helpful dev fallback if SMTP isn't configured
            if (!sent && process.env.NODE_ENV !== 'production') {
                console.log('🔐 DEV password reset link (SMTP not configured):', resetLink);
            }
        }

        res.json({
            success: true,
            message: user && REVEAL_PASSWORD_RESET_USER_EXISTS
                ? `Reset link sent. This link will expire in ${RESET_TOKEN_EXPIRE_MINUTES} minutes.`
                : message
        });
    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ error: 'Failed to request password reset' });
    }
});

// Confirm reset with token + new password.
app.post('/api/auth/password-reset/confirm', async (req, res) => {
    try {
        const { token, password } = req.body;
        const rawToken = String(token || '').trim();
        const newPassword = String(password || '');

        if (!rawToken) {
            return res.status(400).json({ error: 'Reset token is required' });
        }
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const user = await User.findOne({
            resetPasswordTokenHash: tokenHash,
            resetPasswordExpiresAt: { $gt: new Date() },
            isActive: { $ne: false }
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        user.password = newPassword;
        user.resetPasswordTokenHash = undefined;
        user.resetPasswordExpiresAt = undefined;
        user.lastLogin = null;
        await user.save();

        await logActivity({
            actorType: 'system',
            actorName: 'system',
            action: 'user.password_reset.confirm',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email
        });

        res.json({ success: true, message: 'Password reset successful. You can now log in.' });
    } catch (error) {
        console.error('Password reset confirm error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Get User Profile
app.get('/api/auth/profile', authenticateToken, loadUserRecord, async (req, res) => {
    res.json({ success: true, user: req.userRecord });
});

const updateProfilePhoto = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const imageDataUrl = req.body?.imageDataUrl;
        const requested = imageDataUrl === null || imageDataUrl === undefined
            ? null
            : String(imageDataUrl).trim();

        const previousPhoto = user.profilePhoto || null;

        if (!requested) {
            if (!previousPhoto) {
                return res.json({ success: true, user: { profilePhoto: null } });
            }

            user.profilePhoto = undefined;
            user.profilePhotoUpdatedAt = new Date();
            await user.save();

            await logActivity({
                actorType: 'user',
                actorId: user._id,
                actorName: `${user.firstName} ${user.lastName}`,
                action: 'user.profile_photo.remove',
                targetType: 'user',
                targetId: user._id,
                targetName: user.email,
                details: {
                    email: user.email,
                    oldPhoto: summarizeImageDataUrl(previousPhoto),
                    newPhoto: summarizeImageDataUrl(null)
                }
            });

            return res.json({ success: true, user: { profilePhoto: null } });
        }

        const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(requested);
        if (!match) {
            return res.status(400).json({ error: 'Invalid image format' });
        }

        const mime = match[1].toLowerCase();
        const base64 = match[2];
        const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
        if (!allowed.has(mime)) {
            return res.status(400).json({ error: 'Only JPG, PNG, or WEBP images are allowed' });
        }

        const approxBytes = Math.ceil((base64.length * 3) / 4);
        const maxBytes = Number(process.env.MAX_PROFILE_PHOTO_BYTES || 250_000);
        if (!Number.isFinite(approxBytes) || approxBytes <= 0) {
            return res.status(400).json({ error: 'Invalid image data' });
        }
        if (approxBytes > maxBytes) {
            return res.status(413).json({ error: 'Profile photo is too large' });
        }

        user.profilePhoto = requested;
        user.profilePhotoUpdatedAt = new Date();
        await user.save();

        await logActivity({
            actorType: 'user',
            actorId: user._id,
            actorName: `${user.firstName} ${user.lastName}`,
            action: 'user.profile_photo.update',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email,
            details: {
                email: user.email,
                oldPhoto: summarizeImageDataUrl(previousPhoto),
                newPhoto: summarizeImageDataUrl(requested),
                mime,
                bytes: approxBytes
            }
        });

        res.json({ success: true, user: { profilePhoto: user.profilePhoto } });
    } catch (error) {
        console.error('Profile photo update error:', error);
        res.status(500).json({ error: 'Failed to update profile photo' });
    }
};

// Update Profile Photo (User)
// Support both PUT and POST to avoid method-specific client/proxy issues.
app.put('/api/auth/profile/photo', requireApprovedTeacher, rejectDuringMaintenance, updateProfilePhoto);
app.post('/api/auth/profile/photo', requireApprovedTeacher, rejectDuringMaintenance, updateProfilePhoto);

// Maintenance (Public)
app.get('/api/maintenance', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const maintenance = await getMaintenanceState();
        res.json({ success: true, maintenance });
    } catch (error) {
        console.error('Maintenance fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch maintenance state' });
    }
});

// Maintenance (Admin)
app.get('/api/admin/maintenance', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const maintenance = await getMaintenanceState({ force: true });
        res.json({ success: true, maintenance });
    } catch (error) {
        console.error('Admin maintenance fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch maintenance state' });
    }
});

app.put('/api/admin/maintenance', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const enabled = envFlag(req.body?.enabled, false);
        const titleInput = String(req.body?.title || '').trim();
        const messageInput = String(req.body?.message || '').trim();

        if (titleInput && titleInput.length > 80) {
            return res.status(400).json({ error: 'Title is too long (max 80 characters)' });
        }
        if (messageInput && messageInput.length > 800) {
            return res.status(400).json({ error: 'Message is too long (max 800 characters)' });
        }

        const title = titleInput || DEFAULT_MAINTENANCE.title;
        const message = messageInput || DEFAULT_MAINTENANCE.message;
        const adminName = String(req.admin?.username || req.admin?.fullName || '').trim();

        const doc = await Maintenance.findOneAndUpdate(
            { scope: MAINTENANCE_SCOPE },
            {
                $set: {
                    scope: MAINTENANCE_SCOPE,
                    enabled,
                    title,
                    message,
                    updatedBy: req.admin._id,
                    updatedByName: adminName
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        const maintenance = buildMaintenancePayload(doc);
        maintenanceCache = maintenance;
        maintenanceCacheLoadedAt = Date.now();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: adminName,
            action: enabled ? 'system.maintenance.enable' : 'system.maintenance.disable',
            targetType: 'system',
            targetName: 'maintenance',
            details: { enabled, title }
        });

        res.json({ success: true, maintenance });
    } catch (error) {
        console.error('Admin maintenance update error:', error);
        res.status(500).json({ error: 'Failed to update maintenance state' });
    }
});

app.get('/api/admin/locker-controller/status', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const controller = await getControllerStatus();
        res.json({ success: true, controller });
    } catch (error) {
        console.error('Locker controller status error:', error);
        res.status(500).json({
            error: 'Failed to check locker controller',
            controller: {
                enabled: LOCKER_CONTROLLER_ENABLED,
                required: LOCKER_CONTROLLER_REQUIRED,
                connected: false,
                reason: 'check_failed',
                message: error.message || 'Controller check failed',
                ssidHint: LOCKER_CONTROLLER_SSID_HINT,
                ipHint: LOCKER_CONTROLLER_IP_HINT,
                configuredMaxLocks: LOCKER_CONTROLLER_MAX_LOCKS
            }
        });
    }
});

app.get('/api/admin/settings/access-qr-pack', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const controller = await getControllerStatus().catch(() => null);
        const tunnelState = readCloudflareTunnelState();
        const localSystemUrls = readLocalSystemUrls();
        const requestBaseUrl = `${getRequestProtocol(req)}://${req.get('host')}`;
        const publicAppUrl = String(tunnelState?.publicUrl || getAppBaseUrl(req) || requestBaseUrl || '').trim().replace(/\/+$/, '');
        const controllerBaseUrl = String(controller?.baseUrl || controller?.ipHint || '').trim().replace(/\/+$/, '');
        const espPortalUrl = selectPreferredEspPortalUrl({
            urls: localSystemUrls,
            fallbackUrl: controllerBaseUrl || publicAppUrl
        }).replace(/\/+$/, '');
        const usingCloudflare = Boolean(String(tunnelState?.publicUrl || '').trim());

        const candidates = [
            {
                id: 'public-app',
                title: usingCloudflare ? 'Cloudflare Public App URL' : 'Public App URL',
                description: usingCloudflare
                    ? 'Use this QR to open the live app through the active Cloudflare tunnel address.'
                    : 'Use this QR to open the live app through the current reachable app address.',
                url: publicAppUrl,
                sourceLabel: usingCloudflare ? 'Cloudflare tunnel' : 'Current app address'
            },
            {
                id: 'esp-portal-url',
                title: 'ESP Portal URL',
                description: 'Use this QR to open the fast ESP portal target, matching the LAN portal URL shown in the CMD launcher.',
                url: espPortalUrl,
                sourceLabel: 'Fast LAN / ESP portal'
            }
        ];

        const items = [];
        const seenUrls = new Set();
        for (const candidate of candidates) {
            const url = String(candidate?.url || '').trim();
            if (!url) continue;
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            items.push({
                ...candidate,
                url,
                expiresLabel: 'No expiration',
                qrCodeImage: await generateUrlQrCodeDataUrl(url)
            });
        }

        res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            items,
            controller: controller || null,
            tunnel: tunnelState || null
        });
    } catch (error) {
        console.error('Access QR pack error:', error);
        res.status(500).json({ error: 'Failed to prepare access QR pack' });
    }
});

// Keys Management
// Lockers Management (Admin)
app.get('/api/lockers', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        let lockers = await Locker.find().sort({ name: 1 });

        // If lockers haven't been initialized yet (older DB), derive from keys once.
        if (lockers.length === 0) {
            const lockerNames = await Key.distinct('locker', { locker: { $nin: [null, ''] } });
            const uniqueNames = (lockerNames || [])
                .map((name) => String(name || '').trim())
                .filter(Boolean);

            if (uniqueNames.length > 0) {
                try {
                    await Locker.insertMany(uniqueNames.map((name) => ({ name })), { ordered: false });
                } catch (error) {
                    if (!(error && error.code === 11000)) throw error;
                }
            }

            lockers = await Locker.find().sort({ name: 1 });
        }

        res.json({ success: true, lockers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch lockers' });
    }
});

app.post('/api/lockers', authenticateAdmin, async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        if (!name) {
            return res.status(400).json({ error: 'Locker name is required' });
        }

        const requestedHardwareLockNumber = normalizeHardwareLockNumberValue(req.body?.hardwareLockNumber);
        const derivedHardwareLockNumber = deriveHardwareLockNumberFromLockerName(name);
        const hardwareLockNumber = requestedHardwareLockNumber
            || derivedHardwareLockNumber
            || await getNextHardwareLockNumber();

        if (!hardwareLockNumber) {
            return res.status(400).json({ error: 'No available hardware lock number. Increase LOCKER_CONTROLLER_MAX_LOCKS or free a locker slot.' });
        }
        if (hardwareLockNumber > LOCKER_CONTROLLER_MAX_LOCKS) {
            return res.status(400).json({ error: `Hardware lock number must be 1-${LOCKER_CONTROLLER_MAX_LOCKS}` });
        }

        const existing = await Locker.findOne({
            name: new RegExp(`^${escapeRegex(name)}$`, 'i')
        });
        if (existing) {
            return res.status(400).json({ error: 'Locker already exists' });
        }

        const existingHardware = await Locker.findOne({ hardwareLockNumber });
        if (existingHardware) {
            return res.status(400).json({ error: `Hardware Lock ${hardwareLockNumber} is already assigned to ${existingHardware.name}` });
        }

        const locker = new Locker({ name, hardwareLockNumber });
        await locker.save();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'locker.create',
            targetType: 'locker',
            targetId: locker._id,
            targetName: locker.name,
            details: { hardwareLockNumber }
        });

        res.status(201).json({ success: true, locker });
    } catch (error) {
        // handle potential unique index conflicts
        if (error && error.code === 11000) {
            return res.status(400).json({ error: 'Locker already exists' });
        }
        res.status(500).json({ error: 'Failed to create locker' });
    }
});

app.delete('/api/lockers/:id', authenticateAdmin, async (req, res) => {
    try {
        const locker = await Locker.findById(req.params.id);
        if (!locker) {
            return res.status(404).json({ error: 'Locker not found' });
        }

        const lockerName = String(locker.name || '').trim();
        const lockerRegex = new RegExp(`^${escapeRegex(lockerName)}$`, 'i');

        const affectedKeys = await Key.countDocuments({ locker: lockerRegex });
        if (affectedKeys > 0) {
            await Key.updateMany({ locker: lockerRegex }, { $set: { locker: '' } });
        }

        await Locker.deleteOne({ _id: locker._id });

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'locker.delete',
            targetType: 'locker',
            targetId: locker._id,
            targetName: lockerName,
            details: { movedKeysToUnassigned: affectedKeys }
        });

        res.json({ success: true, movedKeys: affectedKeys });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete locker' });
    }
});

// Feedback (Teachers)
app.post('/api/feedback', requireApprovedTeacher, rejectDuringMaintenance, async (req, res) => {
    try {
        const message = String(req.body?.message || '').trim();
        const anonymous = Boolean(req.body?.anonymous);
        const emailInput = String(req.body?.email || '').trim();

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        if (message.length > 2000) {
            return res.status(400).json({ error: 'Message is too long (max 2000 characters)' });
        }

        const feedback = new Feedback({
            message,
            anonymous,
            userId: anonymous ? null : req.user.id,
            email: anonymous ? '' : (emailInput || String(req.user.email || '').trim())
        });

        await feedback.save();

        await logActivity({
            actorType: 'user',
            actorId: req.user.id,
            actorName: req.user.email || '',
            action: 'feedback.create',
            targetType: 'feedback',
            targetId: feedback._id,
            targetName: anonymous ? 'anonymous' : (feedback.email || req.user.email || ''),
            details: { anonymous }
        });

        res.status(201).json({ success: true, feedback });
    } catch (error) {
        console.error('Feedback error:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

// Lost Key Reports (Teachers)
app.post('/api/lost-reports', requireApprovedTeacher, rejectDuringMaintenance, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const keyId = String(req.body?.keyId || '').trim().toUpperCase();
        const message = String(req.body?.message || '').trim();

        if (!/^KEY\d{3}$/.test(keyId)) {
            return res.status(400).json({ error: 'Invalid key id' });
        }

        const key = await Key.findOne({ keyId });
        if (!key) {
            return res.status(404).json({ error: 'Key not found' });
        }

        if (String(key.status || '').toLowerCase() !== 'borrowed' || !key.borrowedBy) {
            return res.status(400).json({ error: 'Only borrowed keys can be reported as lost' });
        }

        if (String(key.borrowedBy) !== String(req.user.id)) {
            return res.status(403).json({ error: 'You can only report keys you currently borrowed' });
        }

        const existing = await LostReport.findOne({
            keyId,
            reportedBy: req.user.id,
            status: { $in: ['pending', 'open'] }
        }).select('_id');
        if (existing) {
            return res.status(409).json({ error: 'A lost report for this key is already pending' });
        }

        const report = new LostReport({
            keyId: key.keyId,
            locker: String(key.locker || '').trim(),
            room: String(key.room || '').trim(),
            building: String(key.building || '').trim(),
            message,
            reportedBy: req.user.id,
            reportedByEmail: String(req.userRecord?.email || req.user?.email || '').trim().toLowerCase()
        });
        await report.save();

        key.status = 'lost';
        await key.save();

        await logActivity({
            actorType: 'user',
            actorId: req.user.id,
            actorName: req.userRecord?.email || req.user?.email || '',
            action: 'key.report_lost',
            targetType: 'key',
            targetId: key._id,
            targetName: key.keyId,
            details: {
                reportId: report._id,
                locker: report.locker,
                room: report.room,
                building: report.building,
                message: report.message
            }
        });

        res.status(201).json({ success: true, report });
    } catch (error) {
        console.error('Lost report error:', error);
        res.status(500).json({ error: 'Failed to submit lost report' });
    }
});

app.get('/api/lost-reports/my', requireApprovedTeacher, rejectDuringMaintenance, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const reports = await LostReport.find({ reportedBy: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        res.json({ success: true, reports });
    } catch (error) {
        console.error('Lost report fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch lost reports' });
    }
});

// Feedback (Admin)
app.get('/api/admin/feedback', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const search = String(req.query?.search || '').trim();
        const status = String(req.query?.status || 'all').trim().toLowerCase();
        const page = clampInt(req.query?.page, 1, { min: 1, max: 100000 });
        const limit = clampInt(req.query?.limit, 100, { min: 1, max: 500 });

        const query = {};
        if (status === 'new') query.isRead = false;
        if (status === 'read') query.isRead = true;

        if (search) {
            query.$or = [
                { message: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const [feedback, total] = await Promise.all([
            Feedback.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Feedback.countDocuments(query)
        ]);

        res.json({
            success: true,
            feedback,
            totalPages: Math.max(1, Math.ceil(total / limit)),
            currentPage: page,
            total
        });
    } catch (error) {
        console.error('Admin feedback fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

app.patch('/api/admin/feedback/:id', authenticateAdmin, async (req, res) => {
    try {
        const feedback = await Feedback.findById(req.params.id);
        if (!feedback) {
            return res.status(404).json({ error: 'Feedback not found' });
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isRead')) {
            feedback.isRead = Boolean(req.body.isRead);
            feedback.readAt = feedback.isRead ? new Date() : null;
        }

        await feedback.save();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'feedback.update',
            targetType: 'feedback',
            targetId: feedback._id,
            targetName: feedback.email || (feedback.anonymous ? 'anonymous' : 'feedback'),
            details: { isRead: feedback.isRead }
        });

        res.json({ success: true, feedback });
    } catch (error) {
        console.error('Admin feedback update error:', error);
        res.status(500).json({ error: 'Failed to update feedback' });
    }
});

app.delete('/api/admin/feedback/:id', authenticateAdmin, async (req, res) => {
    try {
        const feedback = await Feedback.findByIdAndDelete(req.params.id);
        if (!feedback) {
            return res.status(404).json({ error: 'Feedback not found' });
        }

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'feedback.delete',
            targetType: 'feedback',
            targetId: feedback._id,
            targetName: feedback.email || (feedback.anonymous ? 'anonymous' : 'feedback')
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Admin feedback delete error:', error);
        res.status(500).json({ error: 'Failed to delete feedback' });
    }
});

// Lost Key Reports (Admin)
app.get('/api/admin/lost-reports', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const pageRaw = Number.parseInt(String(req.query?.page || '1'), 10);
        const limitRaw = Number.parseInt(String(req.query?.limit || '50'), 10);
        const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

        const search = String(req.query?.search || '').trim();
        const status = String(req.query?.status || 'all').trim().toLowerCase();
        const read = String(req.query?.read || 'all').trim().toLowerCase();

        const query = {};
        if (status === 'open' || status === 'resolved') {
            query.status = status;
        } else if (status && status !== 'all') {
            return res.status(400).json({ error: 'Invalid status filter' });
        }

        if (read === 'unread') {
            query.adminReadAt = null;
        } else if (read === 'read') {
            query.adminReadAt = { $ne: null };
        } else if (read && read !== 'all') {
            return res.status(400).json({ error: 'Invalid read filter' });
        }

        if (search) {
            query.$or = [
                { keyId: { $regex: search, $options: 'i' } },
                { room: { $regex: search, $options: 'i' } },
                { locker: { $regex: search, $options: 'i' } },
                { building: { $regex: search, $options: 'i' } },
                { reportedByEmail: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } }
            ];
        }

        const reports = await LostReport.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const total = await LostReport.countDocuments(query);

        res.json({
            success: true,
            reports,
            totalPages: Math.max(1, Math.ceil(total / limit)),
            currentPage: page,
            total
        });
    } catch (error) {
        console.error('Admin lost reports fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch lost reports' });
    }
});

const updateAdminLostReport = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid report id' });
        }

        const report = await LostReport.findById(id);
        if (!report) {
            return res.status(404).json({ error: 'Lost report not found' });
        }

        const now = new Date();
        const adminName = String(req.admin?.username || req.admin?.fullName || '').trim();
        const body = req.body || {};

        let didRead = false;
        let didReply = false;
        let didResolve = false;
        let didReopen = false;
        let didUpdate = false;

        if (Object.prototype.hasOwnProperty.call(body, 'markRead') && Boolean(body.markRead)) {
            if (!report.adminReadAt) {
                report.adminReadAt = now;
                report.adminReadBy = req.admin._id;
                report.adminReadByName = adminName;
                didRead = true;
                didUpdate = true;
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'reply')) {
            const reply = String(body.reply || '').trim();
            if (reply.length > 1200) {
                return res.status(400).json({ error: 'Reply is too long (max 1200 characters)' });
            }

            report.adminReply = reply;
            report.adminRepliedAt = reply ? now : null;
            report.adminRepliedBy = reply ? req.admin._id : null;
            report.adminRepliedByName = reply ? adminName : '';

            didReply = Boolean(reply);
            didUpdate = true;

            if (!report.adminReadAt) {
                report.adminReadAt = now;
                report.adminReadBy = req.admin._id;
                report.adminReadByName = adminName;
                didRead = true;
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'resolutionNote')) {
            const note = String(body.resolutionNote || '').trim();
            if (note.length > 400) {
                return res.status(400).json({ error: 'Resolution note is too long (max 400 characters)' });
            }
            report.resolutionNote = note;
            didUpdate = true;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
            const rawNextStatus = String(body.status || '').trim().toLowerCase();
            const nextStatus = rawNextStatus === 'open' ? 'pending' : rawNextStatus;
            if (nextStatus !== 'pending' && nextStatus !== 'resolved') {
                return res.status(400).json({ error: 'Invalid status value' });
            }

            const prevRawStatus = String(report.status || 'pending').trim().toLowerCase();
            const prevStatus = prevRawStatus === 'open' ? 'pending' : prevRawStatus;
            if (nextStatus !== prevStatus) {
                report.status = nextStatus;
                didUpdate = true;

                if (nextStatus === 'resolved') {
                    report.resolvedAt = now;
                    report.resolvedBy = req.admin._id;
                    didResolve = true;
                } else {
                    report.resolvedAt = null;
                    report.resolvedBy = null;
                    didReopen = true;
                }

                if (!report.adminReadAt) {
                    report.adminReadAt = now;
                    report.adminReadBy = req.admin._id;
                    report.adminReadByName = adminName;
                    didRead = true;
                }

                const keyDoc = await Key.findOne({ keyId: report.keyId });
                if (keyDoc) {
                    const keyStatus = String(keyDoc.status || '').trim().toLowerCase();

                    if (nextStatus === 'resolved') {
                        const shouldRestoreKey = keyStatus === 'lost';
                        if (shouldRestoreKey) {
                            const borrowerId = keyDoc.borrowedBy || report.reportedBy;
                            const locker = String(keyDoc.locker || report.locker || '').trim();
                            const building = String(report.building || keyDoc.building || '').trim();
                            const room = String(report.room || keyDoc.room || '').trim();
                            const location = [building, room].filter(Boolean).join(' • ');
                            const sessionId = String(keyDoc.currentBorrowSessionId || '').trim() || new mongoose.Types.ObjectId().toString();

                            keyDoc.status = 'available';
                            keyDoc.borrowedBy = null;
                            keyDoc.borrowedAt = null;
                            keyDoc.currentBorrowSessionId = null;
                            await keyDoc.save();

                            if (borrowerId) {
                                await createTransactionRecord({
                                    keyId: keyDoc.keyId,
                                    locker,
                                    userId: borrowerId,
                                    action: 'return',
                                    location,
                                    performedAt: now,
                                    sessionId,
                                    notes: report.resolutionNote
                                        ? `Recovered via lost report resolution: ${report.resolutionNote}`
                                        : 'Recovered via lost report resolution',
                                    scannedBy: 'admin'
                                });
                            }
                        }
                    } else if (nextStatus === 'pending' && prevStatus === 'resolved') {
                        // If a resolved report is reopened, try to restore the "lost" key state.
                        if (keyStatus === 'available') {
                            keyDoc.status = 'lost';
                            if (!keyDoc.borrowedBy && report.reportedBy) {
                                keyDoc.borrowedBy = report.reportedBy;
                            }
                            if (!keyDoc.borrowedAt) {
                                keyDoc.borrowedAt = report.createdAt || now;
                            }
                            if (!keyDoc.currentBorrowSessionId) {
                                keyDoc.currentBorrowSessionId = new mongoose.Types.ObjectId().toString();
                            }
                            await keyDoc.save();
                        }
                    }
                }
            }
        }

        if (!didUpdate) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        await report.save();

        const action = didResolve
            ? 'lost_report.resolve'
            : didReopen
                ? 'lost_report.reopen'
                : didReply
                    ? 'lost_report.reply'
                    : didRead
                        ? 'lost_report.read'
                        : 'lost_report.update';

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: adminName || req.admin.username,
            action,
            targetType: 'lost_report',
            targetId: report._id,
            targetName: report.keyId,
            details: {
                status: report.status,
                reportedByEmail: report.reportedByEmail,
                room: report.room,
                locker: report.locker,
                replied: Boolean(report.adminReply),
                readAt: report.adminReadAt,
                resolvedAt: report.resolvedAt
            }
        });

        res.json({ success: true, report });
    } catch (error) {
        console.error('Admin lost report update error:', error);
        res.status(500).json({ error: 'Failed to update lost report' });
    }
};

const deleteAdminLostReport = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid report id' });
        }

        const report = await LostReport.findById(id);
        if (!report) {
            return res.status(404).json({ error: 'Lost report not found' });
        }

        const status = String(report.status || 'open').trim().toLowerCase();
        if (status !== 'resolved') {
            return res.status(400).json({ error: 'Only resolved lost reports can be deleted' });
        }

        const keyId = String(report.keyId || '').trim();
        const reporterEmail = String(report.reportedByEmail || '').trim();
        const room = String(report.room || '').trim();
        const locker = String(report.locker || '').trim();

        await report.deleteOne();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.fullName || req.admin.username,
            action: 'lost_report.delete',
            targetType: 'lost_report',
            targetId: id,
            targetName: keyId,
            details: { reporterEmail, room, locker }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Admin lost report delete error:', error);
        res.status(500).json({ error: 'Failed to delete lost report' });
    }
};

// Support PATCH + POST + PUT for environments that block certain HTTP methods.
app.patch('/api/admin/lost-reports/:id', authenticateAdmin, updateAdminLostReport);
app.put('/api/admin/lost-reports/:id', authenticateAdmin, updateAdminLostReport);
app.post('/api/admin/lost-reports/:id', authenticateAdmin, updateAdminLostReport);
app.delete('/api/admin/lost-reports/:id', authenticateAdmin, deleteAdminLostReport);
app.post('/api/admin/lost-reports/:id/delete', authenticateAdmin, deleteAdminLostReport);

// Backwards-compatible alias (older clients).
app.patch('/api/admin/lost-report/:id', authenticateAdmin, updateAdminLostReport);
app.put('/api/admin/lost-report/:id', authenticateAdmin, updateAdminLostReport);
app.post('/api/admin/lost-report/:id', authenticateAdmin, updateAdminLostReport);
app.delete('/api/admin/lost-report/:id', authenticateAdmin, deleteAdminLostReport);
app.post('/api/admin/lost-report/:id/delete', authenticateAdmin, deleteAdminLostReport);

app.get('/api/keys', requireApprovedTeacher, rejectDuringMaintenance, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const keys = await Key.find()
            .populate('borrowedBy', 'firstName lastName email')
            .sort({ keyId: 1 });
        res.json({ success: true, keys });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch keys' });
    }
});

// Get Keys (Admin)
app.get('/api/admin/keys', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const keys = await Key.find()
            .populate('borrowedBy', 'firstName lastName email')
            .sort({ keyId: 1 });
        res.json({ success: true, keys });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch keys' });
    }
});

app.post('/api/keys', authenticateAdmin, async (req, res) => {
    try {
        const { keyId, locker, room, building, description } = req.body;
        const lockerProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'locker');
        const normalizedKeyId = String(keyId || '').trim().toUpperCase();
        const normalizedLocker = lockerProvided ? String(locker || '').trim() : '';

        // Check if key exists
        const existingKey = await Key.findOne({ keyId: normalizedKeyId });
        if (existingKey) {
            return res.status(400).json({ error: 'Key ID already exists' });
        }

        const key = new Key({
            keyId: normalizedKeyId,
            locker: lockerProvided ? normalizedLocker : deriveLockerFromKeyId(normalizedKeyId),
            room,
            building,
            description,
            status: 'available'
        });

        if (key.locker) {
            const lockerDoc = await Locker.findOne({
                name: new RegExp(`^${escapeRegex(key.locker)}$`, 'i')
            });
            if (lockerDoc) {
                key.locker = lockerDoc.name;
            } else {
                let createdLocker = null;
                try {
                    createdLocker = await new Locker({ name: key.locker }).save();
                } catch (error) {
                    // ignore duplicates if created in parallel
                    if (!(error && error.code === 11000)) throw error;
                }
                if (createdLocker) {
                    await logActivity({
                        actorType: 'admin',
                        actorId: req.admin._id,
                        actorName: req.admin.username,
                        action: 'locker.create_auto',
                        targetType: 'locker',
                        targetId: createdLocker._id,
                        targetName: createdLocker.name,
                        details: {
                            source: 'key.create',
                            keyId: normalizedKeyId
                        }
                    });
                }
            }
        }

        await key.save();
        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'key.create',
            targetType: 'key',
            targetId: key._id,
            targetName: key.keyId,
            details: { locker: key.locker, room, building }
        });
        res.status(201).json({ success: true, key });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create key' });
    }
});

app.put('/api/keys/:id', authenticateAdmin, async (req, res) => {
    try {
        const key = await Key.findOne({ keyId: req.params.id });
        if (!key) {
            return res.status(404).json({ error: 'Key not found' });
        }

        const updates = { ...(req.body || {}) };
        if (Object.prototype.hasOwnProperty.call(updates, 'locker')) {
            updates.locker = String(updates.locker || '').trim();
            if (updates.locker) {
                const lockerDoc = await Locker.findOne({
                    name: new RegExp(`^${escapeRegex(updates.locker)}$`, 'i')
                });
                if (lockerDoc) {
                    updates.locker = lockerDoc.name;
                } else {
                    let createdLocker = null;
                    try {
                        createdLocker = await new Locker({ name: updates.locker }).save();
                    } catch (error) {
                        if (!(error && error.code === 11000)) throw error;
                    }
                    if (createdLocker) {
                        await logActivity({
                            actorType: 'admin',
                            actorId: req.admin._id,
                            actorName: req.admin.username,
                            action: 'locker.create_auto',
                            targetType: 'locker',
                            targetId: createdLocker._id,
                            targetName: createdLocker.name,
                            details: {
                                source: 'key.update',
                                keyId: key.keyId
                            }
                        });
                    }
                }
            }
        }

        Object.assign(key, updates);
        await key.save();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'key.update',
            targetType: 'key',
            targetId: key._id,
            targetName: key.keyId,
            details: updates
        });
        res.json({ success: true, key });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update key' });
    }
});

app.delete('/api/keys/:id', authenticateAdmin, async (req, res) => {
    try {
        const keyId = String(req.params.id || '').trim().toUpperCase();
        const key = await Key.findOne({ keyId });
        if (!key) {
            return res.status(404).json({ error: 'Key not found' });
        }

        // Clean up related QR codes so analytics + database explorer stay accurate.
        const qrDocs = await QRCodeModel.find({ keyId }).select('_id').lean();
        const qrIds = (qrDocs || []).map((d) => d?._id).filter(Boolean);
        if (qrIds.length > 0) {
            await Transaction.updateMany(
                { qrCodeId: { $in: qrIds } },
                { $unset: { qrCodeId: '' } }
            );
        }
        const qrDeleteResult = await QRCodeModel.deleteMany({ keyId });

        await Key.deleteOne({ _id: key._id });

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'key.delete',
            targetType: 'key',
            targetId: key._id,
            targetName: key.keyId,
            details: { deletedQRCodes: Number(qrDeleteResult?.deletedCount || 0) || 0 }
        });
        res.json({
            success: true,
            message: 'Key deleted successfully',
            deletedQRCodes: Number(qrDeleteResult?.deletedCount || 0) || 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete key' });
    }
});

// Generate QR Code
app.post('/api/qrcodes/generate', authenticateAdmin, async (req, res) => {
    try {
        const { keyId, room, purpose } = req.body;
        const keyIdNorm = String(keyId || '').trim().toUpperCase();
        const roomNorm = String(room || '').trim();
        const normalizedPurpose = normalizeQrPurpose(purpose, 'unified');
        if (!/^KEY\d{3}$/.test(keyIdNorm)) {
            return res.status(400).json({ error: 'Invalid key id' });
        }
        if (!roomNorm) {
            return res.status(400).json({ error: 'Room is required' });
        }

        // Check if key exists
        const key = await Key.findOne({ keyId: keyIdNorm });
        if (!key) {
            return res.status(404).json({ error: 'Key not found' });
        }
        const { qrCode, qrData, qrCodeDataUrl, isUpdate } = await ensureUnifiedQrForKey({
            key,
            adminId: req.admin._id,
            roomOverride: roomNorm,
            forceRegenerate: true
        });

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'qrcode.generate',
            targetType: 'qrcode',
            targetId: qrCode._id,
            targetName: keyIdNorm,
            details: { room: roomNorm, purpose: normalizedPurpose, updatedExisting: isUpdate }
        });

        res.json({
            success: true,
            qrCode: qrCodeDataUrl,
            qrData,
            qrCodeId: qrCode._id
        });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

app.get('/api/admin/qrcodes/export-pack', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const keys = await Key.find().sort({ keyId: 1 });
        if (!Array.isArray(keys) || keys.length === 0) {
            return res.status(404).json({ error: 'No keys found to export' });
        }

        const items = [];
        for (const key of keys) {
            const { qrCode, room } = await ensureUnifiedQrForKey({
                key,
                adminId: req.admin._id
            });

            items.push({
                id: String(qrCode._id),
                keyId: String(key.keyId || '').trim().toUpperCase(),
                room: room,
                building: String(key.building || '').trim(),
                locker: String(key.locker || '').trim(),
                qrCodeImage: String(qrCode.qrCodeImage || '').trim(),
                validityLabel: 'No expiration'
            });
        }

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'qrcode.export_pack',
            targetType: 'qrcode',
            targetName: 'all_keys',
            details: { totalKeys: items.length }
        });

        res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            total: items.length,
            items
        });
    } catch (error) {
        console.error('QR export pack error:', error);
        res.status(500).json({ error: 'Failed to prepare QR export pack' });
    }
});

// Scan QR Code
app.post('/api/qrcodes/scan', requireApprovedTeacher, rejectDuringMaintenance, async (req, res) => {
    try {
        const { qrData } = req.body;
        const requestedAction = String(req.body?.action || req.body?.intent || '').trim().toLowerCase();
        const expectedKeyId = String(req.body?.expectedKeyId || '').trim().toUpperCase();
        const controllerUnlockProof = String(req.body?.controllerUnlockProof || '').trim();
        const scanAt = new Date();

        // Parse QR data
        let parsedData;
        try {
            parsedData = JSON.parse(qrData);
        } catch (error) {
            return res.status(400).json({ error: 'Invalid QR code format' });
        }

        parsedData = {
            ...parsedData,
            keyId: String(parsedData?.keyId || '').trim().toUpperCase(),
            uniqueId: String(parsedData?.uniqueId || '').trim()
        };

        // Validate requested action when a scanner page was opened for a specific flow.
        if (requestedAction && !['borrow', 'return'].includes(requestedAction)) {
            return res.status(400).json({ error: 'Invalid action' });
        }

        if (!parsedData.keyId || !parsedData.uniqueId) {
            return res.status(400).json({ error: 'Invalid QR code data' });
        }

        // Find QR code in database
        const qrCode = await QRCodeModel.findOne({
            'qrData.uniqueId': parsedData.uniqueId
        });

        if (!qrCode) {
            return res.status(400).json({ error: 'Invalid QR code' });
        }

        if (qrCode.expiresAt && new Date(qrCode.expiresAt) < scanAt) {
            return res.status(400).json({ error: 'QR code has expired' });
        }

        const normalizedStoredPurpose = normalizeQrPurpose(qrCode.purpose, 'unified');
        if (String(qrCode.purpose || '').trim() !== normalizedStoredPurpose) {
            qrCode.purpose = normalizedStoredPurpose;
        }

        // Ensure QR code was generated by an active admin
        if (!qrCode.generatedBy) {
            return res.status(400).json({ error: 'QR code not authorized' });
        }
        const adminExists = await Admin.exists({ _id: qrCode.generatedBy, isActive: true });
        if (!adminExists) {
            return res.status(400).json({ error: 'QR code not authorized' });
        }

        // Extra safety: ensure scanned data matches stored QR data
        if (parsedData.keyId !== qrCode.keyId) {
            return res.status(400).json({ error: 'QR code data mismatch' });
        }
        if (expectedKeyId && expectedKeyId !== qrCode.keyId) {
            return res.status(400).json({ error: `Scanned QR is for ${qrCode.keyId}, but selected key is ${expectedKeyId}` });
        }

        // Find key
        const key = await Key.findOne({ keyId: parsedData.keyId });
        if (!key) {
            return res.status(404).json({ error: 'Key not found' });
        }

        const keyBorrowedByCurrentUser = key.borrowedBy && String(key.borrowedBy) === String(req.user.id);
        const action = requestedAction || (String(key.status || '').toLowerCase() === 'borrowed' && keyBorrowedByCurrentUser ? 'return' : 'borrow');
        if (!['borrow', 'return'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action' });
        }

        const hardwareLockNumber = await getHardwareLockNumberForKey(key);
        let controllerResult = { success: true, mode: 'not-triggered' };
        const triggerControllerForValidatedAction = async () => {
            if (!shouldTriggerControllerForAction(action)) {
                return;
            }
            if (!hardwareLockNumber && LOCKER_CONTROLLER_REQUIRED) {
                const error = new Error(`No hardware lock number is mapped for ${String(key.locker || key.keyId || 'this key').trim()}. Assign a Hardware Lock Number in Admin > Keys > Add Locker.`);
                error.statusCode = 400;
                error.payload = {
                    error: `No hardware lock number is mapped for ${String(key.locker || key.keyId || 'this key').trim()}. Assign a Hardware Lock Number in Admin > Keys > Add Locker.`,
                    hardwareLockNumber: null,
                    controllerMode: 'unmapped'
                };
                throw error;
            }
            if (controllerUnlockProof && verifyControllerUnlockProof(controllerUnlockProof, {
                userId: req.user.id,
                qrUniqueId: parsedData.uniqueId,
                action,
                keyId: key.keyId,
                hardwareLockNumber
            })) {
                controllerResult = { success: true, mode: 'client-direct' };
                return;
            }
            controllerResult = await unlockViaController(hardwareLockNumber);
            if (!controllerResult.success && LOCKER_CONTROLLER_REQUIRED) {
                const error = new Error(controllerResult.message || 'Locker controller did not unlock. Connect the ESP over Wi-Fi or USB, then scan again.');
                error.statusCode = 503;
                error.payload = {
                    error: controllerResult.message || 'Locker controller did not unlock. Connect the ESP over Wi-Fi or USB, then scan again.',
                    controllerUnlockRequired: true,
                    controllerUnlockProof: createControllerUnlockProof({
                        userId: req.user.id,
                        qrUniqueId: parsedData.uniqueId,
                        action,
                        keyId: key.keyId,
                        hardwareLockNumber
                    }),
                    controllerUnlockUrls: controllerResult.unlockUrls || [],
                    hardwareLockNumber,
                    controllerMode: controllerResult.mode || 'failed'
                };
                throw error;
            }
        };

        // Handle borrow action
        if (action === 'borrow') {
            if (key.status !== 'available') {
                return res.status(400).json({ error: 'Key is not available' });
            }

            try {
                await triggerControllerForValidatedAction();
            } catch (error) {
                return res.status(error.statusCode || 500).json(error.payload || { error: error.message || 'Locker controller did not unlock' });
            }

            const sessionId = new mongoose.Types.ObjectId().toString();
            key.status = 'borrowed';
            key.borrowedBy = req.user.id;
            key.borrowedAt = scanAt;
            key.currentBorrowSessionId = sessionId;
            await key.save();

            // Create transaction
            const transaction = await createTransactionRecord({
                keyId: key.keyId,
                locker: String(key.locker || '').trim(),
                userId: req.user.id,
                action: 'borrow',
                qrCodeId: qrCode._id,
                performedAt: scanAt,
                sessionId
            });

            qrCode.used = true;
            qrCode.usedAt = scanAt;
            qrCode.usedBy = req.user.id;
            await qrCode.save();

            await logActivity({
                actorType: 'user',
                actorId: req.user.id,
                actorName: req.user.email || '',
                action: 'key.borrow',
                targetType: 'key',
                targetId: key._id,
                targetName: key.keyId,
                details: {
                    qrCodeId: qrCode._id,
                    locker: String(key.locker || '').trim(),
                    room: key.room,
                    hardwareLockNumber,
                    controllerMode: controllerResult.mode || ''
                }
            });

            res.json({
                success: true,
                message: 'Key borrowed successfully',
                action,
                keyId: key.keyId,
                hardwareLockNumber,
                controllerMode: controllerResult.mode || '',
                transaction
            });

        // Handle return action
        } else if (action === 'return') {
            if (key.status !== 'borrowed' || key.borrowedBy.toString() !== req.user.id.toString()) {
                return res.status(400).json({ error: 'Key cannot be returned' });
            }

            try {
                await triggerControllerForValidatedAction();
            } catch (error) {
                return res.status(error.statusCode || 500).json(error.payload || { error: error.message || 'Locker controller did not unlock' });
            }

            const sessionId = String(key.currentBorrowSessionId || '').trim() || new mongoose.Types.ObjectId().toString();
            key.status = 'available';
            key.borrowedBy = null;
            key.borrowedAt = null;
            key.currentBorrowSessionId = null;
            await key.save();

            // Create transaction
            const transaction = await createTransactionRecord({
                keyId: key.keyId,
                locker: String(key.locker || '').trim(),
                userId: req.user.id,
                action: 'return',
                qrCodeId: qrCode._id,
                performedAt: scanAt,
                sessionId
            });

            qrCode.used = true;
            qrCode.usedAt = scanAt;
            qrCode.usedBy = req.user.id;
            await qrCode.save();

            await logActivity({
                actorType: 'user',
                actorId: req.user.id,
                actorName: req.user.email || '',
                action: 'key.return',
                targetType: 'key',
                targetId: key._id,
                targetName: key.keyId,
                details: {
                    qrCodeId: qrCode._id,
                    locker: String(key.locker || '').trim(),
                    room: key.room,
                    hardwareLockNumber,
                    controllerMode: controllerResult.mode || ''
                }
            });

            res.json({
                success: true,
                message: 'Key returned successfully',
                action,
                keyId: key.keyId,
                hardwareLockNumber,
                controllerMode: controllerResult.mode || '',
                transaction
            });
        } else {
            res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error('Error scanning QR code:', error);
        res.status(500).json({ error: 'Failed to process QR code' });
    }
});

// Manual Transaction
app.post('/api/transactions/manual', authenticateToken, async (req, res) => {
    return res.status(403).json({ error: 'Manual transactions are disabled. Please use QR scan.' });
});

// User Transactions
app.get('/api/transactions/user', requireApprovedTeacher, rejectDuringMaintenance, async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50);

        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// User Borrowed Keys
app.get('/api/keys/borrowed', requireApprovedTeacher, rejectDuringMaintenance, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const keys = await Key.find({ 
            borrowedBy: req.user.id,
            status: 'borrowed' 
        }).sort({ borrowedAt: -1 });

        res.json({ success: true, keys });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch borrowed keys' });
    }
});

// Admin Dashboard Statistics
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const totalKeys = await Key.countDocuments();
        const totalUsers = await User.countDocuments({ isActive: { $ne: false } });
        const borrowedKeys = await Key.countDocuments({ status: 'borrowed' });
        const totalTransactions = await Transaction.countDocuments();

        // Recent transactions
        const recentTransactions = await Transaction.find()
            .populate('userId', 'firstName lastName')
            .sort({ performedAt: -1, createdAt: -1 })
            .limit(10);

        // Daily statistics for the last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const dailyStats = await Transaction.aggregate([
            {
                $match: {
                    $or: [
                        { performedAt: { $gte: sevenDaysAgo } },
                        {
                            performedAt: { $exists: false },
                            createdAt: { $gte: sevenDaysAgo }
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: { $ifNull: ["$performedAt", "$createdAt"] }
                        }
                    },
                    borrows: { 
                        $sum: { $cond: [{ $eq: ["$action", "borrow"] }, 1, 0] }
                    },
                    returns: { 
                        $sum: { $cond: [{ $eq: ["$action", "return"] }, 1, 0] }
                    }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            stats: {
                totalKeys,
                totalUsers,
                borrowedKeys,
                totalTransactions
            },
            recentTransactions,
            dailyStats
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Admin Database Summary (for the Admin "Database" hub UI)
app.get('/api/admin/database/summary', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const normalizeTzOffset = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return { tzOffset: '+00:00', minutes: 0 };
            const upper = raw.toUpperCase();
            if (upper === 'Z' || upper === 'UTC') return { tzOffset: '+00:00', minutes: 0 };

            const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
            if (!match) return { tzOffset: '+00:00', minutes: 0 };

            const sign = match[1] === '-' ? -1 : 1;
            const hours = Number(match[2] || 0);
            const mins = Number(match[3] || 0);

            if (!Number.isFinite(hours) || !Number.isFinite(mins)) return { tzOffset: '+00:00', minutes: 0 };
            if (hours > 14 || mins > 59) return { tzOffset: '+00:00', minutes: 0 };

            const totalMinutes = sign * (hours * 60 + mins);
            const safeHours = String(hours).padStart(2, '0');
            const safeMins = String(mins).padStart(2, '0');
            return { tzOffset: `${sign === -1 ? '-' : '+'}${safeHours}:${safeMins}`, minutes: totalMinutes };
        };

        const formatDateForOffset = (utcDate, offsetMinutes) => {
            const shifted = new Date(utcDate.getTime() + offsetMinutes * 60 * 1000);
            const yyyy = shifted.getUTCFullYear();
            const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(shifted.getUTCDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };

        const { tzOffset, minutes: tzOffsetMinutes } = normalizeTzOffset(req.query?.tzOffset);
        const now = new Date();
        const nowShifted = new Date(now.getTime() + tzOffsetMinutes * 60 * 1000);
        const todayUtcMs = Date.UTC(
            nowShifted.getUTCFullYear(),
            nowShifted.getUTCMonth(),
            nowShifted.getUTCDate()
        ) - tzOffsetMinutes * 60 * 1000;
        // Last 7 days (including today) in the admin's timezone offset.
        const startDate = new Date(todayUtcMs - 6 * 24 * 60 * 60 * 1000);
        const qrUsedSince = new Date(now.getTime() - QR_USED_STATUS_WINDOW_SECONDS * 1000);

        const [
            userTotal,
            userInactive,
            userApprovalAgg,
            adminTotal,
            adminActive,
            keyTotal,
            keyStatusAgg,
            lockerTotal,
            txTotal,
            txLast7DaysTotal,
            txAgg,
            qrStatusAgg,
            feedbackTotal,
            feedbackUnread,
            lostReportTotal,
            lostReportPending,
            lostReportUnread,
            logsTotal,
            announcementTotal,
            announcementActive,
            announcementNotification,
            announcementPopup
        ] = await Promise.all([
            User.countDocuments({}),
            User.countDocuments({ isActive: false }),
            User.aggregate([
                {
                    $group: {
                        _id: { $ifNull: ['$approvalStatus', 'approved'] },
                        count: { $sum: 1 }
                    }
                }
            ]),
            Admin.countDocuments({}),
            Admin.countDocuments({ isActive: { $ne: false } }),
            Key.countDocuments({}),
            Key.aggregate([
                {
                    $group: {
                        _id: { $ifNull: ['$status', 'available'] },
                        count: { $sum: 1 }
                    }
                }
            ]),
            Locker.countDocuments({}),
            Transaction.countDocuments({}),
            Transaction.countDocuments({
                $or: [
                    { performedAt: { $gte: startDate } },
                    {
                        performedAt: { $exists: false },
                        createdAt: { $gte: startDate }
                    }
                ]
            }),
            Transaction.aggregate([
                {
                    $match: {
                        $or: [
                            { performedAt: { $gte: startDate } },
                            {
                                performedAt: { $exists: false },
                                createdAt: { $gte: startDate }
                            }
                        ]
                    }
                },
                {
                    $group: {
                        _id: {
                            date: {
                                $dateToString: {
                                    format: '%Y-%m-%d',
                                    date: { $ifNull: ['$performedAt', '$createdAt'] },
                                    timezone: tzOffset
                                }
                            },
                            action: '$action'
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.date': 1 } }
            ]),
            // QR codes summary (deduped): only the latest QR per key+room+purpose is counted.
            // Status rules:
            // - expired: expiresAt < now
            // - used: scanned within the last QR_USED_STATUS_WINDOW_SECONDS (and not expired)
            // - active: everything else (and not expired)
            QRCodeModel.aggregate([
                { $addFields: { __sortDate: { $ifNull: ['$regeneratedAt', '$createdAt'] } } },
                { $sort: { keyId: 1, room: 1, purpose: 1, __sortDate: -1 } },
                {
                    $group: {
                        _id: { keyId: '$keyId', room: '$room', purpose: '$purpose' },
                        doc: { $first: '$$ROOT' }
                    }
                },
                { $replaceRoot: { newRoot: '$doc' } },
                {
                    $addFields: {
                        __status: {
                            $switch: {
                                branches: [
                                    { case: { $lt: ['$expiresAt', now] }, then: 'expired' },
                                    {
                                        case: {
                                            $and: [
                                                { $gte: ['$expiresAt', now] },
                                                { $gte: ['$usedAt', qrUsedSince] }
                                            ]
                                        },
                                        then: 'used'
                                    }
                                ],
                                default: 'active'
                            }
                        }
                    }
                },
                { $group: { _id: '$__status', count: { $sum: 1 } } }
            ]),
            Feedback.countDocuments({}),
            Feedback.countDocuments({ isRead: false }),
            LostReport.countDocuments({}),
            LostReport.countDocuments({ status: { $in: ['pending', 'open'] } }),
            LostReport.countDocuments({ adminReadAt: null }),
            ActivityLog.countDocuments({}),
            Announcement.countDocuments({}),
            Announcement.countDocuments({ active: true }),
            Announcement.countDocuments({ type: 'notification' }),
            Announcement.countDocuments({ type: 'popup' })
        ]);

        const approvalCounts = { approved: 0, pending: 0, rejected: 0 };
        (userApprovalAgg || []).forEach((row) => {
            const key = String(row?._id || 'approved').trim().toLowerCase();
            if (key === 'pending' || key === 'rejected' || key === 'approved') {
                approvalCounts[key] = Number(row?.count || 0) || 0;
            } else {
                approvalCounts.approved += Number(row?.count || 0) || 0;
            }
        });

        const keyStatusCounts = { available: 0, borrowed: 0, lost: 0 };
        (keyStatusAgg || []).forEach((row) => {
            const key = String(row?._id || 'available').trim().toLowerCase();
            if (Object.prototype.hasOwnProperty.call(keyStatusCounts, key)) {
                keyStatusCounts[key] = Number(row?.count || 0) || 0;
            } else {
                keyStatusCounts.available += Number(row?.count || 0) || 0;
            }
        });

        const qrStatusCounts = { active: 0, used: 0, expired: 0 };
        (qrStatusAgg || []).forEach((row) => {
            const key = String(row?._id || 'active').trim().toLowerCase();
            if (Object.prototype.hasOwnProperty.call(qrStatusCounts, key)) {
                qrStatusCounts[key] = Number(row?.count || 0) || 0;
            } else {
                qrStatusCounts.active += Number(row?.count || 0) || 0;
            }
        });
        const qrTotal = qrStatusCounts.active + qrStatusCounts.used + qrStatusCounts.expired;

        // Build a 7-day array so charts don't skip missing days.
        const byDayMap = new Map();
        (txAgg || []).forEach((row) => {
            const date = String(row?._id?.date || '').trim();
            const action = String(row?._id?.action || '').trim().toLowerCase();
            if (!date) return;
            const existing = byDayMap.get(date) || { borrows: 0, returns: 0 };
            if (action === 'borrow') existing.borrows += Number(row?.count || 0) || 0;
            if (action === 'return') existing.returns += Number(row?.count || 0) || 0;
            byDayMap.set(date, existing);
        });

        const byDay = [];
        for (let i = 0; i < 7; i += 1) {
            const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
            const date = formatDateForOffset(d, tzOffsetMinutes);
            const entry = byDayMap.get(date) || { borrows: 0, returns: 0 };
            byDay.push({ date, borrows: entry.borrows, returns: entry.returns });
        }

        res.json({
            success: true,
            counts: {
                users: {
                    total: userTotal,
                    active: userTotal - userInactive,
                    inactive: userInactive,
                    pending: approvalCounts.pending,
                    approval: approvalCounts
                },
                admins: {
                    total: adminTotal,
                    active: adminActive,
                    inactive: adminTotal - adminActive
                },
                keys: {
                    total: keyTotal,
                    borrowed: keyStatusCounts.borrowed,
                    status: keyStatusCounts
                },
                lockers: {
                    total: lockerTotal
                },
                qrcodes: {
                    total: qrTotal,
                    active: qrStatusCounts.active,
                    used: qrStatusCounts.used,
                    expired: qrStatusCounts.expired,
                    usedWindowSeconds: QR_USED_STATUS_WINDOW_SECONDS
                },
                transactions: {
                    total: txTotal,
                    last7DaysTotal: txLast7DaysTotal,
                    byDay
                },
                feedback: {
                    total: feedbackTotal,
                    unread: feedbackUnread,
                    read: feedbackTotal - feedbackUnread
                },
                lostReports: {
                    total: lostReportTotal,
                    pending: lostReportPending,
                    open: lostReportPending,
                    unread: lostReportUnread,
                    resolved: Math.max(0, (Number(lostReportTotal || 0) || 0) - (Number(lostReportPending || 0) || 0))
                },
                logs: {
                    total: logsTotal
                },
                announcements: {
                    total: announcementTotal,
                    active: announcementActive,
                    notification: announcementNotification,
                    popup: announcementPopup
                }
            }
        });
    } catch (error) {
        console.error('Database summary error:', error);
        res.status(500).json({ error: 'Failed to fetch database summary' });
    }
});

// Admin QR Codes Management
app.get('/api/admin/qrcodes', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const mode = String(req.query?.mode || 'current').trim().toLowerCase();
        const searchValue = String(req.query?.search || '').trim();
        const statusValue = String(req.query?.status || 'all').trim().toLowerCase();
        const pageNum = clampInt(req.query?.page, 1, { min: 1, max: 100000 });
        const limitNum = clampInt(req.query?.limit, 200, { min: 1, max: 500 });

        const now = new Date();
        const usedSince = new Date(now.getTime() - QR_USED_STATUS_WINDOW_SECONDS * 1000);

        const buildStatusMatch = (value) => {
            const normalized = String(value || 'all').trim().toLowerCase();
            if (!normalized || normalized === 'all') return null;
            if (normalized === 'expired') {
                return { expiresAt: { $lt: now } };
            }
            if (normalized === 'used') {
                return { expiresAt: { $gte: now }, usedAt: { $gte: usedSince } };
            }
            if (normalized === 'active') {
                return {
                    expiresAt: { $gte: now },
                    $or: [{ usedAt: null }, { usedAt: { $lt: usedSince } }]
                };
            }
            return 'INVALID';
        };

        const statusMatch = buildStatusMatch(statusValue);
        if (statusMatch === 'INVALID') {
            return res.status(400).json({ error: 'Invalid status filter' });
        }

        const searchQuery = {};
        if (searchValue) {
            searchQuery.$or = [
                { keyId: { $regex: searchValue, $options: 'i' } },
                { room: { $regex: searchValue, $options: 'i' } }
            ];
        }

        if (mode === 'raw') {
            const query = { ...searchQuery };
            if (statusMatch) Object.assign(query, statusMatch);

            const qrcodes = await QRCodeModel.find(query)
                .populate('generatedBy', 'username fullName')
                .populate('usedBy', 'firstName lastName email')
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean();

            const total = await QRCodeModel.countDocuments(query);

            const withStatus = (qrcodes || []).map((qr) => {
                const expiresAt = qr?.expiresAt ? new Date(qr.expiresAt) : null;
                const usedAt = qr?.usedAt ? new Date(qr.usedAt) : null;
                const computedStatus = (expiresAt && expiresAt < now)
                    ? 'expired'
                    : (usedAt && usedAt >= usedSince)
                        ? 'used'
                        : 'active';
                return { ...qr, status: computedStatus };
            });

            return res.json({
                success: true,
                qrcodes: withStatus,
                totalPages: Math.ceil(total / limitNum),
                currentPage: pageNum,
                total,
                mode: 'raw',
                usedWindowSeconds: QR_USED_STATUS_WINDOW_SECONDS
            });
        }

        if (mode !== 'current') {
            return res.status(400).json({ error: 'Invalid mode' });
        }

        const skip = (pageNum - 1) * limitNum;
        const statusMatchStage = statusValue && statusValue !== 'all'
            ? { $match: { __status: statusValue } }
            : null;

        const pipeline = [
            { $match: searchQuery },
            { $addFields: { __sortDate: { $ifNull: ['$regeneratedAt', '$createdAt'] } } },
            { $sort: { keyId: 1, room: 1, purpose: 1, __sortDate: -1 } },
            {
                $group: {
                    _id: { keyId: '$keyId', room: '$room', purpose: '$purpose' },
                    doc: { $first: '$$ROOT' }
                }
            },
            { $replaceRoot: { newRoot: '$doc' } },
            {
                $addFields: {
                    __status: {
                        $switch: {
                            branches: [
                                { case: { $lt: ['$expiresAt', now] }, then: 'expired' },
                                {
                                    case: {
                                        $and: [
                                            { $gte: ['$expiresAt', now] },
                                            { $gte: ['$usedAt', usedSince] }
                                        ]
                                    },
                                    then: 'used'
                                }
                            ],
                            default: 'active'
                        }
                    }
                }
            },
            ...(statusMatchStage ? [statusMatchStage] : []),
            { $sort: { __sortDate: -1 } },
            {
                $facet: {
                    rows: [
                        { $skip: skip },
                        { $limit: limitNum },
                        { $addFields: { status: '$__status' } },
                        { $unset: ['__status', '__sortDate'] }
                    ],
                    totalCount: [{ $count: 'count' }]
                }
            }
        ];

        const agg = await QRCodeModel.aggregate(pipeline);
        const rows = Array.isArray(agg?.[0]?.rows) ? agg[0].rows : [];
        const total = Number(agg?.[0]?.totalCount?.[0]?.count || 0) || 0;

        await QRCodeModel.populate(rows, [
            { path: 'generatedBy', select: 'username fullName' },
            { path: 'usedBy', select: 'firstName lastName email' }
        ]);

        res.json({
            success: true,
            qrcodes: rows,
            totalPages: Math.ceil(total / limitNum),
            currentPage: pageNum,
            total,
            mode: 'current',
            usedWindowSeconds: QR_USED_STATUS_WINDOW_SECONDS
        });
    } catch (error) {
        console.error('Error fetching QR codes:', error);
        res.status(500).json({ error: 'Failed to fetch QR codes' });
    }
});

// Delete QR Code
app.delete('/api/admin/qrcodes/:id', authenticateAdmin, async (req, res) => {
    try {
        const qrCode = await QRCodeModel.findById(req.params.id).lean();
        if (!qrCode) {
            return res.status(404).json({ error: 'QR code not found' });
        }

        // Delete ALL duplicates for the same key+room+purpose (so it truly disappears from counts/UI).
        const groupDocs = await QRCodeModel.find({
            keyId: qrCode.keyId,
            room: qrCode.room,
            purpose: qrCode.purpose
        }).select('_id').lean();
        const groupIds = (groupDocs || []).map((d) => d?._id).filter(Boolean);

        const deleteResult = groupIds.length > 0
            ? await QRCodeModel.deleteMany({ _id: { $in: groupIds } })
            : await QRCodeModel.deleteOne({ _id: qrCode._id });

        const deletedCount = Number(deleteResult?.deletedCount || 0) || 0;

        // Remove dangling references.
        await Promise.all([
            Key.updateMany({ qrCode: { $in: groupIds.length > 0 ? groupIds : [qrCode._id] } }, { $unset: { qrCode: '' } }),
            Transaction.updateMany({ qrCodeId: { $in: groupIds.length > 0 ? groupIds : [qrCode._id] } }, { $unset: { qrCodeId: '' } })
        ]);

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'qrcode.delete',
            targetType: 'qrcode',
            targetId: qrCode._id,
            targetName: qrCode.keyId,
            details: {
                room: qrCode.room,
                purpose: qrCode.purpose,
                deletedCount: Math.max(1, deletedCount)
            }
        });
        res.json({ success: true, message: 'QR code deleted successfully', deletedCount: Math.max(1, deletedCount) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete QR code' });
    }
});

// Regenerate QR Code
app.post('/api/admin/qrcodes/:id/regenerate', authenticateAdmin, async (req, res) => {
    try {
        const qrCode = await QRCodeModel.findById(req.params.id);
        if (!qrCode) {
            return res.status(404).json({ error: 'QR code not found' });
        }

        qrCode.purpose = normalizeQrPurpose(qrCode.purpose, 'unified');
        qrCode.qrData = buildQrPayload({
            keyId: qrCode.keyId,
            room: qrCode.room,
            purpose: qrCode.purpose,
            uniqueId: new mongoose.Types.ObjectId().toString()
        });

        const qrCodeDataUrl = await generateQrCodeDataUrl(qrCode.qrData);

        qrCode.qrCodeImage = qrCodeDataUrl;
        qrCode.used = false;
        qrCode.usedAt = null;
        qrCode.usedBy = null;
        qrCode.regeneratedAt = new Date();
        qrCode.regeneratedBy = req.admin._id;
        qrCode.expiresAt = getQrCodeExpiryDate();
        await qrCode.save();

        // Expire duplicates (if any) so only the latest QR works.
        await QRCodeModel.updateMany(
            {
                keyId: qrCode.keyId,
                room: qrCode.room,
                purpose: qrCode.purpose,
                _id: { $ne: qrCode._id }
            },
            { $set: { expiresAt: new Date(0) } }
        );

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'qrcode.regenerate',
            targetType: 'qrcode',
            targetId: qrCode._id,
            targetName: qrCode.keyId
        });

        res.json({
            success: true,
            qrCode: qrCodeDataUrl,
            message: 'QR code regenerated successfully'
        });
    } catch (error) {
        console.error('Error regenerating QR code:', error);
        res.status(500).json({ error: 'Failed to regenerate QR code' });
    }
});

// Admin Users Management
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const { search = '', includeInactive = 'false' } = req.query;
        const query = search ? {
            $or: [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ]
        } : {};
        if (includeInactive !== 'true') {
            query.isActive = { $ne: false };
        }

        const users = await User.find(query)
            .select([
                'firstName',
                'lastName',
                'email',
                'role',
                'department',
                'isActive',
                'emailVerified',
                'approvalStatus',
                'approvedAt',
                'approvedBy',
                'rejectedAt',
                'rejectedBy',
                'lastLogin',
                'createdAt',
                'updatedAt'
            ].join(' '))
            .sort({ createdAt: -1 })
            .lean();
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Pending approvals (teachers who verified email but need admin approval)
app.get('/api/admin/user-approvals', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        if (!canManageUserAccounts(req.admin)) {
            return res.status(403).json({ error: 'You do not have permission to approve users.' });
        }

        const search = String(req.query?.search || '').trim();
        const query = {
            approvalStatus: 'pending',
            isActive: { $ne: false },
            emailVerified: { $ne: false }
        };

        if (search) {
            query.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const users = await User.find(query)
            .select('firstName lastName email createdAt approvalStatus emailVerified')
            .sort({ createdAt: -1 })
            .limit(200);

        res.json({ success: true, users });
    } catch (error) {
        console.error('Approvals fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch pending approvals' });
    }
});

app.post('/api/admin/users/:id/approve', authenticateAdmin, async (req, res) => {
    try {
        if (!canManageUserAccounts(req.admin)) {
            return res.status(403).json({ error: 'You do not have permission to approve users.' });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.emailVerified === false) {
            return res.status(400).json({ error: 'User email is not verified yet' });
        }

        user.approvalStatus = 'approved';
        user.approvedAt = new Date();
        user.approvedBy = req.admin._id;
        user.rejectedAt = undefined;
        user.rejectedBy = undefined;
        user.isActive = true;
        await user.save();

        const sent = await sendAccountApprovalEmail({ to: user.email, status: 'approved', appUrl: getAppBaseUrl(req) });

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'user.approve',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email,
            details: { sent }
        });

        res.json({ success: true, sent });
    } catch (error) {
        console.error('Approve user error:', error);
        res.status(500).json({ error: 'Failed to approve user' });
    }
});

app.post('/api/admin/users/:id/reject', authenticateAdmin, async (req, res) => {
    try {
        if (!canManageUserAccounts(req.admin)) {
            return res.status(403).json({ error: 'You do not have permission to reject users.' });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.approvalStatus = 'rejected';
        user.rejectedAt = new Date();
        user.rejectedBy = req.admin._id;
        user.isActive = false;
        await user.save();

        const sent = await sendAccountApprovalEmail({ to: user.email, status: 'rejected', appUrl: getAppBaseUrl(req) });

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'user.reject',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email,
            details: { sent }
        });

        res.json({ success: true, sent });
    } catch (error) {
        console.error('Reject user error:', error);
        res.status(500).json({ error: 'Failed to reject user' });
    }
});

app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;

        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const emailLower = email.toLowerCase();
        await User.deleteMany({ isActive: false, email: emailLower });
        const existingUser = await User.findOne({ email: emailLower });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const user = new User({
            firstName,
            lastName,
            email: emailLower,
            password,
            role: 'teacher',
            emailVerified: true,
            approvalStatus: 'approved',
            approvedAt: new Date(),
            approvedBy: req.admin._id
        });
        await user.save();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'user.create',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email
        });

        res.status(201).json({ success: true, user: { id: user._id, firstName, lastName, email } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add user' });
    }
});

app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Hard-delete all duplicates by email (case-insensitive safety)
        const userEmail = String(user.email || '').trim().toLowerCase();

        let deletedUsers = 0;
        let releasedKeys = 0;
        let createdTransactions = 0;

        if (userEmail) {
            const emailRegex = new RegExp(`^${escapeRegex(userEmail)}$`, 'i');
            const duplicates = await User.find({ email: emailRegex }).select('_id').lean();
            const ids = (duplicates || []).map((u) => u?._id).filter(Boolean);

            if (ids.length > 0) {
                const releaseSummary = await forceReleaseBorrowedKeys({
                    userIds: ids,
                    reason: `Released automatically before deleting user account (${userEmail || 'unknown user'})`,
                    scannedBy: 'admin'
                });
                releasedKeys = releaseSummary.releasedKeys;
                createdTransactions = releaseSummary.createdTransactions;

                const deleteResult = await User.deleteMany({ email: emailRegex });
                deletedUsers = Number(deleteResult?.deletedCount || 0) || 0;
            }
        } else {
            // Fallback: delete just this user
            const releaseSummary = await forceReleaseBorrowedKeys({
                userIds: [user._id],
                reason: `Released automatically before deleting user account (${user.email || 'unknown user'})`,
                scannedBy: 'admin'
            });
            releasedKeys = releaseSummary.releasedKeys;
            createdTransactions = releaseSummary.createdTransactions;
            const deleteResult = await User.deleteOne({ _id: user._id });
            deletedUsers = Number(deleteResult?.deletedCount || 0) || 0;
        }

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'user.delete',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email,
            details: {
                deletedUsers,
                releasedBorrowedKeys: releasedKeys,
                forcedReturnTransactions: createdTransactions
            }
        });

        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.post('/api/admin/users/:id/reset-password', authenticateAdmin, async (req, res) => {
    try {
        const password = String(req.body?.password || '');
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.password = password;
        user.resetPasswordTokenHash = undefined;
        user.resetPasswordExpiresAt = undefined;
        user.lastLogin = null;
        await user.save();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'user.reset_password',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email
        });

        res.json({ success: true, message: 'Password reset' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Backward-compatible reset password route (admin-only)
app.post('/api/users/:id/reset-password', authenticateAdmin, async (req, res) => {
    try {
        const password = String(req.body?.password || '');
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.password = password;
        user.resetPasswordTokenHash = undefined;
        user.resetPasswordExpiresAt = undefined;
        user.lastLogin = null;
        await user.save();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'user.reset_password',
            targetType: 'user',
            targetId: user._id,
            targetName: user.email
        });

        res.json({ success: true, message: 'Password reset' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Admin Accounts Management
app.get('/api/admin/admins', authenticateAdmin, async (req, res) => {
    try {
        if (!canManageAdminAccounts(req.admin)) {
            return res.status(403).json({ error: 'You do not have permission to manage admin accounts' });
        }

        res.set('Cache-Control', 'no-store');
        const { search = '', includeInactive = 'false' } = req.query;
        const query = search ? {
            $or: [
                { username: { $regex: search, $options: 'i' } },
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ]
        } : {};
        if (includeInactive !== 'true') {
            query.isActive = { $ne: false };
        }

        const admins = await Admin.find(query)
            .select([
                'username',
                'fullName',
                'email',
                'role',
                'department',
                'permissions',
                'isDefault',
                'isActive',
                'lastLogin',
                'createdAt',
                'updatedAt'
            ].join(' '))
            .sort({ createdAt: -1 })
            .lean();

        const decorated = admins.map((admin) => ({
            ...admin,
            isDefault: isDefaultAdminAccount(admin)
        }));

        res.json({ success: true, admins: decorated });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch admins' });
    }
});

app.post('/api/admin/admins', authenticateAdmin, async (req, res) => {
    try {
        if (!canManageAdminAccounts(req.admin)) {
            return res.status(403).json({ error: 'You do not have permission to manage admin accounts' });
        }

        const username = String(req.body?.username || '').trim();
        const fullName = String(req.body?.fullName || '').trim();
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');

        if (!username || !password || !email || !fullName) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const emailLower = email.toLowerCase();
        const emailRegex = /^\S+@\S+\.\S+$/;
        if (!emailRegex.test(emailLower)) {
            return res.status(400).json({ error: 'Please enter a valid email address' });
        }

        if (
            (DEFAULT_ADMIN_USERNAME_NORM && normalizeIdentity(username) === DEFAULT_ADMIN_USERNAME_NORM)
            || (DEFAULT_ADMIN_EMAIL_NORM && normalizeIdentity(emailLower) === DEFAULT_ADMIN_EMAIL_NORM)
        ) {
            return res.status(400).json({ error: 'This username or email is reserved for the default admin account' });
        }

        const usernameRegex = new RegExp(`^${escapeRegex(username)}$`, 'i');
        await Admin.deleteMany({ isActive: false, $or: [{ username: usernameRegex }, { email: emailLower }] });
        const existing = await Admin.findOne({ $or: [{ username: usernameRegex }, { email: emailLower }] });
        if (existing) {
            return res.status(400).json({ error: 'Admin already exists' });
        }

        const admin = new Admin({
            username,
            password,
            email: emailLower,
            fullName,
            role: 'admin',
            isActive: true
        });

        await admin.save();
        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'admin.create',
            targetType: 'admin',
            targetId: admin._id,
            targetName: admin.username
        });
        res.status(201).json({ success: true, admin: { id: admin._id, username, email: emailLower, fullName } });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(400).json({ error: 'Admin already exists' });
        }
        if (error?.name === 'ValidationError') {
            return res.status(400).json({ error: error.message || 'Invalid admin data' });
        }
        res.status(500).json({ error: 'Failed to add admin' });
    }
});

app.post('/api/admin/admins/:id/reset-password', authenticateAdmin, async (req, res) => {
    try {
        if (!canManageAdminAccounts(req.admin)) {
            return res.status(403).json({ error: 'You do not have permission to manage admin accounts' });
        }

        const password = String(req.body?.password || '');
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const admin = await Admin.findById(req.params.id);
        if (!admin || admin.isActive === false) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        if (isDefaultAdminAccount(admin)) {
            return res.status(403).json({ error: 'Default admin account cannot be modified' });
        }
        if (admin.role === 'super_admin' && req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admins can reset super admin passwords' });
        }

        admin.password = password;
        admin.resetPasswordTokenHash = undefined;
        admin.resetPasswordExpiresAt = undefined;
        admin.lastLogin = null;
        await admin.save();

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'admin.reset_password',
            targetType: 'admin',
            targetId: admin._id,
            targetName: admin.username,
            details: {
                email: admin.email || ''
            }
        });

        res.json({ success: true, message: 'Password reset' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

app.delete('/api/admin/admins/:id', authenticateAdmin, async (req, res) => {
    try {
        if (!canManageAdminAccounts(req.admin)) {
            return res.status(403).json({ error: 'You do not have permission to manage admin accounts' });
        }

        if (String(req.params.id) === String(req.admin._id)) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const admin = await Admin.findById(req.params.id);
        if (!admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        if (isDefaultAdminAccount(admin)) {
            return res.status(403).json({ error: 'Default admin account cannot be deleted' });
        }
        if (admin.role === 'super_admin' && req.admin.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super admins can delete super admin accounts' });
        }

        const adminEmail = (admin.email || '').toLowerCase();
        const emailRegex = new RegExp(`^${escapeRegex(adminEmail)}$`, 'i');
        const usernameRegex = new RegExp(`^${escapeRegex(admin.username || '')}$`, 'i');
        await Admin.deleteMany({
            $or: [
                { email: emailRegex },
                { username: usernameRegex }
            ]
        });

        await logActivity({
            actorType: 'admin',
            actorId: req.admin._id,
            actorName: req.admin.username,
            action: 'admin.delete',
            targetType: 'admin',
            targetId: admin._id,
            targetName: admin.username
        });
        res.json({ success: true, message: 'Admin deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete admin' });
    }
});

// Admin Transactions
app.get('/api/admin/transactions', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const pageRaw = Number.parseInt(String(req.query?.page || '1'), 10);
        const limitRaw = Number.parseInt(String(req.query?.limit || '50'), 10);
        const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

        const search = String(req.query?.search || '').trim();
        const actionFilter = String(req.query?.action || '').trim().toLowerCase();
        const from = String(req.query?.from || '').trim();
        const to = String(req.query?.to || '').trim();
        const tzOffset = String(req.query?.tzOffset || '').trim();
        const query = await buildAdminTransactionQuery({
            search,
            actionFilter,
            from,
            to,
            tzOffset
        });

        const [transactions, total] = await Promise.all([
            Transaction.find(query)
                .populate('userId', 'firstName lastName email')
                .sort({ performedAt: -1, createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Transaction.countDocuments(query)
        ]);

        res.json({
            success: true,
            transactions,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        res.status(statusCode).json({ error: error?.message || 'Failed to fetch transactions' });
    }
});

app.get('/api/admin/transaction-sessions', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');

        const page = clampInt(req.query?.page, 1, { min: 1, max: 100000 });
        const limit = clampInt(req.query?.limit, 200, { min: 1, max: 1000 });
        const search = String(req.query?.search || '').trim();
        const from = String(req.query?.from || '').trim();
        const to = String(req.query?.to || '').trim();
        const tzOffset = String(req.query?.tzOffset || '').trim();
        const range = buildUtcDateRangeFilter({ from, to, tzOffset });

        const query = await buildAdminTransactionQuery({ search });
        const rawTransactions = await Transaction.find(query)
            .populate('userId', 'firstName lastName email')
            .sort({ performedAt: 1, createdAt: 1, _id: 1 })
            .lean();

        const sessions = buildTransactionSessionRows(rawTransactions, { range });
        const total = sessions.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * limit;
        const pageRows = sessions.slice(start, start + limit);

        res.json({
            success: true,
            sessions: pageRows,
            total,
            totalPages,
            currentPage: safePage
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        res.status(statusCode).json({ error: error?.message || 'Failed to fetch transaction sessions' });
    }
});

// Admin Activity Logs
app.get('/api/admin/logs', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const search = String(req.query?.search || '').trim();
        const category = String(req.query?.category || '').trim().toLowerCase();
        const page = clampInt(req.query?.page, 1, { min: 1, max: 100000 });
        const limit = clampInt(req.query?.limit, 50, { min: 1, max: 500 });
        const from = String(req.query?.from || '').trim();
        const to = String(req.query?.to || '').trim();
        const tzOffset = String(req.query?.tzOffset || '').trim();
        const query = buildAdminLogQuery({
            search,
            category,
            from,
            to,
            tzOffset
        });

        const [logs, total] = await Promise.all([
            ActivityLog.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            ActivityLog.countDocuments(query)
        ]);

        res.json({
            success: true,
            logs,
            totalPages: Math.max(1, Math.ceil(total / limit)),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

app.delete('/api/admin/logs/:id', authenticateAdmin, async (req, res) => {
    try {
        const log = await ActivityLog.findByIdAndDelete(req.params.id);
        if (!log) {
            return res.status(404).json({ error: 'Log not found' });
        }
        res.json({ success: true, message: 'Log deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete log' });
    }
});

// Announcements / Notifications
const sanitizeDataUrlImage = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const isDataImage = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw);
    if (!isDataImage) return '';
    return raw.replace(/\s+/g, '');
};

// User: summary (badge + popup availability)
app.get('/api/announcements/summary', authenticateToken, loadUserRecord, async (req, res) => {
    try {
        const seenAt = req.userRecord?.lastNotificationSeenAt || req.userRecord?.createdAt || new Date(0);

        const unreadCount = await Announcement.countDocuments({
            type: 'notification',
            active: true,
            createdAt: { $gt: seenAt }
        });

        const latestPopup = await Announcement.findOne({ type: 'popup', active: true })
            .sort({ createdAt: -1 })
            .select('_id createdAt');

        const latestPopupId = latestPopup?._id || null;
        const shouldShowPopup = Boolean(latestPopupId);

        res.json({ success: true, unreadCount, latestPopupId, shouldShowPopup });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch announcement summary' });
    }
});

// User: list announcements
app.get('/api/announcements', authenticateToken, loadUserRecord, async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query?.limit || ''), 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

        const seenAt = req.userRecord?.lastNotificationSeenAt || req.userRecord?.createdAt || new Date(0);
        const dismissedId = req.userRecord?.dismissedPopupAnnouncementId;

        const announcements = await Announcement.find({ active: true })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const unreadCount = await Announcement.countDocuments({
            type: 'notification',
            active: true,
            createdAt: { $gt: seenAt }
        });

        const mapped = announcements.map((a) => {
            const type = String(a.type || 'notification').toLowerCase();
            const createdAt = a.createdAt ? new Date(a.createdAt) : null;
            const isRead = type === 'notification' ? Boolean(createdAt && createdAt <= seenAt) : false;
            const isDismissed = type === 'popup' ? String(a._id) === String(dismissedId || '') : false;
            return {
                id: a._id,
                type,
                title: a.title || '',
                message: a.message || '',
                imageDataUrl: a.imageDataUrl || '',
                createdAt: a.createdAt,
                createdByName: a.createdByName || '',
                active: a.active !== false,
                isRead,
                isDismissed
            };
        });

        res.json({
            success: true,
            announcements: mapped,
            unreadCount,
            lastNotificationSeenAt: seenAt
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// User: mark notifications as seen
app.post('/api/announcements/seen', authenticateToken, loadUserRecord, async (req, res) => {
    try {
        req.userRecord.lastNotificationSeenAt = new Date();
        await req.userRecord.save();
        res.json({ success: true, lastNotificationSeenAt: req.userRecord.lastNotificationSeenAt });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark announcements as seen' });
    }
});

// User: get current popup (image-only)
app.get('/api/announcements/popup', authenticateToken, loadUserRecord, async (req, res) => {
    try {
        const popup = await Announcement.findOne({ type: 'popup', active: true })
            .sort({ createdAt: -1 })
            .select('_id title message imageDataUrl createdAt createdByName active')
            .lean();

        if (!popup) {
            return res.json({ success: true, popup: null, shouldShow: false });
        }

        const shouldShow = true;

        res.json({
            success: true,
            shouldShow,
            popup: {
                id: popup._id,
                type: 'popup',
                title: popup.title || '',
                message: popup.message || '',
                imageDataUrl: popup.imageDataUrl || '',
                createdAt: popup.createdAt,
                createdByName: popup.createdByName || '',
                active: popup.active !== false
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch popup announcement' });
    }
});

// User: dismiss popup
app.post('/api/announcements/popup-dismiss', authenticateToken, loadUserRecord, async (req, res) => {
    try {
        const id = String(req.body?.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid announcement id' });
        }

        const popup = await Announcement.findById(id).select('_id type active');
        if (!popup || String(popup.type) !== 'popup' || popup.active === false) {
            return res.status(404).json({ error: 'Popup announcement not found' });
        }

        req.userRecord.dismissedPopupAnnouncementId = popup._id;
        req.userRecord.dismissedPopupAt = new Date();
        await req.userRecord.save();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to dismiss popup announcement' });
    }
});

// Admin: list announcements
app.get('/api/admin/announcements', authenticateAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const page = clampInt(req.query?.page, 1, { min: 1, max: 100000 });
        const limit = clampInt(req.query?.limit, 100, { min: 1, max: 500 });

        const type = String(req.query?.type || '').trim().toLowerCase();
        const search = String(req.query?.search || '').trim();
        const filter = {};
        if (type === 'notification' || type === 'popup') {
            filter.type = type;
        }
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } },
                { createdByName: { $regex: search, $options: 'i' } }
            ];
        }

        const [announcements, total] = await Promise.all([
            Announcement.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Announcement.countDocuments(filter)
        ]);

        res.json({
            success: true,
            announcements,
            totalPages: Math.max(1, Math.ceil(total / limit)),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// Admin: create announcement
app.post('/api/admin/announcements', authenticateAdmin, async (req, res) => {
    try {
        const type = String(req.body?.type || 'notification').trim().toLowerCase();
        if (type !== 'notification' && type !== 'popup') {
            return res.status(400).json({ error: 'Invalid announcement type' });
        }

        const title = String(req.body?.title || '').trim();
        const message = String(req.body?.message || '').trim();
        const imageDataUrl = sanitizeDataUrlImage(req.body?.imageDataUrl);

        if (type === 'notification' && !message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        if (type === 'popup' && !imageDataUrl) {
            return res.status(400).json({ error: 'Popup image is required' });
        }

        if (req.body?.imageDataUrl && !imageDataUrl) {
            return res.status(400).json({ error: 'Invalid image format. Use JPG, PNG, WEBP, or GIF.' });
        }

        if (imageDataUrl && imageDataUrl.length > 6_000_000) {
            return res.status(413).json({ error: 'Image is too large. Please upload a smaller file.' });
        }

        const createdByName = String(req.admin?.fullName || req.admin?.username || '').trim();
        const announcement = await Announcement.create({
            type,
            title,
            message: type === 'popup' ? '' : message,
            imageDataUrl,
            createdBy: req.admin?._id,
            createdByName,
            active: true
        });

        if (type === 'popup') {
            await Announcement.updateMany(
                { type: 'popup', active: true, _id: { $ne: announcement._id } },
                { $set: { active: false } }
            );
        }

        await logActivity({
            actorType: 'admin',
            actorId: req.admin?._id,
            actorName: req.admin?.username || createdByName,
            action: 'announcement.create',
            targetType: 'Announcement',
            targetId: announcement._id,
            targetName: title || (type === 'popup' ? 'Popup Announcement' : 'Notification'),
            details: { type, hasImage: Boolean(imageDataUrl) }
        });

        res.status(201).json({ success: true, announcement });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create announcement' });
    }
});

// Admin: delete announcement
app.delete('/api/admin/announcements/:id', authenticateAdmin, async (req, res) => {
    try {
        const id = String(req.params?.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid announcement id' });
        }

        const announcement = await Announcement.findByIdAndDelete(id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }

        await logActivity({
            actorType: 'admin',
            actorId: req.admin?._id,
            actorName: req.admin?.username || req.admin?.fullName,
            action: 'announcement.delete',
            targetType: 'Announcement',
            targetId: announcement._id,
            targetName: announcement.title || (announcement.type === 'popup' ? 'Popup Announcement' : 'Notification'),
            details: { type: announcement.type }
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete announcement' });
    }
});

// Serve HTML Pages
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../html/index.html'));
});

// Get Single Key (Admin)
app.get('/api/keys/:id', authenticateAdmin, async (req, res) => {
    try {
        const key = await Key.findOne({ keyId: req.params.id });
        if (!key) {
            return res.status(404).json({ error: 'Key not found' });
        }
        res.json({ success: true, key });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch key' });
    }
});

app.get('/dashboard', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../html/dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../html/admin.html'));
});

app.get('/scan', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../html/scan.html'));
});

app.get('/create', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../html/create.html'));
});

app.get('/reset-password', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../html/reset-password.html'));
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start Server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        // Initialize default data
        await initializeDefaultAdmin();
        await initializeDefaultKeys();
        await initializeDefaultLockers();
        await backfillLegacyTransactionMetadata();
        await backfillQRCodeUsageFromTransactions();
        await expireDuplicateQRCodes();
        await disableLegacyQrExpiry();

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🌐 Access the application at: http://localhost:${PORT}`);
            console.log(`🔧 Admin dashboard: http://localhost:${PORT}/admin`);
            console.log(`📝 Default admin credentials:`);
            console.log(`   Username: ${process.env.ADMIN_USERNAME || 'CPETadmin'}`);
            console.log(`   Password: ${process.env.ADMIN_PASSWORD || 'admin123!'}`);
        });

        if (localHttpsState.enabled) {
            try {
                const httpsOptions = buildLocalHttpsOptions();
                https.createServer(httpsOptions, app).listen(localHttpsState.port, () => {
                    localHttpsState.active = true;
                    localHttpsState.error = '';
                    console.log(`HTTPS server running on port ${localHttpsState.port}`);
                    console.log(`Secure scanner: https://localhost:${localHttpsState.port}/scan`);
                });
            } catch (httpsError) {
                localHttpsState.active = false;
                localHttpsState.error = httpsError.message;
                console.error('HTTPS server was not started:', httpsError.message);
            }
        }
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
