console.log('Node.js version:', process.versions.node);
const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('url');
const url = require('url');
const fs = require('fs').promises;
const path = require('path');
const qrcode = require('qrcode');
const Store = require('electron-store').default;
const winston = require('winston');
const config = require('./config');
const whatsappLogic = require('../bot/whatsapp-logic');

let mainWindow;

// --- License Validation Helper Functions ---

// Función mejorada para validar y convertir fecha del servidor (maneja YYYY-MM-DD y YYYY-MM-DD HH:mm:ss)
function parseServerDate(dateString) {
    if (!dateString || typeof dateString !== 'string') {
        throw new Error('Fecha inválida del servidor');
    }
    
    // El servidor puede enviar fechas en formato "YYYY-MM-DD" o "YYYY-MM-DD HH:mm:ss"
    // Intentar ambos formatos
    let date;
    
    if (dateString.includes(' ')) {
        // Formato completo: "YYYY-MM-DD HH:mm:ss"
        date = new Date(dateString);
    } else {
        // Formato corto: "YYYY-MM-DD" - agregar tiempo por defecto
        date = new Date(dateString + 'T00:00:00.000Z');
    }
    
    if (isNaN(date.getTime())) {
        throw new Error('Formato de fecha inválido del servidor');
    }
    
    return date;
}

// Función mejorada para validar server_time (maneja timestamp Unix y string ISO 8601)
function validateServerTime(serverTimeValue) {
    if (serverTimeValue === null || serverTimeValue === undefined) {
        throw new Error('Server time inválido');
    }
    
    let serverDate;
    if (typeof serverTimeValue === 'number') {
        // Manejar timestamp Unix (segundos desde epoch)
        serverDate = new Date(serverTimeValue * 1000);
    } else if (typeof serverTimeValue === 'string') {
        // Manejar string ISO 8601
        serverDate = new Date(serverTimeValue);
    } else {
        throw new Error('Server time debe ser número (timestamp) o string ISO 8601');
    }
    
    if (isNaN(serverDate.getTime())) {
        throw new Error('Formato de server time inválido');
    }
    
    return serverDate.toISOString();
}

// Función para calcular días restantes de manera segura
function calculateDaysRemaining(endDate, currentDate = new Date()) {
    if (!(endDate instanceof Date) || isNaN(endDate.getTime())) {
        return null;
    }
    if (!(currentDate instanceof Date) || isNaN(currentDate.getTime())) {
        return null;
    }
    const timeDiff = endDate.getTime() - currentDate.getTime();
    return Math.max(0, Math.floor(timeDiff / (24 * 60 * 60 * 1000)));
}

// --- Single Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    // --- Centralized Logging ---
    function logToRenderer(...args) {
        const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
        let level = 'info';
        let messageArgs = args;

        if (args.length > 0 && typeof args[0] === 'string' && validLevels.includes(args[0])) {
            level = args.shift();
            messageArgs = args;
        }

        const message = messageArgs.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('log-message', message);
        }
        console.log(...messageArgs);
        logger.log(level, message);
    }

    // --- Electron Store Setup ---
    const store = new Store({
        name: 'campaign-data',
        defaults: {
            campaign: null // The entire campaign state object will be stored here
        }
    });

    const IMAGE_DIR = path.join(app.getPath('userData'), 'temp_images');
    const SESSION_PATH = path.join(app.getPath('userData'), 'session');
    const LOGS_DIR = path.join(app.getPath('userData'), 'logs');

    // --- Winston Logger Setup ---
    const logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} [${level.toUpperCase()}]: ${message}`;
            })
        ),
        transports: [
            new winston.transports.File({ filename: path.join(LOGS_DIR, 'app.log') }),
            new winston.transports.Console()
        ]
    });

    // --- Main Window Creation ---
    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 800,
            height: 600,
            autoHideMenuBar: true,
            icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true, // Ensure web security is enabled
                // Allow loading images from data URLs for QR codes
                contentSecurityPolicy: "default-src 'self' file:; script-src 'self' 'unsafe-inline' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' data: app:; media-src 'self' file: app:; frame-src 'self' file: app:;",
            },
        });

        if (app.isPackaged) {
            mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
        } else {
            mainWindow.loadURL('http://localhost:3000');
        }

        mainWindow.on('close', async (event) => {
            if (app.isQuitting) return;
            event.preventDefault();

            const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'question',
                buttons: ['Yes', 'No'],
                title: 'Confirmar salida',
                message: '¿Esta seguro que desea salir?',
            });

            if (response === 0) {
                const campaign = whatsappLogic.getCampaignStatus();
                if (campaign.id && campaign.status !== 'inactive') {
                    // Persist the final state before quitting
                    store.set('campaign', campaign);
                    logToRenderer('info', 'main.js: Persisted campaign state on exit.', campaign);
                }
                //await whatsappLogic.destroyClientInstance();
                app.isQuitting = true;
                app.quit();
            }
        });
    }

    // --- App Lifecycle Events ---
    app.whenReady().then(async () => {
        await fs.mkdir(IMAGE_DIR, { recursive: true });
        await fs.mkdir(LOGS_DIR, { recursive: true });
        createWindow();

        // --- Auto Updater Setup ---
        // Configure auto-updater with migration support
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        // Migration logic for Pixibot
        if (app.isPackaged && app.getName() === 'Pixibot') {
            const currentVersion = app.getVersion();
            const migrationVersion = '1.0.4';

            // Check if we need to migrate from old repository
            if (currentVersion < migrationVersion) {
                logToRenderer('info', '🔄 Migration: Updating repository configuration for Pixibot');

                // Set feed URL to new repository for migration
                autoUpdater.setFeedURL({
                    provider: 'github',
                    owner: 'GerDaBri',
                    repo: 'Pixibot-Releases',
                    releaseType: 'release'
                });

                logToRenderer('info', '✅ Migration: Now using Pixibot-Releases repository');
            } else {
                // Use standard configuration for new installations
                logToRenderer('info', '✅ Using standard Pixibot-Releases repository');
            }
        }
        
        autoUpdater.on('checking-for-update', () => {
            logToRenderer('info', '🔍 Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            logToRenderer('info', '✅ Update available:', info.version);
            if (mainWindow) {
                mainWindow.webContents.send('update-available', info);
            }
        });

        autoUpdater.on('update-not-available', (info) => {
            logToRenderer('info', 'ℹ️ Update not available. Current version:', info.version);
        });

        autoUpdater.on('error', (err) => {
            logToRenderer('error', '❌ Error in auto-updater:', err.message);
            if (mainWindow) {
                mainWindow.webContents.send('update-error', err.message);
            }
        });

        autoUpdater.on('download-progress', (progressObj) => {
            const percent = Math.round(progressObj.percent);
            const speed = Math.round(progressObj.bytesPerSecond / 1024);
            let log_message = `📥 Downloading update: ${percent}% (${speed} KB/s)`;
            log_message += ` - ${Math.round(progressObj.transferred / 1024 / 1024)}MB / ${Math.round(progressObj.total / 1024 / 1024)}MB`;
            logToRenderer('info', log_message);
            
            if (mainWindow) {
                mainWindow.webContents.send('download-progress', {
                    percent,
                    speed,
                    transferred: progressObj.transferred,
                    total: progressObj.total
                });
            }
        });

        autoUpdater.on('update-downloaded', (info) => {
            logToRenderer('info', '✅ Update downloaded successfully:', info.version);
            if (mainWindow) {
                mainWindow.webContents.send('update-downloaded', info);
            }
            // Removed native dialog - React component handles the UI now
        });

        // Check for updates only in production
        if (app.isPackaged) {
            logToRenderer('info', '🚀 Checking for updates in production mode...');
            autoUpdater.checkForUpdatesAndNotify();
        } else {
            logToRenderer('info', '🔧 Development mode - skipping update check');
        }

        // Always initialize the client on startup, regardless of campaign state.
        // This ensures the client instance is created and listeners are set up.
        whatsappLogic.initializeClient(
            SESSION_PATH,
            (qr) => {
                logToRenderer('info', 'main.js: QR code data received from whatsapp-logic (app.whenReady).');
                // Solo procesar QR si es válido (no 'SESSION_INVALID')
                if (qr && qr !== 'SESSION_INVALID') {
                    qrcode.toDataURL(qr, (err, url) => {
                        if (err) {
                            logToRenderer('error', 'main.js: Error generating QR code data URL (initialize-client):', err);
                            if (mainWindow) mainWindow.webContents.send('qrcode', ''); // Send empty string on error
                            return;
                        }
                        logToRenderer('info', 'main.js: QR code data URL generated (app.whenReady). Sending to renderer.');
                        if (mainWindow) mainWindow.webContents.send('qrcode', url);
                    });
                } else {
                    logToRenderer('info', 'main.js: Ignoring invalid QR code (SESSION_INVALID) from whatsapp-logic.');
                }
            },
            () => {
                logToRenderer('info', 'main.js: Client ready event - sending ready to renderer (app startup)');
                if (mainWindow) {
                    console.log("main.js: Sending 'ready' event to renderer (app startup)");
                    mainWindow.webContents.send('ready');
                } else {
                    console.log("main.js: WARNING - mainWindow not available for ready event (app startup)");
                }
            },
            (reason) => {
                const campaign = whatsappLogic.getCampaignStatus();
                if (campaign.id && campaign.status !== 'inactive') {
                    store.set('campaign', campaign);
                    logToRenderer('info', 'main.js: Persisted campaign state on disconnect.', campaign);
                }
                if (mainWindow) mainWindow.webContents.send('disconnected', reason);
            },
            (msg) => { if (mainWindow) mainWindow.webContents.send('auth-failure', msg); },
            LOGS_DIR // Pass logs directory for logger initialization
        );

        // --- Robust Campaign Resumption on Startup ---
        const storedCampaign = store.get('campaign');
        if (storedCampaign && (storedCampaign.status === 'running' || storedCampaign.status === 'paused' || storedCampaign.status === 'stopped')) {
            if (storedCampaign.config && typeof storedCampaign.config.pausaCada !== 'undefined') {
                logToRenderer('info', 'main.js: Detected a valid persisted campaign on startup.', storedCampaign);
                whatsappLogic.restartSendingFromState(storedCampaign, (progress) => {
                    store.set('campaign', progress);
                    if (mainWindow) {
                        mainWindow.webContents.send('campaign-update', progress);
                    }
                }, logToRenderer, (countdownData) => {
                    // Send countdown updates to renderer
                    // console.log('main.js: Received countdown update from whatsapp-logic:', countdownData);
                    if (mainWindow) {
                        //console.log('main.js: Sending countdown-update event to renderer');
                        mainWindow.webContents.send('countdown-update', countdownData);
                    } else {
                        console.log('main.js: mainWindow not available for countdown update');
                    }
                });
            } else {
                logToRenderer('info', 'main.js: Detected corrupt or incomplete campaign state. Clearing state.');
                store.set('campaign', null);
            }
        }

        protocol.handle('app', (request) => {
            const urlPath = request.url.slice('app://'.length);
            const filePath = path.join(IMAGE_DIR, decodeURIComponent(urlPath));
            return net.fetch(pathToFileURL(filePath).toString());
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // --- Process Message Listener for Bot Events ---
    process.on('message', (message) => {
        if (message.type === 'browser-closed') {
            logToRenderer('info', 'main.js: Browser closed event received from whatsapp-logic:', message);
            if (mainWindow) {
                mainWindow.webContents.send('browser-closed', message);
            }
        }
    });

    // --- IPC Handlers ---

    // Query the true status from whatsapp-logic
    ipcMain.handle('get-campaign-status', () => {
        return whatsappLogic.getCampaignStatus();
    });

    // Save campaign configuration before starting
    ipcMain.handle('save-campaign-config', (event, config) => {
        logToRenderer('info', 'main.js: Saving campaign config.', config);
        const campaignToStore = {
            id: `campaign-${Date.now()}`,
            status: 'inactive',
            config: config,
            sent: 0,
            total: 0
        };
        store.set('campaign', campaignToStore);
        return campaignToStore;
    });

    // Update a paused campaign's configuration
    ipcMain.handle('update-campaign-config', (event, newConfig) => {
        logToRenderer(`main.js: update-campaign-config called with new config:`, newConfig);
        try {
            const updatedCampaign = whatsappLogic.updateActiveCampaignConfig(newConfig);
            store.set('campaign', updatedCampaign);
            return { success: true, campaign: updatedCampaign };
        } catch (error) {
            logToRenderer(`main.js: Error updating campaign config:`, error.message);
            return { success: false, error: error.message };
        }
    });

    // IPC handler to re-initialize the client when requested from the renderer process
    ipcMain.handle('initialize-client', () => {
        logToRenderer('info', 'main.js: initialize-client IPC called. Re-initializing WhatsApp client...');
        whatsappLogic.initializeClient(
            SESSION_PATH,
            (qr) => {
                logToRenderer('info', 'main.js: QR code data received from whatsapp-logic (initialize-client IPC).');
                // Solo procesar QR si es válido (no 'SESSION_INVALID')
                if (qr && qr !== 'SESSION_INVALID') {
                    qrcode.toDataURL(qr, (err, url) => {
                        if (err) {
                            logToRenderer('error', 'main.js: Error generating QR code data URL (initialize-client IPC):', err);
                            if (mainWindow) mainWindow.webContents.send('qrcode', ''); // Send empty string on error
                            return;
                        }
                        logToRenderer('info', 'main.js: QR code data URL generated (initialize-client IPC). Sending to renderer.');
                        if (mainWindow) mainWindow.webContents.send('qrcode', url);
                    });
                } else {
                    logToRenderer('info', 'main.js: Ignoring invalid QR code (SESSION_INVALID) from whatsapp-logic (initialize-client IPC).');
                }
            },
            () => {
                logToRenderer('info', 'main.js: Client ready event - sending ready to renderer (initialize-client IPC)');
                if (mainWindow) {
                    console.log("main.js: Sending 'ready' event to renderer (initialize-client IPC)");
                    mainWindow.webContents.send('ready');
                } else {
                    console.log("main.js: WARNING - mainWindow not available for ready event (initialize-client IPC)");
                }
            },
            (reason) => {
                const campaign = whatsappLogic.getCampaignStatus();
                if (campaign.id && campaign.status !== 'inactive') {
                    store.set('campaign', campaign);
                    logToRenderer('info', 'main.js: Persisted campaign state on disconnect.', campaign);
                }
                if (mainWindow) mainWindow.webContents.send('disconnected', reason);
            },
            (msg) => { if (mainWindow) mainWindow.webContents.send('auth-failure', msg); },
            LOGS_DIR // Pass logs directory for logger initialization
        );
    });

    // Start a new campaign
    ipcMain.handle('start-sending', (event, config) => {
        logToRenderer('info', 'main.js: start-sending IPC called with config:', config);
        try {
            whatsappLogic.startSending(config, (progress) => {
                store.set('campaign', progress);
                if (mainWindow) {
                    mainWindow.webContents.send('campaign-update', progress);
                }
            }, logToRenderer, 0, null, (countdownData) => {
                // Send countdown updates to renderer
                if (mainWindow) {
                    mainWindow.webContents.send('countdown-update', countdownData);
                }
            });
            logToRenderer('info', 'main.js: start-sending completed successfully');
        } catch (error) {
            logToRenderer('error', 'main.js: Error in start-sending:', error);
            throw error;
        }
    });

    // Pause the currently running campaign
    ipcMain.handle('pause-sending', (event, campaignId) => {
        logToRenderer(`main.js: pause-sending called for campaign ${campaignId}`);
        whatsappLogic.pauseSending(campaignId);
    });

    // Resume the currently paused campaign
    ipcMain.handle('resume-sending', (event, campaignId) => {
        logToRenderer(`main.js: resume-sending called for campaign ${campaignId}`);
        whatsappLogic.resumeSending(campaignId);
    });

    // Stop the currently active campaign
    ipcMain.handle('stop-sending', (event, campaignId) => {
        logToRenderer(`main.js: stop-sending called for campaign ${campaignId}`);
        whatsappLogic.stopSending(campaignId, 'user_request');
    });

    // Clear all campaign data
    ipcMain.handle('clear-campaign-state', () => {
        logToRenderer('info', 'main.js: clear-campaign-state called.');
        whatsappLogic.clearCampaign();
        store.set('campaign', null);
        logToRenderer('info', 'main.js: Persisted campaign store cleared.');
        return whatsappLogic.getCampaignStatus();
    });

    // Logout and clear session
    ipcMain.handle('logout', async () => {
        try {
            const campaign = whatsappLogic.getCampaignStatus();
            if (campaign.id) {
                whatsappLogic.stopSending(campaign.id, 'logout');
            }
            await whatsappLogic.softLogoutAndReinitialize(
                SESSION_PATH,
                (qr) => {
                    // Solo procesar QR si es válido (no 'SESSION_INVALID')
                    if (qr && qr !== 'SESSION_INVALID') {
                        qrcode.toDataURL(qr, (err, url) => {
                            if (err) {
                                logToRenderer('Error generating QR code data URL on logout:', err);
                                if (mainWindow) mainWindow.webContents.send('qrcode', '');
                                return;
                            }
                            if (mainWindow) mainWindow.webContents.send('qrcode', url);
                        });
                    } else {
                        logToRenderer('info', 'main.js: Ignoring invalid QR code (SESSION_INVALID) from whatsapp-logic (logout).');
                    }
                },
                () => {
                    logToRenderer('info', 'main.js: Client ready event - sending ready to renderer (logout)');
                    if (mainWindow) {
                        console.log("main.js: Sending 'ready' event to renderer (logout)");
                        mainWindow.webContents.send('ready');
                    } else {
                        console.log("main.js: WARNING - mainWindow not available for ready event (logout)");
                    }
                },
                (reason) => {
                    const campaign = whatsappLogic.getCampaignStatus();
                    if (campaign.id && campaign.status !== 'inactive') {
                        store.set('campaign', campaign);
                        logToRenderer('info', 'main.js: Persisted campaign state on disconnect.', campaign);
                    }
                    if (mainWindow) mainWindow.webContents.send('disconnected', reason);
                },
                (msg) => {
                    if (mainWindow) mainWindow.webContents.send('auth-failure', msg);
                },
                LOGS_DIR // Pass logs directory for logger initialization
            );
            return { success: true };
        } catch (error) {
            logToRenderer('error', 'Failed to logout and clear session:', error);
            return { success: false, error: error.message };
        }
    });

    // --- License Management Handlers ---

    // Login user with server
    ipcMain.handle('login-user', async (event, email, password) => {
        try {
            const http = require('http');
            const https = require('https');
            const serverUrl = config.serverUrl;

            // Log which server we're connecting to
            logToRenderer('info', 'main.js: Login attempt using server:', serverUrl, 'Mode:', config.isPackaged ? 'production (packaged)' : 'development (unpacked)');

            const postData = JSON.stringify({ email, password });

            return new Promise((resolve, reject) => {
                // Choose HTTP or HTTPS based on server URL
                const client = serverUrl.startsWith('https://') ? https : http;

                const req = client.request(`${serverUrl}/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        logToRenderer('info', 'main.js: Login response received - Status:', res.statusCode, 'Content-Type:', res.headers['content-type'], 'Data length:', data.length);
                        logToRenderer('info', 'main.js: Login response data (first 500 chars):', data.substring(0, 500));
                        try {
                            const response = JSON.parse(data);
                            if (res.statusCode === 200) {
                                // Validate that we have required data
                                if (!response.token) {
                                    logToRenderer('info', 'main.js: Login failed - no token in response');
                                    resolve({ success: false, error: 'No token received from server' });
                                    return;
                                }

                                if (!response.license) {
                                    logToRenderer('info', 'main.js: Login failed - no license data in response');
                                    logToRenderer('info', 'main.js: Full response object:', response);
                                    resolve({
                                        success: false,
                                        error: 'No license data received from server',
                                        reason: 'no_license_data'
                                    });
                                    return;
                                }

                                // Validate license status
                                const licenseStatus = response.license.status;
                                logToRenderer('info', 'main.js: Login license status:', licenseStatus);
                                logToRenderer('info', 'main.js: Full license object:', response.license);

                                if (licenseStatus === 'suspended') {
                                    logToRenderer('info', 'main.js: Login blocked - license suspended');
                                    resolve({
                                        success: false,
                                        error: 'Licencia suspendida',
                                        reason: 'suspended'
                                    });
                                    return;
                                }

                                if (licenseStatus === 'expired') {
                                    logToRenderer('info', 'main.js: Login blocked - license expired');
                                    resolve({
                                        success: false,
                                        error: 'Licencia expirada',
                                        reason: 'expired'
                                    });
                                    return;
                                }

                                if (licenseStatus !== 'active') {
                                    logToRenderer('info', 'main.js: Login blocked - invalid license status:', licenseStatus);
                                    resolve({
                                        success: false,
                                        error: 'Estado de licencia inválido',
                                        reason: 'invalid_status'
                                    });
                                    return;
                                }

                                // Calculate days remaining for login response
                                let loginDaysRemaining = response.license.days_remaining;

                                // Si no viene del servidor, calcularlo
                                if (loginDaysRemaining === undefined || loginDaysRemaining === null) {
                                    try {
                                        const endDate = parseServerDate(response.license?.end_date);
                                        const serverTime = new Date(validateServerTime(response.server_time));
                                        loginDaysRemaining = calculateDaysRemaining(endDate, serverTime);
                                        logToRenderer('info', 'main.js: Login - calculated days remaining:', loginDaysRemaining);
                                    } catch (error) {
                                        console.warn('Error calculando días restantes en login:', error.message);
                                        loginDaysRemaining = null;
                                    }
                                } else {
                                    logToRenderer('info', 'main.js: Login - server provided days remaining:', loginDaysRemaining);
                                }

                                // Store token, license and user data locally with fresh days_remaining
                                const licenseStore = new Store({ name: 'license-data' });

                                // Reemplazar almacenamiento actual con manejo completo de campos
                                const licenseToStore = {
                                    ...response.license,
                                    type: response.license?.type || null,
                                    start_date: response.license?.start_date || null,
                                    end_date: response.license?.end_date || null,
                                    status: response.license?.status || 'unknown',
                                    days_remaining: loginDaysRemaining,
                                    is_expired: response.license?.is_expired || false
                                };

                                logToRenderer('info', 'main.js: Storing login data - token:', !!response.token, 'license status:', response.license.status, 'days remaining:', loginDaysRemaining);
                                licenseStore.set('auth_token', response.token);
                                licenseStore.set('license', licenseToStore);
                                licenseStore.set('user', response.user);

                                // Almacenar indicadores raíz adicionales
                                licenseStore.set('license_suspended', response.suspended || false);
                                licenseStore.set('license_expired', response.expired || false);
                                licenseStore.set('server_time', validateServerTime(response.server_time));
                                licenseStore.set('last_validation', Date.now());
                                licenseStore.set('last_check', Date.now()); // Agregar timestamp de última verificación
                                licenseStore.set('device_unique_id', response.device_unique_id || null); // Agregar almacenamiento del device_unique_id
                                logToRenderer('info', 'main.js: Login data stored successfully with fresh days_remaining');

                                // Return response with calculated days_remaining
                                const loginResponse = {
                                    ...response,
                                    license: { ...response.license, days_remaining: loginDaysRemaining }
                                };
                                resolve({ success: true, ...loginResponse });
                            } else {
                                logToRenderer('info', 'main.js: Login failed with response:', response);
                                resolve({ success: false, error: response.error });
                            }
                        } catch (e) {
                            logToRenderer('info', 'main.js: Login failed - invalid JSON response:', e.message);
                            logToRenderer('info', 'main.js: Raw response data that failed to parse:', data);
                            resolve({ success: false, error: 'Invalid response from server' });
                        }
                    });
                });

                req.on('error', (err) => {
                    logToRenderer('info', 'main.js: Login request failed with error:', err.message, 'Code:', err.code);
                    resolve({ success: false, error: 'Connection failed' });
                });

                req.write(postData);
                req.end();
            });
        } catch (error) {
            return { success: false, error: 'Internal error' };
        }
    });

    // Check license status
    ipcMain.handle('check-license-status', async () => {
        try {
            const licenseStore = new Store({ name: 'license-data' });
            const token = licenseStore.get('auth_token');
            const cachedLicense = licenseStore.get('license');
            const serverTime = licenseStore.get('server_time');
            const lastCheck = licenseStore.get('last_check') || licenseStore.get('last_validation');

            // No token or no license data stored
            if (!token) {
                return {
                    valid: false,
                    reason: 'no_license',
                    message: 'Verifique sus credenciales para acceder'
                };
            }

            if (!cachedLicense) {
                return {
                    valid: false,
                    reason: 'no_license_data',
                    message: 'Contacte al administrador para activar su licencia'
                };
            }

            // Check if we need to refresh from server (every 7 days)
            const needsRefresh = !lastCheck || (Date.now() - lastCheck) > config.licenseCheckInterval;
            logToRenderer('info', 'main.js: License check - needsRefresh:', needsRefresh, 'lastCheck:', lastCheck, 'interval:', config.licenseCheckInterval);

            if (needsRefresh) {
                // Refresh from server
                logToRenderer('info', 'main.js: License check needs refresh, making server request');
                const http = require('http');
                const https = require('https');
                const serverUrl = config.serverUrl;
                const serverRequestStart = Date.now();

                return new Promise((resolve, reject) => {
                    // Choose HTTP or HTTPS based on server URL
                    const client = serverUrl.startsWith('https://') ? https : http;

                    const req = client.request(`${serverUrl}/check_license`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }, (res) => {
                        const serverResponseStart = Date.now();
                        logToRenderer('info', `main.js: Server request initiated, waiting for response (request time: ${serverResponseStart - serverRequestStart}ms)`);
                        let data = '';
                        res.on('data', (chunk) => data += chunk);
                        res.on('end', () => {
                            const serverResponseEnd = Date.now();
                            logToRenderer('info', `main.js: Server response received, total time: ${serverResponseEnd - serverRequestStart}ms`);

                            // ENHANCED DIAGNOSTIC LOGGING - Validate response before parsing
                            const responseTimestamp = new Date().toISOString();
                            logToRenderer('info', `main.js: DIAGNOSTIC - Response received at: ${responseTimestamp}`);
                            logToRenderer('info', `main.js: DIAGNOSTIC - Response status code: ${res.statusCode}`);
                            logToRenderer('info', `main.js: DIAGNOSTIC - Content-Type: ${res.headers['content-type']}`);
                            logToRenderer('info', `main.js: DIAGNOSTIC - Response data length: ${data.length} bytes`);
                            logToRenderer('info', `main.js: DIAGNOSTIC - Response headers:`, res.headers);
                            logToRenderer('info', `main.js: DIAGNOSTIC - Response data preview (first 200 chars): ${data.substring(0, 200)}`);

                            // Check if response looks like HTML error page
                            const isHtmlResponse = data.trim().startsWith('<') && data.includes('</html>');
                            if (isHtmlResponse) {
                                logToRenderer('error', `main.js: DIAGNOSTIC - Server returned HTML instead of JSON! This indicates a server error.`);
                                logToRenderer('error', `main.js: DIAGNOSTIC - HTML Response (first 500 chars): ${data.substring(0, 500)}`);
                                logToRenderer('error', `main.js: DIAGNOSTIC - Full response length: ${data.length}, suggesting server error page`);
                            }

                            // Additional diagnostic checks for common issues
                            if (data.length === 0) {
                                logToRenderer('error', `main.js: DIAGNOSTIC - Empty response body received - possible network issue`);
                            }

                            if (res.statusCode >= 500) {
                                logToRenderer('error', `main.js: DIAGNOSTIC - Server error (5xx) - backend service issue`);
                            }

                            if (res.statusCode === 404) {
                                logToRenderer('error', `main.js: DIAGNOSTIC - Endpoint not found (404) - check server URL and endpoint path`);
                            }

                            if (res.statusCode === 401 || res.statusCode === 403) {
                                logToRenderer('error', `main.js: DIAGNOSTIC - Authentication/Authorization error (${res.statusCode}) - check token validity`);
                            }

                            try {
                                const response = JSON.parse(data);

                                // DIAGNOSTIC LOGGING - Validate parsed response structure
                                logToRenderer('info', `main.js: DIAGNOSTIC - Parsed response keys: ${Object.keys(response || {}).join(', ')}`);
                                logToRenderer('info', `main.js: DIAGNOSTIC - Response.valid: ${response?.valid} (type: ${typeof response?.valid})`);
                                logToRenderer('info', `main.js: DIAGNOSTIC - Response.license exists: ${!!response?.license}`);
                                logToRenderer('info', `main.js: DIAGNOSTIC - Response.license keys: ${response?.license ? Object.keys(response.license).join(', ') : 'N/A'}`);

                                if (res.statusCode === 200 && response.valid && response.license) {
                                    // Handle new response format with detailed license info
                                    const isExpired = response.license?.is_expired || false;

                                    // También mejorar el manejo de days_remaining considerando que puede no venir
                                    let daysRemaining = response.license?.days_remaining;

                                    // Si no viene del servidor, calcularlo
                                    if (daysRemaining === undefined || daysRemaining === null) {
                                        try {
                                            const endDate = parseServerDate(response.license?.end_date);
                                            const serverTime = new Date(validateServerTime(response.server_time));
                                            daysRemaining = calculateDaysRemaining(endDate, serverTime);
                                        } catch (error) {
                                            console.warn('Error calculando días restantes:', error.message);
                                            daysRemaining = null;
                                        }
                                    }
    
                                    // Manejar campos faltantes con valores por defecto seguros
                                    const isGloballySuspended = response.suspended || false;
                                    const isGloballyExpired = response.expired || false;
                                    const licenseStatus = response.license?.status || 'unknown';
                                    const isLicenseExpired = response.license?.is_expired || false;

                                    // Si no viene 'valid' del servidor, determinarlo basado en status
                                    const isValid = response.valid !== false && // Si no viene, asumir válido
                                                    !isGloballySuspended &&
                                                    !isGloballyExpired &&
                                                    licenseStatus === 'active' &&
                                                    !isLicenseExpired;

                                    if (isValid && response.license) {
                                        // Update cache with fresh calculated days_remaining
                                        const licenseToStore = { ...response.license, days_remaining: daysRemaining };
                                        licenseStore.set('license', licenseToStore);
                                        licenseStore.set('user', response.user);
                                        licenseStore.set('server_time', validateServerTime(response.server_time));
                                        licenseStore.set('last_check', Date.now());
                                        logToRenderer('info', 'main.js: License check - stored fresh days_remaining:', daysRemaining);
                                        resolve({
                                            valid: true,
                                            license: response.license,
                                            user: response.user,
                                            reason: 'active',
                                            message: `Licencia válida - ${daysRemaining} días restantes`
                                        });
                                    } else if (isGloballySuspended || licenseStatus === 'suspended') {
                                        resolve({
                                            valid: false,
                                            reason: 'suspended',
                                            message: response.message || 'Licencia suspendida',
                                            license: { ...response.license, days_remaining: daysRemaining },
                                            user: response.user
                                        });
                                    } else if (isGloballyExpired || licenseStatus === 'expired' || isLicenseExpired) {
                                        resolve({
                                            valid: false,
                                            reason: 'expired',
                                            message: response.message || 'Licencia expirada',
                                            license: { ...response.license, days_remaining: daysRemaining },
                                            user: response.user
                                        });
                                    } else {
                                        resolve({
                                            valid: false,
                                            reason: 'invalid_status',
                                            message: response.message || 'Estado de licencia inválido',
                                            license: { ...response.license, days_remaining: daysRemaining },
                                            user: response.user
                                        });
                                    }
                                } else {
                                    // DIAGNOSTIC LOGGING - Detailed analysis of why response is considered invalid
                                    logToRenderer('error', `main.js: DIAGNOSTIC - Response considered invalid. Debugging details:`);
                                    logToRenderer('error', `main.js: DIAGNOSTIC - Status code: ${res.statusCode} (expected: 200)`);
                                    logToRenderer('error', `main.js: DIAGNOSTIC - Response.valid: ${response?.valid} (expected: true)`);
                                    logToRenderer('error', `main.js: DIAGNOSTIC - Response.license exists: ${!!response?.license} (expected: true)`);
                                    logToRenderer('error', `main.js: DIAGNOSTIC - Full response object:`, response);

                                    // Additional diagnostics for common issues
                                    if (res.statusCode !== 200) {
                                        logToRenderer('error', `main.js: DIAGNOSTIC - HTTP error code ${res.statusCode} indicates server-side issue`);
                                    }
                                    if (response?.valid === false) {
                                        logToRenderer('error', `main.js: DIAGNOSTIC - Server explicitly returned valid: false`);
                                        logToRenderer('error', `main.js: DIAGNOSTIC - Server message: ${response?.message || 'No message provided'}`);
                                    }
                                    if (!response?.license && response?.valid !== false) {
                                        logToRenderer('error', `main.js: DIAGNOSTIC - Missing license object in response`);
                                    }

                                    // Check if server returned 403 with valid: false - treat as no_license to allow login
                                    const is403WithValidFalse = res.statusCode === 403 && response?.valid === false;

                                    resolve({
                                        valid: false,
                                        reason: is403WithValidFalse ? 'no_license' : 'server_invalid',
                                        message: is403WithValidFalse ? 'Verifique sus credenciales para acceder' : 'Respuesta inválida del servidor',
                                        diagnostic: {
                                            statusCode: res.statusCode,
                                            hasValidField: 'valid' in response,
                                            validValue: response?.valid,
                                            hasLicense: !!response?.license,
                                            responseKeys: Object.keys(response || {}),
                                            is403WithValidFalse: is403WithValidFalse
                                        }
                                    });
                                }
                            } catch (e) {
                                // DIAGNOSTIC LOGGING - JSON parsing errors
                                logToRenderer('error', `main.js: DIAGNOSTIC - JSON parsing failed. This is likely the root cause of server_invalid!`);
                                logToRenderer('error', `main.js: DIAGNOSTIC - Parse error: ${e.message}`);
                                logToRenderer('error', `main.js: DIAGNOSTIC - Raw data that failed to parse (first 500 chars): ${data.substring(0, 500)}`);
                                logToRenderer('error', `main.js: DIAGNOSTIC - Data length: ${data.length}, Content-Type: ${res.headers['content-type']}`);

                                // Check if it's HTML error response
                                if (data.trim().startsWith('<')) {
                                    logToRenderer('error', `main.js: DIAGNOSTIC - Server returned HTML error page instead of JSON`);
                                    logToRenderer('error', `main.js: DIAGNOSTIC - This usually means: 500 Internal Server Error, 404 Not Found, or authentication failure`);
                                }

                                // If server check fails, use cached license validation
                                const validation = validateCachedLicense(cachedLicense, licenseStore);
                                logToRenderer('info', `main.js: DIAGNOSTIC - Falling back to cached license validation:`, validation);
                                resolve(validation);
                            }
                        });
                    });

                    req.on('error', (err) => {
                        // If connection fails, use cached license validation
                        const validation = validateCachedLicense(cachedLicense, licenseStore);
                        resolve(validation);
                    });

                    req.end();
                });
            } else {
                // Use cached license validation but always recalculate days remaining
                logToRenderer('info', 'main.js: Using cached license validation (no refresh needed)');
                const validation = validateCachedLicense(cachedLicense, licenseStore);

                // Always recalculate days remaining to ensure it's current
                if (validation.valid && validation.license) {
                    const currentTime = Math.floor(Date.now() / 1000);
                    const endDateStr = cachedLicense.end_date.replace(' ', 'T');
                    const endTime = new Date(endDateStr).getTime() / 1000;
                    const timeDiff = endTime - currentTime;
                    const freshDaysRemaining = Math.max(0, Math.floor(timeDiff / (24 * 60 * 60)));

                    validation.license.days_remaining = freshDaysRemaining;
                    logToRenderer('info', 'main.js: Refreshed cached days remaining:', freshDaysRemaining);
                }

                return validation;
            }
        } catch (error) {
            logToRenderer('error', 'License check error:', error);
            return {
                valid: false,
                reason: 'error',
                message: 'Error al verificar licencia'
            };
        }
    });

    // Helper function to validate cached license
    function validateCachedLicense(cachedLicense, licenseStore) {
        if (!cachedLicense) {
            return {
                valid: false,
                reason: 'no_license_data',
                message: 'Contacte al administrador para activar su licencia'
            };
        }

        // Corregir manejo de fechas en validación de caché
        try {
            const endDate = parseServerDate(cachedLicense.end_date);
            const currentTime = new Date();
            const isExpired = cachedLicense.is_expired ||
                             calculateDaysRemaining(endDate, currentTime) === 0;

            // Usar indicadores de caché también
            const isSuspended = cachedLicense.status === 'suspended' ||
                               licenseStore.get('license_suspended', false);

            if (isSuspended) {
                return {
                    valid: false,
                    reason: 'suspended',
                    message: 'Licencia suspendida',
                    license: cachedLicense,
                    user: licenseStore.get('user')
                };
            }

            if (isExpired) {
                return {
                    valid: false,
                    reason: 'expired',
                    message: 'Licencia expirada',
                    license: cachedLicense,
                    user: licenseStore.get('user')
                };
            }

            if (cachedLicense.status === 'active') {
                const daysRemaining = calculateDaysRemaining(endDate, currentTime);
                return {
                    valid: true,
                    license: { ...cachedLicense, days_remaining: daysRemaining },
                    user: licenseStore.get('user'),
                    reason: 'active',
                    message: `Licencia válida - ${daysRemaining} días restantes`
                };
            }

            return {
                valid: false,
                reason: 'invalid_status',
                message: 'Estado de licencia inválido',
                license: cachedLicense,
                user: licenseStore.get('user')
            };
        } catch (error) {
            console.warn('Error validando licencia en caché:', error.message);
            return {
                valid: false,
                reason: 'validation_error',
                message: 'Error interno de validación',
                license: cachedLicense,
                user: licenseStore.get('user')
            };
        }
    }

    // --- File System Handlers ---

    ipcMain.handle('open-file-dialog', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
        });
        return canceled ? null : filePaths[0];
    });

    ipcMain.handle('save-file-dialog', async () => {
        const { canceled, filePath } = await dialog.showSaveDialog({
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
            defaultPath: 'plantilla-wm.xlsx'
        });
        return canceled ? null : filePath;
    });

    ipcMain.handle('generate-excel-template', async () => {
        try {
            const XLSX = require('xlsx');

            // Datos de ejemplo con códigos de país
            const templateData = [
                {
                    item: '1',
                    numero: '50255551234',
                    nombre: 'Juan',
                    apellido: 'Pérez'
                },
                {
                    item: '2',
                    numero: '50377771234',
                    nombre: 'María',
                    apellido: 'González'
                },
                {
                    item: '3',
                    numero: '50488881234',
                    nombre: 'Carlos',
                    apellido: 'López'
                }
            ];

            // Crear workbook y worksheet
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(templateData);

            // Agregar worksheet al workbook
            XLSX.utils.book_append_sheet(wb, ws, 'Datos Limpios');

            // Generar buffer
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            logToRenderer('info', 'main.js: Excel template generated successfully');
            return { success: true, buffer: buffer };
        } catch (error) {
            logToRenderer('error', 'main.js: Failed to generate Excel template:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-excel-template', async (event, filePath, buffer) => {
        try {
            await fs.writeFile(filePath, Buffer.from(buffer));
            logToRenderer('info', 'main.js: Excel template saved successfully to:', filePath);
            return { success: true };
        } catch (error) {
            logToRenderer('error', 'main.js: Failed to save Excel template:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-media-dialog', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'mp4', 'pdf'] }]
        });
        if (canceled) return null;

        try {
            const originalPath = filePaths[0];
            const fileName = path.basename(originalPath);
            const destinationPath = path.join(IMAGE_DIR, fileName);
            await fs.copyFile(originalPath, destinationPath);
            return destinationPath;
        } catch (error) {
            logToRenderer('error', 'Failed to copy media:', error);
            return null;
        }
    });

    ipcMain.handle('read-file-content', async (event, filePath) => {
        try {
            const fileContent = await fs.readFile(filePath);
            logToRenderer(`main.js: Read file ${filePath}, size: ${fileContent.length} bytes.`);
            return fileContent.buffer;
        } catch (error) {
            logToRenderer('error', 'Failed to read file content:', error);
            return null;
        }
    });

    ipcMain.handle('write-excel-file', async (event, fileContentBuffer) => {
        try {
            logToRenderer(`main.js: Writing to template, received buffer size: ${fileContentBuffer.byteLength} bytes.`);
            const excelDataDir = path.join(app.getPath('userData'), 'excel_data');
            await fs.mkdir(excelDataDir, { recursive: true });
            const targetPath = path.join(excelDataDir, 'plantilla-wm.xlsx');
            const buffer = Buffer.from(fileContentBuffer);
            await fs.writeFile(targetPath, buffer);
            logToRenderer(`main.js: Successfully wrote ${buffer.length} bytes to ${targetPath}.`);
            return { success: true };
        } catch (error) {
            logToRenderer('error', 'Failed to write Excel file:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-excel-headers', async (event) => {
        try {
            const userExcelPath = path.join(app.getPath('userData'), 'excel_data', 'plantilla-wm.xlsx');
            const defaultExcelPath = path.join(__dirname, '..', 'excel', 'plantilla-wm.xlsx');

            let excelPathToUse;
            try {
                await fs.access(userExcelPath);
                excelPathToUse = userExcelPath;
            } catch (error) {
                excelPathToUse = defaultExcelPath;
            }
            const result = await whatsappLogic.getExcelHeaders(excelPathToUse);
            return { success: true, ...result, path: excelPathToUse };
        } catch (error) {
            logToRenderer('error', 'Failed to get Excel headers:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-first-excel-row', async (event) => {
        try {
            const userExcelPath = path.join(app.getPath('userData'), 'excel_data', 'plantilla-wm.xlsx');
            const defaultExcelPath = path.join(__dirname, '..', 'excel', 'plantilla-wm.xlsx');

            let excelPathToUse;
            try {
                await fs.access(userExcelPath);
                excelPathToUse = userExcelPath;
            } catch (error) {
                excelPathToUse = defaultExcelPath;
            }
            const firstRow = await whatsappLogic.getFirstExcelRow(excelPathToUse);
            return { success: true, firstRow };
        } catch (error) {
            logToRenderer('error', 'Failed to get first Excel row:', error);
            return { success: false, error: error.message };
        }
    });

    // New IPC handler to get client status
    ipcMain.handle('get-client-status', () => {
        return whatsappLogic.getClientStatus();
    });

    // Handler for log messages from renderer
    ipcMain.on('log-message', (event, message) => {
        logToRenderer('info', message);
    });

    // Handler for forcing the app to quit without confirmation
    ipcMain.handle('forceQuitApp', () => {
        const campaign = whatsappLogic.getCampaignStatus();
        if (campaign.id && campaign.status !== 'inactive') {
            store.set('campaign', campaign);
            logToRenderer('info', 'main.js: Persisted campaign state on force quit.', campaign);
        }
        app.isQuitting = true;
        app.quit();
    });

    // Handler for resetting license data
    ipcMain.handle('reset-license-data', () => {
        logToRenderer('info', 'main.js: Starting license data reset');
        try {
            const licenseStore = new Store({ name: 'license-data' });
            const clearStart = Date.now();
            licenseStore.clear();
            const clearEnd = Date.now();
            logToRenderer('info', `main.js: License store cleared in ${clearEnd - clearStart}ms`);
            logToRenderer('info', 'main.js: License data reset successfully');
            return { success: true, message: 'License data reset successfully' };
        } catch (error) {
            logToRenderer('error', 'main.js: Error during license data reset:', error);
            logToRenderer('error', 'main.js: Error resetting license data:', error);
            return { success: false, error: error.message };
        }
    });

    // Handler for recalculating days remaining in cached license
    ipcMain.handle('recalculate-days-remaining', () => {
        logToRenderer('info', 'main.js: Starting days remaining recalculation');
        try {
            const licenseStore = new Store({ name: 'license-data' });
            const cachedLicense = licenseStore.get('license');

            if (!cachedLicense) {
                return { success: false, error: 'No cached license data found' };
            }

            const currentTime = Math.floor(Date.now() / 1000);
            // Parse date string properly - handle format "2025-09-18 13:54:02"
            const endDateStr = cachedLicense.end_date.replace(' ', 'T'); // Convert to ISO format
            const endTime = new Date(endDateStr).getTime() / 1000;

            // Calculate days remaining more accurately
            // Use floor instead of ceil to avoid off-by-one errors
            const timeDiff = endTime - currentTime;
            const daysRemaining = Math.max(0, Math.floor(timeDiff / (24 * 60 * 60)));

            logToRenderer('info', 'main.js: Recalculation details:', {
                currentTime,
                endTime,
                timeDiff,
                daysRemaining,
                endDateStr
            });

            // Update cached license with calculated days_remaining
            const updatedLicense = { ...cachedLicense, days_remaining: daysRemaining };
            licenseStore.set('license', updatedLicense);

            logToRenderer('info', `main.js: Recalculated days remaining: ${daysRemaining}`);
            logToRenderer('info', 'main.js: Days remaining recalculated successfully:', daysRemaining);
            return { success: true, days_remaining: daysRemaining };
        } catch (error) {
            logToRenderer('error', 'main.js: Error recalculating days remaining:', error);
            logToRenderer('error', 'main.js: Error recalculating days remaining:', error);
            return { success: false, error: error.message };
        }
    });

    // --- Update Control Handlers ---

    // Handler to manually check for updates
    ipcMain.handle('check-for-updates', () => {
        if (app.isPackaged) {
            logToRenderer('info', 'Manual update check requested');
            autoUpdater.checkForUpdatesAndNotify();
        } else {
            logToRenderer('info', 'Update check skipped - development mode');
        }
    });

    // Handler to manually download update
    ipcMain.handle('download-update', () => {
        if (app.isPackaged) {
            logToRenderer('info', 'Manual update download requested');
            autoUpdater.downloadUpdate();
        } else {
            logToRenderer('info', 'Update download skipped - development mode');
        }
    });

    // Handler to manually install update
    ipcMain.handle('install-update', () => {
        if (app.isPackaged) {
            logToRenderer('info', 'Manual update install requested');
            app.isQuitting = true;
            autoUpdater.quitAndInstall(true, true); // (isSilent, isForceRunAfter)
        } else {
            logToRenderer('info', 'Update install skipped - development mode');
        }
    });
}
