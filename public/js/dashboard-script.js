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

const ADMIN_SUPPORT_EMAIL = 'keybsu25@gmail.com';
const POPUP_DISMISS_SESSION_KEY = 'dismissedPopupAnnouncementId';

// DOM Elements
const elements = {
    // Welcome header
    welcomeHeader: document.getElementById('welcomeHeader'),
    welcomeEmail: document.getElementById('welcomeEmail'),

    // Profile photo
    profilePhotoBtn: document.getElementById('profilePhotoBtn'),
    profilePhotoInput: document.getElementById('profilePhotoInput'),
    profilePhotoImg: document.getElementById('profilePhotoImg'),
    profilePhotoFallback: document.getElementById('profilePhotoFallback'),
    
    // Sections
    activeBorrowSection: document.getElementById('activeBorrowSection'),
    availableSection: document.getElementById('availableSection'),
    historySection: document.getElementById('historySection'),
    notificationsSection: document.getElementById('notificationsSection'),
    lostSection: document.getElementById('lostSection'),
    
    // Lists
    activeBorrowList: document.getElementById('activeBorrowList'),
    availableKeysList: document.getElementById('availableKeysList'),
    lockerToggleBar: document.getElementById('lockerToggleBar'),
    historyList: document.getElementById('historyList'),
    notificationsList: document.getElementById('notificationsList'),
    
    // Counters
    activeBorrowCount: document.getElementById('activeBorrowCount'),
    availableCount: document.getElementById('availableCount'),
    
    // Navigation buttons
    dashboardHomeBtn: document.getElementById('dashboardHomeBtn'),
    historyBtn: document.getElementById('historyBtn'),
    notificationsBtn: document.getElementById('notificationsBtn'),
    lostBtn: document.getElementById('lostBtn'),
    feedbackBtn: document.getElementById('feedbackBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    backToDashboardBtn: document.getElementById('backToDashboardBtn'),
    backToDashboardFromNotificationsBtn: document.getElementById('backToDashboardFromNotificationsBtn'),
    backToDashboardFromLostBtn: document.getElementById('backToDashboardFromLostBtn'),

    // Lost key reporting
    lostKeySelect: document.getElementById('lostKeySelect'),
    lostRoomValue: document.getElementById('lostRoomValue'),
    lostLockerValue: document.getElementById('lostLockerValue'),
    lostBorrowedAtValue: document.getElementById('lostBorrowedAtValue'),
    lostMessageInput: document.getElementById('lostMessageInput'),
    lostSubmitBtn: document.getElementById('lostSubmitBtn'),
    lostFormNotice: document.getElementById('lostFormNotice'),
    lostReportsList: document.getElementById('lostReportsList'),

    // Notification UI
    notificationsToggleBtn: document.getElementById('notificationsToggleBtn'),
    notificationsBadge: document.getElementById('notificationsBadge'),
    notificationsDrawerBadge: document.getElementById('notificationsDrawerBadge'),

    // Drawer
    navDrawerSubtitle: document.getElementById('navDrawerSubtitle'),
    
    // Modals
    borrowModal: document.getElementById('borrowModal'),
    logoutModal: document.getElementById('logoutModal'),
    feedbackModal: document.getElementById('feedbackModal'),
    approvalGateModal: document.getElementById('approvalGateModal'),
    announcementPopupModal: document.getElementById('announcementPopupModal'),
    
    // Modal elements
    borrowKeyId: document.getElementById('borrowKeyId'),
    confirmBorrowBtn: document.getElementById('confirmBorrowBtn'),
    cancelBorrowBtn: document.getElementById('cancelBorrowBtn'),
    confirmLogoutBtn: document.getElementById('confirmLogoutBtn'),
    cancelLogoutBtn: document.getElementById('cancelLogoutBtn'),

    // Feedback modal elements
    feedbackMessage: document.getElementById('feedbackMessage'),
    feedbackAnonymous: document.getElementById('feedbackAnonymous'),
    feedbackEmailGroup: document.getElementById('feedbackEmailGroup'),
    feedbackEmail: document.getElementById('feedbackEmail'),
    submitFeedbackBtn: document.getElementById('submitFeedbackBtn'),
    cancelFeedbackBtn: document.getElementById('cancelFeedbackBtn'),

    // Approval gate modal elements
    approvalGateUserEmail: document.getElementById('approvalGateUserEmail'),
    approvalGateAdminEmail: document.getElementById('approvalGateAdminEmail'),
    approvalGateLogoutBtn: document.getElementById('approvalGateLogoutBtn'),

    // Popup announcement
    announcementPopupImage: document.getElementById('announcementPopupImage'),
    announcementPopupCloseBtn: document.getElementById('announcementPopupCloseBtn')
};

// State
let selectedKeyId = null;
let userData = null;
let profilePhotoBusy = false;
let availableKeysCache = null;
let dashboardAutoRefreshTimer = null;
let approvalGateActive = false;
let notificationsUnreadCount = 0;

function getBorrowedById(key) {
    const borrowedBy = key?.borrowedBy;
    if (!borrowedBy) return '';
    if (typeof borrowedBy === 'string' || typeof borrowedBy === 'number') {
        return String(borrowedBy).trim();
    }
    if (typeof borrowedBy === 'object') {
        const id = borrowedBy._id || borrowedBy.id;
        return id ? String(id).trim() : '';
    }
    return String(borrowedBy || '').trim();
}

function buildUserDisplayName(user) {
    if (!user || typeof user !== 'object') return '';
    const firstName = String(user.firstName || '').trim();
    const lastName = String(user.lastName || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    const email = String(user.email || '').trim();
    if (email) return email;
    return '';
}

function getBorrowerNameFromKey(key) {
    return buildUserDisplayName(key?.borrowedBy);
}
let currentPopupAnnouncementId = null;
let lostBorrowedKeys = [];
let lostReports = [];
let selectedLockerFilter = (() => {
    try {
        return localStorage.getItem('dashboardLockerFilter') || 'all';
    } catch {
        return 'all';
    }
})();

// Check user authentication
function checkUserAuth() {
    const userToken = localStorage.getItem('userToken');
    if (!userToken) {
        try {
            const idleAt = Number.parseInt(localStorage.getItem('kbs:idleLogoutAt') || '', 10);
            const isRecentIdleLogout = Number.isFinite(idleAt) && idleAt > 0 && (Date.now() - idleAt) < 30000;
            if (isRecentIdleLogout) {
                const idleModalVisible = document.getElementById('idleLogoutModal')?.classList?.contains('show');
                if (!idleModalVisible) {
                    window.location.href = '/?reason=idle';
                }
                return false;
            }
        } catch {
            // ignore
        }
        window.location.href = ROUTES.home;
        return false;
    }
    
    // Get user data
    const storedData = localStorage.getItem('userData');
    if (storedData) {
        userData = JSON.parse(storedData);
    }

    updateUserHeaderUI();
    
    return true;
}

function getApprovalStatus() {
    const status = String(userData?.approvalStatus || 'approved').trim().toLowerCase();
    return status || 'approved';
}

function isUserApproved() {
    return getApprovalStatus() === 'approved';
}

function stopDashboardAutoRefresh() {
    if (dashboardAutoRefreshTimer) {
        clearInterval(dashboardAutoRefreshTimer);
        dashboardAutoRefreshTimer = null;
    }
}

function startDashboardAutoRefresh() {
    stopDashboardAutoRefresh();

    // Auto-refresh every 5 seconds for shared status visibility
    dashboardAutoRefreshTimer = setInterval(() => {
        if (!elements.historySection.classList.contains('hidden')) {
            displayBorrowHistory();
        }
        if (!elements.availableSection.classList.contains('hidden')) {
            displayAvailableKeys();
        }
        if (!elements.activeBorrowSection.classList.contains('hidden')) {
            displayActiveBorrows();
        }
        if (!elements.lostSection.classList.contains('hidden')) {
            loadMyLostReports({ silent: true });
        }
    }, 5000);
}

function deriveLockerFromKeyId(keyId) {
    const match = /^KEY(\d{3})$/i.exec(String(keyId || '').trim());
    if (!match) return '';
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `Locker ${Math.ceil(num / 15)}`;
}

function setDashboardLocked(locked) {
    const lockTargets = [
        elements.dashboardHomeBtn,
        elements.historyBtn,
        elements.notificationsBtn,
        elements.lostBtn,
        elements.feedbackBtn,
        elements.backToDashboardBtn,
        elements.backToDashboardFromNotificationsBtn,
        elements.backToDashboardFromLostBtn,
        elements.profilePhotoBtn,
        elements.notificationsToggleBtn,
        elements.lostSubmitBtn
    ];

    lockTargets.forEach((btn) => {
        if (!btn) return;
        btn.disabled = Boolean(locked);
        btn.classList.toggle('is-locked', Boolean(locked));
        btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
        if (!locked) btn.removeAttribute('disabled');
    });
}

function applyApprovalGate() {
    if (isUserApproved()) {
        approvalGateActive = false;
        setDashboardLocked(false);
        return false;
    }

    approvalGateActive = true;
    stopDashboardAutoRefresh();
    setDashboardLocked(true);

    if (elements.approvalGateUserEmail) {
        elements.approvalGateUserEmail.textContent = String(userData?.email || '').trim();
    }
    if (elements.approvalGateAdminEmail) {
        elements.approvalGateAdminEmail.textContent = ADMIN_SUPPORT_EMAIL;
    }

    // Prevent other modals from staying open behind the gate.
    document.querySelectorAll('.modal.show').forEach((modal) => {
        hideModal(modal);
    });

    showModal(elements.approvalGateModal);
    return true;
}

function getProfileFallbackLetter(user) {
    const first = String(user?.firstName || '').trim();
    if (first) return first[0].toUpperCase();
    const email = String(user?.email || '').trim();
    if (email) return email[0].toUpperCase();
    return 'U';
}

function updateUserHeaderUI() {
    const firstName = String(userData?.firstName || '').trim();
    const lastName = String(userData?.lastName || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    if (elements.welcomeHeader) {
        elements.welcomeHeader.textContent = fullName ? `Welcome, ${fullName}` : 'Welcome';
    }

    if (elements.welcomeEmail) {
        const email = String(userData?.email || '').trim();
        elements.welcomeEmail.textContent = email || '';
        elements.welcomeEmail.style.display = email ? '' : 'none';
    }

    if (elements.navDrawerSubtitle) {
        const email = String(userData?.email || '').trim();
        elements.navDrawerSubtitle.textContent = email ? `Signed in as ${email}` : '';
        elements.navDrawerSubtitle.style.display = email ? '' : 'none';
    }

    if (elements.profilePhotoFallback) {
        elements.profilePhotoFallback.textContent = getProfileFallbackLetter(userData);
    }

    const btn = elements.profilePhotoBtn;
    const img = elements.profilePhotoImg;
    const photo = String(userData?.profilePhoto || '').trim();

    if (!btn || !img) return;

    if (photo && /^data:image\//i.test(photo)) {
        img.src = photo;
        btn.classList.add('has-photo');
        img.onerror = () => {
            img.removeAttribute('src');
            btn.classList.remove('has-photo');
        };
    } else {
        img.removeAttribute('src');
        btn.classList.remove('has-photo');
    }
}

function isAllowedProfilePhotoType(mime) {
    const normalized = String(mime || '').toLowerCase();
    return normalized === 'image/jpeg' || normalized === 'image/jpg' || normalized === 'image/png' || normalized === 'image/webp';
}

async function fileToSquareJpegDataUrl(file, { size = 256, quality = 0.85 } = {}) {
    const imageUrl = URL.createObjectURL(file);

    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Failed to load image'));
            el.src = imageUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is not supported');

        const sourceSize = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
        const sx = Math.max(0, Math.floor(((img.naturalWidth || img.width) - sourceSize) / 2));
        const sy = Math.max(0, Math.floor(((img.naturalHeight || img.height) - sourceSize) / 2));

        // Fill background so PNG transparency doesn't turn black in JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

        return canvas.toDataURL('image/jpeg', quality);
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
}

async function uploadProfilePhoto(file) {
    if (!file) return;

    if (!isAllowedProfilePhotoType(file.type)) {
        showNotification('Please choose a JPG, PNG, or WEBP image.', 'error');
        return;
    }

    const maxClientBytes = 5 * 1024 * 1024; // 5MB (pre-resize)
    if (file.size > maxClientBytes) {
        showNotification('Image is too large. Please choose a smaller file.', 'error');
        return;
    }

    if (profilePhotoBusy) return;
    profilePhotoBusy = true;

    if (elements.profilePhotoBtn) {
        elements.profilePhotoBtn.classList.add('is-uploading');
        elements.profilePhotoBtn.disabled = true;
    }

    try {
        const dataUrl = await fileToSquareJpegDataUrl(file, { size: 256, quality: 0.86 });
        showNotification('Updating profile picture...', 'info');

        const data = await apiRequest('/auth/profile/photo', {
            method: 'POST',
            body: JSON.stringify({ imageDataUrl: dataUrl }),
            silent: true
        });

        const photo = data?.user?.profilePhoto || null;
        userData = { ...(userData || {}), profilePhoto: photo };
        localStorage.setItem('userData', JSON.stringify(userData));
        updateUserHeaderUI();
        showNotification('Profile picture updated.', 'success');
    } catch (error) {
        console.error('Profile photo upload error:', error);
        const msg = error?.message || 'Failed to update profile picture';
        if (msg === 'Route not found') {
            showNotification('Profile photo API not available. Restart the server and refresh the page.', 'error');
        } else {
            showNotification(msg, 'error');
        }
    } finally {
        profilePhotoBusy = false;
        if (elements.profilePhotoBtn) {
            elements.profilePhotoBtn.classList.remove('is-uploading');
            elements.profilePhotoBtn.disabled = false;
        }
        if (elements.profilePhotoInput) {
            elements.profilePhotoInput.value = '';
        }
    }
}

// API Request Helper
async function apiRequest(endpoint, options = {}) {
    if (!checkUserAuth()) return null;

    const token = localStorage.getItem('userToken');
    const { silent, ...fetchOptions } = options;
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...defaultOptions,
            ...fetchOptions,
            headers: { ...defaultOptions.headers, ...fetchOptions.headers }
        });

        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem('userToken');
                localStorage.removeItem('userData');
                localStorage.removeItem('kbs:lastActiveAt');
                localStorage.removeItem('kbs:idleLogoutAt');
                try { sessionStorage.removeItem(POPUP_DISMISS_SESSION_KEY); } catch {}
                window.location.href = ROUTES.home;
                return null;
            }
            const error = await response.json();
            throw new Error(error.error || `API request failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API Request Error:', error);
        if (!silent) {
            showNotification(error.message || 'Network error', 'error');
        }
        throw error;
    }
}

// Show/Hide Modal
let announcementPopupHideTimer = null;

function showModal(modal) {
    if (!modal) return;

    const isPopupAnnouncement = modal.id === 'announcementPopupModal';
    if (!isPopupAnnouncement) {
        modal.style.display = 'flex';
        modal.classList.add('show');
        document.body.classList.add('modal-open');
        return;
    }

    if (announcementPopupHideTimer) {
        clearTimeout(announcementPopupHideTimer);
        announcementPopupHideTimer = null;
    }

    modal.style.display = 'flex';
    modal.classList.remove('show');

    // Force a reflow so the browser picks up the initial hidden state.
    void modal.offsetHeight;

    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
    document.body.classList.add('modal-open');
}

function hideModal(modal) {
    if (!modal) return;
    if (modal?.dataset?.modalLocked === 'true') return;
    const isPopupAnnouncement = modal.id === 'announcementPopupModal';
    modal.classList.remove('show');
    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }
    if (isPopupAnnouncement) {
        dismissCurrentPopupAnnouncement();
        if (announcementPopupHideTimer) {
            clearTimeout(announcementPopupHideTimer);
        }
        announcementPopupHideTimer = setTimeout(() => {
            modal.style.display = 'none';
            announcementPopupHideTimer = null;
        }, 480);
        return;
    }
    modal.style.display = 'none';
}

// Show Notification
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

// Confirm Dialog (replaces native window.confirm)
let confirmDialogUI = null;
let confirmDialogCleanup = null;

function ensureConfirmDialog() {
    if (confirmDialogUI) return confirmDialogUI;

    const modal = document.createElement('div');
    modal.id = 'appConfirmModal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'appConfirmTitle');
    modal.setAttribute('aria-describedby', 'appConfirmMessage');

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="appConfirmTitle">Confirm</h3>
                <button type="button" class="close" aria-label="Close dialog">&times;</button>
            </div>
            <div class="modal-body">
                <p id="appConfirmMessage"></p>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-confirm-cancel>Cancel</button>
                <button type="button" class="btn btn-danger" data-confirm-ok>Confirm</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    confirmDialogUI = {
        modal,
        titleEl: modal.querySelector('#appConfirmTitle'),
        messageEl: modal.querySelector('#appConfirmMessage'),
        closeBtn: modal.querySelector('.close'),
        cancelBtn: modal.querySelector('[data-confirm-cancel]'),
        okBtn: modal.querySelector('[data-confirm-ok]')
    };

    return confirmDialogUI;
}

function showConfirmDialog({
    title = 'Confirm',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    tone = 'danger' // 'danger' | 'warning' | 'success' | 'secondary'
} = {}) {
    const ui = ensureConfirmDialog();

    if (confirmDialogCleanup) {
        confirmDialogCleanup(false);
    }

    ui.titleEl.textContent = title;
    ui.messageEl.textContent = message;
    ui.okBtn.textContent = confirmText;
    ui.cancelBtn.textContent = cancelText;

    ui.okBtn.classList.remove('btn-danger', 'btn-warning', 'btn-success', 'btn-secondary');
    if (tone === 'warning') ui.okBtn.classList.add('btn-warning');
    else if (tone === 'success') ui.okBtn.classList.add('btn-success');
    else if (tone === 'secondary') ui.okBtn.classList.add('btn-secondary');
    else ui.okBtn.classList.add('btn-danger');

    showModal(ui.modal);
    setTimeout(() => ui.okBtn.focus(), 0);

    return new Promise((resolve) => {
        const cleanup = (result) => {
            confirmDialogCleanup = null;
            ui.okBtn.removeEventListener('click', onOk);
            ui.cancelBtn.removeEventListener('click', onCancel);
            ui.closeBtn.removeEventListener('click', onCancel);
            ui.modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKeyDown);
            hideModal(ui.modal);
            resolve(Boolean(result));
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onBackdrop = (e) => {
            if (e.target === ui.modal) cleanup(false);
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') cleanup(false);
        };

        confirmDialogCleanup = cleanup;

        ui.okBtn.addEventListener('click', onOk);
        ui.cancelBtn.addEventListener('click', onCancel);
        ui.closeBtn.addEventListener('click', onCancel);
        ui.modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKeyDown);
    });
}

// Initialize Teacher Dashboard
async function initializeTeacherDashboard() {
    if (!checkUserAuth()) return;

    try {
        await refreshUserProfile();
        if (applyApprovalGate()) return;
        await Promise.all([
            displayAvailableKeys(),
            displayActiveBorrows(),
            displayBorrowHistory(),
            refreshAnnouncementsSummary()
        ]);
        startDashboardAutoRefresh();
    } catch (error) {
        console.error('Dashboard initialization error:', error);
        showNotification('Failed to initialize dashboard', 'error');
    }
}

function setSelectedLockerFilter(value, { rerender = true } = {}) {
    const next = String(value || '').trim() || 'all';
    selectedLockerFilter = next;
    try {
        localStorage.setItem('dashboardLockerFilter', selectedLockerFilter);
    } catch {
        // ignore
    }

    if (rerender) {
        renderLockerToggleBar();
        renderAvailableKeysFromCache({ preserveScroll: false });
    }
}

function renderLockerToggleBar() {
    const bar = elements.lockerToggleBar;
    if (!bar) return;

    const labels = Array.isArray(availableKeysCache?.lockerLabels) ? availableKeysCache.lockerLabels : [];

    bar.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `locker-toggle-btn ${selectedLockerFilter === 'all' ? 'active' : ''}`;
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => setSelectedLockerFilter('all'));
    bar.appendChild(allBtn);

    labels.forEach((label) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `locker-toggle-btn ${selectedLockerFilter === label ? 'active' : ''}`;
        btn.textContent = label;
        btn.addEventListener('click', () => setSelectedLockerFilter(label));
        bar.appendChild(btn);
    });
}

function renderAvailableKeysFromCache({ preserveScroll = true } = {}) {
    const availableKeysList = elements.availableKeysList;
    if (!availableKeysList || !availableKeysCache) return;

    const prevScrollTop = preserveScroll ? availableKeysList.scrollTop : 0;
    const { lockerLabels, groups, myUserId, totalAvailableCount, totalKeys } = availableKeysCache;

    const labelsToRender = selectedLockerFilter === 'all'
        ? lockerLabels
        : lockerLabels.filter((label) => label === selectedLockerFilter);

    availableKeysList.innerHTML = '';

    if (!labelsToRender || labelsToRender.length === 0) {
        availableKeysList.innerHTML = `
            <div class="key-card">
                <p class="text-center">No keys found.</p>
                <p class="text-center text-muted">Please check back later.</p>
            </div>
        `;

        if (elements.availableCount) {
            elements.availableCount.textContent = 'Available: 0 / Total: 0';
        }
        return;
    }

    const humanizeStatus = (value) => {
        const text = String(value || '').trim();
        if (!text) return 'Unknown';
        return text.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    };

    labelsToRender.forEach((lockerLabel) => {
        const lockerKeys = (groups.get(lockerLabel) || []).slice();
        lockerKeys.sort((a, b) => String(a.keyId || '').localeCompare(String(b.keyId || '')));

        const groupAvailableCount = lockerKeys.reduce((acc, key) => {
            const status = String(key.status || '').toLowerCase();
            return acc + (status === 'available' ? 1 : 0);
        }, 0);

        const groupEl = document.createElement('div');
        groupEl.className = 'locker-group';
        groupEl.innerHTML = `
            <div class="locker-header">
                <div class="locker-title-wrap">
                    <h3 class="locker-title">${lockerLabel}</h3>
                    <p class="locker-meta text-muted">Available: ${groupAvailableCount} / Total: ${lockerKeys.length}</p>
                </div>
            </div>
            <div class="keys-grid locker-keys-grid"></div>
        `;

        const grid = groupEl.querySelector('.locker-keys-grid');

        lockerKeys.forEach((key) => {
            const status = String(key.status || '').toLowerCase();
            const isBorrowed = status === 'borrowed';
            const borrowedById = getBorrowedById(key);
            const isMine = isBorrowed && myUserId && borrowedById === myUserId;
            const borrowerName = isBorrowed ? getBorrowerNameFromKey(key) : '';
            const currentUserLabel = isBorrowed
                ? (isMine ? 'You' : borrowerName || 'Another user')
                : '';
            const borrowedAtLabel = isBorrowed && key.borrowedAt
                ? new Date(key.borrowedAt).toLocaleString()
                : '';

            const cardStatusClass = status === 'available'
                ? 'available'
                : status === 'borrowed'
                    ? 'borrowed'
                    : status;

            const badgeClass = status === 'available'
                ? 'status-available'
                : status === 'borrowed'
                    ? 'status-borrowed'
                    : `status-${status}`;

            const badgeText = status === 'available'
                ? 'Available'
                : status === 'borrowed'
                    ? (isMine ? 'Borrowed (You)' : 'Borrowed')
                    : humanizeStatus(status);

            let actionHtml = '';
            if (status === 'available') {
                actionHtml = `
                    <button class="btn btn-small btn-success borrow-btn" data-key-id="${key.keyId}">
                        Borrow Key
                    </button>
                `;
            } else if (status === 'borrowed' && isMine) {
                actionHtml = `
                    <button class="btn btn-small btn-danger return-btn" data-key-id="${key.keyId}">
                        Return Key
                    </button>
                `;
            } else {
                actionHtml = `
                    <button class="btn btn-small btn-secondary" disabled>
                        Currently Borrowed
                    </button>
                `;
            }

            const keyItem = document.createElement('div');
            keyItem.className = `key-card ${cardStatusClass}`;
            keyItem.innerHTML = `
                <div class="key-header">
                    <h3>${key.keyId}</h3>
                    <span class="key-status ${badgeClass}">${badgeText}</span>
                </div>
                <div class="key-details">
                    <p><strong>Room:</strong> ${key.room}</p>
                    ${key.building ? `<p><strong>Building:</strong> ${key.building}</p>` : ''}
                    ${key.description ? `<p><strong>Description:</strong> ${key.description}</p>` : ''}
                    ${isBorrowed ? `<p><strong>Current User:</strong> ${currentUserLabel}</p>` : ''}
                    ${borrowedAtLabel ? `<p><strong>Borrowed Since:</strong> ${borrowedAtLabel}</p>` : ''}
                </div>
                <div class="key-actions">
                    ${actionHtml}
                </div>
            `;
            grid.appendChild(keyItem);
        });

        availableKeysList.appendChild(groupEl);
    });

    if (elements.availableCount) {
        elements.availableCount.textContent = `Available: ${totalAvailableCount} / Total: ${totalKeys}`;
    }

    attachAvailableKeysEventListeners();
    availableKeysList.scrollTop = prevScrollTop;
}

// Display Available Keys
async function displayAvailableKeys() {
    try {
        const availableKeysList = elements.availableKeysList;
        if (!availableKeysList) return;

        // Show loading only on first load (avoid UI flicker on auto-refresh)
        if (availableKeysList.childElementCount === 0) {
            availableKeysList.innerHTML = '<div class="spinner"></div>';
        }

        const data = await apiRequest('/keys');
        if (!data || !data.keys) return;

        const myUserId = userData?.id ? String(userData.id) : null;
        const keys = Array.isArray(data.keys) ? [...data.keys] : [];

        if (keys.length === 0) {
            availableKeysCache = null;
            if (elements.lockerToggleBar) elements.lockerToggleBar.innerHTML = '';
            availableKeysList.innerHTML = `
                <div class="key-card">
                    <p class="text-center">No keys found.</p>
                    <p class="text-center text-muted">Please check back later.</p>
                </div>
            `;

            if (elements.availableCount) {
                elements.availableCount.textContent = 'Available: 0 / Total: 0';
            }
            return;
        }

        const deriveLockerFromKeyId = (keyId) => {
            const match = /^KEY(\d{3})$/i.exec(String(keyId || '').trim());
            if (!match) return '';
            const num = Number(match[1]);
            if (!Number.isFinite(num) || num <= 0) return '';
            return `Locker ${Math.ceil(num / 15)}`;
        };

        const normalizeLockerLabel = (lockerValue, keyId) => {
            if (lockerValue === '') return 'Unassigned';
            if (lockerValue === undefined || lockerValue === null) {
                const derived = deriveLockerFromKeyId(keyId);
                return derived || 'Unassigned';
            }
            const trimmed = String(lockerValue || '').trim();
            return trimmed || 'Unassigned';
        };

        const lockerSortKey = (label) => {
            const trimmed = String(label || '').trim();
            const normalized = trimmed.toLowerCase();
            if (normalized === 'unassigned') return { rank: 2, num: Number.POSITIVE_INFINITY, text: normalized };
            const match = /^locker\s*(\d+)$/i.exec(trimmed);
            if (match) return { rank: 0, num: parseInt(match[1], 10), text: normalized };
            return { rank: 1, num: Number.POSITIVE_INFINITY, text: normalized };
        };

        const groups = new Map();
        keys.forEach((key) => {
            const lockerLabel = normalizeLockerLabel(key.locker, key.keyId);
            if (!groups.has(lockerLabel)) groups.set(lockerLabel, []);
            groups.get(lockerLabel).push(key);
        });

        const lockerLabels = Array.from(groups.keys()).sort((a, b) => {
            const ka = lockerSortKey(a);
            const kb = lockerSortKey(b);
            if (ka.rank !== kb.rank) return ka.rank - kb.rank;
            if (ka.num !== kb.num) return ka.num - kb.num;
            return ka.text.localeCompare(kb.text);
        });

        const totalAvailableCount = keys.reduce((acc, key) => {
            const status = String(key.status || '').toLowerCase();
            return acc + (status === 'available' ? 1 : 0);
        }, 0);

        if (selectedLockerFilter !== 'all' && !lockerLabels.includes(selectedLockerFilter)) {
            setSelectedLockerFilter('all', { rerender: false });
        }

        availableKeysCache = {
            keys,
            groups,
            lockerLabels,
            myUserId,
            totalAvailableCount,
            totalKeys: keys.length
        };

        renderLockerToggleBar();
        renderAvailableKeysFromCache({ preserveScroll: true });

    } catch (error) {
        console.error('Error fetching available keys:', error);
        availableKeysCache = null;
        if (elements.lockerToggleBar) elements.lockerToggleBar.innerHTML = '';
        elements.availableKeysList.innerHTML = `
            <div class="key-card">
                <p class="text-center error">Error loading keys. Please try again.</p>
                <button class="btn btn-secondary" onclick="displayAvailableKeys()" style="margin-top: 15px;">
                    Retry
                </button>
            </div>
        `;
    }
}

// Display Active Borrows
async function displayActiveBorrows() {
    try {
        const activeBorrowList = elements.activeBorrowList;
        if (!activeBorrowList) return;

        // Show loading only on first load (avoid UI flicker on auto-refresh)
        if (activeBorrowList.childElementCount === 0) {
            activeBorrowList.innerHTML = '<div class="spinner"></div>';
        }

        const data = await apiRequest('/keys/borrowed');
        if (!data || !data.keys) return;

        activeBorrowList.innerHTML = '';

        if (data.keys.length === 0) {
            activeBorrowList.innerHTML = `
                <div class="key-card">
                    <p class="text-center">No active borrows.</p>
                    <p class="text-center text-muted">You haven't borrowed any keys yet.</p>
                </div>
            `;
            
            if (elements.activeBorrowCount) {
                elements.activeBorrowCount.textContent = 'Active Borrows: 0';
            }
            return;
        }

        data.keys.forEach(key => {
            const borrowDate = key.borrowedAt ? new Date(key.borrowedAt) : new Date();
            const keyItem = document.createElement('div');
            keyItem.className = 'key-card borrowed';
            keyItem.innerHTML = `
                <div class="key-header">
                    <h3>${key.keyId}</h3>
                    <span class="key-status status-borrowed">Borrowed</span>
                </div>
                <div class="key-details">
                    <p><strong>Room:</strong> ${key.room}</p>
                    ${key.building ? `<p><strong>Building:</strong> ${key.building}</p>` : ''}
                    <p><strong>Borrowed:</strong> ${borrowDate.toLocaleString()}</p>
                </div>
                <div class="key-actions">
                    <button class="btn btn-small btn-danger return-btn" 
                            data-key-id="${key.keyId}">
                        Return Key
                    </button>
                </div>
            `;
            activeBorrowList.appendChild(keyItem);
        });

        // Update count
        if (elements.activeBorrowCount) {
            elements.activeBorrowCount.textContent = `Active Borrows: ${data.keys.length}`;
        }

        // Attach event listeners
        attachActiveBorrowsEventListeners();

    } catch (error) {
        console.error('Error fetching borrowed keys:', error);
        elements.activeBorrowList.innerHTML = `
            <div class="key-card">
                <p class="text-center error">Error loading borrowed keys. Please try again.</p>
                <button class="btn btn-secondary" onclick="displayActiveBorrows()" style="margin-top: 15px;">
                    Retry
                </button>
            </div>
        `;
    }
}

// Display Borrow History
async function displayBorrowHistory() {
    try {
        const historyList = elements.historyList;
        if (!historyList) return;

        const data = await apiRequest('/transactions/user');
        if (!data || !data.transactions) return;

        historyList.innerHTML = '';

        if (data.transactions.length === 0) {
            historyList.innerHTML = `
                <div class="key-card">
                    <p class="text-center">No borrow history.</p>
                    <p class="text-center text-muted">Your borrowing history will appear here.</p>
                </div>
            `;
            return;
        }

        data.transactions.forEach(transaction => {
            const transactionDate = new Date(transaction.createdAt);
            const isBorrow = transaction.action === 'borrow';
            
            const historyItem = document.createElement('div');
            historyItem.className = `key-card ${isBorrow ? 'borrowed' : 'available'}`;
            historyItem.innerHTML = `
                <div class="key-header">
                    <h3>${transaction.keyId}</h3>
                    <span class="key-status status-${transaction.action}">
                        ${transaction.action}
                    </span>
                </div>
                <div class="key-details">
                    <p><strong>Date:</strong> ${transactionDate.toLocaleString()}</p>
                    <p><strong>Method:</strong> ${transaction.scannedBy || 'QR Code'}</p>
                    ${transaction.notes ? `<p><strong>Notes:</strong> ${transaction.notes}</p>` : ''}
                </div>
            `;
            historyList.appendChild(historyItem);
        });

    } catch (error) {
        console.error('Error fetching transaction history:', error);
        elements.historyList.innerHTML = `
            <div class="key-card">
                <p class="text-center error">Error loading history. Please try again.</p>
                <button class="btn btn-secondary" onclick="displayBorrowHistory()" style="margin-top: 15px;">
                    Retry
                </button>
            </div>
        `;
    }
}

function setLostFormNotice(text, tone = '') {
    const el = elements.lostFormNotice;
    if (!el) return;
    const msg = String(text || '').trim();

    el.textContent = msg;
    el.style.display = msg ? '' : 'none';

    el.classList.remove('text-danger', 'text-success', 'text-warning', 'text-muted');
    if (tone === 'error') el.classList.add('text-danger');
    else if (tone === 'success') el.classList.add('text-success');
    else if (tone === 'warning') el.classList.add('text-warning');
    else el.classList.add('text-muted');
}

function setLostMeta({ room = '—', locker = '—', borrowedAt = '—' } = {}) {
    if (elements.lostRoomValue) elements.lostRoomValue.textContent = room || '—';
    if (elements.lostLockerValue) elements.lostLockerValue.textContent = locker || '—';
    if (elements.lostBorrowedAtValue) elements.lostBorrowedAtValue.textContent = borrowedAt || '—';
}

function getSelectedLostKeyId() {
    return String(elements.lostKeySelect?.value || '').trim().toUpperCase();
}

function getLostKeyOptionLabel(key) {
    const keyId = String(key?.keyId || '').trim().toUpperCase();
    const room = String(key?.room || '').trim();
    const locker = String(key?.locker ?? '').trim() || deriveLockerFromKeyId(keyId) || 'Unassigned';
    const parts = [keyId, room ? `Room ${room}` : '', locker].filter(Boolean);
    return parts.join(' • ') || keyId || '—';
}

function updateLostMetaFromSelection() {
    const keyId = getSelectedLostKeyId();
    const key = lostBorrowedKeys.find((k) => String(k?.keyId || '').trim().toUpperCase() === keyId) || null;
    if (!key) {
        setLostMeta();
        return;
    }

    const room = String(key.room || '').trim() || '—';
    const locker = String(key.locker ?? '').trim() || deriveLockerFromKeyId(key.keyId) || 'Unassigned';
    const borrowedAt = key.borrowedAt ? new Date(key.borrowedAt) : null;
    setLostMeta({
        room,
        locker,
        borrowedAt: borrowedAt && !Number.isNaN(borrowedAt.getTime()) ? borrowedAt.toLocaleString() : '—'
    });
}

function renderLostBorrowedKeysSelect(keys) {
    const select = elements.lostKeySelect;
    const submitBtn = elements.lostSubmitBtn;

    lostBorrowedKeys = Array.isArray(keys) ? keys : [];

    if (!select) return;
    select.innerHTML = '';

    if (lostBorrowedKeys.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No active borrowed keys';
        select.appendChild(opt);
        select.disabled = true;
        if (submitBtn) submitBtn.disabled = true;
        setLostMeta();
        setLostFormNotice('No active borrowed keys found. If you returned all keys, there is nothing to report.', 'warning');
        return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a key…';
    select.appendChild(placeholder);

    lostBorrowedKeys.forEach((key) => {
        const keyId = String(key?.keyId || '').trim().toUpperCase();
        if (!keyId) return;
        const option = document.createElement('option');
        option.value = keyId;
        option.textContent = getLostKeyOptionLabel(key);
        select.appendChild(option);
    });

    select.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    setLostFormNotice('', 'info');

    if (select.options.length === 2) {
        // Auto-select the only key.
        select.value = select.options[1].value;
    }

    updateLostMetaFromSelection();
}

async function loadLostBorrowedKeys({ silent = true } = {}) {
    try {
        if (elements.lostKeySelect) {
            elements.lostKeySelect.disabled = true;
            elements.lostKeySelect.innerHTML = '<option value=\"\">Loading…</option>';
        }

        const data = await apiRequest('/keys/borrowed', { silent });
        const keys = Array.isArray(data?.keys) ? data.keys : [];
        renderLostBorrowedKeysSelect(keys);
    } catch (error) {
        console.error('Lost borrowed keys load error:', error);
        renderLostBorrowedKeysSelect([]);
        setLostFormNotice('Failed to load borrowed keys. Please try again.', 'error');
    }
}

function renderLostReportsList(reports) {
    const list = elements.lostReportsList;
    if (!list) return;

    lostReports = Array.isArray(reports) ? reports : [];
    list.innerHTML = '';

    if (lostReports.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'details-empty';
        empty.textContent = 'No lost reports yet.';
        list.appendChild(empty);
        return;
    }

    lostReports.forEach((r) => {
        const keyId = String(r?.keyId || '').trim().toUpperCase() || '—';
        const room = String(r?.room || '').trim();
        const locker = String(r?.locker ?? '').trim() || deriveLockerFromKeyId(keyId) || 'Unassigned';
        const statusRaw = String(r?.status || 'pending').trim().toLowerCase();
        const status = statusRaw === 'open' ? 'pending' : statusRaw;
        const badgeClass = status === 'resolved' ? 'status-available' : 'status-borrowed';
        const badgeText = status === 'resolved' ? 'Resolved' : 'Pending';
        const createdAt = r?.createdAt ? new Date(r.createdAt) : null;
        const createdLabel = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : '—';
        const message = String(r?.message || '').trim();
        const adminReadAt = r?.adminReadAt ? new Date(r.adminReadAt) : null;
        const adminReadLabel = adminReadAt && !Number.isNaN(adminReadAt.getTime()) ? adminReadAt.toLocaleString() : '';
        const adminReadByName = String(r?.adminReadByName || '').trim();
        const adminReply = String(r?.adminReply || '').trim();
        const adminRepliedAt = r?.adminRepliedAt ? new Date(r.adminRepliedAt) : null;
        const adminRepliedLabel = adminRepliedAt && !Number.isNaN(adminRepliedAt.getTime()) ? adminRepliedAt.toLocaleString() : '';
        const adminRepliedByName = String(r?.adminRepliedByName || '').trim();
        const resolutionNote = String(r?.resolutionNote || '').trim();
        const resolvedAt = r?.resolvedAt ? new Date(r.resolvedAt) : null;
        const resolvedLabel = resolvedAt && !Number.isNaN(resolvedAt.getTime()) ? resolvedAt.toLocaleString() : '';

        const card = document.createElement('div');
        card.className = 'key-card';

        const header = document.createElement('div');
        header.className = 'key-header';
        const title = document.createElement('h3');
        title.textContent = keyId;
        const badge = document.createElement('span');
        badge.className = `key-status ${badgeClass}`;
        badge.textContent = badgeText;
        header.appendChild(title);
        header.appendChild(badge);

        const details = document.createElement('div');
        details.className = 'key-details';

        const addLine = (label, value) => {
            const p = document.createElement('p');
            const strong = document.createElement('strong');
            strong.textContent = `${label}:`;
            p.appendChild(strong);
            p.appendChild(document.createTextNode(` ${value || '—'}`));
            details.appendChild(p);
        };

        addLine('Room', room || '—');
        addLine('Locker', locker || '—');
        addLine('Time', createdLabel);
        addLine(
            'Admin read',
            adminReadLabel
                ? (adminReadByName ? `${adminReadLabel} • ${adminReadByName}` : adminReadLabel)
                : 'Not yet'
        );
        if (message) addLine('Notes', message);
        if (adminReply) {
            addLine('Admin reply', adminReply);
            if (adminRepliedLabel) {
                addLine('Replied', adminRepliedByName ? `${adminRepliedLabel} • ${adminRepliedByName}` : adminRepliedLabel);
            }
        }
        if (status === 'resolved') {
            if (resolutionNote) addLine('Resolution', resolutionNote);
            if (resolvedLabel) addLine('Resolved', resolvedLabel);
        }

        card.appendChild(header);
        card.appendChild(details);
        list.appendChild(card);
    });
}

async function loadMyLostReports({ silent = true } = {}) {
    try {
        const list = elements.lostReportsList;
        if (list && list.childElementCount === 0) {
            list.innerHTML = '<div class=\"details-empty\">Loading…</div>';
        }

        const data = await apiRequest('/lost-reports/my', { silent });
        const reports = Array.isArray(data?.reports) ? data.reports : [];
        renderLostReportsList(reports);
    } catch (error) {
        console.error('Lost reports load error:', error);
        renderLostReportsList([]);
    }
}

async function refreshLostSection() {
    await Promise.all([
        loadLostBorrowedKeys({ silent: true }),
        loadMyLostReports({ silent: true })
    ]);
}

async function submitLostReport() {
    const submitBtn = elements.lostSubmitBtn;
    const keyId = getSelectedLostKeyId();
    const message = String(elements.lostMessageInput?.value || '').trim();

    if (!keyId) {
        setLostFormNotice('Select a borrowed key first.', 'warning');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
    }

    try {
        await apiRequest('/lost-reports', {
            method: 'POST',
            body: JSON.stringify({ keyId, message })
        });

        if (elements.lostMessageInput) elements.lostMessageInput.value = '';
        setLostFormNotice('Lost report submitted. Admin has been notified.', 'success');
        showNotification('Lost report submitted.', 'success');

        await refreshLostSection();
        displayAvailableKeys();
        displayActiveBorrows();
    } catch (error) {
        console.error('Lost report submit error:', error);
        const msg = error?.message || 'Failed to submit lost report';
        setLostFormNotice(msg, 'error');
        showNotification(msg, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Lost Report';
        }
    }
}

function setNotificationBadges(unreadCount) {
    const count = Number.isFinite(Number(unreadCount)) ? Math.max(0, Number(unreadCount)) : 0;
    notificationsUnreadCount = count;

    const label = count > 99 ? '99+' : String(count);
    const hidden = count <= 0;

    if (elements.notificationsBadge) {
        elements.notificationsBadge.textContent = label;
        elements.notificationsBadge.classList.toggle('hidden', hidden);
    }

    if (elements.notificationsDrawerBadge) {
        elements.notificationsDrawerBadge.textContent = label;
        elements.notificationsDrawerBadge.classList.toggle('hidden', hidden);
    }
}

async function refreshAnnouncementsSummary() {
    try {
        const data = await apiRequest('/announcements/summary', { silent: true });
        const unreadCount = Number(data?.unreadCount || 0);
        setNotificationBadges(unreadCount);

        if (data?.shouldShowPopup && isUserApproved()) {
            await showPopupAnnouncement();
        }
    } catch (error) {
        // Non-blocking: don't interrupt dashboard for notification failures.
        console.warn('Announcement summary failed:', error);
    }
}

async function showPopupAnnouncement() {
    try {
        if (!elements.announcementPopupModal || !elements.announcementPopupImage) return;
        if (elements.announcementPopupModal.classList.contains('show')) return;

        const data = await apiRequest('/announcements/popup', { silent: true });
        const popup = data?.popup;
        if (!data?.shouldShow || !popup?.imageDataUrl) return;

        const modal = elements.announcementPopupModal;
        const img = elements.announcementPopupImage;
        const popupId = String(popup.id || '').trim();
        try {
            const dismissedId = String(sessionStorage.getItem(POPUP_DISMISS_SESSION_KEY) || '').trim();
            if (dismissedId && popupId && dismissedId === popupId) {
                return;
            }
        } catch {
            // ignore
        }

        currentPopupAnnouncementId = popupId || null;
        img.removeAttribute('src');

        img.onload = () => {
            if (modal.classList.contains('show')) return;
            // Slight delay so the dashboard feels smoother right after login.
            setTimeout(() => showModal(modal), 220);
        };

        img.onerror = () => {
            img.removeAttribute('src');
            hideModal(modal);
            showNotification('Announcement image failed to load.', 'error');
        };

        img.src = popup.imageDataUrl;
    } catch (error) {
        console.warn('Popup announcement failed:', error);
    }
}

function dismissCurrentPopupAnnouncement() {
    const id = String(currentPopupAnnouncementId || '').trim();
    currentPopupAnnouncementId = null;
    if (!id) return;

    try {
        sessionStorage.setItem(POPUP_DISMISS_SESSION_KEY, id);
    } catch {
        // ignore
    }
}

function renderNotificationsList(notifications) {
    const notificationsList = elements.notificationsList;
    if (!notificationsList) return;

    const items = Array.isArray(notifications) ? notifications : [];
    notificationsList.innerHTML = '';

    if (items.length === 0) {
        notificationsList.innerHTML = `
            <div class="key-card">
                <p class="text-center">No notifications yet.</p>
                <p class="text-center text-muted">Announcements from admins will appear here.</p>
            </div>
        `;
        return;
    }

    items.forEach((n) => {
        const card = document.createElement('div');
        card.className = 'key-card announcement-card';

        const header = document.createElement('div');
        header.className = 'key-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'key-title';

        const h3 = document.createElement('h3');
        h3.textContent = String(n?.title || '').trim() || 'Announcement';
        titleWrap.appendChild(h3);

        header.appendChild(titleWrap);

        const isRead = Boolean(n?.isRead);
        const badge = document.createElement('span');
        badge.className = `status-badge ${isRead ? 'status-read' : 'status-new'}`;
        badge.textContent = isRead ? 'Read' : 'New';
        header.appendChild(badge);

        card.appendChild(header);

        const details = document.createElement('div');
        details.className = 'key-details';

        const message = String(n?.message || '').trim();
        if (message) {
            const p = document.createElement('p');
            const strong = document.createElement('strong');
            strong.textContent = 'Message:';
            p.appendChild(strong);
            p.appendChild(document.createTextNode(` ${message}`));
            details.appendChild(p);
        }

        const createdByName = String(n?.createdByName || '').trim();
        if (createdByName) {
            const p = document.createElement('p');
            const strong = document.createElement('strong');
            strong.textContent = 'From:';
            p.appendChild(strong);
            p.appendChild(document.createTextNode(` ${createdByName}`));
            details.appendChild(p);
        }

        const createdAt = n?.createdAt ? new Date(n.createdAt) : null;
        if (createdAt && !Number.isNaN(createdAt.getTime())) {
            const p = document.createElement('p');
            const strong = document.createElement('strong');
            strong.textContent = 'Time:';
            p.appendChild(strong);
            p.appendChild(document.createTextNode(` ${createdAt.toLocaleString()}`));
            details.appendChild(p);
        }

        const imageDataUrl = String(n?.imageDataUrl || '').trim();
        if (imageDataUrl && /^data:image\//i.test(imageDataUrl)) {
            const wrap = document.createElement('div');
            wrap.className = 'announcement-image-wrap';
            const img = document.createElement('img');
            img.alt = 'Announcement image';
            img.src = imageDataUrl;
            wrap.appendChild(img);
            details.appendChild(wrap);
        }

        card.appendChild(details);
        notificationsList.appendChild(card);
    });
}

async function markNotificationsSeen() {
    try {
        await apiRequest('/announcements/seen', { method: 'POST', silent: true });
        setNotificationBadges(0);
    } catch (error) {
        console.warn('Failed to mark notifications seen:', error);
    }
}

// Display Notifications (opens list)
async function displayNotifications({ markSeen = false } = {}) {
    try {
        const data = await apiRequest('/announcements?limit=100', { silent: true });
        const announcements = Array.isArray(data?.announcements) ? data.announcements : [];
        const notifications = announcements.filter((a) => String(a?.type || '').toLowerCase() === 'notification');

        renderNotificationsList(notifications);

        const unreadCount = Number(data?.unreadCount || 0);
        setNotificationBadges(unreadCount);

        if (markSeen) {
            await markNotificationsSeen();
            // Update UI badges on cards.
            notifications.forEach((n) => { n.isRead = true; });
            renderNotificationsList(notifications);
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
        const notificationsList = elements.notificationsList;
        if (notificationsList) {
            notificationsList.innerHTML = `
                <div class="key-card">
                    <p class="text-center error">Failed to load notifications.</p>
                    <button class="btn btn-secondary btn-small" id="retryNotificationsBtn" style="margin-top: 12px;">Retry</button>
                </div>
            `;
            const retry = document.getElementById('retryNotificationsBtn');
            if (retry) retry.addEventListener('click', () => displayNotifications({ markSeen }));
        }
    }
}

// Attach Available Keys Event Listeners
function attachAvailableKeysEventListeners() {
    const container = elements.availableKeysList;
    if (!container) return;

    // Borrow buttons
    container.querySelectorAll('.borrow-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            selectedKeyId = e.currentTarget.dataset.keyId;
            if (elements.borrowKeyId) {
                elements.borrowKeyId.textContent = selectedKeyId;
            }
            showModal(elements.borrowModal);
        });
    });

    // Return buttons (keys borrowed by the current user)
    container.querySelectorAll('.return-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const keyId = e.currentTarget.dataset.keyId;
            await returnKey(keyId);
        });
    });
}

// Attach Active Borrows Event Listeners
function attachActiveBorrowsEventListeners() {
    const container = elements.activeBorrowList;
    if (!container) return;

    // Return buttons
    container.querySelectorAll('.return-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const keyId = e.currentTarget.dataset.keyId;
            await returnKey(keyId);
        });
    });
}

// Borrow Key (QR scan required)
function borrowKey() {
    if (!selectedKeyId) return;
    const selectedKey = String(selectedKeyId || '').trim().toUpperCase();
    if (!/^KEY\d{3}$/.test(selectedKey)) {
        showNotification('Invalid selected key. Please try again.', 'error');
        return;
    }

    hideModal(elements.borrowModal);
    showNotification(`Scan the QR code for ${selectedKey} to complete borrow.`, 'info');

    // Redirect to QR scanner with selected key binding
    setTimeout(() => {
        const key = encodeURIComponent(selectedKey);
        window.location.href = `${ROUTES.scan}?key=${key}&intent=borrow`;
    }, 600);

    // Clear selection
    selectedKeyId = null;
}

// Return Key (QR scan required)
async function returnKey(keyId) {
    if (!keyId) return;

    const ok = await showConfirmDialog({
        title: 'Confirm Return',
        message: `Return key ${keyId}?`,
        confirmText: 'Yes, Return',
        cancelText: 'Cancel',
        tone: 'success'
    });
    if (!ok) return;

    showNotification(`Scan the QR code for ${keyId} to complete return.`, 'info');

    // Redirect to QR scanner with selected key binding
    setTimeout(() => {
        const key = encodeURIComponent(String(keyId || '').trim().toUpperCase());
        window.location.href = `${ROUTES.scan}?key=${key}&intent=return`;
    }, 600);
}

// Logout
function logout() {
    hideModal(elements.logoutModal);
    localStorage.removeItem('userToken');
    localStorage.removeItem('userData');
    localStorage.removeItem('kbs:lastActiveAt');
    localStorage.removeItem('kbs:idleLogoutAt');
    try { sessionStorage.removeItem(POPUP_DISMISS_SESSION_KEY); } catch {}
    window.location.href = ROUTES.home;
}

// Show Section
function setActiveUserNav(sectionId) {
    if (elements.dashboardHomeBtn) {
        elements.dashboardHomeBtn.classList.toggle('is-active', sectionId === 'availableSection');
    }
    if (elements.historyBtn) {
        elements.historyBtn.classList.toggle('is-active', sectionId === 'historySection');
    }
    if (elements.notificationsBtn) {
        elements.notificationsBtn.classList.toggle('is-active', sectionId === 'notificationsSection');
    }
    if (elements.lostBtn) {
        elements.lostBtn.classList.toggle('is-active', sectionId === 'lostSection');
    }
}

function showSection(sectionId) {
    // Hide all sections
    const sections = [
        elements.activeBorrowSection,
        elements.availableSection,
        elements.historySection,
        elements.notificationsSection,
        elements.lostSection
    ];
    
    sections.forEach(section => {
        if (section) section.classList.add('hidden');
    });

    // Show selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
        selectedSection.classList.remove('hidden');
    }

    setActiveUserNav(sectionId);
}

// Setup Event Listeners
function setupEventListeners() {
    if (elements.profilePhotoBtn && elements.profilePhotoInput) {
        elements.profilePhotoBtn.addEventListener('click', () => {
            if (profilePhotoBusy) return;
            elements.profilePhotoInput.value = '';
            elements.profilePhotoInput.click();
        });

        elements.profilePhotoInput.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            await uploadProfilePhoto(file);
        });
    }

    // Navigation buttons
    if (elements.dashboardHomeBtn) {
        elements.dashboardHomeBtn.addEventListener('click', () => {
            showSection('availableSection');
            if (elements.activeBorrowSection) elements.activeBorrowSection.classList.remove('hidden');
            displayAvailableKeys();
            displayActiveBorrows();
        });
    }

    if (elements.historyBtn) {
        elements.historyBtn.addEventListener('click', () => {
            showSection('historySection');
            displayBorrowHistory();
        });
    }

    const openNotifications = async () => {
        showSection('notificationsSection');
        await displayNotifications({ markSeen: true });
    };

    if (elements.notificationsBtn) {
        elements.notificationsBtn.addEventListener('click', openNotifications);
    }

    if (elements.notificationsToggleBtn) {
        elements.notificationsToggleBtn.addEventListener('click', openNotifications);
    }

    const openLostReports = async () => {
        showSection('lostSection');
        await refreshLostSection();
        setTimeout(() => elements.lostKeySelect?.focus(), 0);
    };

    if (elements.lostBtn) {
        elements.lostBtn.addEventListener('click', openLostReports);
    }

    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener('click', () => {
            showModal(elements.logoutModal);
        });
    }

    if (elements.approvalGateLogoutBtn) {
        elements.approvalGateLogoutBtn.addEventListener('click', logout);
    }

    if (elements.feedbackBtn) {
        elements.feedbackBtn.addEventListener('click', () => {
            if (elements.feedbackMessage) elements.feedbackMessage.value = '';
            if (elements.feedbackEmail) elements.feedbackEmail.value = userData?.email || '';
            if (elements.feedbackAnonymous) elements.feedbackAnonymous.checked = true;
            if (elements.feedbackEmailGroup) elements.feedbackEmailGroup.style.display = 'none';
            showModal(elements.feedbackModal);
            setTimeout(() => elements.feedbackMessage?.focus(), 0);
        });
    }

    // Back to dashboard button
    if (elements.backToDashboardBtn) {
        elements.backToDashboardBtn.addEventListener('click', () => {
            showSection('availableSection');
            elements.activeBorrowSection.classList.remove('hidden');
        });
    }

    if (elements.backToDashboardFromNotificationsBtn) {
        elements.backToDashboardFromNotificationsBtn.addEventListener('click', () => {
            showSection('availableSection');
            if (elements.activeBorrowSection) elements.activeBorrowSection.classList.remove('hidden');
        });
    }

    if (elements.backToDashboardFromLostBtn) {
        elements.backToDashboardFromLostBtn.addEventListener('click', () => {
            showSection('availableSection');
            if (elements.activeBorrowSection) elements.activeBorrowSection.classList.remove('hidden');
            displayAvailableKeys();
            displayActiveBorrows();
        });
    }

    if (elements.lostKeySelect) {
        elements.lostKeySelect.addEventListener('change', () => {
            updateLostMetaFromSelection();
            setLostFormNotice('', 'info');
        });
    }

    if (elements.lostSubmitBtn) {
        elements.lostSubmitBtn.addEventListener('click', submitLostReport);
    }

    if (elements.announcementPopupCloseBtn) {
        elements.announcementPopupCloseBtn.addEventListener('click', () => {
            hideModal(elements.announcementPopupModal);
        });
    }

    if (elements.announcementPopupModal) {
        elements.announcementPopupModal.addEventListener('click', (e) => {
            if (e.target === elements.announcementPopupModal) {
                hideModal(elements.announcementPopupModal);
            }
        });
    }

    // Modal buttons
    if (elements.confirmBorrowBtn) {
        elements.confirmBorrowBtn.addEventListener('click', borrowKey);
    }

    if (elements.cancelBorrowBtn) {
        elements.cancelBorrowBtn.addEventListener('click', () => {
            hideModal(elements.borrowModal);
            selectedKeyId = null;
        });
    }

    if (elements.confirmLogoutBtn) {
        elements.confirmLogoutBtn.addEventListener('click', logout);
    }

    if (elements.cancelLogoutBtn) {
        elements.cancelLogoutBtn.addEventListener('click', () => {
            hideModal(elements.logoutModal);
        });
    }

    if (elements.feedbackAnonymous) {
        elements.feedbackAnonymous.addEventListener('change', (e) => {
            const isAnonymous = Boolean(e.target.checked);
            if (elements.feedbackEmailGroup) {
                elements.feedbackEmailGroup.style.display = isAnonymous ? 'none' : '';
            }
            if (!isAnonymous && elements.feedbackEmail) {
                if (!elements.feedbackEmail.value.trim()) {
                    elements.feedbackEmail.value = userData?.email || '';
                }
                setTimeout(() => elements.feedbackEmail?.focus(), 0);
            }
        });
    }

    if (elements.submitFeedbackBtn) {
        elements.submitFeedbackBtn.addEventListener('click', submitFeedback);
    }

    if (elements.cancelFeedbackBtn) {
        elements.cancelFeedbackBtn.addEventListener('click', () => {
            hideModal(elements.feedbackModal);
        });
    }

    // Modal close buttons
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) hideModal(modal);
        });
    });

    // Click outside modal to close
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            hideModal(e.target);
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.show').forEach(modal => {
                hideModal(modal);
            });
        }
    });
}

async function submitFeedback() {
    const message = elements.feedbackMessage?.value?.trim() || '';
    const anonymous = Boolean(elements.feedbackAnonymous?.checked);
    const email = elements.feedbackEmail?.value?.trim() || '';

    if (!message) {
        showNotification('Please enter your feedback message.', 'error');
        return;
    }

    const btn = elements.submitFeedbackBtn;
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;

    try {
        showNotification('Sending feedback...', 'info');
        await apiRequest('/feedback', {
            method: 'POST',
            body: JSON.stringify({ message, anonymous, email }),
            silent: true
        });

        hideModal(elements.feedbackModal);
        if (elements.feedbackMessage) elements.feedbackMessage.value = '';
        showNotification('Thank you! Your feedback was sent.', 'success');
    } catch (error) {
        console.error('Feedback submit error:', error);
        showNotification(error.message || 'Failed to send feedback', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function refreshUserProfile() {
    try {
        const data = await apiRequest('/auth/profile', { silent: true });
        const u = data?.user;
        if (!u) return;

        userData = {
            ...(userData || {}),
            id: u._id || u.id || userData?.id,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
            role: u.role,
            emailVerified: u.emailVerified !== false,
            approvalStatus: u.approvalStatus || userData?.approvalStatus || 'approved',
            profilePhoto: u.profilePhoto || null
        };

        localStorage.setItem('userData', JSON.stringify(userData));
        updateUserHeaderUI();
    } catch (error) {
        // Non-blocking: dashboard can still load with cached userData.
        console.warn('Profile refresh failed:', error);
    }
}

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    if (!checkUserAuth()) return;

    setActiveUserNav('availableSection');

    setupEventListeners();
    initializeTeacherDashboard();
});
