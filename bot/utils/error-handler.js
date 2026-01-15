/**
 * Sistema de Manejo de Errores para Pixibot
 *
 * Proporciona clasificación de errores, estrategias de recuperación
 * y utilidades para manejo consistente de errores.
 */

const { ERROR_TYPES } = require('../config/defaults');
const { createLogger } = require('./logger');

const logger = createLogger('ErrorHandler');

/**
 * Clasifica un error y devuelve información sobre cómo manejarlo
 * @param {Error|string} error - El error a clasificar
 * @returns {object} Información de clasificación del error
 */
function classifyError(error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = error instanceof Error ? error.code : null;

    // Buscar coincidencias basadas en código de error
    if (errorCode) {
        if (errorCode === 'EBUSY') return { ...ERROR_TYPES.EBUSY, originalError: error };
        if (errorCode === 'ENOENT') return { ...ERROR_TYPES.ENOENT, originalError: error };
        if (errorCode === 'EPERM') return { ...ERROR_TYPES.EPERM, originalError: error };
        if (errorCode === 'EACCES') return { ...ERROR_TYPES.EPERM, originalError: error };
    }

    // Buscar coincidencias basadas en mensaje de error
    const lowerMessage = errorMessage.toLowerCase();

    // Errores de red/timeout
    if (lowerMessage.includes('timeout') ||
        lowerMessage.includes('etimedout') ||
        lowerMessage.includes('econnreset') ||
        lowerMessage.includes('network')) {
        return { ...ERROR_TYPES.NETWORK_TIMEOUT, originalError: error };
    }

    // Errores de sesión
    if (lowerMessage.includes('session') &&
        (lowerMessage.includes('expired') || lowerMessage.includes('invalid'))) {
        return { ...ERROR_TYPES.SESSION_EXPIRED, originalError: error };
    }

    if (lowerMessage.includes('session') && lowerMessage.includes('corrupt')) {
        return { ...ERROR_TYPES.SESSION_CORRUPT, originalError: error };
    }

    // Errores de autenticación
    if (lowerMessage.includes('auth') &&
        (lowerMessage.includes('fail') || lowerMessage.includes('error'))) {
        return { ...ERROR_TYPES.AUTH_FAILURE, originalError: error };
    }

    // Errores de Chrome/Browser
    if (lowerMessage.includes('chrome') &&
        (lowerMessage.includes('not found') || lowerMessage.includes('executable'))) {
        return { ...ERROR_TYPES.CHROME_NOT_FOUND, originalError: error };
    }

    if (lowerMessage.includes('browser') &&
        (lowerMessage.includes('disconnect') || lowerMessage.includes('crash'))) {
        return { ...ERROR_TYPES.BROWSER_DISCONNECTED, originalError: error };
    }

    // Errores de protocolo WhatsApp
    if (lowerMessage.includes('protocol') || lowerMessage.includes('evaluation failed')) {
        return { ...ERROR_TYPES.PROTOCOL_ERROR, originalError: error };
    }

    // LOGOUT
    if (lowerMessage === 'logout' || lowerMessage.includes('logged out')) {
        return { ...ERROR_TYPES.LOGOUT, originalError: error };
    }

    // Rate limiting
    if (lowerMessage.includes('rate') || lowerMessage.includes('too many')) {
        return { ...ERROR_TYPES.RATE_LIMIT, originalError: error };
    }

    // EBUSY en mensaje
    if (lowerMessage.includes('ebusy') || lowerMessage.includes('resource busy')) {
        return { ...ERROR_TYPES.EBUSY, originalError: error };
    }

    // Error desconocido
    return { ...ERROR_TYPES.UNKNOWN, originalError: error };
}

/**
 * Determina si un error es recuperable
 * @param {Error|string} error - El error a verificar
 * @returns {boolean}
 */
function isRecoverable(error) {
    const classification = classifyError(error);
    return classification.recoverable === true;
}

/**
 * Obtiene la acción recomendada para un error
 * @param {Error|string} error - El error a verificar
 * @returns {string}
 */
function getRecommendedAction(error) {
    const classification = classifyError(error);
    return classification.action || 'unknown';
}

/**
 * Obtiene el delay de reintento recomendado para un error
 * @param {Error|string} error - El error a verificar
 * @returns {number} Delay en milisegundos, 0 si no aplica
 */
function getRetryDelay(error) {
    const classification = classifyError(error);
    return classification.retryDelay || 0;
}

/**
 * Crea un error estructurado con información adicional
 * @param {string} message - Mensaje del error
 * @param {string} code - Código de error
 * @param {object} data - Datos adicionales
 * @returns {Error}
 */
function createError(message, code, data = {}) {
    const error = new Error(message);
    error.code = code;
    error.data = data;
    error.timestamp = new Date().toISOString();
    return error;
}

/**
 * Wrapper para operaciones que pueden fallar con reintento automático
 * @param {Function} operation - Función async a ejecutar
 * @param {object} options - Opciones de reintento
 * @returns {Promise<any>}
 */
async function withRetry(operation, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        backoffFactor = 2,
        retryableErrors = null, // null = retry all recoverable errors
        onRetry = null,
        operationName = 'operation'
    } = options;

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            const classification = classifyError(error);

            // Verificar si debemos reintentar
            const shouldRetry = retryableErrors
                ? retryableErrors.includes(classification.code)
                : classification.recoverable;

            if (!shouldRetry || attempt === maxRetries) {
                logger.error(`${operationName} failed after ${attempt} attempt(s)`, {
                    error: error.message,
                    code: classification.code,
                    recoverable: classification.recoverable
                });
                throw error;
            }

            // Calcular delay con backoff exponencial
            const delay = Math.min(
                baseDelay * Math.pow(backoffFactor, attempt - 1),
                maxDelay
            );

            // Agregar jitter (variación aleatoria)
            const jitter = Math.random() * 0.3 * delay;
            const finalDelay = Math.floor(delay + jitter);

            logger.warn(`${operationName} failed, retrying in ${finalDelay}ms`, {
                attempt,
                maxRetries,
                error: error.message,
                code: classification.code
            });

            if (onRetry) {
                onRetry(attempt, error, finalDelay);
            }

            await sleep(finalDelay);
        }
    }

    throw lastError;
}

/**
 * Wrapper para operaciones con timeout
 * @param {Function|Promise} operation - Función o promesa a ejecutar
 * @param {number} timeoutMs - Timeout en milisegundos
 * @param {string} operationName - Nombre de la operación para logging
 * @returns {Promise<any>}
 */
async function withTimeout(operation, timeoutMs, operationName = 'operation') {
    const promise = typeof operation === 'function' ? operation() : operation;

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(createError(
                `${operationName} timed out after ${timeoutMs}ms`,
                'TIMEOUT',
                { timeoutMs, operationName }
            ));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
}

/**
 * Ejecuta una operación de forma segura, capturando errores
 * @param {Function} operation - Función a ejecutar
 * @param {any} defaultValue - Valor por defecto si falla
 * @param {string} operationName - Nombre de la operación
 * @returns {Promise<any>}
 */
async function safeExecute(operation, defaultValue = null, operationName = 'operation') {
    try {
        return await operation();
    } catch (error) {
        logger.warn(`${operationName} failed safely`, { error: error.message });
        return defaultValue;
    }
}

/**
 * Formatea un error para mostrar al usuario
 * @param {Error} error - El error a formatear
 * @returns {string}
 */
function formatUserMessage(error) {
    const classification = classifyError(error);

    const userMessages = {
        NETWORK_TIMEOUT: 'Error de conexión. Por favor, verifica tu conexión a internet.',
        SESSION_EXPIRED: 'Tu sesión ha expirado. Por favor, escanea el código QR nuevamente.',
        SESSION_CORRUPT: 'Hay un problema con tu sesión. Se requiere cerrar sesión y volver a conectar.',
        AUTH_FAILURE: 'Error de autenticación. Por favor, intenta nuevamente.',
        CHROME_NOT_FOUND: 'No se encontró Google Chrome. Por favor, instálalo para continuar.',
        RATE_LIMIT: 'Has enviado demasiados mensajes. Espera un momento antes de continuar.',
        LOGOUT: 'Se cerró la sesión de WhatsApp. Por favor, escanea el código QR nuevamente.',
        EBUSY: 'Un archivo está en uso. Por favor, cierra otras aplicaciones e intenta de nuevo.',
        EPERM: 'No tienes permisos para realizar esta operación.',
        BROWSER_DISCONNECTED: 'El navegador se desconectó. Intentando reconectar...',
        PROTOCOL_ERROR: 'Error de comunicación con WhatsApp. Intentando reconectar...',
        UNKNOWN: 'Ocurrió un error inesperado. Por favor, intenta nuevamente.'
    };

    return userMessages[classification.code] || userMessages.UNKNOWN;
}

/**
 * Utilidad de sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    classifyError,
    isRecoverable,
    getRecommendedAction,
    getRetryDelay,
    createError,
    withRetry,
    withTimeout,
    safeExecute,
    formatUserMessage,
    ERROR_TYPES
};
