/**
 * Utilidades de Reintento para Pixibot
 *
 * Proporciona funciones de reintento con backoff exponencial,
 * circuit breaker y otras estrategias de resiliencia.
 */

const { BACKOFF, RETRIES } = require('../config/defaults');

/**
 * Ejecuta una operación con reintento y backoff exponencial
 * @param {Function} operation - Función async a ejecutar
 * @param {object} options - Opciones de configuración
 * @returns {Promise<any>}
 */
async function retryWithBackoff(operation, options = {}) {
    const {
        maxRetries = RETRIES.FILE_OPERATION,
        baseDelay = BACKOFF.BASE_DELAY,
        maxDelay = BACKOFF.MAX_DELAY,
        backoffFactor = BACKOFF.FACTOR,
        jitter = BACKOFF.JITTER,
        shouldRetry = () => true,
        onRetry = null
    } = options;

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            if (attempt === maxRetries || !shouldRetry(error, attempt)) {
                throw error;
            }

            // Calcular delay con backoff exponencial
            let delay = Math.min(
                baseDelay * Math.pow(backoffFactor, attempt - 1),
                maxDelay
            );

            // Agregar jitter si está habilitado
            if (jitter) {
                const jitterAmount = Math.random() * 0.3 * delay;
                delay = Math.floor(delay + jitterAmount);
            }

            if (onRetry) {
                onRetry(attempt, error, delay);
            }

            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * Ejecuta una operación con timeout
 * @param {Function|Promise} operation - Función o promesa a ejecutar
 * @param {number} timeoutMs - Timeout en milisegundos
 * @param {string} errorMessage - Mensaje de error personalizado
 * @returns {Promise<any>}
 */
async function withTimeout(operation, timeoutMs, errorMessage = 'Operation timed out') {
    const promise = typeof operation === 'function' ? operation() : operation;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error(errorMessage);
            error.code = 'TIMEOUT';
            reject(error);
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

/**
 * Ejecuta una operación con timeout y reintentos
 * @param {Function} operation - Función async a ejecutar
 * @param {object} options - Opciones de configuración
 * @returns {Promise<any>}
 */
async function retryWithTimeout(operation, options = {}) {
    const {
        timeout = 30000,
        maxRetries = 3,
        baseDelay = 1000,
        ...retryOptions
    } = options;

    return retryWithBackoff(
        () => withTimeout(operation, timeout),
        { maxRetries, baseDelay, ...retryOptions }
    );
}

/**
 * Implementación simple de Circuit Breaker
 */
class CircuitBreaker {
    /**
     * @param {object} options - Opciones de configuración
     */
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 30000;
        this.halfOpenRequests = options.halfOpenRequests || 1;

        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;
    }

    /**
     * Ejecuta una operación a través del circuit breaker
     * @param {Function} operation - Función async a ejecutar
     * @returns {Promise<any>}
     */
    async execute(operation) {
        if (this.state === 'OPEN') {
            // Verificar si debemos intentar half-open
            if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.halfOpenAttempts = 0;
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }

        if (this.state === 'HALF_OPEN') {
            if (this.halfOpenAttempts >= this.halfOpenRequests) {
                throw new Error('Circuit breaker is HALF_OPEN, waiting for results');
            }
            this.halfOpenAttempts++;
        }

        try {
            const result = await operation();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure();
            throw error;
        }
    }

    /**
     * Maneja un éxito
     */
    _onSuccess() {
        this.failures = 0;
        this.successes++;

        if (this.state === 'HALF_OPEN') {
            this.state = 'CLOSED';
            this.halfOpenAttempts = 0;
        }
    }

    /**
     * Maneja un fallo
     */
    _onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            this.halfOpenAttempts = 0;
        } else if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }

    /**
     * Obtiene el estado actual
     * @returns {object}
     */
    getState() {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime
        };
    }

    /**
     * Resetea el circuit breaker
     */
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;
    }
}

/**
 * Ejecuta múltiples operaciones en paralelo con límite de concurrencia
 * @param {Array<Function>} operations - Array de funciones async
 * @param {number} concurrency - Límite de concurrencia
 * @returns {Promise<Array>}
 */
async function parallelLimit(operations, concurrency = 5) {
    const results = [];
    const executing = new Set();

    for (const [index, operation] of operations.entries()) {
        const promise = Promise.resolve().then(() => operation()).then(result => {
            results[index] = { success: true, value: result };
        }).catch(error => {
            results[index] = { success: false, error };
        }).finally(() => {
            executing.delete(promise);
        });

        executing.add(promise);

        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }

    await Promise.all(executing);
    return results;
}

/**
 * Ejecuta operaciones en secuencia, deteniendo en el primer éxito
 * @param {Array<Function>} operations - Array de funciones async
 * @returns {Promise<any>}
 */
async function firstSuccess(operations) {
    let lastError = null;

    for (const operation of operations) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('All operations failed');
}

/**
 * Debounce para funciones async
 * @param {Function} fn - Función a hacer debounce
 * @param {number} delay - Delay en milisegundos
 * @returns {Function}
 */
function debounceAsync(fn, delay) {
    let timeoutId = null;
    let pendingPromise = null;

    return function (...args) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        return new Promise((resolve, reject) => {
            timeoutId = setTimeout(async () => {
                try {
                    const result = await fn.apply(this, args);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            }, delay);
        });
    };
}

/**
 * Throttle para funciones async
 * @param {Function} fn - Función a hacer throttle
 * @param {number} limit - Límite de tiempo en milisegundos
 * @returns {Function}
 */
function throttleAsync(fn, limit) {
    let lastRun = 0;
    let pendingPromise = null;

    return async function (...args) {
        const now = Date.now();

        if (now - lastRun >= limit) {
            lastRun = now;
            return fn.apply(this, args);
        }

        if (!pendingPromise) {
            pendingPromise = new Promise((resolve) => {
                setTimeout(async () => {
                    lastRun = Date.now();
                    pendingPromise = null;
                    resolve(await fn.apply(this, args));
                }, limit - (now - lastRun));
            });
        }

        return pendingPromise;
    };
}

/**
 * Utilidad de sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    retryWithBackoff,
    withTimeout,
    retryWithTimeout,
    CircuitBreaker,
    parallelLimit,
    firstSuccess,
    debounceAsync,
    throttleAsync,
    sleep
};
