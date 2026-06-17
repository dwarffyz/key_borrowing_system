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

const LIVE_SCAN_FRAME_INTERVAL_MS = 140;
const LIVE_SCAN_MAX_DIMENSIONS = [960, 760];
const LIVE_SCAN_CROP_RATIOS = [0.72, 0.86, 1];
const QR_INVERSION_MODES = ['dontInvert', 'attemptBoth'];

// DOM Elements
const elements = {
    backBtn: document.getElementById('backBtn'),
    startScanBtn: document.getElementById('startScanBtn'),
    scanFallbackHint: document.getElementById('scanFallbackHint'),
    scanMessage: document.getElementById('scanMessage'),
    currentDateTime: document.getElementById('currentDateTime'),
    camera: document.getElementById('camera'),
    canvas: document.getElementById('canvas'),
    actionIndicator: document.getElementById('actionIndicator'),
    scannerStatus: document.getElementById('scannerStatus'),
    scannerEmptyState: document.getElementById('scannerEmptyState')
};

// State
let currentStream = null;
let isScanning = false;
let scanFrameRequestId = null;
let frameScanBusy = false;
let barcodeDetector = null;
let barcodeDetectorChecked = false;
let userData = null;
let lastErrorMessage = '';
let lastErrorAt = 0;
let lastFrameScanAt = 0;
let consecutiveFrameMisses = 0;
let runtimeConfig = null;
const urlParams = new URLSearchParams(window.location.search);
const expectedKeyId = String(urlParams.get('key') || '').trim().toUpperCase();
const expectedIntentRaw = String(urlParams.get('intent') || '').trim().toLowerCase();
const expectedIntent = (expectedIntentRaw === 'borrow' || expectedIntentRaw === 'return')
    ? expectedIntentRaw
    : '';

function getScanTargetLabel() {
    return expectedKeyId ? `key ${expectedKeyId}` : 'any valid admin key';
}

function canUseLiveCamera() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const hostname = String(window.location.hostname || '').trim().toLowerCase();
    const hasCameraApi = Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    if (!hasCameraApi) return false;
    return Boolean(window.isSecureContext) || hostname === 'localhost' || hostname === '127.0.0.1';
}

function setScanFallbackHintVisible(visible) {
    if (!elements.scanFallbackHint) return;
    elements.scanFallbackHint.hidden = !visible;
}

function getSecureScannerUrl() {
    const raw = String(runtimeConfig?.localHttps?.scannerUrl || '').trim();
    if (!raw || window.location.protocol === 'https:') return '';

    try {
        const url = new URL(raw);
        url.search = window.location.search;
        return url.toString();
    } catch {
        return '';
    }
}

function ensureSecureScannerShortcut() {
    const secureUrl = getSecureScannerUrl();
    if (!secureUrl) return;

    const buildButton = (id, label) => {
        let button = document.getElementById(id);
        if (button) return button;

        button = document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.className = 'scan-btn';
        button.textContent = label;
        button.addEventListener('click', () => {
            stopCamera();
            window.location.href = secureUrl;
        });
        return button;
    };

    const topControls = document.querySelector('.scan-controls');
    if (topControls && !document.getElementById('openSecureScanBtn')) {
        topControls.appendChild(buildButton('openSecureScanBtn', 'Open Secure Scanner'));
    }

    const emptyActions = document.querySelector('.scanner-empty-actions');
    if (emptyActions && !document.getElementById('openSecureScanFallbackBtn')) {
        emptyActions.appendChild(buildButton('openSecureScanFallbackBtn', 'Use Secure Camera'));
    }

    if (elements.scanFallbackHint) {
        elements.scanFallbackHint.hidden = false;
        elements.scanFallbackHint.textContent = 'Live camera scan needs HTTPS on most phones. Open the secure scanner if it is available.';
    }
}

function setScanButtonsForMode() {
    if (elements.startScanBtn) {
        elements.startScanBtn.textContent = 'Start Live Scanner';
    }
}

function setScannerSurfaceMode(mode) {
    const liveMode = mode === 'live';
    const camera = elements.camera;
    const overlay = document.querySelector('.qr-overlay');
    const emptyState = elements.scannerEmptyState;
    const videoContainer = camera ? camera.closest('.video-container') : null;

    if (videoContainer) {
        videoContainer.classList.toggle('video-container--fallback', !liveMode);
    }

    if (camera) {
        camera.hidden = !liveMode;
    }

    if (overlay) {
        overlay.hidden = !liveMode;
    }

    if (emptyState) {
        emptyState.hidden = liveMode;
    }
}

function getBarcodeDetector() {
    if (barcodeDetectorChecked) return barcodeDetector;
    barcodeDetectorChecked = true;
    if (typeof window === 'undefined' || typeof window.BarcodeDetector === 'undefined') {
        barcodeDetector = null;
        return barcodeDetector;
    }

    try {
        barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (error) {
        console.warn('BarcodeDetector unavailable, falling back to jsQR.', error);
        barcodeDetector = null;
    }
    return barcodeDetector;
}

async function loadRuntimeConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/system/runtime-config`, {
            cache: 'no-store'
        });
        const data = await safeReadJson(response);
        if (!response.ok || !data?.success) return;
        runtimeConfig = data.runtime || null;
        ensureSecureScannerShortcut();
    } catch {
        runtimeConfig = null;
    }
}

function buildCenteredCrop(sourceWidth, sourceHeight, cropRatio = 1) {
    const safeRatio = Math.min(1, Math.max(0.3, Number(cropRatio) || 1));
    const cropWidth = Math.max(1, Math.round(sourceWidth * safeRatio));
    const cropHeight = Math.max(1, Math.round(sourceHeight * safeRatio));
    const sx = Math.max(0, Math.round((sourceWidth - cropWidth) / 2));
    const sy = Math.max(0, Math.round((sourceHeight - cropHeight) / 2));

    return {
        sx,
        sy,
        sw: cropWidth,
        sh: cropHeight
    };
}

function drawDecodeFrame(canvas, context, source, sourceWidth, sourceHeight, {
    cropRatio = 1,
    maxDimension = 960
} = {}) {
    const crop = buildCenteredCrop(sourceWidth, sourceHeight, cropRatio);
    const longestSide = Math.max(crop.sw, crop.sh);
    const scale = longestSide > maxDimension ? (maxDimension / longestSide) : 1;
    const targetWidth = Math.max(1, Math.round(crop.sw * scale));
    const targetHeight = Math.max(1, Math.round(crop.sh * scale));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = scale < 1 ? 'high' : 'medium';
    context.drawImage(
        source,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        targetWidth,
        targetHeight
    );
}

function decodeQrFromCanvas(canvas, context, inversionMode = 'dontInvert') {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: inversionMode
    });
    return String(code?.data || '').trim();
}

async function tryDetectQrWithBarcodeDetector(source) {
    const detector = getBarcodeDetector();
    if (!detector || !source) return '';

    try {
        const detections = await detector.detect(source);
        return String(detections?.[0]?.rawValue || '').trim();
    } catch {
        return '';
    }
}

async function decodeQrFromSource(source, {
    sourceWidth,
    sourceHeight,
    detectorSource = null,
    maxDimensions = [960],
    cropRatios = [1],
    inversionModes = ['dontInvert'],
    workCanvas = null,
    workContext = null,
    runDetectorFirst = true,
    detectorOnDrawnFrame = false
} = {}) {
    if (runDetectorFirst) {
        const detectedValue = await tryDetectQrWithBarcodeDetector(detectorSource || source);
        if (detectedValue) {
            return detectedValue;
        }
    }

    const canvas = workCanvas || document.createElement('canvas');
    const context = workContext || canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
        throw new Error('This browser cannot process camera frames right now.');
    }

    for (const maxDimension of maxDimensions) {
        for (const cropRatio of cropRatios) {
            drawDecodeFrame(canvas, context, source, sourceWidth, sourceHeight, {
                cropRatio,
                maxDimension
            });

            if (detectorOnDrawnFrame) {
                const detectorValue = await tryDetectQrWithBarcodeDetector(canvas);
                if (detectorValue) {
                    return detectorValue;
                }
            }

            for (const inversionMode of inversionModes) {
                const rawValue = decodeQrFromCanvas(canvas, context, inversionMode);
                if (rawValue) {
                    return rawValue;
                }
            }
        }
    }

    return '';
}

function getLiveDecodePlan() {
    if (consecutiveFrameMisses < 5) {
        return {
            maxDimensions: [LIVE_SCAN_MAX_DIMENSIONS[0]],
            cropRatios: [LIVE_SCAN_CROP_RATIOS[0], LIVE_SCAN_CROP_RATIOS[2]],
            inversionModes: [QR_INVERSION_MODES[0]]
        };
    }

    if (consecutiveFrameMisses < 15) {
        return {
            maxDimensions: LIVE_SCAN_MAX_DIMENSIONS,
            cropRatios: LIVE_SCAN_CROP_RATIOS,
            inversionModes: QR_INVERSION_MODES
        };
    }

    return {
        maxDimensions: [1080, ...LIVE_SCAN_MAX_DIMENSIONS],
        cropRatios: LIVE_SCAN_CROP_RATIOS,
        inversionModes: QR_INVERSION_MODES
    };
}

async function waitForVideoReady(videoElement) {
    if (!videoElement) return;
    if (videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) return;

    await new Promise((resolve) => {
        const finish = () => {
            videoElement.removeEventListener('loadedmetadata', finish);
            videoElement.removeEventListener('canplay', finish);
            resolve();
        };

        videoElement.addEventListener('loadedmetadata', finish, { once: true });
        videoElement.addEventListener('canplay', finish, { once: true });
        window.setTimeout(finish, 1500);
    });
}

async function tryOptimizeCameraTrack(stream) {
    const track = stream?.getVideoTracks?.()[0];
    if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') {
        return;
    }

    try {
        const capabilities = track.getCapabilities();
        const advanced = [];

        if (Array.isArray(capabilities.focusMode)) {
            if (capabilities.focusMode.includes('continuous')) {
                advanced.push({ focusMode: 'continuous' });
            } else if (capabilities.focusMode.includes('single-shot')) {
                advanced.push({ focusMode: 'single-shot' });
            }
        }

        if (capabilities.zoom && Number.isFinite(capabilities.zoom.max)) {
            const zoomMin = Number.isFinite(capabilities.zoom.min) ? capabilities.zoom.min : 1;
            const zoomTarget = Math.min(capabilities.zoom.max, Math.max(zoomMin, 1.6));
            if (zoomTarget > zoomMin) {
                advanced.push({ zoom: zoomTarget });
            }
        }

        if (advanced.length > 0) {
            await track.applyConstraints({ advanced });
        }
    } catch {
        // Ignore unsupported focus/zoom controls.
    }
}

function extractScannedKeyId(rawQrData) {
    const raw = String(rawQrData || '').trim();
    if (!raw) return '';

    try {
        const parsed = JSON.parse(raw);
        const keyId = String(parsed?.keyId || '').trim().toUpperCase();
        if (/^KEY\d{3}$/.test(keyId)) return keyId;
    } catch {
        // fallback below
    }

    const match = /\bKEY\d{3}\b/i.exec(raw);
    return match ? match[0].toUpperCase() : '';
}

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

    const storedData = localStorage.getItem('userData');
    if (storedData) {
        userData = JSON.parse(storedData);
    }

    return true;
}

function updateDateTime() {
    if (elements.currentDateTime) {
        const now = new Date();
        elements.currentDateTime.textContent = now.toLocaleString();
    }
}

function showMessage(message, type = 'info') {
    const scanMessage = elements.scanMessage;
    if (!scanMessage) return;

    scanMessage.textContent = message;
    scanMessage.className = `scan-message ${type}`;
    scanMessage.style.display = 'block';

    if (type !== 'error') {
        setTimeout(() => {
            scanMessage.style.display = 'none';
        }, 3000);
    }
}

function updateActionUI() {
    if (elements.actionIndicator) {
        const keyPart = expectedKeyId ? `Key ${expectedKeyId}` : 'Any valid key';
        const intentPart = expectedIntent ? ` (${expectedIntent})` : ' (auto)';
        elements.actionIndicator.textContent = `${keyPart}${intentPart}`;
    }
    if (elements.startScanBtn) {
        elements.startScanBtn.classList.add('active');
    }
}

function updateScannerStatus(status) {
    if (elements.scannerStatus) {
        elements.scannerStatus.textContent = status;
    }
}

function shouldNotify(message, cooldownMs = 2500) {
    const now = Date.now();
    if (message === lastErrorMessage && (now - lastErrorAt) < cooldownMs) {
        return false;
    }
    lastErrorMessage = message;
    lastErrorAt = now;
    return true;
}

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
    }, 5000);
}

async function safeReadJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = 3500) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(resource, {
            ...options,
            signal: controller.signal
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function buildDirectUnlockCandidates(urls) {
    const seen = new Set();
    const candidates = [];

    (Array.isArray(urls) ? urls : []).forEach((value) => {
        const raw = String(value || '').trim();
        if (!raw || seen.has(raw)) return;
        seen.add(raw);
        candidates.push(raw);
    });

    return candidates;
}

async function triggerLockerDirectly(urls) {
    const candidates = buildDirectUnlockCandidates(urls);
    if (candidates.length === 0) {
        throw new Error('No direct ESP unlock URL is available.');
    }

    let lastError = null;
    for (const candidate of candidates) {
        try {
            const url = new URL(candidate);
            url.searchParams.set('_ts', String(Date.now()));

            if (window.location.protocol === 'https:') {
                await triggerLockerWithBeacon(url.toString());
            } else {
                await fetchWithTimeout(url.toString(), {
                    method: 'GET',
                    mode: 'no-cors',
                    cache: 'no-store'
                }, 2500);
            }

            return { success: true, url: url.toString() };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Direct ESP unlock failed');
}

function triggerLockerWithBeacon(url, timeoutMs = 1800) {
    return new Promise((resolve) => {
        const image = new Image();
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve();
        };
        const timer = window.setTimeout(finish, timeoutMs);

        image.onload = finish;
        image.onerror = finish;
        image.src = url;
    });
}

async function waitForServerRetry(delayMs = 900) {
    await new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
    });
}

async function submitScanRequest(payload) {
    const token = localStorage.getItem('userToken');
    const response = await fetch(`${API_BASE_URL}/qrcodes/scan`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    const data = await safeReadJson(response);
    return { response, data };
}

function handleScanSuccess(data, scannedKey) {
    const action = String(data?.action || '').trim().toLowerCase();
    const actionText = action === 'return' ? 'returned' : 'borrowed';
    const keyLabel = String(data?.keyId || scannedKey || expectedKeyId || '').trim().toUpperCase();
    const hardwareLockNumber = Number(data?.hardwareLockNumber || 0) || 0;
    const controllerMode = String(data?.controllerMode || '').trim().toLowerCase();
    const viaLabel = controllerMode === 'client-direct'
        ? ' via direct ESP unlock'
        : controllerMode === 'server-serial'
            ? ' via USB serial'
            : '';
    const successMessage = keyLabel
        ? `${keyLabel} ${actionText} successfully${hardwareLockNumber ? ` (Locker ${hardwareLockNumber} opened${viaLabel})` : ''}!`
        : `Key ${actionText} successfully!`;

    showMessage(successMessage, 'success');
    showNotification(successMessage, 'success');
    updateScannerStatus(`Completed (${action || 'auto'})`);

    setTimeout(() => {
        stopCamera();
        window.location.href = ROUTES.dashboard;
    }, 900);
}

async function startCamera() {
    if (currentStream) {
        stopCamera();
    }

    try {
        if (!canUseLiveCamera()) {
            const secureUrl = getSecureScannerUrl();
            const message = secureUrl
                ? 'This page cannot start the live camera here. Opening the secure scanner now.'
                : 'This page cannot start the live camera here. Open the secure scanner first.';
            setScannerSurfaceMode('fallback');
            setScanButtonsForMode();
            updateActionUI();
            updateScannerStatus(secureUrl ? 'Opening secure scanner...' : 'Secure scanner required');
            setScanFallbackHintVisible(true);
            showMessage(message, 'warning');
            if (secureUrl) {
                window.setTimeout(() => {
                    window.location.href = secureUrl;
                }, 250);
            }
            return;
        }

        setScannerSurfaceMode('live');
        setScanButtonsForMode();
        updateActionUI();
        updateScannerStatus('Starting scanner...');
        showMessage(
            expectedKeyId
                ? `Starting camera for ${expectedKeyId}...`
                : 'Starting camera for QR scan...',
            'info'
        );

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        if (elements.camera) {
            elements.camera.srcObject = stream;
            await waitForVideoReady(elements.camera);
            await elements.camera.play().catch(() => {});
        }
        currentStream = stream;
        await tryOptimizeCameraTrack(stream);

        startQRScanning();
        updateScannerStatus('Scanning (auto mode)');
        showMessage(
            expectedKeyId
                ? `Camera started. Scan QR for ${expectedKeyId}.`
                : 'Camera started. Scan any valid admin QR.',
            'success'
        );
    } catch (error) {
        console.error('Error accessing camera:', error);
        setScannerSurfaceMode('fallback');
        setScanButtonsForMode();
        updateScannerStatus('Camera unavailable');
        setScanFallbackHintVisible(true);
        const secureUrl = getSecureScannerUrl();
        const message = canUseLiveCamera()
            ? 'Camera access denied. Please allow camera permissions or open the secure scanner.'
            : secureUrl
                ? 'Live camera scanning is blocked on this page. Open the secure scanner instead.'
                : 'Live camera scanning is blocked on this page. Use the secure scanner link first.';
        showMessage(message, 'error');
        showNotification(message, 'error');
    }
}

function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
        currentStream = null;
    }
    if (scanFrameRequestId) {
        cancelAnimationFrame(scanFrameRequestId);
        scanFrameRequestId = null;
    }
    frameScanBusy = false;
    isScanning = false;
    lastFrameScanAt = 0;
    consecutiveFrameMisses = 0;
    if (!canUseLiveCamera()) {
        setScannerSurfaceMode('fallback');
    }
    updateScannerStatus('Scanner idle');
}

function startQRScanning() {
    if (!currentStream || isScanning) return;

    isScanning = true;
    frameScanBusy = false;
    const canvas = elements.canvas;
    const camera = elements.camera;

    if (!canvas || !camera) return;

    if (typeof jsQR === 'undefined') {
        console.error('jsQR library not loaded');
        updateScannerStatus('Scanner unavailable');
        showMessage('QR code scanner library not loaded. Please refresh the page.', 'error');
        showNotification('QR code scanner library not loaded. Please refresh the page.', 'error');
        isScanning = false;
        return;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });

    const scheduleNextFrame = () => {
        if (!isScanning || !currentStream) return;
        scanFrameRequestId = requestAnimationFrame(() => {
            void scanFrame();
        });
    };

    const scanFrame = async () => {
        if (!isScanning || !currentStream) return;
        if (frameScanBusy) {
            scheduleNextFrame();
            return;
        }

        const now = Date.now();
        if ((now - lastFrameScanAt) < LIVE_SCAN_FRAME_INTERVAL_MS) {
            scheduleNextFrame();
            return;
        }

        if (camera.readyState !== camera.HAVE_ENOUGH_DATA) {
            scheduleNextFrame();
            return;
        }

        frameScanBusy = true;
        lastFrameScanAt = now;
        let rawValue = '';

        try {
            const decodePlan = getLiveDecodePlan();
            rawValue = await decodeQrFromSource(camera, {
                sourceWidth: camera.videoWidth,
                sourceHeight: camera.videoHeight,
                detectorSource: camera,
                maxDimensions: decodePlan.maxDimensions,
                cropRatios: decodePlan.cropRatios,
                inversionModes: decodePlan.inversionModes,
                workCanvas: canvas,
                workContext: context
            });

            if (rawValue) {
                isScanning = false;
                consecutiveFrameMisses = 0;
                updateScannerStatus('Processing QR...');
                await handleScannedQRCode(rawValue);
                return;
            }

            consecutiveFrameMisses += 1;
        } finally {
            frameScanBusy = false;
        }

        scheduleNextFrame();
    };

    void scanFrame();
}

async function handleScannedQRCode(qrData) {
    try {
        showMessage('Processing QR code...', 'info');
        const normalizedRaw = String(qrData || '').trim();
        if (!normalizedRaw) {
            showMessage('Invalid QR code data', 'error');
            showNotification('Invalid QR code data', 'error');
            updateScannerStatus('Invalid QR');
            startQRScanning();
            return;
        }

        const scannedKey = extractScannedKeyId(normalizedRaw);
        if (expectedKeyId && scannedKey && scannedKey !== expectedKeyId) {
            const msg = `Wrong QR. Selected key is ${expectedKeyId}, but scanned ${scannedKey}.`;
            showMessage(msg, 'error');
            if (shouldNotify(msg)) {
                showNotification(msg, 'error');
            }
            updateScannerStatus('Wrong key QR');
            setTimeout(() => {
                if (currentStream) startQRScanning();
            }, 700);
            return;
        }

        let { response, data } = await submitScanRequest({
            qrData: normalizedRaw,
            expectedKeyId: expectedKeyId || undefined,
            intent: expectedIntent || undefined
        });

        if (!response.ok) {
            const shouldTryDirectUnlock = response.status === 503
                && data?.controllerUnlockRequired === true
                && String(data?.controllerUnlockProof || '').trim();

            if (shouldTryDirectUnlock) {
                const retryPayload = {
                    qrData: normalizedRaw,
                    expectedKeyId: expectedKeyId || undefined,
                    intent: expectedIntent || undefined,
                    controllerUnlockProof: data.controllerUnlockProof
                };

                let directUnlockNeeded = true;
                if (window.location.protocol === 'https:') {
                    updateScannerStatus('Retrying through server...');
                    showMessage('Server retrying locker unlock through the local controller...', 'info');

                    await waitForServerRetry();

                    const retryResult = await submitScanRequest({
                        qrData: normalizedRaw,
                        expectedKeyId: expectedKeyId || undefined,
                        intent: expectedIntent || undefined
                    });
                    response = retryResult.response;
                    data = retryResult.data;

                    if (response.ok) {
                        directUnlockNeeded = false;
                    }
                }

                if (directUnlockNeeded) {
                    updateScannerStatus('Triggering locker directly...');
                    showMessage('Trying direct ESP unlock...', 'info');

                    await triggerLockerDirectly(data.controllerUnlockUrls);

                    updateScannerStatus('Finalizing scan...');
                    showMessage('Locker triggered. Finalizing transaction...', 'info');

                    const retryResult = await submitScanRequest(retryPayload);
                    response = retryResult.response;
                    data = retryResult.data;

                    if (!response.ok) {
                        throw new Error(data?.error || 'Scan failed after direct unlock');
                    }
                }
            } else {
                throw new Error(data?.error || 'Scan failed');
            }
        }

        const isSuccess = data?.success === true || Boolean(data?.transaction);
        if (!isSuccess) {
            throw new Error(data.error || 'Scan failed');
        }

        handleScanSuccess(data, scannedKey);
    } catch (error) {
        console.error('Error processing QR code:', error);
        const message = error?.message || 'Invalid QR code or scan failed';
        showMessage(message, 'error');
        if (shouldNotify(message)) {
            showNotification(message, 'error');
        }

        if (/scanned qr is for/i.test(message) || /wrong qr/i.test(message)) {
            updateScannerStatus('Wrong key QR');
        } else {
            updateScannerStatus('Scanning resumed');
        }
        setTimeout(() => {
            if (currentStream) startQRScanning();
        }, 1200);
    }
}

function setupEventListeners() {
    if (elements.startScanBtn) {
        elements.startScanBtn.addEventListener('click', () => {
            void startCamera();
        });
    }

    if (elements.backBtn) {
        elements.backBtn.addEventListener('click', () => {
            stopCamera();
            window.location.href = ROUTES.dashboard;
        });
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopCamera();
    }
});

window.addEventListener('beforeunload', () => {
    stopCamera();
});

document.addEventListener('DOMContentLoaded', () => {
    if (!checkUserAuth()) return;

    if (expectedKeyId && !/^KEY\d{3}$/.test(expectedKeyId)) {
        const msg = 'Invalid key selected. Please try again from the dashboard.';
        showMessage(msg, 'error');
        showNotification(msg, 'error');
        setTimeout(() => {
            window.location.href = ROUTES.dashboard;
        }, 1200);
        return;
    }

    setupEventListeners();
    setScanButtonsForMode();
    updateActionUI();
    updateScannerStatus('Scanner idle');
    setScanFallbackHintVisible(!canUseLiveCamera());
    setScannerSurfaceMode(canUseLiveCamera() ? 'live' : 'fallback');
    showMessage(`Scanner ready for ${getScanTargetLabel()}.`, 'info');
    void loadRuntimeConfig();

    setInterval(updateDateTime, 1000);
    updateDateTime();

    if (typeof jsQR === 'undefined') {
        console.error('jsQR library not loaded');
        showMessage('QR code scanner library not loaded', 'error');
        showNotification('QR code scanner library not loaded. Please refresh the page.', 'error');
        return;
    }

    if (canUseLiveCamera()) {
        setTimeout(() => {
            void startCamera();
        }, 600);
    } else {
        updateScannerStatus(getSecureScannerUrl() ? 'Secure scanner required' : 'Camera unavailable on this page');
    }
});
