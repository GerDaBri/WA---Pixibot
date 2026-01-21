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
        // Logger with warn level to see important messages but not spam
        this.logger = pino({ level: 'warn' });
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

        // Get latest Baileys version info
        // Use a known working version as fallback to avoid 405 errors
        const FALLBACK_VERSION = [2, 3000, 1027934701];
        let version;
        try {
            const versionInfo = await fetchLatestBaileysVersion();
            version = versionInfo.version;
            console.log(`baileys-adapter: Fetched WA version ${version.join('.')}`);
        } catch (err) {
            console.log('baileys-adapter: Could not fetch latest version, using fallback');
            version = FALLBACK_VERSION;
        }

        // Always ensure we have a version to avoid connection issues
        if (!version || version.length !== 3) {
            console.log('baileys-adapter: Invalid version, using fallback');
            version = FALLBACK_VERSION;
        }
        console.log(`baileys-adapter: Using WA version ${version.join('.')}`);


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
        // Credential updates - save session
        this.sock.ev.on('creds.update', this.saveCreds);

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

            // Store client info
            this.clientInfo = {
                me: this.sock.user,
                pushname: this.sock.user?.name
            };

            this.emit('ready');
        }

        // Connection closed
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : lastDisconnect?.error?.output?.statusCode;

            const errorMessage = lastDisconnect?.error?.message || 'Unknown error';

            console.log(`baileys-adapter: Connection closed. Status: ${statusCode}, Error: ${errorMessage}`);

            this.connectionState = 'disconnected';

            // Check if we were waiting for QR scan (use our tracking flag)
            const wasWaitingForQR = this.qrShownButNotScanned || (!this.clientInfo && !this._hasValidCredentials());

            console.log(`baileys-adapter: wasWaitingForQR=${wasWaitingForQR}, qrShownButNotScanned=${this.qrShownButNotScanned}`);

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
                // User logged out from phone - clear session so QR will show next time
                console.log('baileys-adapter: Logged out from WhatsApp - clearing session');
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

                setTimeout(() => {
                    if (!this.isDestroying) {
                        this._reconnect();
                    }
                }, 3000 * this.reconnectAttempts); // Exponential backoff
            } else {
                // Cannot reconnect
                this.qrShownButNotScanned = false;
                const reason = statusCode === DisconnectReason.loggedOut ? 'LOGOUT' : 'connection_closed';
                this.emit('disconnected', reason);
            }
        }
    }

    /**
     * Check if we have valid credentials stored
     * @returns {boolean}
     */
    _hasValidCredentials() {
        try {
            if (!this.state || !this.state.creds) return false;
            // Check if we have the essential credential fields
            return !!(this.state.creds.me && this.state.creds.me.id);
        } catch (error) {
            return false;
        }
    }

    /**
     * Clear session files only (no reconnect)
     */
    _clearSession() {
        try {
            if (fs.existsSync(this.sessionPath)) {
                console.log('baileys-adapter: Clearing session files from:', this.sessionPath);
                const files = fs.readdirSync(this.sessionPath);
                for (const file of files) {
                    const filePath = path.join(this.sessionPath, file);
                    fs.rmSync(filePath, { recursive: true, force: true });
                }
                console.log('baileys-adapter: Session files cleared');
            }
        } catch (error) {
            console.error('baileys-adapter: Error clearing session:', error);
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

            // Reinitialize auth state
            console.log('baileys-adapter: Loading auth state from:', this.sessionPath);
            const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
            this.state = state;
            this.saveCreds = saveCreds;

            console.log('baileys-adapter: Auth state loaded, has creds.me:', !!(state.creds && state.creds.me));

            this.connectionState = 'connecting';

            // Get version for reconnection (use fallback to avoid 405 errors)
            const FALLBACK_VERSION = [2, 3000, 1027934701];
            let version;
            try {
                const versionInfo = await fetchLatestBaileysVersion();
                version = versionInfo.version;
                console.log(`baileys-adapter: Fetched WA version for reconnect: ${version.join('.')}`);
            } catch (err) {
                console.log('baileys-adapter: Could not fetch version, using fallback for reconnect');
                version = FALLBACK_VERSION;
            }
            if (!version || version.length !== 3) {
                version = FALLBACK_VERSION;
            }

            // Create new socket
            console.log('baileys-adapter: Creating new socket with version:', version.join('.'));
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
}

module.exports = BaileysAdapter;
