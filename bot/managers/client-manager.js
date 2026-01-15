/**
 * ClientManager - Gestión robusta del cliente WhatsApp
 *
 * Implementa una máquina de estados para el cliente WhatsApp con
 * manejo robusto de errores, reconexión y limpieza de recursos.
 */

const EventEmitter = require('events');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { createLogger } = require('../utils/logger');
const SessionManager = require('./session-manager');
const { CLIENT_STATES, TIMEOUTS, RETRIES, PUPPETEER_CONFIG } = require('../config/defaults');

class ClientManager extends EventEmitter {
    /**
     * @param {object} options - Opciones de configuración
     */
    constructor(options = {}) {
        super();

        this.options = {
            sessionPath: options.sessionPath || null,
            logsDir: options.logsDir || null,
            puppeteerConfig: options.puppeteerConfig || {},
            autoReconnect: options.autoReconnect !== false,
            maxReconnectAttempts: options.maxReconnectAttempts || RETRIES.RECONNECTION,
            ...options
        };

        this.logger = createLogger('ClientManager');
        this.sessionManager = this.options.sessionPath
            ? new SessionManager(this.options.sessionPath)
            : null;

        // Estado interno
        this._state = CLIENT_STATES.IDLE;
        this._client = null;
        this._initPromise = null;
        this._destroyPromise = null;
        this._initializationStartTime = null;
        this._reconnectAttempts = 0;
        this._isReconnecting = false;

        // Referencias a event listeners para limpieza
        this._eventListeners = {
            qr: null,
            ready: null,
            auth_failure: null,
            disconnected: null,
            authenticated: null,
            loading_screen: null
        };

        // Intervalos y timeouts
        this._initTimeoutId = null;
        this._reconnectTimeoutId = null;
    }

    /**
     * Obtiene el estado actual del cliente
     * @returns {string}
     */
    getState() {
        return this._state;
    }

    /**
     * Obtiene la instancia del cliente WhatsApp
     * @returns {Client|null}
     */
    getClient() {
        return this._client;
    }

    /**
     * Verifica si el cliente está listo para enviar mensajes
     * @returns {boolean}
     */
    isReady() {
        return this._state === CLIENT_STATES.READY && this._client && this._client.info;
    }

    /**
     * Obtiene información del cliente conectado
     * @returns {object|null}
     */
    getClientInfo() {
        if (this._client && this._client.info) {
            return {
                phoneNumber: this._client.info.wid?.user,
                platform: this._client.info.platform,
                pushname: this._client.info.pushname
            };
        }
        return null;
    }

    /**
     * Transición de estado con logging y emisión de eventos
     */
    _setState(newState, data = {}) {
        const oldState = this._state;
        this._state = newState;

        this.logger.info(`State transition: ${oldState} -> ${newState}`, data);
        this.emit('stateChange', { oldState, newState, ...data });
    }

    /**
     * Inicializa el cliente WhatsApp
     * @param {string} executablePath - Ruta al ejecutable de Chrome (opcional)
     * @returns {Promise<void>}
     */
    async initialize(executablePath = null) {
        // Si ya hay una inicialización en progreso, esperar
        if (this._initPromise) {
            this.logger.info('Initialization already in progress, waiting...');
            return this._initPromise;
        }

        // Si ya está listo, no reinicializar
        if (this._state === CLIENT_STATES.READY && this._client && this._client.info) {
            this.logger.info('Client already ready, skipping initialization');
            return;
        }

        // Verificar timeout de inicialización anterior
        this._checkInitializationTimeout();

        this._initPromise = this._doInitialize(executablePath);

        try {
            await this._initPromise;
        } finally {
            this._initPromise = null;
        }
    }

    /**
     * Lógica interna de inicialización
     */
    async _doInitialize(executablePath) {
        this.logger.startOperation('initialize');
        this._setState(CLIENT_STATES.INITIALIZING);
        this._initializationStartTime = Date.now();

        // Configurar timeout de inicialización
        this._setupInitializationTimeout();

        try {
            // Limpiar cliente anterior si existe
            if (this._client) {
                await this._cleanupClient();
            }

            // Validar sesión existente
            if (this.sessionManager) {
                const sessionValidation = await this.sessionManager.validateSession();
                this.logger.info('Session validation result', sessionValidation);
            }

            // Crear cliente
            this._client = await this._createClient(executablePath);

            // Configurar event listeners
            this._setupEventListeners();

            // Inicializar cliente
            await this._client.initialize();

            this.logger.endOperation('initialize', true);

        } catch (error) {
            this.logger.endOperation('initialize', false, { error: error.message });
            this._setState(CLIENT_STATES.ERROR, { error: error.message });
            this._clearInitializationTimeout();
            throw error;
        }
    }

    /**
     * Crea la instancia del cliente WhatsApp
     */
    async _createClient(executablePath) {
        const puppeteerArgs = [
            ...PUPPETEER_CONFIG.DEFAULT_ARGS,
            ...(this.options.puppeteerConfig.args || [])
        ];

        const clientOptions = {
            authStrategy: new LocalAuth({
                dataPath: this.options.sessionPath
            }),
            puppeteer: {
                headless: this.options.puppeteerConfig.headless || PUPPETEER_CONFIG.HEADLESS_MODE,
                args: puppeteerArgs
            }
        };

        // Agregar executable path si está disponible
        if (executablePath) {
            clientOptions.puppeteer.executablePath = executablePath;
        }

        this.logger.info('Creating WhatsApp client', {
            sessionPath: this.options.sessionPath,
            headless: clientOptions.puppeteer.headless,
            hasExecutablePath: !!executablePath
        });

        return new Client(clientOptions);
    }

    /**
     * Configura los event listeners del cliente
     */
    _setupEventListeners() {
        if (!this._client) return;

        // QR Code
        this._eventListeners.qr = (qr) => {
            this.logger.info('QR code received');
            this._setState(CLIENT_STATES.WAITING_QR);
            this.emit('qr', qr);
        };

        // Authenticated
        this._eventListeners.authenticated = () => {
            this.logger.info('Client authenticated');
            this._setState(CLIENT_STATES.AUTHENTICATING);
            this.emit('authenticated');
        };

        // Loading screen
        this._eventListeners.loading_screen = (percent, message) => {
            this.logger.debug('Loading screen', { percent, message });
            this.emit('loading_screen', { percent, message });
        };

        // Ready
        this._eventListeners.ready = () => {
            this.logger.info('Client is ready');
            this._setState(CLIENT_STATES.READY);
            this._clearInitializationTimeout();
            this._initializationStartTime = null;
            this._reconnectAttempts = 0;
            this._isReconnecting = false;
            this.emit('ready', this.getClientInfo());
        };

        // Auth failure
        this._eventListeners.auth_failure = (msg) => {
            this.logger.error('Authentication failure', { message: msg });
            this._setState(CLIENT_STATES.ERROR, { error: 'auth_failure', message: msg });
            this._clearInitializationTimeout();
            this.emit('auth_failure', msg);
        };

        // Disconnected
        this._eventListeners.disconnected = async (reason) => {
            this.logger.warn('Client disconnected', { reason });
            this._setState(CLIENT_STATES.DISCONNECTED, { reason });
            this.emit('disconnected', reason);

            // Manejar reconexión automática
            if (this.options.autoReconnect && !this._isLogoutReason(reason)) {
                await this._handleReconnection(reason);
            }
        };

        // Registrar listeners
        this._client.on('qr', this._eventListeners.qr);
        this._client.on('authenticated', this._eventListeners.authenticated);
        this._client.on('loading_screen', this._eventListeners.loading_screen);
        this._client.on('ready', this._eventListeners.ready);
        this._client.on('auth_failure', this._eventListeners.auth_failure);
        this._client.on('disconnected', this._eventListeners.disconnected);

        this.logger.debug('Event listeners configured');
    }

    /**
     * Limpia los event listeners
     */
    _cleanupEventListeners() {
        if (!this._client) return;

        this.logger.debug('Cleaning up event listeners');

        for (const [event, listener] of Object.entries(this._eventListeners)) {
            if (listener) {
                this._client.removeListener(event, listener);
                this._eventListeners[event] = null;
            }
        }
    }

    /**
     * Verifica si la razón de desconexión es un logout
     */
    _isLogoutReason(reason) {
        const logoutReasons = ['LOGOUT', 'logout', 'user_initiated', 'manual_logout'];
        return logoutReasons.includes(reason);
    }

    /**
     * Configura el timeout de inicialización
     */
    _setupInitializationTimeout() {
        this._clearInitializationTimeout();

        this._initTimeoutId = setTimeout(() => {
            if (this._state === CLIENT_STATES.INITIALIZING ||
                this._state === CLIENT_STATES.WAITING_QR) {

                this.logger.error('Initialization timeout exceeded');
                this._setState(CLIENT_STATES.ERROR, { error: 'initialization_timeout' });
                this.emit('error', new Error('Initialization timeout'));
            }
        }, TIMEOUTS.INITIALIZATION_STUCK_THRESHOLD);
    }

    /**
     * Limpia el timeout de inicialización
     */
    _clearInitializationTimeout() {
        if (this._initTimeoutId) {
            clearTimeout(this._initTimeoutId);
            this._initTimeoutId = null;
        }
    }

    /**
     * Verifica si hay una inicialización colgada
     */
    _checkInitializationTimeout() {
        if (this._initializationStartTime) {
            const elapsed = Date.now() - this._initializationStartTime;
            if (elapsed > TIMEOUTS.INITIALIZATION_STUCK_THRESHOLD) {
                this.logger.warn('Previous initialization was stuck, forcing reset', { elapsed });
                this._initializationStartTime = null;
                this._initPromise = null;
            }
        }
    }

    /**
     * Maneja la reconexión automática
     */
    async _handleReconnection(reason) {
        if (this._isReconnecting) {
            this.logger.debug('Reconnection already in progress');
            return;
        }

        this._isReconnecting = true;
        this._reconnectAttempts++;

        if (this._reconnectAttempts > this.options.maxReconnectAttempts) {
            this.logger.error('Max reconnection attempts reached', {
                attempts: this._reconnectAttempts,
                max: this.options.maxReconnectAttempts
            });
            this._isReconnecting = false;
            this.emit('reconnect_failed', { attempts: this._reconnectAttempts });
            return;
        }

        const delay = this._calculateReconnectDelay();
        this.logger.info(`Scheduling reconnection attempt ${this._reconnectAttempts}/${this.options.maxReconnectAttempts}`, {
            delayMs: delay,
            reason
        });

        this.emit('reconnecting', {
            attempt: this._reconnectAttempts,
            maxAttempts: this.options.maxReconnectAttempts,
            delayMs: delay
        });

        this._reconnectTimeoutId = setTimeout(async () => {
            try {
                await this._cleanupClient();
                await this.initialize();
                this.logger.info('Reconnection successful');
            } catch (error) {
                this.logger.error('Reconnection failed', { error: error.message });
                this._isReconnecting = false;
                await this._handleReconnection(reason);
            }
        }, delay);
    }

    /**
     * Calcula el delay para reconexión con backoff exponencial
     */
    _calculateReconnectDelay() {
        const baseDelay = TIMEOUTS.RECONNECT_BASE_DELAY;
        const maxDelay = TIMEOUTS.RECONNECT_MAX_DELAY;
        const factor = 1.5;

        const delay = Math.min(
            baseDelay * Math.pow(factor, this._reconnectAttempts - 1),
            maxDelay
        );

        // Agregar jitter
        const jitter = Math.random() * 0.3 * delay;
        return Math.floor(delay + jitter);
    }

    /**
     * Destruye el cliente WhatsApp
     * @param {boolean} force - Forzar destrucción sin esperar
     * @returns {Promise<void>}
     */
    async destroy(force = false) {
        if (this._destroyPromise) {
            this.logger.info('Destroy already in progress, waiting...');
            return this._destroyPromise;
        }

        if (!this._client && this._state === CLIENT_STATES.IDLE) {
            this.logger.info('No client to destroy');
            return;
        }

        this._destroyPromise = this._doDestroy(force);

        try {
            await this._destroyPromise;
        } finally {
            this._destroyPromise = null;
        }
    }

    /**
     * Lógica interna de destrucción
     */
    async _doDestroy(force) {
        this.logger.startOperation('destroy');
        this._setState(CLIENT_STATES.DESTROYING);

        // Cancelar timeouts pendientes
        this._clearInitializationTimeout();
        if (this._reconnectTimeoutId) {
            clearTimeout(this._reconnectTimeoutId);
            this._reconnectTimeoutId = null;
        }

        try {
            await this._cleanupClient(force);
            this._setState(CLIENT_STATES.IDLE);
            this.logger.endOperation('destroy', true);
        } catch (error) {
            this.logger.endOperation('destroy', false, { error: error.message });
            // Forzar estado IDLE aunque falle
            this._setState(CLIENT_STATES.IDLE);
            throw error;
        }
    }

    /**
     * Limpia la instancia del cliente
     */
    async _cleanupClient(force = false) {
        if (!this._client) return;

        this.logger.info('Cleaning up client instance');

        // Limpiar event listeners primero
        this._cleanupEventListeners();

        try {
            // Intentar logout graceful si el cliente está ready
            if (!force && this._client.info && typeof this._client.logout === 'function') {
                this.logger.debug('Attempting graceful logout');
                try {
                    await Promise.race([
                        this._client.logout(),
                        this._timeout(TIMEOUTS.CLIENT_LOGOUT)
                    ]);
                } catch (e) {
                    this.logger.warn('Graceful logout failed', { error: e.message });
                }
            }

            // Cerrar browser
            await this._closeBrowser();

            // Destruir cliente
            this.logger.debug('Destroying client instance');
            await Promise.race([
                this._client.destroy(),
                this._timeout(TIMEOUTS.CLIENT_DESTROY)
            ]);

        } catch (error) {
            this.logger.warn('Error during client cleanup', { error: error.message });
        } finally {
            this._client = null;
        }
    }

    /**
     * Cierra el browser de Puppeteer
     */
    async _closeBrowser() {
        if (!this._client) return;

        this.logger.debug('Attempting to close browser');

        const methods = [
            () => this._client.puppeteerPage?.browser()?.close(),
            () => this._client.pupBrowser?.close(),
            () => this._client.pupPage?.browser()?.close()
        ];

        for (const method of methods) {
            try {
                const browser = method();
                if (browser && typeof browser.then === 'function') {
                    await Promise.race([
                        browser,
                        this._timeout(TIMEOUTS.BROWSER_CLOSE)
                    ]);
                    this.logger.debug('Browser closed successfully');
                    return;
                }
            } catch (e) {
                // Continuar con el siguiente método
            }
        }

        this.logger.warn('Could not close browser through any method');
    }

    /**
     * Utilidad de timeout
     */
    _timeout(ms) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timeout')), ms);
        });
    }

    /**
     * Realiza logout y limpia la sesión
     * @returns {Promise<void>}
     */
    async logout() {
        this.logger.startOperation('logout');

        try {
            // Destruir cliente
            await this.destroy(true);

            // Limpiar sesión si hay SessionManager
            if (this.sessionManager) {
                const result = await this.sessionManager.cleanSession();
                this.logger.info('Session cleanup result', result);
            }

            this.logger.endOperation('logout', true);
            this.emit('logout');

        } catch (error) {
            this.logger.endOperation('logout', false, { error: error.message });
            throw error;
        }
    }

    /**
     * Obtiene estadísticas del cliente
     * @returns {object}
     */
    getStats() {
        return {
            state: this._state,
            isReady: this.isReady(),
            reconnectAttempts: this._reconnectAttempts,
            isReconnecting: this._isReconnecting,
            clientInfo: this.getClientInfo(),
            sessionInfo: this.sessionManager?.getSessionInfo() || null
        };
    }
}

module.exports = ClientManager;
