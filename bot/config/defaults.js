/**
 * Configuración por defecto centralizada para Pixibot
 *
 * Este archivo contiene todas las constantes y valores por defecto
 * usados en los diferentes módulos de la aplicación.
 */

// Timeouts (en milisegundos)
const TIMEOUTS = {
    // Cliente WhatsApp
    CLIENT_INITIALIZATION: 120000,      // 2 minutos para inicialización completa
    CLIENT_DESTROY: 30000,              // 30 segundos para destruir cliente
    CLIENT_LOGOUT: 10000,               // 10 segundos para logout
    BROWSER_CLOSE: 10000,               // 10 segundos para cerrar browser

    // QR Code
    QR_GENERATION: 60000,               // 1 minuto para generar QR

    // Mensajes
    MESSAGE_SEND: 30000,                // 30 segundos para enviar mensaje
    MEDIA_UPLOAD: 60000,                // 1 minuto para subir media

    // Sesión
    SESSION_CLEANUP: 30000,             // 30 segundos para limpiar sesión
    SESSION_VALIDATION: 5000,           // 5 segundos para validar sesión

    // Reconexión
    RECONNECT_BASE_DELAY: 5000,         // 5 segundos delay base
    RECONNECT_MAX_DELAY: 60000,         // 1 minuto delay máximo

    // Inicialización
    INITIALIZATION_STUCK_THRESHOLD: 180000  // 3 minutos para considerar inicialización colgada
};

// Configuración de reintentos
const RETRIES = {
    CLIENT_INITIALIZATION: 3,
    MESSAGE_SEND: 3,
    RECONNECTION: 5,
    SESSION_CLEANUP: 5,
    FILE_OPERATION: 3,
    CHROME_DETECTION: 3
};

// Configuración de backoff exponencial
const BACKOFF = {
    BASE_DELAY: 1000,                   // 1 segundo
    MAX_DELAY: 30000,                   // 30 segundos
    FACTOR: 2,                          // Factor de multiplicación
    JITTER: true                        // Agregar variación aleatoria
};

// Estados del cliente WhatsApp
const CLIENT_STATES = {
    IDLE: 'IDLE',
    INITIALIZING: 'INITIALIZING',
    WAITING_QR: 'WAITING_QR',
    AUTHENTICATING: 'AUTHENTICATING',
    READY: 'READY',
    DISCONNECTED: 'DISCONNECTED',
    DESTROYING: 'DESTROYING',
    ERROR: 'ERROR'
};

// Estados de campaña
const CAMPAIGN_STATES = {
    INACTIVE: 'inactive',
    RUNNING: 'running',
    PAUSING: 'pausing',
    PAUSED: 'paused',
    STOPPING: 'stopping',
    STOPPED: 'stopped',
    FINISHED: 'finished'
};

// Tipos de error clasificados
const ERROR_TYPES = {
    // Errores recuperables automáticamente
    NETWORK_TIMEOUT: {
        code: 'NETWORK_TIMEOUT',
        recoverable: true,
        retryDelay: 5000,
        action: 'retry'
    },
    SESSION_EXPIRED: {
        code: 'SESSION_EXPIRED',
        recoverable: true,
        action: 'reauth'
    },
    RATE_LIMIT: {
        code: 'RATE_LIMIT',
        recoverable: true,
        retryDelay: 60000,
        action: 'wait_and_retry'
    },
    BROWSER_DISCONNECTED: {
        code: 'BROWSER_DISCONNECTED',
        recoverable: true,
        action: 'restart_client'
    },

    // Errores que requieren intervención
    CHROME_NOT_FOUND: {
        code: 'CHROME_NOT_FOUND',
        recoverable: false,
        action: 'notify_user'
    },
    SESSION_CORRUPT: {
        code: 'SESSION_CORRUPT',
        recoverable: false,
        action: 'clear_session'
    },
    AUTH_FAILURE: {
        code: 'AUTH_FAILURE',
        recoverable: false,
        action: 'reauth'
    },
    INVALID_CONFIG: {
        code: 'INVALID_CONFIG',
        recoverable: false,
        action: 'notify_user'
    },

    // Errores del sistema
    EBUSY: {
        code: 'EBUSY',
        recoverable: true,
        action: 'aggressive_cleanup',
        retryDelay: 2000
    },
    ENOENT: {
        code: 'ENOENT',
        recoverable: true,
        action: 'create_missing'
    },
    EPERM: {
        code: 'EPERM',
        recoverable: false,
        action: 'notify_user'
    },

    // Errores de WhatsApp
    LOGOUT: {
        code: 'LOGOUT',
        recoverable: true,
        action: 'generate_qr'
    },
    PROTOCOL_ERROR: {
        code: 'PROTOCOL_ERROR',
        recoverable: true,
        action: 'restart_client'
    },

    // Error desconocido
    UNKNOWN: {
        code: 'UNKNOWN',
        recoverable: false,
        action: 'log_and_notify'
    }
};

// Configuración de Baileys (reemplaza Puppeteer)
const BAILEYS_CONFIG = {
    // Identificación del cliente
    BROWSER: ['Pixibot', 'Desktop', '1.0.0'],

    // Timeouts de conexión
    CONNECT_TIMEOUT_MS: 60000,
    DEFAULT_QUERY_TIMEOUT_MS: 60000,
    KEEP_ALIVE_INTERVAL_MS: 30000,

    // Comportamiento
    EMIT_OWN_EVENTS: false,
    FIRE_INIT_QUERIES: true,
    GENERATE_HIGH_QUALITY_LINK_PREVIEW: false,
    SYNC_FULL_HISTORY: false,
    MARK_ONLINE_ON_CONNECT: true,

    // Reintentos
    RETRY_REQUEST_DELAY_MS: 250,
    MAX_RECONNECT_ATTEMPTS: 5
};

// Archivos críticos de sesión para validación (Baileys)
const SESSION_CRITICAL_FILES = [
    'creds.json'
];

// Legacy: Configuración de Puppeteer (deprecated, mantenido para compatibilidad)
const PUPPETEER_CONFIG = {
    DEFAULT_ARGS: [],
    HEADLESS_MODE: 'new',
    BROWSER_PRIORITY: []
};

// Configuración de logging
const LOGGING_CONFIG = {
    MAX_FILE_SIZE: 10 * 1024 * 1024,    // 10 MB
    MAX_FILES: 5,
    LEVEL: 'info',
    TIMESTAMP_FORMAT: 'YYYY-MM-DD HH:mm:ss.SSS'
};

// Configuración de campañas
const CAMPAIGN_CONFIG = {
    DEFAULT_DELAY_BETWEEN_MESSAGES: 3000,   // 3 segundos entre mensajes
    DEFAULT_PAUSE_AFTER_N_MESSAGES: 10,     // Pausar cada 10 mensajes
    DEFAULT_PAUSE_DURATION: 30000,          // 30 segundos de pausa
    MIN_DELAY_BETWEEN_MESSAGES: 1000,       // Mínimo 1 segundo
    MAX_DELAY_BETWEEN_MESSAGES: 60000       // Máximo 1 minuto
};

// Configuración de monitoreo de procesos
const PROCESS_MONITORING = {
    CHECK_INTERVAL: 10000,          // Verificar cada 10 segundos
    ORPHAN_TIMEOUT: 300000,         // 5 minutos para considerar proceso huérfano
    MAX_TRACKED_PIDS: 10            // Máximo de PIDs a rastrear
};

module.exports = {
    TIMEOUTS,
    RETRIES,
    BACKOFF,
    CLIENT_STATES,
    CAMPAIGN_STATES,
    ERROR_TYPES,
    BAILEYS_CONFIG,
    PUPPETEER_CONFIG,  // Deprecated, kept for compatibility
    SESSION_CRITICAL_FILES,
    LOGGING_CONFIG,
    CAMPAIGN_CONFIG,
    PROCESS_MONITORING
};
