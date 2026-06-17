(() => {
    'use strict';

    const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
    const CHECK_INTERVAL_MS = 1000;
    const ACTIVITY_WRITE_THROTTLE_MS = 8000;
    const REDIRECT_DELAY_MS = 3500;
    const IDLE_LOGIN_URL = '/?reason=idle';

    const STORAGE_KEYS = {
        lastActiveAt: 'kbs:lastActiveAt',
        idleLogoutAt: 'kbs:idleLogoutAt'
    };

    const AUTH_STORAGE_KEYS = ['userToken', 'userData', 'adminToken', 'adminData'];
    const SESSION_STORAGE_KEYS = ['dismissedPopupAnnouncementId'];

    let activityWriteAt = 0;
    let checkTimer = null;
    let logoutInProgress = false;
    let redirectTimer = null;
    let countdownTimer = null;

    function safeNow() {
        return Date.now();
    }

    function safeLocalStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function safeLocalStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            // ignore
        }
    }

    function safeLocalStorageRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch {
            // ignore
        }
    }

    function safeSessionStorageRemove(key) {
        try {
            sessionStorage.removeItem(key);
        } catch {
            // ignore
        }
    }

    function hasSession() {
        return Boolean(safeLocalStorageGet('userToken') || safeLocalStorageGet('adminToken'));
    }

    function parseTimestamp(value, fallback) {
        const ts = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(ts) || ts <= 0) return fallback;
        return ts;
    }

    function getLastActiveAt() {
        const now = safeNow();
        return parseTimestamp(safeLocalStorageGet(STORAGE_KEYS.lastActiveAt), now);
    }

    function setLastActiveAt(ts) {
        safeLocalStorageSet(STORAGE_KEYS.lastActiveAt, String(ts));
    }

    function markActive({ force = false } = {}) {
        if (!hasSession()) return;

        const now = safeNow();
        if (!force && (now - activityWriteAt) < ACTIVITY_WRITE_THROTTLE_MS) return;
        activityWriteAt = now;
        setLastActiveAt(now);
    }

    function clearAuthStorage() {
        AUTH_STORAGE_KEYS.forEach((key) => safeLocalStorageRemove(key));
        SESSION_STORAGE_KEYS.forEach((key) => safeSessionStorageRemove(key));
    }

    function ensureIdleLogoutModal() {
        let modal = document.getElementById('idleLogoutModal');
        if (modal) {
            return {
                modal,
                messageEl: modal.querySelector('[data-idle-message]'),
                countdownEl: modal.querySelector('[data-idle-countdown]'),
                loginBtn: modal.querySelector('[data-idle-login]')
            };
        }

        modal = document.createElement('div');
        modal.id = 'idleLogoutModal';
        modal.className = 'modal idle-timeout-modal';
        modal.dataset.modalLocked = 'true';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Session expired');

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Session Expired</h3>
                </div>
                <div class="modal-body">
                    <p class="text-muted" data-idle-message></p>
                    <p class="helper-text" style="margin-top: 10px;">
                        Redirecting to login in <strong data-idle-countdown>3</strong>s...
                    </p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-success" data-idle-login>Back to Login</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const loginBtn = modal.querySelector('[data-idle-login]');
        loginBtn?.addEventListener('click', () => {
            window.location.href = IDLE_LOGIN_URL;
        });

        return {
            modal,
            messageEl: modal.querySelector('[data-idle-message]'),
            countdownEl: modal.querySelector('[data-idle-countdown]'),
            loginBtn
        };
    }

    function showIdleLogoutModal() {
        const ui = ensureIdleLogoutModal();

        if (ui.messageEl) {
            ui.messageEl.textContent = 'You have been logged out due to 20 minutes of inactivity.';
        }

        ui.modal.style.display = 'flex';
        ui.modal.classList.add('show');
        document.body.classList.add('modal-open');

        const redirectSeconds = Math.max(1, Math.ceil(REDIRECT_DELAY_MS / 1000));

        if (ui.countdownEl) {
            ui.countdownEl.textContent = String(redirectSeconds);
        }

        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }

        let remaining = redirectSeconds;
        countdownTimer = setInterval(() => {
            remaining -= 1;
            if (ui.countdownEl) {
                ui.countdownEl.textContent = String(Math.max(0, remaining));
            }
            if (remaining <= 0) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }
        }, 1000);

        if (redirectTimer) {
            clearTimeout(redirectTimer);
            redirectTimer = null;
        }

        redirectTimer = setTimeout(() => {
            window.location.href = IDLE_LOGIN_URL;
        }, REDIRECT_DELAY_MS);

        setTimeout(() => ui.loginBtn?.focus?.(), 0);
    }

    function stop() {
        if (checkTimer) {
            clearInterval(checkTimer);
            checkTimer = null;
        }
        if (redirectTimer) {
            clearTimeout(redirectTimer);
            redirectTimer = null;
        }
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }

    function triggerIdleLogout({ external = false } = {}) {
        if (logoutInProgress) return;
        logoutInProgress = true;
        stop();

        if (!external) {
            safeLocalStorageSet(STORAGE_KEYS.idleLogoutAt, String(safeNow()));
        }

        clearAuthStorage();
        showIdleLogoutModal();
    }

    function tick() {
        if (!hasSession()) {
            stop();
            return;
        }

        const now = safeNow();
        const lastActiveAt = getLastActiveAt();
        const idleMs = now - lastActiveAt;

        if (idleMs >= IDLE_TIMEOUT_MS) {
            triggerIdleLogout();
        }
    }

    function start() {
        if (!hasSession()) return;

        // If the browser was suspended/closed for too long, enforce the timeout on load.
        const now = safeNow();
        const lastActiveAt = getLastActiveAt();
        if ((now - lastActiveAt) >= IDLE_TIMEOUT_MS) {
            triggerIdleLogout();
            return;
        }

        // Treat page load as activity for an active session.
        markActive({ force: true });

        const activityEvents = [
            'pointerdown',
            'pointermove',
            'keydown',
            'wheel',
            'scroll',
            'touchstart',
            'touchmove',
            'mousemove'
        ];

        activityEvents.forEach((eventName) => {
            window.addEventListener(eventName, markActive, { passive: true });
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                markActive({ force: true });
            }
        });

        window.addEventListener('storage', (e) => {
            // Another tab triggered the idle logout.
            if (e.key === STORAGE_KEYS.idleLogoutAt && e.newValue) {
                triggerIdleLogout({ external: true });
                return;
            }

            // Session cleared in another tab.
            if ((e.key === 'userToken' || e.key === 'adminToken') && !e.newValue) {
                const idleAt = parseTimestamp(safeLocalStorageGet(STORAGE_KEYS.idleLogoutAt), 0);
                const isRecentIdleLogout = idleAt > 0 && (safeNow() - idleAt) < 30000;

                if (isRecentIdleLogout) {
                    triggerIdleLogout({ external: true });
                    return;
                }

                stop();
                window.location.href = '/';
            }
        });

        tick();
        checkTimer = setInterval(tick, CHECK_INTERVAL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
