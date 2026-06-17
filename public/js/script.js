// Form toggle buttons
const teacherBtn = document.getElementById('teacherBtn');
const adminBtn = document.getElementById('adminBtn');
const teacherForm = document.getElementById('teacherForm');
const adminForm = document.getElementById('adminForm');

// Navigation buttons
const homeBtn = document.getElementById('homeBtn');
const aboutBtn = document.getElementById('aboutBtn');
const contactBtn = document.getElementById('contactBtn');

// Dev Team section for smooth fade-in
const devTeamSection = document.getElementById('dev-team');

// Modal elements (validation modal)
const validationModal = document.getElementById('validationModal');
const modalMessage = document.getElementById('modalMessage');
const closeModalButtons = validationModal ? validationModal.querySelectorAll('.close') : [];

// Forgot password (teacher only)
const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const forgotEmailInput = document.getElementById('forgotEmail');
const sendResetLinkBtn = document.getElementById('sendResetLinkBtn');
const closeForgotButtons = document.querySelectorAll('.close-forgot');

// Contact Us modal
const contactModal = document.getElementById('contactModal');
const closeContactButtons = document.querySelectorAll('.close-contact');

// API Base URL
const API_BASE_URL = (() => {
    if (typeof window === 'undefined') return 'http://localhost:3000/api';
    const { origin, protocol, hostname, port } = window.location;
    if (!port || port === '3000' || port === '3443') {
        return `${origin}/api`;
    }
    return `${protocol}//${hostname}:3000/api`;
})();

// App routes
const ROUTES = {
    home: '/',
    dashboard: '/dashboard',
    admin: '/admin',
    create: '/create',
    scan: '/scan'
};

const teacherSubmitBtn = teacherForm ? teacherForm.querySelector('button[type="submit"]') : null;
const adminSubmitBtn = adminForm ? adminForm.querySelector('button[type="submit"]') : null;

let isTeacherSubmitting = false;
let isAdminSubmitting = false;

const syncTeacherSubmitState = () => {
    if (!teacherSubmitBtn) return;
    teacherSubmitBtn.disabled = isTeacherSubmitting;
};

const syncAdminSubmitState = () => {
    if (!adminSubmitBtn) return;
    adminSubmitBtn.disabled = isAdminSubmitting;
};

const safeParseJson = async (response) => {
    try {
        return await response.json();
    } catch {
        return {};
    }
};

const clearTeacherLoginInputs = () => {
    const emailInput = document.getElementById('teacher-id');
    const passInput = document.getElementById('teacher-pass');
    if (emailInput) emailInput.value = '';
    if (passInput) passInput.value = '';
    emailInput?.focus();
};

const clearAdminLoginInputs = () => {
    const userInput = document.getElementById('admin-user');
    const passInput = document.getElementById('admin-pass');
    if (userInput) userInput.value = '';
    if (passInput) passInput.value = '';
    userInput?.focus();
};

const scrollToLoginInput = (type) => {
    const selector = type === 'admin' ? '#admin-user' : '#teacher-id';
    document.querySelector(selector)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
};

// Switch to teacher form
teacherBtn.addEventListener('click', () => {
    teacherBtn.classList.add('active');
    adminBtn.classList.remove('active');
    teacherForm.classList.add('active');
    adminForm.classList.remove('active');
});

// Switch to admin form
adminBtn.addEventListener('click', () => {
    adminBtn.classList.add('active');
    teacherBtn.classList.remove('active');
    adminForm.classList.add('active');
    teacherForm.classList.remove('active');
});

// Home button - Scroll to login section
homeBtn.addEventListener('click', () => {
    document.getElementById('login').scrollIntoView({ behavior: 'smooth' });
});

// About Us button - Smooth scroll with immediate fade-in
aboutBtn.addEventListener('click', () => {
    devTeamSection.classList.add('visible'); // Start fade-in immediately
    document.getElementById('dev-team').scrollIntoView({ behavior: 'smooth' });
});

// Intersection Observer for Dev Team fade-in (fallback if not clicked)
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            devTeamSection.classList.add('visible');
        }
    });
}, { threshold: 0.1 });

if (devTeamSection) {
    observer.observe(devTeamSection);
}

// Function to show modal
function showModal(message) {
    if (modalMessage && validationModal) {
        modalMessage.textContent = message;
        validationModal.style.display = 'flex';
        validationModal.classList.add('show');
    }
}

// Function to hide modal
function hideModal() {
    if (validationModal) {
        validationModal.style.display = 'none';
        validationModal.classList.remove('show');
    }
}

// Close modal when clicking the close button
if (closeModalButtons.length) {
    closeModalButtons.forEach((btn) => btn.addEventListener('click', hideModal));
}

// Close modal when clicking outside the modal content
window.addEventListener('click', (event) => {
    if (event.target === validationModal) {
        hideModal();
    }

    if (event.target === forgotPasswordModal) {
        hideForgotPasswordModal();
    }

    if (event.target === contactModal) {
        hideContactModal();
    }
});

function showForgotPasswordModal() {
    if (!forgotPasswordModal) return;

    // Pre-fill from teacher email field when available
    const teacherEmail = document.getElementById('teacher-id')?.value?.trim() || '';
    if (forgotEmailInput && teacherEmail) {
        forgotEmailInput.value = teacherEmail;
    }

    forgotPasswordModal.style.display = 'flex';
    forgotPasswordModal.classList.add('show');
    setTimeout(() => forgotEmailInput?.focus(), 0);
}

function hideForgotPasswordModal() {
    if (!forgotPasswordModal) return;
    forgotPasswordModal.style.display = 'none';
    forgotPasswordModal.classList.remove('show');
}

function showContactModal() {
    if (!contactModal) return;
    contactModal.style.display = 'flex';
    contactModal.classList.add('show');
}

function hideContactModal() {
    if (!contactModal) return;
    contactModal.style.display = 'none';
    contactModal.classList.remove('show');
}

async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const temp = document.createElement('textarea');
            temp.value = text;
            temp.setAttribute('readonly', '');
            temp.style.position = 'fixed';
            temp.style.top = '-9999px';
            temp.style.left = '-9999px';
            document.body.appendChild(temp);
            temp.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(temp);
            return ok;
        } catch {
            return false;
        }
    }
}

async function requestPasswordReset(email) {
    const response = await fetch(`${API_BASE_URL}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const serverError = data.error || data.message || '';

        // If the backend route is missing, Express returns { error: 'Route not found' } with 404.
        if (response.status === 404 && /route not found/i.test(serverError)) {
            throw new Error('Password reset feature is unavailable. Please restart the server and try again.');
        }

        throw new Error(serverError || 'Failed to send reset link');
    }
    return data;
}

if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showForgotPasswordModal();
    });
}

if (closeForgotButtons.length) {
    closeForgotButtons.forEach((btn) => {
        btn.addEventListener('click', () => hideForgotPasswordModal());
    });
}

if (sendResetLinkBtn) {
    sendResetLinkBtn.addEventListener('click', async () => {
        const email = forgotEmailInput?.value?.trim() || '';
        if (!email) {
            showNotification('Please enter your email address.', 'error');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showNotification('Please enter a valid email address.', 'error');
            return;
        }

        const originalText = sendResetLinkBtn.textContent;
        sendResetLinkBtn.textContent = 'Sending...';
        sendResetLinkBtn.disabled = true;

        try {
            const data = await requestPasswordReset(email);
            showNotification(data.message || 'If that email exists, a reset link has been sent.', 'success');
            hideForgotPasswordModal();
        } catch (error) {
            console.error('Password reset request error:', error);
            showNotification(error.message || 'Failed to send reset link', 'error');
        } finally {
            sendResetLinkBtn.textContent = originalText;
            sendResetLinkBtn.disabled = false;
        }
    });
}

// Contact Us modal handlers
if (contactBtn) {
    contactBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showContactModal();
    });
}

if (closeContactButtons.length) {
    closeContactButtons.forEach((btn) => {
        btn.addEventListener('click', () => hideContactModal());
    });
}

if (contactModal) {
    contactModal.addEventListener('click', async (e) => {
        const btn = e.target.closest('.copy-email-btn');
        if (!btn) return;

        const email = btn.getAttribute('data-email') || '';
        if (!email) return;

        const ok = await copyTextToClipboard(email);
        showNotification(ok ? 'Email copied to clipboard.' : 'Failed to copy. Please copy manually.', ok ? 'success' : 'error');
    });
}

// Function to show notification
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

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode === container) {
            container.removeChild(notification);
        }
    }, 5000);
}

// Teacher Login Function
async function teacherLogin(email, password) {
    let response;

    try {
        response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
        console.error('Login error:', error);
        return;
    }

    const data = await safeParseJson(response);

    if (!response.ok) {
        const message = String(data?.error || 'Login failed');

        if (response.status === 401) {
            showNotification('Invalid credentials. Please try again.', 'error');
            clearTeacherLoginInputs();
            scrollToLoginInput('teacher');
            return;
        } else {
            showNotification(message, 'error');
        }
        return;
    }

    // Store token and user data
    localStorage.setItem('userToken', data.token);
    localStorage.setItem('userData', JSON.stringify(data.user));
    try {
        localStorage.setItem('kbs:lastActiveAt', String(Date.now()));
        localStorage.removeItem('kbs:idleLogoutAt');
    } catch {
        // ignore storage errors
    }

    showNotification('Login successful!', 'success');

    // Redirect to dashboard after a short delay
    setTimeout(() => {
        window.location.href = ROUTES.dashboard;
    }, 1000);
}

// Admin Login Function
async function adminLogin(username, password) {
    let response;

    try {
        response = await fetch(`${API_BASE_URL}/auth/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
        console.error('Admin login error:', error);
        return;
    }

    const data = await safeParseJson(response);

    if (!response.ok) {
        const message = String(data?.error || 'Admin login failed');

        if (response.status === 401) {
            showNotification('Invalid credentials. Please try again.', 'error');
            clearAdminLoginInputs();
            scrollToLoginInput('admin');
            return;
        } else {
            showNotification(message, 'error');
        }
        return;
    }

    // Store token and admin data
    localStorage.setItem('adminToken', data.token);
    localStorage.setItem('adminData', JSON.stringify(data.admin));
    try {
        localStorage.setItem('kbs:lastActiveAt', String(Date.now()));
        localStorage.removeItem('kbs:idleLogoutAt');
    } catch {
        // ignore storage errors
    }

    showNotification('Admin login successful!', 'success');

    // Redirect to admin dashboard after a short delay
    setTimeout(() => {
        window.location.href = ROUTES.admin;
    }, 1000);
}

// Form validation for teacher form
teacherForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const email = document.getElementById('teacher-id').value.trim();
    const password = document.getElementById('teacher-pass').value;

    if (!email || !password) {
        showModal('Please fill in all fields.');
        return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showModal('Please enter a valid email address.');
        return;
    }

    if (password.length < 6) {
        showModal('Password must be at least 6 characters long.');
        return;
    }

    // Show loading state
    const submitBtn = teacherSubmitBtn || teacherForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Logging in...';
    isTeacherSubmitting = true;
    syncTeacherSubmitState();

    try {
        await teacherLogin(email, password);
    } finally {
        // Restore button state
        submitBtn.textContent = originalText;
        isTeacherSubmitting = false;
        syncTeacherSubmitState();
    }
});

// Form validation for admin form
adminForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const username = document.getElementById('admin-user').value.trim();
    const password = document.getElementById('admin-pass').value;

    if (!username || !password) {
        showModal('Please fill in all fields.');
        return;
    }

    if (password.length < 6) {
        showModal('Password must be at least 6 characters long.');
        return;
    }

    // Show loading state
    const submitBtn = adminSubmitBtn || adminForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Logging in...';
    isAdminSubmitting = true;
    syncAdminSubmitState();

    try {
        await adminLogin(username, password);
    } finally {
        // Restore button state
        submitBtn.textContent = originalText;
        isAdminSubmitting = false;
        syncAdminSubmitState();
    }
});

// Check if user is already logged in
function checkExistingLogin() {
    const userToken = localStorage.getItem('userToken');
    const adminToken = localStorage.getItem('adminToken');

    if (userToken) {
        // User is logged in, redirect to dashboard
        window.location.href = ROUTES.dashboard;
    } else if (adminToken) {
        // Admin is logged in, redirect to admin dashboard
        window.location.href = ROUTES.admin;
    }
}

function showIdleLogoutNoticeIfNeeded() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const reason = String(params.get('reason') || '').trim().toLowerCase();
        if (reason !== 'idle') return;

        showNotification('Session expired due to inactivity. Please log in again.', 'info');

        params.delete('reason');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', nextUrl);
    } catch {
        // ignore
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    syncTeacherSubmitState();
    syncAdminSubmitState();
    checkExistingLogin();
    showIdleLogoutNoticeIfNeeded();
    
    // Focus on first input field
    const firstInput = document.querySelector('input');
    if (firstInput) {
        firstInput.focus();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape key closes modal
    if (e.key === 'Escape' && validationModal.style.display === 'flex') {
        hideModal();
    }

    if (e.key === 'Escape' && forgotPasswordModal && forgotPasswordModal.style.display === 'flex') {
        hideForgotPasswordModal();
    }
    
    // Tab key switches between forms
    if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        if (teacherForm.classList.contains('active')) {
            adminBtn.click();
        } else {
            teacherBtn.click();
        }
    }
});
