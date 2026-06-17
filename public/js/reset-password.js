// Reset Password Page Script (Teacher/User)
const API_BASE_URL = (() => {
    if (typeof window === 'undefined') return 'http://localhost:3000/api';
    const { origin, protocol, hostname, port } = window.location;
    if (!port || port === '3000' || port === '3443') {
        return `${origin}/api`;
    }
    return `${protocol}//${hostname}:3000/api`;
})();

const ROUTES = {
    home: '/'
};

const elements = {
    form: document.getElementById('resetPasswordForm'),
    newPassword: document.getElementById('newPassword'),
    confirmPassword: document.getElementById('confirmPassword'),
    submitBtn: document.getElementById('resetPasswordSubmitBtn')
};

function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `toast ${type}`;
    notification.innerHTML = `
        <div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</div>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(notification);
    setTimeout(() => {
        if (notification.parentNode === container) {
            container.removeChild(notification);
        }
    }, 6000);
}

function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
}

async function confirmReset(token, password) {
    const response = await fetch(`${API_BASE_URL}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
    }
    return data;
}

document.addEventListener('DOMContentLoaded', () => {
    const token = getTokenFromUrl();
    if (!token) {
        showNotification('Missing reset token. Please request a new reset link.', 'error');
        if (elements.submitBtn) elements.submitBtn.disabled = true;
        return;
    }

    if (!elements.form) return;

    elements.form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const password = elements.newPassword?.value ?? '';
        const confirm = elements.confirmPassword?.value ?? '';

        if (!password || password.length < 6) {
            showNotification('Password must be at least 6 characters long.', 'error');
            return;
        }

        if (password !== confirm) {
            showNotification('Passwords do not match.', 'error');
            return;
        }

        const originalText = elements.submitBtn?.textContent || 'Reset Password';
        if (elements.submitBtn) {
            elements.submitBtn.textContent = 'Resetting...';
            elements.submitBtn.disabled = true;
        }

        try {
            const data = await confirmReset(token, password);
            showNotification(data.message || 'Password reset successful. Redirecting to login...', 'success');
            setTimeout(() => {
                window.location.href = ROUTES.home;
            }, 1200);
        } catch (error) {
            console.error('Reset confirm error:', error);
            showNotification(error.message || 'Failed to reset password', 'error');
        } finally {
            if (elements.submitBtn) {
                elements.submitBtn.textContent = originalText;
                elements.submitBtn.disabled = false;
            }
        }
    });
});
