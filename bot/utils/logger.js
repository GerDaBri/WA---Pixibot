/**
 * Sistema de Logging Unificado para Pixibot
 *
 * Proporciona logging estructurado, consistente y con contexto
 * para todos los módulos de la aplicación.
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Niveles de log personalizados
const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4
};

// Colores para consola (si se usa)
const LOG_COLORS = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    trace: 'gray'
};

// Configuración por defecto
const DEFAULT_CONFIG = {
    level: 'info',
    maxSize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 5,
    logToConsole: true,
    logToFile: true,
    timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
};

// Instancia singleton del logger principal
let mainLogger = null;
let logsDirectory = null;

/**
 * Formato personalizado para logs estructurados
 */
const structuredFormat = winston.format.printf(({ timestamp, level, message, module, data, context, ...rest }) => {
    const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        module: module || 'App',
        message
    };

    if (data && Object.keys(data).length > 0) {
        logEntry.data = data;
    }

    if (context && Object.keys(context).length > 0) {
        logEntry.context = context;
    }

    // Agregar cualquier metadata adicional
    const extraKeys = Object.keys(rest).filter(k => !['level', 'message', 'timestamp'].includes(k));
    if (extraKeys.length > 0) {
        logEntry.extra = {};
        extraKeys.forEach(k => {
            logEntry.extra[k] = rest[k];
        });
    }

    return JSON.stringify(logEntry);
});

/**
 * Formato legible para consola
 */
const consoleFormat = winston.format.printf(({ timestamp, level, message, module }) => {
    const modulePrefix = module ? `[${module}]` : '';
    return `${timestamp} ${level.toUpperCase().padEnd(5)} ${modulePrefix} ${message}`;
});

/**
 * Inicializa el sistema de logging
 * @param {string} logsDir - Directorio para archivos de log
 * @param {object} config - Configuración opcional
 * @returns {winston.Logger} Logger principal
 */
function initializeLogging(logsDir, config = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    logsDirectory = logsDir;

    // Asegurar que el directorio existe
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    const transports = [];

    // Transport para archivo principal
    if (mergedConfig.logToFile) {
        transports.push(
            new winston.transports.File({
                filename: path.join(logsDir, 'app.log'),
                maxsize: mergedConfig.maxSize,
                maxFiles: mergedConfig.maxFiles,
                format: winston.format.combine(
                    winston.format.timestamp({ format: mergedConfig.timestampFormat }),
                    structuredFormat
                )
            })
        );

        // Transport separado para errores
        transports.push(
            new winston.transports.File({
                filename: path.join(logsDir, 'error.log'),
                level: 'error',
                maxsize: mergedConfig.maxSize,
                maxFiles: mergedConfig.maxFiles,
                format: winston.format.combine(
                    winston.format.timestamp({ format: mergedConfig.timestampFormat }),
                    structuredFormat
                )
            })
        );
    }

    // Transport para consola
    if (mergedConfig.logToConsole) {
        transports.push(
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.timestamp({ format: mergedConfig.timestampFormat }),
                    winston.format.colorize({ all: false }),
                    consoleFormat
                )
            })
        );
    }

    mainLogger = winston.createLogger({
        levels: LOG_LEVELS,
        level: mergedConfig.level,
        transports
    });

    // Agregar colores personalizados
    winston.addColors(LOG_COLORS);

    return mainLogger;
}

/**
 * Obtiene el logger principal
 * @returns {winston.Logger|null}
 */
function getMainLogger() {
    return mainLogger;
}

/**
 * Clase Logger con contexto de módulo
 * Proporciona una interfaz limpia para logging con contexto
 */
class Logger {
    /**
     * @param {string} moduleName - Nombre del módulo
     * @param {object} defaultContext - Contexto por defecto para todos los logs
     */
    constructor(moduleName, defaultContext = {}) {
        this.moduleName = moduleName;
        this.defaultContext = defaultContext;
        this.operationTimers = new Map();
    }

    /**
     * Formatea el mensaje con datos opcionales
     */
    _formatMessage(message, data) {
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
            return `${message} | ${JSON.stringify(data)}`;
        }
        return message;
    }

    /**
     * Log interno que usa el logger principal
     */
    _log(level, message, data = null, context = null) {
        if (!mainLogger) {
            // Fallback a console si el logger no está inicializado
            const formattedMsg = `[${this.moduleName}] ${message}`;
            if (level === 'error') {
                console.error(formattedMsg, data || '');
            } else if (level === 'warn') {
                console.warn(formattedMsg, data || '');
            } else {
                console.log(formattedMsg, data || '');
            }
            return;
        }

        const logData = {
            module: this.moduleName,
            message: this._formatMessage(message, data)
        };

        if (data) {
            logData.data = data;
        }

        if (context || Object.keys(this.defaultContext).length > 0) {
            logData.context = { ...this.defaultContext, ...context };
        }

        mainLogger.log(level, logData.message, logData);
    }

    /**
     * Log de error
     * @param {string} message - Mensaje de error
     * @param {object} data - Datos adicionales (error object, stack, etc)
     * @param {object} context - Contexto adicional
     */
    error(message, data = null, context = null) {
        // Si data es un Error, extraer información útil
        if (data instanceof Error) {
            data = {
                errorMessage: data.message,
                errorName: data.name,
                stack: data.stack,
                code: data.code
            };
        }
        this._log('error', message, data, context);
    }

    /**
     * Log de advertencia
     */
    warn(message, data = null, context = null) {
        this._log('warn', message, data, context);
    }

    /**
     * Log informativo
     */
    info(message, data = null, context = null) {
        this._log('info', message, data, context);
    }

    /**
     * Log de debug
     */
    debug(message, data = null, context = null) {
        this._log('debug', message, data, context);
    }

    /**
     * Log de trace (más detallado)
     */
    trace(message, data = null, context = null) {
        this._log('trace', message, data, context);
    }

    /**
     * Inicia el timer de una operación
     * @param {string} operationName - Nombre de la operación
     */
    startOperation(operationName) {
        this.operationTimers.set(operationName, {
            startTime: Date.now(),
            name: operationName
        });
        this.debug(`Starting operation: ${operationName}`);
    }

    /**
     * Finaliza el timer de una operación y registra el resultado
     * @param {string} operationName - Nombre de la operación
     * @param {boolean} success - Si la operación fue exitosa
     * @param {object} data - Datos adicionales del resultado
     */
    endOperation(operationName, success = true, data = null) {
        const operation = this.operationTimers.get(operationName);
        if (!operation) {
            this.warn(`Operation timer not found: ${operationName}`);
            return;
        }

        const duration = Date.now() - operation.startTime;
        this.operationTimers.delete(operationName);

        const level = success ? 'info' : 'error';
        const status = success ? 'completed' : 'failed';

        this._log(level, `Operation ${operationName} ${status}`, {
            ...data,
            durationMs: duration
        });

        return duration;
    }

    /**
     * Mide el tiempo de ejecución de una función async
     * @param {string} operationName - Nombre de la operación
     * @param {Function} fn - Función a ejecutar
     * @returns {Promise<any>} Resultado de la función
     */
    async measureTime(operationName, fn) {
        this.startOperation(operationName);
        try {
            const result = await fn();
            this.endOperation(operationName, true);
            return result;
        } catch (error) {
            this.endOperation(operationName, false, { error: error.message });
            throw error;
        }
    }

    /**
     * Crea un logger hijo con contexto adicional
     * @param {object} additionalContext - Contexto adicional
     * @returns {Logger} Nuevo logger con contexto combinado
     */
    child(additionalContext) {
        return new Logger(this.moduleName, {
            ...this.defaultContext,
            ...additionalContext
        });
    }
}

/**
 * Crea una instancia de Logger para un módulo específico
 * @param {string} moduleName - Nombre del módulo
 * @param {object} defaultContext - Contexto por defecto
 * @returns {Logger} Instancia de Logger
 */
function createLogger(moduleName, defaultContext = {}) {
    return new Logger(moduleName, defaultContext);
}

/**
 * Obtiene el directorio de logs configurado
 * @returns {string|null}
 */
function getLogsDirectory() {
    return logsDirectory;
}

/**
 * Cierra todos los transports del logger
 */
async function closeLogging() {
    if (mainLogger) {
        return new Promise((resolve) => {
            mainLogger.on('finish', resolve);
            mainLogger.end();
        });
    }
}

module.exports = {
    initializeLogging,
    getMainLogger,
    createLogger,
    getLogsDirectory,
    closeLogging,
    Logger,
    LOG_LEVELS
};
