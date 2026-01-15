/**
 * Operaciones de Archivo Seguras para Pixibot
 *
 * Proporciona operaciones de archivo con manejo robusto de errores,
 * especialmente para errores EBUSY comunes en Windows.
 */

const fs = require('fs');
const path = require('path');
const { retryWithBackoff, withTimeout } = require('./retry');
const { createLogger } = require('./logger');

const logger = createLogger('FileOps');

/**
 * Elimina un archivo o directorio de forma segura con reintentos
 * @param {string} targetPath - Ruta al archivo o directorio
 * @param {object} options - Opciones de configuración
 * @returns {Promise<boolean>}
 */
async function safeDelete(targetPath, options = {}) {
    const {
        maxRetries = 5,
        retryDelay = 1000,
        force = true
    } = options;

    if (!fs.existsSync(targetPath)) {
        return true;
    }

    return retryWithBackoff(
        async () => {
            const stats = fs.statSync(targetPath);

            if (stats.isDirectory()) {
                fs.rmSync(targetPath, { recursive: true, force });
            } else {
                fs.unlinkSync(targetPath);
            }

            // Verificar que se eliminó
            if (fs.existsSync(targetPath)) {
                throw new Error('File still exists after deletion');
            }

            logger.debug('File deleted successfully', { path: targetPath });
            return true;
        },
        {
            maxRetries,
            baseDelay: retryDelay,
            shouldRetry: (error) => {
                // Reintentar para errores de archivo en uso
                return error.code === 'EBUSY' ||
                       error.code === 'EPERM' ||
                       error.code === 'ENOTEMPTY';
            },
            onRetry: (attempt, error, delay) => {
                logger.warn(`Delete retry ${attempt}`, {
                    path: targetPath,
                    error: error.message,
                    nextRetryMs: delay
                });
            }
        }
    );
}

/**
 * Copia un archivo de forma segura
 * @param {string} src - Ruta origen
 * @param {string} dest - Ruta destino
 * @param {object} options - Opciones de configuración
 * @returns {Promise<boolean>}
 */
async function safeCopy(src, dest, options = {}) {
    const { maxRetries = 3, overwrite = true } = options;

    return retryWithBackoff(
        async () => {
            // Crear directorio destino si no existe
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            // Verificar si destino existe y no debemos sobrescribir
            if (!overwrite && fs.existsSync(dest)) {
                throw new Error('Destination already exists');
            }

            fs.copyFileSync(src, dest);
            logger.debug('File copied successfully', { src, dest });
            return true;
        },
        {
            maxRetries,
            shouldRetry: (error) => error.code === 'EBUSY' || error.code === 'EPERM'
        }
    );
}

/**
 * Mueve un archivo de forma segura
 * @param {string} src - Ruta origen
 * @param {string} dest - Ruta destino
 * @param {object} options - Opciones de configuración
 * @returns {Promise<boolean>}
 */
async function safeMove(src, dest, options = {}) {
    const { maxRetries = 3 } = options;

    return retryWithBackoff(
        async () => {
            // Crear directorio destino si no existe
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            // Intentar rename primero (más eficiente en el mismo volumen)
            try {
                fs.renameSync(src, dest);
                logger.debug('File moved via rename', { src, dest });
                return true;
            } catch (renameError) {
                // Si rename falla (diferente volumen), hacer copy + delete
                if (renameError.code === 'EXDEV') {
                    await safeCopy(src, dest, { maxRetries: 1 });
                    await safeDelete(src, { maxRetries: 1 });
                    logger.debug('File moved via copy+delete', { src, dest });
                    return true;
                }
                throw renameError;
            }
        },
        {
            maxRetries,
            shouldRetry: (error) => error.code === 'EBUSY' || error.code === 'EPERM'
        }
    );
}

/**
 * Lee un archivo de forma segura
 * @param {string} filePath - Ruta al archivo
 * @param {object} options - Opciones de configuración
 * @returns {Promise<string|Buffer>}
 */
async function safeRead(filePath, options = {}) {
    const {
        maxRetries = 3,
        encoding = 'utf8',
        timeout = 10000
    } = options;

    return retryWithBackoff(
        async () => {
            return withTimeout(
                () => new Promise((resolve, reject) => {
                    fs.readFile(filePath, encoding, (err, data) => {
                        if (err) reject(err);
                        else resolve(data);
                    });
                }),
                timeout,
                `Read timeout for ${filePath}`
            );
        },
        {
            maxRetries,
            shouldRetry: (error) => error.code === 'EBUSY'
        }
    );
}

/**
 * Escribe un archivo de forma segura
 * @param {string} filePath - Ruta al archivo
 * @param {string|Buffer} data - Datos a escribir
 * @param {object} options - Opciones de configuración
 * @returns {Promise<boolean>}
 */
async function safeWrite(filePath, data, options = {}) {
    const {
        maxRetries = 3,
        encoding = 'utf8',
        createDir = true,
        timeout = 10000
    } = options;

    return retryWithBackoff(
        async () => {
            // Crear directorio si no existe
            if (createDir) {
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }

            return withTimeout(
                () => new Promise((resolve, reject) => {
                    fs.writeFile(filePath, data, encoding, (err) => {
                        if (err) reject(err);
                        else resolve(true);
                    });
                }),
                timeout,
                `Write timeout for ${filePath}`
            );
        },
        {
            maxRetries,
            shouldRetry: (error) => error.code === 'EBUSY' || error.code === 'EPERM'
        }
    );
}

/**
 * Verifica si un archivo existe
 * @param {string} filePath - Ruta al archivo
 * @returns {boolean}
 */
function exists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch (error) {
        logger.warn('Error checking file existence', { path: filePath, error: error.message });
        return false;
    }
}

/**
 * Obtiene información de un archivo
 * @param {string} filePath - Ruta al archivo
 * @returns {object|null}
 */
function getFileInfo(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }

        const stats = fs.statSync(filePath);
        return {
            path: filePath,
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime
        };
    } catch (error) {
        logger.warn('Error getting file info', { path: filePath, error: error.message });
        return null;
    }
}

/**
 * Calcula el tamaño de un directorio recursivamente
 * @param {string} dirPath - Ruta al directorio
 * @returns {number} Tamaño en bytes
 */
function getDirectorySize(dirPath) {
    let size = 0;

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                size += getDirectorySize(fullPath);
            } else {
                try {
                    const stats = fs.statSync(fullPath);
                    size += stats.size;
                } catch (e) {
                    // Ignorar archivos inaccesibles
                }
            }
        }
    } catch (error) {
        logger.warn('Error calculating directory size', { path: dirPath, error: error.message });
    }

    return size;
}

/**
 * Crea un directorio de forma segura
 * @param {string} dirPath - Ruta al directorio
 * @param {object} options - Opciones de configuración
 * @returns {Promise<boolean>}
 */
async function ensureDir(dirPath, options = {}) {
    const { maxRetries = 3 } = options;

    if (fs.existsSync(dirPath)) {
        const stats = fs.statSync(dirPath);
        if (stats.isDirectory()) {
            return true;
        }
        throw new Error(`Path exists but is not a directory: ${dirPath}`);
    }

    return retryWithBackoff(
        async () => {
            fs.mkdirSync(dirPath, { recursive: true });
            return true;
        },
        {
            maxRetries,
            shouldRetry: (error) => error.code === 'EBUSY' || error.code === 'EPERM'
        }
    );
}

/**
 * Lista archivos en un directorio
 * @param {string} dirPath - Ruta al directorio
 * @param {object} options - Opciones de configuración
 * @returns {Array<object>}
 */
function listFiles(dirPath, options = {}) {
    const { recursive = false, filter = null } = options;
    const results = [];

    try {
        if (!fs.existsSync(dirPath)) {
            return results;
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory() && recursive) {
                results.push(...listFiles(fullPath, options));
            } else if (entry.isFile()) {
                if (!filter || filter(fullPath, entry)) {
                    results.push({
                        name: entry.name,
                        path: fullPath,
                        ...getFileInfo(fullPath)
                    });
                }
            }
        }
    } catch (error) {
        logger.warn('Error listing files', { path: dirPath, error: error.message });
    }

    return results;
}

/**
 * Copia un directorio recursivamente
 * @param {string} src - Directorio origen
 * @param {string} dest - Directorio destino
 * @param {object} options - Opciones de configuración
 * @returns {Promise<boolean>}
 */
async function copyDirectory(src, dest, options = {}) {
    const { maxRetries = 3 } = options;

    return retryWithBackoff(
        async () => {
            await ensureDir(dest);

            const entries = fs.readdirSync(src, { withFileTypes: true });

            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                if (entry.isDirectory()) {
                    await copyDirectory(srcPath, destPath, { maxRetries: 1 });
                } else {
                    await safeCopy(srcPath, destPath, { maxRetries: 1 });
                }
            }

            return true;
        },
        { maxRetries }
    );
}

module.exports = {
    safeDelete,
    safeCopy,
    safeMove,
    safeRead,
    safeWrite,
    exists,
    getFileInfo,
    getDirectorySize,
    ensureDir,
    listFiles,
    copyDirectory
};
