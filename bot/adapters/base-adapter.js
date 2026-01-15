/**
 * Base WhatsApp Adapter Interface
 *
 * This abstract class defines the contract that all WhatsApp adapters must implement.
 * It provides a consistent interface regardless of the underlying library (Baileys, whatsapp-web.js, etc.)
 */

class BaseWhatsAppAdapter {
    constructor() {
        if (new.target === BaseWhatsAppAdapter) {
            throw new Error('BaseWhatsAppAdapter is an abstract class and cannot be instantiated directly');
        }

        this.connectionState = 'disconnected';
        this.clientInfo = null;
        this.callbacks = {};
    }

    /**
     * Initialize the WhatsApp client
     * @param {string} sessionPath - Path to store session data
     * @param {object} callbacks - Callback functions for events
     * @param {function} callbacks.onQrCode - Called when QR code is generated
     * @param {function} callbacks.onClientReady - Called when client is authenticated and ready
     * @param {function} callbacks.onDisconnected - Called when client disconnects
     * @param {function} callbacks.onAuthFailure - Called when authentication fails
     * @returns {Promise<void>}
     */
    async initialize(sessionPath, callbacks) {
        throw new Error('Method initialize() must be implemented');
    }

    /**
     * Destroy the client instance and clean up resources
     * @returns {Promise<void>}
     */
    async destroy() {
        throw new Error('Method destroy() must be implemented');
    }

    /**
     * Logout from WhatsApp (clears session)
     * @returns {Promise<void>}
     */
    async logout() {
        throw new Error('Method logout() must be implemented');
    }

    /**
     * Send a text message
     * @param {string} phoneNumber - Phone number to send to
     * @param {string} text - Message text
     * @param {string} countryCode - Country code prefix (optional)
     * @returns {Promise<object>} - Message result
     */
    async sendTextMessage(phoneNumber, text, countryCode = '') {
        throw new Error('Method sendTextMessage() must be implemented');
    }

    /**
     * Send a media message (image, video, document)
     * @param {string} phoneNumber - Phone number to send to
     * @param {string} mediaPath - Path to media file
     * @param {string} caption - Caption for the media (optional)
     * @param {string} countryCode - Country code prefix (optional)
     * @returns {Promise<object>} - Message result
     */
    async sendMediaMessage(phoneNumber, mediaPath, caption = '', countryCode = '') {
        throw new Error('Method sendMediaMessage() must be implemented');
    }

    /**
     * Format a phone number to JID (Jabber ID) format
     * @param {string} phoneNumber - Phone number
     * @param {string} countryCode - Country code prefix (optional)
     * @returns {string} - Formatted JID
     */
    formatJID(phoneNumber, countryCode = '') {
        throw new Error('Method formatJID() must be implemented');
    }

    /**
     * Get current connection state
     * @returns {string} - 'disconnected' | 'connecting' | 'connected' | 'waiting_qr'
     */
    getConnectionState() {
        return this.connectionState;
    }

    /**
     * Get client info (user data)
     * @returns {object|null} - Client info object or null if not connected
     */
    getClientInfo() {
        return this.clientInfo;
    }

    /**
     * Check if client is authenticated and ready
     * @returns {boolean}
     */
    isAuthenticated() {
        return this.connectionState === 'connected' && this.clientInfo !== null;
    }

    /**
     * Check if client is currently initializing
     * @returns {boolean}
     */
    isInitializing() {
        return this.connectionState === 'connecting';
    }

    /**
     * Register an event callback
     * @param {string} event - Event name ('qr', 'ready', 'disconnected', 'auth_failure')
     * @param {function} callback - Callback function
     */
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    /**
     * Remove an event callback
     * @param {string} event - Event name
     * @param {function} callback - Callback function to remove
     */
    off(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
        }
    }

    /**
     * Emit an event to all registered callbacks
     * @param {string} event - Event name
     * @param {...any} args - Arguments to pass to callbacks
     */
    emit(event, ...args) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in ${event} callback:`, error);
                }
            });
        }
    }

    /**
     * Get the phone number from current session
     * @returns {string|null} - Phone number or null if not connected
     */
    getPhoneNumber() {
        if (this.clientInfo && this.clientInfo.me) {
            // Extract phone number from JID (e.g., "1234567890@s.whatsapp.net" -> "1234567890")
            const id = this.clientInfo.me.id || this.clientInfo.me;
            if (typeof id === 'string') {
                return id.split('@')[0].split(':')[0];
            }
        }
        return null;
    }
}

module.exports = BaseWhatsAppAdapter;
