(() => {
    const API_BASE_URL = (() => {
        if (typeof window === 'undefined') return 'http://localhost:3000/api';
        const { origin, protocol, hostname, port } = window.location;
        if (!port || port === '3000' || port === '3443') {
            return `${origin}/api`;
        }
        return `${protocol}//${hostname}:3000/api`;
    })();

    const POLL_MS = 5000;
    const DEFAULT_TITLE = 'System Maintenance';
    const DEFAULT_MESSAGE = 'The system is temporarily unavailable while we perform maintenance. Please try again later.';
    const LOGOUT_LABEL = 'Logout';
    const LOGOUT_KEYS = ['userToken', 'userData'];

    let pollTimer = null;
    let lastEnabled = null;

    function clearUserSession() {
        try {
            LOGOUT_KEYS.forEach((key) => localStorage.removeItem(key));
        } catch {
            // ignore
        }
    }

    function hasUserSession() {
        try {
            return Boolean(localStorage.getItem('userToken'));
        } catch {
            return false;
        }
    }

    function ensureMaintenanceModal() {
        let modal = document.getElementById('maintenanceModal');
        if (modal) {
            return {
                modal,
                titleEl: modal.querySelector('[data-maintenance-title]'),
                messageEl: modal.querySelector('[data-maintenance-message]'),
                metaEl: modal.querySelector('[data-maintenance-meta]')
            };
        }

        modal = document.createElement('div');
        modal.id = 'maintenanceModal';
        modal.className = 'modal maintenance-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Maintenance notice');

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 data-maintenance-title>${DEFAULT_TITLE}</h3>
                </div>
                <div class="modal-body">
                    <p data-maintenance-message class="text-muted">${DEFAULT_MESSAGE}</p>
                    <p data-maintenance-meta class="helper-text maintenance-meta"></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-danger" data-maintenance-logout>${LOGOUT_LABEL}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const show = () => {
            modal.classList.add('show');
            document.body.classList.add('maintenance-locked');
        };

        const hide = () => {
            modal.classList.remove('show');
            document.body.classList.remove('maintenance-locked');
        };

        modal.querySelector('[data-maintenance-logout]')?.addEventListener('click', () => {
            clearUserSession();
            window.location.href = '/';
        });

        return {
            modal,
            titleEl: modal.querySelector('[data-maintenance-title]'),
            messageEl: modal.querySelector('[data-maintenance-message]'),
            metaEl: modal.querySelector('[data-maintenance-meta]'),
            show,
            hide
        };
    }

    async function fetchMaintenanceState() {
        const response = await fetch(`${API_BASE_URL}/maintenance`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store'
        });

        if (!response.ok) return null;
        const json = await response.json();
        if (!json || json.success !== true) return null;
        return json.maintenance || null;
    }

    function applyMaintenanceState(state) {
        const enabled = Boolean(state?.enabled);
        const title = String(state?.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE;
        const message = String(state?.message || DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;
        const updatedAt = String(state?.updatedAt || '').trim();
        const updatedByName = String(state?.updatedByName || '').trim();

        const ui = ensureMaintenanceModal();
        if (ui.titleEl) ui.titleEl.textContent = title;
        if (ui.messageEl) ui.messageEl.textContent = message;
        if (ui.metaEl) {
            const parts = [];
            if (updatedByName) parts.push(`From: ${updatedByName}`);
            if (updatedAt) {
                const date = new Date(updatedAt);
                if (!Number.isNaN(date.getTime())) {
                    parts.push(`Updated: ${date.toLocaleString()}`);
                }
            }
            ui.metaEl.textContent = parts.join(' • ');
            ui.metaEl.style.display = ui.metaEl.textContent ? '' : 'none';
        }

        if (!enabled) {
            ui.hide?.();
            lastEnabled = false;
            return;
        }

        if (!hasUserSession()) {
            ui.hide?.();
            lastEnabled = false;
            return;
        }

        ui.show?.();
        lastEnabled = true;
    }

    async function tick() {
        try {
            const state = await fetchMaintenanceState();
            if (!state) return;
            applyMaintenanceState(state);
        } catch (error) {
            // ignore network errors
        }
    }

    function start() {
        if (pollTimer) return;
        tick();
        pollTimer = setInterval(tick, POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
