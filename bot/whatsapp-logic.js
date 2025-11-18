const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const os = require('os');



// Función de operaciones seguras con reintentos para operaciones de archivos
async function safeFileOperation(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            logger?.warn(`File Operation: Intento ${attempt}/${maxRetries} falló: ${error.message}`);

            // Si es EBUSY o archivo bloqueado, esperar más tiempo
            if (error.code === 'EBUSY' || error.message.includes('locked')) {
                const delayTime = baseDelay * Math.pow(2, attempt - 1); // Delay progresivo
                logger?.info(`File Operation: Archivo bloqueado, esperando ${delayTime}ms antes del siguiente intento`);
                await delay(delayTime);
            } else if (attempt < maxRetries) {
                // Para otros errores, esperar menos tiempo
                await delay(baseDelay * attempt);
            }
        }
    }

    // Si todos los intentos fallaron, lanzar el último error
    logger?.error(`File Operation: Todos los ${maxRetries} intentos fallaron. Último error: ${lastError.message}`);
    throw lastError;
}

// Variable para rastrear si estamos en proceso de logout
let isLoggingOut = false;

// Función de limpieza alternativa agresiva para casos extremos de EBUSY
async function aggressiveSessionCleanup(sessionPath, maxRetries = 3) {
    const logPrefix = 'Aggressive Session Cleanup';

    logger?.warn(`${logPrefix}: Iniciando limpieza alternativa agresiva para sesión: ${sessionPath}`);
    logger?.warn(`${logPrefix}: Esta limpieza se usa como último recurso cuando métodos normales fallan`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger?.info(`${logPrefix}: Intento ${attempt}/${maxRetries} de limpieza agresiva`);

            // Verificar si el directorio existe
            if (!fs.existsSync(sessionPath)) {
                logger?.info(`${logPrefix}: Directorio de sesión no existe, limpieza no necesaria`);
                return true;
            }

            // Intentar diferentes estrategias de limpieza agresiva

            // Estrategia 1: Usar rimraf si está disponible (más confiable para archivos bloqueados)
            try {
                const rimraf = require('rimraf');
                logger?.info(`${logPrefix}: Estrategia 1 - Usando rimraf para limpieza forzada`);

                await new Promise((resolve, reject) => {
                    rimraf(sessionPath, { maxRetries: 3, retryDelay: 1000 }, (error) => {
                        if (error) {
                            logger?.warn(`${logPrefix}: Error con rimraf en intento ${attempt}: ${error.message}`);
                            reject(error);
                        } else {
                            logger?.info(`${logPrefix}: Limpieza con rimraf exitosa en intento ${attempt}`);
                            resolve();
                        }
                    });
                });

                return true;

            } catch (rimrafError) {
                logger?.warn(`${logPrefix}: rimraf no disponible o falló: ${rimrafError.message}`);
            }

            // Estrategia 2: Limpieza manual agresiva con múltiples técnicas
            logger?.info(`${logPrefix}: Estrategia 2 - Limpieza manual agresiva`);

            // 2a: Intentar cambiar permisos primero (en sistemas que lo soporten)
            try {
                if (os.platform() !== 'win32') {
                    const { exec } = require('child_process');
                    await new Promise((resolve) => {
                        exec(`chmod -R 755 "${sessionPath}" 2>/dev/null || true`, (error) => {
                            logger?.info(`${logPrefix}: Permisos cambiados (o ya eran correctos)`);
                            resolve();
                        });
                    });
                }
            } catch (chmodError) {
                logger?.info(`${logPrefix}: No se pudieron cambiar permisos: ${chmodError.message}`);
            }

            // 2b: Intentar eliminar archivos individuales primero
            try {
                const files = fs.readdirSync(sessionPath);
                for (const file of files) {
                    const filePath = path.join(sessionPath, file);
                    try {
                        const stats = fs.statSync(filePath);
                        if (stats.isFile()) {
                            fs.unlinkSync(filePath);
                            logger?.info(`${logPrefix}: Archivo eliminado: ${file}`);
                        } else if (stats.isDirectory()) {
                            fs.rmSync(filePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
                            logger?.info(`${logPrefix}: Directorio eliminado: ${file}`);
                        }
                    } catch (fileError) {
                        logger?.warn(`${logPrefix}: No se pudo eliminar ${file}: ${fileError.message}`);
                    }
                }
            } catch (readError) {
                logger?.warn(`${logPrefix}: Error leyendo directorio: ${readError.message}`);
            }

            // 2c: Intentar eliminar el directorio principal
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
                logger?.info(`${logPrefix}: Directorio de sesión eliminado exitosamente en intento ${attempt}`);
                return true;
            } catch (deleteError) {
                logger?.warn(`${logPrefix}: Error eliminando directorio en intento ${attempt}: ${deleteError.message}`);
            }

            // Delay progresivo entre intentos
            if (attempt < maxRetries) {
                const delayTime = 2000 * attempt;
                logger?.info(`${logPrefix}: Esperando ${delayTime}ms antes del siguiente intento`);
                await delay(delayTime);
            }

        } catch (error) {
            logger?.error(`${logPrefix}: Error inesperado en intento ${attempt}: ${error.message}`);

            if (attempt === maxRetries) {
                logger?.error(`${logPrefix}: Todos los ${maxRetries} intentos de limpieza agresiva fallaron`);
                throw error;
            }
        }
    }

    logger?.error(`${logPrefix}: Limpieza agresiva falló completamente`);
    return false;
}

// Función wrapper específica para client.logout() que maneja errores EBUSY
async function safeLogoutWithEBUSYHandling(clientInstance, maxRetries = 3) {
    const logPrefix = 'Safe Logout with EBUSY Handling';

    // Prevenir múltiples llamadas simultáneas de logout
    if (isLoggingOut) {
        logger?.warn(`${logPrefix}: Logout ya en progreso, ignorando llamada adicional`);
        return false;
    }

    isLoggingOut = true;

    try {
        logger?.info(`${logPrefix}: Iniciando proceso de logout seguro con manejo de EBUSY`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger?.info(`${logPrefix}: Intento ${attempt}/${maxRetries} de logout`);

                // Antes de cada intento, intentar liberar procesos Chrome
                if (attempt > 1) {
                    logger?.info(`${logPrefix}: Liberando procesos Chrome antes del intento ${attempt}`);
                    await forceReleaseChromeProcesses();

                    // Delay adicional para permitir liberación completa
                    await delay(2000);
                }

                // Ejecutar logout con timeout específico
                const logoutPromise = clientInstance.logout();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Logout timeout')), 15000)
                );

                await Promise.race([logoutPromise, timeoutPromise]);

                logger?.info(`${logPrefix}: Logout exitoso en intento ${attempt}`);
                return true;

            } catch (error) {
                logger?.warn(`${logPrefix}: Error en intento ${attempt}/${maxRetries}: ${error.message}`);

                // Si es EBUSY o error relacionado con archivos bloqueados, intentar estrategias específicas
                if (error.message.includes('EBUSY') ||
                    error.message.includes('locked') ||
                    error.message.includes('first_party_sets.db') ||
                    error.message.includes('sharing violation')) {

                    logger?.info(`${logPrefix}: Error EBUSY detectado, aplicando estrategias de liberación agresiva`);

                    // Estrategia 1: Liberar procesos Chrome agresivamente
                    await forceReleaseChromeProcesses();

                    // Estrategia 2: Intentar liberar específicamente archivos de sesión
                    try {
                        const sessionPath = clientInstance.options?.authStrategy?.dataPath;
                        if (sessionPath) {
                            logger?.info(`${logPrefix}: Intentando liberar archivos de sesión en: ${sessionPath}`);
                            await forceReleaseFileHandles(sessionPath, 3000);
                        }
                    } catch (fileError) {
                        logger?.warn(`${logPrefix}: Error liberando archivos de sesión: ${fileError.message}`);
                    }

                    // Delay progresivo entre reintentos
                    if (attempt < maxRetries) {
                        const delayTime = 2000 * attempt;
                        logger?.info(`${logPrefix}: Esperando ${delayTime}ms antes del siguiente intento`);
                        await delay(delayTime);
                    }

                } else if (attempt === maxRetries) {
                    // Si es el último intento y no es EBUSY, lanzar el error
                    throw error;
                } else {
                    // Para otros errores, delay más corto
                    await delay(1000);
                }
            }
        }

        // Si todos los intentos fallaron
        logger?.error(`${logPrefix}: Todos los ${maxRetries} intentos de logout fallaron`);
        return false;

    } catch (error) {
        logger?.error(`${logPrefix}: Error crítico durante proceso de logout: ${error.message}`);
        return false;

    } finally {
        isLoggingOut = false;
        logger?.info(`${logPrefix}: Proceso de logout finalizado`);
    }
}

// Función para liberar procesos de Chrome/Puppeteer antes del logout
async function forceReleaseChromeProcesses() {
    const logPrefix = 'Chrome Process Release';
    logger?.info(`${logPrefix}: Iniciando liberación forzada de procesos Chrome/Puppeteer del bot`);

    try {
        // CRÍTICO: Solo matar los PIDs registrados del bot, NO todos los Chrome del sistema
        if (botProcessPids.size === 0 && !currentBrowserPid) {
            logger?.info(`${logPrefix}: No hay PIDs registrados del bot para terminar`);
            console.log(`${logPrefix}: No bot PIDs to terminate`);
            return;
        }

        // Construir lista de PIDs a terminar
        const pidsToKill = new Set(botProcessPids);
        if (currentBrowserPid) {
            pidsToKill.add(currentBrowserPid);
        }

        logger?.info(`${logPrefix}: Terminando ${pidsToKill.size} proceso(s) del bot: ${Array.from(pidsToKill).join(', ')}`);
        console.log(`${logPrefix}: Terminating ${pidsToKill.size} bot process(es): ${Array.from(pidsToKill).join(', ')}`);

        const { exec } = require('child_process');
        const platform = os.platform();

        for (const pid of pidsToKill) {
            await new Promise((resolve) => {
                let command;

                if (platform === 'win32') {
                    // Windows: Matar por PID específico solamente
                    command = `taskkill /F /PID ${pid} 2>nul`;
                } else {
                    // Unix-like: Matar por PID específico solamente
                    command = `kill -9 ${pid} 2>/dev/null || true`;
                }

                logger?.info(`${logPrefix}: Ejecutando: ${command}`);

                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        logger?.warn(`${logPrefix}: Proceso PID ${pid} no encontrado o ya terminado`);
                        console.log(`${logPrefix}: Process PID ${pid} not found or already terminated`);
                    } else {
                        logger?.info(`${logPrefix}: Proceso PID ${pid} terminado exitosamente`);
                        console.log(`${logPrefix}: Process PID ${pid} terminated successfully`);
                    }

                    // Desregistrar el PID después de terminarlo
                    unregisterBotProcess(pid);

                    resolve();
                });
            });

            // Pequeña pausa entre procesos
            await delay(300);
        }

        // Limpiar referencia al PID actual del browser
        currentBrowserPid = null;

        logger?.info(`${logPrefix}: Liberación de procesos del bot completada`);
        console.log(`${logPrefix}: Bot process release completed`);

        // Esperar adicional para que se liberen los handles de archivos
        logger?.info(`${logPrefix}: Esperando 3 segundos para liberación completa de handles`);
        await delay(3000);

        logger?.info(`${logPrefix}: Liberación de procesos Chrome completada`);
        return true;

    } catch (error) {
        logger?.error(`${logPrefix}: Error durante liberación de procesos Chrome: ${error.message}`);
        return false;
    }
}

// Función para liberar handles de archivos forzadamente
async function forceReleaseFileHandles(filePath, maxWaitTime = 5000) {
    const logPrefix = 'Force File Handle Release';
    logger?.info(`${logPrefix}: Intentando liberar handles para: ${filePath}`);

    try {
        // Intentar acceder al archivo para verificar si está disponible
        await fs.promises.access(filePath, fs.constants.F_OK);
        logger?.info(`${logPrefix}: Archivo accesible, no requiere liberación forzada`);
        return true;
    } catch (error) {
        if (error.code === 'EBUSY') {
            logger?.warn(`${logPrefix}: Archivo bloqueado detectado, esperando liberación...`);

            // Esperar un tiempo razonable para que se liberen los handles
            const startTime = Date.now();
            while (Date.now() - startTime < maxWaitTime) {
                await delay(500);
                try {
                    await fs.promises.access(filePath, fs.constants.F_OK);
                    logger?.info(`${logPrefix}: Archivo liberado después de ${Date.now() - startTime}ms`);
                    return true;
                } catch (continueError) {
                    // Continuar esperando
                }
            }

            logger?.error(`${logPrefix}: No se pudo liberar el archivo después de ${maxWaitTime}ms`);
            return false;
        }

        // Otros errores no relacionados con bloqueo
        logger?.info(`${logPrefix}: Archivo no encontrado o error diferente: ${error.message}`);
        return true; // No es un problema de bloqueo
    }
}

// Función para leer archivos Excel con operaciones seguras
async function safeReadExcelFile(excelPath, maxRetries = 3) {
    return await safeFileOperation(async () => {
        // Liberar handles antes de la operación
        await forceReleaseFileHandles(excelPath);

        const excel = XLSX.readFile(excelPath);
        const nombreHoja = excel.SheetNames[0];
        return XLSX.utils.sheet_to_json(excel.Sheets[nombreHoja]);
    }, maxRetries, 1000);
}

// Función para escribir archivos con operaciones seguras
async function safeWriteFile(filePath, data, maxRetries = 3) {
    return await safeFileOperation(async () => {
        // Liberar handles antes de la operación
        await forceReleaseFileHandles(filePath);

        fs.writeFileSync(filePath, data, 'utf8');
        return true;
    }, maxRetries, 1000);
}

// Función para eliminar archivos/directorios con operaciones seguras
async function safeDeletePath(targetPath, maxRetries = 3) {
    return await safeFileOperation(async () => {
        // Liberar handles antes de la operación
        await forceReleaseFileHandles(targetPath);

        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }
        return true;
    }, maxRetries, 1500);
}

// CORRECCIÓN: Manejador global para promesas rechazadas con manejo específico de EBUSY durante logout
let unhandledRejections = [];
process.on('unhandledRejection', (reason, promise) => {
    const errorInfo = {
        reason: reason?.message || reason,
        stack: reason?.stack,
        timestamp: new Date().toISOString(),
        promise: promise.toString()
    };

    unhandledRejections.push(errorInfo);

    // CORRECCIÓN: Manejo específico de errores EBUSY durante logout
    const isEBUSYError = reason?.message?.includes('EBUSY') ||
                        reason?.message?.includes('locked') ||
                        reason?.message?.includes('first_party_sets.db') ||
                        reason?.message?.includes('sharing violation');

    const isDuringLogout = isLoggingOut || reason?.message?.includes('logout');

    if (isEBUSYError && isDuringLogout) {
        // SOLUCIÓN EBUSY: Registrar como warning en lugar de error crítico durante logout
        logger?.warn(`Unhandled Promise Rejection (EBUSY durante logout): ${errorInfo.reason}`);
        logger?.info(`EBUSY Logout Handler: Error EBUSY detectado durante logout, registrando como warning para evitar cierre forzoso`);

        // NO intentar recuperación agresiva durante logout - dejar que el proceso de logout maneje la limpieza
        // NO resetear estado de inicialización durante logout

    } else if (isEBUSYError) {
        // Para errores EBUSY fuera de logout, mantener comportamiento existente pero mejorado
        logger?.error(`Unhandled Promise Rejection (EBUSY): ${errorInfo.reason}`);
        logger?.warn('EBUSY Handler: Error EBUSY detectado fuera de logout, iniciando recuperación controlada...');

        // Solo intentar limpieza si no estamos en proceso de logout
        if (!isLoggingOut && client) {
            try {
                client.destroy().catch(destroyError => {
                    logger?.error(`Error durante limpieza controlada: ${destroyError.message}`);
                });
                client = null;
            } catch (cleanupError) {
                logger?.error(`Error durante cleanup controlado: ${cleanupError.message}`);
            }
        }

        // Reset estado solo si no estamos en logout
        if (!isLoggingOut) {
            isClientInitializing = false;
            resolveClientReady = null;
            rejectClientReady = null;
        }

    } else {
        // Para otros errores, mantener comportamiento existente
        logger?.error(`Unhandled Promise Rejection: ${errorInfo.reason}`);
        logger?.error(`Unhandled Promise Rejection Stack: ${errorInfo.stack}`);

        // CORRECCIÓN: Mejorar manejo de errores en operaciones asíncronas críticas
        if (reason?.message?.includes('ENOTFOUND')) {
            logger?.warn('Unhandled Promise Rejection: Error ENOTFOUND detectado, iniciando recuperación...');

            if (client) {
                try {
                    client.destroy().catch(destroyError => {
                        logger?.error(`Error durante limpieza de emergencia: ${destroyError.message}`);
                    });
                    client = null;
                } catch (cleanupError) {
                    logger?.error(`Error durante cleanup: ${cleanupError.message}`);
                }
            }

            isClientInitializing = false;
            resolveClientReady = null;
            rejectClientReady = null;
        } else if (reason?.message?.includes('Session closed') || reason?.message?.includes('Protocol error')) {
            // CORRECCIÓN: Manejar errores de sesión cerrada como warning, ya que son esperados después de destroy
            logger?.warn(`Unhandled Promise Rejection (Session closed): ${errorInfo.reason}`);
            logger?.info('Session Closed Handler: Error de sesión cerrada detectado, probablemente después de destroy - ignorando');
        }
    }

    // Mantener solo las últimas 10 promesas rechazadas para evitar memory leaks
    if (unhandledRejections.length > 10) {
        unhandledRejections = unhandledRejections.slice(-10);
    }
});

// Función para obtener estadísticas de promesas rechazadas
function getUnhandledRejections() {
    return [...unhandledRejections];
}

// Función para limpiar registro de promesas rechazadas
function clearUnhandledRejections() {
    unhandledRejections = [];
    logger?.info('Unhandled Promise Rejections: Registro limpiado');
}

// CORRECCIÓN: Función de operaciones seguras para evitar promesas colgando
async function safeAsyncOperation(operation, timeout = 30000, operationName = 'unknown') {
    const logPrefix = `Safe Async Operation: ${operationName}`;

    return new Promise(async (resolve, reject) => {
        const timeoutId = setTimeout(() => {
            const timeoutError = new Error(`${operationName} timed out after ${timeout}ms`);
            logger?.error(`${logPrefix}: ${timeoutError.message}`);
            reject(timeoutError);
        }, timeout);

        try {
            logger?.info(`${logPrefix}: Iniciando operación con timeout de ${timeout}ms`);
            const result = await operation();

            clearTimeout(timeoutId);
            logger?.info(`${logPrefix}: Operación completada exitosamente`);
            resolve(result);

        } catch (error) {
            clearTimeout(timeoutId);
            logger?.error(`${logPrefix}: Error en operación: ${error.message}`);
            reject(error);
        }
    });
}

// Función para ejecutar operaciones con reintentos seguros
async function safeRetryOperation(operation, maxRetries = 3, baseDelay = 1000, operationName = 'retry-operation') {
    const logPrefix = `Safe Retry Operation: ${operationName}`;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger?.info(`${logPrefix}: Intento ${attempt}/${maxRetries}`);

            const result = await safeAsyncOperation(
                operation,
                30000,
                `${operationName}-attempt-${attempt}`
            );

            if (attempt > 1) {
                logger?.info(`${logPrefix}: Operación exitosa después de ${attempt} intentos`);
            }

            return result;

        } catch (error) {
            lastError = error;
            logger?.warn(`${logPrefix}: Intento ${attempt}/${maxRetries} falló: ${error.message}`);

            if (attempt < maxRetries) {
                const delayTime = baseDelay * Math.pow(2, attempt - 1);
                logger?.info(`${logPrefix}: Esperando ${delayTime}ms antes del siguiente intento`);
                await delay(delayTime);
            }
        }
    }

    logger?.error(`${logPrefix}: Todos los ${maxRetries} intentos fallaron. Último error: ${lastError.message}`);
    throw lastError;
}

// MEJORA: Función para verificar validez de sesión antes de inicialización completa
async function checkSessionValidity(dataPath) {
    const logPrefix = 'Session Validity Check';
    logger?.info(`${logPrefix}: Checking session validity in path: ${dataPath}`);

    try {
        // Verificar si existe el directorio de sesión
        if (!fs.existsSync(dataPath)) {
            logger?.info(`${logPrefix}: Session directory does not exist - new session required`);
            return { isValid: false, reason: 'no_session_directory' };
        }

        // Verificar archivos de sesión críticos
        const sessionFiles = [
            'session-new_client/SingletonLock',
            'session-new_client/SingletonSocket',
            'session-new_client/UserPrefs.json'
        ];

        let validFiles = 0;
        let totalFiles = sessionFiles.length;

        for (const file of sessionFiles) {
            const filePath = path.join(dataPath, file);
            try {
                await safeFileOperation(async () => {
                    await fs.promises.access(filePath, fs.constants.F_OK);
                    return true;
                }, 2, 500);

                validFiles++;
                logger?.info(`${logPrefix}: Found valid session file: ${file}`);
            } catch (error) {
                logger?.info(`${logPrefix}: Session file missing or inaccessible: ${file} - ${error.message}`);
            }
        }

        // Verificar si tenemos suficientes archivos válidos para considerar la sesión válida
        const minValidFiles = 2; // Requerir al menos 2 archivos válidos
        const isValid = validFiles >= minValidFiles;

        logger?.info(`${logPrefix}: Session validity check complete - Valid files: ${validFiles}/${totalFiles}, Is valid: ${isValid}`);

        return {
            isValid,
            reason: isValid ? 'valid_session' : 'insufficient_session_files',
            validFiles,
            totalFiles
        };

    } catch (error) {
        logger?.error(`${logPrefix}: Error checking session validity: ${error.message}`);
        return { isValid: false, reason: 'check_error', error: error.message };
    }
}

// Función para cargar configuración de Puppeteer desde JSON
function loadPuppeteerConfig(configPath) {
    try {
        if (fs.existsSync(configPath)) {
            // CORRECCIÓN: Usar operaciones seguras para leer configuración
            const configData = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configData);

            // Validar estructura básica
            const defaultConfig = {
                headless: true,
                puppeteerArgs: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-site-isolation-trials',
                    '--disable-gpu-sandbox',
                    '--disable-software-rasterizer',
                    '--shm-size=1gb',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ],
                executablePath: null
            };

            // Merge con defaults
            return {
                headless: typeof config.headless === 'boolean' ? config.headless : defaultConfig.headless,
                puppeteerArgs: Array.isArray(config.puppeteerArgs) && config.puppeteerArgs.length > 0
                    ? config.puppeteerArgs
                    : defaultConfig.puppeteerArgs,
                executablePath: typeof config.executablePath === 'string' && config.executablePath.trim()
                    ? config.executablePath.trim()
                    : defaultConfig.executablePath
            };
        }
    } catch (error) {
        logger?.warn('Config Load: Error loading puppeteer config, using defaults:', error.message);
    }

    // Return defaults if file doesn't exist or error
    return {
        headless: true,
        puppeteerArgs: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-site-isolation-trials',
            '--disable-gpu-sandbox',
            '--disable-software-rasterizer',
            '--shm-size=1gb',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ],
        executablePath: null
    };
}

let client = null;
let clientReadyPromise = null;
let resolveClientReady = null;
let isClientInitializing = false;

// Variables para rastreo seguro de procesos del bot
let botProcessPids = new Set(); // Set de PIDs de procesos Chrome/Puppeteer iniciados por el bot
let processMonitoringInterval = null; // Intervalo para monitoreo de procesos
let childProcess = null; // Referencia al proceso hijo si se usa separación
let currentBrowserPid = null; // PID actual del proceso de Chrome del bot

// Función para registrar un PID de proceso del bot
function registerBotProcess(pid) {
    if (pid && typeof pid === 'number') {
        botProcessPids.add(pid);
        logger?.info(`Process Monitor: Registered bot process PID: ${pid}`);
        console.log(`Process Monitor: Registered bot process PID: ${pid}`);
    }
}

// Función para desregistrar un PID de proceso del bot
function unregisterBotProcess(pid) {
    if (botProcessPids.has(pid)) {
        botProcessPids.delete(pid);
        logger?.info(`Process Monitor: Unregistered bot process PID: ${pid}`);
        console.log(`Process Monitor: Unregistered bot process PID: ${pid}`);
    }
}

// Función para limpiar todos los PIDs registrados
function clearBotProcesses() {
    botProcessPids.clear();
    logger?.info(`Process Monitor: Cleared all registered bot process PIDs`);
    console.log(`Process Monitor: Cleared all registered bot process PIDs`);
}

// Función para monitorear procesos del bot de manera segura
async function monitorBotProcesses() {
    const logPrefix = 'Process Monitor';
    logger?.info(`${logPrefix}: Starting safe monitoring of bot processes`);

    if (botProcessPids.size === 0) {
        logger?.info(`${logPrefix}: No bot processes to monitor`);
        return;
    }

    try {
        const platform = os.platform();
        let runningPids = new Set();

        if (platform === 'win32') {
            // En Windows, usar tasklist para obtener PIDs
            const { exec } = require('child_process');
            const tasklistPromise = new Promise((resolve, reject) => {
                exec('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH', (error, stdout, stderr) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    const lines = stdout.trim().split('\n');
                    lines.forEach(line => {
                        const match = line.match(/"([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
                        if (match) {
                            const pid = parseInt(match[2], 10);
                            if (pid) runningPids.add(pid);
                        }
                    });
                    resolve();
                });
            });
            await tasklistPromise;
        } else {
            // En Unix-like, usar ps
            const { exec } = require('child_process');
            const psPromise = new Promise((resolve, reject) => {
                exec('ps -o pid= -p ' + Array.from(botProcessPids).join(','), (error, stdout, stderr) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    const pids = stdout.trim().split('\n').map(pid => parseInt(pid.trim(), 10)).filter(pid => pid);
                    pids.forEach(pid => runningPids.add(pid));
                    resolve();
                });
            });
            await psPromise;
        }

        // Verificar si algún PID del bot ha desaparecido
        for (const pid of botProcessPids) {
            if (!runningPids.has(pid)) {
                logger?.warn(`${logPrefix}: Bot process PID ${pid} not found - browser may have been closed`);
                console.log(`Process Monitor: Bot process PID ${pid} not found - browser may have been closed`);

                // Enviar evento específico al main process
                if (typeof process.send === 'function') {
                    process.send({ type: 'browser-closed', pid: pid, reason: 'process_not_found' });
                }

                // Desregistrar el PID
                unregisterBotProcess(pid);
            }
        }

        logger?.info(`${logPrefix}: Monitoring complete - ${botProcessPids.size} bot processes tracked`);
    } catch (error) {
        logger?.error(`${logPrefix}: Error during process monitoring: ${error.message}`);
        console.error(`Process Monitor: Error during process monitoring: ${error.message}`);
    }
}

// Función para iniciar monitoreo de procesos
function startProcessMonitoring() {
    if (processMonitoringInterval) {
        clearInterval(processMonitoringInterval);
    }

    logger?.info(`Process Monitor: Starting process monitoring every 10 seconds`);
    console.log(`Process Monitor: Starting process monitoring every 10 seconds`);

    processMonitoringInterval = setInterval(monitorBotProcesses, 10000); // Cada 10 segundos
}

// Función para detener monitoreo de procesos
function stopProcessMonitoring() {
    if (processMonitoringInterval) {
        clearInterval(processMonitoringInterval);
        processMonitoringInterval = null;
        logger?.info(`Process Monitor: Stopped process monitoring`);
        console.log(`Process Monitor: Stopped process monitoring`);
    }
}

// Variables para controlar reintentos de reconexión
let isReconnecting = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectDelay = 5000; // 5 segundos
let reconnectTimeout = null;

// Logger instance for whatsapp-logic
let logger = null;

// Initialize logger with the same configuration as main.js
function initializeLogger(logsDir) {
    if (!logger) {
        logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level.toUpperCase()}] [whatsapp-logic]: ${message}`;
                })
            ),
            transports: [
                new winston.transports.File({ filename: path.join(logsDir, 'logic.log') }),
                new winston.transports.Console()
            ]
        });
    }
    return logger;
}

// Robust Chrome detection with multiple fallbacks
async function detectChromeExecutable() {
    const logPrefix = 'Chrome Detection';
    const startTime = Date.now();
    logger?.info(`${logPrefix}: Starting Chrome executable detection`);
    logger?.info(`${logPrefix}: System info - Platform: ${os.platform()}, Arch: ${os.arch()}, Release: ${os.release()}`);
    
    const detectionMethods = [
        {
            name: 'find-chrome-bin package',
            detect: async () => {
                try {
                    const { findChrome } = await import('find-chrome-bin');
                    const chromeInfo = await findChrome();
                    return chromeInfo.executablePath;
                } catch (error) {
                    throw new Error(`find-chrome-bin failed: ${error.message}`);
                }
            }
        },
        {
            name: 'System-specific paths',
            detect: async () => {
                const platform = os.platform();
                const possiblePaths = [];
                
                if (platform === 'win32') {
                    possiblePaths.push(
                        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                        path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
                        'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
                        'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe'
                    );
                } else if (platform === 'darwin') {
                    possiblePaths.push(
                        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
                        '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'
                    );
                } else {
                    possiblePaths.push(
                        '/usr/bin/google-chrome',
                        '/usr/bin/google-chrome-stable',
                        '/usr/bin/google-chrome-beta',
                        '/usr/bin/chromium-browser',
                        '/usr/bin/chromium',
                        '/snap/bin/chromium'
                    );
                }
                
                for (const chromePath of possiblePaths) {
                    try {
                        // CORRECCIÓN: Usar operaciones seguras para verificar acceso a Chrome
                        await safeFileOperation(async () => {
                            await fs.promises.access(chromePath, fs.constants.F_OK | fs.constants.X_OK);
                            return true;
                        }, 2, 500);

                        logger?.info(`${logPrefix}: Found Chrome at system path: ${chromePath}`);
                        return chromePath;
                    } catch (error) {
                        // Continue to next path
                    }
                }
                
                throw new Error('No Chrome executable found in system paths');
            }
        },
        {
            name: 'Puppeteer bundled Chromium',
            detect: async () => {
                try {
                    const puppeteer = require('puppeteer');
                    const executablePath = puppeteer.executablePath();

                    // CORRECCIÓN: Usar operaciones seguras para verificar acceso a Chromium
                    await safeFileOperation(async () => {
                        await fs.promises.access(executablePath, fs.constants.F_OK | fs.constants.X_OK);
                        return true;
                    }, 2, 500);

                    logger?.info(`${logPrefix}: Using Puppeteer bundled Chromium: ${executablePath}`);
                    return executablePath;
                } catch (error) {
                    throw new Error(`Puppeteer Chromium not available: ${error.message}`);
                }
            }
        }
    ];
    
    let lastError = null;
    
    for (const method of detectionMethods) {
        const methodStartTime = Date.now();
        try {
            logger?.info(`${logPrefix}: Trying method: ${method.name}`);
            const executablePath = await method.detect();
            logger?.info(`${logPrefix}: Method '${method.name}' completed in ${Date.now() - methodStartTime}ms`);

            // Validate the executable
            try {
                const accessStartTime = Date.now();

                // CORRECCIÓN: Usar operaciones seguras para validación de acceso
                await safeFileOperation(async () => {
                    await fs.promises.access(executablePath, fs.constants.F_OK | fs.constants.X_OK);
                    return true;
                }, 3, 1000);

                logger?.info(`${logPrefix}: Successfully detected Chrome executable: ${executablePath}`);
                logger?.info(`${logPrefix}: Total detection time: ${Date.now() - startTime}ms`);
                return executablePath;
            } catch (accessError) {
                logger?.warn(`${logPrefix}: Path not accessible after ${Date.now() - methodStartTime}ms: ${accessError.message}`);
                throw new Error(`Path not accessible: ${accessError.message}`);
            }

        } catch (error) {
            lastError = error;
            logger?.warn(`${logPrefix}: Method '${method.name}' failed after ${Date.now() - methodStartTime}ms: ${error.message}`);
        }
    }
    
    // If all methods failed, throw comprehensive error
    const errorMessage = `Failed to detect Chrome executable. Last error: ${lastError?.message || 'Unknown error'}`;
    logger?.error(`${logPrefix}: ${errorMessage}`);
    throw new Error(errorMessage);
}

// Enhanced client creation with detailed logging
async function createWhatsAppClient(dataPath, executablePath, configPath = null) {
    const logPrefix = 'Client Creation';
    logger?.info(`${logPrefix}: Creating WhatsApp client with Chrome path: ${executablePath}`);
    logger?.info(`${logPrefix}: Session data path: ${dataPath}`);

    try {
        // Calculate actual config path
        const actualConfigPath = configPath || path.join(path.dirname(dataPath), 'whatsapp-config.json');

        // Load Puppeteer configuration
        const puppeteerConfig = loadPuppeteerConfig(actualConfigPath);

        // Log config source
        try {
            // CORRECCIÓN: Usar operaciones seguras para verificar existencia de archivo de configuración
            await safeFileOperation(async () => {
                await fs.promises.access(actualConfigPath, fs.constants.F_OK);
                return true;
            }, 2, 500);

            logger?.info(`${logPrefix}: Config loaded from file: ${actualConfigPath}`);
        } catch (configError) {
            logger?.info(`${logPrefix}: Config file not found at ${actualConfigPath}, using defaults`);
        }

        logger?.info(`${logPrefix}: Loaded Puppeteer config - headless: ${puppeteerConfig.headless}, args count: ${puppeteerConfig.puppeteerArgs.length}, executablePath: ${puppeteerConfig.executablePath || 'auto-detect'}`);

        // Use custom executablePath if provided, otherwise use detected one
        const finalExecutablePath = puppeteerConfig.executablePath || executablePath;

        const clientConfig = {
            authStrategy: new LocalAuth({ clientId: 'new_client', dataPath }),
            puppeteer: {
                executablePath: finalExecutablePath,
                headless: puppeteerConfig.headless,
                args: puppeteerConfig.puppeteerArgs,
                timeout: 60000,
                protocolTimeout: 60000
            }
        };

        logger?.info(`${logPrefix}: Client configuration prepared`);
        logger?.info(`${logPrefix}: Puppeteer args: ${JSON.stringify(clientConfig.puppeteer.args)}`);
        logger?.info(`${logPrefix}: Final executable path: ${finalExecutablePath}`);

        const newClient = new Client(clientConfig);
        logger?.info(`${logPrefix}: Client instance created successfully`);

        return newClient;

    } catch (error) {
        const errorMessage = `Failed to create WhatsApp client: ${error.message}`;
        logger?.error(`${logPrefix}: ${errorMessage}`);
        logger?.error(`${logPrefix}: Error stack: ${error.stack}`);
        throw new Error(errorMessage);
    }
}

// --- Start of Centralized Campaign State ---
const initialCampaignState = {
    id: null, // Unique ID for the current campaign
    status: 'inactive', // inactive, running, pausing, paused, stopping, stopped, finished
    config: {
        countryCode: '' // Default to empty string for country code
    },
    contacts: [],
    totalContacts: 0,
    sentCount: 0,
    progressCallback: null,
    resumePromiseResolver: null,
    countdownCallback: null, // Callback for countdown updates
    countdownState: {
        isActive: false,
        remainingTime: 0,
        totalTime: 0,
        type: 'idle' // 'idle', 'sending', 'pausing'
    }
};

let campaignState = { ...initialCampaignState };
// --- End of Centralized Campaign State ---


/**
 * Initializes the WhatsApp client with robust error handling and comprehensive logging.
 * @param {string} dataPath - Path for session data storage
 * @param {function(string)} onQrCode - Callback for when a QR code is generated.
 * @param {function()} onClientReady - Callback for when the client is ready.
 * @param {function()} onDisconnected - Callback for when the client is disconnected.
 * @param {function(string)} onAuthFailure - Callback for authentication failure.
 * @param {string} logsDir - Directory for log files (optional, for logger initialization)
 */
async function initializeClient(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir = null) {
    const logPrefix = 'Client Initialization';
    
    // Initialize logger if logsDir is provided
    if (logsDir && !logger) {
        try {
            initializeLogger(logsDir);
            logger?.info(`${logPrefix}: Logger initialized with logs directory: ${logsDir}`);
        } catch (loggerError) {
            console.error(`Failed to initialize logger: ${loggerError.message}`);
        }
    }
    
    logger?.info(`${logPrefix}: initializeClient called with dataPath: ${dataPath}`);
    console.log("initializeClient called.");

    // If initialization is already in progress, wait for it to complete.
    if (isClientInitializing) {
        logger?.info(`${logPrefix}: Client initialization already in progress. Waiting for completion.`);
        console.log("Client initialization already in progress. Waiting for it to complete.");

        // CRÍTICO: Manejar caso donde clientReadyPromise puede ser null (race condition)
        if (clientReadyPromise) {
            try {
                // Agregar timeout de 120 segundos para evitar deadlock
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Client initialization wait timeout after 120 seconds')), 120000)
                );

                await Promise.race([clientReadyPromise, timeoutPromise]);
                logger?.info(`${logPrefix}: Existing client initialization completed successfully.`);
                console.log("Existing client initialization completed successfully.");
                if (onClientReady) onClientReady();
            } catch (e) {
                logger?.error(`${logPrefix}: Ongoing client initialization failed: ${e.message}`);
                console.error("Ongoing client initialization failed:", e.message);
                if (onAuthFailure) onAuthFailure(e.message);
            }
            return;
        } else {
            // CRÍTICO: Si promise es null pero flag es true, puede ser race condition
            // Esperar un momento y reintentar
            logger?.warn(`${logPrefix}: Initialization in progress but promise is null - possible race condition`);
            console.log("Initialization in progress but promise is null - waiting and retrying");

            await delay(1000); // Esperar 1 segundo

            // Reintentar: si aún está inicializando, esperar la promise
            if (isClientInitializing && clientReadyPromise) {
                try {
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Client initialization wait timeout after 120 seconds')), 120000)
                    );

                    await Promise.race([clientReadyPromise, timeoutPromise]);
                    logger?.info(`${logPrefix}: Client initialization completed after retry.`);
                    if (onClientReady) onClientReady();
                    return;
                } catch (e) {
                    logger?.error(`${logPrefix}: Client initialization failed after retry: ${e.message}`);
                    if (onAuthFailure) onAuthFailure(e.message);
                    return;
                }
            }

            // Si después de esperar ya no está inicializando, continuar con nueva inicialización
            logger?.info(`${logPrefix}: Initialization lock released, proceeding with new initialization`);
        }
    }

    // If client is already initialized and ready, skip re-initialization.
    if (client && client.info) {
        logger?.info(`${logPrefix}: Client already ready, skipping re-initialization.`);
        console.log("Client already ready, skipping re-initialization.");
        if (onClientReady) onClientReady();
        return;
    }

    // If client exists but is not ready (e.g., after LOGOUT), force recreation
    if (client && !client.info) {
        logger?.warn(`${logPrefix}: Client exists but is not ready (likely after LOGOUT), forcing recreation.`);
        console.log("Client exists but is not ready, forcing recreation.");
        try {
            await destroyClientInstance();
        } catch (error) {
            logger?.error(`${logPrefix}: Error destroying existing client: ${error.message}`);
        }
    }

    logger?.info(`${logPrefix}: Starting new client initialization process...`);
    console.log("Starting new client initialization process...");

    // CRÍTICO: Crear la promise ANTES de setear el flag para evitar race condition
    // Si se setea el flag primero, otra llamada puede entrar y encontrar flag=true pero promise=null
    clientReadyPromise = new Promise((resolve, reject) => {
        resolveClientReady = resolve;
        rejectClientReady = reject;
    });

    // Ahora sí, marcar que la inicialización está en progreso
    isClientInitializing = true;

    if (!client) {
        logger?.info(`${logPrefix}: Client instance not found. Creating new client...`);
        console.log("Client instance not found. Creating new client...");

        try {
            // MEJORA: Detección temprana de sesiones inválidas
            logger?.info(`${logPrefix}: Checking session validity before full initialization...`);
            const sessionStatus = await checkSessionValidity(dataPath);

            if (sessionStatus.isValid) {
                logger?.info(`${logPrefix}: Valid session detected, proceeding with normal initialization`);
                console.log("whatsapp-logic: Valid session detected, proceeding with normal initialization");
            } else {
                logger?.warn(`${logPrefix}: Invalid or missing session detected: ${sessionStatus.reason}`);
                console.log(`whatsapp-logic: Invalid session detected: ${sessionStatus.reason}`);
                console.log("whatsapp-logic: Will generate QR code immediately after client creation");
            }

            // Use robust Chrome detection with enhanced validation
            logger?.info(`${logPrefix}: Starting Chrome executable detection...`);

            // CORRECCIÓN: Usar operaciones seguras para detección de Chrome
            const executablePath = await safeRetryOperation(
                async () => await detectChromeExecutable(),
                3,
                2000,
                'chrome-detection'
            );

            // Additional validation of Chrome executable
            if (!executablePath || typeof executablePath !== 'string') {
                throw new Error('Chrome executable path is invalid or undefined');
            }

            // Check if file actually exists and is executable
            try {
                // CORRECCIÓN: Usar operaciones seguras para validación de archivos
                await safeFileOperation(async () => {
                    const stats = fs.statSync(executablePath);
                    if (!stats.isFile()) {
                        throw new Error(`Path exists but is not a file: ${executablePath}`);
                    }
                    logger?.info(`${logPrefix}: Chrome executable validated - Size: ${stats.size} bytes, Mode: ${stats.mode.toString(8)}`);
                    return true;
                }, 3, 1000);
            } catch (validationError) {
                throw new Error(`Chrome executable validation failed: ${validationError.message}`);
            }

            logger?.info(`${logPrefix}: Chrome executable detected and validated successfully: ${executablePath}`);
            console.log("Chrome executable found and validated at:", executablePath);

            // Create client with enhanced error handling
            logger?.info(`${logPrefix}: Creating WhatsApp client instance...`);
            client = await createWhatsAppClient(dataPath, executablePath);
            logger?.info(`${logPrefix}: WhatsApp client instance created successfully`);

            // MEJORA: Si la sesión es inválida, esperar al QR real del cliente
            if (!sessionStatus.isValid) {
                logger?.info(`${logPrefix}: Invalid session detected, waiting for real QR from client`);
                console.log("whatsapp-logic: Invalid session detected, waiting for real QR from client");
                // No enviar QR temporal, esperar al evento 'qr' real del cliente
            }

            // Set up event listeners with enhanced logging
            client.on('qr', qr => {
                logger?.info(`${logPrefix}: QR code received, length: ${qr.length}`);
                console.log('📱 whatsapp-logic: QR CODE RECEIVED:', qr);
                console.log('🔄 whatsapp-logic: Setting isClientInitializing to false (QR generated)');
                isClientInitializing = false; // Reset initialization flag when QR is generated
                console.log('📊 whatsapp-logic: isClientInitializing is now:', isClientInitializing);
                
                console.log('📞 whatsapp-logic: onQrCode callback exists:', !!onQrCode);
                if (onQrCode) {
                    logger?.info(`${logPrefix}: Calling onQrCode callback`);
                    console.log('🔄 whatsapp-logic: Calling onQrCode callback');
                    onQrCode(qr);
                } else {
                    logger?.warn(`${logPrefix}: onQrCode callback is null/undefined`);
                    console.log('❌ whatsapp-logic: onQrCode callback is null/undefined');
                }
            });
            
            client.on('ready', () => {
                logger?.info(`${logPrefix}: Client is ready and authenticated!`);
                console.log('🎉 whatsapp-logic: Client is ready!');
                console.log('🔄 whatsapp-logic: Setting isClientInitializing to false');
                isClientInitializing = false;
                console.log('📊 whatsapp-logic: isClientInitializing is now:', isClientInitializing);

                // CORRECCIÓN: Verificación adicional para logCallback antes de usar
                if (typeof logCallback === 'function') {
                    logCallback('whatsapp-logic: WhatsApp client is ready and authenticated');
                } else {
                    logger?.info(`${logPrefix}: logCallback no está disponible en evento 'ready'`);
                }
                if (onClientReady) {
                    logger?.info(`${logPrefix}: Calling onClientReady callback`);
                    console.log('📞 whatsapp-logic: Calling onClientReady callback');
                    onClientReady();
                }
                if (resolveClientReady) {
                    logger?.info(`${logPrefix}: Resolving clientReadyPromise`);
                    console.log('✅ whatsapp-logic: Resolving clientReadyPromise');
                    resolveClientReady();
                    resolveClientReady = null;
                    rejectClientReady = null;
                }

                // Register browser process PID for safe monitoring (headless AND non-headless)
                try {
                    const isHeadless = client.options?.puppeteer?.headless;
                    logger?.info(`${logPrefix}: Attempting browser process monitoring (headless: ${isHeadless})`);
                    console.log(`Process Monitor: Attempting browser process monitoring (headless: ${isHeadless})`);

                    // Si ya capturamos el PID antes, solo iniciar el monitoreo
                    if (currentBrowserPid) {
                        logger?.info(`${logPrefix}: Browser PID already captured: ${currentBrowserPid}`);
                        console.log(`Process Monitor: Browser PID already captured: ${currentBrowserPid}`);
                        if (!isHeadless) {
                            startProcessMonitoring();
                            logger?.info(`${logPrefix}: Process monitoring started for non-headless mode`);
                        }
                    } else {
                        // Si no se capturó antes, intentar capturar ahora en el evento ready
                        setTimeout(async () => {
                            try {
                                if (!client) {
                                    logger?.warn(`${logPrefix}: Client is null, cannot register PID`);
                                    console.log(`Process Monitor: Client is null, cannot register PID`);
                                    return;
                                }

                                // Intentar múltiples métodos para obtener el PID
                                let pid = null;

                                // Método 1: puppeteerPage.browser
                                if (client.puppeteerPage && client.puppeteerPage.browser) {
                                    try {
                                        const browser = client.puppeteerPage.browser();
                                        const browserProcess = browser.process();
                                        if (browserProcess && browserProcess.pid) {
                                            pid = browserProcess.pid;
                                            logger?.info(`${logPrefix}: PID obtained via puppeteerPage: ${pid}`);
                                        }
                                    } catch (e) {
                                        logger?.warn(`${logPrefix}: Method 1 failed: ${e.message}`);
                                    }
                                }

                                // Método 2: pupBrowser
                                if (!pid && client.pupBrowser && typeof client.pupBrowser.process === 'function') {
                                    try {
                                        const browserProcess = client.pupBrowser.process();
                                        if (browserProcess && browserProcess.pid) {
                                            pid = browserProcess.pid;
                                            logger?.info(`${logPrefix}: PID obtained via pupBrowser: ${pid}`);
                                        }
                                    } catch (e) {
                                        logger?.warn(`${logPrefix}: Method 2 failed: ${e.message}`);
                                    }
                                }

                                // Método 3: pupPage.browser
                                if (!pid && client.pupPage && client.pupPage.browser) {
                                    try {
                                        const browser = client.pupPage.browser();
                                        const browserProcess = browser.process();
                                        if (browserProcess && browserProcess.pid) {
                                            pid = browserProcess.pid;
                                            logger?.info(`${logPrefix}: PID obtained via pupPage: ${pid}`);
                                        }
                                    } catch (e) {
                                        logger?.warn(`${logPrefix}: Method 3 failed: ${e.message}`);
                                    }
                                }

                                if (pid) {
                                    currentBrowserPid = pid;
                                    registerBotProcess(pid);
                                    logger?.info(`${logPrefix}: Registered browser process PID: ${pid} (headless: ${isHeadless})`);
                                    console.log(`Process Monitor: Registered browser process PID: ${pid} (headless: ${isHeadless})`);

                                    // Solo iniciar monitoreo activo en modo no-headless
                                    if (!isHeadless) {
                                        startProcessMonitoring();
                                        logger?.info(`${logPrefix}: Process monitoring started`);
                                    }
                                } else {
                                    logger?.warn(`${logPrefix}: Could not obtain browser PID through any method`);
                                    console.log(`Process Monitor: Could not obtain browser PID through any method`);
                                }
                            } catch (error) {
                                logger?.error(`${logPrefix}: Error registering browser process: ${error.message}`);
                                console.error(`Process Monitor: Error registering browser process: ${error.message}`);
                            }
                        }, 2000); // Wait 2 seconds for browser to be fully initialized
                    }
                } catch (error) {
                    logger?.error(`${logPrefix}: Error setting up PID registration: ${error.message}`);
                    console.error(`Process Monitor: Error setting up PID registration: ${error.message}`);
                }
            });
            
            client.on('auth_failure', msg => {
                logger?.error(`${logPrefix}: Authentication failure: ${msg}`);
                console.error('AUTHENTICATION FAILURE', msg);
                if (logCallback) logCallback(`whatsapp-logic: Authentication failure: ${msg}`);
                if (onAuthFailure) onAuthFailure(msg);
                if (rejectClientReady) rejectClientReady(new Error('Authentication failure: ' + msg));
                resolveClientReady = null;
                rejectClientReady = null;
                isClientInitializing = false;
            });
            
            client.on('disconnected', async (reason) => {
                const disconnectTime = new Date().toISOString();
                const clientInfoBefore = JSON.stringify(client.info || {});
                const sessionAge = client.info?.me ? new Date().toISOString() : 'unknown';

                logger?.warn(`${logPrefix}: Client disconnected at ${disconnectTime}: ${reason}`);
                logger?.warn(`${logPrefix}: Client info before disconnect: ${clientInfoBefore}`);
                logger?.warn(`${logPrefix}: Session age estimate: ${sessionAge}`);
                logger?.warn(`${logPrefix}: Initialization state: isClientInitializing=${isClientInitializing}`);
                console.log('Client was disconnected:', reason);
                console.log('Client info before disconnect:', clientInfoBefore);
                console.log('Session age estimate:', sessionAge);

                // CORRECCIÓN: Verificación adicional para logCallback antes de usar
                if (typeof logCallback === 'function') {
                    logCallback(`whatsapp-logic: WhatsApp client disconnected: ${reason}`);
                } else {
                    logger?.info(`${logPrefix}: logCallback no disponible en evento 'disconnected'`);
                }

                // CORRECCIÓN: Diferenciar entre LOGOUT y otras desconexiones técnicas
                const isLogout = reason === 'LOGOUT' || reason === 'logout' ||
                                reason === 'user_initiated' || reason === 'manual_logout';

                // MEJORA: Mejorar logs de debug para diferenciar tipos de LOGOUT
                if (isLogout) {
                    // Analizar si es LOGOUT por cierre manual o por sesión inválida
                    const isManualLogout = client.info && client.info.me;
                    const logoutType = isManualLogout ? 'manual_logout' : 'invalid_session_logout';

                    logger?.info(`${logPrefix}: LOGOUT detectado - Tipo: ${logoutType}, Razón: ${reason}`);
                    logger?.info(`${logPrefix}: LOGOUT análisis - Client info presente: ${!!client.info}, Session válida: ${!!client.info?.me}`);
                    console.log(`whatsapp-logic: LOGOUT detectado - Tipo: ${logoutType}, Razón: ${reason}`);
                    console.log(`whatsapp-logic: LOGOUT análisis - Client info presente: ${!!client.info}, Session válida: ${!!client.info?.me}`);

                    if (typeof logCallback === 'function') {
                        const logoutMessage = isManualLogout
                            ? 'whatsapp-logic: Sesión cerrada manualmente por usuario - requiere nuevo QR'
                            : 'whatsapp-logic: Sesión inválida detectada - requiere nuevo QR';
                        logCallback(logoutMessage);
                    }

                    // Limpiar estado de reconexión
                    isReconnecting = false;
                    reconnectAttempts = 0;
                    if (reconnectTimeout) {
                        clearTimeout(reconnectTimeout);
                        reconnectTimeout = null;
                    }

                    // CORRECCIÓN: Para LOGOUT, destruir el cliente para resetear el estado correctamente
                    logger?.info(`${logPrefix}: LOGOUT (${logoutType}) detectado - Destruyendo cliente para resetear estado`);
                    try {
                        await destroyClientInstance();
                        logger?.info(`${logPrefix}: Cliente destruido exitosamente después de LOGOUT (${logoutType})`);
                    } catch (destroyError) {
                        logger?.error(`${logPrefix}: Error destruyendo cliente en LOGOUT (${logoutType}): ${destroyError.message}`);
                    }
                } else {
                    logger?.warn(`${logPrefix}: Desconexión técnica detectada: ${reason} - Intentando reconexión...`);
                    logger?.warn(`${logPrefix}: Desconexión técnica - Estado del cliente: Info=${!!client.info}, Inicializando=${isClientInitializing}`);
                    console.log(`whatsapp-logic: Desconexión técnica detectada: ${reason} - Intentando reconexión...`);
                    console.log(`whatsapp-logic: Desconexión técnica - Estado del cliente: Info=${!!client.info}, Inicializando=${isClientInitializing}`);

                    if (typeof logCallback === 'function') {
                        logCallback(`whatsapp-logic: Desconexión técnica: ${reason} - Intentando reconexión automática`);
                    }

                    // Enviar evento específico para desconexión técnica
                    if (typeof process.send === 'function') {
                        process.send({ type: 'browser-closed', reason: reason, timestamp: new Date().toISOString() });
                    }
                }

                if (campaignState.status === 'running') {
                    pauseSending(campaignState.id);
                    logger?.info(`${logPrefix}: Campaign paused due to disconnection`);
                    console.log("whatsapp-logic: Client disconnected while campaign active. Campaign paused.");

                    if (typeof logCallback === 'function') {
                        logCallback('whatsapp-logic: Campaña pausada debido a desconexión');
                    }
                }

                if (onDisconnected) onDisconnected(reason);

                // CORRECCIÓN: Mejorar flujo de desconexión para evitar estados de carrera
                if (!isLogout && !isReconnecting) {
                    await handleReconnection(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir, reason);
                } else if (isLogout) {
                    // Para LOGOUT, limpiar completamente el estado
                    isClientInitializing = false;
                    resolveClientReady = null;
                    rejectClientReady = null;
                }

                // Safe process cleanup on disconnect
                if (currentBrowserPid) {
                    unregisterBotProcess(currentBrowserPid);
                    currentBrowserPid = null;
                }
                stopProcessMonitoring();
            });
            
        } catch (e) {
            logger?.error(`${logPrefix}: Failed to detect Chrome or create client instance: ${e.message}`);
            logger?.error(`${logPrefix}: Error stack: ${e.stack}`);
            console.error("Failed to import or find Chrome or create client instance:", e);
            isClientInitializing = false;
            
            let errorMessage = e.message;
            if (e.message.includes('find-chrome-bin') || e.message.includes('Chrome executable')) {
                errorMessage = "No se pudo encontrar una instalación válida de Google Chrome. Por favor, instale Google Chrome o verifique que esté correctamente instalado.";
            }
            
            if(onAuthFailure) onAuthFailure(errorMessage);
            if (rejectClientReady) rejectClientReady(e);
            resolveClientReady = null;
            rejectClientReady = null;
            return;
        }
    } else {
        logger?.info(`${logPrefix}: Client instance already exists. Attempting to re-initialize it.`);
        console.log("Client instance already exists. Attempting to re-initialize it.");
    }

    try {
        const initTimeoutMs = 120 * 1000; // Increased timeout to 2 minutes
        const initStartTime = Date.now();

        logger?.info(`${logPrefix}: Calling client.initialize() with timeout of ${initTimeoutMs / 1000} seconds.`);
        logger?.info(`${logPrefix}: Client configuration: ${JSON.stringify(client.options?.puppeteer ? { headless: client.options.puppeteer.headless, executablePath: client.options.puppeteer.executablePath } : {})}`);
        console.log("Calling client.initialize() with a timeout of", initTimeoutMs / 1000, "seconds.");

        // CORRECCIÓN: Usar operaciones seguras para inicialización del cliente
        await safeAsyncOperation(async () => {
            return await Promise.race([
                client.initialize(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Client initialization timed out after 2 minutes')), initTimeoutMs))
            ]);
        }, initTimeoutMs, 'client-initialization');

        logger?.info(`${logPrefix}: Client initialized successfully in ${Date.now() - initStartTime}ms`);
        console.log(`Client initialized successfully in ${Date.now() - initStartTime}ms`);

        // CRÍTICO: Capturar y registrar PID del browser inmediatamente después de inicialización
        try {
            // Intentar múltiples veces ya que el browser puede tardar en estar disponible
            let pidCaptured = false;
            for (let attempt = 1; attempt <= 5 && !pidCaptured; attempt++) {
                try {
                    if (client.pupBrowser && typeof client.pupBrowser.process === 'function') {
                        const browserProcess = client.pupBrowser.process();
                        if (browserProcess && browserProcess.pid) {
                            currentBrowserPid = browserProcess.pid;
                            registerBotProcess(currentBrowserPid);
                            logger?.info(`${logPrefix}: Browser PID captured immediately: ${currentBrowserPid}`);
                            console.log(`${logPrefix}: Browser PID captured immediately: ${currentBrowserPid}`);
                            pidCaptured = true;
                        }
                    }

                    // Método alternativo para whatsapp-web.js
                    if (!pidCaptured && client.pupPage && client.pupPage.browser) {
                        const browser = client.pupPage.browser();
                        const browserProcess = browser.process();
                        if (browserProcess && browserProcess.pid) {
                            currentBrowserPid = browserProcess.pid;
                            registerBotProcess(currentBrowserPid);
                            logger?.info(`${logPrefix}: Browser PID captured via pupPage: ${currentBrowserPid}`);
                            console.log(`${logPrefix}: Browser PID captured via pupPage: ${currentBrowserPid}`);
                            pidCaptured = true;
                        }
                    }
                } catch (pidError) {
                    logger?.warn(`${logPrefix}: Attempt ${attempt}/5 to capture browser PID failed: ${pidError.message}`);
                }

                if (!pidCaptured && attempt < 5) {
                    await delay(500); // Esperar 500ms antes del siguiente intento
                }
            }

            if (!pidCaptured) {
                logger?.warn(`${logPrefix}: Could not capture browser PID after 5 attempts - will retry on 'ready' event`);
                console.log(`${logPrefix}: Could not capture browser PID immediately - will retry on 'ready' event`);
            }
        } catch (pidCaptureError) {
            logger?.error(`${logPrefix}: Error capturing browser PID: ${pidCaptureError.message}`);
            console.error(`${logPrefix}: Error capturing browser PID: ${pidCaptureError.message}`);
        }
    } catch (error) {
        const initFailTime = Date.now();
        logger?.error(`${logPrefix}: Error during client.initialize() after ${initFailTime - Date.now()}ms: ${error.message}`);
        logger?.error(`${logPrefix}: Error type: ${error.constructor.name}`);
        logger?.error(`${logPrefix}: Error stack: ${error.stack}`);
        console.error("Error during client.initialize() or timeout:", error.message);
        console.error("Stack trace:", error.stack);

        // Enhanced error classification and user-friendly messages
        let userFriendlyMessage = error.message;
        let shouldRetry = false;

        if (error.message.includes('timeout')) {
            userFriendlyMessage = "La inicialización del cliente tardó demasiado tiempo. Esto puede deberse a problemas de red o con Chrome. Intente nuevamente.";
            shouldRetry = true;
        } else if (error.message.includes('net::ERR_PROXY_CONNECTION_FAILED') || error.message.includes('net::ERR_TUNNEL_CONNECTION_FAILED')) {
            userFriendlyMessage = "Error de conexión de red. Verifique su conexión a internet y configuración de proxy.";
            shouldRetry = true;
        } else if (error.message.includes('net::ERR_INTERNET_DISCONNECTED')) {
            userFriendlyMessage = "Sin conexión a internet. Verifique su conexión de red.";
            shouldRetry = true;
        } else if (error.message.includes('Session creation failed')) {
            userFriendlyMessage = "Error creando sesión de WhatsApp. Puede que la sesión anterior esté corrupta.";
            shouldRetry = true;
        } else if (error.message.includes('Chrom')) {
            userFriendlyMessage = "Error con Chrome. Verifique que Chrome esté instalado correctamente y no esté siendo usado por otro programa.";
        }

        logger?.error(`${logPrefix}: Error classification - Should retry: ${shouldRetry}, User message: ${userFriendlyMessage}`);

        if (onAuthFailure) onAuthFailure(userFriendlyMessage);
        isClientInitializing = false;
        if (rejectClientReady) rejectClientReady(error);
        resolveClientReady = null;
        rejectClientReady = null;
    }
}

/**
 * Creates a deep copy of the campaign state for safe external use.
 * @returns {object} A copy of the current campaign state.
 */
function getCampaignStatus() {
    return JSON.parse(JSON.stringify({
        id: campaignState.id,
        status: campaignState.status,
        sent: campaignState.sentCount,
        total: campaignState.totalContacts,
        config: campaignState.config
    }));
}

/**
 * Updates the configuration of the currently active, paused campaign.
 * @param {object} newConfig - The new configuration object.
 */
function updateActiveCampaignConfig(newConfig) {
    if (campaignState.status !== 'paused') {
        console.warn(`whatsapp-logic: Update config ignored. Campaign status is not 'paused'. (State: ${campaignState.status})`);
        throw new Error('La configuración solo puede ser actualizada mientras la campaña está en pausa.');
    }
    console.log("whatsapp-logic: Updating campaign config.", newConfig);
    

    campaignState.config = newConfig;
    campaignState.sentCount = newConfig.currentIndex; // Sync sentCount with currentIndex
    notifyProgress(); // Notify UI of the change
    return getCampaignStatus(); // Return the updated state
}

/**
 * Notifies the UI/main process of the current campaign progress.
 */
function notifyProgress() {
    if (campaignState.progressCallback) {
        campaignState.progressCallback(getCampaignStatus());
    }
}

/**
 * Pauses the message sending process.
 * @param {string} campaignId - The ID of the campaign to pause.
 */
function pauseSending(campaignId) {
    if (campaignState.id !== campaignId || campaignState.status !== 'running') {
        console.warn(`whatsapp-logic: Pause ignored. Campaign ID mismatch or status is not 'running'. (State: ${campaignState.status})`);
        return;
    }
    console.log("whatsapp-logic: Pausing sending...");
    campaignState.status = 'paused'; // Set status directly to 'paused'
    setCountdownState('idle'); // Clear countdown when paused
}

/**
 * Resumes a paused message sending process.
 * @param {string} campaignId - The ID of the campaign to resume.
 */
function resumeSending(campaignId) {
    if (campaignState.id !== campaignId || campaignState.status !== 'paused') {
        console.warn(`whatsapp-logic: Resume ignored. Campaign ID mismatch or status is not 'paused'. (State: ${campaignState.status})`);
        return;
    }
    console.log("whatsapp-logic: Resuming sending...");
    

    // If the promise resolver is set, it means the loop is active and waiting.
    // This handles the "live" pause/resume case.
    if (campaignState.resumePromiseResolver) {
        campaignState.status = 'running';
        setCountdownState('sending'); // Set to sending when resumed
        notifyProgress();
        campaignState.resumePromiseResolver();
        campaignState.resumePromiseResolver = null;
    } else {
        // This handles resuming from a "cold start" where the app was restarted.
        // The sending loop is not running, so we need to start it.
        console.log("whatsapp-logic: No active sending loop found. Starting a new one from the persisted state.");

        // CRÍTICO: Validar que los callbacks estén presentes antes de reanudar
        // Después de un restart, los callbacks deberían haber sido rehidratados por restartSendingFromState()
        if (!campaignState.progressCallback) {
            console.warn("whatsapp-logic: WARNING - progressCallback is null during cold start resume!");
            logger?.warn("Resume Sending: progressCallback is null - this may cause UI update failures");
        }
        if (!campaignState.logCallback) {
            console.warn("whatsapp-logic: WARNING - logCallback is null during cold start resume!");
            logger?.warn("Resume Sending: logCallback is null - this may cause log message failures");
        }
        if (!campaignState.countdownCallback) {
            console.warn("whatsapp-logic: WARNING - countdownCallback is null during cold start resume!");
            logger?.warn("Resume Sending: countdownCallback is null - countdown updates will not work");
        }

        // The startSending function will handle setting the status to 'running'
        startSending(
            campaignState.config,
            campaignState.progressCallback,
            campaignState.logCallback,
            campaignState.config.currentIndex, // Use the single source of truth
            campaignState.id,
            campaignState.countdownCallback // Pass countdown callback
        );
    }
}

/**
 * Stops the message sending process completely.
 * @param {string} campaignId - The ID of the campaign to stop.
 * @param {string} reason - The reason for stopping.
 */
function stopSending(campaignId, reason = 'user_request') {
    if (campaignState.id !== campaignId || ['stopped', 'finished', 'inactive'].includes(campaignState.status)) {
        console.warn(`whatsapp-logic: Stop ignored. Campaign ID mismatch or process not active. (State: ${campaignState.status})`);
        return;
    }
    console.log(`whatsapp-logic: Stopping sending process due to ${reason}...
`);
    campaignState.status = 'stopping';
    if (campaignState.resumePromiseResolver) {
        campaignState.resumePromiseResolver();
        campaignState.resumePromiseResolver = null;
    }
    notifyProgress();
}

/**
 * Stops and resets the current campaign state.
 */
function clearCampaign() {
    console.log("whatsapp-logic: clearCampaign called.");
    // If a campaign is active (running, pausing, etc.), just stop it.
    if (campaignState.id && !['inactive', 'stopped', 'finished'].includes(campaignState.status)) {
        stopSending(campaignState.id, 'clear_campaign');
        console.log(`whatsapp-logic: Stop signal sent to campaign ${campaignState.id}. It will terminate shortly.`);
    }
    
    // Clear countdown state before resetting
    setCountdownState('idle');
    
    // Reset the state immediately, regardless of the previous state.
    campaignState = JSON.parse(JSON.stringify(initialCampaignState));
    console.log("whatsapp-logic: Campaign state has been reset to initial.");
    
    // We should still notify the UI in this case.
    // The progressCallback might be null if no campaign was ever started,
    // but main.js will return the fresh getCampaignStatus() anyway.
    notifyProgress();
}


/**
 * Delays execution for a given number of milliseconds.
 * @param {number} ms - The number of milliseconds to delay.
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Notifies countdown updates to the UI
 */
function notifyCountdown() {
    if (campaignState.countdownCallback) {
        campaignState.countdownCallback({
            ...campaignState.countdownState,
            campaignId: campaignState.id
        });
    }
}

/**
 * Sets the countdown state and notifies UI
 * @param {string} type - 'idle', 'sending', 'pausing'
 * @param {number} remainingTime - Time remaining in milliseconds
 * @param {number} totalTime - Total time in milliseconds
 */
function setCountdownState(type, remainingTime = 0, totalTime = 0) {
    campaignState.countdownState = {
        isActive: type !== 'idle',
        remainingTime: Math.max(0, remainingTime),
        totalTime: totalTime,
        type: type
    };
    notifyCountdown();
}

/**
 * A delay that can be interrupted by a 'stopping' campaign status and emits countdown updates.
 * @param {number} ms - The total milliseconds to wait.
 * @param {string} delayType - Type of delay: 'pause' or 'send'
 */
async function controlledDelay(ms, delayType = 'send') {
    const endTime = Date.now() + ms;
    const totalTime = ms;
    
    // Set initial countdown state
    if (delayType === 'pause') {
        setCountdownState('pausing', ms, totalTime);
    } else {
        setCountdownState('sending', ms, totalTime);
    }

    while (Date.now() < endTime) {
        if (campaignState.status === 'stopping' || campaignState.status === 'paused') {
            console.log(`controlledDelay: Signal '${campaignState.status}' received, aborting delay.`);
            setCountdownState('idle');
            return;
        }

        const remaining = endTime - Date.now();
        
        // Update countdown state every second
        if (delayType === 'pause') {
            setCountdownState('pausing', remaining, totalTime);
        } else {
            setCountdownState('sending', remaining, totalTime);
        }
        
        const waitTime = Math.min(remaining, 1000); // Check every second
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    
    // When delay finishes, set to sending state (except if it was a send delay)
    if (delayType === 'pause') {
        setCountdownState('sending');
    } else {
        setCountdownState('idle');
    }
}


/**
 * Generates a random time between a minimum and maximum value.
 * @param {number} min - Minimum time in milliseconds.
 * @param {number} max - Maximum time in milliseconds.
 * @returns {number} Random time in milliseconds.
 */
function tiempoAleatorio(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Formats milliseconds into a human-readable string (e.g., "1h 30m 15s").
 * @param {number} ms - Time in milliseconds.
 * @returns {string} Formatted time string.
 */
function formatearTiempo(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const s = seconds % 60;
    const m = minutes % 60;
    const h = hours % 24;

    let parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);

    return parts.join(' ');
}

/**
 * Procesa variables del mensaje con los datos del contacto.
 * @param {string} messageTemplate - Plantilla del mensaje con variables como {nombre}, {telefono}, etc.
 * @param {object} contactData - Datos del contacto para reemplazar las variables.
 * @param {object} options - Opciones adicionales para el procesamiento.
 * @returns {string} Mensaje procesado con variables reemplazadas.
 */
function processMessageVariables(messageTemplate, contactData, options = {}) {
    const logPrefix = 'Message Variable Processing';

    try {
        if (!messageTemplate || typeof messageTemplate !== 'string') {
            logger?.warn(`${logPrefix}: Plantilla de mensaje inválida`);
            return messageTemplate || '';
        }

        if (!contactData || typeof contactData !== 'object') {
            logger?.warn(`${logPrefix}: Datos de contacto inválidos`);
            return messageTemplate;
        }

        // Crear una copia segura de los datos del contacto
        const safeContactData = { ...contactData };

        // Función para reemplazar variables en el mensaje
        // Soporta ambos formatos: {variable} y {{variable}}
        const processedMessage = messageTemplate.replace(/{{?(\w+)}?}/g, (match, key) => {
            const value = safeContactData[key];

            if (value === undefined || value === null) {
                logger?.warn(`${logPrefix}: Variable '${key}' no encontrada en datos del contacto`);
                console.log(`${logPrefix}: DEBUG - Variables disponibles en contacto:`, Object.keys(safeContactData));
                return ''; // Reemplazar con cadena vacía si no se encuentra la variable
            }

            // Convertir a string y limpiar espacios
            const stringValue = String(value).trim();

            logger?.info(`${logPrefix}: Variable '${key}' reemplazada: '${match}' -> '${stringValue}'`);
            return stringValue;
        });

        // Log del procesamiento exitoso
        logger?.info(`${logPrefix}: Mensaje procesado exitosamente. Variables reemplazadas: ${messageTemplate !== processedMessage ? 'Sí' : 'No'}`);

        return processedMessage;

    } catch (error) {
        logger?.error(`${logPrefix}: Error procesando variables del mensaje: ${error.message}`);
        console.error('Error procesando variables del mensaje:', error);

        // En caso de error, devolver el mensaje original
        return messageTemplate;
    }
}

/**
 * Envía notificaciones a números supervisores cuando inicia una nueva campaña.
 * @param {object} campaignConfig - Configuración de la campaña.
 * @param {Array} contacts - Lista de contactos de la campaña.
 * @param {function} logCallback - Función de callback para logging.
 * @returns {Promise<boolean>} True si las notificaciones se enviaron exitosamente, false en caso contrario.
 */
async function sendCampaignStartNotification(campaignConfig, contacts, logCallback) {
    const logPrefix = 'Campaign Start Notification';

    try {
        // Validar parámetros de entrada
        if (!campaignConfig || typeof campaignConfig !== 'object') {
            logger?.error(`${logPrefix}: Configuración de campaña inválida`);
            return false;
        }

        if (!Array.isArray(contacts) || contacts.length === 0) {
            logger?.error(`${logPrefix}: Lista de contactos inválida o vacía`);
            return false;
        }

        const { supervisorNumbers, message } = campaignConfig;

        // Verificar que hay números supervisores definidos
        if (!supervisorNumbers || !Array.isArray(supervisorNumbers) || supervisorNumbers.length === 0) {
            logger?.info(`${logPrefix}: No hay números supervisores definidos, omitiendo notificaciones`);
            if (logCallback) logCallback('whatsapp-logic: No hay números supervisores definidos para notificaciones');
            return true; // No es un error, solo no hay supervisores
        }

        // Encontrar el primer contacto válido
        let firstValidContact = null;
        let firstValidContactIndex = -1;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const numeroKey = Object.keys(contact).find(key => key.toLowerCase() === 'numero');
            const numero = numeroKey ? contact[numeroKey] : null;

            if (numero && numero.toString().length > 6) {
                firstValidContact = contact;
                firstValidContactIndex = i;
                break;
            }
        }

        if (!firstValidContact) {
            logger?.warn(`${logPrefix}: No se encontró ningún contacto válido para el ejemplo`);
            if (logCallback) logCallback('whatsapp-logic: No se encontró contacto válido para notificación de inicio');
            return false;
        }

        // Crear mensaje de notificación usando el primer contacto como ejemplo
        const notificationTemplate = `🚀 *NUEVA CAMPAÑA INICIADA*

📊 *Información de la campaña:*
• Total de contactos: {totalContacts}
• Mensaje de campaña: {campaignMessagePreview}

⏰ *Inicio:* {startTime}
🆔 *ID de campaña:* {campaignId}`;

        // Procesar el mensaje con el primer contacto válido para mostrar ejemplo correcto
        let processedMessagePreview = 'Sin mensaje';
        if (message && firstValidContact) {
            processedMessagePreview = processMessageVariables(message, firstValidContact);
            if (processedMessagePreview.length > 100) {
                processedMessagePreview = processedMessagePreview.substring(0, 100) + '...';
            }
        } else if (message) {
            processedMessagePreview = (message.length > 100) ? message.substring(0, 100) + '...' : message;
        }

        // Preparar datos para el template
        const templateData = {
            totalContacts: contacts.length,
            campaignMessagePreview: processedMessagePreview,
            startTime: new Date().toLocaleString('es-GT', {
                timeZone: 'America/Guatemala',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }),
            campaignId: `campaign-${Date.now()}`
        };

        // Debug: Log de los datos del template antes del procesamiento
        console.log(`whatsapp-logic: DEBUG - Datos del template para notificación:`, JSON.stringify(templateData, null, 2));
        console.log(`whatsapp-logic: DEBUG - Plantilla de notificación antes del procesamiento:`, notificationTemplate);

        // Procesar el mensaje con los datos del primer contacto
        const processedNotification = processMessageVariables(notificationTemplate, templateData);

        // Debug: Log del mensaje procesado para notificación
        console.log(`whatsapp-logic: DEBUG - Mensaje de notificación procesado:`, processedNotification);

        // Enviar notificación a todos los supervisores
        let successCount = 0;
        const errors = [];

        logger?.info(`${logPrefix}: Enviando notificaciones de inicio a ${supervisorNumbers.length} supervisores`);

        for (const supervisorNumber of supervisorNumbers) {
            try {
                // Validar número de supervisor
                if (!supervisorNumber || typeof supervisorNumber !== 'string') {
                    logger?.warn(`${logPrefix}: Número de supervisor inválido: ${supervisorNumber}`);
                    continue;
                }

                const chatId = `${supervisorNumber}@c.us`;

                // Verificar que el cliente esté listo
                if (!client || !client.info) {
                    throw new Error('Cliente de WhatsApp no está listo');
                }

                // CORRECCIÓN: Usar operaciones seguras para envío de notificaciones
                await safeRetryOperation(
                    async () => await sendMessageWithRetries(chatId, processedNotification, null, 3, 30000),
                    3,
                    2000,
                    `notification-${supervisorNumber}`
                );

                successCount++;
                logger?.info(`${logPrefix}: Notificación enviada exitosamente a supervisor ${supervisorNumber}`);

            } catch (error) {
                const errorMsg = `Error enviando notificación a supervisor ${supervisorNumber}: ${error.message}`;
                logger?.error(`${logPrefix}: ${errorMsg}`);
                errors.push(errorMsg);
            }
        }

        // Log del resultado final
        if (successCount === supervisorNumbers.length) {
            logger?.info(`${logPrefix}: Todas las notificaciones de inicio enviadas exitosamente (${successCount}/${supervisorNumbers.length})`);
            if (logCallback) logCallback(`whatsapp-logic: Notificaciones de inicio enviadas a ${successCount} supervisores`);
            return true;
        } else {
            logger?.warn(`${logPrefix}: Algunas notificaciones fallaron (${successCount}/${supervisorNumbers.length} exitosas)`);
            if (logCallback) logCallback(`whatsapp-logic: ${successCount}/${supervisorNumbers.length} notificaciones de inicio enviadas exitosamente`);
            return false;
        }

    } catch (error) {
        logger?.error(`${logPrefix}: Error crítico enviando notificaciones de inicio: ${error.message}`);
        console.error('Error crítico enviando notificaciones de inicio:', error);
        if (logCallback) logCallback(`whatsapp-logic: Error crítico enviando notificaciones de inicio: ${error.message}`);
        return false;
    }
}

/**
 * Sends a message with retry logic and exponential backoff.
 * MEJORA: Implementación simplificada sin doble timeout wrapping.
 * Timeout total máximo: ~90s (30s + 45s + 60s para 3 intentos) vs 180s anterior.
 * @param {string} chatId - The chat ID to send the message to.
 * @param {string} message - The message text.
 * @param {MessageMedia} media - Optional media to send.
 * @param {number} maxRetries - Maximum number of retries.
 * @param {number} initialTimeout - Initial timeout for first attempt in milliseconds.
 */
async function sendMessageWithRetries(chatId, message, media = null, maxRetries = 3, initialTimeout = 30000) {
    const logPrefix = `Send Message (${chatId.substring(0, 15)}...)`;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Calcular timeout con exponential backoff: 30s, 45s, 60s
            const timeout = Math.floor(initialTimeout * (1 + (attempt - 1) * 0.5));

            logger?.info(`${logPrefix}: Intento ${attempt}/${maxRetries} con timeout de ${timeout}ms`);

            const sendPromise = media
                ? client.sendMessage(chatId, media, { caption: message })
                : client.sendMessage(chatId, message);

            // Promise.race con timeout - una sola capa de timeout
            const result = await Promise.race([
                sendPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Message send timeout after ${timeout}ms`)), timeout)
                )
            ]);

            if (attempt > 1) {
                logger?.info(`${logPrefix}: Mensaje enviado exitosamente después de ${attempt} intentos`);
            }

            return true; // Message sent successfully

        } catch (error) {
            lastError = error;
            logger?.warn(`${logPrefix}: Intento ${attempt}/${maxRetries} falló: ${error.message}`);

            // Si no es el último intento, esperar con exponential backoff
            if (attempt < maxRetries) {
                const delayTime = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
                logger?.info(`${logPrefix}: Esperando ${delayTime}ms antes del siguiente intento`);
                await delay(delayTime);
            }
        }
    }

    // Todos los intentos fallaron
    const errorMsg = `Failed to send message after ${maxRetries} attempts: ${lastError.message}`;
    logger?.error(`${logPrefix}: ${errorMsg}`);
    throw new Error(errorMsg);
}

/**
 * Restarts the sending process from a persisted campaign state.
 * @param {object} persistedCampaign - The campaign object from the store.
 * @param {function} callbackProgress - Callback to report progress.
 * @param {function} logCallback - Callback to report log messages.
 * @param {function} countdownCallback - Callback to report countdown updates.
 */
function restartSendingFromState(persistedCampaign, callbackProgress, logCallback, countdownCallback = null) {
    console.log("whatsapp-logic: Restarting sending process from persisted state.");
    
    // Hydrate the state from the persisted object
    campaignState.id = persistedCampaign.id || `campaign-${Date.now()}`;
    campaignState.status = 'paused'; // Always start in a paused state when resuming
    campaignState.config = persistedCampaign.config;
    // Robustly set currentIndex from the single source of truth in config, with fallbacks for older state formats.
    campaignState.config.currentIndex = persistedCampaign.config.currentIndex || persistedCampaign.currentIndex || 0;
    campaignState.sentCount = persistedCampaign.sent || 0;
    campaignState.totalContacts = persistedCampaign.total || 0; // Restore total contacts for UI display
    campaignState.progressCallback = callbackProgress;
    campaignState.logCallback = logCallback; // Store logCallback
    campaignState.countdownCallback = countdownCallback; // Store countdownCallback

    // Initialize countdown state for restored campaign
    setCountdownState('idle');

    console.log("whatsapp-logic: Campaign state restored - Total contacts:", campaignState.totalContacts, "Current index:", campaignState.config.currentIndex);

    // Immediately notify the UI of the restored state
    notifyProgress();

    // Do NOT start the sending process automatically.
    // The user will explicitly click "Reanudar" to start it.
    // The UI will reflect the 'paused' state, enabling the 'Reanudar' button.
}


/**
 * Starts or resumes sending messages based on the provided configuration.
 * @param {object} config - Configuration for sending messages.
 * @param {function} callbackProgress - Callback to report progress.
 * @param {function} logCallback - Callback to report log messages.
 * @param {number} initialStartIndex - The index to start sending from (for resuming).
 * @param {string|null} campaignId - The ID of the campaign if it's being resumed.
 * @param {function} countdownCallback - Callback to report countdown updates.
 */
async function startSending(config, callbackProgress, logCallback, initialStartIndex = 0, campaignId = null, countdownCallback = null) {
    // Robust guard: Prevent starting a new campaign if any campaign is in an active state.
    // A resumed campaign (which has a campaignId) is allowed to proceed.
    if (!campaignId && ['running', 'pausing', 'stopping'].includes(campaignState.status)) {
        const message = `whatsapp-logic: startSending called for a new campaign while another is active (status: ${campaignState.status}). Aborting.`;
        console.warn(message);
        if (logCallback) {
            logCallback(`Error: No se puede iniciar una nueva campaña hasta que la actual se detenga por completo (estado: ${campaignState.status}).`);
        }
        return;
    }

    // --- Initialize State for a new campaign ---
    if (!campaignId) {
        campaignState.id = `campaign-${Date.now()}`;
        campaignState.status = 'running';
        campaignState.config = config;
        campaignState.progressCallback = callbackProgress;
        campaignState.logCallback = logCallback; // Store logCallback
        campaignState.countdownCallback = countdownCallback; // Store countdownCallback
        campaignState.config.currentIndex = initialStartIndex > 0 ? initialStartIndex : (config.currentIndex > 0 ? config.currentIndex : 0);
        campaignState.sentCount = 0; // Reset for new campaign
        campaignState.contacts = []; // Reset contacts for a new campaign
        campaignState.totalContacts = 0;
        // Initialize countdown state
        setCountdownState('sending');
    }
    // --- Or link to an existing, resumed campaign ---
    else {
        campaignState.id = campaignId;
        campaignState.status = 'running'; // Set to running to start the loop

        // CRÍTICO: Actualizar TODOS los callbacks si se pasan como parámetros
        // Esto es necesario para manejar el caso donde se reanuda después de restart
        if (callbackProgress) {
            campaignState.progressCallback = callbackProgress;
        }
        if (logCallback) {
            campaignState.logCallback = logCallback;
        }
        if (countdownCallback) {
            campaignState.countdownCallback = countdownCallback;
        }

        setCountdownState('sending');
    }
    
    notifyProgress();

    console.log(`whatsapp-logic: startSending initiated for campaign ${campaignState.id}.`);
    console.log("whatsapp-logic: Current config:", campaignState.config);

    try {
        console.log("whatsapp-logic: Waiting for client to be ready...");
        await waitForClientReady();
        console.log("whatsapp-logic: Client is ready. Proceeding with sending.");

        if (campaignState.contacts.length === 0) {
            // We only need excelPath here to load contacts initially.
            const { excelPath } = campaignState.config;
            console.log("whatsapp-logic: Reading Excel file:", excelPath);
            if (logCallback) logCallback(`whatsapp-logic: Loading contacts from Excel file: ${excelPath}`);

            try {
                // CORRECCIÓN: Usar función segura para leer archivos Excel
                campaignState.contacts = await safeReadExcelFile(excelPath, 3);
                campaignState.totalContacts = campaignState.contacts.length;
                console.log(`whatsapp-logic: Data loaded from Excel:`, campaignState.totalContacts, "rows.");
                if (logCallback) logCallback(`whatsapp-logic: Loaded ${campaignState.totalContacts} contacts from Excel file`);
            } catch (excelError) {
                logger?.error(`Excel Read Error: ${excelError.message}`);
                console.error("whatsapp-logic: Error reading Excel file:", excelError.message);
                if (logCallback) logCallback(`whatsapp-logic: Error reading Excel file: ${excelError.message}`);
                throw excelError;
            }
        }

        notifyProgress(); // Initial progress update

        // --- Campaign Start Notifications ---
        // Send notifications to supervisors when starting a new campaign
        if (!campaignId) {
            // Only send notifications for new campaigns, not resumed ones
            logger?.info(`Campaign Start: Sending notifications to supervisors for new campaign ${campaignState.id}`);
            console.log("whatsapp-logic: Sending campaign start notifications to supervisors...");

            try {
                const notificationSuccess = await sendCampaignStartNotification(campaignState.config, campaignState.contacts, logCallback);

                if (notificationSuccess) {
                    logger?.info(`Campaign Start: Supervisor notifications sent successfully`);
                    console.log("whatsapp-logic: Campaign start notifications sent successfully");
                } else {
                    logger?.warn(`Campaign Start: Some supervisor notifications failed`);
                    console.log("whatsapp-logic: Some campaign start notifications failed");
                }
            } catch (notificationError) {
                logger?.error(`Campaign Start: Critical error sending supervisor notifications: ${notificationError.message}`);
                console.error("whatsapp-logic: Critical error sending campaign start notifications:", notificationError.message);
                if (logCallback) logCallback(`whatsapp-logic: Error enviando notificaciones de inicio: ${notificationError.message}`);
            }
        } else {
            logger?.info(`Campaign Start: Skipping notifications for resumed campaign ${campaignId}`);
            console.log("whatsapp-logic: Skipping notifications for resumed campaign");
        }

        if (logCallback) logCallback(`whatsapp-logic: Starting message sending loop from index ${campaignState.config.currentIndex} to ${campaignState.totalContacts - 1}`);

        for (let i = campaignState.config.currentIndex; i < campaignState.totalContacts; i++) {
            campaignState.config.currentIndex = i;

            // --- Handle Pausing ---
            if (campaignState.status === 'paused') {
                console.log("whatsapp-logic: Sending paused. Waiting for resume...");
                // Status is already 'paused', so we just need to wait for the resume signal.
                notifyProgress(); // Notify again in case the UI missed the first one
                await new Promise(resolve => {
                    campaignState.resumePromiseResolver = resolve;
                });
                console.log("whatsapp-logic: Sending resumed.");

                // After resuming, config (especially currentIndex) might have been updated from the UI.
                // We must reset the loop's counter 'i' to match the authoritative state.
                // We subtract 1 because the for-loop's incrementor (i++) will run immediately after 'continue'.
                i = campaignState.config.currentIndex - 1;
                continue;
            }

            // --- Handle Stopping ---
            if (campaignState.status === 'stopping') {
                console.log("whatsapp-logic: Sending process was stopped. Exiting loop.");
                break;
            }

            // Re-read config on each iteration to get latest values after a pause.
            const {
                message, mediaPath, messageType, pausaCada,
                pausaMinima, pausaMaxima, sendDelay, maxRetries, timeout, supervisorNumbers, currentIndex
            } = campaignState.config;

            const dato = campaignState.contacts[currentIndex];
            const numeroKey = Object.keys(dato).find(key => key.toLowerCase() === 'numero');
            const numero = numeroKey ? dato[numeroKey] : undefined;

            if (numero && numero.toString().length > 6) {
                // Apply country code if selected
                const { countryCode } = campaignState.config;
                const fullNumber = countryCode && countryCode.trim() !== '' ? `${countryCode}${numero}` : numero;
                const chatId = (`+${fullNumber}@c.us`).substring(1);

                try {
                    const sendStartTime = Date.now();

                    // CORRECCIÓN: Usar operaciones seguras para cargar medios
                    let media = null;
                    if (mediaPath) {
                        try {
                            media = await safeRetryOperation(
                                async () => MessageMedia.fromFilePath(mediaPath),
                                3,
                                1000,
                                'load-media'
                            );
                        } catch (mediaError) {
                            logger?.error(`Media Load Error: ${mediaError.message}`);
                            console.error("whatsapp-logic: Error loading media:", mediaError.message);
                            if (logCallback) logCallback(`whatsapp-logic: Error loading media: ${mediaError.message}`);
                            throw mediaError;
                        }
                    }

                    // Debug: Log del contacto actual y mensaje antes del procesamiento
                    console.log(`whatsapp-logic: DEBUG - Contacto actual (index ${currentIndex}):`, JSON.stringify(dato, null, 2));
                    console.log(`whatsapp-logic: DEBUG - Mensaje original:`, message);

                    // Usar la función processMessageVariables para reemplazar correctamente las variables
                    let processedMessage = processMessageVariables(message, dato);

                    console.log(`whatsapp-logic: DEBUG - Mensaje procesado:`, processedMessage);

                    logger?.info(`Message Send: Attempting to send message to ${numero} (index ${currentIndex})`);

                    if (messageType == 1) { // Text only
                        await sendMessageWithRetries(chatId, processedMessage, null, maxRetries, timeout);
                    } else if (messageType == 2) { // Media message
                        await sendMessageWithRetries(chatId, processedMessage, media, maxRetries, timeout);
                    }

                    logger?.info(`Message Send: Successfully sent message to ${numero} in ${Date.now() - sendStartTime}ms`);
                    
                    logCallback(`[${currentIndex + 1}] - Mensaje a contacto ${numero} enviado`);
                    campaignState.sentCount++;
                    campaignState.config.currentIndex++; // Move to next index
                    notifyProgress();

                } catch (sendError) {
                    const errorTime = new Date().toISOString();
                    logger?.error(`Message Send: Failed to send message to ${numero} at ${errorTime}: ${sendError.message}`);
                    logger?.error(`Message Send: Error type: ${sendError.constructor.name}, Stack: ${sendError.stack}`);
                    console.error(`whatsapp-logic: Failed to send message to ${numero}:`, sendError.message);

                    // Enhanced error classification
                    if (sendError.message.includes('timeout')) {
                        logger?.error(`Message Send: Network timeout detected for ${numero}`);
                    } else if (sendError.message.includes('chat not found') || sendError.message.includes('not a participant')) {
                        logger?.error(`Message Send: Invalid chat/contact detected for ${numero}`);
                    } else if (sendError.message.includes('rate limit') || sendError.message.includes('too many requests')) {
                        logger?.error(`Message Send: Rate limit detected for ${numero}`);
                    }

                    if (supervisorNumbers && supervisorNumbers.length > 0) {
                        for (const supNum of supervisorNumbers) {
                            try {
                                // CORRECCIÓN: Usar operaciones seguras para envío de mensajes de error
                                await safeRetryOperation(
                                    async () => await client.sendMessage(`${supNum}@c.us`, `⚠️ Error al enviar mensaje a ${numero}: ${sendError.message}`),
                                    3,
                                    2000,
                                    `error-notification-${supNum}`
                                );
                            } catch (errorNotificationError) {
                                logger?.error(`Error Notification Send Error: ${errorNotificationError.message}`);
                            }
                        }
                    }
                }

                // --- Handle scheduled pause ---
                // Skip pause if this is the last message
                const isLastMessage = (i === campaignState.totalContacts - 1);
                if (campaignState.sentCount > 0 && campaignState.sentCount % pausaCada === 0 && !isLastMessage) {
                    const tiempoPausa = tiempoAleatorio(pausaMinima * 60000, pausaMaxima * 60000);
                    const tiempoFormateado = formatearTiempo(tiempoPausa);
                    const pauseMessage = `- 🔔 PAUSA AUTOMÁTICA: ${tiempoFormateado} | Enviados: ${campaignState.sentCount}`;
                    logCallback(`[${campaignState.config.currentIndex}] ${pauseMessage}`);
                    // Subtract 2 seconds from pause time as requested
                    const adjustedPauseTime = Math.max(2000, tiempoPausa - 2000);
                    await controlledDelay(adjustedPauseTime, 'pause'); // USE CONTROLLED DELAY with pause type
                    if (campaignState.status !== 'stopping') {
                        // Set to sending state after pause
                        setCountdownState('sending');
                    }
                } else if (!isLastMessage) {
                    // Apply send delay only if not doing a long pause and not the last message
                    await controlledDelay(sendDelay * 1000, 'send'); // USE CONTROLLED DELAY with send type
                }

            } else {
                console.log(`El contacto ${numero} es invalido, no se le envió mensaje`);
                if (logCallback) logCallback(`whatsapp-logic: Skipped invalid contact at index ${i}: ${numero}`);
                campaignState.config.currentIndex = i + 1; // Skip invalid contact
                notifyProgress();
            }
        } // --- End of loop ---

        if (campaignState.status !== 'stopping') {
            campaignState.status = 'finished';
            if (logCallback) logCallback(`whatsapp-logic: Campaign finished successfully. Total messages sent: ${campaignState.config.currentIndex}`);

            // Re-read config to get supervisorNumbers for final notification
            const {
                message, mediaPath, messageType, pausaCada,
                pausaMinima, pausaMaxima, sendDelay, maxRetries, timeout, supervisorNumbers, currentIndex
            } = campaignState.config;

            const finalMessage = `🏁 CAMPAÑA FINALIZADA

📊 Total de mensajes enviados: ${campaignState.config.currentIndex}`;
            if (supervisorNumbers && supervisorNumbers.length > 0) {
                for (const supNum of supervisorNumbers) {
                    try {
                        // CORRECCIÓN: Usar operaciones seguras para envío de mensajes finales
                        await safeRetryOperation(
                            async () => await client.sendMessage(`${supNum}@c.us`, finalMessage),
                            3,
                            2000,
                            `final-notification-${supNum}`
                        );
                    } catch (finalError) {
                        logger?.error(`Final Notification Error: ${finalError.message}`);
                    }
                }
            }

        }

    } catch (error) {
        console.error("whatsapp-logic: CRITICAL Error during message sending:", error.message, error.stack);
        if (logCallback) logCallback(`whatsapp-logic: CRITICAL ERROR during sending: ${error.message}`);
        campaignState.status = 'stopped'; // Mark as stopped on critical error
    } finally {
        if (campaignState.status !== 'paused') {
            campaignState.status = campaignState.status === 'stopping' ? 'stopped' : 'finished';
        }
        console.log(`whatsapp-logic: Sending process has finished with status: ${campaignState.status}.`);
        notifyProgress();
    }
}


/**
 * Waits for the WhatsApp client to be ready.
 * @returns {Promise<void>} A promise that resolves when the client is ready.
 */
async function waitForClientReady() {
    if (client && client.info) { // Check if client is already initialized and has info (implies ready)
        console.log("whatsapp-logic: Client is already ready (checked by waitForClientReady).");
        return Promise.resolve();
    }
    console.log("whatsapp-logic: Client not yet ready. Waiting for 'ready' event...");
    if (!clientReadyPromise) {
                clientReadyPromise = new Promise(resolve => {
            resolveClientReady = resolve;
        });
    }
    return clientReadyPromise;
}



/**
 * Maneja la reconexión automática con bloqueo de reintentos para prevenir operaciones simultáneas
 */
async function handleReconnection(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir, reason) {
    const logPrefix = 'Reconnection Handler';

    // CORRECCIÓN: Bloqueo de reintentos para prevenir operaciones simultáneas
    if (isReconnecting) {
        logger?.warn(`${logPrefix}: Reconexión ya en progreso, ignorando intento adicional`);
        console.log('whatsapp-logic: Reconexión ya en progreso, ignorando intento adicional');
        return;
    }

    isReconnecting = true;

    try {
        reconnectAttempts++;
        logger?.info(`${logPrefix}: Intento de reconexión ${reconnectAttempts}/${maxReconnectAttempts} para razón: ${reason}`);

        if (reconnectAttempts > maxReconnectAttempts) {
            logger?.error(`${logPrefix}: Máximo número de intentos de reconexión alcanzado (${maxReconnectAttempts})`);
            console.log(`whatsapp-logic: Máximo número de intentos de reconexión alcanzado (${maxReconnectAttempts})`);

            if (typeof logCallback === 'function') {
                logCallback('whatsapp-logic: Reconexión fallida después de múltiples intentos - requiere intervención manual');
            }

            // Reset reconnection state
            isReconnecting = false;
            reconnectAttempts = 0;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            return;
        }

        // Calcular delay progresivo para reintentos
        const currentDelay = reconnectDelay * Math.pow(1.5, reconnectAttempts - 1);

        if (typeof logCallback === 'function') {
            logCallback(`whatsapp-logic: Intentando reconexión ${reconnectAttempts}/${maxReconnectAttempts} en ${Math.round(currentDelay/1000)}s`);
        }

        // CORRECCIÓN: Mejorar flujo de desconexión para evitar estados de carrera
        logger?.info(`${logPrefix}: Esperando ${currentDelay}ms antes del intento de reconexión`);
        await delay(currentDelay);

        // Verificar si aún necesitamos reconectar (el usuario podría haber detenido el proceso)
        if (campaignState.status === 'stopping' || campaignState.status === 'stopped') {
            logger?.info(`${logPrefix}: Proceso detenido por usuario, cancelando reconexión`);
            return;
        }

        const reinitStartTime = Date.now();
        logger?.info(`${logPrefix}: Ejecutando softLogoutAndReinitialize...`);

        try {
            await softLogoutAndReinitialize(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir);
            logger?.info(`${logPrefix}: Reconexión exitosa en intento ${reconnectAttempts} después de ${Date.now() - reinitStartTime}ms`);

            if (typeof logCallback === 'function') {
                logCallback('whatsapp-logic: Reconexión exitosa - cliente restablecido');
            }

            // Reset reconnection state on success
            isReconnecting = false;
            reconnectAttempts = 0;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }

        } catch (reinitError) {
            logger?.error(`${logPrefix}: Error en intento de reconexión ${reconnectAttempts}: ${reinitError.message}`);

            if (typeof logCallback === 'function') {
                logCallback(`whatsapp-logic: Error en reconexión ${reconnectAttempts}/${maxReconnectAttempts}: ${reinitError.message}`);
            }

            // Si hay más intentos disponibles, programar el siguiente
            if (reconnectAttempts < maxReconnectAttempts) {
                logger?.info(`${logPrefix}: Programando siguiente intento de reconexión en ${reconnectDelay}ms`);
                reconnectTimeout = setTimeout(() => {
                    handleReconnection(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir, reason);
                }, reconnectDelay);
            } else {
                // No más intentos disponibles
                isReconnecting = false;
                if (reconnectTimeout) {
                    clearTimeout(reconnectTimeout);
                    reconnectTimeout = null;
                }
            }
        }

    } catch (error) {
        logger?.error(`${logPrefix}: Error crítico en manejo de reconexión: ${error.message}`);
        isReconnecting = false;
        reconnectAttempts = 0;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    }
}

/**
 * Logs out the client without clearing the session folder, then reinitializes.
 * This allows for potential automatic re-login if session files are valid.
 *
 * SOLUCIÓN EBUSY: Implementa estrategia específica para manejar errores EBUSY persistentes
 * durante logout cuando el usuario cierra sesión manualmente desde el teléfono.
 */
async function softLogoutAndReinitialize(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir = null) {
    const logPrefix = 'Soft Logout & Reinitialize (EBUSY Enhanced)';
    logger?.info(`${logPrefix}: softLogoutAndReinitialize called con estrategia mejorada para EBUSY.`);
    console.log("🔄 whatsapp-logic: softLogoutAndReinitialize called con manejo mejorado de EBUSY.");

    if (client) {
        try {
            logger?.info(`${logPrefix}: Intentando logout con wrapper específico para manejo de EBUSY...`);
            console.log("🚪 whatsapp-logic: Intentando logout con manejo específico de EBUSY...");

            // SOLUCIÓN EBUSY: Usar wrapper específico que maneja errores EBUSY agresivamente
            const logoutSuccess = await safeLogoutWithEBUSYHandling(client, 3);

            if (logoutSuccess) {
                logger?.info(`${logPrefix}: Logout exitoso usando wrapper EBUSY.`);
                console.log("✅ whatsapp-logic: Logout exitoso con manejo EBUSY.");
            } else {
                logger?.warn(`${logPrefix}: Logout falló incluso con wrapper EBUSY, continuando con limpieza alternativa...`);
                console.log("⚠️ whatsapp-logic: Logout falló, aplicando limpieza alternativa...");

                // SOLUCIÓN EBUSY: Si logout falla completamente, intentar limpieza alternativa agresiva
                try {
                    const sessionPath = client.options?.authStrategy?.dataPath || dataPath;
                    logger?.warn(`${logPrefix}: Aplicando limpieza alternativa agresiva en: ${sessionPath}`);

                    const cleanupSuccess = await aggressiveSessionCleanup(sessionPath, 2);

                    if (cleanupSuccess) {
                        logger?.info(`${logPrefix}: Limpieza alternativa exitosa.`);
                        console.log("🧹 whatsapp-logic: Limpieza alternativa completada.");
                    } else {
                        logger?.error(`${logPrefix}: Limpieza alternativa también falló.`);
                        console.log("❌ whatsapp-logic: Limpieza alternativa falló.");
                    }
                } catch (cleanupError) {
                    logger?.error(`${logPrefix}: Error durante limpieza alternativa: ${cleanupError.message}`);
                    console.error("❌ whatsapp-logic: Error en limpieza alternativa:", cleanupError.message);
                }
            }
        }
        catch (error) {
            logger?.error(`${logPrefix}: Error crítico durante proceso de logout mejorado: ${error.message}`);
            console.error("❌ whatsapp-logic: Error crítico durante logout mejorado:", error.message);

            // SOLUCIÓN EBUSY: Incluso en errores críticos, intentar limpieza alternativa
            try {
                const sessionPath = client.options?.authStrategy?.dataPath || dataPath;
                logger?.warn(`${logPrefix}: Aplicando limpieza de emergencia debido a error crítico...`);

                await aggressiveSessionCleanup(sessionPath, 1);
            } catch (emergencyError) {
                logger?.error(`${logPrefix}: Limpieza de emergencia también falló: ${emergencyError.message}`);
            }
        }
    }

    // Destruir instancia del cliente después del logout (mejorado o no)
    await destroyClientInstance();
    logger?.info(`${logPrefix}: Client instance destroyed después del proceso de logout mejorado.`);
    console.log("🧹 whatsapp-logic: Client instance destroyed después del logout mejorado.");

    // Reset the initialization flag to ensure clean re-initialization
    isClientInitializing = false;
    logger?.info(`${logPrefix}: Reset isClientInitializing to false before re-initialization`);
    console.log("🔄 whatsapp-logic: Reset isClientInitializing to false before re-initialization");

    // Now reinitialize the client with the same callbacks
    logger?.info(`${logPrefix}: Re-initializing client with callbacks...`);
    console.log("🚀 whatsapp-logic: Re-initializing client with callbacks...");
    await initializeClient(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir);
    logger?.info(`${logPrefix}: Client reinicializado después del proceso de logout mejorado.`);
    console.log("✅ whatsapp-logic: Client reinicializado después del logout mejorado.");
}

async function destroyClientInstance() {
    const logPrefix = 'Client Destroy';
    const destroyStartTime = Date.now();

    if (client) {
        logger?.info(`${logPrefix}: Attempting to destroy client instance...`);
        logger?.info(`${logPrefix}: Client info before destroy: ${JSON.stringify(client.info || {})}`);
        console.log("Attempting to destroy client instance...");

        // First, try graceful logout if client is ready
        if (client.info && typeof client.logout === 'function') {
            try {
                logger?.info(`${logPrefix}: Attempting graceful logout before destroy...`);
                await Promise.race([
                    client.logout(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Logout timeout')), 10000))
                ]);
                logger?.info(`${logPrefix}: Graceful logout successful`);
            } catch (logoutError) {
                logger?.warn(`${logPrefix}: Graceful logout failed, proceeding with force destroy: ${logoutError.message}`);
            }
        }

        // MEJORA: Cerrar browser ANTES de destruir cliente para evitar procesos zombie
        try {
            logger?.info(`${logPrefix}: Attempting to close browser before client destruction...`);

            // Intentar cerrar browser por múltiples métodos
            let browserClosed = false;

            // Método 1: puppeteerPage.browser
            if (client.puppeteerPage && client.puppeteerPage.browser) {
                try {
                    const browser = client.puppeteerPage.browser();
                    if (browser && typeof browser.close === 'function') {
                        await Promise.race([
                            browser.close(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 10000))
                        ]);
                        logger?.info(`${logPrefix}: Browser closed via puppeteerPage`);
                        browserClosed = true;
                    }
                } catch (e) {
                    logger?.warn(`${logPrefix}: Failed to close browser via puppeteerPage: ${e.message}`);
                }
            }

            // Método 2: pupBrowser
            if (!browserClosed && client.pupBrowser && typeof client.pupBrowser.close === 'function') {
                try {
                    await Promise.race([
                        client.pupBrowser.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 10000))
                    ]);
                    logger?.info(`${logPrefix}: Browser closed via pupBrowser`);
                    browserClosed = true;
                } catch (e) {
                    logger?.warn(`${logPrefix}: Failed to close browser via pupBrowser: ${e.message}`);
                }
            }

            if (!browserClosed) {
                logger?.warn(`${logPrefix}: Could not close browser through any method, proceeding with client destroy`);
            }

            // Pequeña pausa para que el browser termine de cerrar
            await delay(1000);
        } catch (browserCloseError) {
            logger?.warn(`${logPrefix}: Error during browser close: ${browserCloseError.message}`);
        }

        try {
        const destroyTimeoutMs = 60 * 1000; // 60 seconds (reducido de 120s ya que browser ya está cerrado)
            logger?.info(`${logPrefix}: Starting client.destroy() with ${destroyTimeoutMs/1000}s timeout`);

            // CORRECCIÓN: Usar operaciones seguras para destrucción del cliente
            await safeAsyncOperation(async () => {
                return await Promise.race([
                    client.destroy(),
                    new Promise((_, reject) => setTimeout(() => {
                        logger?.error(`${logPrefix}: Client destroy timed out after ${destroyTimeoutMs/1000}s`);
                        console.error("Client destroy timed out.");
                        reject(new Error('Client destroy timeout'));
                    }, destroyTimeoutMs))
                ]);
            }, destroyTimeoutMs, 'client-destroy');

            logger?.info(`${logPrefix}: Client instance destroyed successfully in ${Date.now() - destroyStartTime}ms`);
            console.log(`Client instance destroyed successfully in ${Date.now() - destroyStartTime}ms`);
        } catch (error) {
            logger?.error(`${logPrefix}: Error destroying client instance after ${Date.now() - destroyStartTime}ms: ${error.message}`);
            logger?.error(`${logPrefix}: Destroy error stack: ${error.stack}`);
            console.error("Error destroying client instance:", error.message);

            // Force cleanup even if destroy fails
            logger?.warn(`${logPrefix}: Forcing client reference cleanup despite destroy error`);
        } finally {
            // Always cleanup the reference
            client = null;
            logger?.info(`${logPrefix}: Client reference cleared`);
        }
    } else {
        logger?.info(`${logPrefix}: No active client instance to destroy`);
        console.log("No active client instance to destroy.");
    }
}

/**
 * Validates that the Chrome client process is completely closed
 */
async function validateClientClosure() {
    const logPrefix = 'Client Closure Validation';
    logger?.info(`${logPrefix}: Starting client closure validation`);

    try {
        // Check if client reference is cleared
        if (client !== null) {
            logger?.warn(`${logPrefix}: Client reference still exists, this may indicate improper cleanup`);
            return false;
        }

        // Additional validation could be added here for process checking
        // For now, we rely on the client reference being null

        logger?.info(`${logPrefix}: Client closure validation passed`);
        return true;
    } catch (error) {
        logger?.error(`${logPrefix}: Error during closure validation: ${error.message}`);
        return false;
    }
}

/**
 * Enhanced cleanup function that ensures complete client destruction before app exit
 */
async function performEmergencyCleanup(reason = 'emergency') {
    const logPrefix = 'Emergency Cleanup';
    logger?.info(`${logPrefix}: Starting emergency cleanup due to: ${reason}`);

    try {
        // Stop any ongoing campaigns immediately
        if (campaignState.status === 'running' || campaignState.status === 'pausing') {
            logger?.info(`${logPrefix}: Stopping active campaign due to emergency cleanup`);
            campaignState.status = 'stopped';
            if (campaignState.resumePromiseResolver) {
                campaignState.resumePromiseResolver();
                campaignState.resumePromiseResolver = null;
            }
        }

        // Force destroy client instance
        try {
            await safeRetryOperation(
                async () => await destroyClientInstance(),
                3,
                2000,
                'emergency-cleanup-destroy'
            );
        } catch (destroyError) {
            logger?.error(`${logPrefix}: Error durante destrucción de emergencia: ${destroyError.message}`);
        }

        // Validate closure
        const closureValidated = await validateClientClosure();

        if (closureValidated) {
            logger?.info(`${logPrefix}: Emergency cleanup completed successfully`);
        } else {
            logger?.warn(`${logPrefix}: Emergency cleanup completed with warnings`);
        }

        return closureValidated;
    } catch (error) {
        logger?.error(`${logPrefix}: Error during emergency cleanup: ${error.message}`);
        return false;
    }
}

/**
 * Logs out, destroys the client, and clears the session folder to allow for a new QR code.
 */
async function logoutAndClearSession(dataPath) {
    const logPrefix = 'Logout & Clear Session';
    logger?.info(`${logPrefix}: Starting logout and session clear process for path: ${dataPath}`);

    try {
        await destroyClientInstance(); // Use the enhanced helper function

        // Validate that client is properly closed
        const closureValidated = await validateClientClosure();
        if (!closureValidated) {
            logger?.warn(`${logPrefix}: Client closure validation failed, but continuing with session cleanup`);
        }

        // Add a small delay to ensure file handles are released
        logger?.info(`${logPrefix}: Waiting 2 seconds for file handles to be released...`);
        await delay(2000); // 2 seconds delay

        // After ensuring the client is destroyed, delete the session folder
        const sessionPath = dataPath;
        if (fs.existsSync(sessionPath)) {
            logger?.info(`${logPrefix}: Attempting to delete session folder: ${sessionPath}`);
            console.log(`Attempting to delete session folder: ${sessionPath}`);

            try {
                // CORRECCIÓN: Usar función segura para eliminar archivos
                await safeDeletePath(sessionPath, 3);
                logger?.info(`${logPrefix}: Session folder successfully deleted`);
                console.log("Session folder successfully deleted.");
            } catch (deleteError) {
                logger?.error(`${logPrefix}: Failed to delete session folder: ${deleteError.message}`);
                console.error(`Error deleting session folder: ${deleteError.message}`);
                throw new Error(`Failed to delete session folder. Please try deleting it manually. Path: ${dataPath}`);
            }
        } else {
            logger?.info(`${logPrefix}: Session folder not found, no deletion needed.`);
            console.log("Session folder not found, no deletion needed.");
        }

        logger?.info(`${logPrefix}: Logout and session clear process completed successfully`);
    } catch (error) {
        logger?.error(`${logPrefix}: Error during logout and session clear: ${error.message}`);
        console.error(`Error during logout and session clear: ${error.message}`);
        // This error should be propagated to the UI to inform the user.
        throw error;
    }
}

/**
 * Returns the current status of the WhatsApp client.
 * @returns {string} - 'initializing', 'ready', 'not_ready', or 'disconnected'.
 */
function getClientStatus() {
    console.log("🔍 whatsapp-logic: getClientStatus called");
    console.log("📊 whatsapp-logic: isClientInitializing:", isClientInitializing);
    console.log("📊 whatsapp-logic: client exists:", !!client);
    console.log("📊 whatsapp-logic: client.info exists:", !!(client && client.info));
    
    if (client && client.info) {
        console.log("✅ whatsapp-logic: Returning 'ready' status with phone:", client.info.wid.user);
        return { status: 'ready', phoneNumber: client.info.wid.user };
    }
    if (client && !isClientInitializing) {
        console.log("📱 whatsapp-logic: Client exists but not ready (QR pending) - Returning 'not_ready' status");
        return { status: 'not_ready' }; // Client exists but not ready (e.g., QR code pending)
    }
    if (isClientInitializing) {
        console.log("⏳ whatsapp-logic: Returning 'initializing' status");
        return { status: 'initializing' };
    }
    console.log("❌ whatsapp-logic: Returning 'disconnected' status");
    return { status: 'disconnected' };
}

module.exports = {
    initializeClient,
    startSending,
    pauseSending,
    resumeSending,
    stopSending,
    clearCampaign, // Export the new clear function
    restartSendingFromState,
    getCampaignStatus,
    updateActiveCampaignConfig,
    logoutAndClearSession,
    destroyClientInstance, // Export the enhanced helper function
    performEmergencyCleanup, // Export the new emergency cleanup function
    validateClientClosure, // Export the new closure validation function
    getExcelHeaders,
    getFirstExcelRow, // Export the new function
    getClientStatus, // Export the new function
    softLogoutAndReinitialize, // Export the new function
    setCountdownState, // Export countdown function
    notifyCountdown, // Export countdown notification function
    processMessageVariables, // Export message variable processing function
    sendCampaignStartNotification, // Export campaign start notification function
    // SOLUCIÓN EBUSY: Exportar nuevas funciones para manejo específico de errores EBUSY
    safeLogoutWithEBUSYHandling, // Wrapper específico para logout con manejo de EBUSY
    forceReleaseChromeProcesses, // Función para liberar procesos Chrome/Puppeteer
    aggressiveSessionCleanup, // Función de limpieza alternativa agresiva para casos extremos
    // Process monitoring functions for safe browser detection
    registerBotProcess,
    unregisterBotProcess,
    clearBotProcesses,
    monitorBotProcesses,
    startProcessMonitoring,
    stopProcessMonitoring
};

/**
 * Reads the Excel file and returns the first row of the "Datos Limpios" sheet as an object.
 * @param {string} excelPath - The absolute path to the Excel file.
 * @returns {Promise<object|null>} A promise that resolves with the first row data as an object, or null if not found.
 */
async function getFirstExcelRow(excelPath) {
    try {
        // CORRECCIÓN: Usar función segura para leer archivos Excel
        const datos = await safeReadExcelFile(excelPath, 3);

        if (datos.length > 0) {
            return datos[0]; // First row is the first object
        }
        return null;
    } catch (error) {
        console.error("whatsapp-logic: Error reading first Excel row:", error);
        throw error;
    }
}



/**
 * Reads the Excel file and returns the headers of the sheet with validation.
 * @param {string} excelPath - The absolute path to the Excel file.
 * @returns {Promise<object>} A promise that resolves with an object containing headers, validation status, and missing fields.
 */
async function getExcelHeaders(excelPath) {
    try {
        // CORRECCIÓN: Usar función segura para leer archivos Excel
        const datos = await safeReadExcelFile(excelPath, 3);

        if (datos.length > 0) {
           // Para obtener headers necesitamos leer como array de arrays
           const excel = XLSX.readFile(excelPath);
           const nombreHoja = excel.SheetNames[0];
           const sheet = excel.Sheets[nombreHoja];
           const datosArray = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Get data as array of arrays

           if (datosArray.length > 0) {
               const rawHeaders = datosArray[0]; // First row is the header

               // Check for required fields (case-insensitive)
               const hasItem = rawHeaders.some(header => header && header.toLowerCase() === 'item');
               const hasNumero = rawHeaders.some(header => header && header.toLowerCase() === 'numero');

               const missingFields = [];
               if (!hasItem) missingFields.push('item');
               if (!hasNumero) missingFields.push('numero');

               // Filter out the required fields for the returned headers (maintain existing functionality)
               const headers = rawHeaders.filter(header => header && header.toLowerCase() !== 'item' && header.toLowerCase() !== 'numero');

               return {
                   headers,
                   hasRequiredFields: missingFields.length === 0,
                   missingFields
               };
           }
        }
        return { headers: [], hasRequiredFields: false, missingFields: ['item', 'numero'] };
    } catch (error) {
        console.error("whatsapp-logic: Error reading Excel headers:", error);
        throw error;
    }
}
