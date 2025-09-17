console.log('Node.js version:', process.versions.node);
const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('url');
const url = require('url');
const fs = require('fs').promises;
const path = require('path');
const qrcode = require('qrcode');
const Store = require('electron-store').default;
const whatsappLogic = require('../bot/whatsapp-logic');

let mainWindow;

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
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('log-message', message);
        }
        console.log(...args);
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
                title: 'Confirm Exit',
                message: 'Are you sure you want to exit?',
            });

            if (response === 0) {
                const campaign = whatsappLogic.getCampaignStatus();
                if (campaign.id && campaign.status !== 'inactive') {
                    // Persist the final state before quitting
                    store.set('campaign', campaign);
                    logToRenderer('main.js: Persisted campaign state on exit.', campaign);
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
        createWindow();

        // --- Auto Updater Setup ---
        // Configure auto-updater
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        
        autoUpdater.on('checking-for-update', () => {
            logToRenderer('🔍 Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            logToRenderer('✅ Update available:', info.version);
            if (mainWindow) {
                mainWindow.webContents.send('update-available', info);
            }
        });

        autoUpdater.on('update-not-available', (info) => {
            logToRenderer('ℹ️ Update not available. Current version:', info.version);
        });

        autoUpdater.on('error', (err) => {
            logToRenderer('❌ Error in auto-updater:', err.message);
            if (mainWindow) {
                mainWindow.webContents.send('update-error', err.message);
            }
        });

        autoUpdater.on('download-progress', (progressObj) => {
            const percent = Math.round(progressObj.percent);
            const speed = Math.round(progressObj.bytesPerSecond / 1024);
            let log_message = `📥 Downloading update: ${percent}% (${speed} KB/s)`;
            log_message += ` - ${Math.round(progressObj.transferred / 1024 / 1024)}MB / ${Math.round(progressObj.total / 1024 / 1024)}MB`;
            logToRenderer(log_message);
            
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
            logToRenderer('✅ Update downloaded successfully:', info.version);
            if (mainWindow) {
                mainWindow.webContents.send('update-downloaded', info);
            }
            
            // Show dialog to user asking if they want to restart now
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Ready',
                message: 'Update downloaded successfully!',
                detail: `Version ${info.version} is ready to install. The application will restart to apply the update.`,
                buttons: ['Restart Now', 'Later'],
                defaultId: 0
            }).then((result) => {
                if (result.response === 0) {
                    autoUpdater.quitAndInstall();
                }
            });
        });

        // Check for updates only in production
        if (app.isPackaged) {
            logToRenderer('🚀 Checking for updates in production mode...');
            autoUpdater.checkForUpdatesAndNotify();
        } else {
            logToRenderer('🔧 Development mode - skipping update check');
        }

        // Always initialize the client on startup, regardless of campaign state.
        // This ensures the client instance is created and listeners are set up.
        whatsappLogic.initializeClient(
            (qr) => {
                logToRenderer('main.js: QR code data received from whatsapp-logic (app.whenReady).');
                qrcode.toDataURL(qr, (err, url) => {
                    if (err) {
                        console.error('Error generating QR code data URL (app.whenReady):', err);
                        logToRenderer('main.js: Error generating QR code data URL (app.whenReady).', err);
                        if (mainWindow) mainWindow.webContents.send('qrcode', ''); // Send empty string on error
                        return;
                    }
                    logToRenderer('main.js: QR code data URL generated (app.whenReady). Sending to renderer.');
                    if (mainWindow) mainWindow.webContents.send('qrcode', url);
                });
            },
            () => { if (mainWindow) mainWindow.webContents.send('ready'); },
            (reason) => {
                const campaign = whatsappLogic.getCampaignStatus();
                if (campaign.id && campaign.status !== 'inactive') {
                    store.set('campaign', campaign);
                    logToRenderer('main.js: Persisted campaign state on disconnect.', campaign);
                }
                if (mainWindow) mainWindow.webContents.send('disconnected', reason);
            },
            (msg) => { if (mainWindow) mainWindow.webContents.send('auth-failure', msg); }
        );

        // --- Robust Campaign Resumption on Startup ---
        const storedCampaign = store.get('campaign');
        if (storedCampaign && (storedCampaign.status === 'running' || storedCampaign.status === 'paused' || storedCampaign.status === 'stopped')) {
            if (storedCampaign.config && typeof storedCampaign.config.pausaCada !== 'undefined') {
                logToRenderer('main.js: Detected a valid persisted campaign on startup.', storedCampaign);
                whatsappLogic.restartSendingFromState(storedCampaign, (progress) => {
                    store.set('campaign', progress);
                    if (mainWindow) {
                        mainWindow.webContents.send('campaign-update', progress);
                    }
                }, logToRenderer);
            } else {
                logToRenderer('main.js: Detected corrupt or incomplete campaign state. Clearing state.');
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

    // --- IPC Handlers ---

    // Query the true status from whatsapp-logic
    ipcMain.handle('get-campaign-status', () => {
        return whatsappLogic.getCampaignStatus();
    });

    // Save campaign configuration before starting
    ipcMain.handle('save-campaign-config', (event, config) => {
        logToRenderer('main.js: Saving campaign config.', config);
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
        logToRenderer('main.js: initialize-client IPC called. Re-initializing WhatsApp client...');
        whatsappLogic.initializeClient(
            (qr) => {
                logToRenderer('main.js: QR code data received from whatsapp-logic (app.whenReady).');
                qrcode.toDataURL(qr, (err, url) => {
                    if (err) {
                        console.error('Error generating QR code data URL (app.whenReady):', err);
                        logToRenderer('main.js: Error generating QR code data URL (app.whenReady).', err);
                        if (mainWindow) mainWindow.webContents.send('qrcode', ''); // Send empty string on error
                        return;
                    }
                    logToRenderer('main.js: QR code data URL generated (app.whenReady). Sending to renderer.');
                    if (mainWindow) mainWindow.webContents.send('qrcode', url);
                });
            },
            () => { if (mainWindow) mainWindow.webContents.send('ready'); },
            (reason) => {
                const campaign = whatsappLogic.getCampaignStatus();
                if (campaign.id && campaign.status !== 'inactive') {
                    store.set('campaign', campaign);
                    logToRenderer('main.js: Persisted campaign state on disconnect.', campaign);
                }
                if (mainWindow) mainWindow.webContents.send('disconnected', reason);
            },
            (msg) => { if (mainWindow) mainWindow.webContents.send('auth-failure', msg); }
        );
    });

    // Start a new campaign
    ipcMain.handle('start-sending', (event, config) => {
        logToRenderer('main.js: start-sending called with config:', config);
        whatsappLogic.startSending(config, (progress) => {
            store.set('campaign', progress);
            if (mainWindow) {
                mainWindow.webContents.send('campaign-update', progress);
            }
        }, logToRenderer);
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
        logToRenderer('main.js: clear-campaign-state called.');
        whatsappLogic.clearCampaign();
        store.set('campaign', null);
        logToRenderer('main.js: Persisted campaign store cleared.');
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
                (qr) => {
                    qrcode.toDataURL(qr, (err, url) => {
                        if (err) {
                            logToRenderer('Error generating QR code data URL on logout:', err);
                            if (mainWindow) mainWindow.webContents.send('qrcode', '');
                            return;
                        }
                        if (mainWindow) mainWindow.webContents.send('qrcode', url);
                    });
                },
                () => { if (mainWindow) mainWindow.webContents.send('ready'); },
                (reason) => {
                    const campaign = whatsappLogic.getCampaignStatus();
                    if (campaign.id && campaign.status !== 'inactive') {
                        store.set('campaign', campaign);
                        logToRenderer('main.js: Persisted campaign state on disconnect.', campaign);
                    }
                    if (mainWindow) mainWindow.webContents.send('disconnected', reason);
                },
                (msg) => {
                    if (mainWindow) mainWindow.webContents.send('auth-failure', msg);
                }
            );
            return { success: true };
        } catch (error) {
            logToRenderer('Failed to logout and clear session:', error);
            return { success: false, error: error.message };
        }
    });

    // --- File System Handlers ---

    ipcMain.handle('open-file-dialog', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
        });
        return canceled ? null : filePaths[0];
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
            logToRenderer('Failed to copy media:', error);
            return null;
        }
    });

    ipcMain.handle('read-file-content', async (event, filePath) => {
        try {
            const fileContent = await fs.readFile(filePath);
            logToRenderer(`main.js: Read file ${filePath}, size: ${fileContent.length} bytes.`);
            return fileContent.buffer;
        } catch (error) {
            logToRenderer('Failed to read file content:', error);
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
            logToRenderer('Failed to write Excel file:', error);
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
            const headers = await whatsappLogic.getExcelHeaders(excelPathToUse);
            return { success: true, headers, path: excelPathToUse };
        } catch (error) {
            logToRenderer('Failed to get Excel headers:', error);
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
            logToRenderer('Failed to get first Excel row:', error);
            return { success: false, error: error.message };
        }
    });

    // New IPC handler to get client status
    ipcMain.handle('get-client-status', () => {
        return whatsappLogic.getClientStatus();
    });

    // Handler for forcing the app to quit without confirmation
    ipcMain.handle('forceQuitApp', () => {
        const campaign = whatsappLogic.getCampaignStatus();
        if (campaign.id && campaign.status !== 'inactive') {
            store.set('campaign', campaign);
            logToRenderer('main.js: Persisted campaign state on force quit.', campaign);
        }
        app.isQuitting = true;
        app.quit();
    });
}