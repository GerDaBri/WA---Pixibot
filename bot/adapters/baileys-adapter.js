/**
 * Baileys WhatsApp Adapter
 *
 * Implementation of WhatsApp adapter using @whiskeysockets/baileys library.
 * Uses WebSocket connection directly (no browser/Puppeteer required).
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const NodeCache = require('node-cache');
const BaseWhatsAppAdapter = require('./base-adapter');

// Mime types for media files
const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav'
};

// Image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi'];

// Audio extensions
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav'];

// Updated fallback version - must be kept current when WhatsApp rejects old versions (405)
// Source: https://github.com/WhiskeySockets/Baileys/blob/master/src/Defaults/index.ts
const FALLBACK_WA_VERSION = [2, 3000, 1035194821];

/**
 * Fetch the latest WhatsApp Web version with multiple fallback sources.
 * Order: 1) WhatsApp sw.js (direct) → 2) Baileys GitHub repo → 3) Hardcoded fallback
 * @param {object} [logger] - Optional Winston logger for persistent logging
 * @returns {Promise<{version: number[], source: string}>}
 */
async function fetchWAVersion(logger) {
    const log = (level, msg) => {
        console.log(msg);
        if (logger) logger[level]?.(msg);
    };

    // Source 1: Fetch directly from WhatsApp Web service worker
    try {
        const response = await fetch('https://web.whatsapp.com/sw.js', {
            method: 'GET',
            headers: {
                'sec-fetch-site': 'none',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
            const data = await response.text();
            const match = data.match(/client_revision[\\\"]*:\s*(\d+)/);
            if (match?.[1]) {
                const revision = parseInt(match[1]);
                const version = [2, 3000, revision];
                log('info', `fetchWAVersion: Got version from WhatsApp sw.js: ${version.join('.')}`);
                return { version, source: 'whatsapp-sw.js' };
            }
        }
    } catch (err) {
        log('warn', `fetchWAVersion: Could not fetch from WhatsApp sw.js: ${err.message}`);
    }

    // Source 2: Fetch from Baileys GitHub repository (what fetchLatestBaileysVersion does)
    try {
        const versionInfo = await fetchLatestBaileysVersion();
        if (versionInfo?.version?.length === 3) {
            log('info', `fetchWAVersion: Got version from Baileys repo: ${versionInfo.version.join('.')}`);
            return { version: versionInfo.version, source: 'baileys-repo' };
        }
    } catch (err) {
        log('warn', `fetchWAVersion: Could not fetch from Baileys repo: ${err.message}`);
    }

    // Source 3: Hardcoded fallback (updated periodically)
    log('warn', `fetchWAVersion: All sources failed, using hardcoded fallback: ${FALLBACK_WA_VERSION.join('.')}`);
    return { version: [...FALLBACK_WA_VERSION], source: 'fallback' };
}

class BaileysAdapter extends BaseWhatsAppAdapter {
    constructor() {
        super();
        this.sock = null;
        this.state = null;
        this.saveCreds = null;
        this.sessionPath = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.isDestroying = false;
        this.initializationPromise = null;
        this.qrShownButNotScanned = false; // Track if we showed QR but user didn't scan
        this.qrRegenerationAttempts = 0; // Track QR regeneration attempts
        this.maxQrRegenerationAttempts = 10; // Max attempts before giving up
        this.lastActivityTime = Date.now(); // Track last activity for connection health
        this.connectionHealthCheckInterval = null; // Interval for periodic health checks
        this.silentReconnectInProgress = false; // Track silent reconnection attempts
        this.wasEverAuthenticated = false; // Track if we ever had a successful authentication
        this.lastKnownUserId = null; // Store the last known user ID for recovery
        this._logoutRecoveryAttempted = false; // Prevent infinite logout recovery loops
        // Logger with info level to see connection details and important messages
        // Filter out noise from multi-device sync (doesn't affect sending)
        const SILENCED_MESSAGES = [
            'failed to decrypt message',  // Can't decrypt messages from other devices
            'sent retry receipt'          // Retry requests for undecryptable messages
        ];
        this.logger = pino({
            level: 'info',
            hooks: {
                logMethod(inputArgs, method, level) {
                    const msg = inputArgs.find(arg => typeof arg === 'string');
                    if (msg && SILENCED_MESSAGES.some(silenced => msg.includes(silenced))) {
                        // Silently ignore - normal in multi-device, doesn't affect sending
                        return;
                    }
                    return method.apply(this, inputArgs);
                }
            }
        });
        // Message retry cache to prevent infinite retry loops
        this.msgRetryCounterCache = new NodeCache({ stdTTL: 60 * 60, checkperiod: 60 });
    }

    /**
     * Initialize the Baileys WhatsApp client
     * @param {string} sessionPath - Path to store session data
     * @param {object} callbacks - Callback functions
     */
    async initialize(sessionPath, callbacks = {}) {
        // Prevent multiple simultaneous initializations
        if (this.initializationPromise) {
            console.log('baileys-adapter: Already initializing, waiting for completion...');
            return this.initializationPromise;
        }

        this.initializationPromise = this._doInitialize(sessionPath, callbacks);

        try {
            await this.initializationPromise;
        } finally {
            this.initializationPromise = null;
        }
    }

    async _doInitialize(sessionPath, callbacks) {
        console.log('baileys-adapter: Initializing...');
        this.sessionPath = sessionPath;
        this.isDestroying = false;

        // Store callbacks
        if (callbacks.onQrCode) this.on('qr', callbacks.onQrCode);
        if (callbacks.onClientReady) this.on('ready', callbacks.onClientReady);
        if (callbacks.onDisconnected) this.on('disconnected', callbacks.onDisconnected);
        if (callbacks.onAuthFailure) this.on('auth_failure', callbacks.onAuthFailure);

        // Check for and clean old whatsapp-web.js session
        await this._cleanOldSession(sessionPath);

        // Ensure session directory exists
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        // Load or create authentication state
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        this.state = state;
        this.saveCreds = saveCreds;

        this.connectionState = 'connecting';

        // Fetch WhatsApp Web version with multiple fallback sources
        const { version, source } = await fetchWAVersion(this.externalLogger);
        console.log(`baileys-adapter: Using WA version ${version.join('.')} (source: ${source})`);
        this.externalLogger?.info(`Baileys Adapter: Using WA version ${version.join('.')} (source: ${source})`);

        // Create WhatsApp socket with proper configuration
        const socketConfig = {
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, this.logger)
            },
            printQRInTerminal: false,
            logger: this.logger,
            // Use Windows browser signature for better compatibility
            browser: Browsers.windows('Desktop'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            emitOwnEvents: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            // Message retry counter cache to prevent infinite loops
            msgRetryCounterCache: this.msgRetryCounterCache,
            // Retry failed messages
            retryRequestDelayMs: 250,
            // Handle message retry requests
            getMessage: async (key) => {
                // Return undefined if we don't have the message
                // This is needed for message retry functionality
                return undefined;
            }
        };

        // Always add version to avoid 405 connection errors
        socketConfig.version = version;

        console.log('baileys-adapter: Creating socket with config...');
        this.sock = makeWASocket(socketConfig);

        // Setup event listeners
        this._setupEventListeners();

        console.log('baileys-adapter: Socket created, waiting for connection...');
    }

    /**
     * Clean old whatsapp-web.js session if present or detect corrupted Baileys session
     * @param {string} sessionPath - Session directory path
     */
    async _cleanOldSession(sessionPath) {
        if (!fs.existsSync(sessionPath)) {
            console.log('baileys-adapter: Session path does not exist, nothing to clean');
            return;
        }

        // Check for whatsapp-web.js session markers
        const oldSessionMarkers = [
            'session-new_client',
            'Default',
            'SingletonLock',
            'Cookies',
            'Local Storage',
            'IndexedDB'
        ];

        let hasOldSession = false;
        let sessionFiles = [];

        try {
            sessionFiles = fs.readdirSync(sessionPath);
        } catch (error) {
            console.error('baileys-adapter: Error reading session directory:', error.message);
            return;
        }

        // Check for old whatsapp-web.js markers
        for (const file of sessionFiles) {
            if (oldSessionMarkers.includes(file)) {
                hasOldSession = true;
                console.log(`baileys-adapter: Found old session marker: ${file}`);
                break;
            }
        }

        // Also check if there are NO Baileys files (creds.json) but directory is not empty
        // This indicates a corrupted or incompatible session
        const hasBaileysCredsFile = sessionFiles.includes('creds.json');
        const hasOnlyNonBaileysFiles = !hasBaileysCredsFile && sessionFiles.length > 0;

        if (hasOldSession || hasOnlyNonBaileysFiles) {
            const reason = hasOldSession ? 'old whatsapp-web.js session' : 'incompatible/corrupted session files';
            console.log(`baileys-adapter: Detected ${reason}, cleaning...`);
            console.log('baileys-adapter: Files in session directory:', sessionFiles);

            try {
                // Remove all contents of session directory
                for (const file of sessionFiles) {
                    const filePath = path.join(sessionPath, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                            fs.rmSync(filePath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(filePath);
                        }
                    } catch (fileError) {
                        console.error(`baileys-adapter: Error removing ${file}:`, fileError.message);
                    }
                }
                console.log('baileys-adapter: Session cleaned successfully');
            } catch (error) {
                console.error('baileys-adapter: Error cleaning session:', error.message);
            }
        } else {
            console.log('baileys-adapter: Session appears to be valid Baileys session');
            if (hasBaileysCredsFile) {
                console.log('baileys-adapter: Found creds.json - will attempt to restore session');
            }
        }
    }

    /**
     * Setup Baileys event listeners
     */
    _setupEventListeners() {
        // Credential updates - save session with error handling and backup
        this.sock.ev.on('creds.update', async () => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] baileys-adapter: creds.update event received`);

            try {
                // Log state before save
                const hasCredsBeforeSave = this._hasValidCredentials();
                console.log(`baileys-adapter: creds.update - hasCredsInMemory before save: ${hasCredsBeforeSave}`);

                await this.saveCreds();

                // Verify save was successful by checking disk
                const hasCredsOnDisk = this._hasCredentialsOnDisk();
                console.log(`baileys-adapter: Credentials saved successfully, verified on disk: ${hasCredsOnDisk}`);

                // Create backup after successful save (if we have valid creds)
                if (hasCredsOnDisk && this.wasEverAuthenticated) {
                    this._backupCredentials();
                }

                this.externalLogger?.info(`Baileys Adapter: Credentials saved, disk verified: ${hasCredsOnDisk}`);
            } catch (error) {
                console.error('baileys-adapter: ERROR saving credentials:', error.message);
                this.externalLogger?.error(`Baileys Adapter: Failed to save credentials: ${error.message}`);

                // Log full credential state on error
                this._logCredentialState('CREDS_SAVE_ERROR');

                // Retry saving credentials after a short delay
                setTimeout(async () => {
                    try {
                        await this.saveCreds();
                        console.log('baileys-adapter: Credentials saved on retry');
                        this.externalLogger?.info('Baileys Adapter: Credentials saved on retry');
                    } catch (retryError) {
                        console.error('baileys-adapter: Retry save credentials failed:', retryError.message);
                        this.externalLogger?.error(`Baileys Adapter: Retry save failed: ${retryError.message}`);
                    }
                }, 1000);
            }
        });

        // Connection state changes
        this.sock.ev.on('connection.update', (update) => {
            this._handleConnectionUpdate(update);
        });

        // Message updates (for delivery status tracking, optional)
        this.sock.ev.on('messages.update', (updates) => {
            // Can be used to track message delivery status
            for (const update of updates) {
                if (update.update.status) {
                    // Status: 1 = pending, 2 = sent, 3 = delivered, 4 = read
                    console.log(`baileys-adapter: Message ${update.key.id} status: ${update.update.status}`);
                }
            }
        });
    }

    /**
     * Handle connection update events
     * @param {object} update - Connection update object
     */
    _handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        console.log('baileys-adapter: connection.update event:', JSON.stringify({
            connection,
            hasQr: !!qr,
            qrLength: qr ? qr.length : 0,
            lastDisconnectError: lastDisconnect?.error?.message
        }));

        // QR code received - needs scanning
        if (qr) {
            console.log('baileys-adapter: QR code received, length:', qr.length);
            console.log('baileys-adapter: QR code first 50 chars:', qr.substring(0, 50));
            this.connectionState = 'waiting_qr';
            this.qrShownButNotScanned = true; // Mark that we're waiting for QR scan
            this.qrRegenerationAttempts = 0; // Reset regeneration counter when we successfully get a QR
            this.emit('qr', qr);
        }

        // Connection opened - authenticated and ready
        if (connection === 'open') {
            console.log('baileys-adapter: Connection opened, client ready');
            this.connectionState = 'connected';
            this.reconnectAttempts = 0;
            this.qrShownButNotScanned = false; // Successfully authenticated
            this.silentReconnectInProgress = false;
            this.lastActivityTime = Date.now();

            // Mark that we have successfully authenticated at least once
            this.wasEverAuthenticated = true;
            this.lastKnownUserId = this.sock.user?.id || null;
            console.log(`baileys-adapter: Authentication successful, userId: ${this.lastKnownUserId}`);
            this.externalLogger?.info(`Baileys Adapter: Authenticated successfully as ${this.lastKnownUserId}`);

            // Create backup of credentials after successful authentication
            this._backupCredentials();

            // Store client info
            this.clientInfo = {
                me: this.sock.user,
                pushname: this.sock.user?.name
            };

            // Log credential state after successful connection
            this._logCredentialState('CONNECTION_OPEN');

            // Start periodic connection health check
            this._startConnectionHealthCheck();

            this.emit('ready');
        }

        // Connection closed
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : lastDisconnect?.error?.output?.statusCode;

            const errorMessage = lastDisconnect?.error?.message || 'Unknown error';

            console.log(`baileys-adapter: Connection closed. Status: ${statusCode}, Error: ${errorMessage}`);
            this.externalLogger?.warn(`Baileys Adapter: Connection closed - code: ${statusCode}, error: ${errorMessage}`);

            // Log full credential state on disconnect
            this._logCredentialState('CONNECTION_CLOSE');

            this.connectionState = 'disconnected';

            // IMPROVED: Check credentials both in memory AND on disk
            const hasCredsInMemory = this._hasValidCredentials();
            const hasCredsOnDisk = this._hasCredentialsOnDisk();

            // Check if we were waiting for QR scan
            // FIXED: Also consider wasEverAuthenticated to avoid false positives
            const wasWaitingForQR = this.qrShownButNotScanned && !this.wasEverAuthenticated;

            console.log(`baileys-adapter: wasWaitingForQR=${wasWaitingForQR}, qrShownButNotScanned=${this.qrShownButNotScanned}, wasEverAuthenticated=${this.wasEverAuthenticated}`);
            console.log(`baileys-adapter: hasCredsInMemory=${hasCredsInMemory}, hasCredsOnDisk=${hasCredsOnDisk}`);

            // Check if we should reconnect
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !this.isDestroying;

            if (statusCode === DisconnectReason.loggedOut) {
                // If we were waiting for QR and got logout, this is normal - just reconnect for new QR
                if (wasWaitingForQR) {
                    console.log('baileys-adapter: Logout during QR wait - this is normal, reconnecting for new QR...');
                    this._clearSession();
                    setTimeout(() => {
                        if (!this.isDestroying) {
                            this._reconnect();
                        }
                    }, 2000);
                    return;
                }

                // Detect if this is a CONFIRMED logout (conflict = user closed session from phone/other device)
                // vs a potentially transient 401 (network issues, temporary server errors)
                const isConfirmedLogout = errorMessage.toLowerCase().includes('conflict');

                if (isConfirmedLogout) {
                    // CONFIRMED LOGOUT: "conflict" means WhatsApp explicitly revoked the session.
                    // No point retrying - accept immediately and let the app generate a new QR.
                    console.log('baileys-adapter: CONFIRMED logout (conflict) - session revoked by WhatsApp');
                    this.externalLogger?.info('Baileys Adapter: Confirmed logout (conflict detected), clearing session for new QR');
                    this._logoutRecoveryAttempted = false;
                    this.clientInfo = null;
                    this.qrShownButNotScanned = false;
                    this._clearSession();
                    this.emit('auth_failure', 'LOGOUT');
                    this.emit('disconnected', 'LOGOUT');
                    return;
                }

                // AMBIGUOUS 401: Could be transient (network instability, temporary WhatsApp error).
                // Try recovery with up to maxReconnectAttempts to avoid forcing re-auth on flaky networks.
                if (this.wasEverAuthenticated && hasCredsOnDisk && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    console.log(`baileys-adapter: Ambiguous 401 with valid creds, recovery attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
                    this.externalLogger?.warn(`Baileys Adapter: Ambiguous 401, recovery attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

                    const delay = 3000 * this.reconnectAttempts;
                    setTimeout(async () => {
                        if (!this.isDestroying) {
                            const restored = await this._silentReconnect();
                            if (!restored && this.reconnectAttempts >= this.maxReconnectAttempts) {
                                console.log('baileys-adapter: All recovery attempts failed, accepting logout');
                                this.externalLogger?.info('Baileys Adapter: Max recovery attempts reached, accepting logout');
                                this._logoutRecoveryAttempted = false;
                                this._clearSession();
                                this.emit('auth_failure', 'LOGOUT');
                                this.emit('disconnected', 'LOGOUT');
                            }
                            // If not at max attempts yet, _silentReconnect failure will trigger
                            // another connection.close event which re-enters this handler
                        }
                    }, delay);
                    return;
                }

                // No creds or max attempts exhausted - accept logout
                console.log('baileys-adapter: Accepting logout - clearing session');
                this.clientInfo = null;
                this.qrShownButNotScanned = false;
                this._clearSession(); // Clear invalid session data
                this.emit('auth_failure', 'LOGOUT');
                this.emit('disconnected', 'LOGOUT');
            } else if (statusCode === DisconnectReason.badSession) {
                // Bad session - needs re-auth
                console.log('baileys-adapter: Bad session, clearing and requesting new auth');
                this.qrShownButNotScanned = false;
                this._clearSessionAndReconnect();
            } else if (statusCode === 515) {
                // QR expired - this is normal, just reconnect for a new QR
                console.log('baileys-adapter: QR code expired (515), reconnecting for new QR...');
                this.qrRegenerationAttempts++;

                if (this.qrRegenerationAttempts >= this.maxQrRegenerationAttempts) {
                    console.log('baileys-adapter: Max QR regeneration attempts reached, giving up');
                    this.qrShownButNotScanned = false;
                    this.emit('auth_failure', 'QR_TIMEOUT');
                    this.emit('disconnected', 'qr_timeout');
                    return;
                }

                // Don't clear session on QR expiry - just reconnect
                // Wait a bit before reconnecting
                const delay = 2000;
                console.log(`baileys-adapter: Waiting ${delay}ms before reconnecting for new QR...`);

                setTimeout(() => {
                    if (!this.isDestroying) {
                        this._reconnect();
                    }
                }, delay);
            } else if (statusCode === 405 && wasWaitingForQR) {
                // Connection failed while waiting for QR - likely network/server issue
                // Use longer delays and don't count as QR regeneration attempt
                this.reconnectAttempts++;
                console.log(`baileys-adapter: Connection failed during QR wait (405), attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

                if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    console.log('baileys-adapter: Max reconnect attempts reached during QR wait');
                    this.qrShownButNotScanned = false;
                    this.emit('auth_failure', 'CONNECTION_FAILED');
                    this.emit('disconnected', 'connection_failed');
                    return;
                }

                // Clear session and wait longer before retry
                this._clearSession();
                const delay = 5000 + (this.reconnectAttempts * 2000); // 7s, 9s, 11s, etc.
                console.log(`baileys-adapter: Waiting ${delay}ms before reconnecting (connection issue)...`);

                setTimeout(() => {
                    if (!this.isDestroying) {
                        this._reconnect();
                    }
                }, delay);
            } else if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                // Attempt reconnection for authenticated sessions
                this.reconnectAttempts++;
                console.log(`baileys-adapter: Attempting reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                this.externalLogger?.info(`Baileys Adapter: Unexpected disconnect (code: ${statusCode}), attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

                // Log session state for debugging
                const hasCredentials = this._hasValidCredentials();
                console.log(`baileys-adapter: Has valid credentials: ${hasCredentials}, clientInfo exists: ${!!this.clientInfo}`);

                // Check if creds.json still exists on disk
                if (this.sessionPath) {
                    const credsPath = path.join(this.sessionPath, 'creds.json');
                    const credsExists = fs.existsSync(credsPath);
                    console.log(`baileys-adapter: creds.json exists on disk: ${credsExists}`);

                    if (!credsExists && hasCredentials) {
                        console.log('baileys-adapter: WARNING - creds in memory but not on disk! Saving...');
                        // Save credentials asynchronously (fire and forget with error handling)
                        this.saveCreds().then(() => {
                            console.log('baileys-adapter: Credentials saved to disk');
                        }).catch((saveError) => {
                            console.error('baileys-adapter: Failed to save credentials:', saveError.message);
                        });
                    }
                }

                const reconnectDelay = 3000 * this.reconnectAttempts;
                console.log(`baileys-adapter: Waiting ${reconnectDelay}ms before reconnect...`);

                setTimeout(async () => {
                    if (!this.isDestroying) {
                        // Use silent reconnect if we have credentials
                        if (this._hasValidCredentials()) {
                            console.log('baileys-adapter: Using silent reconnect (have credentials)');
                            const success = await this._silentReconnect();
                            if (!success) {
                                console.log('baileys-adapter: Silent reconnect failed, falling back to normal reconnect');
                                this._reconnect();
                            }
                        } else {
                            this._reconnect();
                        }
                    }
                }, reconnectDelay);
            } else {
                // Cannot reconnect
                this.qrShownButNotScanned = false;
                const reason = statusCode === DisconnectReason.loggedOut ? 'LOGOUT' : 'connection_closed';
                console.log(`baileys-adapter: Cannot reconnect, emitting disconnected: ${reason}`);
                this.externalLogger?.error(`Baileys Adapter: Cannot reconnect after ${this.reconnectAttempts} attempts`);
                this.emit('disconnected', reason);
            }
        }
    }

    /**
     * Check if we have valid credentials stored (in memory)
     * @returns {boolean}
     */
    _hasValidCredentials() {
        try {
            if (!this.state || !this.state.creds) {
                console.log('baileys-adapter: _hasValidCredentials: No state or creds in memory');
                return false;
            }
            const hasValidCreds = !!(this.state.creds.me && this.state.creds.me.id);
            console.log(`baileys-adapter: _hasValidCredentials: memory=${hasValidCreds}, me.id=${this.state.creds.me?.id || 'null'}`);
            return hasValidCreds;
        } catch (error) {
            console.log('baileys-adapter: _hasValidCredentials error:', error.message);
            return false;
        }
    }

    /**
     * Check if we have valid credentials on disk
     * @returns {boolean}
     */
    _hasCredentialsOnDisk() {
        try {
            if (!this.sessionPath) {
                console.log('baileys-adapter: _hasCredentialsOnDisk: No sessionPath set');
                return false;
            }
            const credsPath = path.join(this.sessionPath, 'creds.json');
            if (!fs.existsSync(credsPath)) {
                console.log('baileys-adapter: _hasCredentialsOnDisk: creds.json does not exist');
                return false;
            }
            const credsContent = fs.readFileSync(credsPath, 'utf8');
            const credsData = JSON.parse(credsContent);
            const hasValidCreds = !!(credsData.me && credsData.me.id);
            console.log(`baileys-adapter: _hasCredentialsOnDisk: disk=${hasValidCreds}, me.id=${credsData.me?.id || 'null'}`);
            return hasValidCreds;
        } catch (error) {
            console.log('baileys-adapter: _hasCredentialsOnDisk error:', error.message);
            return false;
        }
    }

    /**
     * Create a backup of credentials before risky operations
     * @returns {boolean} - True if backup was created successfully
     */
    _backupCredentials() {
        try {
            if (!this.sessionPath) return false;

            const credsPath = path.join(this.sessionPath, 'creds.json');
            const backupPath = path.join(this.sessionPath, 'creds.backup.json');

            if (!fs.existsSync(credsPath)) {
                console.log('baileys-adapter: _backupCredentials: No creds.json to backup');
                return false;
            }

            // Read and validate before backup
            const credsContent = fs.readFileSync(credsPath, 'utf8');
            const credsData = JSON.parse(credsContent);

            if (!credsData.me || !credsData.me.id) {
                console.log('baileys-adapter: _backupCredentials: creds.json is invalid, not backing up');
                return false;
            }

            fs.copyFileSync(credsPath, backupPath);
            console.log(`baileys-adapter: _backupCredentials: Backup created for user ${credsData.me.id}`);
            this.externalLogger?.info(`Baileys Adapter: Credentials backup created for ${credsData.me.id}`);
            return true;
        } catch (error) {
            console.error('baileys-adapter: _backupCredentials error:', error.message);
            this.externalLogger?.error(`Baileys Adapter: Failed to backup credentials: ${error.message}`);
            return false;
        }
    }

    /**
     * Restore credentials from backup if main creds are missing/invalid
     * @returns {boolean} - True if restore was successful
     */
    _restoreCredentialsFromBackup() {
        try {
            if (!this.sessionPath) return false;

            const credsPath = path.join(this.sessionPath, 'creds.json');
            const backupPath = path.join(this.sessionPath, 'creds.backup.json');

            // Check if backup exists
            if (!fs.existsSync(backupPath)) {
                console.log('baileys-adapter: _restoreCredentialsFromBackup: No backup file exists');
                return false;
            }

            // Validate backup
            const backupContent = fs.readFileSync(backupPath, 'utf8');
            const backupData = JSON.parse(backupContent);

            if (!backupData.me || !backupData.me.id) {
                console.log('baileys-adapter: _restoreCredentialsFromBackup: Backup is invalid');
                return false;
            }

            // Check if current creds are missing or invalid
            let needsRestore = false;
            if (!fs.existsSync(credsPath)) {
                needsRestore = true;
                console.log('baileys-adapter: _restoreCredentialsFromBackup: creds.json missing, will restore');
            } else {
                try {
                    const currentContent = fs.readFileSync(credsPath, 'utf8');
                    const currentData = JSON.parse(currentContent);
                    if (!currentData.me || !currentData.me.id) {
                        needsRestore = true;
                        console.log('baileys-adapter: _restoreCredentialsFromBackup: creds.json invalid, will restore');
                    }
                } catch (parseError) {
                    needsRestore = true;
                    console.log('baileys-adapter: _restoreCredentialsFromBackup: creds.json corrupted, will restore');
                }
            }

            if (needsRestore) {
                fs.copyFileSync(backupPath, credsPath);
                console.log(`baileys-adapter: _restoreCredentialsFromBackup: Restored credentials for user ${backupData.me.id}`);
                this.externalLogger?.info(`Baileys Adapter: Credentials restored from backup for ${backupData.me.id}`);
                return true;
            }

            console.log('baileys-adapter: _restoreCredentialsFromBackup: Current creds are valid, no restore needed');
            return false;
        } catch (error) {
            console.error('baileys-adapter: _restoreCredentialsFromBackup error:', error.message);
            this.externalLogger?.error(`Baileys Adapter: Failed to restore credentials: ${error.message}`);
            return false;
        }
    }

    /**
     * Log detailed credential state for debugging
     */
    _logCredentialState(context = '') {
        const prefix = context ? `[${context}] ` : '';
        console.log(`baileys-adapter: ${prefix}=== CREDENTIAL STATE ===`);
        console.log(`baileys-adapter: ${prefix}sessionPath: ${this.sessionPath || 'null'}`);
        console.log(`baileys-adapter: ${prefix}wasEverAuthenticated: ${this.wasEverAuthenticated}`);
        console.log(`baileys-adapter: ${prefix}lastKnownUserId: ${this.lastKnownUserId || 'null'}`);
        console.log(`baileys-adapter: ${prefix}connectionState: ${this.connectionState}`);
        console.log(`baileys-adapter: ${prefix}hasCredsInMemory: ${this._hasValidCredentials()}`);
        console.log(`baileys-adapter: ${prefix}hasCredsOnDisk: ${this._hasCredentialsOnDisk()}`);

        if (this.sessionPath) {
            try {
                const files = fs.existsSync(this.sessionPath) ? fs.readdirSync(this.sessionPath) : [];
                console.log(`baileys-adapter: ${prefix}sessionFiles: ${files.join(', ') || '(empty)'}`);
            } catch (e) {
                console.log(`baileys-adapter: ${prefix}sessionFiles: (error reading: ${e.message})`);
            }
        }
        console.log(`baileys-adapter: ${prefix}=========================`);

        // Also log to external logger
        this.externalLogger?.info(`Baileys Adapter: ${prefix}Credential state - memory: ${this._hasValidCredentials()}, disk: ${this._hasCredentialsOnDisk()}, wasAuth: ${this.wasEverAuthenticated}`);
    }

    /**
     * Clear session files only (no reconnect)
     * Now with protection against accidental clearing of valid sessions
     */
    _clearSession() {
        try {
            // Log state before clearing
            this._logCredentialState('BEFORE_CLEAR_SESSION');

            // PROTECTION: Don't clear if we were ever authenticated and have backup
            if (this.wasEverAuthenticated) {
                console.log('baileys-adapter: _clearSession: WARNING - Clearing session that was previously authenticated!');
                this.externalLogger?.warn('Baileys Adapter: Clearing previously authenticated session');

                // Create backup before clearing
                this._backupCredentials();
            }

            if (fs.existsSync(this.sessionPath)) {
                console.log('baileys-adapter: Clearing session files from:', this.sessionPath);
                const files = fs.readdirSync(this.sessionPath);

                // Keep backup file if it exists
                for (const file of files) {
                    if (file === 'creds.backup.json') {
                        console.log('baileys-adapter: Keeping backup file:', file);
                        continue;
                    }
                    const filePath = path.join(this.sessionPath, file);
                    fs.rmSync(filePath, { recursive: true, force: true });
                }
                console.log('baileys-adapter: Session files cleared (backup preserved if exists)');
            }

            this._logCredentialState('AFTER_CLEAR_SESSION');
        } catch (error) {
            console.error('baileys-adapter: Error clearing session:', error);
            this.externalLogger?.error(`Baileys Adapter: Error clearing session: ${error.message}`);
        }
    }

    /**
     * Clear session and reconnect
     */
    async _clearSessionAndReconnect() {
        try {
            // Clear session files
            this._clearSession();

            // Reconnect with fresh session
            await this._reconnect();
        } catch (error) {
            console.error('baileys-adapter: Error clearing session:', error);
            this.emit('auth_failure', error.message);
        }
    }

    /**
     * Reconnect to WhatsApp
     */
    async _reconnect() {
        if (this.isDestroying) return;

        console.log('baileys-adapter: Reconnecting...');
        this._logCredentialState('RECONNECT_START');

        // Stop health check during reconnection to avoid interference
        this._stopConnectionHealthCheck();

        try {
            // Close existing socket if any
            if (this.sock) {
                console.log('baileys-adapter: Closing existing socket...');
                try {
                    this.sock.ev.removeAllListeners();
                    this.sock.end();
                } catch (closeError) {
                    console.log('baileys-adapter: Error closing socket (ignoring):', closeError.message);
                }
                this.sock = null;
            }

            // Wait longer to ensure socket is fully closed and WhatsApp servers are ready
            console.log('baileys-adapter: Waiting for socket cleanup...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Ensure session directory exists (it may have been cleared)
            if (!fs.existsSync(this.sessionPath)) {
                console.log('baileys-adapter: Creating session directory:', this.sessionPath);
                fs.mkdirSync(this.sessionPath, { recursive: true });
            }

            // Check session files before loading
            const sessionFiles = fs.readdirSync(this.sessionPath);
            console.log('baileys-adapter: Session directory contents:', sessionFiles.join(', ') || '(empty)');

            // TRY TO RESTORE FROM BACKUP if creds.json is missing but we were authenticated
            const credsPath = path.join(this.sessionPath, 'creds.json');
            if (!fs.existsSync(credsPath) && this.wasEverAuthenticated) {
                console.log('baileys-adapter: creds.json missing but we were authenticated, trying backup restore...');
                this.externalLogger?.info('Baileys Adapter: Attempting to restore credentials from backup');
                const restored = this._restoreCredentialsFromBackup();
                if (restored) {
                    console.log('baileys-adapter: Credentials restored from backup successfully!');
                    this.externalLogger?.info('Baileys Adapter: Credentials restored from backup');
                } else {
                    console.log('baileys-adapter: Could not restore from backup, will need QR scan');
                    this.externalLogger?.warn('Baileys Adapter: Backup restore failed, QR scan required');
                }
            }

            // Verify creds.json exists and is valid
            if (fs.existsSync(credsPath)) {
                try {
                    const credsContent = fs.readFileSync(credsPath, 'utf8');
                    const credsData = JSON.parse(credsContent);
                    const hasValidId = !!(credsData.me && credsData.me.id);
                    console.log('baileys-adapter: creds.json exists, has me.id:', hasValidId);
                    if (hasValidId) {
                        console.log('baileys-adapter: creds.json userId:', credsData.me.id);
                    }
                } catch (parseError) {
                    console.error('baileys-adapter: creds.json is corrupted:', parseError.message);
                    this.externalLogger?.error(`Baileys Adapter: creds.json corrupted: ${parseError.message}`);

                    // Try to restore from backup if corrupted
                    if (this.wasEverAuthenticated) {
                        console.log('baileys-adapter: Attempting backup restore due to corruption...');
                        this._restoreCredentialsFromBackup();
                    }
                }
            } else {
                console.log('baileys-adapter: creds.json does not exist - will need QR scan');
            }

            // Reinitialize auth state
            console.log('baileys-adapter: Loading auth state from:', this.sessionPath);
            const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
            this.state = state;
            this.saveCreds = saveCreds;

            console.log('baileys-adapter: Auth state loaded, has creds.me:', !!(state.creds && state.creds.me));
            if (state.creds && state.creds.me) {
                console.log('baileys-adapter: Reconnecting with existing session for:', state.creds.me.id);
            }

            this.connectionState = 'connecting';

            // Fetch WhatsApp Web version with multiple fallback sources
            const { version, source } = await fetchWAVersion(this.externalLogger);
            console.log(`baileys-adapter: Using WA version for reconnect: ${version.join('.')} (source: ${source})`);
            this.externalLogger?.info(`Baileys Adapter: Using WA version for reconnect: ${version.join('.')} (source: ${source})`);
            this.sock = makeWASocket({
                version: version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, this.logger)
                },
                printQRInTerminal: false,
                logger: this.logger,
                browser: Browsers.windows('Desktop'),
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 25000,
                emitOwnEvents: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                markOnlineOnConnect: true,
                msgRetryCounterCache: this.msgRetryCounterCache,
                retryRequestDelayMs: 250,
                getMessage: async (key) => undefined
            });

            this._setupEventListeners();
            console.log('baileys-adapter: Socket created and event listeners attached');
        } catch (error) {
            console.error('baileys-adapter: Reconnection failed:', error);
            this.connectionState = 'disconnected';
            this.emit('disconnected', 'reconnect_failed');
        }
    }

    /**
     * Format phone number to JID (WhatsApp ID)
     * @param {string} phoneNumber - Phone number
     * @param {string} countryCode - Country code (optional)
     * @returns {string} - Formatted JID
     */
    formatJID(phoneNumber, countryCode = '') {
        // Clean the phone number (remove non-numeric characters except +)
        let cleanNumber = String(phoneNumber).replace(/[^0-9+]/g, '');

        // Remove leading + if present
        if (cleanNumber.startsWith('+')) {
            cleanNumber = cleanNumber.substring(1);
        }

        // Add country code if provided and number doesn't already have it
        if (countryCode) {
            const cleanCountryCode = String(countryCode).replace(/[^0-9]/g, '');
            if (!cleanNumber.startsWith(cleanCountryCode)) {
                cleanNumber = cleanCountryCode + cleanNumber;
            }
        }

        // Return in Baileys JID format (@s.whatsapp.net for personal chats)
        return `${cleanNumber}@s.whatsapp.net`;
    }

    /**
     * Send a text message
     * @param {string} phoneNumber - Phone number
     * @param {string} text - Message text
     * @param {string} countryCode - Country code (optional)
     * @returns {Promise<object>} - Message result
     */
    async sendTextMessage(phoneNumber, text, countryCode = '') {
        if (!this.sock || this.connectionState !== 'connected') {
            throw new Error('WhatsApp client is not connected');
        }

        const jid = this.formatJID(phoneNumber, countryCode);
        console.log(`baileys-adapter: Sending text message to ${jid}`);

        try {
            const result = await this.sock.sendMessage(jid, { text });
            console.log(`baileys-adapter: Message sent successfully to ${jid}`);
            return result;
        } catch (error) {
            console.error(`baileys-adapter: Failed to send message to ${jid}:`, error.message);
            throw error;
        }
    }

    /**
     * Send a media message (image, video, document)
     * @param {string} phoneNumber - Phone number
     * @param {string} mediaPath - Path to media file
     * @param {string} caption - Caption (optional)
     * @param {string} countryCode - Country code (optional)
     * @returns {Promise<object>} - Message result
     */
    async sendMediaMessage(phoneNumber, mediaPath, caption = '', countryCode = '') {
        if (!this.sock || this.connectionState !== 'connected') {
            throw new Error('WhatsApp client is not connected');
        }

        if (!fs.existsSync(mediaPath)) {
            throw new Error(`Media file not found: ${mediaPath}`);
        }

        const jid = this.formatJID(phoneNumber, countryCode);
        const ext = path.extname(mediaPath).toLowerCase();
        const mimetype = MIME_TYPES[ext] || 'application/octet-stream';
        const fileName = path.basename(mediaPath);

        console.log(`baileys-adapter: Sending media (${ext}) to ${jid}`);

        try {
            const mediaBuffer = fs.readFileSync(mediaPath);
            let messageContent;

            if (IMAGE_EXTENSIONS.includes(ext)) {
                // Image message
                messageContent = {
                    image: mediaBuffer,
                    caption: caption || undefined,
                    mimetype
                };
            } else if (VIDEO_EXTENSIONS.includes(ext)) {
                // Video message
                messageContent = {
                    video: mediaBuffer,
                    caption: caption || undefined,
                    mimetype
                };
            } else if (AUDIO_EXTENSIONS.includes(ext)) {
                // Audio message
                messageContent = {
                    audio: mediaBuffer,
                    mimetype,
                    ptt: false // Set to true for voice note
                };
            } else {
                // Document message (PDF, etc.)
                messageContent = {
                    document: mediaBuffer,
                    caption: caption || undefined,
                    mimetype,
                    fileName
                };
            }

            const result = await this.sock.sendMessage(jid, messageContent);
            console.log(`baileys-adapter: Media sent successfully to ${jid}`);
            return result;
        } catch (error) {
            console.error(`baileys-adapter: Failed to send media to ${jid}:`, error.message);
            throw error;
        }
    }

    /**
     * Destroy the client instance
     */
    async destroy() {
        console.log('baileys-adapter: Destroying client...');
        this.isDestroying = true;

        // Stop health check interval
        this._stopConnectionHealthCheck();

        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                this.sock.end();
            } catch (error) {
                console.error('baileys-adapter: Error during destroy:', error.message);
            }
            this.sock = null;
        }

        this.connectionState = 'disconnected';
        this.clientInfo = null;
        this.callbacks = {};
        this.silentReconnectInProgress = false;

        console.log('baileys-adapter: Client destroyed');
    }

    /**
     * Logout from WhatsApp (clears session)
     */
    async logout() {
        console.log('baileys-adapter: Logging out...');

        if (this.sock) {
            try {
                await this.sock.logout();
            } catch (error) {
                console.error('baileys-adapter: Error during logout:', error.message);
            }
        }

        // Clear session files
        if (this.sessionPath && fs.existsSync(this.sessionPath)) {
            try {
                const files = fs.readdirSync(this.sessionPath);
                for (const file of files) {
                    const filePath = path.join(this.sessionPath, file);
                    fs.rmSync(filePath, { recursive: true, force: true });
                }
                console.log('baileys-adapter: Session files cleared');
            } catch (error) {
                console.error('baileys-adapter: Error clearing session files:', error.message);
            }
        }

        this.connectionState = 'disconnected';
        this.clientInfo = null;

        console.log('baileys-adapter: Logout complete');
    }

    /**
     * Check if a number is registered on WhatsApp
     * @param {string} phoneNumber - Phone number to check
     * @param {string} countryCode - Country code (optional)
     * @returns {Promise<boolean>} - True if registered
     */
    async isRegistered(phoneNumber, countryCode = '') {
        if (!this.sock || this.connectionState !== 'connected') {
            throw new Error('WhatsApp client is not connected');
        }

        const jid = this.formatJID(phoneNumber, countryCode);

        try {
            const [result] = await this.sock.onWhatsApp(jid.replace('@s.whatsapp.net', ''));
            return result?.exists || false;
        } catch (error) {
            console.error(`baileys-adapter: Error checking if ${phoneNumber} is registered:`, error.message);
            return false;
        }
    }

    /**
     * Get profile picture URL for a number
     * @param {string} phoneNumber - Phone number
     * @param {string} countryCode - Country code (optional)
     * @returns {Promise<string|null>} - Profile picture URL or null
     */
    async getProfilePicture(phoneNumber, countryCode = '') {
        if (!this.sock || this.connectionState !== 'connected') {
            return null;
        }

        const jid = this.formatJID(phoneNumber, countryCode);

        try {
            const ppUrl = await this.sock.profilePictureUrl(jid, 'image');
            return ppUrl;
        } catch (error) {
            // Profile picture not available or private
            return null;
        }
    }

    /**
     * Set external logger for file logging
     * @param {object} externalLogger - Winston logger instance
     */
    setExternalLogger(externalLogger) {
        this.externalLogger = externalLogger;
        console.log('baileys-adapter: External logger attached');
    }

    /**
     * Check connection health and reconnect if needed
     * @returns {Promise<boolean>} - True if connection is healthy
     */
    async checkAndReconnect() {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] baileys-adapter: >>>>>> CHECK AND RECONNECT CALLED <<<<<<`);

        // Check if we have a socket and it's connected
        if (!this.sock) {
            console.log(`[${timestamp}] baileys-adapter: No socket - not healthy`);
            this.externalLogger?.info('Baileys Adapter: No socket available');
            return false;
        }

        if (this.connectionState !== 'connected') {
            console.log(`[${timestamp}] baileys-adapter: Not connected (state: ${this.connectionState}) - attempting reconnect`);
            this.externalLogger?.info(`Baileys Adapter: Not connected (${this.connectionState}), reconnecting...`);

            // Attempt to reconnect
            try {
                await this._reconnect();
                // Wait a bit for connection to establish
                await new Promise(resolve => setTimeout(resolve, 3000));

                const isNowConnected = this.connectionState === 'connected';
                console.log(`[${timestamp}] baileys-adapter: Reconnect result - connected: ${isNowConnected}`);
                return isNowConnected;
            } catch (error) {
                console.error(`[${timestamp}] baileys-adapter: Reconnect failed: ${error.message}`);
                this.externalLogger?.error(`Baileys Adapter: Reconnect failed: ${error.message}`);
                return false;
            }
        }

        console.log(`[${timestamp}] baileys-adapter: Connection is healthy`);
        this.externalLogger?.info('Baileys Adapter: Connection is healthy');
        return true;
    }

    /**
     * Force reconnection to WhatsApp
     * @returns {Promise<void>}
     */
    async forceReconnect() {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] baileys-adapter: >>>>>> FORCE RECONNECT CALLED <<<<<<`);
        this.externalLogger?.info('Baileys Adapter: Force reconnect initiated');

        // Reset reconnect attempts to allow fresh reconnection
        this.reconnectAttempts = 0;

        // Perform reconnection
        await this._reconnect();

        console.log(`[${timestamp}] baileys-adapter: Force reconnect initiated successfully`);
        this.externalLogger?.info('Baileys Adapter: Force reconnect completed');
    }

    /**
     * Start periodic connection health check
     * This helps detect disconnections early during idle periods
     */
    _startConnectionHealthCheck() {
        // Clear any existing interval
        this._stopConnectionHealthCheck();

        // Check connection health every 30 seconds
        this.connectionHealthCheckInterval = setInterval(async () => {
            if (this.isDestroying || this.connectionState !== 'connected') {
                return;
            }

            try {
                // Check if socket is still valid
                if (!this.sock || !this.sock.user) {
                    console.log('baileys-adapter: Health check failed - socket or user invalid');
                    this.externalLogger?.warn('Baileys Adapter: Health check detected invalid socket state');
                    this._handleHealthCheckFailure();
                    return;
                }

                // Update activity time if we're still connected
                this.lastActivityTime = Date.now();

            } catch (error) {
                console.log('baileys-adapter: Health check error:', error.message);
                this.externalLogger?.warn(`Baileys Adapter: Health check error: ${error.message}`);
            }
        }, 30000); // Every 30 seconds

        console.log('baileys-adapter: Connection health check started');
    }

    /**
     * Stop the periodic connection health check
     */
    _stopConnectionHealthCheck() {
        if (this.connectionHealthCheckInterval) {
            clearInterval(this.connectionHealthCheckInterval);
            this.connectionHealthCheckInterval = null;
            console.log('baileys-adapter: Connection health check stopped');
        }
    }

    /**
     * Handle health check failure - attempt silent reconnection
     */
    async _handleHealthCheckFailure() {
        if (this.silentReconnectInProgress || this.isDestroying) {
            return;
        }

        console.log('baileys-adapter: Attempting silent reconnection due to health check failure');
        this.externalLogger?.info('Baileys Adapter: Initiating silent reconnection');

        this.silentReconnectInProgress = true;

        try {
            await this._silentReconnect();
        } catch (error) {
            console.error('baileys-adapter: Silent reconnection failed:', error.message);
            this.externalLogger?.error(`Baileys Adapter: Silent reconnection failed: ${error.message}`);
        } finally {
            this.silentReconnectInProgress = false;
        }
    }

    /**
     * Silent reconnection - tries to reconnect using existing credentials without showing QR
     * This is used when connection is lost but session is still valid
     * @returns {Promise<boolean>} - True if reconnection successful
     */
    async _silentReconnect() {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] baileys-adapter: Starting silent reconnection...`);
        this.externalLogger?.info('Baileys Adapter: Starting silent reconnection with existing credentials');

        // Log credential state before attempting
        this._logCredentialState('SILENT_RECONNECT_START');

        // Check if we have valid credentials before attempting
        let hasValidCreds = this._hasValidCredentials();

        // If no creds in memory, try to check disk and restore from backup
        if (!hasValidCreds) {
            console.log('baileys-adapter: No credentials in memory for silent reconnect, checking alternatives...');

            // Check if we have creds on disk
            if (this._hasCredentialsOnDisk()) {
                console.log('baileys-adapter: Credentials found on disk, will reload');
                hasValidCreds = true;
            } else if (this.wasEverAuthenticated) {
                // Try to restore from backup
                console.log('baileys-adapter: Trying to restore from backup for silent reconnect...');
                const restored = this._restoreCredentialsFromBackup();
                if (restored) {
                    console.log('baileys-adapter: Credentials restored from backup for silent reconnect');
                    this.externalLogger?.info('Baileys Adapter: Credentials restored from backup for silent reconnect');
                    hasValidCreds = true;
                }
            }

            if (!hasValidCreds) {
                console.log('baileys-adapter: No valid credentials for silent reconnection (checked memory, disk, backup)');
                this.externalLogger?.warn('Baileys Adapter: Cannot silent reconnect - no valid credentials anywhere');
                return false;
            }
        }

        try {
            // Close existing socket if any
            if (this.sock) {
                console.log('baileys-adapter: Closing existing socket for silent reconnect...');
                try {
                    this.sock.ev.removeAllListeners();
                    this.sock.end();
                } catch (closeError) {
                    console.log('baileys-adapter: Error closing socket (ignoring):', closeError.message);
                }
                this.sock = null;
            }

            // Brief wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Reload auth state from disk (should have valid session)
            console.log('baileys-adapter: Reloading auth state for silent reconnect...');
            const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
            this.state = state;
            this.saveCreds = saveCreds;

            // Verify we still have valid credentials after reload
            if (!state.creds || !state.creds.me) {
                console.log('baileys-adapter: Credentials lost after reload, trying backup restore...');

                // Last attempt: try to restore from backup
                if (this.wasEverAuthenticated) {
                    const restored = this._restoreCredentialsFromBackup();
                    if (restored) {
                        // Reload again after restore
                        console.log('baileys-adapter: Backup restored, reloading auth state...');
                        const reloadResult = await useMultiFileAuthState(this.sessionPath);
                        this.state = reloadResult.state;
                        this.saveCreds = reloadResult.saveCreds;

                        if (this.state.creds && this.state.creds.me) {
                            console.log('baileys-adapter: Credentials recovered from backup!');
                            this.externalLogger?.info('Baileys Adapter: Credentials recovered from backup');
                        } else {
                            console.log('baileys-adapter: Backup restore did not recover valid credentials');
                            this.externalLogger?.warn('Baileys Adapter: Backup restore failed to recover credentials');
                            return false;
                        }
                    } else {
                        console.log('baileys-adapter: Cannot silent reconnect - no valid credentials after backup attempt');
                        this.externalLogger?.warn('Baileys Adapter: Credentials invalid after reload and backup failed');
                        return false;
                    }
                } else {
                    console.log('baileys-adapter: Cannot silent reconnect - no valid credentials and no backup available');
                    this.externalLogger?.warn('Baileys Adapter: Credentials invalid after reload, no backup');
                    return false;
                }
            }

            console.log(`baileys-adapter: Credentials valid for user ${this.state.creds.me.id}, creating new socket...`);
            this.connectionState = 'connecting';

            // Fetch WhatsApp Web version with multiple fallback sources
            const { version, source } = await fetchWAVersion(this.externalLogger);
            console.log(`baileys-adapter: Using WA version for silent reconnect: ${version.join('.')} (source: ${source})`);
            this.externalLogger?.info(`Baileys Adapter: Using WA version for silent reconnect: ${version.join('.')} (source: ${source})`);

            // Create new socket with existing credentials
            this.sock = makeWASocket({
                version: version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, this.logger)
                },
                printQRInTerminal: false,
                logger: this.logger,
                browser: Browsers.windows('Desktop'),
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 25000,
                emitOwnEvents: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                markOnlineOnConnect: true,
                msgRetryCounterCache: this.msgRetryCounterCache,
                retryRequestDelayMs: 250,
                getMessage: async (key) => undefined
            });

            this._setupEventListeners();

            // Wait for connection to establish (max 30 seconds)
            const connectionResult = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.log('baileys-adapter: Silent reconnect timeout');
                    resolve(false);
                }, 30000);

                const checkConnection = setInterval(() => {
                    if (this.connectionState === 'connected') {
                        clearTimeout(timeout);
                        clearInterval(checkConnection);
                        resolve(true);
                    } else if (this.connectionState === 'waiting_qr') {
                        // If we get QR, session was invalidated
                        clearTimeout(timeout);
                        clearInterval(checkConnection);
                        console.log('baileys-adapter: Silent reconnect got QR - session invalidated');
                        resolve(false);
                    }
                }, 500);
            });

            if (connectionResult) {
                console.log(`[${timestamp}] baileys-adapter: Silent reconnection successful!`);
                this.externalLogger?.info('Baileys Adapter: Silent reconnection successful');
                this.reconnectAttempts = 0;
                return true;
            } else {
                console.log(`[${timestamp}] baileys-adapter: Silent reconnection failed`);
                this.externalLogger?.warn('Baileys Adapter: Silent reconnection failed');
                return false;
            }

        } catch (error) {
            console.error('baileys-adapter: Silent reconnection error:', error.message);
            this.externalLogger?.error(`Baileys Adapter: Silent reconnection error: ${error.message}`);
            return false;
        }
    }

    /**
     * Verify connection is alive by checking socket state
     * Call this before sending messages after a long pause
     * @returns {Promise<boolean>} - True if connection is verified alive
     */
    async verifyConnectionAlive() {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] baileys-adapter: Verifying connection is alive...`);

        if (!this.sock) {
            console.log('baileys-adapter: No socket - connection not alive');
            return false;
        }

        if (this.connectionState !== 'connected') {
            console.log(`baileys-adapter: Connection state is ${this.connectionState} - not alive`);
            return false;
        }

        // Check if socket user is still valid
        if (!this.sock.user) {
            console.log('baileys-adapter: Socket user is null - connection may be stale');
            return false;
        }

        // Additional check: verify we can access socket state
        try {
            const user = this.sock.user;
            if (user && user.id) {
                console.log(`baileys-adapter: Connection verified alive for user ${user.id}`);
                this.lastActivityTime = Date.now();
                return true;
            }
        } catch (error) {
            console.log('baileys-adapter: Error verifying connection:', error.message);
            return false;
        }

        return false;
    }

    /**
     * Ensure connection is ready, attempting silent reconnection if needed
     * This is the main method to call before sending messages after pauses
     * @param {number} maxWaitMs - Maximum time to wait for reconnection (default 60000ms)
     * @returns {Promise<boolean>} - True if connection is ready
     */
    async ensureConnectionReady(maxWaitMs = 60000) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] baileys-adapter: Ensuring connection is ready...`);
        this.externalLogger?.info('Baileys Adapter: Ensuring connection is ready');

        // Log full credential state for debugging
        this._logCredentialState('ENSURE_CONNECTION_READY');

        // First check if already connected
        if (await this.verifyConnectionAlive()) {
            console.log('baileys-adapter: Connection already alive');
            return true;
        }

        // Check credentials in memory first
        let hasValidCreds = this._hasValidCredentials();

        // If no creds in memory, check disk and try to restore from backup
        if (!hasValidCreds) {
            console.log('baileys-adapter: No credentials in memory, checking disk...');

            // Check if we have creds on disk
            if (this._hasCredentialsOnDisk()) {
                console.log('baileys-adapter: Credentials found on disk, will reload');
                hasValidCreds = true; // Will be loaded by _silentReconnect
            } else if (this.wasEverAuthenticated) {
                // Try to restore from backup
                console.log('baileys-adapter: No creds on disk but was authenticated, trying backup...');
                this.externalLogger?.info('Baileys Adapter: Attempting backup restore in ensureConnectionReady');
                const restored = this._restoreCredentialsFromBackup();
                if (restored) {
                    console.log('baileys-adapter: Credentials restored from backup!');
                    this.externalLogger?.info('Baileys Adapter: Credentials restored from backup');
                    hasValidCreds = true;
                } else {
                    console.log('baileys-adapter: Backup restore failed');
                    this.externalLogger?.warn('Baileys Adapter: Backup restore failed');
                }
            }
        }

        if (!hasValidCreds) {
            console.log('baileys-adapter: No valid credentials anywhere - cannot ensure connection');
            this.externalLogger?.warn('Baileys Adapter: No credentials for reconnection (memory, disk, or backup)');
            return false;
        }

        // Attempt silent reconnection
        console.log('baileys-adapter: Connection not alive, attempting silent reconnect...');
        this.externalLogger?.info('Baileys Adapter: Attempting silent reconnection');

        const startTime = Date.now();
        let attempts = 0;
        const maxAttempts = 3;

        while (Date.now() - startTime < maxWaitMs && attempts < maxAttempts) {
            attempts++;
            console.log(`baileys-adapter: Silent reconnect attempt ${attempts}/${maxAttempts}`);

            const success = await this._silentReconnect();

            if (success && await this.verifyConnectionAlive()) {
                console.log(`baileys-adapter: Connection restored after ${attempts} attempt(s)`);
                this.externalLogger?.info(`Baileys Adapter: Connection restored after ${attempts} attempt(s)`);
                return true;
            }

            // Wait before next attempt
            if (attempts < maxAttempts) {
                const waitTime = 5000 * attempts;
                console.log(`baileys-adapter: Waiting ${waitTime}ms before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }

        console.log('baileys-adapter: Failed to ensure connection after all attempts');
        this.externalLogger?.error('Baileys Adapter: Failed to restore connection');
        return false;
    }

    /**
     * Update last activity time (call this when sending messages)
     */
    updateActivity() {
        this.lastActivityTime = Date.now();
    }

    /**
     * Get time since last activity in milliseconds
     * @returns {number}
     */
    getTimeSinceLastActivity() {
        return Date.now() - this.lastActivityTime;
    }
}

module.exports = BaileysAdapter;
