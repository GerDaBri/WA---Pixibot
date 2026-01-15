/**
 * SessionManager - Gestión robusta de sesiones de WhatsApp
 *
 * Maneja la validación, limpieza, backup y restauración de sesiones
 * con estrategias escalonadas para manejar errores como EBUSY.
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const { TIMEOUTS, RETRIES, SESSION_CRITICAL_FILES } = require('../config/defaults');

class SessionManager {
    /**
     * @param {string} sessionPath - Ruta al directorio de sesión
     * @param {object} options - Opciones de configuración
     */
    constructor(sessionPath, options = {}) {
        this.sessionPath = sessionPath;
        this.options = {
            maxCleanupAttempts: options.maxCleanupAttempts || RETRIES.SESSION_CLEANUP,
            cleanupTimeout: options.cleanupTimeout || TIMEOUTS.SESSION_CLEANUP,
            backupEnabled: options.backupEnabled !== false,
            ...options
        };

        this.logger = createLogger('SessionManager', { sessionPath });
        this._pendingCleanup = null;
        this._isValidated = null;
    }

    /**
     * Obtiene la ruta de sesión
     * @returns {string}
     */
    getSessionPath() {
        return this.sessionPath;
    }

    /**
     * Verifica si la sesión existe y es válida
     * @returns {Promise<{isValid: boolean, reason: string, details: object}>}
     */
    async validateSession() {
        this.logger.startOperation('validateSession');

        try {
            // Verificar si el directorio de sesión existe
            if (!fs.existsSync(this.sessionPath)) {
                this._isValidated = false;
                this.logger.endOperation('validateSession', true, { isValid: false, reason: 'session_not_found' });
                return {
                    isValid: false,
                    reason: 'session_not_found',
                    details: { path: this.sessionPath }
                };
            }

            // Verificar archivos críticos de sesión
            const missingFiles = [];
            const foundFiles = [];

            for (const criticalFile of SESSION_CRITICAL_FILES) {
                const fullPath = path.join(this.sessionPath, criticalFile);
                if (fs.existsSync(fullPath)) {
                    foundFiles.push(criticalFile);
                } else {
                    missingFiles.push(criticalFile);
                }
            }

            // Verificar si hay suficientes archivos para considerar la sesión válida
            const isValid = missingFiles.length === 0 || foundFiles.length >= 2;

            const result = {
                isValid,
                reason: isValid ? 'valid' : 'missing_critical_files',
                details: {
                    path: this.sessionPath,
                    foundFiles,
                    missingFiles,
                    totalCriticalFiles: SESSION_CRITICAL_FILES.length
                }
            };

            this._isValidated = isValid;
            this.logger.endOperation('validateSession', true, result);
            return result;

        } catch (error) {
            this._isValidated = false;
            this.logger.endOperation('validateSession', false, { error: error.message });
            return {
                isValid: false,
                reason: 'validation_error',
                details: { error: error.message }
            };
        }
    }

    /**
     * Verifica si la sesión es válida (usa cache si está disponible)
     * @returns {boolean|null}
     */
    isSessionValid() {
        return this._isValidated;
    }

    /**
     * Limpia la sesión usando estrategia escalonada
     * @returns {Promise<{success: boolean, method: string, error: string|null}>}
     */
    async cleanSession() {
        this.logger.startOperation('cleanSession');
        this.logger.info('Starting session cleanup', { path: this.sessionPath });

        const strategies = [
            { name: 'fs_rmSync', fn: () => this._cleanWithFsRmSync() },
            { name: 'fs_rmSync_delayed', fn: () => this._cleanWithDelay() },
            { name: 'system_command', fn: () => this._cleanWithSystemCommand() },
            { name: 'rename_and_schedule', fn: () => this._cleanWithRename() },
            { name: 'mark_for_deletion', fn: () => this._markForDeletion() }
        ];

        for (let i = 0; i < strategies.length; i++) {
            const strategy = strategies[i];
            this.logger.info(`Attempting cleanup strategy ${i + 1}/${strategies.length}: ${strategy.name}`);

            try {
                const result = await strategy.fn();
                if (result.success) {
                    this._isValidated = false;
                    this.logger.endOperation('cleanSession', true, { method: strategy.name });
                    return {
                        success: true,
                        method: strategy.name,
                        error: null
                    };
                }
            } catch (error) {
                this.logger.warn(`Strategy ${strategy.name} failed`, { error: error.message });
                // Continuar con la siguiente estrategia
            }
        }

        this.logger.endOperation('cleanSession', false, { error: 'All strategies failed' });
        return {
            success: false,
            method: null,
            error: 'All cleanup strategies failed'
        };
    }

    /**
     * Estrategia 1: Eliminación directa con fs.rmSync
     */
    async _cleanWithFsRmSync() {
        if (!fs.existsSync(this.sessionPath)) {
            return { success: true };
        }

        fs.rmSync(this.sessionPath, { recursive: true, force: true });

        // Verificar que se eliminó
        if (!fs.existsSync(this.sessionPath)) {
            this.logger.info('Session cleaned with fs.rmSync');
            return { success: true };
        }

        return { success: false };
    }

    /**
     * Estrategia 2: Esperar y reintentar con fs.rmSync
     */
    async _cleanWithDelay() {
        this.logger.info('Waiting 2 seconds before retry...');
        await this._delay(2000);

        return this._cleanWithFsRmSync();
    }

    /**
     * Estrategia 3: Usar comando del sistema operativo
     */
    async _cleanWithSystemCommand() {
        const { exec } = require('child_process');

        return new Promise((resolve) => {
            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `rmdir /s /q "${this.sessionPath}"`
                : `rm -rf "${this.sessionPath}"`;

            this.logger.info(`Executing system command: ${command}`);

            exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
                if (error) {
                    this.logger.warn('System command failed', { error: error.message, stderr });
                    resolve({ success: false });
                    return;
                }

                // Verificar que se eliminó
                if (!fs.existsSync(this.sessionPath)) {
                    this.logger.info('Session cleaned with system command');
                    resolve({ success: true });
                } else {
                    resolve({ success: false });
                }
            });
        });
    }

    /**
     * Estrategia 4: Renombrar y programar eliminación
     */
    async _cleanWithRename() {
        const timestamp = Date.now();
        const renamedPath = `${this.sessionPath}_deleted_${timestamp}`;

        try {
            fs.renameSync(this.sessionPath, renamedPath);
            this.logger.info(`Session renamed to: ${renamedPath}`);

            // Programar eliminación en background
            this._scheduleBackgroundDeletion(renamedPath);

            return { success: true };
        } catch (error) {
            this.logger.warn('Rename strategy failed', { error: error.message });
            return { success: false };
        }
    }

    /**
     * Estrategia 5: Marcar para eliminación en próximo inicio
     */
    async _markForDeletion() {
        try {
            const markerFile = path.join(path.dirname(this.sessionPath), '.pending_deletion');
            const pendingList = [];

            // Leer lista existente si existe
            if (fs.existsSync(markerFile)) {
                try {
                    const content = fs.readFileSync(markerFile, 'utf8');
                    pendingList.push(...JSON.parse(content));
                } catch (e) {
                    // Ignorar errores de lectura
                }
            }

            // Agregar ruta actual
            if (!pendingList.includes(this.sessionPath)) {
                pendingList.push(this.sessionPath);
            }

            fs.writeFileSync(markerFile, JSON.stringify(pendingList, null, 2));
            this.logger.info('Session marked for deletion on next startup');

            return { success: true };
        } catch (error) {
            this.logger.error('Failed to mark for deletion', { error: error.message });
            return { success: false };
        }
    }

    /**
     * Programa eliminación en background
     */
    _scheduleBackgroundDeletion(pathToDelete) {
        setTimeout(async () => {
            try {
                if (fs.existsSync(pathToDelete)) {
                    fs.rmSync(pathToDelete, { recursive: true, force: true });
                    this.logger.info(`Background deletion completed: ${pathToDelete}`);
                }
            } catch (error) {
                this.logger.warn(`Background deletion failed: ${pathToDelete}`, { error: error.message });
            }
        }, 5000);
    }

    /**
     * Procesa elementos marcados para eliminación (llamar al inicio de la app)
     * @returns {Promise<{processed: number, failed: number}>}
     */
    async processPendingDeletions() {
        const markerFile = path.join(path.dirname(this.sessionPath), '.pending_deletion');

        if (!fs.existsSync(markerFile)) {
            return { processed: 0, failed: 0 };
        }

        let processed = 0;
        let failed = 0;

        try {
            const content = fs.readFileSync(markerFile, 'utf8');
            const pendingList = JSON.parse(content);

            for (const pathToDelete of pendingList) {
                try {
                    if (fs.existsSync(pathToDelete)) {
                        fs.rmSync(pathToDelete, { recursive: true, force: true });
                        this.logger.info(`Processed pending deletion: ${pathToDelete}`);
                    }
                    processed++;
                } catch (error) {
                    this.logger.warn(`Failed to process pending deletion: ${pathToDelete}`, { error: error.message });
                    failed++;
                }
            }

            // Eliminar archivo de marcador
            fs.unlinkSync(markerFile);

        } catch (error) {
            this.logger.error('Error processing pending deletions', { error: error.message });
        }

        return { processed, failed };
    }

    /**
     * Crea un backup de la sesión actual
     * @returns {Promise<{success: boolean, backupPath: string|null, error: string|null}>}
     */
    async backupSession() {
        if (!this.options.backupEnabled) {
            return { success: false, backupPath: null, error: 'Backup disabled' };
        }

        this.logger.startOperation('backupSession');

        try {
            if (!fs.existsSync(this.sessionPath)) {
                this.logger.endOperation('backupSession', false, { error: 'Session not found' });
                return { success: false, backupPath: null, error: 'Session not found' };
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${this.sessionPath}_backup_${timestamp}`;

            // Copiar directorio recursivamente
            await this._copyDirectory(this.sessionPath, backupPath);

            this.logger.endOperation('backupSession', true, { backupPath });
            return { success: true, backupPath, error: null };

        } catch (error) {
            this.logger.endOperation('backupSession', false, { error: error.message });
            return { success: false, backupPath: null, error: error.message };
        }
    }

    /**
     * Restaura una sesión desde un backup
     * @param {string} backupPath - Ruta al backup
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async restoreSession(backupPath) {
        this.logger.startOperation('restoreSession');

        try {
            if (!fs.existsSync(backupPath)) {
                this.logger.endOperation('restoreSession', false, { error: 'Backup not found' });
                return { success: false, error: 'Backup not found' };
            }

            // Limpiar sesión actual si existe
            if (fs.existsSync(this.sessionPath)) {
                await this.cleanSession();
            }

            // Copiar backup a ruta de sesión
            await this._copyDirectory(backupPath, this.sessionPath);

            this._isValidated = null; // Invalidar cache de validación
            this.logger.endOperation('restoreSession', true);
            return { success: true, error: null };

        } catch (error) {
            this.logger.endOperation('restoreSession', false, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Copia un directorio recursivamente
     */
    async _copyDirectory(src, dest) {
        fs.mkdirSync(dest, { recursive: true });

        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this._copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * Utilidad de delay
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Obtiene información sobre la sesión
     * @returns {object}
     */
    getSessionInfo() {
        const info = {
            path: this.sessionPath,
            exists: fs.existsSync(this.sessionPath),
            isValid: this._isValidated,
            size: null,
            lastModified: null
        };

        if (info.exists) {
            try {
                const stats = fs.statSync(this.sessionPath);
                info.lastModified = stats.mtime;

                // Calcular tamaño del directorio
                info.size = this._getDirectorySize(this.sessionPath);
            } catch (error) {
                this.logger.warn('Error getting session info', { error: error.message });
            }
        }

        return info;
    }

    /**
     * Calcula el tamaño de un directorio
     */
    _getDirectorySize(dirPath) {
        let size = 0;

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    size += this._getDirectorySize(fullPath);
                } else {
                    const stats = fs.statSync(fullPath);
                    size += stats.size;
                }
            }
        } catch (error) {
            // Ignorar errores de acceso
        }

        return size;
    }
}

module.exports = SessionManager;
