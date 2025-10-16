const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const os = require('os');

// Función para cargar configuración de Puppeteer desde JSON
function loadPuppeteerConfig(configPath) {
    try {
        if (fs.existsSync(configPath)) {
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
    logger?.info(`${logPrefix}: Starting Chrome executable detection`);
    
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
                        await fs.promises.access(chromePath, fs.constants.F_OK | fs.constants.X_OK);
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
                    await fs.promises.access(executablePath, fs.constants.F_OK | fs.constants.X_OK);
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
        try {
            logger?.info(`${logPrefix}: Trying method: ${method.name}`);
            const executablePath = await method.detect();
            
            // Validate the executable
            try {
                await fs.promises.access(executablePath, fs.constants.F_OK | fs.constants.X_OK);
                logger?.info(`${logPrefix}: Successfully detected Chrome executable: ${executablePath}`);
                return executablePath;
            } catch (accessError) {
                throw new Error(`Path not accessible: ${accessError.message}`);
            }
            
        } catch (error) {
            lastError = error;
            logger?.warn(`${logPrefix}: Method '${method.name}' failed: ${error.message}`);
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
        if (fs.existsSync(actualConfigPath)) {
            logger?.info(`${logPrefix}: Config loaded from file: ${actualConfigPath}`);
        } else {
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
    config: null,
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
        if (clientReadyPromise) {
            try {
                await clientReadyPromise;
                logger?.info(`${logPrefix}: Existing client initialization completed successfully.`);
                console.log("Existing client initialization completed successfully.");
                if (onClientReady) onClientReady();
            } catch (e) {
                logger?.error(`${logPrefix}: Ongoing client initialization failed: ${e.message}`);
                console.error("Ongoing client initialization failed:", e.message);
                if (onAuthFailure) onAuthFailure(e.message);
            }
            return;
        }
    }

    // If client is already initialized and ready, skip re-initialization.
    if (client && client.info) {
        logger?.info(`${logPrefix}: Client already ready, skipping re-initialization.`);
        console.log("Client already ready, skipping re-initialization.");
        if (onClientReady) onClientReady();
        return;
    }

    logger?.info(`${logPrefix}: Starting new client initialization process...`);
    console.log("Starting new client initialization process...");
    isClientInitializing = true;

    // Create a new promise for this initialization attempt
    clientReadyPromise = new Promise((resolve, reject) => {
        resolveClientReady = resolve;
        rejectClientReady = reject;
    });

    if (!client) {
        logger?.info(`${logPrefix}: Client instance not found. Creating new client...`);
        console.log("Client instance not found. Creating new client...");
        
        try {
            // Use robust Chrome detection
            logger?.info(`${logPrefix}: Starting Chrome executable detection...`);
            const executablePath = await detectChromeExecutable();
            logger?.info(`${logPrefix}: Chrome executable detected successfully: ${executablePath}`);
            console.log("Chrome executable found at:", executablePath);

            // Create client with enhanced error handling
            logger?.info(`${logPrefix}: Creating WhatsApp client instance...`);
            client = await createWhatsAppClient(dataPath, executablePath);
            logger?.info(`${logPrefix}: WhatsApp client instance created successfully`);

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
                
                if (logCallback) logCallback('whatsapp-logic: WhatsApp client is ready and authenticated');
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
                logger?.warn(`${logPrefix}: Client disconnected: ${reason}`);
                console.log('Client was disconnected:', reason);
                if (logCallback) logCallback(`whatsapp-logic: WhatsApp client disconnected: ${reason}`);
                
                if (campaignState.status === 'running') {
                    pauseSending(campaignState.id);
                    logger?.info(`${logPrefix}: Campaign paused due to disconnection, attempting re-initialization...`);
                    console.log("whatsapp-logic: Client disconnected while campaign active. Attempting re-initialization...");
                    if (logCallback) logCallback('whatsapp-logic: Campaign paused due to disconnection, attempting re-initialization');
                }
                if (onDisconnected) onDisconnected(reason);
                
                // Attempt to re-initialize the client after a disconnect
                logger?.info(`${logPrefix}: Attempting to re-initialize client after disconnect...`);
                console.log("Attempting to re-initialize client after disconnect...");
                try {
                    await softLogoutAndReinitialize(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir);
                    logger?.info(`${logPrefix}: Client re-initialization after disconnect successful.`);
                    console.log("Client re-initialization after disconnect successful.");
                } catch (reinitError) {
                    logger?.error(`${logPrefix}: Failed to re-initialize client after disconnect: ${reinitError.message}`);
                    console.error("Failed to re-initialize client after disconnect:", reinitError.message);
                } finally {
                    isClientInitializing = false;
                    resolveClientReady = null;
                    rejectClientReady = null;
                }
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
        logger?.info(`${logPrefix}: Calling client.initialize() with timeout of ${initTimeoutMs / 1000} seconds.`);
        console.log("Calling client.initialize() with a timeout of", initTimeoutMs / 1000, "seconds.");
        
        await Promise.race([
            client.initialize(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Client initialization timed out after 2 minutes')), initTimeoutMs))
        ]);
        
        logger?.info(`${logPrefix}: Client initialized successfully.`);
        console.log("Client initialized successfully.");
    } catch (error) {
        logger?.error(`${logPrefix}: Error during client.initialize(): ${error.message}`);
        logger?.error(`${logPrefix}: Error stack: ${error.stack}`);
        console.error("Error during client.initialize() or timeout:", error.message);
        console.error("Stack trace:", error.stack);
        
        let userFriendlyMessage = error.message;
        if (error.message.includes('timeout')) {
            userFriendlyMessage = "La inicialización del cliente tardó demasiado tiempo. Esto puede deberse a problemas de red o con Chrome. Intente nuevamente.";
        }
        
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
                return match; // Devolver la variable original si no se encuentra
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

                await sendMessageWithRetries(chatId, processedNotification, null, 3, 30000);

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
 * Sends a message with retries.
 * @param {string} chatId - The chat ID to send the message to.
 * @param {string} message - The message text.
 * @param {MessageMedia} media - Optional media to send.
 * @param {number} maxRetries - Maximum number of retries.
 * @param {number} timeout - Timeout for each send attempt in milliseconds.
 */
async function sendMessageWithRetries(chatId, message, media = null, maxRetries = 3, timeout = 60000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const sendPromise = media ? client.sendMessage(chatId, media, { caption: message }) : client.sendMessage(chatId, message);
            await Promise.race([
                sendPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Message send timeout')), timeout))
            ]);
            return; // Message sent successfully
        } catch (error) {
            console.error(`Attempt ${i + 1} failed to send message to ${chatId}:`, error.message);
            if (logCallback) logCallback(`whatsapp-logic: Message send attempt ${i + 1} failed for ${chatId}: ${error.message}`);
            if (i < maxRetries - 1) {
                await delay(5000); // Wait before retrying
            } else {
                if (logCallback) logCallback(`whatsapp-logic: Failed to send message to ${chatId} after ${maxRetries} attempts`);
                throw new Error(`Failed to send message to ${chatId} after ${maxRetries} attempts: ${error.message}`);
            }
        }
    }
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
    campaignState.progressCallback = callbackProgress;
    campaignState.logCallback = logCallback; // Store logCallback
    campaignState.countdownCallback = countdownCallback; // Store countdownCallback

    // Initialize countdown state for restored campaign
    setCountdownState('idle');

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
        campaignState.countdownCallback = countdownCallback; // Store countdownCallback
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
            const excel = XLSX.readFile(excelPath);
            const nombreHoja = excel.SheetNames[0];
            campaignState.contacts = XLSX.utils.sheet_to_json(excel.Sheets[nombreHoja]);
            campaignState.totalContacts = campaignState.contacts.length;
            console.log(`whatsapp-logic: Data from '${nombreHoja}' sheet:`, campaignState.totalContacts, "rows.");
            if (logCallback) logCallback(`whatsapp-logic: Loaded ${campaignState.totalContacts} contacts from sheet '${nombreHoja}'`);
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
                const chatId = (`+${numero}@c.us`).substring(1);

                try {
                    let media = mediaPath ? MessageMedia.fromFilePath(mediaPath) : null;

                    // Debug: Log del contacto actual y mensaje antes del procesamiento
                    console.log(`whatsapp-logic: DEBUG - Contacto actual (index ${currentIndex}):`, JSON.stringify(dato, null, 2));
                    console.log(`whatsapp-logic: DEBUG - Mensaje original:`, message);

                    // Usar la función processMessageVariables para reemplazar correctamente las variables
                    let processedMessage = processMessageVariables(message, dato);

                    console.log(`whatsapp-logic: DEBUG - Mensaje procesado:`, processedMessage);

                    if (messageType == 1) { // Text only
                        await sendMessageWithRetries(chatId, processedMessage, null, maxRetries, timeout);
                    } else if (messageType == 2) { // Media message
                        await sendMessageWithRetries(chatId, processedMessage, media, maxRetries, timeout);
                    }
                    
                    logCallback(`[${currentIndex + 1}] - Mensaje a contacto ${numero} enviado`);
                    campaignState.sentCount++;
                    campaignState.config.currentIndex++; // Move to next index
                    notifyProgress();

                } catch (sendError) {
                    console.error(`whatsapp-logic: Failed to send message to ${numero}:`, sendError.message);
                    if (supervisorNumbers && supervisorNumbers.length > 0) {
                        for (const supNum of supervisorNumbers) {
                            await client.sendMessage(`${supNum}@c.us`, `⚠️ Error al enviar mensaje a ${numero}: ${sendError.message}`);
                        }
                    }
                }

                // --- Handle scheduled pause ---
                if (campaignState.sentCount > 0 && campaignState.sentCount % pausaCada === 0) {
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
                } else {
                    // Apply send delay only if not doing a long pause
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
                    await client.sendMessage(`${supNum}@c.us`, finalMessage);
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
 * Logs out the client without clearing the session folder, then reinitializes.
 * This allows for potential automatic re-login if session files are valid.
 */
async function softLogoutAndReinitialize(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir = null) {
    const logPrefix = 'Soft Logout & Reinitialize';
    logger?.info(`${logPrefix}: softLogoutAndReinitialize called.`);
    console.log("🔄 whatsapp-logic: softLogoutAndReinitialize called.");
    
    if (client) {
        try {
            logger?.info(`${logPrefix}: Attempting client.logout()...`);
            console.log("🚪 whatsapp-logic: Attempting client.logout()...");
            await client.logout();
            logger?.info(`${logPrefix}: client.logout() successful.`);
            console.log("✅ whatsapp-logic: client.logout() successful.");
        }
        catch (error) {
            logger?.error(`${logPrefix}: Error during client.logout(): ${error.message}`);
            console.error("❌ whatsapp-logic: Error during client.logout():", error.message);
        }
    }
    
    await destroyClientInstance(); // Clean up client object
    logger?.info(`${logPrefix}: Client instance destroyed after soft logout.`);
    console.log("🧹 whatsapp-logic: Client instance destroyed after soft logout.");

    // Reset the initialization flag to ensure clean re-initialization
    isClientInitializing = false;
    logger?.info(`${logPrefix}: Reset isClientInitializing to false before re-initialization`);
    console.log("🔄 whatsapp-logic: Reset isClientInitializing to false before re-initialization");

    // Now reinitialize the client with the same callbacks
    logger?.info(`${logPrefix}: Re-initializing client with callbacks...`);
    console.log("🚀 whatsapp-logic: Re-initializing client with callbacks...");
    await initializeClient(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure, logsDir);
    logger?.info(`${logPrefix}: Client reinitialized after soft logout.`);
    console.log("✅ whatsapp-logic: Client reinitialized after soft logout.");
}

async function destroyClientInstance() {
    const logPrefix = 'Client Destroy';
    if (client) {
        logger?.info(`${logPrefix}: Attempting to destroy client instance...`);
        console.log("Attempting to destroy client instance...");
        try {
            const destroyTimeoutMs = 60 * 1000; // 60 seconds for general destroy
            await Promise.race([
                client.destroy(),
                new Promise((_, reject) => setTimeout(() => {
                    logger?.warn(`${logPrefix}: Client destroy timed out.`);
                    console.warn("Client destroy timed out.");
                    reject(new Error('Client destroy timeout'));
                }, destroyTimeoutMs))
            ]);
            logger?.info(`${logPrefix}: Client instance destroyed successfully.`);
            console.log("Client instance destroyed successfully.");
        } catch (error) {
            logger?.error(`${logPrefix}: Error destroying client instance: ${error.message}`);
            console.error("Error destroying client instance:", error.message);
        } finally {
            client = null;
        }
    } else {
        logger?.info(`${logPrefix}: No active client instance to destroy.`);
        console.log("No active client instance to destroy.");
    }
}

/**
 * Logs out, destroys the client, and clears the session folder to allow for a new QR code.
 */
async function logoutAndClearSession(dataPath) {
    const logPrefix = 'Logout & Clear Session';
    logger?.info(`${logPrefix}: Starting logout and session clear process for path: ${dataPath}`);
    
    await destroyClientInstance(); // Use the new helper function

    // Add a small delay to ensure file handles are released
    logger?.info(`${logPrefix}: Waiting 2 seconds for file handles to be released...`);
    await delay(2000); // 2 seconds delay

    // After ensuring the client is destroyed, delete the session folder
    try {
        const sessionPath = dataPath;
        if (fs.existsSync(sessionPath)) {
            logger?.info(`${logPrefix}: Attempting to delete session folder: ${sessionPath}`);
            console.log(`Attempting to delete session folder: ${sessionPath}`);
            // Use fs.promises.rm for modern async/await syntax
            await fs.promises.rm(sessionPath, { recursive: true, force: true });
            logger?.info(`${logPrefix}: Session folder successfully deleted.`);
            console.log("Session folder successfully deleted.");
        } else {
            logger?.info(`${logPrefix}: Session folder not found, no deletion needed.`);
            console.log("Session folder not found, no deletion needed.");
        }
    } catch (error) {
        logger?.error(`${logPrefix}: Error deleting session folder: ${error.message}`);
        console.error(`Error deleting session folder: ${error.message}`);
        // This error should be propagated to the UI to inform the user.
        throw new Error(`Failed to delete session folder. Please try deleting it manually. Path: ${dataPath}`);
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
    destroyClientInstance, // Export the new helper function
    getExcelHeaders,
    getFirstExcelRow, // Export the new function
    getClientStatus, // Export the new function
    softLogoutAndReinitialize, // Export the new function
    setCountdownState, // Export countdown function
    notifyCountdown, // Export countdown notification function
    processMessageVariables, // Export message variable processing function
    sendCampaignStartNotification // Export campaign start notification function
};

/**
 * Reads the Excel file and returns the first row of the "Datos Limpios" sheet as an object.
 * @param {string} excelPath - The absolute path to the Excel file.
 * @returns {Promise<object|null>} A promise that resolves with the first row data as an object, or null if not found.
 */
async function getFirstExcelRow(excelPath) {
    try {
        const excel = XLSX.readFile(excelPath);
        const nombreHoja = excel.SheetNames[0];
        const sheet = excel.Sheets[nombreHoja];
        if (!sheet) {
            console.warn("whatsapp-logic: No sheets found in Excel file for first row.");
            return null;
        }
        const datos = XLSX.utils.sheet_to_json(sheet); // Get data as array of objects
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
        const excel = XLSX.readFile(excelPath);
        const nombreHoja = excel.SheetNames[0];
        const sheet = excel.Sheets[nombreHoja];
        if (!sheet) {
            console.warn("whatsapp-logic: 'Datos Limpios' sheet not found in Excel file.");
            return { headers: [], hasRequiredFields: false, missingFields: ['item', 'numero'] };
        }
        const datos = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Get data as array of arrays
        if (datos.length > 0) {
           const rawHeaders = datos[0]; // First row is the header

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
        return { headers: [], hasRequiredFields: false, missingFields: ['item', 'numero'] };
    } catch (error) {
        console.error("whatsapp-logic: Error reading Excel headers:", error);
        throw error;
    }
}
