/**
 * WhatsApp Logic Module - Baileys Implementation
 *
 * This module provides WhatsApp messaging functionality using the Baileys adapter.
 * It manages campaigns, message sending, and WhatsApp client lifecycle.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const os = require('os');
// Note: qrcode conversion is handled in main.js, not here

// Import the Baileys adapter
const { createAdapter } = require('./adapters');

// Import utility modules
const { initializeLogging, createLogger: createModuleLogger, getMainLogger } = require('./utils/logger');
const { classifyError, isRecoverable, withRetry, withTimeout, formatUserMessage } = require('./utils/error-handler');
const { retryWithBackoff, CircuitBreaker } = require('./utils/retry');
const { safeDelete, safeCopy, safeRead, safeWrite, ensureDir } = require('./utils/file-ops');
const { TIMEOUTS, RETRIES, CLIENT_STATES, CAMPAIGN_STATES, ERROR_TYPES } = require('./config/defaults');
const SessionManager = require('./managers/session-manager');

// ============================================================================
// GLOBAL STATE
// ============================================================================

let adapter = null; // WhatsApp adapter instance
let logger = null;  // Winston logger instance

let clientReadyPromise = null;
let resolveClientReady = null;
let rejectClientReady = null;
let isClientInitializing = false;
let initializationStartTime = null;
const INITIALIZATION_TIMEOUT_MS = 180000; // 3 minutes max for initialization

// Reconnection state
let isReconnecting = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 5000;
let reconnectTimeout = null;

// Campaign abort controller - used to cancel pending async operations
let campaignAbortController = null;

// ============================================================================
// CAMPAIGN STATE
// ============================================================================

const initialCampaignState = {
    id: null,
    status: 'inactive', // inactive, running, pausing, paused, stopping, stopped, finished
    config: {
        countryCode: ''
    },
    contacts: [],
    totalContacts: 0,
    sentCount: 0,
    progressCallback: null,
    logCallback: null,
    resumePromiseResolver: null,
    countdownCallback: null,
    countdownState: {
        isActive: false,
        remainingTime: 0,
        totalTime: 0,
        type: 'idle' // 'idle', 'sending', 'pausing'
    }
};

let campaignState = { ...initialCampaignState };

// ============================================================================
// LOGGER INITIALIZATION
// ============================================================================

function initializeLogger(logsDir) {
    if (logger) return;

    try {
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
                })
            ),
            transports: [
                new winston.transports.File({
                    filename: path.join(logsDir, 'app.log'),
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                }),
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });

        logger.info('Logger initialized successfully');
    } catch (error) {
        console.error('Failed to initialize logger:', error.message);
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function tiempoAleatorio(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatearTiempo(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

/**
 * Safe file operation with retries
 */
async function safeFileOperation(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            logger?.warn(`File Operation: Attempt ${attempt}/${maxRetries} failed: ${error.message}`);

            if (attempt < maxRetries) {
                await delay(baseDelay * attempt);
            }
        }
    }

    logger?.error(`File Operation: All ${maxRetries} attempts failed. Last error: ${lastError.message}`);
    throw lastError;
}

/**
 * Safe retry operation wrapper
 */
async function safeRetryOperation(operation, maxRetries = 3, baseDelay = 1000, operationName = 'operation') {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            logger?.warn(`${operationName}: Attempt ${attempt}/${maxRetries} failed: ${error.message}`);

            if (attempt < maxRetries) {
                await delay(baseDelay * attempt);
            }
        }
    }

    throw lastError;
}

/**
 * Safe async operation with timeout
 */
async function safeAsyncOperation(operation, timeoutMs, operationName = 'operation') {
    return Promise.race([
        operation(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${operationName} timeout after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

/**
 * Safe Excel file reading
 */
async function safeReadExcelFile(excelPath, maxRetries = 3) {
    return safeRetryOperation(async () => {
        logger?.info(`[whatsapp-logic]: Force File Handle Release: Intentando liberar handles para: ${excelPath}`);

        if (fs.existsSync(excelPath)) {
            logger?.info(`[whatsapp-logic]: Force File Handle Release: Archivo accesible, no requiere liberación forzada`);
        }

        const workbook = XLSX.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        return data;
    }, maxRetries, 1000, 'read-excel');
}

/**
 * Safe path deletion
 */
async function safeDeletePath(targetPath, maxRetries = 3) {
    return safeRetryOperation(async () => {
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }
    }, maxRetries, 1000, 'delete-path');
}

// ============================================================================
// COUNTDOWN STATE MANAGEMENT
// ============================================================================

function setCountdownState(type) {
    campaignState.countdownState.type = type;
    campaignState.countdownState.isActive = type !== 'idle';

    if (campaignState.countdownCallback) {
        campaignState.countdownCallback({
            type: campaignState.countdownState.type,
            isActive: campaignState.countdownState.isActive,
            remainingTime: campaignState.countdownState.remainingTime,
            totalTime: campaignState.countdownState.totalTime
        });
    }
}

function notifyCountdown(remainingTime, totalTime) {
    campaignState.countdownState.remainingTime = remainingTime;
    campaignState.countdownState.totalTime = totalTime;

    if (campaignState.countdownCallback) {
        campaignState.countdownCallback({
            type: campaignState.countdownState.type,
            isActive: campaignState.countdownState.isActive,
            remainingTime,
            totalTime
        });
    }
}

/**
 * Controlled delay with countdown notifications
 * @param {number} delayMs - Delay in milliseconds
 * @param {string} type - Type of delay ('send' or 'pause')
 * @param {string} campaignId - ID of the campaign that started this delay (for validation)
 * @returns {Promise<boolean>} - Returns true if delay completed, false if aborted
 */
async function controlledDelay(delayMs, type = 'send', campaignId = null) {
    setCountdownState(type === 'pause' ? 'pausing' : 'sending');
    // Notify initial countdown immediately so UI shows correct time from the start
    notifyCountdown(delayMs, delayMs);

    const startTime = Date.now();
    const endTime = startTime + delayMs;

    while (Date.now() < endTime) {
        // Check for stopping
        if (campaignState.status === 'stopping') {
            console.log('whatsapp-logic: controlledDelay aborted - campaign stopping');
            setCountdownState('idle');
            return false;
        }

        // Check for paused (user paused the campaign)
        if (campaignState.status === 'paused') {
            console.log('whatsapp-logic: controlledDelay aborted - campaign paused');
            setCountdownState('idle');
            return false;
        }

        // Check if abort was signaled (AbortController may be null after abort)
        if (!campaignAbortController || campaignAbortController.signal.aborted) {
            console.log('whatsapp-logic: controlledDelay aborted via AbortController (signal aborted or controller null)');
            setCountdownState('idle');
            return false;
        }

        // Check if campaign ID changed (new campaign started)
        if (campaignId && campaignState.id !== campaignId) {
            console.log(`whatsapp-logic: controlledDelay aborted - campaign ID changed from ${campaignId} to ${campaignState.id}`);
            setCountdownState('idle');
            return false;
        }

        // Check if campaign became inactive (was cleared)
        if (campaignState.status === 'inactive') {
            console.log('whatsapp-logic: controlledDelay aborted - campaign became inactive');
            setCountdownState('idle');
            return false;
        }

        const remaining = endTime - Date.now();
        notifyCountdown(remaining, delayMs);

        // Wait 1 second or remaining time, whichever is smaller
        await delay(Math.min(1000, remaining));
    }

    notifyCountdown(0, delayMs);
    return true;
}

// ============================================================================
// PROGRESS NOTIFICATION
// ============================================================================

function notifyProgress() {
    if (campaignState.progressCallback) {
        campaignState.progressCallback({
            id: campaignState.id,
            status: campaignState.status,
            sent: campaignState.sentCount,
            total: campaignState.totalContacts,
            currentIndex: campaignState.config.currentIndex || 0,
            config: campaignState.config
        });
    }
}

// ============================================================================
// MESSAGE VARIABLE PROCESSING
// ============================================================================

function processMessageVariables(message, contactData) {
    if (!message || !contactData) return message;

    let processed = message;

    // Replace {{variable}} patterns with contact data (double braces from UI)
    for (const [key, value] of Object.entries(contactData)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
        processed = processed.replace(regex, value !== undefined && value !== null ? String(value) : '');
    }

    logger?.info(`[whatsapp-logic]: Message Variable Processing: Mensaje procesado exitosamente. Variables reemplazadas: ${processed !== message ? 'Sí' : 'No'}`);

    return processed;
}

// ============================================================================
// CLIENT INITIALIZATION
// ============================================================================

/**
 * Check and reset stuck initialization
 */
function checkInitializationTimeout() {
    if (isClientInitializing && initializationStartTime) {
        const elapsed = Date.now() - initializationStartTime;
        if (elapsed > INITIALIZATION_TIMEOUT_MS) {
            logger?.error(`Initialization Timeout: Stuck for ${elapsed}ms, forcing reset`);

            isClientInitializing = false;
            initializationStartTime = null;

            if (rejectClientReady) {
                rejectClientReady(new Error(`Initialization timeout after ${INITIALIZATION_TIMEOUT_MS}ms`));
            }
            resolveClientReady = null;
            rejectClientReady = null;
            clientReadyPromise = null;

            return true;
        }
    }
    return false;
}

/**
 * Initialize the WhatsApp client
 */
async function initializeClient(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir = null) {
    const logPrefix = 'Client Initialization';

    // Initialize logger if logsDir is provided
    if (logsDir && !logger) {
        try {
            initializeLogger(logsDir);
            logger?.info(`${logPrefix}: Logger initialized with logs directory: ${logsDir}`);
        } catch (loggerError) {
            console.error(`Failed to initialize logger: ${loggerError.message}`);
        }
    }

    logger?.info(`${logPrefix}: initializeClient called with dataPath: ${dataPath}`);
    console.log("initializeClient called.");

    // Check for stuck initialization
    checkInitializationTimeout();

    // If initialization is already in progress, wait for it
    if (isClientInitializing) {
        logger?.info(`${logPrefix}: Client initialization already in progress. Waiting for completion.`);
        console.log("Client initialization already in progress. Waiting for it to complete.");

        if (clientReadyPromise) {
            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Client initialization wait timeout after 120 seconds')), 120000)
                );

                await Promise.race([clientReadyPromise, timeoutPromise]);
                logger?.info(`${logPrefix}: Existing client initialization completed successfully.`);
                if (onClientReady) onClientReady();
            } catch (e) {
                logger?.error(`${logPrefix}: Ongoing client initialization failed: ${e.message}`);
                if (onAuthFailure) onAuthFailure(e.message);
            }
            return;
        }
    }

    // If adapter is already initialized and ready, skip re-initialization
    if (adapter && adapter.isAuthenticated()) {
        logger?.info(`${logPrefix}: Client already ready, skipping re-initialization.`);
        console.log("Client already ready, skipping re-initialization.");
        if (onClientReady) onClientReady();
        return;
    }

    // Set initialization flag
    isClientInitializing = true;
    initializationStartTime = Date.now();

    // Create promise for tracking initialization
    // Add .catch() to prevent UnhandledPromiseRejectionWarning when promise is rejected
    // The actual error handling is done via callbacks (onAuthFailure)
    clientReadyPromise = new Promise((resolve, reject) => {
        resolveClientReady = resolve;
        rejectClientReady = reject;
    }).catch((error) => {
        // Error is already handled via onAuthFailure callback
        // This catch prevents UnhandledPromiseRejectionWarning
        logger?.info(`${logPrefix}: Client ready promise rejected (handled): ${error.message}`);
    });

    try {
        // Destroy existing adapter if any
        if (adapter) {
            logger?.info(`${logPrefix}: Destroying existing adapter instance`);
            await adapter.destroy();
            adapter = null;
        }

        // Create new Baileys adapter
        logger?.info(`${logPrefix}: Creating new Baileys adapter`);
        adapter = createAdapter('baileys');

        // Attach Winston logger to adapter for file logging
        if (logger && adapter && typeof adapter.setExternalLogger === 'function') {
            adapter.setExternalLogger(logger);
            logger.info(`${logPrefix}: Winston logger attached to Baileys adapter`);
        }

        // Pass QR code directly - main.js handles conversion to data URL
        const wrappedOnQrCode = (qr) => {
            const timestamp = new Date().toISOString();
            logger?.info(`${logPrefix}: QR code received from Baileys`);
            console.log(`[${timestamp}] whatsapp-logic: >>>>>> QR CODE EVENT RECEIVED FROM BAILEYS <<<<<<`);
            console.log(`[${timestamp}] whatsapp-logic: QR length: ${qr?.length || 0}`);
            console.log(`[${timestamp}] whatsapp-logic: Forwarding QR to main.js callback`);
            // Pass raw QR string to main.js which will convert it to data URL
            if (onQrCode) onQrCode(qr);
        };

        // Wrap ready callback
        const wrappedOnClientReady = () => {
            const timestamp = new Date().toISOString();
            logger?.info(`${logPrefix}: Client is ready`);
            console.log(`[${timestamp}] whatsapp-logic: >>>>>> CLIENT READY EVENT RECEIVED <<<<<<`);
            console.log(`[${timestamp}] whatsapp-logic: Client is ready! Notifying main.js`);

            isClientInitializing = false;
            initializationStartTime = null;

            if (resolveClientReady) {
                console.log(`[${timestamp}] whatsapp-logic: Resolving clientReadyPromise`);
                resolveClientReady();
            }

            if (onClientReady) {
                console.log(`[${timestamp}] whatsapp-logic: Calling onClientReady callback`);
                onClientReady();
            }
        };

        // Wrap disconnected callback
        const wrappedOnDisconnected = (reason) => {
            const timestamp = new Date().toISOString();
            logger?.info(`${logPrefix}: Client disconnected. Reason: ${reason}`);
            console.log(`[${timestamp}] whatsapp-logic: >>>>>> CLIENT DISCONNECTED EVENT RECEIVED <<<<<<`);
            console.log(`[${timestamp}] whatsapp-logic: Disconnect reason: ${reason}`);

            // Reset initialization state so new initialization can proceed
            isClientInitializing = false;
            initializationStartTime = null;
            console.log(`[${timestamp}] whatsapp-logic: Initialization state reset`);

            // Reject pending promise if exists (to unblock any waiters)
            if (rejectClientReady) {
                console.log(`[${timestamp}] whatsapp-logic: Rejecting clientReadyPromise due to disconnect`);
                rejectClientReady(new Error(`Disconnected: ${reason}`));
                rejectClientReady = null;
                resolveClientReady = null;
            }

            // If campaign is running, pause it
            if (campaignState.status === 'running') {
                logger?.info(`${logPrefix}: Pausing campaign due to disconnection`);
                console.log(`[${timestamp}] whatsapp-logic: Pausing campaign due to disconnection`);
                campaignState.status = 'paused';
                notifyProgress();
            }

            if (onDisconnected) {
                console.log(`[${timestamp}] whatsapp-logic: Calling onDisconnected callback`);
                onDisconnected(reason);
            }
        };

        // Wrap auth failure callback
        const wrappedOnAuthFailure = (message) => {
            logger?.error(`${logPrefix}: Authentication failure: ${message}`);
            console.error(`whatsapp-logic: Authentication failure: ${message}`);

            isClientInitializing = false;
            initializationStartTime = null;

            if (rejectClientReady) {
                rejectClientReady(new Error(message));
            }

            if (onAuthFailure) onAuthFailure(message);
        };

        // Initialize the adapter
        await adapter.initialize(dataPath, {
            onQrCode: wrappedOnQrCode,
            onClientReady: wrappedOnClientReady,
            onDisconnected: wrappedOnDisconnected,
            onAuthFailure: wrappedOnAuthFailure
        });

        logger?.info(`${logPrefix}: Adapter initialization started, waiting for connection...`);

    } catch (error) {
        logger?.error(`${logPrefix}: Error during initialization: ${error.message}`);
        console.error(`whatsapp-logic: Error during initialization: ${error.message}`);

        isClientInitializing = false;
        initializationStartTime = null;

        if (rejectClientReady) {
            rejectClientReady(error);
        }

        if (onAuthFailure) onAuthFailure(error.message);
    }
}

// ============================================================================
// CLIENT STATUS
// ============================================================================

function getClientStatus() {
    console.log("🔍 whatsapp-logic: getClientStatus called");
    console.log("📊 whatsapp-logic: isClientInitializing:", isClientInitializing);
    console.log("📊 whatsapp-logic: adapter exists:", !!adapter);

    if (adapter && adapter.isAuthenticated()) {
        const phoneNumber = adapter.getPhoneNumber();
        console.log("✅ whatsapp-logic: Returning 'ready' status with phone:", phoneNumber);
        return { status: 'ready', phoneNumber };
    }

    if (adapter && adapter.getConnectionState() === 'waiting_qr') {
        console.log("📱 whatsapp-logic: QR code pending - Returning 'not_ready' status");
        return { status: 'not_ready' };
    }

    if (isClientInitializing) {
        console.log("⏳ whatsapp-logic: Returning 'initializing' status");
        return { status: 'initializing' };
    }

    console.log("❌ whatsapp-logic: Returning 'disconnected' status");
    return { status: 'disconnected' };
}

// ============================================================================
// WAIT FOR CLIENT READY
// ============================================================================

async function waitForClientReady() {
    if (adapter && adapter.isAuthenticated()) {
        console.log("whatsapp-logic: Client is already ready (checked by waitForClientReady).");
        return Promise.resolve();
    }

    console.log("whatsapp-logic: Client not yet ready. Waiting for 'ready' event...");

    if (!clientReadyPromise) {
        clientReadyPromise = new Promise(resolve => {
            resolveClientReady = resolve;
        });
    }

    return clientReadyPromise;
}

// ============================================================================
// MESSAGE SENDING
// ============================================================================

/**
 * Detect if an error indicates session is closed
 */
function isSessionClosedError(error) {
    if (!error || !error.message) return false;
    const message = error.message.toLowerCase();
    return message.includes('session closed') ||
           message.includes('connection closed') ||
           message.includes('not connected') ||
           message.includes('socket closed');
}

/**
 * Send message with retries
 */
async function sendMessageWithRetries(phoneNumber, message, mediaPath = null, maxRetries = 3, initialTimeout = 30000, countryCode = '') {
    const logPrefix = `Send Message (${phoneNumber.toString().substring(0, 10)}...)`;
    let lastError;
    let sessionClosed = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const timeout = Math.floor(initialTimeout * (1 + (attempt - 1) * 0.5));
            logger?.info(`${logPrefix}: Intento ${attempt}/${maxRetries} con timeout de ${timeout}ms`);

            let sendPromise;

            if (mediaPath) {
                sendPromise = adapter.sendMediaMessage(phoneNumber, mediaPath, message, countryCode);
            } else {
                sendPromise = adapter.sendTextMessage(phoneNumber, message, countryCode);
            }

            // Promise.race with timeout
            await Promise.race([
                sendPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Message send timeout after ${timeout}ms`)), timeout)
                )
            ]);

            if (attempt > 1) {
                logger?.info(`${logPrefix}: Mensaje enviado exitosamente después de ${attempt} intentos`);
            }

            return true;

        } catch (error) {
            lastError = error;
            logger?.warn(`${logPrefix}: Intento ${attempt}/${maxRetries} falló: ${error.message}`);

            // Detect session closed error
            if (isSessionClosedError(error)) {
                sessionClosed = true;
                logger?.error(`${logPrefix}: SESSION CLOSED DETECTED - No point in retrying`);
                break;
            }

            // Exponential backoff
            if (attempt < maxRetries) {
                const delayTime = 2000 * Math.pow(2, attempt - 1);
                logger?.info(`${logPrefix}: Esperando ${delayTime}ms antes del siguiente intento`);
                await delay(delayTime);
            }
        }
    }

    // Create appropriate error message
    let errorMsg;
    if (sessionClosed) {
        errorMsg = `SESSION_CLOSED: ${lastError.message}`;
        logger?.error(`${logPrefix}: Failed due to session closed - Reconnection required`);
    } else {
        errorMsg = `Failed to send message after ${maxRetries} attempts: ${lastError.message}`;
    }

    logger?.error(`${logPrefix}: ${errorMsg}`);

    const finalError = new Error(errorMsg);
    finalError.sessionClosed = sessionClosed;
    throw finalError;
}

/**
 * Send campaign start notification to supervisors
 */
async function sendCampaignStartNotification(supervisorNumbers, totalContacts, logCallback) {
    const logPrefix = 'Campaign Start Notification';

    if (!supervisorNumbers || supervisorNumbers.length === 0) {
        logger?.info(`${logPrefix}: No supervisor numbers configured, skipping notifications`);
        return true;
    }

    if (!adapter || !adapter.isAuthenticated()) {
        logger?.warn(`${logPrefix}: Client not ready, skipping notifications`);
        return false;
    }

    logger?.info(`${logPrefix}: Sending start notifications to ${supervisorNumbers.length} supervisors`);

    const startMessage = `🚀 CAMPAÑA INICIADA\n\n📊 Total de contactos: ${totalContacts}\n⏰ Inicio: ${new Date().toLocaleString()}`;

    let successCount = 0;

    for (const supNum of supervisorNumbers) {
        try {
            await safeRetryOperation(
                async () => await adapter.sendTextMessage(supNum, startMessage),
                3,
                2000,
                `start-notification-${supNum}`
            );
            successCount++;
            logger?.info(`${logPrefix}: Notification sent to supervisor ${supNum}`);
        } catch (error) {
            logger?.error(`${logPrefix}: Failed to notify supervisor ${supNum}: ${error.message}`);
        }
    }

    if (successCount === supervisorNumbers.length) {
        logger?.info(`${logPrefix}: All notifications sent successfully`);
        return true;
    } else {
        logger?.warn(`${logPrefix}: Some notifications failed (${successCount}/${supervisorNumbers.length})`);
        return false;
    }
}

// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

/**
 * Restart sending from persisted state
 */
function restartSendingFromState(persistedCampaign, callbackProgress, logCallback, countdownCallback = null) {
    console.log("whatsapp-logic: Restarting sending process from persisted state.");

    campaignState.id = persistedCampaign.id || `campaign-${Date.now()}`;
    campaignState.status = 'paused';
    campaignState.config = persistedCampaign.config;
    campaignState.config.currentIndex = persistedCampaign.config.currentIndex || persistedCampaign.currentIndex || 0;
    campaignState.sentCount = persistedCampaign.sent || 0;
    campaignState.totalContacts = persistedCampaign.total || 0;
    campaignState.progressCallback = callbackProgress;
    campaignState.logCallback = logCallback;
    campaignState.countdownCallback = countdownCallback;

    setCountdownState('idle');

    console.log("whatsapp-logic: Campaign state restored - Total contacts:", campaignState.totalContacts, "Current index:", campaignState.config.currentIndex);

    notifyProgress();
}

/**
 * Start or resume sending messages
 */
async function startSending(config, callbackProgress, logCallback, initialStartIndex = 0, campaignId = null, countdownCallback = null) {
    // Prevent starting a new campaign if one is already active
    if (!campaignId && ['running', 'pausing', 'stopping'].includes(campaignState.status)) {
        const message = `whatsapp-logic: Cannot start new campaign while another is active (status: ${campaignState.status})`;
        console.warn(message);
        if (logCallback) {
            logCallback(`Error: No se puede iniciar una nueva campaña hasta que la actual se detenga por completo.`);
        }
        return;
    }

    // Create a new AbortController for this campaign
    // This allows us to cancel any pending async operations when the campaign is stopped or cleared
    if (campaignAbortController) {
        console.log("whatsapp-logic: Aborting previous campaign's pending operations...");
        campaignAbortController.abort();
    }
    campaignAbortController = new AbortController();

    // Initialize state for new campaign
    if (!campaignId) {
        campaignState.id = `campaign-${Date.now()}`;
        campaignState.status = 'running';
        campaignState.config = config;
        campaignState.progressCallback = callbackProgress;
        campaignState.logCallback = logCallback;
        campaignState.countdownCallback = countdownCallback;
        campaignState.config.currentIndex = initialStartIndex > 0 ? initialStartIndex : (config.currentIndex > 0 ? config.currentIndex : 0);
        campaignState.sentCount = 0;
        campaignState.contacts = [];
        campaignState.totalContacts = 0;
        setCountdownState('sending');
    } else {
        // Resume existing campaign
        campaignState.id = campaignId;
        campaignState.status = 'running';

        if (callbackProgress) campaignState.progressCallback = callbackProgress;
        if (logCallback) campaignState.logCallback = logCallback;
        if (countdownCallback) campaignState.countdownCallback = countdownCallback;

        setCountdownState('sending');
    }

    // Store the current campaign ID for validation in async operations
    const currentCampaignId = campaignState.id;

    console.log(`whatsapp-logic: startSending initiated for campaign ${campaignState.id}.`);
    console.log(`whatsapp-logic: Current config:`, JSON.stringify(campaignState.config, null, 2));

    // Wait for client to be ready
    console.log("whatsapp-logic: Waiting for client to be ready...");
    await waitForClientReady();
    console.log("whatsapp-logic: Client is ready. Proceeding with sending.");

    try {
        // Load contacts from Excel
        const excelPath = campaignState.config.excelPath;
        console.log(`whatsapp-logic: Reading Excel file: ${excelPath}`);

        if (logCallback) logCallback(`whatsapp-logic: Loading contacts from Excel file: ${excelPath}`);

        const datos = await safeReadExcelFile(excelPath, 3);
        console.log(`whatsapp-logic: Data loaded from Excel: ${datos.length} rows.`);

        if (logCallback) logCallback(`whatsapp-logic: Loaded ${datos.length} contacts from Excel file`);

        campaignState.contacts = datos;
        campaignState.totalContacts = datos.length;

        notifyProgress();

        // Send supervisor notifications for new campaigns only
        const { supervisorNumbers } = campaignState.config;
        if (!campaignId && supervisorNumbers && supervisorNumbers.length > 0) {
            try {
                const notificationSuccess = await sendCampaignStartNotification(
                    supervisorNumbers,
                    campaignState.totalContacts,
                    logCallback
                );

                if (notificationSuccess) {
                    logger?.info(`Campaign Start: Supervisor notifications sent successfully`);
                }
            } catch (notificationError) {
                logger?.error(`Campaign Start: Error sending supervisor notifications: ${notificationError.message}`);
            }
        } else if (campaignId) {
            logger?.info(`Campaign Start: Skipping notifications for resumed campaign ${campaignId}`);
            console.log("whatsapp-logic: Skipping notifications for resumed campaign");
        }

        if (logCallback) logCallback(`whatsapp-logic: Starting message sending loop from index ${campaignState.config.currentIndex} to ${campaignState.totalContacts - 1}`);

        // Main sending loop
        for (let i = campaignState.config.currentIndex; i < campaignState.totalContacts; i++) {
            // Check if this campaign is still the active one (may have changed during await)
            if (campaignState.id !== currentCampaignId) {
                console.log(`whatsapp-logic: Campaign ID changed from ${currentCampaignId} to ${campaignState.id}. Exiting loop.`);
                break;
            }

            // Check if abort was signaled
            if (campaignAbortController && campaignAbortController.signal.aborted) {
                console.log(`whatsapp-logic: Abort signal received for campaign ${currentCampaignId}. Exiting loop.`);
                break;
            }

            campaignState.config.currentIndex = i;

            // Handle pausing
            if (campaignState.status === 'paused') {
                console.log("whatsapp-logic: Sending paused. Waiting for resume...");
                notifyProgress();
                await new Promise(resolve => {
                    campaignState.resumePromiseResolver = resolve;
                });

                // After resume, check again if the campaign is still valid
                if (campaignState.id !== currentCampaignId) {
                    console.log(`whatsapp-logic: Campaign ID changed after resume. Exiting loop.`);
                    break;
                }

                console.log("whatsapp-logic: Sending resumed.");
                i = campaignState.config.currentIndex - 1;
                continue;
            }

            // Handle stopping
            if (campaignState.status === 'stopping') {
                console.log("whatsapp-logic: Sending process was stopped. Exiting loop.");
                break;
            }

            // Get current config values
            const {
                message, mediaPath, messageType, pausaCada,
                pausaMinima, pausaMaxima, sendDelay, maxRetries, timeout, countryCode
            } = campaignState.config;

            const dato = campaignState.contacts[i];
            const numeroKey = Object.keys(dato).find(key => key.toLowerCase() === 'numero');
            const numero = numeroKey ? dato[numeroKey] : undefined;

            console.log(`whatsapp-logic: DEBUG - Contacto actual (index ${i}):`, JSON.stringify(dato, null, 2));
            console.log(`whatsapp-logic: DEBUG - Mensaje original:`, message);

            if (numero && numero.toString().length > 6) {
                try {
                    const sendStartTime = Date.now();

                    // Process message variables
                    let processedMessage = processMessageVariables(message, dato);
                    console.log(`whatsapp-logic: DEBUG - Mensaje procesado:`, processedMessage);

                    logger?.info(`Message Send: Attempting to send message to ${numero} (index ${i})`);

                    // Send message based on type
                    if (messageType == 1) {
                        await sendMessageWithRetries(numero, processedMessage, null, maxRetries, timeout, countryCode);
                    } else if (messageType == 2) {
                        await sendMessageWithRetries(numero, processedMessage, mediaPath, maxRetries, timeout, countryCode);
                    }

                    logger?.info(`Message Send: Successfully sent message to ${numero} in ${Date.now() - sendStartTime}ms`);

                    logCallback(`[${i + 1}] - Mensaje a contacto ${numero} enviado`);
                    campaignState.sentCount++;
                    campaignState.config.currentIndex++;
                    notifyProgress();

                } catch (sendError) {
                    logger?.error(`Message Send: Failed to send message to ${numero}: ${sendError.message}`);
                    console.error(`whatsapp-logic: Failed to send message to ${numero}:`, sendError.message);

                    // Handle session closed error
                    if (sendError.sessionClosed || isSessionClosedError(sendError)) {
                        logger?.error(`Message Send: SESSION CLOSED - Pausing campaign automatically`);

                        if (logCallback) {
                            logCallback(`⚠️ ERROR CRÍTICO: La sesión de WhatsApp se cerró inesperadamente`);
                            logCallback(`⚠️ La campaña se pausará automáticamente. Por favor, reconecte WhatsApp.`);
                        }

                        campaignState.status = 'paused';
                        notifyProgress();
                        break;
                    }
                }

                // Handle scheduled pause
                const isLastMessage = (i === campaignState.totalContacts - 1);
                if (campaignState.sentCount > 0 && campaignState.sentCount % pausaCada === 0 && !isLastMessage) {
                    const tiempoPausa = tiempoAleatorio(pausaMinima * 60000, pausaMaxima * 60000);
                    const tiempoFormateado = formatearTiempo(tiempoPausa);
                    const pauseMessage = `- 🔔 PAUSA AUTOMÁTICA: ${tiempoFormateado} | Enviados: ${campaignState.sentCount}`;
                    logCallback(`[${campaignState.config.currentIndex}] ${pauseMessage}`);
                    const adjustedPauseTime = Math.max(2000, tiempoPausa - 2000);
                    const delayCompleted = await controlledDelay(adjustedPauseTime, 'pause', currentCampaignId);

                    // Check if the delay was aborted (campaign changed or stopped)
                    if (!delayCompleted) {
                        console.log(`whatsapp-logic: Automatic pause aborted for campaign ${currentCampaignId}. Exiting loop.`);
                        break;
                    }

                    if (campaignState.status !== 'stopping') {
                        setCountdownState('sending');
                    }
                } else if (!isLastMessage) {
                    const delayCompleted = await controlledDelay(sendDelay * 1000, 'send', currentCampaignId);

                    // Check if the delay was aborted (campaign changed or stopped)
                    if (!delayCompleted) {
                        console.log(`whatsapp-logic: Send delay aborted for campaign ${currentCampaignId}. Exiting loop.`);
                        break;
                    }
                }

            } else {
                console.log(`El contacto ${numero} es invalido, no se le envió mensaje`);
                if (logCallback) logCallback(`whatsapp-logic: Skipped invalid contact at index ${i}: ${numero}`);
                campaignState.config.currentIndex = i + 1;
                notifyProgress();
            }
        }

        // Campaign finished
        if (campaignState.status !== 'stopping' && campaignState.status !== 'paused') {
            campaignState.status = 'finished';
            if (logCallback) logCallback(`whatsapp-logic: Campaign finished successfully. Total messages sent: ${campaignState.sentCount}`);

            // Send final notification to supervisors
            const { supervisorNumbers } = campaignState.config;
            if (supervisorNumbers && supervisorNumbers.length > 0) {
                const finalMessage = `🏁 CAMPAÑA FINALIZADA\n\n📊 Total de mensajes enviados: ${campaignState.sentCount}`;
                for (const supNum of supervisorNumbers) {
                    try {
                        await safeRetryOperation(
                            async () => await adapter.sendTextMessage(supNum, finalMessage),
                            3,
                            2000,
                            `final-notification-${supNum}`
                        );
                    } catch (finalError) {
                        logger?.error(`Final Notification Error: ${finalError.message}`);
                    }
                }
            }
        }

    } catch (error) {
        console.error("whatsapp-logic: CRITICAL Error during message sending:", error.message);
        if (logCallback) logCallback(`whatsapp-logic: CRITICAL ERROR during sending: ${error.message}`);
        campaignState.status = 'stopped';
    } finally {
        if (campaignState.status !== 'paused') {
            campaignState.status = campaignState.status === 'stopping' ? 'stopped' : 'finished';
        }
        console.log(`whatsapp-logic: Sending process has finished with status: ${campaignState.status}.`);
        notifyProgress();
    }
}

/**
 * Pause sending
 */
function pauseSending(campaignId) {
    console.log("whatsapp-logic: Pausing sending...");

    if (campaignState.id === campaignId && campaignState.status === 'running') {
        campaignState.status = 'paused';
        setCountdownState('idle');

        // Abort the current controlledDelay so it stops immediately
        // This prevents the old loop from continuing to send countdown updates
        if (campaignAbortController) {
            console.log("whatsapp-logic: Aborting pending async operations for pause...");
            campaignAbortController.abort();
            campaignAbortController = null;
        }

        notifyProgress();
        console.log("whatsapp-logic: Campaign paused.");
        return true;
    }

    console.log("whatsapp-logic: Cannot pause - campaign not running or ID mismatch");
    return false;
}

/**
 * Resume sending
 */
function resumeSending(campaignId) {
    console.log("whatsapp-logic: Resuming sending...");

    if (campaignState.id === campaignId && campaignState.status === 'paused') {
        campaignState.status = 'running';
        setCountdownState('sending');

        if (campaignState.resumePromiseResolver) {
            campaignState.resumePromiseResolver();
            campaignState.resumePromiseResolver = null;
        } else {
            // No active sending loop - start a new one
            console.log("whatsapp-logic: No active sending loop found. Starting a new one from the persisted state.");
            startSending(
                campaignState.config,
                campaignState.progressCallback,
                campaignState.logCallback,
                campaignState.config.currentIndex,
                campaignState.id,
                campaignState.countdownCallback
            );
        }

        notifyProgress();
        console.log("whatsapp-logic: Campaign resumed.");
        return true;
    }

    console.log("whatsapp-logic: Cannot resume - campaign not paused or ID mismatch");
    return false;
}

/**
 * Stop sending
 */
function stopSending(campaignId) {
    console.log("whatsapp-logic: Stopping sending...");

    if (campaignState.id === campaignId) {
        campaignState.status = 'stopping';
        setCountdownState('idle');

        // Abort any pending async operations
        if (campaignAbortController) {
            console.log("whatsapp-logic: Aborting pending async operations...");
            campaignAbortController.abort();
            campaignAbortController = null;
        }

        if (campaignState.resumePromiseResolver) {
            campaignState.resumePromiseResolver();
            campaignState.resumePromiseResolver = null;
        }

        notifyProgress();
        console.log("whatsapp-logic: Campaign stopping...");
        return true;
    }

    console.log("whatsapp-logic: Cannot stop - campaign ID mismatch");
    return false;
}

/**
 * Clear campaign state
 */
function clearCampaign() {
    console.log("whatsapp-logic: Clearing campaign state...");

    // Abort any pending async operations from the previous campaign
    if (campaignAbortController) {
        console.log("whatsapp-logic: Aborting pending async operations...");
        campaignAbortController.abort();
        campaignAbortController = null;
    }

    // Resolve any pending resume promise to unblock the loop
    if (campaignState.resumePromiseResolver) {
        console.log("whatsapp-logic: Resolving pending resume promise...");
        campaignState.resumePromiseResolver();
        campaignState.resumePromiseResolver = null;
    }

    // Deep copy to ensure all nested objects are reset properly
    campaignState = {
        id: null,
        status: 'inactive',
        config: {
            countryCode: ''
        },
        contacts: [],
        totalContacts: 0,
        sentCount: 0,
        progressCallback: null,
        logCallback: null,
        resumePromiseResolver: null,
        countdownCallback: null,
        countdownState: {
            isActive: false,
            remainingTime: 0,
            totalTime: 0,
            type: 'idle'
        }
    };
    setCountdownState('idle');

    console.log("whatsapp-logic: Campaign state cleared. sentCount:", campaignState.sentCount, "currentIndex:", campaignState.config.currentIndex);
    return true;
}

/**
 * Get current campaign status
 */
function getCampaignStatus() {
    return {
        id: campaignState.id,
        status: campaignState.status,
        sent: campaignState.sentCount,
        total: campaignState.totalContacts,
        currentIndex: campaignState.config.currentIndex || 0,
        config: campaignState.config
    };
}

/**
 * Update active campaign configuration
 * @returns {Object|null} - Returns the updated campaign status object, or null if update failed
 */
function updateActiveCampaignConfig(newConfig) {
    if (campaignState.status === 'paused') {
        console.log("whatsapp-logic: Updating active campaign configuration...");
        campaignState.config = { ...campaignState.config, ...newConfig };
        notifyProgress();
        // Return the full campaign status object
        return getCampaignStatus();
    }

    console.log("whatsapp-logic: Cannot update config - campaign not paused");
    return null;
}

// ============================================================================
// CLIENT LIFECYCLE
// ============================================================================

/**
 * Destroy client instance
 */
async function destroyClientInstance() {
    const logPrefix = 'Destroy Client';
    logger?.info(`${logPrefix}: Starting client destruction...`);

    if (adapter) {
        try {
            await adapter.destroy();
            adapter = null;
            logger?.info(`${logPrefix}: Client destroyed successfully`);
        } catch (error) {
            logger?.error(`${logPrefix}: Error destroying client: ${error.message}`);
            adapter = null;
        }
    } else {
        logger?.info(`${logPrefix}: No active client to destroy`);
    }

    // Reset state
    isClientInitializing = false;
    initializationStartTime = null;
    clientReadyPromise = null;
    resolveClientReady = null;
    rejectClientReady = null;
}

/**
 * Logout and clear session
 */
async function logoutAndClearSession(dataPath) {
    const logPrefix = 'Logout & Clear Session';
    logger?.info(`${logPrefix}: Starting logout and session clear for path: ${dataPath}`);

    try {
        if (adapter) {
            await adapter.logout();
            adapter = null;
        }

        // Wait for file handles to release
        await delay(2000);

        // Delete session folder
        if (fs.existsSync(dataPath)) {
            logger?.info(`${logPrefix}: Deleting session folder: ${dataPath}`);
            await safeDeletePath(dataPath, 3);
            logger?.info(`${logPrefix}: Session folder deleted successfully`);
        }

        // Reset state
        isClientInitializing = false;
        initializationStartTime = null;
        clientReadyPromise = null;

        logger?.info(`${logPrefix}: Logout and session clear completed`);

    } catch (error) {
        logger?.error(`${logPrefix}: Error during logout and session clear: ${error.message}`);
        throw error;
    }
}

/**
 * Soft logout and reinitialize (keeps session, just reconnects)
 */
async function softLogoutAndReinitialize(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir = null) {
    const logPrefix = 'Soft Logout & Reinitialize';
    logger?.info(`${logPrefix}: Starting soft logout and reinitialize...`);

    try {
        // Destroy current adapter
        if (adapter) {
            await adapter.destroy();
            adapter = null;
        }

        // Wait a moment
        await delay(2000);

        // Reinitialize
        await initializeClient(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir);

        logger?.info(`${logPrefix}: Soft logout and reinitialize completed`);

    } catch (error) {
        logger?.error(`${logPrefix}: Error during soft logout and reinitialize: ${error.message}`);
        throw error;
    }
}

/**
 * Check connection health and reconnect if needed
 * Useful to call after system resume from suspension
 * @returns {Promise<boolean>} - True if connection is healthy
 */
async function checkAndReconnectIfNeeded() {
    const logPrefix = 'Check & Reconnect';
    const timestamp = new Date().toISOString();
    logger?.info(`${logPrefix}: Checking connection health...`);
    console.log(`[${timestamp}] whatsapp-logic: >>>>>> CHECK AND RECONNECT IF NEEDED CALLED <<<<<<`);
    console.log(`[${timestamp}] whatsapp-logic: adapter exists: ${!!adapter}`);

    if (!adapter) {
        logger?.info(`${logPrefix}: No adapter available`);
        console.log(`[${timestamp}] whatsapp-logic: No adapter available, returning false`);
        return false;
    }

    try {
        console.log(`[${timestamp}] whatsapp-logic: Calling adapter.checkAndReconnect()...`);
        // Check if adapter has checkAndReconnect method
        if (typeof adapter.checkAndReconnect === 'function') {
            const isHealthy = await adapter.checkAndReconnect();
            logger?.info(`${logPrefix}: Connection health check result: ${isHealthy ? 'healthy' : 'reconnecting'}`);
            console.log(`[${timestamp}] whatsapp-logic: Health check result: ${isHealthy ? 'HEALTHY' : 'RECONNECTING'}`);
            return isHealthy;
        } else {
            // Fallback: check if authenticated
            const isHealthy = adapter.isAuthenticated();
            logger?.info(`${logPrefix}: Fallback health check (isAuthenticated): ${isHealthy}`);
            console.log(`[${timestamp}] whatsapp-logic: Fallback health check result: ${isHealthy ? 'HEALTHY' : 'NOT AUTHENTICATED'}`);
            return isHealthy;
        }
    } catch (error) {
        logger?.error(`${logPrefix}: Error during health check: ${error.message}`);
        console.error(`[${timestamp}] whatsapp-logic: Error during health check: ${error.message}`);
        return false;
    }
}

/**
 * Force reconnection to WhatsApp
 * Useful after system resume from sleep/suspend
 * @returns {Promise<void>}
 */
async function forceReconnect() {
    const logPrefix = 'Force Reconnect';
    const timestamp = new Date().toISOString();
    logger?.info(`${logPrefix}: Force reconnect requested...`);
    console.log(`[${timestamp}] whatsapp-logic: >>>>>> FORCE RECONNECT CALLED <<<<<<`);
    console.log(`[${timestamp}] whatsapp-logic: adapter exists: ${!!adapter}`);

    if (!adapter) {
        logger?.info(`${logPrefix}: No adapter available, cannot reconnect`);
        console.log(`[${timestamp}] whatsapp-logic: No adapter available, cannot reconnect`);
        return;
    }

    try {
        console.log(`[${timestamp}] whatsapp-logic: Calling adapter.forceReconnect()...`);
        // Check if adapter has forceReconnect method
        if (typeof adapter.forceReconnect === 'function') {
            await adapter.forceReconnect();
            logger?.info(`${logPrefix}: Force reconnect initiated`);
            console.log(`[${timestamp}] whatsapp-logic: Force reconnect initiated successfully`);
        } else {
            // Fallback: destroy and let main.js reinitialize
            logger?.warn(`${logPrefix}: Adapter does not support forceReconnect, destroying client`);
            console.log(`[${timestamp}] whatsapp-logic: Adapter does not support forceReconnect, destroying client`);
            await destroyClientInstance();
        }
    } catch (error) {
        logger?.error(`${logPrefix}: Error during force reconnect: ${error.message}`);
        console.error(`[${timestamp}] whatsapp-logic: Error during force reconnect: ${error.message}`);
    }
}

/**
 * Get the current logger instance for external modules (like baileys-adapter)
 * @returns {object|null} - Winston logger instance or null if not initialized
 */
function getLogger() {
    return logger;
}

/**
 * Validate client closure
 */
async function validateClientClosure() {
    return adapter === null;
}

/**
 * Perform emergency cleanup
 */
async function performEmergencyCleanup(reason = 'emergency') {
    const logPrefix = 'Emergency Cleanup';
    logger?.info(`${logPrefix}: Starting emergency cleanup due to: ${reason}`);

    try {
        // Stop any ongoing campaigns
        if (campaignState.status === 'running' || campaignState.status === 'pausing') {
            campaignState.status = 'stopped';
            if (campaignState.resumePromiseResolver) {
                campaignState.resumePromiseResolver();
                campaignState.resumePromiseResolver = null;
            }
        }

        // Destroy client
        await destroyClientInstance();

        logger?.info(`${logPrefix}: Emergency cleanup completed`);
        return true;

    } catch (error) {
        logger?.error(`${logPrefix}: Error during emergency cleanup: ${error.message}`);
        return false;
    }
}

// ============================================================================
// EXCEL FUNCTIONS
// ============================================================================

/**
 * Get Excel headers with validation
 */
async function getExcelHeaders(excelPath) {
    try {
        const datos = await safeReadExcelFile(excelPath, 3);

        if (datos.length > 0) {
            const workbook = XLSX.readFile(excelPath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const datosArray = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            if (datosArray.length > 0) {
                const rawHeaders = datosArray[0];

                const hasItem = rawHeaders.some(header => header && header.toLowerCase() === 'item');
                const hasNumero = rawHeaders.some(header => header && header.toLowerCase() === 'numero');

                const missingFields = [];
                if (!hasItem) missingFields.push('item');
                if (!hasNumero) missingFields.push('numero');

                const headers = rawHeaders.filter(header =>
                    header && header.toLowerCase() !== 'item' && header.toLowerCase() !== 'numero'
                );

                return {
                    headers,
                    hasRequiredFields: missingFields.length === 0,
                    missingFields
                };
            }
        }

        return { headers: [], hasRequiredFields: false, missingFields: ['item', 'numero'] };

    } catch (error) {
        console.error("whatsapp-logic: Error reading Excel headers:", error);
        throw error;
    }
}

/**
 * Get first Excel row
 */
async function getFirstExcelRow(excelPath) {
    try {
        const datos = await safeReadExcelFile(excelPath, 3);

        if (datos.length > 0) {
            return datos[0];
        }
        return null;

    } catch (error) {
        console.error("whatsapp-logic: Error reading first Excel row:", error);
        throw error;
    }
}

// ============================================================================
// LEGACY COMPATIBILITY STUBS (Puppeteer-related, now no-ops)
// ============================================================================

// These functions are no longer needed with Baileys but are kept for API compatibility

function registerBotProcess(pid) {
    // No-op: Baileys doesn't use browser processes
}

function unregisterBotProcess(pid) {
    // No-op: Baileys doesn't use browser processes
}

function clearBotProcesses() {
    // No-op: Baileys doesn't use browser processes
}

function monitorBotProcesses() {
    // No-op: Baileys doesn't use browser processes
}

function startProcessMonitoring() {
    // No-op: Baileys doesn't use browser processes
}

function stopProcessMonitoring() {
    // No-op: Baileys doesn't use browser processes
}

async function safeLogoutWithEBUSYHandling(clientInstance, maxRetries = 3) {
    // Simplified: Just logout through adapter
    if (adapter) {
        try {
            await adapter.logout();
            return true;
        } catch (error) {
            logger?.error(`Safe Logout: Error: ${error.message}`);
            return false;
        }
    }
    return true;
}

async function forceReleaseChromeProcesses() {
    // No-op: Baileys doesn't use Chrome
    return true;
}

async function aggressiveSessionCleanup(sessionPath, maxRetries = 3) {
    // Simplified: Just delete the session folder
    return safeDeletePath(sessionPath, maxRetries);
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = {
    initializeClient,
    startSending,
    pauseSending,
    resumeSending,
    stopSending,
    clearCampaign,
    restartSendingFromState,
    getCampaignStatus,
    updateActiveCampaignConfig,
    logoutAndClearSession,
    destroyClientInstance,
    performEmergencyCleanup,
    validateClientClosure,
    getExcelHeaders,
    getFirstExcelRow,
    getClientStatus,
    softLogoutAndReinitialize,
    setCountdownState,
    notifyCountdown,
    processMessageVariables,
    sendCampaignStartNotification,
    // Connection health check and reconnection
    checkAndReconnectIfNeeded,
    forceReconnect,
    // Logger access for external modules
    getLogger,
    initializeLogger,
    // Legacy compatibility (Puppeteer-related, now no-ops)
    safeLogoutWithEBUSYHandling,
    forceReleaseChromeProcesses,
    aggressiveSessionCleanup,
    registerBotProcess,
    unregisterBotProcess,
    clearBotProcesses,
    monitorBotProcesses,
    startProcessMonitoring,
    stopProcessMonitoring
};
