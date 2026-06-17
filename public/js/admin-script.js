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

function getStoredAdminData() {
    try {
        return JSON.parse(localStorage.getItem('adminData') || '{}') || {};
    } catch {
        return {};
    }
}

function canCurrentAdminManageAdmins() {
    const adminData = getStoredAdminData();
    return adminData?.role === 'super_admin' || adminData?.permissions?.manageAdmins === true;
}

function canCurrentAdminManageUsers() {
    const adminData = getStoredAdminData();
    return adminData?.role === 'super_admin' || adminData?.permissions?.manageUsers === true;
}

function updateAdminDrawerSubtitle() {
    const subtitle = document.getElementById('navDrawerSubtitle');
    if (!subtitle) return;

    const adminData = getStoredAdminData();
    const label = String(adminData?.fullName || adminData?.username || '').trim();

    subtitle.textContent = label ? `Signed in as ${label}` : '';
    subtitle.style.display = label ? '' : 'none';
}

function deriveLockerFromKeyId(keyId) {
    const match = /^KEY(\d{3})$/i.exec(String(keyId || '').trim());
    if (!match) return '';
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) return '';
    return `Locker ${Math.ceil(num / 15)}`;
}

function parseKeyIdNumber(keyId) {
    const match = /^KEY(\d{3})$/i.exec(String(keyId || '').trim());
    if (!match) return null;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
}

function formatKeyIdNumber(num) {
    if (!Number.isFinite(num) || num <= 0) return '';
    return `KEY${String(Math.trunc(num)).padStart(3, '0')}`;
}

function suggestNextKeyId(existingKeys) {
    const keys = Array.isArray(existingKeys) ? existingKeys : [];
    const used = new Set();
    let max = 0;

    keys.forEach((key) => {
        const num = parseKeyIdNumber(key?.keyId);
        if (!num) return;
        used.add(num);
        if (num > max) max = num;
    });

    let candidate = max + 1;
    if (!candidate || candidate < 1) candidate = 1;
    while (used.has(candidate) && candidate <= 999) candidate += 1;
    if (candidate > 999) return '';
    return formatKeyIdNumber(candidate);
}

const KEY_STATUSES = new Set(['available', 'borrowed', 'maintenance', 'lost']);

function normalizeKeyStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    return KEY_STATUSES.has(raw) ? raw : 'available';
}

function formatKeyStatusLabel(status) {
    const normalized = normalizeKeyStatus(status);
    switch (normalized) {
        case 'borrowed':
            return 'Borrowed';
        case 'maintenance':
            return 'Maintenance';
        case 'lost':
            return 'Lost';
        case 'available':
        default:
            return 'Available';
    }
}

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
    if (!user) return '';
    const firstName = String(user.firstName || '').trim();
    const lastName = String(user.lastName || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    const email = String(user.email || '').trim();
    if (email) return email;
    return '';
}

function getBorrowerNameFromKey(key) {
    const borrowedBy = key?.borrowedBy;
    if (!borrowedBy || typeof borrowedBy !== 'object') return '';
    return buildUserDisplayName(borrowedBy);
}

const ADMIN_USERS_CACHE_TTL = 2 * 60 * 1000;
let adminUsersCache = {
    loadedAt: 0,
    byId: new Map()
};

async function getAdminUsersLookup({ force = false } = {}) {
    const now = Date.now();
    if (!force && adminUsersCache.byId.size && now - adminUsersCache.loadedAt < ADMIN_USERS_CACHE_TTL) {
        return adminUsersCache.byId;
    }

    try {
        const data = await apiRequest('/admin/users?includeInactive=true', { silent: true });
        const nextMap = new Map();
        if (Array.isArray(data?.users)) {
            data.users.forEach((user) => {
                const id = String(user?._id || '').trim();
                if (!id) return;
                const label = buildUserDisplayName(user);
                if (label) {
                    nextMap.set(id, label);
                }
            });
        }
        adminUsersCache = {
            loadedAt: now,
            byId: nextMap
        };
    } catch (error) {
        if (!adminUsersCache.byId.size) {
            adminUsersCache = {
                loadedAt: now,
                byId: new Map()
            };
        }
    }

    return adminUsersCache.byId;
}

function formatBorrowerLabel(key, usersById) {
    const directLabel = getBorrowerNameFromKey(key);
    if (directLabel) return directLabel;

    const id = getBorrowedById(key);
    if (!id) return 'Unknown user';

    const mapped = usersById?.get?.(id);
    if (mapped) return mapped;
    return `User ID ${id}`;
}

function buildKeyBoxElement(key, { usersById = new Map(), showActions = true, showDescription = true } = {}) {
    const normalizedStatus = normalizeKeyStatus(key?.status);
    const statusLabel = formatKeyStatusLabel(normalizedStatus);
    const statusClass = `status-${normalizedStatus}`;
    const roomLabel = String(key?.room || '').trim() || '—';
    const buildingLabel = String(key?.building || '').trim();
    const subtitleParts = [roomLabel];
    if (buildingLabel) subtitleParts.push(buildingLabel);
    const subtitle = subtitleParts.join(' • ');
    const description = showDescription ? String(key?.description || '').trim() : '';
    const borrowerLabel = normalizedStatus === 'borrowed'
        ? formatBorrowerLabel(key, usersById)
        : '';
    const borrowedAtLabel = normalizedStatus === 'borrowed'
        ? formatDateTime(key?.borrowedAt)
        : '';

    const metaRows = [];
    if (description) {
        metaRows.push(`
            <div class="key-meta-row">
                <span class="meta-label">Note</span>
                <span class="meta-value">${escapeHtml(description)}</span>
            </div>
        `);
    }
    if (normalizedStatus === 'borrowed') {
        metaRows.push(`
            <div class="key-meta-row">
                <span class="meta-label">Borrowed by</span>
                <span class="meta-value">${escapeHtml(borrowerLabel)}</span>
            </div>
        `);
        if (borrowedAtLabel && borrowedAtLabel !== '—') {
            metaRows.push(`
                <div class="key-meta-row">
                    <span class="meta-label">Borrowed at</span>
                    <span class="meta-value">${escapeHtml(borrowedAtLabel)}</span>
                </div>
            `);
        }
    }
    const metaHtml = metaRows.length ? `<div class="key-box-meta">${metaRows.join('')}</div>` : '';
    const actionsHtml = showActions ? `
        <div class="key-actions">
            <button class="btn btn-small btn-success generate-qr-btn"
                    data-key-id="${escapeHtml(key?.keyId || '')}"
                    data-room="${escapeHtml(roomLabel)}">
                Generate QR
            </button>
            <button class="btn btn-small btn-secondary edit-key-btn"
                    data-key-id="${escapeHtml(key?.keyId || '')}">
                Edit
            </button>
            <button class="btn btn-small btn-danger delete-key-btn"
                    data-key-id="${escapeHtml(key?.keyId || '')}">
                Delete
            </button>
        </div>
    ` : '';

    const element = document.createElement('div');
    element.className = 'key-box';
    element.dataset.status = normalizedStatus;
    element.innerHTML = `
        <div class="key-box-head">
            <div class="key-box-title">
                <h4 class="key-box-id">${escapeHtml(key?.keyId || '')}</h4>
                <p class="key-box-subtitle">${escapeHtml(subtitle)}</p>
            </div>
            <span class="key-status ${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
        ${metaHtml}
        ${actionsHtml}
    `;

    return element;
}

// DOM Elements
const elements = {
    // Sections
    adminOverviewSection: document.getElementById('adminOverviewSection'),
    chartsSection: document.getElementById('chartsSection'),
    databaseSection: document.getElementById('databaseSection'),
    maintenanceSection: document.getElementById('maintenanceSection'),
    manageKeysSection: document.getElementById('manageKeysSection'),
    manageQRCodesSection: document.getElementById('manageQRCodesSection'),
    settingsSection: document.getElementById('settingsSection'),
    manageAdminsSection: document.getElementById('manageAdminsSection'),
    announcementsSection: document.getElementById('announcementsSection'),
    activityLogsSection: document.getElementById('activityLogsSection'),
    lostReportsSection: document.getElementById('lostReportsSection'),
    feedbackSection: document.getElementById('feedbackSection'),
    
    // Navigation buttons
    adminOverviewBtn: document.getElementById('adminOverviewBtn'),
    manageKeysBtn: document.getElementById('manageKeysBtn'),
    manageQRCodesBtn: document.getElementById('manageQRCodesBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    databaseBtn: document.getElementById('databaseBtn'),
    maintenanceBtn: document.getElementById('maintenanceBtn'),
    manageAdminsBtn: document.getElementById('manageAdminsBtn'),
    announcementsBtn: document.getElementById('announcementsBtn'),
    lostReportsBtn: document.getElementById('lostReportsBtn'),
    feedbackBtn: document.getElementById('feedbackBtn'),
    activityLogsBtn: document.getElementById('activityLogsBtn'),
    adminLogoutBtn: document.getElementById('adminLogoutBtn'),
    
    // Modals
    addKeyModal: document.getElementById('addKeyModal'),
    addLockerModal: document.getElementById('addLockerModal'),
    editKeyModal: document.getElementById('editKeyModal'),
    deleteKeyModal: document.getElementById('deleteKeyModal'),
    generateQRModal: document.getElementById('generateQRModal'),
    qrCodeModal: document.getElementById('qrCodeModal'),
    addAdminModal: document.getElementById('addAdminModal'),
    resetAdminPasswordModal: document.getElementById('resetAdminPasswordModal'),
    logoutConfirmModal: document.getElementById('logoutConfirmModal'),
    
    // Containers
    keysManagementList: document.getElementById('keysManagementList'),
    qrcodesList: document.getElementById('qrcodesList'),
    adminsList: document.getElementById('adminsList'),
    activityLogsList: document.getElementById('activityLogsList'),
    logsFilterAll: document.getElementById('logsFilterAll'),
    logsFilterPhotos: document.getElementById('logsFilterPhotos'),
    lostReportsList: document.getElementById('lostReportsList'),
    feedbackList: document.getElementById('feedbackList'),
    notificationContainer: document.getElementById('notificationContainer'),
    activityTableBody: document.getElementById('activityTableBody'),
    adminKeysOverviewList: document.getElementById('adminKeysOverviewList'),
    keysFullscreenBtn: document.getElementById('keysFullscreenBtn'),
    exportAllQrPdfBtn: document.getElementById('exportAllQrPdfBtn'),
    recentActivityExportExcelBtn: document.getElementById('recentActivityExportExcelBtn'),
    recentActivityExportPdfBtn: document.getElementById('recentActivityExportPdfBtn'),
    recentActivityMeta: document.getElementById('recentActivityMeta'),
    recentActivityDateFrom: document.getElementById('recentActivityDateFrom'),
    recentActivityDateTo: document.getElementById('recentActivityDateTo'),

    // Lost reports (Admin)
    lostReportsSearch: document.getElementById('lostReportsSearch'),
    lostReportsStatus: document.getElementById('lostReportsStatus'),
    lostReportsRead: document.getElementById('lostReportsRead'),
    lostReportsSearchBtn: document.getElementById('lostReportsSearchBtn'),
    lostReportsRefreshBtn: document.getElementById('lostReportsRefreshBtn'),
    lostReportsUpdatedAt: document.getElementById('lostReportsUpdatedAt'),
    lostReportsCountInfo: document.getElementById('lostReportsCountInfo'),

    // Announcements
    announcementMessage: document.getElementById('announcementMessage'),
    announcementImageInput: document.getElementById('announcementImageInput'),
    announcementImagePreview: document.getElementById('announcementImagePreview'),
    announceBtn: document.getElementById('announceBtn'),
    popupImageInput: document.getElementById('popupImageInput'),
    popupImagePreview: document.getElementById('popupImagePreview'),
    publishPopupBtn: document.getElementById('publishPopupBtn'),
    refreshAnnouncementsBtn: document.getElementById('refreshAnnouncementsBtn'),
    adminAnnouncementsList: document.getElementById('adminAnnouncementsList'),
    
    // Charts
    analyticsChart: document.getElementById('analyticsChart'),
    
    // Stats
    totalKeysCount: document.getElementById('totalKeysCount'),
    totalBorrowersCount: document.getElementById('totalBorrowersCount'),
    notReturnedCount: document.getElementById('notReturnedCount'),
    totalTransactionsCount: document.getElementById('totalTransactionsCount'),

    // User management
    usersList: document.getElementById('usersList'),
    approvalsList: document.getElementById('approvalsList'),
    approvalsSearch: document.getElementById('approvalsSearch'),
    refreshApprovalsBtn: document.getElementById('refreshApprovalsBtn'),
    addUserModal: document.getElementById('addUserModal'),
    resetUserPasswordModal: document.getElementById('resetUserPasswordModal'),

    // Database hub
    dbLiveToggle: document.getElementById('dbLiveToggle'),
    dbSummaryRefreshBtn: document.getElementById('dbSummaryRefreshBtn'),
    dbSummaryUpdatedAt: document.getElementById('dbSummaryUpdatedAt'),
    dbUsersTotal: document.getElementById('dbUsersTotal'),
    dbUsersPending: document.getElementById('dbUsersPending'),
    dbAdminsTotal: document.getElementById('dbAdminsTotal'),
    dbAdminsActive: document.getElementById('dbAdminsActive'),
    dbKeysTotal: document.getElementById('dbKeysTotal'),
    dbKeysBorrowed: document.getElementById('dbKeysBorrowed'),
    dbLockersTotal: document.getElementById('dbLockersTotal'),
    dbQrTotal: document.getElementById('dbQrTotal'),
    dbQrActive: document.getElementById('dbQrActive'),
    dbQrUsed: document.getElementById('dbQrUsed'),
    dbTransactionsTotal: document.getElementById('dbTransactionsTotal'),
    dbTransactions7d: document.getElementById('dbTransactions7d'),
    dbAnnouncementsTotal: document.getElementById('dbAnnouncementsTotal'),
    dbAnnouncementsActive: document.getElementById('dbAnnouncementsActive'),
    dbFeedbackTotal: document.getElementById('dbFeedbackTotal'),
    dbFeedbackUnread: document.getElementById('dbFeedbackUnread'),
    dbLostReportsTotal: document.getElementById('dbLostReportsTotal'),
    dbLostReportsOpen: document.getElementById('dbLostReportsOpen'),
    dbLostReportsUnread: document.getElementById('dbLostReportsUnread'),
    dbLostReportsResolved: document.getElementById('dbLostReportsResolved'),
    dbKeysStatusChart: document.getElementById('dbKeysStatusChart'),
    dbUserApprovalChart: document.getElementById('dbUserApprovalChart'),
    dbQrStatusChart: document.getElementById('dbQrStatusChart'),
    dbTransactionsChart: document.getElementById('dbTransactionsChart'),
    dbCollectionSelect: document.getElementById('dbCollectionSelect'),
    dbSearchInput: document.getElementById('dbSearchInput'),
    dbDateFromInput: document.getElementById('dbDateFromInput'),
    dbDateToInput: document.getElementById('dbDateToInput'),
    dbStatusSelect: document.getElementById('dbStatusSelect'),
    dbRefreshBtn: document.getElementById('dbRefreshBtn'),
    dbExportBtn: document.getElementById('dbExportBtn'),
    dbExportModeSelect: document.getElementById('dbExportModeSelect'),
    dbExportPageInput: document.getElementById('dbExportPageInput'),
    dbExportPageMeta: document.getElementById('dbExportPageMeta'),
    dbExportRangeInput: document.getElementById('dbExportRangeInput'),
    dbExportScopeHint: document.getElementById('dbExportScopeHint'),
    dbPrevPageBtn: document.getElementById('dbPrevPageBtn'),
    dbNextPageBtn: document.getElementById('dbNextPageBtn'),
    dbPageInfo: document.getElementById('dbPageInfo'),
    dbTableHead: document.getElementById('dbTableHead'),
    dbTableBody: document.getElementById('dbTableBody'),
    dbHint: document.getElementById('dbHint'),
    dbExplorerUpdatedAt: document.getElementById('dbExplorerUpdatedAt'),
    dbJsonModal: document.getElementById('dbJsonModal'),
    dbJsonPre: document.getElementById('dbJsonPre'),
    dbCopyJsonBtn: document.getElementById('dbCopyJsonBtn'),

    // Lost report modal (Admin)
    lostReportModal: document.getElementById('lostReportModal'),
    lostReportModalTitle: document.getElementById('lostReportModalTitle'),
    lostReportModalDetails: document.getElementById('lostReportModalDetails'),
    lostReportReplyInput: document.getElementById('lostReportReplyInput'),
    lostReportStatusSelect: document.getElementById('lostReportStatusSelect'),
    lostReportResolutionNoteInput: document.getElementById('lostReportResolutionNoteInput'),
    lostReportDeleteBtn: document.getElementById('lostReportDeleteBtn'),
    lostReportMarkReadBtn: document.getElementById('lostReportMarkReadBtn'),
    lostReportSaveBtn: document.getElementById('lostReportSaveBtn'),
    lostReportModalNotice: document.getElementById('lostReportModalNotice'),

    // Maintenance
    maintenanceEnabledToggle: document.getElementById('maintenanceEnabledToggle'),
    maintenanceTitleInput: document.getElementById('maintenanceTitleInput'),
    maintenanceMessageInput: document.getElementById('maintenanceMessageInput'),
    maintenanceSaveBtn: document.getElementById('maintenanceSaveBtn'),
    maintenanceResetBtn: document.getElementById('maintenanceResetBtn'),
    maintenanceUpdatedAt: document.getElementById('maintenanceUpdatedAt'),
    maintenanceStatusBadge: document.getElementById('maintenanceStatusBadge'),
    maintenancePreviewTitle: document.getElementById('maintenancePreviewTitle'),
    maintenancePreviewMessage: document.getElementById('maintenancePreviewMessage'),
    maintenanceApiNotice: document.getElementById('maintenanceApiNotice'),

    // Settings / system configuration card
    systemConfigCard: document.getElementById('systemConfigCard'),
    systemConfigConnectionBadge: document.getElementById('systemConfigConnectionBadge'),
    systemConfigApiStatus: document.getElementById('systemConfigApiStatus'),
    systemConfigApiMeta: document.getElementById('systemConfigApiMeta'),
    systemConfigControllerStatus: document.getElementById('systemConfigControllerStatus'),
    systemConfigControllerMeta: document.getElementById('systemConfigControllerMeta'),
    systemConfigQrStatus: document.getElementById('systemConfigQrStatus'),
    systemConfigQrMeta: document.getElementById('systemConfigQrMeta'),
    systemConfigLockerStatus: document.getElementById('systemConfigLockerStatus'),
    systemConfigLockerMeta: document.getElementById('systemConfigLockerMeta'),
    systemConfigMaintenanceStatus: document.getElementById('systemConfigMaintenanceStatus'),
    systemConfigMaintenanceMeta: document.getElementById('systemConfigMaintenanceMeta'),
    systemConfigStatusNote: document.getElementById('systemConfigStatusNote'),
    systemConfigLastChecked: document.getElementById('systemConfigLastChecked'),
    openSystemConfigBtn: document.getElementById('openSystemConfigBtn'),
    refreshSystemConfigBtn: document.getElementById('refreshSystemConfigBtn'),
    accessQrCard: document.getElementById('accessQrCard'),
    accessQrList: document.getElementById('accessQrList'),
    accessQrStatusNote: document.getElementById('accessQrStatusNote'),
    refreshAccessQrBtn: document.getElementById('refreshAccessQrBtn'),
    exportAccessQrPdfBtn: document.getElementById('exportAccessQrPdfBtn')
};

// State
let currentKeyId = null;
let currentQRCodeData = null;
let charts = {};
let recentTransactionsCache = [];
let resetUserId = null;
let resetUserEmail = '';
let resetAdminId = null;
let resetAdminLabel = '';
let lastAddedLockerName = '';
let isAddingKey = false;
let isAddingLocker = false;
let isDeletingLocker = false;
let logsCategory = 'all';
let qrcodeStatus = 'all';
let announcementImageDataUrl = '';
let popupImageDataUrl = '';

// Lost reports (Admin)
const LOST_REPORTS_LIMIT = 200;
const LOST_REPORTS_REFRESH_MS = 8000;
let lostReportsLastLoadedAt = 0;
let lostReportsCache = [];
let activeLostReportId = null;

// Database hub state
let dbExplorerState = {
    collection: 'transactions',
    search: '',
    dateFrom: '',
    dateTo: '',
    status: 'all',
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
    viewRows: [],
    currentStartIndex: 0,
    currentEndIndex: 0,
    // For client-side collections (keys/lockers/users/admins), cache the full list for quick paging/filtering.
    localRows: null,
    localCollection: ''
};
let dbExplorerRequestSeq = 0;
let dbSummaryLastLoadedAt = 0;
let dbExplorerLastLoadedAt = 0;
let systemConfigLastLoadedAt = 0;
let accessQrPackLastLoadedAt = 0;
let accessQrPackData = null;

function setDatabaseMobileView(view, { scroll = true } = {}) {
    const section = elements.databaseSection;
    if (!section) return;

    const target = String(view || '').trim().toLowerCase() === 'explorer' ? 'explorer' : 'overview';
    section.classList.toggle('db-view-overview', target === 'overview');
    section.classList.toggle('db-view-explorer', target === 'explorer');

    section.querySelectorAll('.db-mobile-tabs [data-db-view]').forEach((btn) => {
        const btnView = String(btn.getAttribute('data-db-view') || '').trim().toLowerCase();
        const isActive = btnView === target;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (!scroll) return;
    try {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
        section.scrollIntoView();
    }
}

function normalizeLockerName(value) {
    return String(value || '').trim();
}

function normalizeHardwareLockNumber(value) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function updateLockerOptionsDatalist(lockers) {
    const datalist = document.getElementById('lockerOptionsList');
    if (!datalist) return;

    const entries = Array.isArray(lockers) ? lockers : [];
    datalist.innerHTML = '';

    const seen = new Set();
    entries.forEach((locker) => {
        const name = normalizeLockerName(locker?.name);
        if (!name) return;

        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        const option = document.createElement('option');
        option.value = name;

        const hardwareLockNumber = normalizeHardwareLockNumber(locker?.hardwareLockNumber);
        if (hardwareLockNumber) {
            option.label = `Hardware Lock ${hardwareLockNumber}`;
        }

        datalist.appendChild(option);
    });
}

// Confirm Dialog (replaces native window.confirm)
let confirmDialogUI = null;
let confirmDialogCleanup = null;

// Chart helpers
function showChartFallback(canvas, message) {
    if (!canvas) return;
    const container = canvas.parentElement || canvas.closest('.admin-card');
    if (!container) return;
    let fallback = container.querySelector('.chart-fallback');
    if (!fallback) {
        fallback = document.createElement('div');
        fallback.className = 'chart-fallback';
        container.appendChild(fallback);
    }
    fallback.textContent = message;
}

function clearChartFallback(canvas) {
    if (!canvas) return;
    const card = canvas.closest('.admin-card');
    if (!card) return;
    card.querySelectorAll('.chart-fallback').forEach((fallback) => {
        try {
            fallback.remove();
        } catch {
            if (fallback.parentNode) fallback.parentNode.removeChild(fallback);
        }
    });
}

function clearCanvas(canvas) {
    if (!canvas) return;
    try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    } catch {
        // ignore
    }
}

// Check Admin Authentication
function checkAdminAuth() {
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) {
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
    return true;
}

// API Request Helper
async function apiRequest(endpoint, options = {}) {
    if (!checkAdminAuth()) return null;

    const token = localStorage.getItem('adminToken');
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
                localStorage.removeItem('adminToken');
                localStorage.removeItem('adminData');
                localStorage.removeItem('kbs:lastActiveAt');
                localStorage.removeItem('kbs:idleLogoutAt');
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

// Initialize Admin Dashboard
async function initializeAdminDashboard() {
    if (!checkAdminAuth()) return;

    try {
        await Promise.all([
            displayAdminOverview(),
            displayRecentActivity(),
            displayAdminKeysOverview(),
            initializeCharts()
        ]);
    } catch (error) {
        console.error('Dashboard initialization error:', error);
        showNotification('Failed to initialize dashboard', 'error');
    }
}

// Display Admin Overview
async function displayAdminOverview() {
    try {
        const data = await apiRequest('/admin/stats');
        if (!data) return;

        // Update stats cards
        elements.totalKeysCount.textContent = data.stats.totalKeys || 0;
        elements.totalBorrowersCount.textContent = data.stats.totalUsers || 0;
        elements.notReturnedCount.textContent = data.stats.borrowedKeys || 0;
        if (elements.totalTransactionsCount) {
            elements.totalTransactionsCount.textContent = data.stats.totalTransactions || 0;
        }

    } catch (error) {
        console.error('Error fetching overview:', error);
    }
}

function setSystemConfigBadgeState(state, text) {
    const badge = elements.systemConfigConnectionBadge;
    if (!badge) return;

    badge.textContent = String(text || '').trim() || 'Unknown';
    badge.classList.remove('is-checking', 'is-connected', 'is-warning', 'is-error');

    switch (String(state || '').trim().toLowerCase()) {
        case 'connected':
            badge.classList.add('is-connected');
            break;
        case 'warning':
            badge.classList.add('is-warning');
            break;
        case 'error':
            badge.classList.add('is-error');
            break;
        default:
            badge.classList.add('is-checking');
            break;
    }
}

function setSystemConfigValue(el, text) {
    if (!el) return;
    el.textContent = String(text || '').trim() || '—';
}

function setSystemConfigDetail(el, text) {
    if (!el) return;
    el.textContent = String(text || '').trim() || '—';
}

function getSettledValue(result) {
    return result?.status === 'fulfilled' ? result.value : null;
}

function getSettledError(result) {
    return result?.status === 'rejected' ? result.reason : null;
}

function formatSystemConfigError(error, fallback = 'Unavailable') {
    const message = String(error?.message || '').trim();
    if (!message) return fallback;
    if (/failed to fetch/i.test(message)) return 'Network unreachable';
    return message;
}

function setAccessQrStatusNote(text) {
    if (!elements.accessQrStatusNote) return;
    elements.accessQrStatusNote.textContent = String(text || '').trim() || '—';
}

function renderAccessQrPack(items) {
    if (!elements.accessQrList) return;

    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
        elements.accessQrList.innerHTML = '<div class="access-qr-empty">No live URL is available yet. Open the system through Cloudflare or connect the ESP controller, then refresh this QR pack.</div>';
        return;
    }

    elements.accessQrList.innerHTML = rows.map((item) => `
        <article class="access-qr-item">
            <div class="access-qr-heading">
                <span class="access-qr-url-label">URL</span>
                ${item.sourceLabel ? `<span class="access-qr-source-label">${escapeHtml(item.sourceLabel)}</span>` : ''}
                <h4>${escapeHtml(item.title || 'QR Code')}</h4>
                <p class="text-muted">${escapeHtml(item.description || '')}</p>
            </div>
            <div class="access-qr-preview">
                <img src="${item.qrCodeImage}" alt="${escapeHtml(item.title || 'QR')}">
            </div>
            <div class="access-qr-url">${escapeHtml(item.url || '')}</div>
            <div class="access-qr-meta">
                <span>${escapeHtml(item.expiresLabel || 'No expiration')}</span>
                <span>Static access QR</span>
            </div>
            <div class="access-qr-buttons">
                <button type="button" class="btn btn-small btn-secondary" data-access-qr-copy="${escapeHtml(item.url || '')}">Copy URL</button>
                <button type="button" class="btn btn-small btn-secondary" data-access-qr-open="${escapeHtml(item.url || '')}">Open URL</button>
            </div>
        </article>
    `).join('');
}

async function loadAccessQrPack({ silent = true, force = false } = {}) {
    if (!elements.accessQrCard) return;

    const now = Date.now();
    if (!force && accessQrPackLastLoadedAt > 0 && (now - accessQrPackLastLoadedAt) < 15000) {
        return;
    }

    if (!silent && elements.accessQrList && !Array.isArray(accessQrPackData?.items)) {
        elements.accessQrList.innerHTML = '<div class="access-qr-empty">Preparing QR previews...</div>';
    }
    setAccessQrStatusNote('Loading access QR pack...');

    try {
        const data = await apiRequest('/admin/settings/access-qr-pack', { silent: true });
        accessQrPackData = data || null;
        accessQrPackLastLoadedAt = Date.now();

        const items = Array.isArray(data?.items) ? data.items : [];
        renderAccessQrPack(items);

        const generatedAtLabel = data?.generatedAt ? formatDateTime(data.generatedAt) : formatDateTime(new Date());
        const publicUrl = String(data?.tunnel?.publicUrl || '').trim();
        if (items.length === 0) {
            setAccessQrStatusNote('No live shareable URL is available yet. Once Cloudflare/public access or the ESP controller is reachable, the QR pack will appear here.');
        } else {
            setAccessQrStatusNote(
                publicUrl
                    ? `Ready to share. Cloudflare Public App URL and ESP Portal URL QR codes are prepared. Cloudflare URL: ${publicUrl}. Last prepared: ${generatedAtLabel}. These URL QR codes do not expire.`
                    : `Ready to share. Public App URL and ESP Portal URL QR codes are prepared. The ESP Portal URL follows the fast LAN target from the launcher. Last prepared: ${generatedAtLabel}. These URL QR codes do not expire.`
            );
        }
    } catch (error) {
        console.error('Access QR pack error:', error);
        renderAccessQrPack([]);
        setAccessQrStatusNote(error?.message || 'Failed to load the access QR pack.');
        if (!silent) {
            showNotification(error?.message || 'Failed to load access QR pack', 'error');
        }
    }
}

function buildAccessQrPdfHtml({ items, generatedAt }) {
    const generatedAtLabel = generatedAt ? formatDateTime(generatedAt) : formatDateTime(new Date());
    const cards = (Array.isArray(items) ? items : []).map((item) => `
        <section class="card">
            <div class="meta">
                <span class="pill">URL</span>
                <h2>${escapeHtml(item.title || 'QR Code')}</h2>
                <p>${escapeHtml(item.description || '')}</p>
                <p><strong>Validity:</strong> ${escapeHtml(item.expiresLabel || 'No expiration')}</p>
                <p><strong>URL:</strong> ${escapeHtml(item.url || '')}</p>
            </div>
            <div class="qr-wrap">
                <img src="${item.qrCodeImage}" alt="${escapeHtml(item.title || 'QR')}">
            </div>
        </section>
    `).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Access QR Pack</title>
            <style>
                @page { size: A4; margin: 14mm; }
                * { box-sizing: border-box; }
                body {
                    font-family: "Poppins", Arial, sans-serif;
                    color: #111827;
                    margin: 0;
                    background: #fff;
                }
                .sheet {
                    display: grid;
                    gap: 16px;
                }
                .header {
                    border: 2px solid #b30000;
                    border-radius: 16px;
                    padding: 18px 20px;
                    background: linear-gradient(135deg, #fff9f9, #fff);
                }
                .header h1 {
                    margin: 0 0 6px;
                    font-size: 24px;
                }
                .header p {
                    margin: 0;
                    line-height: 1.5;
                    font-size: 13px;
                }
                .grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 18px;
                }
                .card {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) 240px;
                    gap: 18px;
                    align-items: center;
                    border: 1px solid rgba(179,0,0,0.18);
                    border-radius: 18px;
                    padding: 18px;
                    background: #fff;
                    break-inside: avoid;
                    page-break-inside: avoid;
                }
                .meta h2 {
                    margin: 0 0 8px;
                    font-size: 20px;
                    color: #7f1d1d;
                }
                .pill {
                    display: inline-block;
                    margin-bottom: 10px;
                    padding: 4px 8px;
                    border-radius: 999px;
                    background: rgba(179, 0, 0, 0.08);
                    color: #8b0000;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                }
                .meta p {
                    margin: 0 0 8px;
                    font-size: 13px;
                    line-height: 1.5;
                    word-break: break-word;
                }
                .qr-wrap {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 14px;
                    border-radius: 16px;
                    background: #fff;
                    border: 1px solid #e5e7eb;
                }
                .qr-wrap img {
                    width: 100%;
                    max-width: 220px;
                    height: auto;
                    display: block;
                }
                .footer {
                    font-size: 11px;
                    color: #6b7280;
                }
                @media print {
                    .header { box-shadow: none; }
                }
                @media (max-width: 760px) {
                    .grid {
                        grid-template-columns: 1fr;
                    }
                    .card {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
        </head>
        <body>
            <main class="sheet">
                <section class="header">
                    <h1>BatStateU Access QR Pack</h1>
                    <p>Generated: ${escapeHtml(generatedAtLabel)}</p>
                    <p>This pack contains the Public App URL and the ESP Portal URL. The ESP Portal URL follows the fast LAN portal target shown in the launcher. These QR codes point to live URLs only and do not expire unless the underlying URL changes.</p>
                </section>
                <section class="grid">${cards}</section>
                <section class="footer">Tip: use "Save as PDF" in the print dialog to keep a ready-to-share copy.</section>
            </main>
            <script>
                window.onload = function () {
                    setTimeout(function () {
                        try { window.print(); } catch (err) { /* ignore */ }
                    }, 200);
                };
            </script>
        </body>
        </html>
    `;
}

function getJsPdfConstructor() {
    return window.jspdf?.jsPDF || window.jsPDF || null;
}

function exportAccessQrPackPdfFallback() {
    const items = Array.isArray(accessQrPackData?.items) ? accessQrPackData.items : [];
    if (!items.length) {
        showNotification('Load the access QR pack first before exporting PDF.', 'error');
        return;
    }

    const title = 'Access QR Pack';
    const win = openPdfLoadingWindow(title);
    const html = buildAccessQrPdfHtml({
        items,
        generatedAt: accessQrPackData?.generatedAt || new Date().toISOString()
    });
    openPrintWindow(html, title, { preopenedWindow: win });
    showNotification('PDF export window is ready. Save it as PDF from the print dialog.', 'success');
}

async function exportAccessQrPackPdf() {
    const items = Array.isArray(accessQrPackData?.items) ? accessQrPackData.items : [];
    if (!items.length) {
        showNotification('Load the access QR pack first before exporting PDF.', 'error');
        return;
    }

    const activeBtn = elements.exportAccessQrPdfBtn;
    const originalLabel = activeBtn?.textContent || 'Export PDF';
    if (activeBtn) {
        activeBtn.disabled = true;
        activeBtn.textContent = 'Exporting...';
    }

    try {
        const JsPdf = getJsPdfConstructor();
        if (!JsPdf) {
            exportAccessQrPackPdfFallback();
            return;
        }

        const doc = new JsPdf({
            orientation: 'portrait',
            unit: 'pt',
            format: 'a4',
            compress: true
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 36;
        const contentWidth = pageWidth - (margin * 2);
        const qrSize = 150;
        const cardGap = 18;
        const lineGap = 15;
        const generatedAtLabel = accessQrPackData?.generatedAt
            ? formatDateTime(accessQrPackData.generatedAt)
            : formatDateTime(new Date());

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.text('BatStateU Access QR Pack', margin, margin + 8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.text(`Generated: ${generatedAtLabel}`, margin, margin + 28);

        const introText = String(accessQrPackData?.tunnel?.publicUrl || '').trim()
            ? `This pack contains the Cloudflare Public App URL and the ESP Portal URL. The Cloudflare QR opens the active public tunnel, while the ESP QR keeps the fast LAN access target.`
            : `This pack contains the Public App URL and the ESP Portal URL. The ESP QR keeps the fast LAN access target shown by the launcher.`;
        const introLines = doc.splitTextToSize(introText, contentWidth);
        doc.text(introLines, margin, margin + 46);

        let cursorY = margin + 46 + (introLines.length * lineGap) + 18;

        items.forEach((item, index) => {
            const cardHeight = 250;
            if (cursorY + cardHeight > pageHeight - margin) {
                doc.addPage();
                cursorY = margin;
            }

            doc.setDrawColor(230, 57, 70);
            doc.setLineWidth(0.8);
            doc.roundedRect(margin, cursorY, contentWidth, cardHeight, 14, 14);

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(16);
            doc.text(String(item.title || 'QR Code'), margin + 16, cursorY + 24);

            if (item.sourceLabel) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.text(String(item.sourceLabel), margin + 16, cursorY + 40);
            }

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            const descriptionLines = doc.splitTextToSize(String(item.description || ''), contentWidth - qrSize - 58);
            doc.text(descriptionLines, margin + 16, cursorY + 58);

            const validityY = cursorY + 58 + (descriptionLines.length * 13) + 8;
            doc.setFont('helvetica', 'bold');
            doc.text('Validity:', margin + 16, validityY);
            doc.setFont('helvetica', 'normal');
            doc.text(String(item.expiresLabel || 'No expiration'), margin + 56, validityY);

            const urlLabelY = validityY + 18;
            doc.setFont('helvetica', 'bold');
            doc.text('URL:', margin + 16, urlLabelY);
            doc.setFont('helvetica', 'normal');
            const urlLines = doc.splitTextToSize(String(item.url || ''), contentWidth - qrSize - 78);
            doc.text(urlLines, margin + 44, urlLabelY);

            const imageX = pageWidth - margin - qrSize - 16;
            const imageY = cursorY + 26;
            doc.addImage(String(item.qrCodeImage || ''), 'PNG', imageX, imageY, qrSize, qrSize, undefined, 'FAST');

            cursorY += cardHeight + cardGap;

            if (index === items.length - 1) {
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(10);
                doc.text('This PDF was downloaded automatically for sharing and printing.', margin, Math.min(pageHeight - margin, cursorY - 2));
            }
        });

        const filename = `access-qr-pack-${new Date().toISOString().slice(0, 10)}.pdf`;
        doc.save(filename);
        showNotification('Access QR Pack PDF downloaded.', 'success');
    } catch (error) {
        console.error('Access QR PDF export error:', error);
        exportAccessQrPackPdfFallback();
    } finally {
        if (activeBtn) {
            activeBtn.disabled = false;
            activeBtn.textContent = originalLabel;
        }
    }
}

function chunkItems(items, size) {
    const rows = [];
    const list = Array.isArray(items) ? items : [];
    const chunkSize = Math.max(1, Number(size) || 1);
    for (let index = 0; index < list.length; index += chunkSize) {
        rows.push(list.slice(index, index + chunkSize));
    }
    return rows;
}

function buildAllQrCodesPdfHtml({ items, generatedAt }) {
    const generatedAtLabel = generatedAt ? formatDateTime(generatedAt) : formatDateTime(new Date());
    const rows = chunkItems(items, 5);
    const rowHtml = rows.map((row, rowIndex) => {
        const cards = row.map((item) => {
            const room = String(item?.room || '').trim() || 'No Room';
            const keyId = String(item?.keyId || '').trim() || '—';
            const extra = [String(item?.building || '').trim(), String(item?.locker || '').trim()].filter(Boolean).join(' • ');
            return `
                <article class="qr-pack-item">
                    <h3>${escapeHtml(room)}</h3>
                    <div class="qr-pack-image-wrap">
                        <img src="${item.qrCodeImage}" alt="${escapeHtml(`QR for ${room}`)}">
                    </div>
                    <p class="qr-pack-key">${escapeHtml(keyId)}</p>
                    ${extra ? `<p class="qr-pack-extra">${escapeHtml(extra)}</p>` : '<p class="qr-pack-extra">&nbsp;</p>'}
                </article>
            `;
        }).join('');

        return `
            <section class="qr-pack-row ${rowIndex % 2 === 0 ? 'is-accent' : 'is-plain'}">
                <div class="qr-pack-grid">${cards}</div>
            </section>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>All Key QR Codes</title>
            <style>
                @page { size: A4 portrait; margin: 9mm; }
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    font-family: "Poppins", Arial, sans-serif;
                    color: #111827;
                    background: #ffffff;
                }
                .sheet {
                    display: grid;
                    gap: 10px;
                }
                .header {
                    border: 2px solid #b30000;
                    border-radius: 18px;
                    padding: 14px 18px;
                    background: linear-gradient(135deg, #fff8f8, #ffffff);
                }
                .header h1 {
                    margin: 0 0 4px;
                    font-size: 24px;
                    color: #7f1d1d;
                }
                .header p {
                    margin: 2px 0;
                    font-size: 12px;
                    line-height: 1.4;
                }
                .qr-pack-row {
                    border-radius: 24px;
                    padding: 10px 12px;
                    break-inside: avoid;
                    page-break-inside: avoid;
                }
                .qr-pack-row.is-accent {
                    background: linear-gradient(135deg, #ff3a32, #ff4f44);
                }
                .qr-pack-row.is-plain {
                    background: #ffffff;
                    border: 1px solid rgba(15, 23, 42, 0.08);
                }
                .qr-pack-grid {
                    display: grid;
                    grid-template-columns: repeat(5, minmax(0, 1fr));
                    gap: 8px;
                }
                .qr-pack-item {
                    min-height: 148px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                    justify-content: flex-start;
                    gap: 4px;
                    padding: 0 2px;
                }
                .qr-pack-item h3 {
                    margin: 0;
                    min-height: 32px;
                    display: flex;
                    align-items: flex-end;
                    justify-content: center;
                    text-align: center;
                    font-size: 10.5px;
                    line-height: 1.15;
                    font-weight: 800;
                    color: #111111;
                    text-transform: uppercase;
                }
                .qr-pack-image-wrap {
                    width: 94px;
                    height: 94px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 4px;
                    border-radius: 12px;
                    background: #ffffff;
                    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
                }
                .qr-pack-image-wrap img {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    display: block;
                }
                .qr-pack-key {
                    margin: 0;
                    font-size: 10px;
                    font-weight: 700;
                    color: #111827;
                }
                .qr-pack-extra {
                    margin: 0;
                    min-height: 18px;
                    font-size: 8.5px;
                    line-height: 1.2;
                    color: #374151;
                }
                .footer {
                    font-size: 11px;
                    color: #6b7280;
                    text-align: center;
                    margin-top: 2px;
                }
            </style>
        </head>
        <body>
            <main class="sheet">
                <section class="header">
                    <h1>BatStateU Key QR Code Pack</h1>
                    <p>Generated: ${escapeHtml(generatedAtLabel)}</p>
                    <p>Total QR Codes: ${escapeHtml(String(Array.isArray(items) ? items.length : 0))}</p>
                    <p>All QR codes in this pack are set to no expiration.</p>
                </section>
                ${rowHtml}
                <section class="footer">Use "Save as PDF" in the print dialog to keep a ready-to-print copy.</section>
            </main>
            <script>
                window.onload = function () {
                    setTimeout(function () {
                        try { window.print(); } catch (err) { /* ignore */ }
                    }, 200);
                };
            </script>
        </body>
        </html>
    `;
}

function exportAllManageKeysQrCodesFallback({ items, generatedAt }) {
    const win = openPdfLoadingWindow('All Key QR Codes');
    const html = buildAllQrCodesPdfHtml({
        items,
        generatedAt
    });
    openPrintWindow(html, 'All Key QR Codes', { preopenedWindow: win });
    showNotification(`PDF export window is ready for ${items.length} QR code(s).`, 'success');
}

function buildQrPackPdfPages(doc, items, { generatedAt }) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 26;
    const contentWidth = pageWidth - (margin * 2);
    const cols = 4;
    const colGap = 10;
    const rowGap = 12;
    const cardWidth = (contentWidth - (colGap * (cols - 1))) / cols;
    const qrSize = Math.min(90, Math.max(72, cardWidth - 26));
    const cardHeight = 148;
    const rowsPerPage = 4;
    const itemsPerPage = cols * rowsPerPage;
    const pages = chunkItems(items, itemsPerPage);
    const generatedAtLabel = generatedAt ? formatDateTime(generatedAt) : formatDateTime(new Date());

    pages.forEach((pageItems, pageIndex) => {
        if (pageIndex > 0) {
            doc.addPage();
        }

        doc.setDrawColor(179, 0, 0);
        doc.setLineWidth(1);
        doc.roundedRect(margin, margin, contentWidth, 76, 14, 14);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(21);
        doc.setTextColor(127, 29, 29);
        doc.text('BatStateU Key QR Code Pack', margin + 16, margin + 24);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(17, 24, 39);
        doc.text(`Generated: ${generatedAtLabel}`, margin + 16, margin + 42);
        doc.text(`Total QR Codes: ${items.length}`, margin + 16, margin + 56);
        doc.text(`Page ${pageIndex + 1} of ${pages.length}`, pageWidth - margin - 70, margin + 56);

        let startY = margin + 94;
        pageItems.forEach((item, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const x = margin + (col * (cardWidth + colGap));
            const y = startY + (row * (cardHeight + rowGap));
            const room = String(item?.room || '').trim() || 'No Room';
            const keyId = String(item?.keyId || '').trim() || '—';
            const extra = [String(item?.building || '').trim(), String(item?.locker || '').trim()]
                .filter(Boolean)
                .join(' • ');

            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.7);
            doc.roundedRect(x, y, cardWidth, cardHeight, 12, 12);

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(17, 24, 39);
            const roomLines = doc.splitTextToSize(room.toUpperCase(), cardWidth - 14).slice(0, 2);
            doc.text(roomLines, x + (cardWidth / 2), y + 14, { align: 'center', baseline: 'top' });

            const imageX = x + ((cardWidth - qrSize) / 2);
            const imageY = y + 30;
            doc.addImage(String(item?.qrCodeImage || ''), 'PNG', imageX, imageY, qrSize, qrSize, undefined, 'FAST');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text(keyId, x + (cardWidth / 2), y + 128, { align: 'center' });

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(55, 65, 81);
            const extraLines = doc.splitTextToSize(extra || ' ', cardWidth - 10).slice(0, 2);
            doc.text(extraLines, x + (cardWidth / 2), y + 139, { align: 'center' });
        });

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(107, 114, 128);
        doc.text('This PDF was downloaded automatically for printing and sharing.', margin, pageHeight - margin);
    });
}

async function exportAllManageKeysQrCodes() {
    const activeBtn = elements.exportAllQrPdfBtn;
    const originalLabel = activeBtn?.textContent || 'Export All QR Codes PDF';

    if (activeBtn) {
        activeBtn.disabled = true;
        activeBtn.textContent = 'Exporting...';
    }

    try {
        showNotification('Preparing all key QR codes...', 'info');
        const data = await apiRequest('/admin/qrcodes/export-pack', { silent: true });
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) {
            showNotification('No QR codes were available to export.', 'error');
            return;
        }

        const JsPdf = getJsPdfConstructor();
        if (!JsPdf) {
            exportAllManageKeysQrCodesFallback({
                items,
                generatedAt: data?.generatedAt || new Date().toISOString()
            });
            return;
        }

        const doc = new JsPdf({
            orientation: 'portrait',
            unit: 'pt',
            format: 'a4',
            compress: true
        });

        buildQrPackPdfPages(doc, items, {
            generatedAt: data?.generatedAt || new Date().toISOString()
        });

        const filename = `all-key-qr-codes-${new Date().toISOString().slice(0, 10)}.pdf`;
        doc.save(filename);
        showNotification(`PDF downloaded for ${items.length} QR code(s).`, 'success');
    } catch (error) {
        console.error('Export all QR codes error:', error);
        try {
            const data = await apiRequest('/admin/qrcodes/export-pack', { silent: true });
            const items = Array.isArray(data?.items) ? data.items : [];
            if (items.length) {
                exportAllManageKeysQrCodesFallback({
                    items,
                    generatedAt: data?.generatedAt || new Date().toISOString()
                });
                return;
            }
        } catch {
            // ignore fallback fetch errors
        }
        showNotification(error?.message || 'Failed to export all QR codes', 'error');
    } finally {
        if (activeBtn) {
            activeBtn.disabled = false;
            activeBtn.textContent = originalLabel;
        }
    }
}

async function loadSystemConfigurationStatus({ silent = true, force = false } = {}) {
    if (!elements.systemConfigCard) return;

    const now = Date.now();
    if (!force && systemConfigLastLoadedAt > 0 && (now - systemConfigLastLoadedAt) < 3500) {
        return;
    }

    setSystemConfigBadgeState('checking', 'Checking...');
    setSystemConfigValue(elements.systemConfigApiStatus, 'Checking...');
    setSystemConfigDetail(elements.systemConfigApiMeta, 'Waiting for admin API response...');
    setSystemConfigValue(elements.systemConfigControllerStatus, 'Checking...');
    setSystemConfigDetail(elements.systemConfigControllerMeta, 'Waiting for controller ping...');
    setSystemConfigValue(elements.systemConfigQrStatus, 'Checking...');
    setSystemConfigDetail(elements.systemConfigQrMeta, 'Waiting for QR coverage data...');
    setSystemConfigValue(elements.systemConfigLockerStatus, 'Checking...');
    setSystemConfigDetail(elements.systemConfigLockerMeta, 'Waiting for locker mapping data...');
    setSystemConfigValue(elements.systemConfigMaintenanceStatus, 'Checking...');
    setSystemConfigDetail(elements.systemConfigMaintenanceMeta, 'Waiting for maintenance status...');
    setSystemConfigValue(elements.systemConfigStatusNote, 'Checking live connection status...');

    try {
        const qs = new URLSearchParams();
        qs.set('tzOffset', getClientTzOffsetString());

        const [summaryResult, maintenanceResult, controllerResult, lockersResult] = await Promise.allSettled([
            apiRequest(`/admin/database/summary?${qs.toString()}`, { silent: true }),
            apiRequest('/admin/maintenance', { silent: true }),
            apiRequest('/admin/locker-controller/status', { silent: true }),
            apiRequest('/lockers', { silent: true })
        ]);

        const summaryData = getSettledValue(summaryResult);
        const maintenanceData = getSettledValue(maintenanceResult);
        const controllerData = getSettledValue(controllerResult);
        const lockersData = getSettledValue(lockersResult);
        const summaryError = getSettledError(summaryResult);
        const maintenanceError = getSettledError(maintenanceResult);
        const controllerError = getSettledError(controllerResult);
        const lockersError = getSettledError(lockersResult);
        const fulfilledCount = [summaryResult, maintenanceResult, controllerResult, lockersResult]
            .filter((result) => result?.status === 'fulfilled').length;
        const apiConnected = fulfilledCount > 0;
        const hasPartialFailures = fulfilledCount > 0 && fulfilledCount < 4;

        const counts = summaryData?.counts || {};
        const keys = counts.keys || {};
        const lockers = counts.lockers || {};
        const qrcodes = counts.qrcodes || {};
        const maintenance = maintenanceData?.maintenance || {};
        const controller = controllerData?.controller || {};
        const lockerRecords = Array.isArray(lockersData?.lockers) ? lockersData.lockers : [];

        const keyTotal = Number(keys.total || 0) || 0;
        const borrowedTotal = Number(keys.borrowed || 0) || 0;
        const lockerTotal = Number(lockers.total || 0) || 0;
        const qrTotal = Number(qrcodes.total || 0) || 0;
        const qrActive = Number(qrcodes.active || 0) || 0;
        const qrCoveredKeys = Math.min(keyTotal, qrTotal);
        const missingQrCount = Math.max(0, keyTotal - qrTotal);
        const maintenanceEnabled = Boolean(maintenance.enabled);
        const controllerConnected = controller.connected === true;
        const controllerMessage = String(controller.message || '').trim();
        const controllerDiagnosis = String(controller.diagnosis || '').trim();
        const controllerBaseUrl = String(controller.baseUrl || '').trim();
        const controllerReason = String(controller.reason || '').trim().toLowerCase();
        const controllerSsidHint = String(controller.ssidHint || '').trim();
        const controllerIpHint = String(controller.ipHint || '').trim();
        const controllerSerial = controller?.serial || {};
        const controllerSerialConnected = controllerSerial.connected === true;
        const controllerSerialPort = String(controllerSerial.port || '').trim();
        const controllerConfiguredMaxLocks = Number(controller.configuredMaxLocks || 0) || 0;
        const controllerLiveMaxLocks = Number(controller.maxLocks || 0) || 0;
        const controllerCapacity = controllerConnected
            ? (controllerLiveMaxLocks || controllerConfiguredMaxLocks || 0)
            : (controllerConfiguredMaxLocks || controllerLiveMaxLocks || 0);
        const mappedHardwareLockNumbers = lockerRecords
            .map((locker) => normalizeHardwareLockNumber(locker?.hardwareLockNumber))
            .filter(Boolean);
        const mappedLockerCount = mappedHardwareLockNumbers.length;
        const highestMappedHardwareLock = mappedHardwareLockNumbers.length
            ? Math.max(...mappedHardwareLockNumbers)
            : 0;
        const lockerOverflow = controllerCapacity > 0 && highestMappedHardwareLock > controllerCapacity;
        const apiStatusLabel = !apiConnected
            ? 'Unavailable'
            : hasPartialFailures
                ? 'Partial'
                : 'Connected';

        let badgeState = 'connected';
        let badgeText = 'Connected';
        let note = '';

        setSystemConfigValue(elements.systemConfigApiStatus, apiStatusLabel);
        setSystemConfigDetail(
            elements.systemConfigApiMeta,
            apiConnected
                ? `${API_BASE_URL} • ${fulfilledCount}/4 live checks responded`
                : `${API_BASE_URL} • ${formatSystemConfigError(summaryError || maintenanceError || controllerError || lockersError, 'Admin API is unreachable')}`
        );

        if (controllerData) {
            setSystemConfigValue(
                elements.systemConfigControllerStatus,
                controllerReason === 'serial_fallback'
                    ? `USB Fallback Ready${controllerCapacity ? ` (${controllerCapacity} locks)` : ''}`
                    : controllerConnected
                    ? `Connected${controllerCapacity ? ` (${controllerCapacity} locks)` : ''}`
                    : (controller.enabled === false ? 'Disabled' : 'Unreachable from Server')
            );
            setSystemConfigDetail(
                elements.systemConfigControllerMeta,
                controllerReason === 'serial_fallback'
                    ? `${controllerBaseUrl || controllerIpHint || 'Controller URL unavailable'} • USB serial ready on ${controllerSerialPort || 'configured port'}`
                    : controllerConnected
                        ? `${controllerBaseUrl || 'Controller URL unavailable'} • SSID ${controllerSsidHint || 'LockerSystem'} • Live /status response received`
                        : `${controllerBaseUrl || controllerIpHint || 'Controller URL unavailable'} • ${controllerDiagnosis || controllerMessage || 'No live response from controller'}`
            );
        } else {
            setSystemConfigValue(elements.systemConfigControllerStatus, apiConnected ? 'Check failed' : 'Unavailable');
            setSystemConfigDetail(
                elements.systemConfigControllerMeta,
                formatSystemConfigError(controllerError, 'Locker controller check failed')
            );
        }

        if (summaryData) {
            setSystemConfigValue(
                elements.systemConfigQrStatus,
                keyTotal === 0 ? 'Ready for first key' : `${qrCoveredKeys}/${keyTotal} connected`
            );
            setSystemConfigDetail(
                elements.systemConfigQrMeta,
                keyTotal === 0
                    ? 'Create your first key and its QR will be generated automatically.'
                    : `Active QR: ${qrActive} • Missing QR: ${missingQrCount} • Borrowed keys: ${borrowedTotal}`
            );
            setSystemConfigValue(
                elements.systemConfigLockerStatus,
                lockerTotal === 0
                    ? 'No lockers yet'
                    : `${mappedLockerCount || 0}/${lockerTotal} mapped`
            );
            setSystemConfigDetail(
                elements.systemConfigLockerMeta,
                lockerTotal === 0
                    ? 'Create a locker to assign a live hardware slot.'
                    : `Hardware mapped: ${mappedLockerCount}/${lockerTotal}${highestMappedHardwareLock ? ` • Highest slot: ${highestMappedHardwareLock}` : ''}${controllerCapacity ? ` • Configured capacity: ${controllerCapacity}` : ''}`
            );
        } else {
            setSystemConfigValue(elements.systemConfigQrStatus, apiConnected ? 'Waiting for data' : 'Unavailable');
            setSystemConfigDetail(
                elements.systemConfigQrMeta,
                formatSystemConfigError(summaryError, 'QR coverage data is unavailable')
            );
            setSystemConfigValue(elements.systemConfigLockerStatus, apiConnected ? 'Waiting for data' : 'Unavailable');
            setSystemConfigDetail(
                elements.systemConfigLockerMeta,
                lockersData
                    ? `Loaded ${lockerRecords.length} locker record(s), but summary data is missing.`
                    : formatSystemConfigError(lockersError || summaryError, 'Locker mapping data is unavailable')
            );
        }

        if (maintenanceData) {
            setSystemConfigValue(elements.systemConfigMaintenanceStatus, maintenanceEnabled ? 'Enabled' : 'Disabled');
            setSystemConfigDetail(
                elements.systemConfigMaintenanceMeta,
                maintenanceEnabled
                    ? `Live route reachable • Banner title: ${String(maintenance.title || 'Maintenance Notice').trim()}`
                    : 'Live route reachable • Normal user access is active'
            );
        } else {
            setSystemConfigValue(elements.systemConfigMaintenanceStatus, apiConnected ? 'Check failed' : 'Unavailable');
            setSystemConfigDetail(
                elements.systemConfigMaintenanceMeta,
                formatSystemConfigError(maintenanceError, 'Maintenance status check failed')
            );
        }

        if (!apiConnected) {
            badgeState = 'error';
            badgeText = 'Disconnected';
            note = 'Admin API is not responding right now, so live status checks could not complete. Make sure the Node server is running, then refresh this card.';
        } else if (!controllerConnected) {
            badgeState = controller.required === false ? 'warning' : 'error';
            badgeText = controller.required === false ? 'Hardware Optional' : 'ESP Not Reached';
            if (controllerReason === 'timeout' || controllerReason === 'unreachable') {
                note = controllerDiagnosis || `The QR flow is ready, but the Node server is not on the same network as the ESP. Power on the ESP, verify SSID ${controllerSsidHint || 'LockerSystem'}, or connect this laptop/server to the ESP network.`;
            } else {
                note = controllerDiagnosis || controllerMessage || 'Locker controller is not reachable. Connect the server device to the ESP32 controller before scanning QR codes.';
            }
        } else if (controllerReason === 'serial_fallback' || controllerSerialConnected) {
            badgeState = 'warning';
            badgeText = 'USB Fallback Ready';
            note = `Wi-Fi path to ${controllerIpHint || '192.168.4.1'} is still unreachable from the Node server, but the ESP is usable through USB serial on ${controllerSerialPort || 'the configured COM port'}. QR scans should still complete from this server machine.`;
        } else if (lockerOverflow) {
            badgeState = 'warning';
            badgeText = 'Locker Limit';
            note = `Controller capacity is ${controllerCapacity}, but your locker mapping already reaches slot ${highestMappedHardwareLock}. Increase the firmware/controller capacity before using those higher lockers.`;
        } else if (hasPartialFailures) {
            badgeState = 'warning';
            badgeText = 'Partial Live';
            note = 'Some live checks responded, but not all of them completed. The card now shows each service separately so you can see exactly which part needs attention.';
        } else if (keyTotal === 0) {
            note = 'System is connected and ready. Add a locker and key, and QR setup will be created automatically.';
        } else if (missingQrCount > 0) {
            badgeState = 'warning';
            badgeText = 'Needs Attention';
            note = `${missingQrCount} key(s) are still missing QR coverage. Generate or refresh their QR code to complete the connection.`;
        } else {
            note = `QR borrow/return flow is live for all ${keyTotal} key(s). Controller is online${controllerCapacity ? ` for ${controllerCapacity} lock(s)` : ''}. Active QR right now: ${qrActive}. Borrowed keys: ${borrowedTotal}.`;
        }

        setSystemConfigBadgeState(badgeState, badgeText);
        setSystemConfigValue(elements.systemConfigStatusNote, note);
        setSystemConfigValue(
            elements.systemConfigLastChecked,
            `Last checked: ${formatDateTime(new Date())}`
        );

        systemConfigLastLoadedAt = Date.now();
    } catch (error) {
        console.error('System configuration status error:', error);

        setSystemConfigBadgeState('error', 'Disconnected');
        setSystemConfigValue(elements.systemConfigApiStatus, 'Unavailable');
        setSystemConfigDetail(elements.systemConfigApiMeta, formatSystemConfigError(error, 'Admin API is unreachable'));
        setSystemConfigValue(elements.systemConfigControllerStatus, 'Unavailable');
        setSystemConfigDetail(elements.systemConfigControllerMeta, 'Controller status could not be loaded.');
        setSystemConfigValue(elements.systemConfigQrStatus, 'Unavailable');
        setSystemConfigDetail(elements.systemConfigQrMeta, 'QR coverage could not be loaded.');
        setSystemConfigValue(elements.systemConfigLockerStatus, 'Unavailable');
        setSystemConfigDetail(elements.systemConfigLockerMeta, 'Locker mapping could not be loaded.');
        setSystemConfigValue(elements.systemConfigMaintenanceStatus, 'Unavailable');
        setSystemConfigDetail(elements.systemConfigMaintenanceMeta, 'Maintenance status could not be loaded.');
        setSystemConfigValue(
            elements.systemConfigStatusNote,
            'System configuration is not fully connected right now. Restart the server if needed, then refresh this status.'
        );
        setSystemConfigValue(
            elements.systemConfigLastChecked,
            `Last checked: ${formatDateTime(new Date())}`
        );

        if (!silent) {
            showNotification(error?.message || 'Failed to load system configuration status', 'error');
        }
    }
}

// Display Recent Activity
async function displayRecentActivity() {
    try {
        const activityTableBody = elements.activityTableBody;
        if (!activityTableBody) return;

        const { search, from, to } = getRecentActivityFilters();
        const data = await fetchAdminTransactionSessions({ search, from, to, page: 1, limit: 200 });
        if (!data || !Array.isArray(data.sessions)) {
            activityTableBody.innerHTML = '<tr><td colspan="8" class="text-center">Unable to load activity logs.</td></tr>';
            if (elements.recentActivityMeta) {
                elements.recentActivityMeta.textContent = 'Unable to load activity logs.';
            }
            return;
        }

        recentTransactionsCache = data.sessions.map(normalizeTransactionSessionRow);
        activityTableBody.innerHTML = '';

        if (recentTransactionsCache.length === 0) {
            const row = document.createElement('tr');
            const emptyMessage = data.total && Number(data.total) > 0
                ? 'No results for the current search.'
                : 'No recent activity yet.';
            row.innerHTML = `<td colspan="8" class="text-center">${escapeHtml(emptyMessage)}</td>`;
            activityTableBody.appendChild(row);
            if (elements.recentActivityMeta) {
                elements.recentActivityMeta.textContent = emptyMessage;
            }
            return;
        }

        recentTransactionsCache.forEach(transaction => {
            const rowData = normalizeRecentActivityDisplayRow(transaction);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHtml(rowData.borrower)}</td>
                <td>${escapeHtml(rowData.keyId)}</td>
                <td>${escapeHtml(rowData.locker)}</td>
                <td>
                    <span class="status-badge ${rowData.actionClass}">
                        ${escapeHtml(rowData.actionLabel)}
                    </span>
                </td>
                <td>${escapeHtml(rowData.dateBorrowed)}</td>
                <td>${escapeHtml(rowData.timeBorrowed)}</td>
                <td>${escapeHtml(rowData.dateReturned)}</td>
                <td>${escapeHtml(rowData.timeReturned)}</td>
            `;
            activityTableBody.appendChild(row);
        });

        if (elements.recentActivityMeta) {
            const total = Number(data.total || recentTransactionsCache.length);
            const shown = recentTransactionsCache.length;
            const baseText = total > shown
                ? `Showing latest ${shown} of ${total} activity logs.`
                : `Showing ${shown} activity logs.`;
            const dateMeta = buildDateFilterMeta(from, to);
            elements.recentActivityMeta.textContent = dateMeta ? `${baseText} ${dateMeta}` : baseText;
        }
    } catch (error) {
        console.error('Error fetching recent activity:', error);
        let fallbackShown = false;
        try {
            const fallback = await apiRequest('/admin/stats', { silent: true });
            const fallbackTransactions = Array.isArray(fallback?.recentTransactions) ? fallback.recentTransactions : [];
            if (fallbackTransactions.length && elements.activityTableBody) {
                elements.activityTableBody.innerHTML = '';
                fallbackTransactions.forEach((transaction) => {
                    const rowData = normalizeTransactionRow(transaction);
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${escapeHtml(rowData.borrower)}</td>
                        <td>${escapeHtml(rowData.keyId)}</td>
                        <td>${escapeHtml(rowData.locker)}</td>
                        <td>
                            <span class="status-badge ${rowData.actionClass}">
                                ${escapeHtml(rowData.actionLabel)}
                            </span>
                        </td>
                        <td>${escapeHtml(rowData.dateBorrowed)}</td>
                        <td>${escapeHtml(rowData.timeBorrowed)}</td>
                        <td>${escapeHtml(rowData.dateReturned)}</td>
                        <td>${escapeHtml(rowData.timeReturned)}</td>
                    `;
                    elements.activityTableBody.appendChild(row);
                });
                if (elements.recentActivityMeta) {
                    const { from, to } = getRecentActivityFilters();
                    const dateMeta = buildDateFilterMeta(from, to);
                    elements.recentActivityMeta.textContent = dateMeta
                        ? `Showing latest 10 activity logs (fallback). ${dateMeta}`
                        : 'Showing latest 10 activity logs (fallback).';
                }
                fallbackShown = true;
            }
        } catch {
            // ignore fallback errors
        }

        if (!fallbackShown) {
            if (elements.activityTableBody) {
                elements.activityTableBody.innerHTML = '<tr><td colspan="8" class="text-center">Unable to load activity logs.</td></tr>';
            }
            if (elements.recentActivityMeta) {
                elements.recentActivityMeta.textContent = 'Unable to load activity logs.';
            }
            showNotification(error?.message || 'Failed to load recent activity', 'error');
        }
    }
}

// Display Keys Overview (Admin Dashboard)
async function displayAdminKeysOverview() {
    const list = elements.adminKeysOverviewList;
    if (!list) return;

    list.innerHTML = `
        <div class="admin-card keys-overview-empty">
            <p class="text-center">Loading keys...</p>
        </div>
    `;

    try {
        const [keysData, lockersData] = await Promise.all([
            apiRequest('/admin/keys', { silent: true }),
            apiRequest('/lockers', { silent: true })
        ]);
        const keys = Array.isArray(keysData?.keys) ? keysData.keys : [];
        const lockers = Array.isArray(lockersData?.lockers) ? lockersData.lockers : [];

        if (!keys.length) {
            list.innerHTML = `
                <div class="admin-card keys-overview-empty">
                    <p class="text-center">No keys found.</p>
                </div>
            `;
            return;
        }

        const borrowedIds = keys.map(getBorrowedById).filter(Boolean);
        const usersById = borrowedIds.length ? await getAdminUsersLookup() : new Map();

        const lockerNameByLower = new Map(
            lockers
                .map((locker) => normalizeLockerName(locker?.name))
                .filter(Boolean)
                .map((name) => [name.toLowerCase(), name])
        );

        const normalizeLockerLabel = (lockerValue, keyId) => {
            if (lockerValue === '') return 'Unassigned';
            if (lockerValue === undefined || lockerValue === null) {
                const derived = deriveLockerFromKeyId(keyId);
                if (!derived) return 'Unassigned';
                return lockerNameByLower.get(derived.toLowerCase()) || derived;
            }

            const trimmed = normalizeLockerName(lockerValue);
            if (!trimmed) return 'Unassigned';
            return lockerNameByLower.get(trimmed.toLowerCase()) || trimmed;
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
        lockers.forEach((locker) => {
            const name = normalizeLockerName(locker?.name);
            if (!name) return;
            if (!groups.has(name)) groups.set(name, []);
        });

        keys.forEach((key) => {
            const lockerLabel = normalizeLockerLabel(key?.locker, key?.keyId);
            if (!groups.has(lockerLabel)) groups.set(lockerLabel, []);
            groups.get(lockerLabel).push(key);
        });

        list.innerHTML = '';
        const lockerLabels = Array.from(groups.keys()).sort((a, b) => {
            const ka = lockerSortKey(a);
            const kb = lockerSortKey(b);
            if (ka.rank !== kb.rank) return ka.rank - kb.rank;
            if (ka.num !== kb.num) return ka.num - kb.num;
            return ka.text.localeCompare(kb.text);
        });

        lockerLabels.forEach((lockerLabel) => {
            const lockerKeys = groups.get(lockerLabel) || [];
            lockerKeys.sort((a, b) => String(a?.keyId || '').localeCompare(String(b?.keyId || '')));

            const borrowedCount = lockerKeys.filter((k) => normalizeKeyStatus(k?.status) === 'borrowed').length;
            const metaParts = [`Total keys: ${lockerKeys.length}`];
            if (borrowedCount) metaParts.push(`Borrowed: ${borrowedCount}`);

            const groupEl = document.createElement('div');
            groupEl.className = 'keys-overview-group';
            groupEl.innerHTML = `
                <div class="keys-overview-group-head">
                    <div>
                        <h4 class="keys-overview-group-title">${escapeHtml(lockerLabel)}</h4>
                        <p class="keys-overview-group-meta">${escapeHtml(metaParts.join(' • '))}</p>
                    </div>
                </div>
                <div class="keys-overview-keys" role="region" aria-label="Keys in ${escapeHtml(lockerLabel)}"></div>
            `;

            const keysWrap = groupEl.querySelector('.keys-overview-keys');
            if (!keysWrap) return;

            if (!lockerKeys.length) {
                const empty = document.createElement('div');
                empty.className = 'keys-overview-empty-state';
                empty.textContent = 'No keys in this locker.';
                keysWrap.appendChild(empty);
            } else {
                lockerKeys.forEach((key) => {
                    const keyItem = buildKeyBoxElement(key, {
                        usersById,
                        showActions: false,
                        showDescription: false
                    });
                    keysWrap.appendChild(keyItem);
                });
            }

            list.appendChild(groupEl);
        });
    } catch (error) {
        console.error('Error fetching keys overview:', error);
        list.innerHTML = `
            <div class="admin-card keys-overview-empty">
                <p class="text-center">Error loading keys. Please try again.</p>
            </div>
        `;
    }
}

function setKeysOverviewFullscreen(isFullscreen) {
    const shouldEnable = Boolean(isFullscreen);
    document.body.classList.toggle('keys-fullscreen', shouldEnable);
    if (elements.keysFullscreenBtn) {
        elements.keysFullscreenBtn.textContent = shouldEnable ? 'Exit Full Screen' : 'Full Screen';
        elements.keysFullscreenBtn.setAttribute('aria-pressed', shouldEnable ? 'true' : 'false');
    }
}

function toggleKeysOverviewFullscreen() {
    const isActive = document.body.classList.contains('keys-fullscreen');
    setKeysOverviewFullscreen(!isActive);
}

// Simple canvas charts (fallback when Chart.js is unavailable)
function setupCanvasSize(canvas) {
    const parent = canvas.parentElement;
    const width = Math.max(1, canvas.clientWidth || parent?.clientWidth || 600);
    const height = Math.max(1, canvas.clientHeight || parent?.clientHeight || 280);
    canvas.width = width;
    canvas.height = height;
}

function drawLineChart(canvas, labels, series) {
    if (!canvas) return;
    setupCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const padding = 40;
    const chartW = canvas.width - padding * 2;
    const chartH = canvas.height - padding * 2;

    const maxVal = Math.max(1, ...series.flat());
    const xStep = labels.length > 1 ? chartW / (labels.length - 1) : chartW;

    // Axes
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + chartH);
    ctx.lineTo(padding + chartW, padding + chartH);
    ctx.stroke();

    const colors = ['#28a745', '#dc3545'];
    series.forEach((data, idx) => {
        ctx.strokeStyle = colors[idx] || '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        data.forEach((val, i) => {
            const x = padding + i * xStep;
            const y = padding + chartH - (val / maxVal) * chartH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw points
        ctx.fillStyle = colors[idx] || '#333';
        data.forEach((val, i) => {
            const x = padding + i * xStep;
            const y = padding + chartH - (val / maxVal) * chartH;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    });
}

function drawDonutChart(canvas, values, colors) {
    if (!canvas) return;
    setupCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const total = values.reduce((a, b) => a + b, 0) || 1;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 20;
    const innerRadius = radius * 0.6;

    let start = -Math.PI / 2;
    values.forEach((val, idx) => {
        const angle = (val / total) * Math.PI * 2;
        ctx.fillStyle = colors[idx] || '#999';
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, start, start + angle);
        ctx.closePath();
        ctx.fill();
        start += angle;
    });

    // Cutout
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
}

function drawBarChart(canvas, labels, values, color) {
    if (!canvas) return;
    setupCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const padding = 40;
    const chartW = canvas.width - padding * 2;
    const chartH = canvas.height - padding * 2;
    const maxVal = Math.max(1, ...values);
    const barGap = 18;
    const barWidth = Math.max(30, (chartW - barGap * (values.length - 1)) / values.length);

    // Axes
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + chartH);
    ctx.lineTo(padding + chartW, padding + chartH);
    ctx.stroke();

    values.forEach((val, i) => {
        const x = padding + i * (barWidth + barGap);
        const barH = (val / maxVal) * (chartH - 10);
        const y = padding + chartH - barH;
        ctx.fillStyle = color || '#a30000';
        ctx.fillRect(x, y, barWidth, barH);

        ctx.fillStyle = '#666';
        ctx.font = '12px Poppins, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], x + barWidth / 2, padding + chartH + 16);
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Announcements helpers
function fileToDataUrl(file, { maxBytes = 2 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve('');

        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
        if (!allowed.has(file.type)) {
            return reject(new Error('Please choose a JPG, PNG, WEBP, or GIF image.'));
        }

        if (Number.isFinite(maxBytes) && file.size > maxBytes) {
            return reject(new Error('Image is too large. Please choose a smaller file.'));
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
    });
}

function setImagePreview(container, dataUrl) {
    if (!container) return;
    const url = String(dataUrl || '').trim();
    container.innerHTML = url ? `<img src="${url}" alt="Preview">` : '';
    container.classList.toggle('hidden', !url);
}

function formatAnnouncementType(type) {
    const t = String(type || 'notification').trim().toLowerCase();
    return t === 'popup' ? 'popup' : 'notification';
}

function getAnnouncementTypeBadge(type) {
    const t = formatAnnouncementType(type);
    if (t === 'popup') {
        return '<span class="status-badge status-default">Popup</span>';
    }
    return '<span class="status-badge status-new">Notification</span>';
}

function getAnnouncementActiveBadge(active) {
    const isActive = active !== false;
    return `<span class="key-status ${isActive ? 'status-available' : 'status-read'}">${isActive ? 'active' : 'inactive'}</span>`;
}

async function displayAnnouncementsManagement() {
    await loadAdminAnnouncements();
}

async function loadAdminAnnouncements() {
    const list = elements.adminAnnouncementsList;
    if (!list) return;

    try {
        list.innerHTML = `
            <div class="admin-card">
                <p class="text-center">Loading announcements...</p>
            </div>
        `;

        const data = await apiRequest('/admin/announcements?limit=200', { silent: true });
        const announcements = Array.isArray(data?.announcements) ? data.announcements : [];

        if (announcements.length === 0) {
            list.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">No announcements yet.</p>
                    <p class="text-center text-muted">Create a notification or popup above.</p>
                </div>
            `;
            return;
        }

        list.innerHTML = '';

        announcements.forEach((a) => {
            const id = a?._id || a?.id;
            if (!id) return;
            const type = formatAnnouncementType(a?.type);
            const message = String(a?.message || '').trim();
            const title = String(a?.title || '').trim();
            const createdAt = a?.createdAt ? new Date(a.createdAt).toLocaleString() : 'N/A';
            const createdBy = String(a?.createdByName || '').trim();
            const imageDataUrl = String(a?.imageDataUrl || '').trim();
            const active = a?.active !== false;

            const card = document.createElement('div');
            card.className = 'admin-card announcement-card';
            card.innerHTML = `
                <div class="key-header">
                    <div class="key-title">
                        <h3>${escapeHtml(title || (type === 'popup' ? 'Popup Banner' : 'Notification'))}</h3>
                        ${getAnnouncementTypeBadge(type)}
                    </div>
                    ${getAnnouncementActiveBadge(active)}
                </div>
                <div class="key-details">
                    ${createdBy ? `<p><strong>By:</strong> ${escapeHtml(createdBy)}</p>` : ''}
                    <p><strong>Time:</strong> ${escapeHtml(createdAt)}</p>
                    ${type !== 'popup' && message ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>` : ''}
                    ${imageDataUrl ? `<div class="announcement-image-wrap"><img src="${imageDataUrl}" alt="Announcement image"></div>` : ''}
                </div>
                <div class="key-actions">
                    <button class="btn btn-small btn-danger delete-announcement-btn" data-announcement-id="${escapeHtml(String(id))}">
                        Delete
                    </button>
                </div>
            `;
            list.appendChild(card);
        });

        list.querySelectorAll('.delete-announcement-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget?.dataset?.announcementId || '';
                await deleteAnnouncement(id);
            });
        });
    } catch (error) {
        console.error('Load announcements error:', error);
        list.innerHTML = `
            <div class="admin-card">
                <p class="text-center error">Failed to load announcements.</p>
                <button class="btn btn-secondary btn-small" id="retryLoadAnnouncementsBtn">Retry</button>
            </div>
        `;
        const retry = document.getElementById('retryLoadAnnouncementsBtn');
        if (retry) retry.addEventListener('click', () => loadAdminAnnouncements());
    }
}

async function deleteAnnouncement(announcementId) {
    const id = String(announcementId || '').trim();
    if (!id) return;

    const ok = await showConfirmDialog({
        title: 'Delete Announcement',
        message: 'Delete this announcement? Users will no longer see it.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;

    try {
        await apiRequest(`/admin/announcements/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            silent: true
        });
        showNotification('Announcement deleted.', 'success');
        await loadAdminAnnouncements();
        refreshDatabaseHubAfterMutation(['announcements']);
    } catch (error) {
        console.error('Delete announcement error:', error);
        showNotification(error.message || 'Failed to delete announcement', 'error');
    }
}

async function publishNotificationAnnouncement() {
    const message = String(elements.announcementMessage?.value || '').trim();
    const imageDataUrl = String(announcementImageDataUrl || '').trim();

    if (!message) {
        showNotification('Please enter a message.', 'error');
        return;
    }

    const btn = elements.announceBtn;
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;

    try {
        showNotification('Publishing announcement...', 'info');
        await apiRequest('/admin/announcements', {
            method: 'POST',
            body: JSON.stringify({
                type: 'notification',
                message,
                imageDataUrl
            }),
            silent: true
        });

        if (elements.announcementMessage) elements.announcementMessage.value = '';
        announcementImageDataUrl = '';
        if (elements.announcementImageInput) elements.announcementImageInput.value = '';
        setImagePreview(elements.announcementImagePreview, '');

        showNotification('Announcement published.', 'success');
        await loadAdminAnnouncements();
    } catch (error) {
        console.error('Publish announcement error:', error);
        showNotification(error.message || 'Failed to publish announcement', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function publishPopupAnnouncement() {
    const imageDataUrl = String(popupImageDataUrl || '').trim();

    if (!imageDataUrl) {
        showNotification('Please choose a popup image.', 'error');
        return;
    }

    const btn = elements.publishPopupBtn;
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;

    try {
        showNotification('Publishing popup...', 'info');
        await apiRequest('/admin/announcements', {
            method: 'POST',
            body: JSON.stringify({
                type: 'popup',
                imageDataUrl
            }),
            silent: true
        });

        popupImageDataUrl = '';
        if (elements.popupImageInput) elements.popupImageInput.value = '';
        setImagePreview(elements.popupImagePreview, '');

        showNotification('Popup published.', 'success');
        await loadAdminAnnouncements();
    } catch (error) {
        console.error('Publish popup error:', error);
        showNotification(error.message || 'Failed to publish popup', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

const ACTION_VERB_PAST_TENSE = {
    create: 'Created',
    update: 'Updated',
    edit: 'Edited',
    delete: 'Deleted',
    remove: 'Removed',
    borrow: 'Borrowed',
    return: 'Returned',
    assign: 'Assigned',
    unassign: 'Unassigned',
    generate: 'Generated',
    scan: 'Scanned',
    login: 'Logged In',
    logout: 'Logged Out',
    register: 'Registered',
    reset: 'Reset',
    request: 'Requested',
    confirm: 'Confirmed',
    enable: 'Enabled',
    disable: 'Disabled',
    report_lost: 'Reported Lost',
    read: 'Read',
    reply: 'Replied',
    resolve: 'Resolved',
    reopen: 'Reopened',
    activate: 'Activated',
    deactivate: 'Deactivated'
};

function formatActivityAction(action) {
    const raw = String(action || '').trim();
    if (!raw) return 'Activity';

    const parts = raw.split('.').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return raw;
    if (parts.length === 1) return humanizeDetailKey(parts[0]);

    const actorPrefix = String(parts[0] || '').toLowerCase();
    if (parts.length >= 3 && (actorPrefix === 'user' || actorPrefix === 'admin' || actorPrefix === 'system')) {
        parts.shift();
    }

    const verbRaw = parts.pop();
    const subjectRaw = parts.join(' ');
    const verbKey = String(verbRaw || '').toLowerCase();

    const verbHuman = ACTION_VERB_PAST_TENSE[verbKey] || humanizeDetailKey(verbRaw);
    const subjectHuman = humanizeDetailKey(subjectRaw);

    if (!subjectHuman) return verbHuman || humanizeDetailKey(raw);
    if (!verbHuman) return subjectHuman;

    return `${subjectHuman} ${verbHuman}`.trim();
}

function humanizeDetailKey(key) {
    const raw = String(key || '').trim();
    if (!raw) return '';

    const spaced = raw
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

    const titled = spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
    return titled
        .replace(/\bId\b/g, 'ID')
        .replace(/\bQr\b/g, 'QR')
        .replace(/\bUrl\b/g, 'URL')
        .replace(/\bIp\b/g, 'IP');
}

function formatDetailValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function isDataImageUrl(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed);
}

function isImageUrl(value) {
    if (isDataImageUrl(value)) return true;
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const looksLikePath =
        /^https?:\/\//i.test(trimmed) ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('./') ||
        trimmed.startsWith('../');
    if (!looksLikePath) return false;
    return /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(trimmed);
}

function renderLogDetails(details) {
    // Backward-compat: older logs may have JSON stored as a string
    let normalized = details;
    if (typeof normalized === 'string') {
        const trimmed = normalized.trim();
        const looksJson =
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'));
        if (looksJson) {
            try {
                normalized = JSON.parse(trimmed);
            } catch {
                normalized = details;
            }
        }
    }

    if (normalized === null || normalized === undefined) {
        return '<div class="details-empty">N/A</div>';
    }

    if (typeof normalized !== 'object') {
        return `<div class="details-list"><div class="details-item"><span class="details-value">${escapeHtml(formatDetailValue(normalized))}</span></div></div>`;
    }

    const entries = Array.isArray(normalized)
        ? normalized.map((value, idx) => [`Item ${idx + 1}`, value])
        : Object.entries(normalized);

    const filtered = entries.filter(([k]) => String(k || '').trim().length > 0);
    if (filtered.length === 0) {
        return '<div class="details-empty">N/A</div>';
    }

    if (
        filtered.length === 1 &&
        String(filtered[0][0]).trim() === 'movedKeysToUnassigned' &&
        Number(filtered[0][1]) === 0
    ) {
        return '<div class="details-empty">No keys were moved.</div>';
    }

    const normalizeForMatch = (key) => String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const oldPhotoIdx = filtered.findIndex(([key]) => normalizeForMatch(key) === 'oldphoto');
    const newPhotoIdx = filtered.findIndex(([key]) => normalizeForMatch(key) === 'newphoto');
    const oldPhotoValue = oldPhotoIdx >= 0 ? filtered[oldPhotoIdx][1] : undefined;
    const newPhotoValue = newPhotoIdx >= 0 ? filtered[newPhotoIdx][1] : undefined;

    const shouldRenderPhotoDiff =
        (oldPhotoIdx >= 0 || newPhotoIdx >= 0) &&
        (isImageUrl(oldPhotoValue) || isImageUrl(newPhotoValue));

    const filteredWithoutPhotos = shouldRenderPhotoDiff
        ? filtered.filter((_, idx) => idx !== oldPhotoIdx && idx !== newPhotoIdx)
        : filtered;

    const mediaGridHtml = shouldRenderPhotoDiff ? (() => {
        const cells = [
            { label: 'Old Photo', value: oldPhotoValue },
            { label: 'New Photo', value: newPhotoValue }
        ].map(({ label, value }) => {
            if (isImageUrl(value)) {
                const src = escapeHtml(String(value).trim());
                const alt = escapeHtml(`${label} preview`);
                return `
                    <div class="details-media-item">
                        <div class="details-media-label">${escapeHtml(label)}</div>
                        <a class="log-photo-thumb-link" href="${src}" target="_blank" rel="noopener">
                            <img class="log-photo-thumb" src="${src}" alt="${alt}">
                        </a>
                    </div>
                `;
            }

            const fallback = (value === null || value === undefined || value === '')
                ? 'None'
                : formatDetailValue(value);
            return `
                <div class="details-media-item">
                    <div class="details-media-label">${escapeHtml(label)}</div>
                    <div class="details-media-placeholder">${escapeHtml(fallback === '—' ? 'None' : fallback)}</div>
                </div>
            `;
        }).join('');

        return `<div class="details-media-grid">${cells}</div>`;
    })() : '';

    const items = filteredWithoutPhotos.map(([key, value]) => {
        const label = humanizeDetailKey(key);

        if (isImageUrl(value)) {
            const src = escapeHtml(String(value).trim());
            const alt = escapeHtml(`${label || String(key)} preview`);
            return `
                <div class="details-item details-item--media">
                    <span class="details-key">${escapeHtml(label || String(key))}</span>
                    <span class="details-value details-value--media">
                        <a class="log-photo-thumb-link" href="${src}" target="_blank" rel="noopener">
                            <img class="log-photo-thumb" src="${src}" alt="${alt}">
                        </a>
                    </span>
                </div>
            `;
        }

        const printable = formatDetailValue(value);
        return `
            <div class="details-item">
                <span class="details-key">${escapeHtml(label || String(key))}</span>
                <span class="details-value">${escapeHtml(printable)}</span>
            </div>
        `;
    }).join('');

    const listHtml = items ? `<div class="details-list">${items}</div>` : '';
    return `<div class="details-stack">${listHtml}${mediaGridHtml}</div>`;
}

// Activity Logs
async function displayActivityLogs(searchValue = '', category = logsCategory) {
    try {
        const qs = new URLSearchParams();
        if (searchValue) qs.set('search', searchValue);
        if (category && category !== 'all') qs.set('category', category);
        const query = qs.toString() ? `?${qs.toString()}` : '';
        const data = await apiRequest(`/admin/logs${query}`);
        if (!data || !data.logs) return;

        const logsList = elements.activityLogsList;
        if (!logsList) return;

        const prevScrollTop = logsList.scrollTop;
        logsList.innerHTML = '';

        if (data.logs.length === 0) {
            logsList.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">No logs found.</p>
                </div>
            `;
            return;
        }

        data.logs.forEach(log => {
            const logItem = document.createElement('div');
            logItem.className = 'admin-card';
            const detailsHtml = renderLogDetails(log.details);
            const actionTitle = formatActivityAction(log.action);
            const actorType = String(log.actorType || 'system');
            const actorName = log.actorName ? String(log.actorName) : 'System';
            const targetName = log.targetName ? String(log.targetName) : 'N/A';
            const createdAt = log.createdAt ? new Date(log.createdAt).toLocaleString() : 'N/A';
            logItem.innerHTML = `
                <div class="key-header">
                    <div class="key-title">
                        <h3>${escapeHtml(actionTitle)}</h3>
                    </div>
                    <span class="key-status status-${String(log.action || '').includes('delete') ? 'lost' : 'available'}">${escapeHtml(actorType)}</span>
                </div>
                <div class="key-details">
                    <p><strong>Actor:</strong> ${escapeHtml(actorName)}</p>
                    <p><strong>Target:</strong> ${escapeHtml(targetName)}</p>
                    <p><strong>Time:</strong> ${escapeHtml(createdAt)}</p>
                    <div class="log-details">
                        <p><strong>Details:</strong></p>
                        ${detailsHtml}
                    </div>
                </div>
                <div class="key-actions">
                    <button class="btn btn-small btn-danger delete-log-btn" data-log-id="${log._id}">
                        Delete
                    </button>
                </div>
            `;
            logsList.appendChild(logItem);
        });

        document.querySelectorAll('.delete-log-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const logId = e.target.dataset.logId;
                await deleteLog(logId);
            });
        });

        logsList.scrollTop = prevScrollTop;
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        showNotification('Failed to load activity logs', 'error');
    }
}

async function deleteLog(logId) {
    const ok = await showConfirmDialog({
        title: 'Delete Log',
        message: 'Delete this log entry? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;
    try {
        await apiRequest(`/admin/logs/${logId}`, { method: 'DELETE' });
        showNotification('Log deleted successfully', 'success');
        const searchValue = document.getElementById('logsSearch')?.value?.trim() || '';
        await displayActivityLogs(searchValue);
        refreshDatabaseHubAfterMutation(['logs']);
    } catch (error) {
        console.error('Error deleting log:', error);
        showNotification('Failed to delete log', 'error');
    }
}

// Feedback
async function displayFeedback(searchValue = '') {
    try {
        const list = elements.feedbackList;
        if (!list) return;

        const prevScrollTop = list.scrollTop;
        if (list.childElementCount === 0) {
            list.innerHTML = '<div class="spinner"></div>';
        }

        const status = document.getElementById('feedbackStatus')?.value || 'new';
        const qs = new URLSearchParams();
        if (searchValue) qs.set('search', searchValue);
        if (status) qs.set('status', status);
        qs.set('limit', '200');

        const data = await apiRequest(`/admin/feedback?${qs.toString()}`, { silent: true });
        const feedback = Array.isArray(data?.feedback) ? data.feedback : [];

        list.innerHTML = '';

        if (feedback.length === 0) {
            list.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">No feedback found.</p>
                    <p class="text-center text-muted">Try changing the filter or search keyword.</p>
                </div>
            `;
            return;
        }

        feedback.forEach((item) => {
            const from = item.anonymous ? 'Anonymous' : (String(item.email || '').trim() || 'User');
            const badgeClass = item.isRead ? 'status-read' : 'status-new';
            const badgeText = item.isRead ? 'Read' : 'New';
            const createdAt = item.createdAt ? new Date(item.createdAt) : new Date();
            const messageHtml = escapeHtml(String(item.message || '')).replace(/\n/g, '<br>');

            const card = document.createElement('div');
            card.className = `admin-card feedback-card ${item.isRead ? 'feedback-read' : 'feedback-new'}`;
            card.innerHTML = `
                <div class="key-header">
                    <h3>Feedback</h3>
                    <span class="key-status ${badgeClass}">${badgeText}</span>
                </div>
                <div class="key-details">
                    <p><strong>From:</strong> ${escapeHtml(from)}</p>
                    <p><strong>Time:</strong> ${createdAt.toLocaleString()}</p>
                    <div class="feedback-message">${messageHtml}</div>
                </div>
                <div class="key-actions">
                    <button class="btn btn-small btn-secondary mark-feedback-btn" data-feedback-id="${item._id}" data-is-read="${item.isRead ? '1' : '0'}">
                        ${item.isRead ? 'Mark Unread' : 'Mark Read'}
                    </button>
                    <button class="btn btn-small btn-danger delete-feedback-btn" data-feedback-id="${item._id}">
                        Delete
                    </button>
                </div>
            `;
            list.appendChild(card);
        });

        list.querySelectorAll('.mark-feedback-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.feedbackId;
                const isRead = e.currentTarget.dataset.isRead === '1';
                await setFeedbackRead(id, !isRead);
            });
        });

        list.querySelectorAll('.delete-feedback-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.feedbackId;
                await deleteFeedback(id);
            });
        });

        list.scrollTop = prevScrollTop;
    } catch (error) {
        console.error('Error loading feedback:', error);
        showNotification('Failed to load feedback', 'error');
    }
}

async function setFeedbackRead(feedbackId, isRead) {
    const id = String(feedbackId || '').trim();
    if (!id) return;

    try {
        await apiRequest(`/admin/feedback/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ isRead: Boolean(isRead) }),
            silent: true
        });

        const value = document.getElementById('feedbackSearch')?.value?.trim() || '';
        await displayFeedback(value);
    } catch (error) {
        console.error('Error updating feedback:', error);
        showNotification('Failed to update feedback', 'error');
    }
}

async function deleteFeedback(feedbackId) {
    const id = String(feedbackId || '').trim();
    if (!id) return;

    const ok = await showConfirmDialog({
        title: 'Delete Feedback',
        message: 'Delete this feedback message? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;

    try {
        await apiRequest(`/admin/feedback/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            silent: true
        });

        const value = document.getElementById('feedbackSearch')?.value?.trim() || '';
        await displayFeedback(value);
        showNotification('Feedback deleted successfully', 'success');
        refreshDatabaseHubAfterMutation(['feedback']);
    } catch (error) {
        console.error('Error deleting feedback:', error);
        showNotification('Failed to delete feedback', 'error');
    }
}

// Admins
async function displayAdmins(searchValue = '') {
    try {
        if (!canCurrentAdminManageAdmins()) {
            showNotification('You do not have permission to manage admin accounts', 'error');
            return;
        }

        const query = searchValue ? `?search=${encodeURIComponent(searchValue)}` : '';
        const data = await apiRequest(`/admin/admins${query}`);
        if (!data || !data.admins) return;

        const adminsList = elements.adminsList;
        if (!adminsList) return;

        adminsList.innerHTML = '';

        const activeAdmins = data.admins.filter(a => a.isActive !== false);
        const currentAdminId = getStoredAdminData()?.id || null;

        if (activeAdmins.length === 0) {
            adminsList.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">No admins found.</p>
                </div>
            `;
            return;
        }

        activeAdmins.forEach(admin => {
            const isSelf = currentAdminId && String(currentAdminId) === String(admin._id);
            const isDefault = admin.isDefault === true;
            const deleteDisabledReason = isDefault
                ? 'Default admin account cannot be deleted'
                : isSelf
                    ? 'You cannot delete your own account'
                    : '';
            const adminItem = document.createElement('div');
            adminItem.className = 'admin-card';
            if (isDefault) adminItem.classList.add('is-default-admin');
            adminItem.innerHTML = `
                <div class="key-header">
                    <div class="key-title">
                        <h3>${admin.username}</h3>
                        ${isDefault ? '<span class="status-badge status-default">Default</span>' : ''}
                    </div>
                    <span class="key-status status-${admin.isActive ? 'available' : 'lost'}">
                        ${admin.isActive ? 'active' : 'inactive'}
                    </span>
                </div>
                <div class="key-details">
                    <p><strong>Name:</strong> ${admin.fullName || 'N/A'}</p>
                    <p><strong>Email:</strong> ${admin.email || 'N/A'}</p>
                    <p><strong>Role:</strong> ${admin.role || 'admin'}</p>
                </div>
                <div class="key-actions">
                    <button class="btn btn-small btn-secondary reset-admin-btn" data-admin-id="${admin._id}" data-admin-label="${admin.email || admin.username}" ${isDefault ? 'disabled title="Default admin account cannot be modified"' : ''}>
                        Reset Password
                    </button>
                    <button class="btn btn-small btn-danger delete-admin-btn" data-admin-id="${admin._id}" ${deleteDisabledReason ? `disabled title="${deleteDisabledReason}"` : ''}>
                        Delete
                    </button>
                </div>
            `;
            adminsList.appendChild(adminItem);
        });

        document.querySelectorAll('.reset-admin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('.reset-admin-btn') || e.currentTarget;
                resetAdminId = targetBtn?.dataset?.adminId || null;
                resetAdminLabel = targetBtn?.dataset?.adminLabel || '';
                if (!resetAdminId) {
                    showNotification('Select an admin first', 'error');
                    return;
                }
                const labelEl = document.getElementById('resetAdminLabel');
                if (labelEl) labelEl.textContent = resetAdminLabel || 'this admin';
                showModal(elements.resetAdminPasswordModal);
                setTimeout(() => document.getElementById('resetAdminPassword')?.focus(), 0);
            });
        });

        document.querySelectorAll('.delete-admin-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const adminId = e.currentTarget.dataset.adminId;
                await deleteAdmin(adminId);
            });
        });
    } catch (error) {
        console.error('Error loading admins:', error);
        showNotification('Failed to load admins', 'error');
    }
}

async function addAdmin() {
    const username = document.getElementById('newAdminUsername')?.value.trim();
    const fullName = document.getElementById('newAdminFullName')?.value.trim();
    const email = document.getElementById('newAdminEmail')?.value.trim();
    const password = document.getElementById('newAdminPassword')?.value ?? '';

    if (!username || !fullName || !email || !password) {
        showNotification('Please fill out all admin fields', 'error');
        return;
    }

    try {
        await apiRequest('/admin/admins', {
            method: 'POST',
            body: JSON.stringify({ username, fullName, email, password })
        });
        hideModal(elements.addAdminModal);
        showNotification('Admin added successfully', 'success');
        document.getElementById('newAdminUsername').value = '';
        document.getElementById('newAdminFullName').value = '';
        document.getElementById('newAdminEmail').value = '';
        document.getElementById('newAdminPassword').value = '';
        await displayAdmins();
    } catch (error) {
        console.error('Error adding admin:', error);
        showNotification(error.message || 'Failed to add admin', 'error');
    }
}

async function deleteAdmin(adminId) {
    const ok = await showConfirmDialog({
        title: 'Delete Admin',
        message: 'Delete this admin account? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;
    try {
        await apiRequest(`/admin/admins/${adminId}`, { method: 'DELETE' });
        showNotification('Admin deleted successfully', 'success');
        const card = document.querySelector(`.delete-admin-btn[data-admin-id="${adminId}"]`)?.closest('.admin-card');
        if (card && card.parentNode) card.parentNode.removeChild(card);
        const searchValue = document.getElementById('adminSearch')?.value?.trim() || '';
        displayAdmins(searchValue);
        refreshDatabaseHubAfterMutation(['admins']);
    } catch (error) {
        console.error('Error deleting admin:', error);
        showNotification('Failed to delete admin', 'error');
    }
}

// Users
async function displayUsers(searchValue = '') {
    try {
        const query = searchValue ? `?search=${encodeURIComponent(searchValue)}` : '';
        const data = await apiRequest(`/admin/users${query}`);
        if (!data || !data.users) return;

        const usersList = elements.usersList;
        if (!usersList) return;

        usersList.innerHTML = '';

        const activeUsers = data.users.filter(u => u.isActive !== false);

        if (activeUsers.length === 0) {
            usersList.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">No users found.</p>
                </div>
            `;
            return;
        }

        activeUsers.forEach(user => {
            const approvalStatus = String(user.approvalStatus || 'approved').trim().toLowerCase();
            const isPending = approvalStatus === 'pending';
            const badgeClass = isPending ? 'status-pending' : (user.isActive ? 'status-available' : 'status-lost');
            const badgeText = isPending ? 'pending' : (user.isActive ? 'active' : 'inactive');

            const userItem = document.createElement('div');
            userItem.className = 'admin-card';
            userItem.innerHTML = `
                <div class="key-header">
                    <h3>${user.firstName} ${user.lastName}</h3>
                    <span class="key-status ${badgeClass}">
                        ${badgeText}
                    </span>
                </div>
                <div class="key-details">
                    <p><strong>Email:</strong> ${user.email}</p>
                    <p><strong>Role:</strong> ${user.role || 'teacher'}</p>
                    <p><strong>Last Login:</strong> ${user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'N/A'}</p>
                </div>
                <div class="key-actions">
                    <button class="btn btn-small btn-secondary reset-user-btn" data-user-id="${user._id}" data-user-email="${user.email}">
                        Reset Password
                    </button>
                    <button class="btn btn-small btn-danger delete-user-btn" data-user-id="${user._id}">
                        Remove
                    </button>
                </div>
            `;
            usersList.appendChild(userItem);
        });

        document.querySelectorAll('.reset-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('.reset-user-btn') || e.currentTarget;
                resetUserId = targetBtn?.dataset?.userId || null;
                resetUserEmail = targetBtn?.dataset?.userEmail || '';
                if (!resetUserId) {
                    showNotification('Select a user to reset password', 'error');
                    return;
                }
                const emailEl = document.getElementById('resetUserEmail');
                if (emailEl) emailEl.textContent = resetUserEmail;
                showModal(elements.resetUserPasswordModal);
            });
        });

        document.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const userId = e.target.dataset.userId;
                await deleteUser(userId);
            });
        });
    } catch (error) {
        console.error('Error loading users:', error);
        showNotification('Failed to load users', 'error');
    }
}

// Pending Teacher Approvals
async function displayPendingApprovals(searchValue = '') {
    try {
        const approvalsList = elements.approvalsList;
        if (!approvalsList) return;
        if (!canCurrentAdminManageUsers()) {
            approvalsList.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">You do not have permission to approve users.</p>
                </div>
            `;
            return;
        }

        const qs = new URLSearchParams();
        if (searchValue) qs.set('search', searchValue);
        const query = qs.toString() ? `?${qs.toString()}` : '';

        const data = await apiRequest(`/admin/user-approvals${query}`, { silent: true });
        const users = Array.isArray(data?.users) ? data.users : [];

        approvalsList.innerHTML = '';

        if (users.length === 0) {
            approvalsList.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">No pending approvals.</p>
                    <p class="text-center text-muted">New teacher registrations will appear here.</p>
                </div>
            `;
            return;
        }

        users.forEach((user) => {
            const fullName = `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim() || 'User';
            const email = String(user.email || '').trim();
            const requestedAt = user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A';

            const card = document.createElement('div');
            card.className = 'admin-card';
            card.innerHTML = `
                <div class="key-header">
                    <div class="key-title">
                        <h3>${escapeHtml(fullName)}</h3>
                    </div>
                    <span class="key-status status-pending">Pending</span>
                </div>
                <div class="key-details">
                    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
                    <p><strong>Requested:</strong> ${escapeHtml(requestedAt)}</p>
                </div>
                <div class="key-actions">
                    <button class="btn btn-small btn-success approve-user-btn" data-user-id="${user._id}">
                        Approve
                    </button>
                    <button class="btn btn-small btn-warning reject-user-btn" data-user-id="${user._id}" data-user-email="${escapeHtml(email)}">
                        Reject
                    </button>
                    <button class="btn btn-small btn-danger delete-user-btn" data-user-id="${user._id}">
                        Delete
                    </button>
                </div>
            `;

            approvalsList.appendChild(card);
        });

        approvalsList.querySelectorAll('.approve-user-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const userId = e.currentTarget?.dataset?.userId || '';
                if (!userId) return;
                await approveUserAccount(userId);
            });
        });

        approvalsList.querySelectorAll('.reject-user-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const userId = e.currentTarget?.dataset?.userId || '';
                if (!userId) return;
                await rejectUserAccount(userId);
            });
        });

        approvalsList.querySelectorAll('.delete-user-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const userId = e.currentTarget?.dataset?.userId || '';
                if (!userId) return;
                await deleteUser(userId);
                const currentSearch = elements.approvalsSearch?.value?.trim() || '';
                displayPendingApprovals(currentSearch);
            });
        });
    } catch (error) {
        console.error('Error loading pending approvals:', error);
        showNotification(error.message || 'Failed to load approvals', 'error');
    }
}

async function approveUserAccount(userId) {
    const ok = await showConfirmDialog({
        title: 'Approve User',
        message: 'Approve this teacher account so they can access the dashboard?',
        confirmText: 'Approve',
        cancelText: 'Cancel',
        tone: 'success'
    });
    if (!ok) return;

    try {
        const data = await apiRequest(`/admin/users/${userId}/approve`, { method: 'POST' });
        showNotification(
            data?.sent === false
                ? 'User approved, but email notification was not sent (SMTP not configured).'
                : 'User approved successfully',
            'success'
        );

        const approvalsSearch = elements.approvalsSearch?.value?.trim() || '';
        displayPendingApprovals(approvalsSearch);
        const userSearch = document.getElementById('userSearch')?.value?.trim() || '';
        displayUsers(userSearch);
    } catch (error) {
        console.error('Approve user error:', error);
        showNotification(error.message || 'Failed to approve user', 'error');
    }
}

async function rejectUserAccount(userId) {
    const ok = await showConfirmDialog({
        title: 'Reject User',
        message: 'Reject this teacher account? They will not be able to log in.',
        confirmText: 'Reject',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;

    try {
        const data = await apiRequest(`/admin/users/${userId}/reject`, { method: 'POST' });
        showNotification(
            data?.sent === false
                ? 'User rejected, but email notification was not sent (SMTP not configured).'
                : 'User rejected successfully',
            'success'
        );

        const approvalsSearch = elements.approvalsSearch?.value?.trim() || '';
        displayPendingApprovals(approvalsSearch);
        const userSearch = document.getElementById('userSearch')?.value?.trim() || '';
        displayUsers(userSearch);
    } catch (error) {
        console.error('Reject user error:', error);
        showNotification(error.message || 'Failed to reject user', 'error');
    }
}

async function addUser() {
    const firstName = document.getElementById('newUserFirstName')?.value.trim();
    const lastName = document.getElementById('newUserLastName')?.value.trim();
    const email = document.getElementById('newUserEmail')?.value.trim();
    const password = document.getElementById('newUserPassword')?.value ?? '';

    if (!firstName || !lastName || !email || !password) {
        showNotification('Please fill out all user fields', 'error');
        return;
    }

    try {
        await apiRequest('/admin/users', {
            method: 'POST',
            body: JSON.stringify({ firstName, lastName, email, password })
        });
        hideModal(elements.addUserModal);
        showNotification('User added successfully', 'success');
        document.getElementById('newUserFirstName').value = '';
        document.getElementById('newUserLastName').value = '';
        document.getElementById('newUserEmail').value = '';
        document.getElementById('newUserPassword').value = '';
        await displayUsers();
    } catch (error) {
        console.error('Error adding user:', error);
        showNotification(error.message || 'Failed to add user', 'error');
    }
}

async function deleteUser(userId) {
    const ok = await showConfirmDialog({
        title: 'Remove User',
        message: 'Remove this user? They will no longer be able to log in.',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;
    try {
        await apiRequest(`/admin/users/${userId}`, { method: 'DELETE' });
        showNotification('User removed successfully', 'success');
        const card = document.querySelector(`.delete-user-btn[data-user-id="${userId}"]`)?.closest('.admin-card');
        if (card && card.parentNode) card.parentNode.removeChild(card);
        const searchValue = document.getElementById('userSearch')?.value?.trim() || '';
        displayUsers(searchValue);
        refreshDatabaseHubAfterMutation(['users', 'keys']);
    } catch (error) {
        console.error('Error removing user:', error);
        showNotification('Failed to remove user', 'error');
    }
}

async function resetUserPassword() {
    const passwordInput = document.getElementById('resetUserPassword');
    const newPassword = passwordInput ? passwordInput.value : '';
    if (!resetUserId) {
        showNotification('Select a user first', 'error');
        return;
    }
    if (!newPassword) {
        showNotification('Enter a new password', 'error');
        return;
    }
    try {
        const token = localStorage.getItem('adminToken');
        if (!token) {
            showNotification('Admin session expired. Please log in again.', 'error');
            return;
        }

        const endpoints = [
            `${API_BASE_URL}/admin/users/${resetUserId}/reset-password`,
            `${API_BASE_URL}/users/${resetUserId}/reset-password`
        ];

        let lastError = null;
        for (const url of endpoints) {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ password: newPassword })
            });

            if (response.ok) {
                lastError = null;
                break;
            }

            if (response.status === 404) {
                lastError = 'Route not found';
                continue;
            }

            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to reset password');
        }

        if (lastError) {
            throw new Error(lastError);
        }

        hideModal(elements.resetUserPasswordModal);
        if (passwordInput) passwordInput.value = '';
        resetUserId = null;
        resetUserEmail = '';
        showNotification('Password reset successfully', 'success');
        const searchValue = document.getElementById('userSearch')?.value?.trim() || '';
        displayUsers(searchValue);
    } catch (error) {
        console.error('Error resetting password:', error);
        showNotification('Failed to reset password', 'error');
    }
}

async function resetAdminPassword() {
    const passwordInput = document.getElementById('resetAdminPassword');
    const newPassword = passwordInput ? passwordInput.value : '';
    if (!resetAdminId) {
        showNotification('Select an admin first', 'error');
        return;
    }
    if (!newPassword) {
        showNotification('Enter a new password', 'error');
        return;
    }

    try {
        await apiRequest(`/admin/admins/${resetAdminId}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ password: newPassword })
        });

        hideModal(elements.resetAdminPasswordModal);
        if (passwordInput) passwordInput.value = '';
        resetAdminId = null;
        resetAdminLabel = '';
        showNotification('Admin password reset successfully', 'success');
        const searchValue = document.getElementById('adminSearch')?.value?.trim() || '';
        displayAdmins(searchValue);
    } catch (error) {
        console.error('Error resetting admin password:', error);
        showNotification(error.message || 'Failed to reset password', 'error');
    }
}

// Initialize Charts
async function initializeCharts() {
    try {
        const data = await apiRequest('/admin/stats');
        if (!data || !data.stats) return;

        const fullLabels = ['Total Keys', 'Borrowers', 'Not Returned', 'Total Transactions'];
        const shortLabels = ['Total Keys', 'Borrowers', 'Not Returned', 'Total Txns'];
        const totals = [
            data.stats.totalKeys || 0,
            data.stats.totalUsers || 0,
            data.stats.borrowedKeys || 0,
            data.stats.totalTransactions || 0
        ];
        const hasTotals = totals.some((value) => value > 0);

        if (!hasTotals) {
            showChartFallback(elements.analyticsChart, 'No data yet. Chart will appear after activity.');
            return;
        }

        clearChartFallback(elements.analyticsChart);

        // If canvas is hidden (width 0), retry shortly
        if (elements.analyticsChart && elements.analyticsChart.parentElement?.clientWidth === 0) {
            setTimeout(initializeCharts, 300);
            return;
        }

        const isSmallScreen = window.innerWidth <= 768;
        const labels = isSmallScreen ? shortLabels : fullLabels;

        if (typeof Chart === 'undefined') {
            drawBarChart(elements.analyticsChart, labels, totals, '#a30000');
            return;
        }

        // Destroy existing charts
        if (charts.analytics) charts.analytics.destroy();

        // Totals Chart (Bar)
        const analyticsCtx = elements.analyticsChart.getContext('2d');
        charts.analytics = new Chart(analyticsCtx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Summary',
                        data: totals,
                        backgroundColor: ['#b40000', '#cc3a3a', '#7a0b0b', '#e05555'],
                        borderRadius: 8,
                        maxBarThickness: 36
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'System Summary'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = fullLabels[context.dataIndex] || context.label || '';
                                const value = context.parsed?.y ?? context.parsed ?? 0;
                                return `${label}: ${value}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Count'
                        },
                        ticks: {
                            stepSize: 1
                        }
                    },
                    x: {
                        ticks: {
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                            font: (ctx) => {
                                const w = ctx.chart.width || 400;
                                return { size: w < 520 ? 10 : 12, family: 'Poppins, sans-serif' };
                            }
                        },
                        title: {
                            display: true,
                            text: 'Metrics'
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error initializing charts:', error);
    }
}

// =========================
// Database Hub (Admin)
// =========================

function isDatabaseHubVisible() {
    return Boolean(elements.databaseSection && !elements.databaseSection.classList.contains('hidden'));
}

const DB_LIVE_STORAGE_KEY = 'admin_db_live';
const DB_LIVE_SUMMARY_INTERVAL_MS = 3000;
const DB_LIVE_EXPLORER_INTERVAL_MS = 6000;
const DB_EXPLORER_LIMIT = 50;
let dbLiveEnabled = true;
let dbHubLiveIntervalId = null;

function getClientTzOffsetString() {
    try {
        const minutes = -new Date().getTimezoneOffset();
        const sign = minutes >= 0 ? '+' : '-';
        const abs = Math.abs(minutes);
        const hh = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm = String(abs % 60).padStart(2, '0');
        return `${sign}${hh}:${mm}`;
    } catch {
        return '+00:00';
    }
}

function readDbLivePreference() {
    try {
        const raw = localStorage.getItem(DB_LIVE_STORAGE_KEY);
        if (raw === null) return true;
        return raw === '1' || raw === 'true';
    } catch {
        return true;
    }
}

function writeDbLivePreference(enabled) {
    try {
        localStorage.setItem(DB_LIVE_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
        // ignore
    }
}

function setDbLiveEnabled(enabled, { persist = true } = {}) {
    dbLiveEnabled = Boolean(enabled);
    if (elements.dbLiveToggle) {
        elements.dbLiveToggle.checked = dbLiveEnabled;
    }
    if (persist) {
        writeDbLivePreference(dbLiveEnabled);
    }
}

function shouldAutoRefreshDbExplorer() {
    if (!dbLiveEnabled) return false;
    if (!isDatabaseHubVisible()) return false;
    if (elements.dbJsonModal && elements.dbJsonModal.classList.contains('show')) return false;
    const active = document.activeElement;
    if (elements.dbSearchInput && active === elements.dbSearchInput) return false;
    return true;
}

function startDatabaseHubLiveUpdates() {
    if (dbHubLiveIntervalId) return;
    dbHubLiveIntervalId = setInterval(() => {
        try {
            if (document.hidden) return;
            if (!isDatabaseHubVisible()) return;
            if (!dbLiveEnabled) return;
            const now = Date.now();
            if (now - dbSummaryLastLoadedAt > DB_LIVE_SUMMARY_INTERVAL_MS) {
                loadDatabaseSummary({ silent: true });
            }
            if (shouldAutoRefreshDbExplorer() && now - dbExplorerLastLoadedAt > DB_LIVE_EXPLORER_INTERVAL_MS) {
                loadDbExplorer({ forceRefresh: true, silent: true });
            }
        } catch {
            // ignore timer errors
        }
    }, 1000);
}

function refreshDatabaseHubAfterMutation(affectedCollections = []) {
    const affected = Array.from(new Set(
        (affectedCollections || [])
            .map((c) => String(c || '').trim())
            .filter(Boolean)
    ));

    if (affected.length === 0 || affected.includes(String(dbExplorerState.localCollection || '').trim())) {
        dbExplorerState.localRows = null;
        dbExplorerState.localCollection = '';
    }

    if (!isDatabaseHubVisible()) return;

    loadDatabaseSummary({ silent: true });
    const shouldForce = affected.length === 0 || affected.includes(String(dbExplorerState.collection || '').trim());
    loadDbExplorer({ forceRefresh: shouldForce, silent: true });
}

function truncateText(value, maxLength = 90) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function safeDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function formatDateTime(value) {
    const date = safeDate(value);
    return date ? date.toLocaleString() : '—';
}

function formatDate(value) {
    const date = safeDate(value);
    return date ? date.toLocaleDateString() : '—';
}

function formatTime(value) {
    const date = safeDate(value);
    if (!date) return '—';
    try {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return date.toLocaleTimeString();
    }
}

function getTransactionUserLabel(transaction) {
    const user = transaction?.userId || {};
    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    if (name) return name;
    const email = String(user.email || '').trim();
    return email || 'Unknown';
}

function getRecentActivityFilters() {
    return {
        search: String(document.getElementById('recentActivitySearch')?.value || '').trim(),
        from: String(elements.recentActivityDateFrom?.value || '').trim(),
        to: String(elements.recentActivityDateTo?.value || '').trim()
    };
}

function buildDateFilterMeta(from, to) {
    if (from && to) return `Date filter: ${from} to ${to}`;
    if (from) return `Date filter: from ${from}`;
    if (to) return `Date filter: until ${to}`;
    return '';
}

function normalizeTransactionRow(transaction) {
    const locker = transaction?.locker === ''
        ? 'Unassigned'
        : (String(transaction?.locker || '').trim() || deriveLockerFromKeyId(transaction?.keyId) || '—');
    const action = String(transaction?.action || '').trim().toLowerCase();
    const actionLabel = action ? action.toUpperCase() : '—';
    const actionClass = action === 'borrow' ? 'status-borrowed' : (action === 'return' ? 'status-available' : 'status-default');
    const performedAt = transaction?.performedAt || transaction?.createdAt || transaction?.updatedAt;

    return {
        borrower: getTransactionUserLabel(transaction),
        keyId: String(transaction?.keyId || '').trim() || '—',
        locker,
        action,
        actionLabel,
        actionClass,
        dateBorrowed: action === 'borrow' ? formatDate(performedAt) : '-',
        timeBorrowed: action === 'borrow' ? formatTime(performedAt) : '-',
        dateReturned: action === 'return' ? formatDate(performedAt) : '-',
        timeReturned: action === 'return' ? formatTime(performedAt) : '-'
    };
}

function normalizeTransactionSessionRow(session) {
    const action = String(session?.action || '').trim().toLowerCase();
    const isReturned = action === 'return' || Boolean(session?.returnedAt);
    return {
        borrower: String(session?.borrower || '').trim() || 'Unknown',
        keyId: String(session?.keyId || '').trim() || '—',
        locker: String(session?.locker || '').trim() || deriveLockerFromKeyId(session?.keyId) || '—',
        action: isReturned ? 'return' : 'borrow',
        actionLabel: isReturned ? 'RETURN' : 'BORROW',
        actionClass: isReturned ? 'status-available' : 'status-borrowed',
        dateBorrowed: session?.borrowedAt ? formatDate(session.borrowedAt) : '-',
        timeBorrowed: session?.borrowedAt ? formatTime(session.borrowedAt) : '-',
        dateReturned: session?.returnedAt ? formatDate(session.returnedAt) : '-',
        timeReturned: session?.returnedAt ? formatTime(session.returnedAt) : '-'
    };
}

function normalizeRecentActivityDisplayRow(row) {
    const candidate = row || {};
    const alreadyNormalized = Object.prototype.hasOwnProperty.call(candidate, 'dateBorrowed')
        || Object.prototype.hasOwnProperty.call(candidate, 'timeBorrowed')
        || Object.prototype.hasOwnProperty.call(candidate, 'dateReturned')
        || Object.prototype.hasOwnProperty.call(candidate, 'timeReturned');

    return alreadyNormalized ? candidate : normalizeTransactionSessionRow(candidate);
}

async function fetchAdminTransactions({ search = '', page = 1, limit = 200, from = '', to = '' } = {}) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (from || to) params.set('tzOffset', getClientTzOffsetString());
    return apiRequest(`/admin/transactions?${params.toString()}`, { silent: true });
}

async function fetchAllAdminTransactions({ search = '', from = '', to = '' } = {}) {
    const limit = 200;
    let page = 1;
    let totalPages = 1;
    const all = [];

    while (page <= totalPages) {
        const data = await fetchAdminTransactions({ search, page, limit, from, to });
        if (!data || !Array.isArray(data.transactions)) break;
        all.push(...data.transactions);
        totalPages = Number(data.totalPages || 1);
        page += 1;
    }

    return all;
}

async function fetchAdminTransactionSessions({ search = '', from = '', to = '', page = 1, limit = 200 } = {}) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (from || to) params.set('tzOffset', getClientTzOffsetString());
    return apiRequest(`/admin/transaction-sessions?${params.toString()}`, { silent: true });
}

async function fetchAllAdminTransactionSessions({ search = '', from = '', to = '' } = {}) {
    const limit = 200;
    let page = 1;
    let totalPages = 1;
    const all = [];

    while (page <= totalPages) {
        const data = await fetchAdminTransactionSessions({ search, from, to, page, limit });
        if (!data || !Array.isArray(data.sessions)) break;
        all.push(...data.sessions);
        totalPages = Number(data.totalPages || 1);
        page += 1;
    }

    return all;
}

function escapeCsv(value) {
    const raw = String(value ?? '');
    if (raw === '') return '';
    if (/[",\n]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
}

function downloadCsvFile(filename, rows) {
    const csvContent = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function downloadPdfFile(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function renderPdfStatusWindow(win, title, message) {
    if (!win || win.closed) return;
    const safeTitle = escapeHtml(title || 'PDF Export');
    const safeMessage = escapeHtml(message || '');
    try {
        win.document.open();
        win.document.write(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>${safeTitle}</title>
            <style>
                body { font-family: "Poppins", Arial, sans-serif; padding: 24px; color: #111827; }
                h1 { font-size: 18px; margin: 0 0 6px; }
                .meta { font-size: 12px; color: #6b7280; }
            </style>
        </head>
        <body>
            <h1>${safeTitle}</h1>
            <div class="meta">${safeMessage}</div>
        </body>
        </html>
    `);
        win.document.close();
        win.document.title = title;
    } catch (error) {
        console.error('Failed to update PDF window:', error);
    }
}

function openPdfLoadingWindow(title) {
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) return null;
    renderPdfStatusWindow(win, title, 'Preparing PDF export...');
    return win;
}

function printHtmlInIframe(html) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!doc) {
        iframe.remove();
        return false;
    }

    const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    win.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, 60000);

    doc.open();
    doc.write(html);
    doc.close();
    return true;
}

function openPrintWindow(html, title, options = {}) {
    const preopenedWindow = options.preopenedWindow || null;
    if (preopenedWindow && preopenedWindow.closed) {
        if (printHtmlInIframe(html)) return;
        showNotification('PDF window was closed before export finished.', 'error');
        return;
    }
    if (!preopenedWindow && printHtmlInIframe(html)) {
        return;
    }
    const win = preopenedWindow || window.open('', '_blank', 'noopener,noreferrer');
    if (!win) {
        showNotification('Popup blocked. Please allow popups for PDF export.', 'error');
        return;
    }
    try {
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.document.title = title;
        win.focus();
    } catch (error) {
        console.error('Failed to render PDF window:', error);
        showNotification('Failed to open PDF window.', 'error');
    }
}

function buildPdfHtml({ title, generatedAt, rows }) {
    const headerRow = `
        <tr>
            <th>Borrower</th>
            <th>Key</th>
            <th>Locker</th>
            <th>Action</th>
            <th>Date Borrowed</th>
            <th>Time Borrowed</th>
            <th>Date Returned</th>
            <th>Time Returned</th>
        </tr>
    `;

    const bodyRows = rows.map((row) => `
        <tr>
            <td>${escapeHtml(row.borrower)}</td>
            <td>${escapeHtml(row.keyId)}</td>
            <td>${escapeHtml(row.locker)}</td>
            <td>${escapeHtml(row.actionLabel)}</td>
            <td>${escapeHtml(row.dateBorrowed)}</td>
            <td>${escapeHtml(row.timeBorrowed)}</td>
            <td>${escapeHtml(row.dateReturned)}</td>
            <td>${escapeHtml(row.timeReturned)}</td>
        </tr>
    `).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(title)}</title>
            <style>
                body { font-family: "Poppins", Arial, sans-serif; padding: 24px; color: #111827; }
                h1 { font-size: 18px; margin: 0 0 6px; }
                .meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
                th { background: #f3f4f6; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.4px; }
                tr:nth-child(even) td { background: #fafafa; }
                @media print {
                    body { padding: 0; }
                    table { font-size: 11px; }
                }
            </style>
        </head>
        <body>
            <h1>${escapeHtml(title)}</h1>
            <div class="meta">Generated: ${escapeHtml(generatedAt)}</div>
            <table>
                <thead>${headerRow}</thead>
                <tbody>${bodyRows}</tbody>
            </table>
            <script>
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        try { window.print(); } catch (err) { /* ignore */ }
                    }, 250);
                });
            </script>
        </body>
        </html>
    `;
}

const PDF_EXPORT_COLUMNS = [
    { key: 'borrower', label: 'Borrower', width: 18 },
    { key: 'keyId', label: 'Key', width: 8 },
    { key: 'locker', label: 'Locker', width: 9 },
    { key: 'actionLabel', label: 'Action', width: 12 },
    { key: 'dateBorrowed', label: 'Date Borrowed', width: 12 },
    { key: 'timeBorrowed', label: 'Time Borrowed', width: 8 },
    { key: 'dateReturned', label: 'Date Returned', width: 12 },
    { key: 'timeReturned', label: 'Time Returned', width: 8 }
];

function normalizePdfCell(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function fitPdfCell(value, width) {
    let text = normalizePdfCell(value);
    if (text.length > width) {
        text = width > 3 ? `${text.slice(0, width - 3)}...` : text.slice(0, width);
    }
    return text.padEnd(width, ' ');
}

function buildPdfHeaderLine() {
    return PDF_EXPORT_COLUMNS.map((col) => fitPdfCell(col.label, col.width)).join(' ');
}

function buildPdfRowLine(row) {
    return PDF_EXPORT_COLUMNS.map((col) => fitPdfCell(row[col.key], col.width)).join(' ');
}

function escapePdfText(value) {
    return String(value ?? '')
        .replace(/[^\x20-\x7E]/g, '?')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function buildPdfPages({ title, generatedAt, rows }) {
    const headerLine = buildPdfHeaderLine();
    const separatorLine = '-'.repeat(headerLine.length);
    const rowLines = rows.map(buildPdfRowLine);

    const lineHeight = 11;
    const pageHeight = 792;
    const topMargin = 48;
    const bottomMargin = 48;
    const maxLinesPerPage = Math.max(10, Math.floor((pageHeight - topMargin - bottomMargin) / lineHeight));

    const firstHeader = [title, `Generated: ${generatedAt}`, '', headerLine, separatorLine];
    const nextHeader = [`${title} (continued)`, '', headerLine, separatorLine];

    const pages = [];
    let current = [];
    let isFirst = true;

    const startPage = () => {
        current = isFirst ? [...firstHeader] : [...nextHeader];
    };

    startPage();
    rowLines.forEach((line) => {
        if (current.length + 1 > maxLinesPerPage) {
            pages.push(current);
            isFirst = false;
            startPage();
        }
        current.push(line);
    });

    pages.push(current);
    return pages;
}

function buildPdfContentStream(lines) {
    const fontSize = 9;
    const lineHeight = 11;
    const startX = 40;
    const startY = 792 - 48;
    const content = [
        'BT',
        `/F1 ${fontSize} Tf`,
        `${lineHeight} TL`,
        `${startX} ${startY} Td`
    ];

    lines.forEach((line) => {
        content.push(`(${escapePdfText(line)}) Tj`);
        content.push('T*');
    });

    content.push('ET');
    return content.join('\n');
}

function buildPdfBlob({ title, generatedAt, rows }) {
    const pages = buildPdfPages({ title, generatedAt, rows });
    const contentStreams = pages.map(buildPdfContentStream);
    const pageCount = contentStreams.length;
    const fontObjId = 3;
    const pageStartId = 4;
    const objMap = new Map();

    const pageIds = [];
    contentStreams.forEach((stream, index) => {
        const pageObjId = pageStartId + index * 2;
        const contentObjId = pageObjId + 1;
        pageIds.push(pageObjId);
        objMap.set(pageObjId, `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`);
        objMap.set(contentObjId, `${contentObjId} 0 obj\n<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream\nendobj\n`);
    });

    objMap.set(1, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objMap.set(2, `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`);
    objMap.set(fontObjId, `${fontObjId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`);

    const maxId = Math.max(...objMap.keys());
    const encoder = new TextEncoder();
    const byteLen = (text) => encoder.encode(text).length;
    let pdf = '%PDF-1.4\n';
    const offsets = new Array(maxId + 1).fill(0);

    for (let id = 1; id <= maxId; id += 1) {
        const obj = objMap.get(id);
        if (!obj) continue;
        offsets[id] = byteLen(pdf);
        pdf += obj;
    }

    const xrefOffset = byteLen(pdf);
    let xref = `xref\n0 ${maxId + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (let id = 1; id <= maxId; id += 1) {
        xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    pdf += xref + trailer;
    return new Blob([pdf], { type: 'application/pdf' });
}

async function exportRecentActivity(format) {
    const { search, from, to } = getRecentActivityFilters();
    const excelBtn = elements.recentActivityExportExcelBtn;
    const pdfBtn = elements.recentActivityExportPdfBtn;
    const activeBtn = format === 'excel' ? excelBtn : pdfBtn;

    if (activeBtn) {
        activeBtn.disabled = true;
        activeBtn.textContent = 'Exporting...';
    }

    try {
        const sessions = await fetchAllAdminTransactionSessions({ search, from, to });
        if (!sessions.length) {
            showNotification('No activity logs to export.', 'info');
            return;
        }

        const rows = sessions.map(normalizeTransactionSessionRow);
        const dateLabel = formatDateTime(new Date());
        const baseName = `recent-activity-${new Date().toISOString().slice(0, 10)}`;

        if (format === 'excel') {
            const header = ['Borrower', 'Key', 'Locker', 'Action', 'Date Borrowed', 'Time Borrowed', 'Date Returned', 'Time Returned'];
            const csvRows = [header, ...rows.map((row) => [
                row.borrower,
                row.keyId,
                row.locker,
                row.actionLabel,
                row.dateBorrowed,
                row.timeBorrowed,
                row.dateReturned,
                row.timeReturned
            ])];
            downloadCsvFile(`${baseName}.csv`, csvRows);
            showNotification('Excel export ready.', 'success');
        } else {
            const pdfBlob = buildPdfBlob({
                title: 'Recent Activity Logs',
                generatedAt: dateLabel,
                rows
            });
            downloadPdfFile(`${baseName}.pdf`, pdfBlob);
            showNotification('PDF download ready.', 'success');
        }
    } catch (error) {
        console.error('Export recent activity error:', error);
        showNotification(error?.message || 'Failed to export activity logs', 'error');
    } finally {
        if (activeBtn) {
            activeBtn.disabled = false;
            activeBtn.textContent = format === 'excel' ? 'Export Excel' : 'Export PDF';
        }
    }
}

async function copyTextToClipboard(text) {
    const value = String(text ?? '');
    if (!value) return false;
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        try {
            const temp = document.createElement('textarea');
            temp.value = value;
            temp.setAttribute('readonly', '');
            temp.style.position = 'fixed';
            temp.style.top = '-9999px';
            temp.style.left = '-9999px';
            document.body.appendChild(temp);
            temp.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(temp);
            return Boolean(ok);
        } catch {
            return false;
        }
    }
}

function shouldRedactKey(key) {
    const k = String(key || '').toLowerCase();
    if (!k) return false;
    return k.includes('password')
        || k.includes('token')
        || k.includes('secret')
        || k.includes('verificationcode')
        || k.includes('hash');
}

function isHugeDataUrl(value) {
    const text = typeof value === 'string' ? value : '';
    return text.startsWith('data:image/') && text.length > 240;
}

function sanitizeRecordForDisplay(value, depth = 0) {
    if (depth > 7) return '[Max depth reached]';
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        const limited = value.slice(0, 120);
        return limited.map((entry) => sanitizeRecordForDisplay(entry, depth + 1));
    }

    if (typeof value === 'object') {
        const out = {};
        Object.entries(value).forEach(([key, entry]) => {
            if (shouldRedactKey(key)) {
                out[key] = '[REDACTED]';
                return;
            }
            if (isHugeDataUrl(entry)) {
                out[key] = `[data:image omitted: ${String(entry).length} chars]`;
                return;
            }
            out[key] = sanitizeRecordForDisplay(entry, depth + 1);
        });
        return out;
    }

    if (typeof value === 'string' && value.length > 4000) {
        return `${value.slice(0, 4000)}…`;
    }

    return value;
}

function setDbHint(text) {
    if (!elements.dbHint) return;
    const msg = String(text || '').trim();
    elements.dbHint.textContent = msg;
    elements.dbHint.style.display = msg ? '' : 'none';
}

function getDbExportMode() {
    const raw = String(elements.dbExportModeSelect?.value || 'page').trim().toLowerCase();
    return raw === 'range' || raw === 'all' ? raw : 'page';
}

function updateDbExportControlState() {
    const actions = elements.dbExportBtn?.closest('.db-actions');
    const mode = getDbExportMode();
    if (actions) {
        actions.classList.toggle('is-page-mode', mode === 'page');
        actions.classList.toggle('is-range-mode', mode === 'range');
        actions.classList.toggle('is-all-mode', mode === 'all');
    }

    if (elements.dbExportPageInput) {
        elements.dbExportPageInput.disabled = mode !== 'page';
        if (mode === 'page' && !String(elements.dbExportPageInput.value || '').trim()) {
            elements.dbExportPageInput.value = String(Math.max(1, Number(dbExplorerState.page || 1)));
        }
    }
    if (elements.dbExportRangeInput) {
        elements.dbExportRangeInput.disabled = mode !== 'range';
    }
}

function updateDbExportScopeHint() {
    if (!elements.dbExportScopeHint) return;

    const total = Number(dbExplorerState.total || 0);
    const start = Number(dbExplorerState.currentStartIndex || 0);
    const end = Number(dbExplorerState.currentEndIndex || 0);
    const page = Number(dbExplorerState.page || 1);
    const totalPages = Number(dbExplorerState.totalPages || 1);
    const mode = getDbExportMode();

    const visiblePart = total > 0 && start > 0 && end > 0
        ? `Showing rows ${start}-${end} of ${total}.`
        : 'No rows loaded yet.';

    const pagePart = total > 0
        ? ` Current page: ${page} of ${Math.max(1, totalPages)}.`
        : '';

    const modePart = mode === 'page'
        ? ' Export will use the selected page only.'
        : mode === 'range'
            ? ' Export will use only the row range you enter, like <code>1-60</code>.'
            : ' Export will include all rows matching the current filters.';

    elements.dbExportScopeHint.innerHTML = `${escapeHtml(visiblePart + pagePart)}${modePart}`;
}

function setDbPagination({ page, totalPages, total }) {
    const p = Number.isFinite(Number(page)) ? Math.max(1, Math.trunc(Number(page))) : 1;
    const tp = Number.isFinite(Number(totalPages)) ? Math.max(1, Math.trunc(Number(totalPages))) : 1;
    const t = Number.isFinite(Number(total)) ? Math.max(0, Math.trunc(Number(total))) : 0;
    const limit = Number.isFinite(Number(dbExplorerState.limit)) ? Math.max(1, Math.trunc(Number(dbExplorerState.limit))) : DB_EXPLORER_LIMIT;
    const start = t === 0 ? 0 : ((p - 1) * limit) + 1;
    const end = t === 0 ? 0 : Math.min(t, p * limit);

    dbExplorerState.currentStartIndex = start;
    dbExplorerState.currentEndIndex = end;

    if (elements.dbExportPageMeta) {
        elements.dbExportPageMeta.textContent = `of ${tp} page${tp === 1 ? '' : 's'}`;
    }
    if (elements.dbExportPageInput && (!String(elements.dbExportPageInput.value || '').trim() || document.activeElement !== elements.dbExportPageInput)) {
        elements.dbExportPageInput.value = String(p);
    }

    if (elements.dbPageInfo) {
        if (t === 0) {
            elements.dbPageInfo.textContent = 'Total: 0';
        } else {
            elements.dbPageInfo.textContent = tp <= 1
                ? `Rows ${start}-${end} of ${t}`
                : `Rows ${start}-${end} of ${t} • Page ${p} of ${tp}`;
        }
    }

    if (elements.dbPrevPageBtn) {
        elements.dbPrevPageBtn.disabled = p <= 1;
    }
    if (elements.dbNextPageBtn) {
        elements.dbNextPageBtn.disabled = p >= tp;
    }

    updateDbExportControlState();
    updateDbExportScopeHint();
}

function getDbStatusOptions(collection) {
    switch (String(collection || '').trim()) {
        case 'transactions':
            return [
                { value: 'all', label: 'All actions' },
                { value: 'borrow', label: 'Borrow' },
                { value: 'return', label: 'Return' }
            ];
        case 'keys':
            return [
                { value: 'all', label: 'All status' },
                { value: 'available', label: 'Available' },
                { value: 'borrowed', label: 'Borrowed' },
                { value: 'lost', label: 'Lost' }
            ];
        case 'qrcodes':
            return [
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'used', label: 'Used' }
            ];
        case 'announcements':
            return [
                { value: 'all', label: 'All' },
                { value: 'notification', label: 'Notifications' },
                { value: 'popup', label: 'Popups' }
            ];
        case 'feedback':
            return [
                { value: 'all', label: 'All' },
                { value: 'new', label: 'New' },
                { value: 'read', label: 'Read' }
            ];
        case 'lostreports':
            return [
                { value: 'all', label: 'All' },
                { value: 'pending', label: 'Pending' },
                { value: 'resolved', label: 'Resolved' }
            ];
        case 'logs':
            return [
                { value: 'all', label: 'All' },
                { value: 'profile_photo', label: 'Profile Photo' }
            ];
        case 'users':
            return [
                { value: 'all', label: 'All' },
                { value: 'approved', label: 'Approved' },
                { value: 'pending', label: 'Pending' },
                { value: 'rejected', label: 'Rejected' }
            ];
        case 'admins':
            return [
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' }
            ];
        default:
            return [{ value: 'all', label: 'All' }];
    }
}

function configureDbFiltersForCollection(collection) {
    const statusSelect = elements.dbStatusSelect;
    if (!statusSelect) return;

    const options = getDbStatusOptions(collection);
    statusSelect.innerHTML = '';
    options.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        statusSelect.appendChild(option);
    });

    const wanted = String(dbExplorerState.status || 'all');
    const allowed = new Set(options.map((o) => o.value));
    dbExplorerState.status = allowed.has(wanted) ? wanted : 'all';
    statusSelect.value = dbExplorerState.status;

    const hint = (() => {
        switch (collection) {
            case 'transactions':
                return 'Tip: Search by key ID, locker, action, or user email/name. Date From/To filters use the exact transaction date.';
            case 'qrcodes':
                return 'Tip: “Used” means scanned recently; “Active” means valid but not recently scanned.';
            case 'logs':
                return 'Tip: Activity logs are limited to the newest rows. Date From/To filters use the log timestamp.';
            case 'announcements':
                return 'Tip: JSON view hides base64 image data.';
            case 'lostreports':
                return 'Tip: Lost reports are submitted by teachers and appear in activity logs.';
            default:
                return '';
        }
    })();
    setDbHint(hint);
}

function setDbTableLoading(colCount = 1) {
    if (!elements.dbTableHead || !elements.dbTableBody) return;
    dbExplorerState.viewRows = [];
    dbExplorerState.currentStartIndex = 0;
    dbExplorerState.currentEndIndex = 0;
    elements.dbTableHead.innerHTML = '<tr><th>Loading…</th></tr>';
    elements.dbTableBody.innerHTML = `
        <tr>
            <td colspan="${Math.max(1, Number(colCount) || 1)}">
                <div class="spinner"></div>
            </td>
        </tr>
    `;
    updateDbExportControlState();
    updateDbExportScopeHint();
}

function getDbColumns(collection) {
    switch (collection) {
        case 'transactions':
            return [
                { label: 'Date', value: (t) => formatDateTime(t?.performedAt || t?.createdAt) },
                { label: 'Action', value: (t) => String(t?.action || '').trim() || '—' },
                { label: 'Key', value: (t) => String(t?.keyId || '').trim() || '—' },
                { label: 'Locker', value: (t) => String(t?.locker || '').trim() || deriveLockerFromKeyId(t?.keyId) || '—' },
                {
                    label: 'User',
                    value: (t) => {
                        const u = t?.userId || {};
                        const name = `${String(u.firstName || '').trim()} ${String(u.lastName || '').trim()}`.trim();
                        return name || String(u.email || '').trim() || '—';
                    }
                },
                { label: 'Method', value: (t) => String(t?.scannedBy || '').trim() || 'qr' }
            ];
        case 'keys':
            return [
                { label: 'Key ID', value: (k) => String(k?.keyId || '').trim() || '—' },
                { label: 'Locker', value: (k) => String(k?.locker ?? '').trim() || deriveLockerFromKeyId(k?.keyId) || 'Unassigned' },
                { label: 'Room', value: (k) => String(k?.room || '').trim() || '—' },
                { label: 'Building', value: (k) => String(k?.building || '').trim() || '—' },
                { label: 'Status', value: (k) => String(k?.status || '').trim() || '—' },
                { label: 'Updated', value: (k) => formatDateTime(k?.updatedAt) }
            ];
        case 'lockers':
            return [
                { label: 'Name', value: (l) => String(l?.name || '').trim() || '—' },
                { label: 'Created', value: (l) => formatDateTime(l?.createdAt) }
            ];
        case 'users':
            return [
                { label: 'Name', value: (u) => `${String(u?.firstName || '').trim()} ${String(u?.lastName || '').trim()}`.trim() || '—' },
                { label: 'Email', value: (u) => String(u?.email || '').trim() || '—' },
                { label: 'Approval', value: (u) => String(u?.approvalStatus || 'approved').trim() || '—' },
                { label: 'Active', value: (u) => (u?.isActive === false ? 'inactive' : 'active') },
                { label: 'Last Login', value: (u) => formatDateTime(u?.lastLogin) },
                { label: 'Created', value: (u) => formatDateTime(u?.createdAt) }
            ];
        case 'admins':
            return [
                { label: 'Username', value: (a) => String(a?.username || '').trim() || '—' },
                { label: 'Name', value: (a) => String(a?.fullName || '').trim() || '—' },
                { label: 'Email', value: (a) => String(a?.email || '').trim() || '—' },
                { label: 'Role', value: (a) => String(a?.role || '').trim() || 'admin' },
                { label: 'Active', value: (a) => (a?.isActive === false ? 'inactive' : 'active') },
                { label: 'Last Login', value: (a) => formatDateTime(a?.lastLogin) }
            ];
        case 'qrcodes':
            return [
                { label: 'Key', value: (q) => String(q?.keyId || '').trim() || '—' },
                { label: 'Room', value: (q) => String(q?.room || '').trim() || '—' },
                { label: 'Mode', value: () => 'Borrow/Return (single QR)' },
                { label: 'Status', value: (q) => String(q?.status || '').trim() || '—' },
                { label: 'Last Used', value: (q) => formatDateTime(q?.usedAt) },
                { label: 'Generated By', value: (q) => String(q?.generatedBy?.username || '').trim() || '—' }
            ];
        case 'announcements':
            return [
                { label: 'Type', value: (a) => String(a?.type || '').trim() || '—' },
                { label: 'Title', value: (a) => String(a?.title || '').trim() || '—' },
                { label: 'From', value: (a) => String(a?.createdByName || '').trim() || '—' },
                { label: 'Active', value: (a) => (a?.active === false ? 'no' : 'yes') },
                { label: 'Created', value: (a) => formatDateTime(a?.createdAt) }
            ];
        case 'feedback':
            return [
                { label: 'Email', value: (f) => (f?.anonymous ? 'anonymous' : (String(f?.email || '').trim() || '—')) },
                { label: 'Read', value: (f) => (f?.isRead ? 'yes' : 'no') },
                { label: 'Message', value: (f) => truncateText(f?.message || '', 120) || '—' },
                { label: 'Created', value: (f) => formatDateTime(f?.createdAt) }
            ];
        case 'lostreports':
            return [
                { label: 'Date', value: (r) => formatDateTime(r?.createdAt) },
                { label: 'Key', value: (r) => String(r?.keyId || '').trim() || '—' },
                { label: 'Room', value: (r) => String(r?.room || '').trim() || '—' },
                { label: 'Locker', value: (r) => String(r?.locker ?? '').trim() || deriveLockerFromKeyId(r?.keyId) || 'Unassigned' },
                { label: 'Reporter', value: (r) => String(r?.reportedByEmail || '').trim() || '—' },
                {
                    label: 'Status',
                    value: (r) => {
                        const raw = String(r?.status || '').trim().toLowerCase();
                        const normalized = raw === 'resolved' ? 'resolved' : (raw === 'open' ? 'pending' : raw);
                        return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : '—';
                    }
                },
                { label: 'Resolved', value: (r) => (r?.resolvedAt ? formatDateTime(r?.resolvedAt) : '—') },
                { label: 'Read', value: (r) => (r?.adminReadAt ? 'yes' : 'no') },
                { label: 'Reply', value: (r) => truncateText(r?.adminReply || '', 90) || '—' },
                { label: 'Message', value: (r) => truncateText(r?.message || '', 90) || '—' }
            ];
        case 'logs':
            return [
                { label: 'Time', value: (l) => formatDateTime(l?.createdAt) },
                { label: 'Actor', value: (l) => String(l?.actorName || '').trim() || '—' },
                { label: 'Action', value: (l) => String(l?.action || '').trim() || '—' },
                { label: 'Target', value: (l) => String(l?.targetName || '').trim() || '—' }
            ];
        default:
            return [{ label: 'Value', value: (r) => JSON.stringify(r) }];
    }
}

function renderDbTable(collection, rows) {
    if (!elements.dbTableHead || !elements.dbTableBody) return;

    const columns = getDbColumns(collection);
    const headerCells = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('') + '<th>View</th>';
    elements.dbTableHead.innerHTML = `<tr>${headerCells}</tr>`;

    const items = Array.isArray(rows) ? rows : [];
    dbExplorerState.viewRows = items;

    if (items.length === 0) {
        elements.dbTableBody.innerHTML = `
            <tr>
                <td colspan="${columns.length + 1}" class="text-center text-muted">No records found.</td>
            </tr>
        `;
        return;
    }

    const bodyHtml = items
        .map((row, idx) => {
            const tds = columns
                .map((col) => `<td>${escapeHtml(col.value(row))}</td>`)
                .join('');
            return `
                <tr>
                    ${tds}
                    <td>
                        <button type="button" class="btn btn-small btn-secondary" data-db-view-index="${idx}">View</button>
                    </td>
                </tr>
            `;
        })
        .join('');

    elements.dbTableBody.innerHTML = bodyHtml;
}

let dbLastJsonText = '';

function showDbJson(record, { title = 'Record' } = {}) {
    if (!elements.dbJsonModal || !elements.dbJsonPre) return;

    const safe = sanitizeRecordForDisplay(record);
    dbLastJsonText = JSON.stringify(safe, null, 2);

    const titleEl = elements.dbJsonModal.querySelector('.modal-header h3');
    if (titleEl) titleEl.textContent = title;

    elements.dbJsonPre.textContent = dbLastJsonText;
    showModal(elements.dbJsonModal);
}

function downloadTextFile({ filename, text, mime = 'text/plain;charset=utf-8' }) {
    const blob = new Blob([String(text ?? '')], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function buildDbExportFilterParams({ page, limit } = {}) {
    const params = new URLSearchParams();
    const search = String(dbExplorerState.search || '').trim();
    const dateFrom = String(dbExplorerState.dateFrom || '').trim();
    const dateTo = String(dbExplorerState.dateTo || '').trim();
    const status = String(dbExplorerState.status || 'all').trim().toLowerCase();

    if (Number.isFinite(Number(page)) && Number(page) > 0) params.set('page', String(Math.trunc(Number(page))));
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.trunc(Number(limit))));
    if (search) params.set('search', search);
    if ((dbExplorerState.collection === 'transactions' || dbExplorerState.collection === 'logs') && (dateFrom || dateTo)) {
        if (dateFrom) params.set('from', dateFrom);
        if (dateTo) params.set('to', dateTo);
        params.set('tzOffset', getClientTzOffsetString());
    }
    if (status && status !== 'all') {
        if (dbExplorerState.collection === 'transactions') params.set('action', status);
        else if (dbExplorerState.collection === 'qrcodes') params.set('status', status);
        else if (dbExplorerState.collection === 'feedback') params.set('status', status);
        else if (dbExplorerState.collection === 'lostreports') params.set('status', status);
        else if (dbExplorerState.collection === 'logs') params.set('category', status);
        else if (dbExplorerState.collection === 'announcements') params.set('type', status);
    }

    return params;
}

async function fetchAllPagedApiRows({ endpoint, listKey, baseParams = null, pageSize = 200, maxPages = 1000 }) {
    const rows = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= maxPages) {
        const params = baseParams ? new URLSearchParams(baseParams) : new URLSearchParams();
        params.set('page', String(page));
        params.set('limit', String(pageSize));

        const data = await apiRequest(`${endpoint}?${params.toString()}`, { silent: true });
        const batch = Array.isArray(data?.[listKey]) ? data[listKey] : [];
        rows.push(...batch);

        const reportedPages = Number(data?.totalPages || 0);
        totalPages = reportedPages > 0 ? reportedPages : (batch.length < pageSize ? page : page + 1);

        if (batch.length === 0) break;
        page += 1;
    }

    return rows;
}

async function getDbFilteredRowsForExport({ forceRefresh = false } = {}) {
    const collection = String(dbExplorerState.collection || '').trim() || 'transactions';
    const search = String(dbExplorerState.search || '').trim();
    const status = String(dbExplorerState.status || 'all').trim().toLowerCase();

    if (collection === 'transactions') {
        return fetchAllPagedApiRows({
            endpoint: '/admin/transactions',
            listKey: 'transactions',
            baseParams: buildDbExportFilterParams(),
            pageSize: 200
        });
    }

    if (collection === 'qrcodes') {
        const params = buildDbExportFilterParams();
        params.set('mode', 'raw');
        return fetchAllPagedApiRows({
            endpoint: '/admin/qrcodes',
            listKey: 'qrcodes',
            baseParams: params,
            pageSize: 500
        });
    }

    if (collection === 'lostreports') {
        return fetchAllPagedApiRows({
            endpoint: '/admin/lost-reports',
            listKey: 'reports',
            baseParams: buildDbExportFilterParams(),
            pageSize: 200
        });
    }

    if (collection === 'feedback') {
        return fetchAllPagedApiRows({
            endpoint: '/admin/feedback',
            listKey: 'feedback',
            baseParams: buildDbExportFilterParams(),
            pageSize: 500
        });
    }

    if (collection === 'logs') {
        return fetchAllPagedApiRows({
            endpoint: '/admin/logs',
            listKey: 'logs',
            baseParams: buildDbExportFilterParams(),
            pageSize: 500
        });
    }

    if (collection === 'announcements') {
        return fetchAllPagedApiRows({
            endpoint: '/admin/announcements',
            listKey: 'announcements',
            baseParams: buildDbExportFilterParams(),
            pageSize: 500
        });
    }

    if (collection === 'keys') {
        if (!dbExplorerState.localRows || dbExplorerState.localCollection !== collection || forceRefresh) {
            const data = await apiRequest('/admin/keys', { silent: true });
            dbExplorerState.localRows = Array.isArray(data?.keys) ? data.keys : [];
            dbExplorerState.localCollection = collection;
        }
        let items = Array.isArray(dbExplorerState.localRows) ? dbExplorerState.localRows.slice() : [];
        if (search) {
            items = items.filter((k) => matchesText(`${k?.keyId || ''} ${k?.locker || ''} ${k?.room || ''} ${k?.building || ''} ${k?.status || ''}`, search));
        }
        if (status && status !== 'all') {
            items = items.filter((k) => String(k?.status || '').toLowerCase() === status);
        }
        return items;
    }

    if (collection === 'lockers') {
        if (!dbExplorerState.localRows || dbExplorerState.localCollection !== collection || forceRefresh) {
            const data = await apiRequest('/lockers', { silent: true });
            dbExplorerState.localRows = Array.isArray(data?.lockers) ? data.lockers : [];
            dbExplorerState.localCollection = collection;
        }
        let items = Array.isArray(dbExplorerState.localRows) ? dbExplorerState.localRows.slice() : [];
        if (search) {
            items = items.filter((l) => matchesText(l?.name || '', search));
        }
        return items;
    }

    if (collection === 'users') {
        const qs = new URLSearchParams();
        if (search) qs.set('search', search);
        qs.set('includeInactive', 'true');
        const data = await apiRequest(`/admin/users?${qs.toString()}`, { silent: true });
        let items = Array.isArray(data?.users) ? data.users : [];
        if (status && status !== 'all') {
            items = items.filter((u) => String(u?.approvalStatus || 'approved').trim().toLowerCase() === status);
        }
        if (search) {
            items = items.filter((u) => matchesText(`${u?.firstName || ''} ${u?.lastName || ''} ${u?.email || ''}`, search));
        }
        return items;
    }

    if (collection === 'admins') {
        if (!canCurrentAdminManageAdmins()) return [];
        const qs = new URLSearchParams();
        if (search) qs.set('search', search);
        qs.set('includeInactive', 'true');
        const data = await apiRequest(`/admin/admins?${qs.toString()}`, { silent: true });
        let items = Array.isArray(data?.admins) ? data.admins : [];
        if (status === 'active') items = items.filter((a) => a?.isActive !== false);
        if (status === 'inactive') items = items.filter((a) => a?.isActive === false);
        return items;
    }

    return Array.isArray(dbExplorerState.viewRows) ? dbExplorerState.viewRows.slice() : [];
}

function parseDbRowRangeScope(rawValue, { total }) {
    const raw = String(rawValue || '').trim().toLowerCase();
    const safeTotal = Math.max(0, Number(total || 0));

    if (safeTotal <= 0) {
        throw new Error('No rows available for export.');
    }

    const rangeMatch = /^(\d+)\s*(?:-|to)\s*(\d+)$/i.exec(raw);
    if (rangeMatch) {
        let start = Math.max(1, Number(rangeMatch[1]));
        let end = Math.max(1, Number(rangeMatch[2]));
        if (start > end) [start, end] = [end, start];
        if (end > safeTotal) {
            throw new Error(`Only ${safeTotal} row(s) match the current filters.`);
        }
        return { mode: 'range', start, end, label: `${start}-${end}` };
    }

    const singleRowMatch = /^(?:row\s*)?(\d+)$/i.exec(raw);
    if (singleRowMatch) {
        const rowNumber = Math.max(1, Number(singleRowMatch[1]));
        if (rowNumber > safeTotal) {
            throw new Error(`Only ${safeTotal} row(s) match the current filters.`);
        }
        return { mode: 'range', start: rowNumber, end: rowNumber, label: `row-${rowNumber}` };
    }

    throw new Error('Enter a valid row range like 1-60.');
}

function resolveDbExportScope({ total, currentPage, totalPages, pageSize }) {
    const safeTotal = Math.max(0, Number(total || 0));
    const safeCurrentPage = Math.max(1, Number(currentPage || 1));
    const safeTotalPages = Math.max(1, Number(totalPages || 1));
    const safePageSize = Math.max(1, Number(pageSize || DB_EXPLORER_LIMIT));
    const mode = getDbExportMode();

    if (safeTotal <= 0) {
        throw new Error('No rows available for export.');
    }

    if (mode === 'all') {
        return { mode: 'range', start: 1, end: safeTotal, label: 'all' };
    }

    if (mode === 'range') {
        return parseDbRowRangeScope(elements.dbExportRangeInput?.value || '', { total: safeTotal });
    }

    const rawPage = String(elements.dbExportPageInput?.value || '').trim();
    const page = rawPage ? Math.max(1, Number(rawPage)) : safeCurrentPage;
    if (!Number.isFinite(page) || page < 1) {
        throw new Error('Enter a valid page number.');
    }
    if (page > safeTotalPages) {
        throw new Error(`Only ${safeTotalPages} page(s) are available right now.`);
    }

    return {
        mode: 'page',
        page,
        start: ((page - 1) * safePageSize) + 1,
        end: Math.min(safeTotal, page * safePageSize),
        label: `page-${page}`
    };
}

async function exportDbCurrentViewToCsv() {
    const button = elements.dbExportBtn;
    const originalLabel = button?.textContent || 'Export CSV';

    if (button) {
        button.disabled = true;
        button.textContent = 'Exporting...';
    }

    try {
        const collection = String(dbExplorerState.collection || '').trim() || 'export';
        const columns = getDbColumns(collection);
        const allRows = await getDbFilteredRowsForExport();

        if (!allRows.length) {
            showNotification('No rows to export.', 'error');
            return;
        }

        const scope = resolveDbExportScope({
            total: allRows.length,
            currentPage: dbExplorerState.page,
            totalPages: Math.max(1, Math.ceil(allRows.length / Math.max(1, Number(dbExplorerState.limit || DB_EXPLORER_LIMIT)))),
            pageSize: dbExplorerState.limit || DB_EXPLORER_LIMIT
        });

        const exportRows = allRows.slice(scope.start - 1, scope.end);
        if (!exportRows.length) {
            throw new Error('The selected export scope has no rows.');
        }

        const escapeCsv = (value) => {
            const raw = String(value ?? '');
            const needsQuotes = /[",\n\r]/.test(raw);
            const safe = raw.replace(/"/g, '""');
            return needsQuotes ? `"${safe}"` : safe;
        };

        const header = columns.map((c) => escapeCsv(c.label)).join(',');
        const lines = exportRows.map((row) => columns.map((c) => escapeCsv(c.value(row))).join(','));
        const csv = [header, ...lines].join('\r\n');

        const stamp = new Date();
        const yyyy = stamp.getFullYear();
        const mm = String(stamp.getMonth() + 1).padStart(2, '0');
        const dd = String(stamp.getDate()).padStart(2, '0');
        const filename = `database_${collection}_${scope.label}_${yyyy}${mm}${dd}.csv`;
        downloadTextFile({ filename, text: `\uFEFF${csv}`, mime: 'text/csv;charset=utf-8' });
        showNotification(`CSV exported for rows ${scope.start}-${scope.end}.`, 'success');
    } catch (error) {
        console.error('Database CSV export error:', error);
        showNotification(error?.message || 'Failed to export CSV.', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }
}

async function loadDatabaseSummary({ silent = false } = {}) {
    try {
        const qs = new URLSearchParams();
        qs.set('tzOffset', getClientTzOffsetString());
        const data = await apiRequest(`/admin/database/summary?${qs.toString()}`, { silent: true });
        if (!data || !data.success) return;

        const counts = data.counts || {};
        const users = counts.users || {};
        const admins = counts.admins || {};
        const keys = counts.keys || {};
        const lockers = counts.lockers || {};
        const qrcodes = counts.qrcodes || {};
        const tx = counts.transactions || {};
        const announcements = counts.announcements || {};
        const feedback = counts.feedback || {};
        const lostReports = counts.lostReports || {};

        if (elements.dbUsersTotal) elements.dbUsersTotal.textContent = users.total ?? 0;
        if (elements.dbUsersPending) elements.dbUsersPending.textContent = users.pending ?? 0;
        if (elements.dbAdminsTotal) elements.dbAdminsTotal.textContent = admins.total ?? 0;
        if (elements.dbAdminsActive) elements.dbAdminsActive.textContent = admins.active ?? 0;
        if (elements.dbKeysTotal) elements.dbKeysTotal.textContent = keys.total ?? 0;
        if (elements.dbKeysBorrowed) elements.dbKeysBorrowed.textContent = keys.borrowed ?? 0;
        if (elements.dbLockersTotal) elements.dbLockersTotal.textContent = lockers.total ?? 0;
        if (elements.dbQrTotal) elements.dbQrTotal.textContent = qrcodes.total ?? 0;
        if (elements.dbQrActive) elements.dbQrActive.textContent = qrcodes.active ?? 0;
        if (elements.dbQrUsed) elements.dbQrUsed.textContent = qrcodes.used ?? 0;
        if (elements.dbTransactionsTotal) elements.dbTransactionsTotal.textContent = tx.total ?? 0;
        if (elements.dbTransactions7d) elements.dbTransactions7d.textContent = tx.last7DaysTotal ?? 0;
        if (elements.dbAnnouncementsTotal) elements.dbAnnouncementsTotal.textContent = announcements.total ?? 0;
        if (elements.dbAnnouncementsActive) elements.dbAnnouncementsActive.textContent = announcements.active ?? 0;
        if (elements.dbFeedbackTotal) elements.dbFeedbackTotal.textContent = feedback.total ?? 0;
        if (elements.dbFeedbackUnread) elements.dbFeedbackUnread.textContent = feedback.unread ?? 0;
        if (elements.dbLostReportsTotal) elements.dbLostReportsTotal.textContent = lostReports.total ?? 0;
        const pendingLostReports = lostReports.pending ?? lostReports.open ?? 0;
        if (elements.dbLostReportsOpen) elements.dbLostReportsOpen.textContent = pendingLostReports;
        if (elements.dbLostReportsUnread) elements.dbLostReportsUnread.textContent = lostReports.unread ?? 0;
        if (elements.dbLostReportsResolved) {
            const resolved = lostReports.resolved ?? ((Number(lostReports.total ?? 0) || 0) - (Number(pendingLostReports) || 0));
            elements.dbLostReportsResolved.textContent = Math.max(0, Number(resolved) || 0);
        }

        renderDatabaseCharts(data);
        dbSummaryLastLoadedAt = Date.now();
        if (elements.dbSummaryUpdatedAt) {
            elements.dbSummaryUpdatedAt.textContent = `Updated: ${formatTime(new Date())}`;
        }
    } catch (error) {
        console.error('Database summary error:', error);
        if (!silent) {
            const msg = error?.message === 'Route not found'
                ? 'Database summary API not available. Please restart the server and refresh.'
                : (error?.message || 'Failed to load database summary');
            showNotification(msg, 'error');
        }
    }
}

function renderDatabaseCharts(summary) {
    const counts = summary?.counts || {};

    // Key status chart
    const keyStatus = counts.keys?.status || {};
    const keyStatusLabels = ['available', 'borrowed', 'lost'];
    const keyStatusValues = keyStatusLabels.map((k) => Number(keyStatus?.[k] || 0));
    const keyHasData = keyStatusValues.some((v) => v > 0);

    if (elements.dbKeysStatusChart) {
        clearChartFallback(elements.dbKeysStatusChart);
        if (!keyHasData) {
            if (charts.dbKeysStatus) {
                charts.dbKeysStatus.destroy();
                charts.dbKeysStatus = null;
            }
            clearCanvas(elements.dbKeysStatusChart);
            showChartFallback(elements.dbKeysStatusChart, 'No key data yet.');
        } else if (typeof Chart === 'undefined') {
            drawDonutChart(elements.dbKeysStatusChart, keyStatusValues, ['#28a745', '#dc3545', '#6c757d']);
        } else {
            if (charts.dbKeysStatus) charts.dbKeysStatus.destroy();
            charts.dbKeysStatus = new Chart(elements.dbKeysStatusChart.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: keyStatusLabels.map((l) => l[0].toUpperCase() + l.slice(1)),
                    datasets: [
                        {
                            data: keyStatusValues,
                            backgroundColor: ['#28a745', '#dc3545', '#6c757d'],
                            borderWidth: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
    }

    // User approval chart
    const approval = counts.users?.approval || {};
    const approvalLabels = ['approved', 'pending', 'rejected'];
    const approvalValues = approvalLabels.map((k) => Number(approval?.[k] || 0));
    const approvalHasData = approvalValues.some((v) => v > 0);

    if (elements.dbUserApprovalChart) {
        clearChartFallback(elements.dbUserApprovalChart);
        if (!approvalHasData) {
            if (charts.dbUserApproval) {
                charts.dbUserApproval.destroy();
                charts.dbUserApproval = null;
            }
            clearCanvas(elements.dbUserApprovalChart);
            showChartFallback(elements.dbUserApprovalChart, 'No user data yet.');
        } else if (typeof Chart === 'undefined') {
            drawDonutChart(elements.dbUserApprovalChart, approvalValues, ['#28a745', '#ffc107', '#dc3545']);
        } else {
            if (charts.dbUserApproval) charts.dbUserApproval.destroy();
            charts.dbUserApproval = new Chart(elements.dbUserApprovalChart.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Approved', 'Pending', 'Rejected'],
                    datasets: [
                        {
                            data: approvalValues,
                            backgroundColor: ['#28a745', '#ffc107', '#dc3545'],
                            borderWidth: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
    }

    // QR code status chart
    const qr = counts.qrcodes || {};
    const qrLabels = ['active', 'used'];
    const qrValues = qrLabels.map((k) => Number(qr?.[k] || 0));
    const qrHasData = qrValues.some((v) => v > 0);

    if (elements.dbQrStatusChart) {
        clearChartFallback(elements.dbQrStatusChart);
        if (!qrHasData) {
            if (charts.dbQrStatus) {
                charts.dbQrStatus.destroy();
                charts.dbQrStatus = null;
            }
            clearCanvas(elements.dbQrStatusChart);
            showChartFallback(elements.dbQrStatusChart, 'No QR code data yet.');
        } else if (typeof Chart === 'undefined') {
            drawDonutChart(elements.dbQrStatusChart, qrValues, ['#28a745', '#6c757d']);
        } else {
            if (charts.dbQrStatus) charts.dbQrStatus.destroy();
            charts.dbQrStatus = new Chart(elements.dbQrStatusChart.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Active', 'Used'],
                    datasets: [
                        {
                            data: qrValues,
                            backgroundColor: ['#28a745', '#6c757d'],
                            borderWidth: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });
        }
    }

    // Transactions chart (last 7 days)
    const byDay = Array.isArray(counts.transactions?.byDay) ? counts.transactions.byDay : [];
    const labels = byDay.map((d) => String(d.date || '').slice(5) || '');
    const borrows = byDay.map((d) => Number(d.borrows || 0));
    const returns = byDay.map((d) => Number(d.returns || 0));

    if (elements.dbTransactionsChart) {
        clearChartFallback(elements.dbTransactionsChart);
        // Always draw the chart (even when values are all zero) so the layout stays stable.
        if (typeof Chart === 'undefined') {
            drawLineChart(elements.dbTransactionsChart, labels, [borrows, returns]);
        } else {
            if (charts.dbTransactions) charts.dbTransactions.destroy();
            charts.dbTransactions = new Chart(elements.dbTransactionsChart.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Borrows',
                            data: borrows,
                            borderColor: '#28a745',
                            backgroundColor: 'rgba(40, 167, 69, 0.18)',
                            tension: 0.25,
                            fill: true,
                            pointRadius: 3
                        },
                        {
                            label: 'Returns',
                            data: returns,
                            borderColor: '#dc3545',
                            backgroundColor: 'rgba(220, 53, 69, 0.12)',
                            tension: 0.25,
                            fill: true,
                            pointRadius: 3
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 } }
                    }
                }
            });
        }
    }
}

function getDbSearchValue() {
    return String(elements.dbSearchInput?.value || '').trim();
}

function getDbDateFilterValues() {
    return {
        from: String(elements.dbDateFromInput?.value || '').trim(),
        to: String(elements.dbDateToInput?.value || '').trim()
    };
}

function matchesText(haystack, needle) {
    const h = String(haystack || '').toLowerCase();
    const n = String(needle || '').toLowerCase();
    if (!n) return true;
    return h.includes(n);
}

function paginateArray(items, page, limit) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * limit;
    const slice = items.slice(start, start + limit);
    return { slice, total, totalPages, page: safePage };
}

async function loadDbExplorer({ forceRefresh = false, silent = false } = {}) {
    const collection = String(dbExplorerState.collection || '').trim() || 'transactions';
    const search = String(dbExplorerState.search || '').trim();
    const status = String(dbExplorerState.status || 'all').trim().toLowerCase();
    const limit = Number(dbExplorerState.limit || 50);
    const page = Number(dbExplorerState.page || 1);

    const requestId = ++dbExplorerRequestSeq;
    const showLoading = !silent || dbExplorerLastLoadedAt === 0;

    if (showLoading) {
        setDbTableLoading();
        setDbPagination({ page, totalPages: 1, total: 0 });
    }

    try {
        let rows = [];
        let total = 0;
        let totalPages = 1;
        let currentPage = 1;

        if (collection === 'transactions') {
            const qs = buildDbExportFilterParams({ page, limit });
            const data = await apiRequest(`/admin/transactions?${qs.toString()}`, { silent: true });
            rows = Array.isArray(data?.transactions) ? data.transactions : [];
            total = Number(data?.total || rows.length || 0) || 0;
            totalPages = Number(data?.totalPages || 1) || 1;
            currentPage = Number(data?.currentPage || page) || page;
        } else if (collection === 'qrcodes') {
            const qs = new URLSearchParams();
            qs.set('mode', 'raw');
            qs.set('page', String(page));
            qs.set('limit', String(limit));
            if (search) qs.set('search', search);
            if (status && status !== 'all') qs.set('status', status);
            const data = await apiRequest(`/admin/qrcodes?${qs.toString()}`, { silent: true });
            rows = Array.isArray(data?.qrcodes) ? data.qrcodes : [];
            total = Number(data?.total || rows.length || 0) || 0;
            totalPages = Number(data?.totalPages || 1) || 1;
            currentPage = Number(data?.currentPage || page) || page;
        } else if (collection === 'feedback') {
            const qs = buildDbExportFilterParams({ page, limit });
            const data = await apiRequest(`/admin/feedback?${qs.toString()}`, { silent: true });
            rows = Array.isArray(data?.feedback) ? data.feedback : [];
            total = Number(data?.total || rows.length || 0) || 0;
            totalPages = Number(data?.totalPages || 1) || 1;
            currentPage = Number(data?.currentPage || page) || page;
        } else if (collection === 'lostreports') {
            const qs = new URLSearchParams();
            qs.set('page', String(page));
            qs.set('limit', String(limit));
            if (search) qs.set('search', search);
            if (status && status !== 'all') qs.set('status', status);
            const data = await apiRequest(`/admin/lost-reports?${qs.toString()}`, { silent: true });
            rows = Array.isArray(data?.reports) ? data.reports : [];
            total = Number(data?.total || rows.length || 0) || 0;
            totalPages = Number(data?.totalPages || 1) || 1;
            currentPage = Number(data?.currentPage || page) || page;
        } else if (collection === 'logs') {
            const qs = buildDbExportFilterParams({ page, limit });
            const data = await apiRequest(`/admin/logs?${qs.toString()}`, { silent: true });
            rows = Array.isArray(data?.logs) ? data.logs : [];
            total = Number(data?.total || rows.length || 0) || 0;
            totalPages = Number(data?.totalPages || 1) || 1;
            currentPage = Number(data?.currentPage || page) || page;
        } else if (collection === 'announcements') {
            const qs = buildDbExportFilterParams({ page, limit });
            const data = await apiRequest(`/admin/announcements?${qs.toString()}`, { silent: true });
            rows = Array.isArray(data?.announcements) ? data.announcements : [];
            total = Number(data?.total || rows.length || 0) || 0;
            totalPages = Number(data?.totalPages || 1) || 1;
            currentPage = Number(data?.currentPage || page) || page;
        } else if (collection === 'keys') {
            if (!dbExplorerState.localRows || dbExplorerState.localCollection !== collection || forceRefresh) {
                const data = await apiRequest('/admin/keys', { silent: true });
                dbExplorerState.localRows = Array.isArray(data?.keys) ? data.keys : [];
                dbExplorerState.localCollection = collection;
            }
            let items = Array.isArray(dbExplorerState.localRows) ? dbExplorerState.localRows.slice() : [];
            if (search) {
                items = items.filter((k) => {
                    const s = `${k?.keyId || ''} ${k?.locker || ''} ${k?.room || ''} ${k?.building || ''} ${k?.status || ''}`;
                    return matchesText(s, search);
                });
            }
            if (status && status !== 'all') {
                items = items.filter((k) => String(k?.status || '').toLowerCase() === status);
            }
            const paged = paginateArray(items, page, limit);
            rows = paged.slice;
            total = paged.total;
            totalPages = paged.totalPages;
            currentPage = paged.page;
        } else if (collection === 'lockers') {
            if (!dbExplorerState.localRows || dbExplorerState.localCollection !== collection || forceRefresh) {
                const data = await apiRequest('/lockers', { silent: true });
                dbExplorerState.localRows = Array.isArray(data?.lockers) ? data.lockers : [];
                dbExplorerState.localCollection = collection;
            }
            let items = Array.isArray(dbExplorerState.localRows) ? dbExplorerState.localRows.slice() : [];
            if (search) {
                items = items.filter((l) => matchesText(l?.name || '', search));
            }
            const paged = paginateArray(items, page, limit);
            rows = paged.slice;
            total = paged.total;
            totalPages = paged.totalPages;
            currentPage = paged.page;
        } else if (collection === 'users') {
            const fetchUsers = async () => {
                const qs = new URLSearchParams();
                if (search) qs.set('search', search);
                qs.set('includeInactive', 'true');
                const data = await apiRequest(`/admin/users?${qs.toString()}`, { silent: true });
                return Array.isArray(data?.users) ? data.users : [];
            };

            const all = (!search && dbExplorerState.localRows && dbExplorerState.localCollection === collection && !forceRefresh)
                ? dbExplorerState.localRows
                : await fetchUsers();

            if (!search) {
                dbExplorerState.localRows = all;
                dbExplorerState.localCollection = collection;
            }

            let items = Array.isArray(all) ? all.slice() : [];

            if (status && status !== 'all') {
                items = items.filter((u) => String(u?.approvalStatus || 'approved').trim().toLowerCase() === status);
            }

            if (search) {
                items = items.filter((u) => {
                    const s = `${u?.firstName || ''} ${u?.lastName || ''} ${u?.email || ''}`;
                    return matchesText(s, search);
                });
            }

            const paged = paginateArray(items, page, limit);
            rows = paged.slice;
            total = paged.total;
            totalPages = paged.totalPages;
            currentPage = paged.page;
        } else if (collection === 'admins') {
            if (!canCurrentAdminManageAdmins()) {
                rows = [];
                total = 0;
                totalPages = 1;
                currentPage = 1;
                setDbHint('You do not have permission to view admin accounts.');
            } else {
                const fetchAdmins = async () => {
                    const qs = new URLSearchParams();
                    if (search) qs.set('search', search);
                    qs.set('includeInactive', 'true');
                    const data = await apiRequest(`/admin/admins?${qs.toString()}`, { silent: true });
                    return Array.isArray(data?.admins) ? data.admins : [];
                };

                const all = (!search && dbExplorerState.localRows && dbExplorerState.localCollection === collection && !forceRefresh)
                    ? dbExplorerState.localRows
                    : await fetchAdmins();

                if (!search) {
                    dbExplorerState.localRows = all;
                    dbExplorerState.localCollection = collection;
                }

                let items = Array.isArray(all) ? all.slice() : [];
                if (status === 'active') items = items.filter((a) => a?.isActive !== false);
                if (status === 'inactive') items = items.filter((a) => a?.isActive === false);

                const paged = paginateArray(items, page, limit);
                rows = paged.slice;
                total = paged.total;
                totalPages = paged.totalPages;
                currentPage = paged.page;
            }
        }

        if (requestId !== dbExplorerRequestSeq) return;

        dbExplorerState.page = currentPage;
        dbExplorerState.total = total;
        dbExplorerState.totalPages = totalPages;

        renderDbTable(collection, rows);
        setDbPagination({ page: currentPage, totalPages, total });

        dbExplorerLastLoadedAt = Date.now();
        if (elements.dbExplorerUpdatedAt) {
            elements.dbExplorerUpdatedAt.textContent = `Updated: ${formatTime(new Date())}`;
        }
    } catch (error) {
        console.error('Database explorer error:', error);
        if (requestId !== dbExplorerRequestSeq) return;

        if (!silent || dbExplorerLastLoadedAt === 0) {
            if (elements.dbTableHead) {
                elements.dbTableHead.innerHTML = '<tr><th>Error</th></tr>';
            }
            if (elements.dbTableBody) {
                elements.dbTableBody.innerHTML = `
                    <tr>
                        <td class="text-center text-danger">
                            ${escapeHtml(error?.message || 'Failed to load records')}
                        </td>
                    </tr>
                `;
            }
        }

        if (!silent) {
            showNotification(error?.message || 'Failed to load database records', 'error');
        }
    }
}

async function initializeDatabaseHub({ forceRefresh = false } = {}) {
    if (!elements.dbCollectionSelect) return;

    dbExplorerState.collection = String(elements.dbCollectionSelect.value || 'transactions');
    dbExplorerState.search = getDbSearchValue();
    dbExplorerState.dateFrom = String(elements.dbDateFromInput?.value || '').trim();
    dbExplorerState.dateTo = String(elements.dbDateToInput?.value || '').trim();
    dbExplorerState.limit = DB_EXPLORER_LIMIT;
    dbExplorerState.status = String(elements.dbStatusSelect?.value || dbExplorerState.status || 'all');
    dbExplorerState.page = 1;

    configureDbFiltersForCollection(dbExplorerState.collection);
    await Promise.all([
        loadDatabaseSummary({ silent: true }),
        loadDbExplorer({ forceRefresh, silent: true })
    ]);
}

// =========================
// Lost Reports (Admin)
// =========================

function isLostReportsVisible() {
    return Boolean(elements.lostReportsSection && !elements.lostReportsSection.classList.contains('hidden'));
}

function shouldAutoRefreshLostReports() {
    if (!isLostReportsVisible()) return false;
    if (elements.lostReportModal && elements.lostReportModal.classList.contains('show')) return false;
    const active = document.activeElement;
    if (elements.lostReportsSearch && active === elements.lostReportsSearch) return false;
    if (elements.lostReportReplyInput && active === elements.lostReportReplyInput) return false;
    if (elements.lostReportResolutionNoteInput && active === elements.lostReportResolutionNoteInput) return false;
    return true;
}

function setLostReportModalNotice(text, tone = '') {
    const el = elements.lostReportModalNotice;
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

function getLostReportsFilters() {
    const search = String(elements.lostReportsSearch?.value || '').trim();
    const status = String(elements.lostReportsStatus?.value || 'all').trim().toLowerCase();
    const read = String(elements.lostReportsRead?.value || 'all').trim().toLowerCase();
    return { search, status: status || 'all', read: read || 'all' };
}

function getLostReportFromCache(reportId) {
    const id = String(reportId || '').trim();
    if (!id) return null;
    return (lostReportsCache || []).find((r) => String(r?._id || '').trim() === id) || null;
}

function renderLostReportModalDetails(report) {
    const container = elements.lostReportModalDetails;
    if (!container) return;

    const details = report && typeof report === 'object' ? report : {};
    const statusRaw = String(details.status || 'pending').trim().toLowerCase();
    const status = statusRaw === 'open' ? 'pending' : statusRaw;
    const isRead = Boolean(details.adminReadAt);
    const readLabel = isRead ? `Read: ${formatDateTime(details.adminReadAt)}` : 'Read: Unread';
    const replyLabel = details.adminRepliedAt ? `Replied: ${formatDateTime(details.adminRepliedAt)}` : 'Replied: —';
    const resolvedLabel = details.resolvedAt ? `Resolved: ${formatDateTime(details.resolvedAt)}` : 'Resolved: —';

    const rows = [
        ['Key ID', details.keyId],
        ['Status', status === 'resolved' ? 'Resolved' : 'Pending'],
        ['Reporter', details.reportedByEmail],
        ['Room', details.room],
        ['Locker', details.locker || deriveLockerFromKeyId(details.keyId)],
        ['Building', details.building],
        ['Time', formatDateTime(details.createdAt)],
        ['Read', readLabel.replace(/^Read:\s*/i, '')],
        ['Read by', details.adminReadByName],
        ['Replied', replyLabel.replace(/^Replied:\s*/i, '')],
        ['Replied by', details.adminRepliedByName],
        ['Resolved', resolvedLabel.replace(/^Resolved:\s*/i, '')],
        ['Resolution note', details.resolutionNote],
        ['Message', details.message]
    ];

    container.innerHTML = '';

    rows.forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'details-item';

        const key = document.createElement('div');
        key.className = 'details-key';
        key.textContent = String(label || '').trim();

        const val = document.createElement('div');
        val.className = 'details-value';
        val.textContent = String(value ?? '—').trim() || '—';

        item.appendChild(key);
        item.appendChild(val);
        container.appendChild(item);
    });
}

function renderLostReportsAdminList(reports, { total = 0 } = {}) {
    const list = elements.lostReportsList;
    if (!list) return;

    const items = Array.isArray(reports) ? reports : [];
    lostReportsCache = items;

    list.innerHTML = '';

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'admin-card';
        empty.innerHTML = `
            <p class="text-center">No lost reports found.</p>
            <p class="text-center text-muted">Try changing the filters or search keyword.</p>
        `;
        list.appendChild(empty);
        if (elements.lostReportsCountInfo) {
            elements.lostReportsCountInfo.textContent = '';
        }
        if (elements.lostReportsUpdatedAt) {
            elements.lostReportsUpdatedAt.textContent = `Updated: ${formatTime(new Date())}`;
        }
        return;
    }

    const unreadCount = items.filter((r) => !r?.adminReadAt).length;

    if (elements.lostReportsUpdatedAt) {
        elements.lostReportsUpdatedAt.textContent = `Updated: ${formatTime(new Date())}`;
    }
    if (elements.lostReportsCountInfo) {
        const shown = items.length;
        const safeTotal = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : shown;
        elements.lostReportsCountInfo.textContent = `Showing: ${shown} • Total: ${safeTotal} • Unread: ${unreadCount}`;
    }

    items.forEach((report) => {
        const id = String(report?._id || '').trim();
        const keyId = String(report?.keyId || '').trim().toUpperCase();
        const room = String(report?.room || '').trim();
        const locker = String(report?.locker || '').trim() || deriveLockerFromKeyId(keyId) || 'Unassigned';
        const building = String(report?.building || '').trim();
        const email = String(report?.reportedByEmail || '').trim();
        const statusRaw = String(report?.status || 'pending').trim().toLowerCase();
        const status = statusRaw === 'open' ? 'pending' : statusRaw;
        const isRead = Boolean(report?.adminReadAt);

        const statusClass = status === 'resolved' ? 'status-available' : 'status-borrowed';
        const statusLabel = status === 'resolved' ? 'Resolved' : 'Pending';
        const readClass = isRead ? 'status-read' : 'status-new';
        const readLabel = isRead ? 'Read' : 'Unread';

        const createdAt = formatDateTime(report?.createdAt);
        const preview = truncateText(report?.message || '', 140);
        const replyPreview = truncateText(report?.adminReply || '', 140);

        const card = document.createElement('div');
        card.className = `admin-card lost-report-admin-card${isRead ? '' : ' is-unread'}`;
        card.innerHTML = `
            <div class="key-header">
                <div class="key-title">
                    <h3>${escapeHtml(keyId || 'Lost Report')}</h3>
                    <span class="key-status ${statusClass}">${escapeHtml(statusLabel)}</span>
                    <span class="key-status ${readClass}">${escapeHtml(readLabel)}</span>
                </div>
                <button class="btn btn-small btn-secondary lost-report-view-btn" type="button" data-report-id="${escapeHtml(id)}">View / Reply</button>
            </div>
            <div class="key-details">
                <p><strong>Reporter:</strong> ${escapeHtml(email || '—')}</p>
                <p><strong>Room:</strong> ${escapeHtml(room || '—')}</p>
                <p><strong>Locker:</strong> ${escapeHtml(locker || '—')}</p>
                ${building ? `<p><strong>Building:</strong> ${escapeHtml(building)}</p>` : ''}
                <p><strong>Time:</strong> ${escapeHtml(createdAt)}</p>
                ${preview ? `<p><strong>Message:</strong> ${escapeHtml(preview)}</p>` : ''}
                ${replyPreview ? `<p><strong>Reply:</strong> ${escapeHtml(replyPreview)}</p>` : '<p class="text-muted"><em>No reply yet.</em></p>'}
            </div>
            <div class="key-actions">
                ${isRead ? '' : `<button class="btn btn-small btn-secondary lost-report-read-btn" type="button" data-report-id="${escapeHtml(id)}">Mark Read</button>`}
                ${status !== 'resolved'
                    ? `<button class="btn btn-small btn-success lost-report-resolve-btn" type="button" data-report-id="${escapeHtml(id)}">Resolve</button>`
                    : `<button class="btn btn-small btn-secondary lost-report-reopen-btn" type="button" data-report-id="${escapeHtml(id)}">Reopen</button>`
                }
                ${status === 'resolved'
                    ? `<button class="btn btn-small btn-danger lost-report-delete-btn" type="button" data-report-id="${escapeHtml(id)}">Delete</button>`
                    : ''
                }
            </div>
        `;
        list.appendChild(card);
    });
}

async function displayLostReports({ silent = false } = {}) {
    const list = elements.lostReportsList;
    if (!list) return;

    try {
        if (!silent && list.childElementCount === 0) {
            list.innerHTML = '<div class="spinner"></div>';
        }

        const { search, status, read } = getLostReportsFilters();
        const qs = new URLSearchParams();
        qs.set('page', '1');
        qs.set('limit', String(LOST_REPORTS_LIMIT));
        if (search) qs.set('search', search);
        if (status && status !== 'all') qs.set('status', status);
        if (read && read !== 'all') qs.set('read', read);

        const data = await apiRequest(`/admin/lost-reports?${qs.toString()}`, { silent: true });
        const reports = Array.isArray(data?.reports) ? data.reports : [];
        const total = Number(data?.total ?? reports.length ?? 0) || 0;

        renderLostReportsAdminList(reports, { total });
        lostReportsLastLoadedAt = Date.now();
    } catch (error) {
        console.error('Lost reports load error:', error);
        if (!silent) {
            showNotification(error?.message || 'Failed to load lost reports', 'error');
        }
        list.innerHTML = `
            <div class="admin-card">
                <p class="text-center error">Failed to load lost reports.</p>
                <button class="btn btn-secondary btn-small" id="retryLoadLostReportsBtn">Retry</button>
            </div>
        `;
        const retry = document.getElementById('retryLoadLostReportsBtn');
        if (retry) retry.addEventListener('click', () => displayLostReports({ silent: false }));
    }
}

function syncLostReportModalButtons(report) {
    const isRead = Boolean(report?.adminReadAt);
    const statusRaw = String(report?.status || 'pending').trim().toLowerCase();
    const status = statusRaw === 'open' ? 'pending' : statusRaw;
    const canDelete = status === 'resolved';
    if (elements.lostReportMarkReadBtn) {
        elements.lostReportMarkReadBtn.disabled = isRead;
        elements.lostReportMarkReadBtn.textContent = isRead ? 'Read' : 'Mark as Read';
    }
    if (elements.lostReportDeleteBtn) {
        elements.lostReportDeleteBtn.classList.toggle('hidden', !canDelete);
        elements.lostReportDeleteBtn.disabled = !canDelete;
    }
}

async function updateLostReport(reportId, payload, { silent = true } = {}) {
    const id = String(reportId || '').trim();
    if (!id) return null;
    const body = payload && typeof payload === 'object' ? payload : {};

    const payloadJson = JSON.stringify(body);
    const endpoints = [
        `/admin/lost-reports/${encodeURIComponent(id)}`,
        // Legacy alias (singular) in case the server/client is out of sync.
        `/admin/lost-report/${encodeURIComponent(id)}`
    ];
    const methods = ['POST', 'PUT', 'PATCH'];

    let lastError = null;
    for (const endpoint of endpoints) {
        for (const method of methods) {
            try {
                const data = await apiRequest(endpoint, {
                    method,
                    body: payloadJson,
                    silent
                });
                return data?.report || null;
            } catch (error) {
                lastError = error;
                const msg = String(error?.message || '').trim();
                const isRetriable = msg === 'Route not found'
                    || msg === 'API request failed: 404'
                    || error?.name === 'TypeError';
                if (isRetriable) {
                    continue;
                }
                throw error;
            }
        }
    }

    const msg = lastError?.message === 'Route not found' || lastError?.message === 'API request failed: 404'
        ? 'Lost Reports update API not available. Restart the server then hard-refresh this page.'
        : (lastError?.message || 'Failed to update lost report');
    throw new Error(msg);
}

async function deleteLostReport(reportId, { silent = true } = {}) {
    const id = String(reportId || '').trim();
    if (!id) return false;

    const encoded = encodeURIComponent(id);
    const attempts = [
        { endpoint: `/admin/lost-reports/${encoded}/delete`, method: 'POST' },
        { endpoint: `/admin/lost-report/${encoded}/delete`, method: 'POST' },
        { endpoint: `/admin/lost-reports/${encoded}`, method: 'DELETE' },
        { endpoint: `/admin/lost-report/${encoded}`, method: 'DELETE' }
    ];

    let lastError = null;
    for (const attempt of attempts) {
        try {
            const options = { method: attempt.method, silent: true };
            if (attempt.method === 'POST') {
                options.body = '{}';
            }
            const data = await apiRequest(attempt.endpoint, options);
            if (data === null) return false;
            return true;
        } catch (error) {
            lastError = error;
            const msg = String(error?.message || '').trim();
            const isRetriable = msg === 'Route not found'
                || msg === 'API request failed: 404'
                || error?.name === 'TypeError';
            if (isRetriable) continue;
            throw error;
        }
    }

    const msg = lastError?.message === 'Route not found' || lastError?.message === 'API request failed: 404'
        ? 'Lost Reports delete API not available. Restart the server then hard-refresh this page.'
        : (lastError?.message || 'Failed to delete lost report');
    if (!silent) showNotification(msg, 'error');
    throw new Error(msg);
}

async function markLostReportRead(reportId, { silent = true } = {}) {
    try {
        await updateLostReport(reportId, { markRead: true }, { silent });
        if (!silent) showNotification('Marked as read.', 'success');
        await displayLostReports({ silent: true });
        refreshDatabaseHubAfterMutation(['lostreports', 'logs']);
    } catch (error) {
        console.error('Mark lost report read error:', error);
        if (!silent) showNotification(error?.message || 'Failed to mark as read', 'error');
    }
}

async function setLostReportStatus(reportId, statusValue, { silent = true } = {}) {
    const raw = String(statusValue || '').trim().toLowerCase();
    const status = raw === 'open' ? 'pending' : raw;
    if (status !== 'pending' && status !== 'resolved') return;
    try {
        await updateLostReport(reportId, { status, markRead: true }, { silent });
        if (!silent) showNotification(status === 'resolved' ? 'Report resolved.' : 'Report set to pending.', 'success');
        await displayLostReports({ silent: true });
        refreshDatabaseHubAfterMutation(['lostreports', 'logs', 'keys']);
    } catch (error) {
        console.error('Lost report status update error:', error);
        if (!silent) showNotification(error?.message || 'Failed to update report', 'error');
    }
}

async function openLostReportModal(reportId) {
    const report = getLostReportFromCache(reportId);
    if (!report) return;

    activeLostReportId = String(report._id || '').trim();

    if (elements.lostReportModalTitle) {
        const keyId = String(report.keyId || '').trim().toUpperCase();
        elements.lostReportModalTitle.textContent = keyId ? `Lost Report • ${keyId}` : 'Lost Report';
    }

    if (elements.lostReportReplyInput) {
        elements.lostReportReplyInput.value = String(report.adminReply || '');
    }
    if (elements.lostReportStatusSelect) {
        const statusRaw = String(report.status || 'pending').trim().toLowerCase();
        elements.lostReportStatusSelect.value = statusRaw === 'resolved' ? 'resolved' : 'pending';
    }
    if (elements.lostReportResolutionNoteInput) {
        elements.lostReportResolutionNoteInput.value = String(report.resolutionNote || '');
    }

    renderLostReportModalDetails(report);
    syncLostReportModalButtons(report);
    setLostReportModalNotice('', 'info');
    showModal(elements.lostReportModal);

    // Auto-mark as read when opened.
    if (!report.adminReadAt) {
        try {
            const updated = await updateLostReport(activeLostReportId, { markRead: true }, { silent: true });
            if (updated) {
                Object.assign(report, updated);
                renderLostReportModalDetails(report);
                syncLostReportModalButtons(report);
                await displayLostReports({ silent: true });
                refreshDatabaseHubAfterMutation(['lostreports', 'logs']);
            }
        } catch {
            // ignore
        }
    }
}

async function saveLostReportFromModal() {
    const id = String(activeLostReportId || '').trim();
    if (!id) return;

    const btn = elements.lostReportSaveBtn;
    if (btn && btn.disabled) return;

    const reply = String(elements.lostReportReplyInput?.value || '').trim();
    const statusRaw = String(elements.lostReportStatusSelect?.value || 'pending').trim().toLowerCase();
    const status = statusRaw === 'open' ? 'pending' : statusRaw;
    const resolutionNote = String(elements.lostReportResolutionNoteInput?.value || '').trim();

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving…';
    }
    setLostReportModalNotice('', 'info');

    try {
        const updated = await updateLostReport(
            id,
            { markRead: true, reply, status, resolutionNote },
            { silent: true }
        );

        if (updated) {
            const cached = getLostReportFromCache(id);
            if (cached) Object.assign(cached, updated);
            renderLostReportModalDetails(updated);
            syncLostReportModalButtons(updated);
        }

        setLostReportModalNotice('Saved.', 'success');
        showNotification('Lost report updated.', 'success');
        await displayLostReports({ silent: true });
        refreshDatabaseHubAfterMutation(['lostreports', 'logs', 'keys']);
    } catch (error) {
        console.error('Lost report save error:', error);
        const msg = error?.message || 'Failed to update lost report';
        setLostReportModalNotice(msg, 'error');
        showNotification(msg, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    }
}

// =========================
// Maintenance (Admin)
// =========================

const MAINTENANCE_DEFAULT_TITLE = 'System Maintenance';
const MAINTENANCE_DEFAULT_MESSAGE = 'The system is temporarily unavailable while we perform maintenance. Please try again later.';
const MAINTENANCE_API_UNAVAILABLE_MESSAGE = 'Maintenance API not available. Restart the server and refresh this page.';
let maintenanceApiUnavailable = false;
let maintenanceApiUnavailableNotified = false;
let maintenanceState = {
    enabled: false,
    title: MAINTENANCE_DEFAULT_TITLE,
    message: MAINTENANCE_DEFAULT_MESSAGE,
    updatedAt: null,
    updatedByName: ''
};

function setMaintenanceApiNotice(message) {
    const notice = elements.maintenanceApiNotice;
    if (!notice) return;
    const text = String(message || '').trim();
    notice.textContent = text;
    notice.classList.toggle('hidden', !text);
}

function setMaintenanceControlsDisabled(disabled) {
    const value = Boolean(disabled);
    [
        elements.maintenanceEnabledToggle,
        elements.maintenanceTitleInput,
        elements.maintenanceMessageInput,
        elements.maintenanceResetBtn,
        elements.maintenanceSaveBtn
    ]
        .filter(Boolean)
        .forEach((el) => {
            el.disabled = value;
        });
}

function getMaintenanceFormState() {
    const enabled = Boolean(elements.maintenanceEnabledToggle?.checked);
    const title = String(elements.maintenanceTitleInput?.value || '').trim();
    const message = String(elements.maintenanceMessageInput?.value || '').trim();
    return { enabled, title, message };
}

function updateMaintenanceUpdatedLabel(state) {
    if (!elements.maintenanceUpdatedAt) return;
    const when = state?.updatedAt ? formatDateTime(state.updatedAt) : '—';
    const by = String(state?.updatedByName || '').trim();
    elements.maintenanceUpdatedAt.textContent = by ? `Last updated: ${when} • ${by}` : `Last updated: ${when}`;
}

function syncMaintenanceStatusBadge() {
    const badge = elements.maintenanceStatusBadge;
    if (!badge) return;
    const enabled = Boolean(elements.maintenanceEnabledToggle?.checked);
    badge.textContent = enabled ? 'ON' : 'OFF';
    badge.classList.toggle('on', enabled);
}

function syncMaintenancePreviewFromForm() {
    const form = getMaintenanceFormState();
    const title = form.title || MAINTENANCE_DEFAULT_TITLE;
    const message = form.message || MAINTENANCE_DEFAULT_MESSAGE;
    if (elements.maintenancePreviewTitle) elements.maintenancePreviewTitle.textContent = title;
    if (elements.maintenancePreviewMessage) elements.maintenancePreviewMessage.textContent = message;
}

function applyMaintenanceStateToForm(state) {
    const next = state || {};
    if (elements.maintenanceEnabledToggle) elements.maintenanceEnabledToggle.checked = Boolean(next.enabled);
    if (elements.maintenanceTitleInput) elements.maintenanceTitleInput.value = String(next.title || MAINTENANCE_DEFAULT_TITLE).trim();
    if (elements.maintenanceMessageInput) elements.maintenanceMessageInput.value = String(next.message || MAINTENANCE_DEFAULT_MESSAGE).trim();
    syncMaintenanceStatusBadge();
    syncMaintenancePreviewFromForm();
    updateMaintenanceUpdatedLabel(next);
}

function resetMaintenanceFormToDefault() {
    if (elements.maintenanceTitleInput) elements.maintenanceTitleInput.value = MAINTENANCE_DEFAULT_TITLE;
    if (elements.maintenanceMessageInput) elements.maintenanceMessageInput.value = MAINTENANCE_DEFAULT_MESSAGE;
    syncMaintenancePreviewFromForm();
}

async function loadMaintenanceSettings({ silent = true } = {}) {
    try {
        setMaintenanceApiNotice('');
        setMaintenanceControlsDisabled(false);
        const data = await apiRequest('/admin/maintenance', { silent: true });
        if (!data || !data.success) return;
        maintenanceApiUnavailable = false;
        maintenanceApiUnavailableNotified = false;
        maintenanceState = data.maintenance || maintenanceState;
        applyMaintenanceStateToForm(maintenanceState);
    } catch (error) {
        const rawMessage = String(error?.message || '').trim();
        if (rawMessage === 'Route not found') {
            maintenanceApiUnavailable = true;
            setMaintenanceControlsDisabled(true);
            setMaintenanceApiNotice(MAINTENANCE_API_UNAVAILABLE_MESSAGE);
            if (!silent && !maintenanceApiUnavailableNotified) {
                maintenanceApiUnavailableNotified = true;
                showNotification(MAINTENANCE_API_UNAVAILABLE_MESSAGE, 'error');
            }
            return;
        }

        console.error('Maintenance load error:', error);
        if (!silent) {
            showNotification(rawMessage || 'Failed to load maintenance settings', 'error');
        }
    }
}

async function saveMaintenanceSettings() {
    try {
        if (!elements.maintenanceSaveBtn) return;
        if (maintenanceApiUnavailable) {
            setMaintenanceApiNotice(MAINTENANCE_API_UNAVAILABLE_MESSAGE);
            if (!maintenanceApiUnavailableNotified) {
                maintenanceApiUnavailableNotified = true;
                showNotification(MAINTENANCE_API_UNAVAILABLE_MESSAGE, 'error');
            }
            return;
        }

        const { enabled, title, message } = getMaintenanceFormState();

        elements.maintenanceSaveBtn.disabled = true;
        elements.maintenanceSaveBtn.textContent = 'Saving…';

        const data = await apiRequest('/admin/maintenance', {
            method: 'PUT',
            body: JSON.stringify({ enabled, title, message }),
            silent: true
        });

        if (!data || !data.success) {
            throw new Error('Failed to save maintenance settings');
        }

        maintenanceState = data.maintenance || maintenanceState;
        applyMaintenanceStateToForm(maintenanceState);
        await loadSystemConfigurationStatus({ silent: true, force: true });
        showNotification(maintenanceState.enabled ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.', 'success');
    } catch (error) {
        const rawMessage = String(error?.message || '').trim();
        if (rawMessage === 'Route not found') {
            maintenanceApiUnavailable = true;
            setMaintenanceControlsDisabled(true);
            setMaintenanceApiNotice(MAINTENANCE_API_UNAVAILABLE_MESSAGE);
            if (!maintenanceApiUnavailableNotified) {
                maintenanceApiUnavailableNotified = true;
                showNotification(MAINTENANCE_API_UNAVAILABLE_MESSAGE, 'error');
            }
            return;
        }

        console.error('Maintenance save error:', error);
        showNotification(rawMessage || 'Failed to save maintenance settings', 'error');
    } finally {
        if (elements.maintenanceSaveBtn) {
            if (maintenanceApiUnavailable) {
                elements.maintenanceSaveBtn.disabled = true;
                elements.maintenanceSaveBtn.textContent = 'Unavailable';
            } else {
                elements.maintenanceSaveBtn.disabled = false;
                elements.maintenanceSaveBtn.textContent = 'Save';
            }
        }
    }
}

// Display Keys Management
async function displayKeysManagement() {
    try {
        const keysManagementList = elements.keysManagementList;
        if (!keysManagementList) return;

        keysManagementList.innerHTML = '<div class="spinner"></div>';

        const [keysData, lockersData] = await Promise.all([
            apiRequest('/admin/keys'),
            apiRequest('/lockers')
        ]);

        const keys = Array.isArray(keysData?.keys) ? keysData.keys : [];
        const lockers = Array.isArray(lockersData?.lockers) ? lockersData.lockers : [];
        updateLockerOptionsDatalist(lockers);
        const borrowedIds = keys.map(getBorrowedById).filter(Boolean);
        const usersById = borrowedIds.length ? await getAdminUsersLookup() : new Map();
        const suggestedKeyId = suggestNextKeyId(keys);
        const lockerNameByLower = new Map(
            lockers
                .map((locker) => normalizeLockerName(locker?.name))
                .filter(Boolean)
                .map((name) => [name.toLowerCase(), name])
        );
        const lockerIdByLower = new Map(
            lockers
                .map((locker) => {
                    const name = normalizeLockerName(locker?.name);
                    const id = locker?._id ? String(locker._id) : '';
                    return name && id ? [name.toLowerCase(), id] : null;
                })
                .filter(Boolean)
        );
        const lockerHardwareByLower = new Map(
            lockers
                .map((locker) => {
                    const name = normalizeLockerName(locker?.name);
                    const hardwareLockNumber = normalizeHardwareLockNumber(locker?.hardwareLockNumber);
                    return name ? [name.toLowerCase(), hardwareLockNumber] : null;
                })
                .filter(Boolean)
        );

        keysManagementList.innerHTML = '';

        const normalizeLockerLabel = (lockerValue, keyId) => {
            // If locker is intentionally blank, treat as Unassigned.
            if (lockerValue === '') return 'Unassigned';

            // Legacy keys may not have locker at all; keep UI organized by deriving.
            if (lockerValue === undefined || lockerValue === null) {
                const derived = deriveLockerFromKeyId(keyId);
                if (!derived) return 'Unassigned';
                return lockerNameByLower.get(derived.toLowerCase()) || derived;
            }

            const trimmed = normalizeLockerName(lockerValue);
            if (!trimmed) return 'Unassigned';
            return lockerNameByLower.get(trimmed.toLowerCase()) || trimmed;
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
        lockers.forEach((locker) => {
            const name = normalizeLockerName(locker?.name);
            if (!name) return;
            if (!groups.has(name)) groups.set(name, []);
        });

        keys.forEach((key) => {
            const lockerLabel = normalizeLockerLabel(key.locker, key.keyId);
            if (!groups.has(lockerLabel)) groups.set(lockerLabel, []);
            groups.get(lockerLabel).push(key);
        });

        if (groups.size === 0) {
            keysManagementList.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">No lockers found yet.</p>
                    <p class="text-center text-muted">Create your first locker to start adding keys.</p>
                    <button id="createFirstLockerBtn" class="btn btn-success mt-3">
                        Add New Locker
                    </button>
                </div>
            `;
            document.getElementById('createFirstLockerBtn')?.addEventListener('click', () => {
                const addLockerNameInput = document.getElementById('addLockerName');
                if (addLockerNameInput && !addLockerNameInput.value.trim()) {
                    addLockerNameInput.value = suggestNextLockerName();
                }
                showModal(elements.addLockerModal);
                setTimeout(() => addLockerNameInput?.focus(), 0);
            });
            return;
        }

        const lockerLabels = Array.from(groups.keys()).sort((a, b) => {
            const ka = lockerSortKey(a);
            const kb = lockerSortKey(b);
            if (ka.rank !== kb.rank) return ka.rank - kb.rank;
            if (ka.num !== kb.num) return ka.num - kb.num;
            return ka.text.localeCompare(kb.text);
        });

        lockerLabels.forEach((lockerLabel) => {
            const lockerKeys = groups.get(lockerLabel) || [];
            lockerKeys.sort((a, b) => String(a.keyId || '').localeCompare(String(b.keyId || '')));

            const lockerId = lockerIdByLower.get(String(lockerLabel || '').trim().toLowerCase()) || '';
            const hardwareLockNumber = lockerHardwareByLower.get(String(lockerLabel || '').trim().toLowerCase()) || null;

            const groupEl = document.createElement('div');
            groupEl.className = 'locker-group';
            groupEl.dataset.locker = lockerLabel;
            if (lockerId) groupEl.dataset.lockerId = lockerId;
            groupEl.innerHTML = `
                <div class="locker-header">
                    <div class="locker-title-wrap">
                        <h3 class="locker-title">${lockerLabel}</h3>
                        <p class="locker-meta">Total keys: ${lockerKeys.length}${hardwareLockNumber ? ` • Hardware Lock ${hardwareLockNumber}` : ''}</p>
                    </div>
                    <div class="locker-actions">
                        <button class="btn btn-small btn-success add-key-to-locker-btn" data-locker="${lockerLabel}">
                            Add Key
                        </button>
                        ${lockerId ? `
                            <button class="btn btn-small btn-danger delete-locker-btn" data-locker-id="${lockerId}" data-locker-name="${lockerLabel}" data-key-count="${lockerKeys.length}">
                                Delete
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="locker-keys-scroll" role="region" aria-label="Keys in ${lockerLabel}"></div>
            `;

            const scroller = groupEl.querySelector('.locker-keys-scroll');

            if (lockerKeys.length === 0) {
                const empty = document.createElement('button');
                empty.type = 'button';
                empty.className = 'empty-add-card add-key-to-locker-btn';
                empty.dataset.locker = lockerLabel;
                empty.innerHTML = `
                    <span class="empty-add-plus">+</span>
                    <span>Add first key</span>
                `;
                scroller.appendChild(empty);
            } else {
                lockerKeys.forEach((key) => {
                    const keyItem = buildKeyBoxElement(key, { usersById, showActions: true, showDescription: true });
                    scroller.appendChild(keyItem);
                });
            }

            keysManagementList.appendChild(groupEl);
        });

        // Attach event listeners
        attachKeyEventListeners();

        keysManagementList.querySelectorAll('.add-key-to-locker-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const locker = normalizeLockerName(e.currentTarget.dataset.locker);

                // Reset add-key form (keep locker context)
                const addKeyIdInput = document.getElementById('addKeyId');
                const addKeyRoomInput = document.getElementById('addKeyRoom');
                const addKeyBuildingInput = document.getElementById('addKeyBuilding');
                const addKeyDescriptionInput = document.getElementById('addKeyDescription');
                if (addKeyIdInput) addKeyIdInput.value = suggestedKeyId || '';
                if (addKeyRoomInput) addKeyRoomInput.value = '';
                if (addKeyBuildingInput) addKeyBuildingInput.value = '';
                if (addKeyDescriptionInput) addKeyDescriptionInput.value = '';

                const addKeyLockerInput = document.getElementById('addKeyLocker');
                if (addKeyLockerInput) {
                    const isUnassigned = locker.toLowerCase() === 'unassigned';
                    addKeyLockerInput.value = isUnassigned ? '' : locker;
                    addKeyLockerInput.readOnly = !isUnassigned;
                    addKeyLockerInput.classList.toggle('is-locked', !isUnassigned);
                }
                showModal(elements.addKeyModal);
                setTimeout(() => document.getElementById('addKeyId')?.focus(), 0);
            });
        });

        keysManagementList.querySelectorAll('.delete-locker-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const lockerId = e.currentTarget.dataset.lockerId || '';
                const lockerName = e.currentTarget.dataset.lockerName || '';
                const keyCount = e.currentTarget.dataset.keyCount || '0';
                await deleteLocker({ lockerId, lockerName, keyCount });
            });
        });

        if (lastAddedLockerName) {
            const target = Array.from(keysManagementList.querySelectorAll('.locker-group[data-locker]'))
                .find((el) => String(el.dataset.locker || '').trim().toLowerCase() === lastAddedLockerName.trim().toLowerCase());
            if (target) {
                target.classList.add('flash');
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setTimeout(() => target.classList.remove('flash'), 1200);
            }
            lastAddedLockerName = '';
        }

    } catch (error) {
        console.error('Error fetching keys:', error);
        elements.keysManagementList.innerHTML = `
            <div class="admin-card">
                <p class="text-center error">Error loading keys. Please try again.</p>
                <button class="btn btn-secondary mt-3" onclick="displayKeysManagement()">
                    Retry
                </button>
            </div>
        `;
    }
}

// Display QR Codes Management
async function displayQRCodesManagement() {
    try {
        const qrcodesList = elements.qrcodesList;
        if (!qrcodesList) return;

        qrcodesList.innerHTML = '<div class="spinner"></div>';

        const searchValue = document.getElementById('qrcodeSearch')?.value?.trim() || '';
        const params = new URLSearchParams();
        params.set('mode', 'current');
        params.set('page', '1');
        params.set('limit', '500');
        if (searchValue) params.set('search', searchValue);
        if (qrcodeStatus && qrcodeStatus !== 'all') params.set('status', qrcodeStatus);
        const query = params.toString();
        const data = await apiRequest(`/admin/qrcodes${query ? `?${query}` : ''}`);
        if (!data || !data.qrcodes) return;

        qrcodesList.innerHTML = '';

        if (data.qrcodes.length === 0) {
            const isFiltered = Boolean(searchValue) || (qrcodeStatus && qrcodeStatus !== 'all');
            qrcodesList.innerHTML = `
                <div class="admin-card">
                    <p class="text-center">${isFiltered ? 'No QR codes found.' : 'No QR codes generated yet.'}</p>
                    <p class="text-center text-muted">${
                        isFiltered
                            ? 'Try changing your search or filter.'
                            : 'Generate QR codes from the Manage Keys section.'
                    }</p>
                </div>
            `;
            return;
        }

        const formatStatusLabel = (status) => {
            const normalized = String(status || '').trim().toLowerCase();
            return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';
        };

        data.qrcodes.forEach((qrcode) => {
            const generatedBy = qrcode.generatedBy?.username || qrcode.generatedBy?.fullName || 'System';
            const usedBy = qrcode.usedBy
                ? `${qrcode.usedBy.firstName || ''} ${qrcode.usedBy.lastName || ''}`.trim() || qrcode.usedBy.email || 'Unknown User'
                : 'N/A';
            const usedAt = qrcode.usedAt ? new Date(qrcode.usedAt).toLocaleString() : 'Not used';
            const statusFromApi = String(qrcode.status || '').trim().toLowerCase();
            const status = ['active', 'used', 'inactive'].includes(statusFromApi)
                ? statusFromApi
                : 'active';
            const createdAtLabel = qrcode.createdAt ? new Date(qrcode.createdAt).toLocaleString() : '—';
            const hasUsage = Boolean(qrcode.usedAt || qrcode.usedBy);

            const qrItem = document.createElement('div');
            qrItem.className = 'admin-card qr-group-card';
            qrItem.innerHTML = `
                <div class="qr-group-header">
                    <div class="qr-group-title">
                        <h3>${qrcode.keyId} - ${qrcode.room}</h3>
                        <p class="qr-group-subtitle">Single QR for both borrow and return.</p>
                    </div>
                </div>

                <div class="qr-purpose-grid">
                    <div class="qr-purpose-card" data-purpose="unified">
                        <div class="qr-purpose-header">
                            <span class="qr-purpose-label">Borrow/Return</span>
                            <span class="qr-status ${status}">${formatStatusLabel(status)}</span>
                        </div>

                        <div class="qr-meta">
                            <div class="qr-meta-row">
                                <span class="qr-meta-label">Generated</span>
                                <span class="qr-meta-value">${createdAtLabel}</span>
                            </div>
                            <div class="qr-meta-row">
                                <span class="qr-meta-label">Generated By</span>
                                <span class="qr-meta-value">${generatedBy}</span>
                            </div>
                            <div class="qr-meta-row">
                                <span class="qr-meta-label">Mode</span>
                                <span class="qr-meta-value">Auto Borrow/Return</span>
                            </div>
                            <div class="qr-meta-row">
                                <span class="qr-meta-label">Validity</span>
                                <span class="qr-meta-value">No expiration</span>
                            </div>
                            ${hasUsage ? `
                                <div class="qr-meta-row">
                                    <span class="qr-meta-label">Used By</span>
                                    <span class="qr-meta-value">${usedBy}</span>
                                </div>
                                <div class="qr-meta-row">
                                    <span class="qr-meta-label">Used At</span>
                                    <span class="qr-meta-value">${usedAt}</span>
                                </div>
                            ` : ''}
                            ${qrcode.regeneratedAt ? `
                                <div class="qr-meta-row">
                                    <span class="qr-meta-label">Regenerated</span>
                                    <span class="qr-meta-value">${new Date(qrcode.regeneratedAt).toLocaleString()}</span>
                                </div>
                            ` : ''}
                        </div>

                        <div class="qr-preview">
                            <img
                                src="${qrcode.qrCodeImage}"
                                alt="QR Code (Borrow/Return) for ${qrcode.keyId}"
                                class="qr-thumb"
                                loading="lazy"
                            >
                        </div>

                        <div class="qr-actions">
                            <button
                                class="btn btn-small btn-success view-qr-btn"
                                data-qr-id="${qrcode._id}"
                                data-qr-image="${qrcode.qrCodeImage}"
                                data-key-id="${qrcode.keyId}"
                                data-room="${qrcode.room}"
                                data-mode="Auto Borrow/Return"
                                data-validity="No expiration">
                                View Full
                            </button>
                            <button class="btn btn-small btn-warning regenerate-qr-btn" data-qr-id="${qrcode._id}">
                                Regenerate
                            </button>
                            <button class="btn btn-small btn-danger delete-qr-btn" data-qr-id="${qrcode._id}">
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            `;
            qrcodesList.appendChild(qrItem);
        });

        // Attach event listeners
        attachQREventListeners();

    } catch (error) {
        console.error('Error fetching QR codes:', error);
        elements.qrcodesList.innerHTML = `
            <div class="admin-card">
                <p class="text-center error">Error loading QR codes. Please try again.</p>
                <button class="btn btn-secondary mt-3" onclick="displayQRCodesManagement()">
                    Retry
                </button>
            </div>
        `;
    }
}

// Attach Key Event Listeners
function attachKeyEventListeners() {
    // Generate QR buttons
    document.querySelectorAll('.generate-qr-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const keyId = e.target.dataset.keyId;
            const room = e.target.dataset.room;
            openGenerateQRModal(keyId, room);
        });
    });

    // Edit key buttons
    document.querySelectorAll('.edit-key-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const keyId = e.target.dataset.keyId;
            await openEditKeyModal(keyId);
        });
    });

    // Delete key buttons
    document.querySelectorAll('.delete-key-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const keyId = e.target.dataset.keyId;
            openDeleteKeyModal(keyId);
        });
    });
}

// Attach QR Event Listeners
function attachQREventListeners() {
    // View QR buttons
    document.querySelectorAll('.view-qr-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qrId = e.target.dataset.qrId;
            const qrImage = e.target.dataset.qrImage;
            const keyId = e.target.dataset.keyId;
            const room = e.target.dataset.room;
            const mode = e.target.dataset.mode;
            const validity = e.target.dataset.validity;
            openQRCodeModal(qrId, qrImage, keyId, room, mode, validity);
        });
    });

    // Regenerate QR buttons
    document.querySelectorAll('.regenerate-qr-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const qrId = e.target.dataset.qrId;
            await regenerateQRCode(qrId);
        });
    });

    // Delete QR buttons
    document.querySelectorAll('.delete-qr-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const qrId = e.target.dataset.qrId;
            await deleteQRCode(qrId);
        });
    });
}

// Open Generate QR Modal
function openGenerateQRModal(keyId, room) {
    currentKeyId = keyId;
    const qrKeyIdInput = document.getElementById('qrKeyId');
    const qrRoomInput = document.getElementById('qrRoom');
    
    if (qrKeyIdInput) qrKeyIdInput.value = keyId;
    if (qrRoomInput) qrRoomInput.value = room;

    showModal(elements.generateQRModal);
}

// Generate QR Code
async function generateQRCode() {
    const qrKeyIdInput = document.getElementById('qrKeyId');
    const qrRoomInput = document.getElementById('qrRoom');

    if (!qrKeyIdInput || !qrRoomInput) return;
    
    const keyId = qrKeyIdInput.value;
    const room = qrRoomInput.value;

    if (!keyId || !room) {
        showNotification('Key ID and Room are required', 'error');
        return;
    }

    try {
        showNotification('Generating QR code...', 'info');

        const data = await apiRequest('/qrcodes/generate', {
            method: 'POST',
            body: JSON.stringify({ keyId, room })
        });

        if (!data) return;

        // Store QR code data
        currentQRCodeData = data;

        // Hide generate modal and show QR code modal
        hideModal(elements.generateQRModal);
        openQRCodeModal(
            data.qrCodeId,
            data.qrCode,
            keyId,
            data.qrData?.room || room,
            'Auto Borrow/Return',
            'No expiration'
        );

        // Refresh QR codes list
        if (elements.manageQRCodesSection.classList.contains('hidden')) {
            displayKeysManagement();
        } else {
            displayQRCodesManagement();
        }

        showNotification('QR code generated successfully!', 'success');

    } catch (error) {
        console.error('Error generating QR code:', error);
        showNotification('Failed to generate QR code', 'error');
    }
}

// Open QR Code Modal
function openQRCodeModal(qrId, qrImage, keyId, room, mode, validity) {
    const qrCodeImg = document.getElementById('generatedQRCode');
    const qrKeyDisplay = document.getElementById('qrKeyDisplay');
    const qrRoomDisplay = document.getElementById('qrRoomDisplay');
    const qrModeDisplay = document.getElementById('qrModeDisplay');
    const qrValidityDisplay = document.getElementById('qrValidityDisplay');

    if (qrCodeImg) qrCodeImg.src = qrImage;
    if (qrKeyDisplay) qrKeyDisplay.textContent = keyId;
    if (qrRoomDisplay) qrRoomDisplay.textContent = room;
    if (qrModeDisplay) {
        const value = mode || 'Auto Borrow/Return';
        qrModeDisplay.textContent = value;
    }
    if (qrValidityDisplay) {
        const value = validity || 'No expiration';
        qrValidityDisplay.textContent = value;
    }

    // Store data for download
    if (qrCodeImg) {
        qrCodeImg.dataset.qrId = qrId;
        qrCodeImg.dataset.keyId = keyId;
    }

    showModal(elements.qrCodeModal);
}

// Download QR Code
function downloadQRCode() {
    const qrCodeImg = document.getElementById('generatedQRCode');
    if (!qrCodeImg) return;
    
    const keyId = qrCodeImg.dataset.keyId || 'QRCode';
    
    const link = document.createElement('a');
    link.href = qrCodeImg.src;
    link.download = `QR_${keyId}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification('QR code downloaded successfully!', 'success');
}

// Print QR Code (print just the QR area)
function printQRCode() {
    const qrCodeImg = document.getElementById('generatedQRCode');
    if (!qrCodeImg || !qrCodeImg.src) return;

    const keyId = document.getElementById('qrKeyDisplay')?.textContent || '';
    const room = document.getElementById('qrRoomDisplay')?.textContent || '';
    const mode = document.getElementById('qrModeDisplay')?.textContent || '';
    const validity = document.getElementById('qrValidityDisplay')?.textContent || '';

    const printWindow = window.open('', '_blank', 'width=600,height=700');
    if (!printWindow) return;

    printWindow.document.write(`
        <html>
        <head>
            <title>QR Code - ${keyId}</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 24px; }
                img { width: 260px; height: 260px; border: 1px solid #ddd; border-radius: 10px; padding: 10px; }
                .meta { margin-top: 16px; font-size: 14px; color: #333; }
                .meta p { margin: 6px 0; }
            </style>
        </head>
        <body>
            <h2>BatStateU Key Borrowing QR</h2>
            <img src="${qrCodeImg.src}" alt="QR Code">
            <div class="meta">
                <p><strong>Key:</strong> ${keyId}</p>
                <p><strong>Room:</strong> ${room}</p>
                <p><strong>Mode:</strong> ${mode}</p>
                <p><strong>Validity:</strong> ${validity}</p>
            </div>
            <script>
                window.onload = function() { window.print(); window.close(); };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Regenerate QR Code
async function regenerateQRCode(qrId) {
    const ok = await showConfirmDialog({
        title: 'Regenerate QR Code',
        message: 'Regenerate this QR image? QR data stays the same for this key.',
        confirmText: 'Regenerate',
        cancelText: 'Cancel',
        tone: 'warning'
    });
    if (!ok) return;

    try {
        showNotification('Regenerating QR code...', 'info');

        const data = await apiRequest(`/admin/qrcodes/${qrId}/regenerate`, {
            method: 'POST'
        });

        if (!data) return;

        showNotification('QR code regenerated successfully!', 'success');
        displayQRCodesManagement();

    } catch (error) {
        console.error('Error regenerating QR code:', error);
        showNotification('Failed to regenerate QR code', 'error');
    }
}

// Delete QR Code
async function deleteQRCode(qrId) {
    const ok = await showConfirmDialog({
        title: 'Delete QR Code',
        message: 'Delete this QR code? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;

    try {
        showNotification('Deleting QR code...', 'info');
        await apiRequest(`/admin/qrcodes/${qrId}`, { method: 'DELETE' });
        showNotification('QR code deleted. Generate a new QR from Manage Keys to enable it again.', 'success');
        displayQRCodesManagement();
        if (elements.manageKeysSection && !elements.manageKeysSection.classList.contains('hidden')) {
            displayKeysManagement();
        }
        refreshDatabaseHubAfterMutation(['qrcodes', 'keys', 'transactions']);

    } catch (error) {
        console.error('Error deleting QR code:', error);
        showNotification(error.message || 'Failed to delete QR code', 'error');
    }
}

// Open Edit Key Modal
async function openEditKeyModal(keyId) {
    try {
        const data = await apiRequest(`/keys/${keyId}`);
        if (!data || !data.key) return;

        const key = data.key;
        const editKeyIdInput = document.getElementById('editKeyId');
        const editKeyLockerInput = document.getElementById('editKeyLocker');
        const editKeyRoomInput = document.getElementById('editKeyRoom');
        const editKeyBuildingInput = document.getElementById('editKeyBuilding');
        const editKeyDescriptionInput = document.getElementById('editKeyDescription');
        
        if (editKeyIdInput) editKeyIdInput.value = key.keyId;
        if (editKeyLockerInput) editKeyLockerInput.value = key.locker || '';
        if (editKeyRoomInput) editKeyRoomInput.value = key.room;
        if (editKeyBuildingInput) editKeyBuildingInput.value = key.building || '';
        if (editKeyDescriptionInput) editKeyDescriptionInput.value = key.description || '';

        currentKeyId = key.keyId;
        showModal(elements.editKeyModal);

    } catch (error) {
        console.error('Error fetching key details:', error);
        showNotification('Failed to load key details', 'error');
    }
}

// Open Delete Key Modal
function openDeleteKeyModal(keyId) {
    currentKeyId = keyId;
    const deleteKeyIdElement = document.getElementById('deleteKeyId');
    if (deleteKeyIdElement) {
        deleteKeyIdElement.textContent = keyId;
    }
    showModal(elements.deleteKeyModal);
}

function suggestNextLockerName() {
    const labels = Array.from(document.querySelectorAll('.locker-group[data-locker]'))
        .map((el) => String(el.dataset.locker || '').trim())
        .filter(Boolean);

    let max = 0;
    labels.forEach((label) => {
        const match = /^locker\s*(\d+)$/i.exec(label);
        if (!match) return;
        const num = parseInt(match[1], 10);
        if (Number.isFinite(num) && num > max) max = num;
    });

    return `Locker ${max > 0 ? max + 1 : 1}`;
}

// Add Locker
async function addLocker() {
    const addLockerNameInput = document.getElementById('addLockerName');
    const addLockerHardwareInput = document.getElementById('addLockerHardwareNumber');
    if (!addLockerNameInput) return;

    const name = normalizeLockerName(addLockerNameInput.value);
    const hardwareLockNumber = normalizeHardwareLockNumber(addLockerHardwareInput?.value);
    if (!name) {
        showNotification('Locker name is required', 'error');
        return;
    }

    if (isAddingLocker) return;
    isAddingLocker = true;
    const confirmAddLockerBtn = document.getElementById('confirmAddLockerBtn');
    if (confirmAddLockerBtn) confirmAddLockerBtn.disabled = true;

    try {
        showNotification('Adding locker...', 'info');

        const payload = { name };
        if (hardwareLockNumber) payload.hardwareLockNumber = hardwareLockNumber;

        const result = await apiRequest('/lockers', {
            method: 'POST',
            body: JSON.stringify(payload),
            silent: true
        });

        lastAddedLockerName = name;
        hideModal(elements.addLockerModal);
        addLockerNameInput.value = '';
        if (addLockerHardwareInput) addLockerHardwareInput.value = '';

        await displayKeysManagement();
        const assignedHardwareLockNumber = normalizeHardwareLockNumber(result?.locker?.hardwareLockNumber);
        showNotification(
            assignedHardwareLockNumber
                ? `Locker added successfully! Hardware Lock ${assignedHardwareLockNumber} is now connected.`
                : 'Locker added successfully!',
            'success'
        );
    } catch (error) {
        console.error('Error adding locker:', error);
        showNotification(error.message || 'Failed to add locker', 'error');
    } finally {
        isAddingLocker = false;
        if (confirmAddLockerBtn) confirmAddLockerBtn.disabled = false;
    }
}

async function deleteLocker({ lockerId, lockerName, keyCount = 0 }) {
    const id = String(lockerId || '').trim();
    const name = normalizeLockerName(lockerName);
    const count = Number(keyCount || 0);

    if (!id || !name) return;
    if (isDeletingLocker) return;

    const ok = await showConfirmDialog({
        title: 'Delete Locker',
        message: count > 0
            ? `Delete "${name}"?\n\nThis locker has ${count} key(s). They will be moved to Unassigned.`
            : `Delete "${name}"?`,
        confirmText: 'Delete Locker',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;

    isDeletingLocker = true;
    try {
        showNotification('Deleting locker...', 'info');
        const result = await apiRequest(`/lockers/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            silent: true
        });

        await displayKeysManagement();
        refreshDatabaseHubAfterMutation(['lockers', 'keys']);

        const moved = Number(result?.movedKeys ?? 0);
        if (moved > 0) {
            showNotification(`Locker deleted. ${moved} key(s) moved to Unassigned.`, 'success');
        } else {
            showNotification('Locker deleted successfully!', 'success');
        }
    } catch (error) {
        console.error('Error deleting locker:', error);
        showNotification(error.message || 'Failed to delete locker', 'error');
    } finally {
        isDeletingLocker = false;
    }
}

// Add Key
async function addKey() {
    const addKeyIdInput = document.getElementById('addKeyId');
    const addKeyLockerInput = document.getElementById('addKeyLocker');
    const addKeyRoomInput = document.getElementById('addKeyRoom');
    const addKeyBuildingInput = document.getElementById('addKeyBuilding');
    const addKeyDescriptionInput = document.getElementById('addKeyDescription');
    
    if (!addKeyIdInput || !addKeyRoomInput) return;
    
    const keyId = addKeyIdInput.value.trim().toUpperCase();
    const lockerRaw = addKeyLockerInput ? addKeyLockerInput.value.trim() : '';
    const locker = lockerRaw;
    const room = addKeyRoomInput.value.trim();
    const building = addKeyBuildingInput ? addKeyBuildingInput.value.trim() : '';
    const description = addKeyDescriptionInput ? addKeyDescriptionInput.value.trim() : '';

    if (!keyId || !room) {
        showNotification('Key ID and Room are required', 'error');
        return;
    }

    if (!keyId.match(/^KEY\d{3}$/)) {
        showNotification('Key ID must be in format KEY001 to KEY999', 'error');
        return;
    }

    if (isAddingKey) return;
    isAddingKey = true;
    const confirmAddKeyBtn = document.getElementById('confirmAddKeyBtn');
    if (confirmAddKeyBtn) confirmAddKeyBtn.disabled = true;

    try {
        showNotification('Adding key...', 'info');

        await apiRequest('/keys', {
            method: 'POST',
            body: JSON.stringify({ keyId, locker, room, building, description }),
            silent: true
        });

        hideModal(elements.addKeyModal);
        
        // Clear form
        if (addKeyIdInput) addKeyIdInput.value = '';
        if (addKeyLockerInput) addKeyLockerInput.value = '';
        if (addKeyRoomInput) addKeyRoomInput.value = '';
        if (addKeyBuildingInput) addKeyBuildingInput.value = '';
        if (addKeyDescriptionInput) addKeyDescriptionInput.value = '';

        // Refresh keys list
        await displayKeysManagement();
        await displayAdminOverview();

        showNotification('Key added successfully! QR code and locker trigger are ready to scan.', 'success');

    } catch (error) {
        console.error('Error adding key:', error);

        const message = String(error?.message || '');
        if (message.toLowerCase().includes('key id already exists')) {
            try {
                const existing = await apiRequest(`/keys/${keyId}`, { silent: true });
                const existingKey = existing?.key || null;

                const existingLockerValue = normalizeLockerName(existingKey?.locker);
                const existingLockerLabel = existingLockerValue || deriveLockerFromKeyId(existingKey?.keyId) || 'Unassigned';

                const targetLockerValue = normalizeLockerName(locker);
                const targetLockerLabel = targetLockerValue || 'Unassigned';

                if (existingLockerLabel.trim().toLowerCase() === targetLockerLabel.trim().toLowerCase()) {
                    showNotification(`Key ${keyId} already exists in ${existingLockerLabel}.`, 'error');
                } else {
                    const ok = await showConfirmDialog({
                        title: 'Key ID already exists',
                        message: `Key ${keyId} already exists in ${existingLockerLabel}.\n\nKey IDs must be unique across all lockers.\n\nMove the existing key to ${targetLockerLabel}?`,
                        confirmText: 'Move Key',
                        cancelText: 'Cancel',
                        tone: 'warning'
                    });

                    if (ok) {
                        showNotification('Moving key...', 'info');
                        await apiRequest(`/keys/${keyId}`, {
                            method: 'PUT',
                            body: JSON.stringify({ locker: targetLockerValue }),
                            silent: true
                        });
                        hideModal(elements.addKeyModal);
                        await displayKeysManagement();
                        showNotification(`Key moved to ${targetLockerLabel}.`, 'success');
                    }
                }
            } catch (innerError) {
                console.error('Error resolving duplicate key:', innerError);
                showNotification('Key ID already exists. Please use a different Key ID, or edit the existing key.', 'error');
            }
        } else {
            showNotification(error.message || 'Failed to add key', 'error');
        }
    } finally {
        isAddingKey = false;
        if (confirmAddKeyBtn) confirmAddKeyBtn.disabled = false;
    }
}

// Update Key
async function updateKey() {
    const editKeyIdInput = document.getElementById('editKeyId');
    const editKeyLockerInput = document.getElementById('editKeyLocker');
    const editKeyRoomInput = document.getElementById('editKeyRoom');
    const editKeyBuildingInput = document.getElementById('editKeyBuilding');
    const editKeyDescriptionInput = document.getElementById('editKeyDescription');
    
    if (!editKeyIdInput || !editKeyRoomInput) return;
    
    const keyId = editKeyIdInput.value;
    const locker = editKeyLockerInput ? editKeyLockerInput.value.trim() : '';
    const room = editKeyRoomInput.value.trim();
    const building = editKeyBuildingInput ? editKeyBuildingInput.value.trim() : '';
    const description = editKeyDescriptionInput ? editKeyDescriptionInput.value.trim() : '';

    if (!room) {
        showNotification('Room is required', 'error');
        return;
    }

    try {
        showNotification('Updating key...', 'info');

        await apiRequest(`/keys/${keyId}`, {
            method: 'PUT',
            body: JSON.stringify({ locker, room, building, description }),
            silent: true
        });

        hideModal(elements.editKeyModal);
        await displayKeysManagement();
        showNotification('Key updated successfully! QR and locker mapping stayed connected.', 'success');

    } catch (error) {
        console.error('Error updating key:', error);
        showNotification('Failed to update key', 'error');
    }
}

// Delete Key
async function deleteKey() {
    if (!currentKeyId) return;

    try {
        showNotification('Deleting key...', 'info');

        await apiRequest(`/keys/${currentKeyId}`, {
            method: 'DELETE',
            silent: true
        });

        hideModal(elements.deleteKeyModal);
        await displayKeysManagement();
        await displayAdminOverview();
        refreshDatabaseHubAfterMutation(['keys', 'qrcodes', 'transactions']);

        showNotification('Key deleted successfully!', 'success');

    } catch (error) {
        console.error('Error deleting key:', error);
        showNotification('Failed to delete key', 'error');
    }
}

// Show/Hide Modal
function showModal(modal) {
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('show');
    }
    document.body.classList.add('modal-open');
}

function hideModal(modal) {
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
    }

    if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
    }

    if (modal && (modal === elements.addKeyModal || modal.id === 'addKeyModal')) {
        const addKeyLockerInput = document.getElementById('addKeyLocker');
        if (addKeyLockerInput) {
            addKeyLockerInput.readOnly = false;
            addKeyLockerInput.classList.remove('is-locked');
        }
    }
}

// Show Notification
function showNotification(message, type = 'info') {
    const container = elements.notificationContainer;
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

// Navigation Functions
function setActiveAdminNav(sectionId) {
    const mapping = new Map([
        ['adminOverviewSection', elements.adminOverviewBtn],
        ['manageKeysSection', elements.manageKeysBtn],
        ['manageQRCodesSection', elements.manageQRCodesBtn],
        ['settingsSection', elements.settingsBtn],
        ['databaseSection', elements.databaseBtn],
        ['maintenanceSection', elements.maintenanceBtn],
        ['manageAdminsSection', elements.manageAdminsBtn],
        ['announcementsSection', elements.announcementsBtn],
        ['lostReportsSection', elements.lostReportsBtn],
        ['feedbackSection', elements.feedbackBtn],
        ['activityLogsSection', elements.activityLogsBtn]
    ]);

    const activeBtn = mapping.get(sectionId) || null;
    [
        elements.adminOverviewBtn,
        elements.manageKeysBtn,
        elements.manageQRCodesBtn,
        elements.settingsBtn,
        elements.databaseBtn,
        elements.maintenanceBtn,
        elements.manageAdminsBtn,
        elements.announcementsBtn,
        elements.lostReportsBtn,
        elements.feedbackBtn,
        elements.activityLogsBtn
    ]
        .filter(Boolean)
        .forEach((btn) => btn.classList.toggle('is-active', btn === activeBtn));
}

function showSection(sectionId) {
    setKeysOverviewFullscreen(false);
    // Hide all sections
    const sections = [
        elements.adminOverviewSection,
        elements.chartsSection,
        elements.databaseSection,
        elements.maintenanceSection,
        elements.manageKeysSection,
        elements.manageQRCodesSection,
        elements.settingsSection,
        elements.manageAdminsSection,
        elements.announcementsSection,
        elements.lostReportsSection,
        elements.activityLogsSection,
        elements.feedbackSection
    ];
    
    sections.forEach(section => {
        if (section) section.classList.add('hidden');
    });

    // Show selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
        selectedSection.classList.remove('hidden');
    }

    // Always show charts with overview
    if (sectionId === 'adminOverviewSection' && elements.chartsSection) {
        elements.chartsSection.classList.remove('hidden');
    }

    setActiveAdminNav(sectionId);
}

// Logout
async function logout() {
    const ok = await showConfirmDialog({
        title: 'Confirm Logout',
        message: 'Are you sure you want to log out?',
        confirmText: 'Yes, Logout',
        cancelText: 'Cancel',
        tone: 'danger'
    });
    if (!ok) return;

    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminData');
    localStorage.removeItem('kbs:lastActiveAt');
    localStorage.removeItem('kbs:idleLogoutAt');
    window.location.href = ROUTES.home;
}

// Utility function for debouncing
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Event Listeners Setup
function setupEventListeners() {
    // Navigation buttons
    if (elements.adminOverviewBtn) {
        elements.adminOverviewBtn.addEventListener('click', () => {
            showSection('adminOverviewSection');
            displayAdminOverview();
            displayRecentActivity();
            displayAdminKeysOverview();
            initializeCharts();
        });
    }

    if (elements.manageKeysBtn) {
        elements.manageKeysBtn.addEventListener('click', () => {
            showSection('manageKeysSection');
            displayKeysManagement();
        });
    }

    if (elements.manageQRCodesBtn) {
        elements.manageQRCodesBtn.addEventListener('click', () => {
            showSection('manageQRCodesSection');
            displayQRCodesManagement();
        });
    }

    if (elements.settingsBtn) {
        elements.settingsBtn.addEventListener('click', () => {
            showSection('settingsSection');
            displayUsers();
            displayPendingApprovals();
            loadSystemConfigurationStatus({ silent: true, force: true });
            loadAccessQrPack({ silent: true, force: true });
        });
    }

    if (elements.databaseBtn) {
        elements.databaseBtn.addEventListener('click', () => {
            showSection('databaseSection');
            setDatabaseMobileView('overview', { scroll: false });
            initializeDatabaseHub({ forceRefresh: true });
        });
    }

    // Database mobile tabs (shown on smaller screens)
    document.querySelectorAll('#databaseSection .db-mobile-tabs [data-db-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setDatabaseMobileView(btn.getAttribute('data-db-view'), { scroll: true });
        });
    });

    if (elements.maintenanceBtn) {
        elements.maintenanceBtn.addEventListener('click', () => {
            showSection('maintenanceSection');
            loadMaintenanceSettings({ silent: false });
        });
    }

    if (elements.manageAdminsBtn) {
        elements.manageAdminsBtn.addEventListener('click', () => {
            showSection('manageAdminsSection');
            displayAdmins();
        });
    }

    if (elements.announcementsBtn) {
        elements.announcementsBtn.addEventListener('click', () => {
            showSection('announcementsSection');
            displayAnnouncementsManagement();
        });
    }

    if (elements.lostReportsBtn) {
        elements.lostReportsBtn.addEventListener('click', () => {
            showSection('lostReportsSection');
            displayLostReports({ silent: false });
            setTimeout(() => elements.lostReportsSearch?.focus(), 0);
        });
    }

    if (elements.feedbackBtn) {
        elements.feedbackBtn.addEventListener('click', () => {
            showSection('feedbackSection');
            displayFeedback();
        });
    }

    if (elements.activityLogsBtn) {
        elements.activityLogsBtn.addEventListener('click', () => {
            showSection('activityLogsSection');
            displayActivityLogs();
        });
    }

    if (elements.adminLogoutBtn) {
        elements.adminLogoutBtn.addEventListener('click', logout);
    }

    if (elements.openSystemConfigBtn) {
        elements.openSystemConfigBtn.addEventListener('click', () => {
            showSection('maintenanceSection');
            loadMaintenanceSettings({ silent: false });
        });
    }

    if (elements.refreshSystemConfigBtn) {
        elements.refreshSystemConfigBtn.addEventListener('click', () => {
            loadSystemConfigurationStatus({ silent: false, force: true });
            loadAccessQrPack({ silent: true, force: true });
        });
    }

    if (elements.refreshAccessQrBtn) {
        elements.refreshAccessQrBtn.addEventListener('click', () => {
            loadAccessQrPack({ silent: false, force: true });
        });
    }

    if (elements.exportAccessQrPdfBtn) {
        elements.exportAccessQrPdfBtn.addEventListener('click', exportAccessQrPackPdf);
    }

    if (elements.accessQrList) {
        elements.accessQrList.addEventListener('click', async (e) => {
            const copyBtn = e.target?.closest?.('[data-access-qr-copy]');
            if (copyBtn) {
                const url = String(copyBtn.getAttribute('data-access-qr-copy') || '').trim();
                const ok = await copyTextToClipboard(url);
                showNotification(ok ? 'Access URL copied.' : 'Failed to copy access URL.', ok ? 'success' : 'error');
                return;
            }

            const openBtn = e.target?.closest?.('[data-access-qr-open]');
            if (openBtn) {
                const url = String(openBtn.getAttribute('data-access-qr-open') || '').trim();
                if (!url) return;
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        });
    }

    if (elements.keysFullscreenBtn) {
        elements.keysFullscreenBtn.addEventListener('click', toggleKeysOverviewFullscreen);
    }

    // Back to dashboard buttons
    document.querySelectorAll('[id^="backToAdminDashboardBtn"]').forEach(btn => {
        btn.addEventListener('click', () => {
            showSection('adminOverviewSection');
        });
    });

    // Database hub controls
    if (elements.dbLiveToggle) {
        elements.dbLiveToggle.addEventListener('change', (e) => {
            setDbLiveEnabled(Boolean(e.target?.checked));
            showNotification(dbLiveEnabled ? 'Live refresh enabled.' : 'Live refresh paused.', 'info');
            if (dbLiveEnabled && isDatabaseHubVisible()) {
                loadDatabaseSummary({ silent: true });
                loadDbExplorer({ forceRefresh: true, silent: true });
            }
        });
    }

    if (elements.dbSummaryRefreshBtn) {
        elements.dbSummaryRefreshBtn.addEventListener('click', () => {
            loadDatabaseSummary({ silent: false });
            loadDbExplorer({ forceRefresh: true, silent: false });
        });
    }

    if (elements.dbCollectionSelect) {
        elements.dbCollectionSelect.addEventListener('change', () => {
            dbExplorerState.collection = String(elements.dbCollectionSelect.value || 'transactions');
            dbExplorerState.page = 1;
            dbExplorerState.localRows = null;
            dbExplorerState.localCollection = '';
            configureDbFiltersForCollection(dbExplorerState.collection);
            loadDbExplorer({ forceRefresh: true, silent: false });
        });
    }

    if (elements.dbSearchInput) {
        elements.dbSearchInput.addEventListener('input', debounce((e) => {
            dbExplorerState.search = String(e.target?.value || '').trim();
            dbExplorerState.page = 1;
            loadDbExplorer({ forceRefresh: false, silent: true });
        }, 250));
    }

    [elements.dbDateFromInput, elements.dbDateToInput].forEach((input) => {
        if (!input) return;
        input.addEventListener('change', () => {
            const { from, to } = getDbDateFilterValues();
            dbExplorerState.dateFrom = from;
            dbExplorerState.dateTo = to;
            dbExplorerState.page = 1;
            loadDbExplorer({ forceRefresh: false, silent: true });
        });
    });

    if (elements.dbStatusSelect) {
        elements.dbStatusSelect.addEventListener('change', (e) => {
            dbExplorerState.status = String(e.target?.value || 'all');
            dbExplorerState.page = 1;
            loadDbExplorer({ forceRefresh: false, silent: true });
        });
    }

    if (elements.dbRefreshBtn) {
        elements.dbRefreshBtn.addEventListener('click', () => {
            dbExplorerState.search = getDbSearchValue();
            dbExplorerState.dateFrom = String(elements.dbDateFromInput?.value || '').trim();
            dbExplorerState.dateTo = String(elements.dbDateToInput?.value || '').trim();
            loadDbExplorer({ forceRefresh: true, silent: false });
        });
    }

    if (elements.dbPrevPageBtn) {
        elements.dbPrevPageBtn.addEventListener('click', () => {
            if (dbExplorerState.page <= 1) return;
            dbExplorerState.page -= 1;
            loadDbExplorer({ forceRefresh: false, silent: true });
        });
    }

    if (elements.dbNextPageBtn) {
        elements.dbNextPageBtn.addEventListener('click', () => {
            if (dbExplorerState.page >= dbExplorerState.totalPages) return;
            dbExplorerState.page += 1;
            loadDbExplorer({ forceRefresh: false, silent: true });
        });
    }

    if (elements.dbExportBtn) {
        elements.dbExportBtn.addEventListener('click', exportDbCurrentViewToCsv);
    }

    if (elements.dbExportModeSelect) {
        elements.dbExportModeSelect.addEventListener('change', () => {
            updateDbExportControlState();
            updateDbExportScopeHint();
        });
    }

    if (elements.dbExportPageInput) {
        elements.dbExportPageInput.addEventListener('input', () => {
            if (getDbExportMode() !== 'page') return;
            updateDbExportScopeHint();
        });
        elements.dbExportPageInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void exportDbCurrentViewToCsv();
        });
    }

    if (elements.dbExportRangeInput) {
        elements.dbExportRangeInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void exportDbCurrentViewToCsv();
        });
    }

    if (elements.dbTableBody) {
        elements.dbTableBody.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('[data-db-view-index]');
            if (!btn) return;
            const idx = Number(btn.getAttribute('data-db-view-index') || -1);
            if (!Number.isFinite(idx) || idx < 0) return;
            const record = Array.isArray(dbExplorerState.viewRows) ? dbExplorerState.viewRows[idx] : null;
            if (!record) return;
            const title = `${String(dbExplorerState.collection || 'record')} #${idx + 1}`;
            showDbJson(record, { title });
        });
    }

    if (elements.dbCopyJsonBtn) {
        elements.dbCopyJsonBtn.addEventListener('click', async () => {
            const ok = await copyTextToClipboard(dbLastJsonText);
            showNotification(ok ? 'Copied JSON to clipboard.' : 'Failed to copy JSON.', ok ? 'success' : 'error');
        });
    }

    // Lost reports controls
    const runLostReportsSearch = () => displayLostReports({ silent: false });

    if (elements.lostReportsSearchBtn) {
        elements.lostReportsSearchBtn.addEventListener('click', runLostReportsSearch);
    }

    if (elements.lostReportsRefreshBtn) {
        elements.lostReportsRefreshBtn.addEventListener('click', () => displayLostReports({ silent: false }));
    }

    if (elements.lostReportsSearch) {
        elements.lostReportsSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                runLostReportsSearch();
            }
        });
    }

    if (elements.lostReportsStatus) {
        elements.lostReportsStatus.addEventListener('change', () => displayLostReports({ silent: true }));
    }

    if (elements.lostReportsRead) {
        elements.lostReportsRead.addEventListener('change', () => displayLostReports({ silent: true }));
    }

    if (elements.lostReportsList) {
        elements.lostReportsList.addEventListener('click', async (e) => {
            const target = e.target instanceof Element ? e.target : null;
            if (!target) return;

            const viewBtn = target.closest('.lost-report-view-btn');
            const readBtn = target.closest('.lost-report-read-btn');
            const resolveBtn = target.closest('.lost-report-resolve-btn');
            const reopenBtn = target.closest('.lost-report-reopen-btn');
            const deleteBtn = target.closest('.lost-report-delete-btn');

            const id =
                viewBtn?.getAttribute('data-report-id')
                || readBtn?.getAttribute('data-report-id')
                || resolveBtn?.getAttribute('data-report-id')
                || reopenBtn?.getAttribute('data-report-id')
                || deleteBtn?.getAttribute('data-report-id')
                || '';

            if (!id) return;

            if (viewBtn) {
                await openLostReportModal(id);
                return;
            }
            if (readBtn) {
                await markLostReportRead(id, { silent: false });
                return;
            }
            if (resolveBtn) {
                const ok = await showConfirmDialog({
                    title: 'Resolve Lost Report',
                    message: 'Mark this lost report as resolved?',
                    confirmText: 'Resolve',
                    cancelText: 'Cancel',
                    tone: 'success'
                });
                if (!ok) return;
                await setLostReportStatus(id, 'resolved', { silent: false });
                return;
            }
            if (reopenBtn) {
                const ok = await showConfirmDialog({
                    title: 'Reopen Lost Report',
                    message: 'Reopen this lost report? It will be marked as pending again.',
                    confirmText: 'Reopen',
                    cancelText: 'Cancel',
                    tone: 'warning'
                });
                if (!ok) return;
                await setLostReportStatus(id, 'pending', { silent: false });
                return;
            }
            if (deleteBtn) {
                const report = getLostReportFromCache(id);
                const keyId = String(report?.keyId || '').trim().toUpperCase();
                const ok = await showConfirmDialog({
                    title: 'Delete Lost Report',
                    message: `Delete this resolved lost report${keyId ? ` (${keyId})` : ''}? This cannot be undone.`,
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                    tone: 'danger'
                });
                if (!ok) return;

                try {
                    await deleteLostReport(id, { silent: true });
                    showNotification('Lost report deleted.', 'success');
                    await displayLostReports({ silent: true });
                    refreshDatabaseHubAfterMutation(['lostreports', 'logs']);
                } catch (error) {
                    console.error('Lost report delete error:', error);
                    showNotification(error?.message || 'Failed to delete lost report', 'error');
                }
            }
        });
    }

    if (elements.lostReportDeleteBtn) {
        elements.lostReportDeleteBtn.addEventListener('click', async () => {
            const id = String(activeLostReportId || '').trim();
            if (!id) return;

            const report = getLostReportFromCache(id);
            const statusRaw = String(report?.status || elements.lostReportStatusSelect?.value || 'pending').trim().toLowerCase();
            const status = statusRaw === 'open' ? 'pending' : statusRaw;
            if (status !== 'resolved') {
                showNotification('Only resolved lost reports can be deleted.', 'error');
                return;
            }

            const keyId = String(report?.keyId || '').trim().toUpperCase();
            const ok = await showConfirmDialog({
                title: 'Delete Lost Report',
                message: `Delete this resolved lost report${keyId ? ` (${keyId})` : ''}? This cannot be undone.`,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                tone: 'danger'
            });
            if (!ok) return;

            const btn = elements.lostReportDeleteBtn;
            const prevText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Deleting…';

            try {
                await deleteLostReport(id, { silent: true });
                showNotification('Lost report deleted.', 'success');
                hideModal(elements.lostReportModal);
                activeLostReportId = null;
                await displayLostReports({ silent: true });
                refreshDatabaseHubAfterMutation(['lostreports', 'logs']);
            } catch (error) {
                console.error('Lost report delete error:', error);
                showNotification(error?.message || 'Failed to delete lost report', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = prevText || 'Delete';
            }
        });
    }

    if (elements.lostReportMarkReadBtn) {
        elements.lostReportMarkReadBtn.addEventListener('click', async () => {
            const id = String(activeLostReportId || '').trim();
            if (!id) return;
            await markLostReportRead(id, { silent: false });
            const report = getLostReportFromCache(id);
            if (report) {
                renderLostReportModalDetails(report);
                syncLostReportModalButtons(report);
            }
        });
    }

    if (elements.lostReportSaveBtn) {
        elements.lostReportSaveBtn.addEventListener('click', saveLostReportFromModal);
    }

    // Maintenance controls
    if (elements.maintenanceResetBtn) {
        elements.maintenanceResetBtn.addEventListener('click', () => {
            resetMaintenanceFormToDefault();
        });
    }

    if (elements.maintenanceSaveBtn) {
        elements.maintenanceSaveBtn.addEventListener('click', () => {
            saveMaintenanceSettings();
        });
    }

    if (elements.maintenanceEnabledToggle) {
        elements.maintenanceEnabledToggle.addEventListener('change', () => {
            syncMaintenanceStatusBadge();
            syncMaintenancePreviewFromForm();
        });
    }

    if (elements.maintenanceTitleInput) {
        elements.maintenanceTitleInput.addEventListener('input', debounce(() => {
            syncMaintenancePreviewFromForm();
        }, 80));
    }

    if (elements.maintenanceMessageInput) {
        elements.maintenanceMessageInput.addEventListener('input', debounce(() => {
            syncMaintenancePreviewFromForm();
        }, 80));
    }

    // Modal close buttons (support .close and .close-*)
    document.querySelectorAll('.close, [class*="close-"]').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) hideModal(modal);
        });
    });

    // Add locker button
    const addLockerBtn = document.getElementById('addLockerBtn');
    if (addLockerBtn) {
        addLockerBtn.addEventListener('click', () => {
            const addLockerNameInput = document.getElementById('addLockerName');
            if (addLockerNameInput && !addLockerNameInput.value.trim()) {
                addLockerNameInput.value = suggestNextLockerName();
            }
            showModal(elements.addLockerModal);
            setTimeout(() => addLockerNameInput?.focus(), 0);
        });
    }

    if (elements.exportAllQrPdfBtn) {
        elements.exportAllQrPdfBtn.addEventListener('click', () => {
            exportAllManageKeysQrCodes();
        });
    }

    // Add locker form
    const confirmAddLockerBtn = document.getElementById('confirmAddLockerBtn');
    if (confirmAddLockerBtn) {
        confirmAddLockerBtn.addEventListener('click', addLocker);
    }
    const addLockerNameInput = document.getElementById('addLockerName');
    const addLockerHardwareInput = document.getElementById('addLockerHardwareNumber');
    if (addLockerNameInput) {
        if (addLockerHardwareInput) {
            addLockerNameInput.addEventListener('input', () => {
                if (String(addLockerHardwareInput.value || '').trim()) return;
                const match = /^locker\s*(\d+)$/i.exec(addLockerNameInput.value.trim());
                if (match) {
                    addLockerHardwareInput.value = match[1];
                }
            });
        }
        addLockerNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addLocker();
        });
    }

    // Add key form
    const confirmAddKeyBtn = document.getElementById('confirmAddKeyBtn');
    if (confirmAddKeyBtn) {
        confirmAddKeyBtn.addEventListener('click', addKey);
    }

    // Auto-suggest locker based on keyId (only if locker is blank)
    const addKeyIdInput = document.getElementById('addKeyId');
    const addKeyLockerInput = document.getElementById('addKeyLocker');
    if (addKeyIdInput && addKeyLockerInput) {
        addKeyIdInput.addEventListener('input', () => {
            if (addKeyLockerInput.value.trim()) return;
            const derived = deriveLockerFromKeyId(addKeyIdInput.value.trim().toUpperCase());
            if (derived) addKeyLockerInput.value = derived;
        });
    }

    // Edit key form
    const confirmEditKeyBtn = document.getElementById('confirmEditKeyBtn');
    if (confirmEditKeyBtn) {
        confirmEditKeyBtn.addEventListener('click', updateKey);
    }

    // Delete key confirmation
    const confirmDeleteKeyBtn = document.getElementById('confirmDeleteKeyBtn');
    if (confirmDeleteKeyBtn) {
        confirmDeleteKeyBtn.addEventListener('click', deleteKey);
    }

    const cancelDeleteKeyBtn = document.getElementById('cancelDeleteKeyBtn');
    if (cancelDeleteKeyBtn) {
        cancelDeleteKeyBtn.addEventListener('click', () => {
            hideModal(elements.deleteKeyModal);
        });
    }

    // Generate QR code
    const confirmGenerateQRBtn = document.getElementById('confirmGenerateQRBtn');
    if (confirmGenerateQRBtn) {
        confirmGenerateQRBtn.addEventListener('click', generateQRCode);
    }

    // Download QR code
    const downloadQRBtn = document.getElementById('downloadQRBtn');
    if (downloadQRBtn) {
        downloadQRBtn.addEventListener('click', downloadQRCode);
    }

    const confirmAddAdminBtn = document.getElementById('confirmAddAdminBtn');
    if (confirmAddAdminBtn) {
        confirmAddAdminBtn.addEventListener('click', addAdmin);
    }

    const addAdminBtn = document.getElementById('addAdminBtn');
    if (addAdminBtn) {
        addAdminBtn.addEventListener('click', () => showModal(elements.addAdminModal));
    }

    const qrcodeStatusToggleBar = document.getElementById('qrcodeStatusToggleBar');
    if (qrcodeStatusToggleBar) {
        qrcodeStatusToggleBar.querySelectorAll('[data-qrcode-status]').forEach((btn) => {
            btn.addEventListener('click', () => {
                qrcodeStatus = btn.dataset.qrcodeStatus || 'all';
                qrcodeStatusToggleBar.querySelectorAll('[data-qrcode-status]').forEach((b) => {
                    b.classList.toggle('active', b === btn);
                });
                displayQRCodesManagement();
            });
        });
    }

    const qrcodeSearch = document.getElementById('qrcodeSearch');
    if (qrcodeSearch) {
        qrcodeSearch.addEventListener('input', debounce(() => {
            displayQRCodesManagement();
        }, 300));
    }

    const recentActivitySearchBtn = document.getElementById('recentActivitySearchBtn');
    if (recentActivitySearchBtn) {
        recentActivitySearchBtn.addEventListener('click', displayRecentActivity);
    }
    const recentActivitySearch = document.getElementById('recentActivitySearch');
    if (recentActivitySearch) {
        recentActivitySearch.addEventListener('input', debounce(displayRecentActivity, 300));
    }
    [elements.recentActivityDateFrom, elements.recentActivityDateTo].forEach((input) => {
        if (!input) return;
        input.addEventListener('change', () => {
            displayRecentActivity();
        });
    });
    if (elements.recentActivityExportExcelBtn) {
        elements.recentActivityExportExcelBtn.addEventListener('click', () => exportRecentActivity('excel'));
    }
    if (elements.recentActivityExportPdfBtn) {
        elements.recentActivityExportPdfBtn.addEventListener('click', () => exportRecentActivity('pdf'));
    }

    if (elements.logsFilterAll || elements.logsFilterPhotos) {
        const applyLogsCategory = (category) => {
            logsCategory = category;
            if (elements.logsFilterAll) {
                elements.logsFilterAll.classList.toggle('active', logsCategory === 'all');
            }
            if (elements.logsFilterPhotos) {
                elements.logsFilterPhotos.classList.toggle('active', logsCategory === 'profile_photo');
            }
            const value = document.getElementById('logsSearch')?.value?.trim() || '';
            displayActivityLogs(value, logsCategory);
        };

        if (elements.logsFilterAll) {
            elements.logsFilterAll.addEventListener('click', () => applyLogsCategory('all'));
        }
        if (elements.logsFilterPhotos) {
            elements.logsFilterPhotos.addEventListener('click', () => applyLogsCategory('profile_photo'));
        }
    }

    const logsSearchBtn = document.getElementById('logsSearchBtn');
    if (logsSearchBtn) {
        logsSearchBtn.addEventListener('click', () => {
            const value = document.getElementById('logsSearch')?.value?.trim() || '';
            displayActivityLogs(value, logsCategory);
        });
    }
    const logsSearch = document.getElementById('logsSearch');
    if (logsSearch) {
        logsSearch.addEventListener('input', debounce((e) => {
            displayActivityLogs(e.target.value.trim(), logsCategory);
        }, 300));
    }

    const feedbackSearchBtn = document.getElementById('feedbackSearchBtn');
    if (feedbackSearchBtn) {
        feedbackSearchBtn.addEventListener('click', () => {
            const value = document.getElementById('feedbackSearch')?.value?.trim() || '';
            displayFeedback(value);
        });
    }
    const feedbackSearch = document.getElementById('feedbackSearch');
    if (feedbackSearch) {
        feedbackSearch.addEventListener('input', debounce((e) => {
            displayFeedback(e.target.value.trim());
        }, 300));
    }
    const feedbackStatus = document.getElementById('feedbackStatus');
    if (feedbackStatus) {
        feedbackStatus.addEventListener('change', () => {
            const value = document.getElementById('feedbackSearch')?.value?.trim() || '';
            displayFeedback(value);
        });
    }

    const adminSearch = document.getElementById('adminSearch');
    if (adminSearch) {
        adminSearch.addEventListener('input', debounce((e) => {
            displayAdmins(e.target.value.trim());
        }, 300));
    }

    const addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => showModal(elements.addUserModal));
    }

    const confirmAddUserBtn = document.getElementById('confirmAddUserBtn');
    if (confirmAddUserBtn) {
        confirmAddUserBtn.addEventListener('click', addUser);
    }

    const confirmResetUserPasswordBtn = document.getElementById('confirmResetUserPasswordBtn');
    if (confirmResetUserPasswordBtn) {
        confirmResetUserPasswordBtn.addEventListener('click', resetUserPassword);
    }

    const confirmResetAdminPasswordBtn = document.getElementById('confirmResetAdminPasswordBtn');
    if (confirmResetAdminPasswordBtn) {
        confirmResetAdminPasswordBtn.addEventListener('click', resetAdminPassword);
    }

    const userSearch = document.getElementById('userSearch');
    if (userSearch) {
        userSearch.addEventListener('input', debounce((e) => {
            displayUsers(e.target.value.trim());
        }, 300));
    }

    const refreshApprovalsBtn = document.getElementById('refreshApprovalsBtn');
    if (refreshApprovalsBtn) {
        refreshApprovalsBtn.addEventListener('click', () => {
            const value = document.getElementById('approvalsSearch')?.value?.trim() || '';
            displayPendingApprovals(value);
        });
    }

    const approvalsSearch = document.getElementById('approvalsSearch');
    if (approvalsSearch) {
        approvalsSearch.addEventListener('input', debounce((e) => {
            displayPendingApprovals(e.target.value.trim());
        }, 300));
    }

    // Announcements management
    if (elements.announcementImageInput) {
        elements.announcementImageInput.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            if (!file) {
                announcementImageDataUrl = '';
                setImagePreview(elements.announcementImagePreview, '');
                return;
            }
            try {
                announcementImageDataUrl = await fileToDataUrl(file, { maxBytes: 2 * 1024 * 1024 });
                setImagePreview(elements.announcementImagePreview, announcementImageDataUrl);
            } catch (error) {
                announcementImageDataUrl = '';
                if (elements.announcementImageInput) elements.announcementImageInput.value = '';
                setImagePreview(elements.announcementImagePreview, '');
                showNotification(error.message || 'Invalid image file', 'error');
            }
        });
    }

    if (elements.popupImageInput) {
        elements.popupImageInput.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            if (!file) {
                popupImageDataUrl = '';
                setImagePreview(elements.popupImagePreview, '');
                return;
            }
            try {
                popupImageDataUrl = await fileToDataUrl(file, { maxBytes: 2 * 1024 * 1024 });
                setImagePreview(elements.popupImagePreview, popupImageDataUrl);
            } catch (error) {
                popupImageDataUrl = '';
                if (elements.popupImageInput) elements.popupImageInput.value = '';
                setImagePreview(elements.popupImagePreview, '');
                showNotification(error.message || 'Invalid image file', 'error');
            }
        });
    }

    if (elements.announceBtn) {
        elements.announceBtn.addEventListener('click', publishNotificationAnnouncement);
    }

    if (elements.publishPopupBtn) {
        elements.publishPopupBtn.addEventListener('click', publishPopupAnnouncement);
    }

    if (elements.refreshAnnouncementsBtn) {
        elements.refreshAnnouncementsBtn.addEventListener('click', loadAdminAnnouncements);
    }

    // Print QR code
    const printQRBtn = document.getElementById('printQRBtn');
    if (printQRBtn) {
        printQRBtn.addEventListener('click', printQRCode);
    }

    // Click outside modal to close
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            hideModal(e.target);
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.body.classList.contains('keys-fullscreen')) {
                setKeysOverviewFullscreen(false);
                return;
            }
            document.querySelectorAll('.modal.show').forEach(modal => {
                hideModal(modal);
            });
        }
    });
}

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAdminAuth()) return;

    setDbLiveEnabled(readDbLivePreference(), { persist: false });
    startDatabaseHubLiveUpdates();

    // Apply permissions before wiring up nav
    const canManageAdmins = canCurrentAdminManageAdmins();
    if (!canManageAdmins) {
        if (elements.manageAdminsBtn) elements.manageAdminsBtn.classList.add('hidden');
        if (elements.manageAdminsSection) elements.manageAdminsSection.classList.add('hidden');
        const addAdminBtn = document.getElementById('addAdminBtn');
        if (addAdminBtn) addAdminBtn.classList.add('hidden');

        // Hide Admins collection in Database hub for non-privileged admins.
        const adminsOption = elements.dbCollectionSelect?.querySelector?.('option[value="admins"]') || null;
        if (adminsOption && adminsOption.parentNode) {
            adminsOption.parentNode.removeChild(adminsOption);
        }
    }

    updateAdminDrawerSubtitle();
    setActiveAdminNav('adminOverviewSection');

    setupEventListeners();
    initializeAdminDashboard();

    window.addEventListener('resize', debounce(() => {
        if (!elements.chartsSection.classList.contains('hidden')) {
            initializeCharts();
        }
    }, 300));

    // Auto-refresh dashboard every 5 seconds
    setInterval(() => {
        const now = Date.now();
        if (!elements.adminOverviewSection.classList.contains('hidden')) {
            displayAdminOverview();
            displayRecentActivity();
            displayAdminKeysOverview();
        }
        if (!elements.chartsSection.classList.contains('hidden')) {
            initializeCharts();
        }
        if (isLostReportsVisible() && shouldAutoRefreshLostReports()) {
            if (now - lostReportsLastLoadedAt > LOST_REPORTS_REFRESH_MS) {
                displayLostReports({ silent: true });
            }
        }
        if (!elements.activityLogsSection.classList.contains('hidden')) {
            const value = document.getElementById('logsSearch')?.value?.trim() || '';
            displayActivityLogs(value);
        }
        if (!elements.feedbackSection.classList.contains('hidden')) {
            const value = document.getElementById('feedbackSearch')?.value?.trim() || '';
            displayFeedback(value);
        }
        if (!elements.settingsSection.classList.contains('hidden')) {
            const value = document.getElementById('userSearch')?.value?.trim() || '';
            displayUsers(value);
            const approvalsValue = document.getElementById('approvalsSearch')?.value?.trim() || '';
            displayPendingApprovals(approvalsValue);
            loadSystemConfigurationStatus({ silent: true });
            loadAccessQrPack({ silent: true });
        }
    }, 5000);
});
