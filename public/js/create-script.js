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

// DOM Elements
const elements = {
    createAccountForm: document.getElementById('createAccountForm'),
    verificationModal: document.getElementById('verificationModal'),
    verificationEmailDisplay: document.getElementById('verificationEmailDisplay'),
    verificationExpiresIn: document.getElementById('verificationExpiresIn'),
    resendCodeBtn: document.getElementById('resendCodeBtn'),
    closeModal: document.querySelectorAll('#verificationModal .close'),
    verifyBtn: document.getElementById('verifyBtn'),
    invalidModal: document.getElementById('invalidModal'),
    closeInvalidModal: document.querySelector('.close-invalid'),
    closeInvalidBtn: document.getElementById('closeInvalidBtn'),
    emptyModal: document.getElementById('emptyModal'),
    closeEmptyModal: document.querySelector('.close-empty'),
    closeEmptyBtn: document.getElementById('closeEmptyBtn'),
    successModal: document.getElementById('successModal'),
    closeSuccessModal: document.querySelector('.close-success'),
    closeSuccessBtn: document.getElementById('closeSuccessBtn'),
    aboutBtn: document.getElementById('aboutBtn'),
    devTeamSection: document.getElementById('dev-team')
};

const createSubmitBtn = elements.createAccountForm ? elements.createAccountForm.querySelector('button[type="submit"]') : null;

const syncCreateSubmitState = () => {
    if (!createSubmitBtn) return;
    createSubmitBtn.disabled = false;
};

// Function to show modal
function showModal(modal) {
    if (modal) {
        modal.style.display = 'block';
        modal.classList.add('show');
    }
}

// Function to hide modal
function hideModal(modal) {
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
    }
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

const safeParseJson = async (response) => {
    try {
        return await response.json();
    } catch {
        return null;
    }
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

let pendingVerificationEmail = '';
let pendingVerificationExpiresMinutes = 10;

// Request email verification code
async function requestVerificationCode({ firstName, lastName, email, password }) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/register/request-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                firstName,
                lastName,
                email,
                password
            })
        });

        const data = await safeParseJson(response);

        if (!response.ok) {
            const message = String(data?.error || 'Failed to send verification code');
            if (response.status === 404 && message.toLowerCase().includes('route not found')) {
                throw new Error('Backend is not updated. Please restart the server and try again.');
            }
            throw new Error(message);
        }

        return data;
    } catch (error) {
        console.error('Request code error:', error);
        throw error;
    }
}

async function resendVerificationCode(email) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/register/resend-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const data = await safeParseJson(response);
        if (!response.ok) {
            const message = String(data?.error || 'Failed to resend verification code');
            if (response.status === 404 && message.toLowerCase().includes('route not found')) {
                throw new Error('Backend is not updated. Please restart the server and try again.');
            }
            throw new Error(message);
        }
        return data;
    } catch (error) {
        console.error('Resend code error:', error);
        throw error;
    }
}

async function verifyVerificationCode(email, code) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/register/verify-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, code })
        });

        const data = await safeParseJson(response);
        if (!response.ok) {
            const message = String(data?.error || 'Failed to verify code');
            if (response.status === 404 && message.toLowerCase().includes('route not found')) {
                throw new Error('Backend is not updated. Please restart the server and try again.');
            }
            throw new Error(message);
        }
        return data;
    } catch (error) {
        console.error('Verify code error:', error);
        throw error;
    }
}

// Handle form submission
if (elements.createAccountForm) {
    elements.createAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get form values
        const firstName = document.getElementById('create-name').value.trim();
        const lastName = document.getElementById('create-lastname').value.trim();
        const email = document.getElementById('create-email').value.trim();
        const password = document.getElementById('create-pass').value;

        // Validate form fields
        if (!firstName || !lastName || !email || !password) {
            showNotification('Please fill in all fields.', 'error');
            return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showNotification('Please enter a valid email address.', 'error');
            return;
        }

        // Validate password length
        if (password.length < 6) {
            showNotification('Password must be at least 6 characters long.', 'error');
            return;
        }

        const submitBtn = createSubmitBtn;
        const originalText = submitBtn ? submitBtn.textContent : '';

        try {
            if (submitBtn) {
                submitBtn.textContent = 'Sending code...';
                submitBtn.disabled = true;
            }

            const result = await requestVerificationCode({
                firstName,
                lastName,
                email,
                password
            });

            pendingVerificationEmail = normalizeEmail(email);
            pendingVerificationExpiresMinutes = Number(result?.expiresMinutes || 10) || 10;

            if (elements.verificationEmailDisplay) {
                elements.verificationEmailDisplay.textContent = pendingVerificationEmail;
            }
            if (elements.verificationExpiresIn) {
                elements.verificationExpiresIn.textContent = `${pendingVerificationExpiresMinutes} minutes`;
            }

            const codeInput = document.getElementById('verificationCode');
            if (codeInput) codeInput.value = '';

            showModal(elements.verificationModal);
            setTimeout(() => codeInput?.focus(), 0);

            showNotification('Verification code sent. Please check your email.', 'success');
        } catch (error) {
            showNotification(error.message || 'Failed to send verification code.', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.textContent = originalText || 'Create Account';
                submitBtn.disabled = false;
            }
        }
    });
}

// Handle verify button
if (elements.verifyBtn) {
    elements.verifyBtn.addEventListener('click', async () => {
        const code = String(document.getElementById('verificationCode')?.value || '').trim();
        
        if (code === '') {
            // Show empty modal
            hideModal(elements.verificationModal);
            showModal(elements.emptyModal);
            return;
        }

        if (!pendingVerificationEmail) {
            hideModal(elements.verificationModal);
            showNotification('Please submit the form again to request a verification code.', 'error');
            return;
        }

        try {
            // Show loading
            elements.verifyBtn.textContent = 'Verifying...';
            elements.verifyBtn.disabled = true;

            await verifyVerificationCode(pendingVerificationEmail, code);

            // Hide verification modal and show success modal
            hideModal(elements.verificationModal);
            showModal(elements.successModal);

            // Auto-redirect after 3 seconds
            setTimeout(() => {
                hideModal(elements.successModal);
                elements.createAccountForm.reset();
                window.location.href = ROUTES.home;
            }, 3000);

        } catch (error) {
            console.error('Registration error:', error);
            const message = String(error?.message || '');
            if (message.toLowerCase().includes('invalid verification code')) {
                hideModal(elements.verificationModal);
                showModal(elements.invalidModal);
            } else {
                showNotification(message || 'Verification failed. Please try again.', 'error');
            }
            
            // Reset button
            elements.verifyBtn.textContent = 'Verify Code';
            elements.verifyBtn.disabled = false;
        }
    });
}

// Handle resend code button (uses server cooldown)
if (elements.resendCodeBtn) {
    elements.resendCodeBtn.addEventListener('click', async () => {
        if (!pendingVerificationEmail) {
            showNotification('Please submit the form first to request a code.', 'error');
            return;
        }

        const originalText = elements.resendCodeBtn.textContent;
        elements.resendCodeBtn.textContent = 'Resending...';
        elements.resendCodeBtn.disabled = true;

        try {
            const result = await resendVerificationCode(pendingVerificationEmail);
            const expires = Number(result?.expiresMinutes || pendingVerificationExpiresMinutes || 10) || 10;
            pendingVerificationExpiresMinutes = expires;
            if (elements.verificationExpiresIn) {
                elements.verificationExpiresIn.textContent = `${expires} minutes`;
            }
            showNotification('Verification code resent. Please check your email.', 'success');
        } catch (error) {
            showNotification(error.message || 'Failed to resend code.', 'error');
        } finally {
            elements.resendCodeBtn.textContent = originalText;
            elements.resendCodeBtn.disabled = false;
        }
    });
}

// Close modal buttons
if (elements.closeModal && elements.closeModal.length) {
    elements.closeModal.forEach((btn) => {
        btn.addEventListener('click', () => {
            hideModal(elements.verificationModal);
        });
    });
}

if (elements.closeInvalidModal) {
    elements.closeInvalidModal.addEventListener('click', () => {
        hideModal(elements.invalidModal);
        showModal(elements.verificationModal);
    });
}

if (elements.closeInvalidBtn) {
    elements.closeInvalidBtn.addEventListener('click', () => {
        hideModal(elements.invalidModal);
        showModal(elements.verificationModal);
    });
}

if (elements.closeEmptyModal) {
    elements.closeEmptyModal.addEventListener('click', () => {
        hideModal(elements.emptyModal);
        showModal(elements.verificationModal);
    });
}

if (elements.closeEmptyBtn) {
    elements.closeEmptyBtn.addEventListener('click', () => {
        hideModal(elements.emptyModal);
        showModal(elements.verificationModal);
    });
}

if (elements.closeSuccessModal) {
    elements.closeSuccessModal.addEventListener('click', () => {
        hideModal(elements.successModal);
        elements.createAccountForm.reset();
        window.location.href = ROUTES.home;
    });
}

if (elements.closeSuccessBtn) {
    elements.closeSuccessBtn.addEventListener('click', () => {
        hideModal(elements.successModal);
        elements.createAccountForm.reset();
        window.location.href = ROUTES.home;
    });
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    if (e.target === elements.verificationModal) {
        hideModal(elements.verificationModal);
    }
    if (e.target === elements.invalidModal) {
        hideModal(elements.invalidModal);
        showModal(elements.verificationModal);
    }
    if (e.target === elements.emptyModal) {
        hideModal(elements.emptyModal);
        showModal(elements.verificationModal);
    }
    if (e.target === elements.successModal) {
        hideModal(elements.successModal);
        elements.createAccountForm.reset();
        window.location.href = ROUTES.home;
    }
});

// About Us button - Smooth scroll with fade-in
if (elements.aboutBtn) {
    elements.aboutBtn.addEventListener('click', () => {
        if (elements.devTeamSection) {
            elements.devTeamSection.classList.add('visible');
            elements.devTeamSection.scrollIntoView({ behavior: 'smooth' });
        }
    });
}

// Intersection Observer for Dev Team fade-in (fallback)
if (elements.devTeamSection) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                elements.devTeamSection.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    observer.observe(elements.devTeamSection);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    syncCreateSubmitState();
    // Check if user is already logged in
    const userToken = localStorage.getItem('userToken');
    const adminToken = localStorage.getItem('adminToken');

    if (userToken) {
        window.location.href = ROUTES.dashboard;
    } else if (adminToken) {
        window.location.href = ROUTES.admin;
    }

    // Focus on first input field
    const firstInput = document.querySelector('input');
    if (firstInput) {
        firstInput.focus();
    }

    // Show the form by default
    if (elements.createAccountForm) {
        elements.createAccountForm.style.display = 'flex';
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape key closes modals
    if (e.key === 'Escape') {
        const modals = [
            elements.verificationModal,
            elements.invalidModal,
            elements.emptyModal,
            elements.successModal
        ];
        
        modals.forEach(modal => {
            if (modal && modal.style.display === 'block') {
                hideModal(modal);
                
                // For invalid/empty modals, go back to verification modal
                if (modal === elements.invalidModal || modal === elements.emptyModal) {
                    showModal(elements.verificationModal);
                }
                
                // For success modal, redirect
                if (modal === elements.successModal) {
                    elements.createAccountForm.reset();
                    window.location.href = ROUTES.home;
                }
            }
        });
    }

    // Enter key verifies code (when verification modal is open)
    if (e.key === 'Enter' && elements.verificationModal && elements.verificationModal.style.display === 'block') {
        const active = document.activeElement;
        const isInModal = active && elements.verificationModal.contains(active);
        if (isInModal) {
            e.preventDefault();
            elements.verifyBtn?.click();
        }
    }
});
