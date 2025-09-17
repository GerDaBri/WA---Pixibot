const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

let client = null;
let clientReadyPromise = null;
let resolveClientReady = null;
let isClientInitializing = false;

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
};

let campaignState = { ...initialCampaignState };
// --- End of Centralized Campaign State ---


/**
 * Initializes the WhatsApp client.
 * @param {function(string)} onQrCode - Callback for when a QR code is generated.
 * @param {function()} onClientReady - Callback for when the client is ready.
 * @param {function()} onDisconnected - Callback for when the client is disconnected.
 * @param {function(string)} onAuthFailure - Callback for authentication failure.
 */
async function initializeClient(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure) {
    console.log("initializeClient called.");

    // If initialization is already in progress, wait for it to complete.
    if (isClientInitializing) {
        console.log("Client initialization already in progress. Waiting for it to complete.");
        if (clientReadyPromise) {
            try {
                await clientReadyPromise;
                console.log("Existing client initialization completed successfully.");
                if (onClientReady) onClientReady();
            } catch (e) {
                console.error("Ongoing client initialization failed:", e.message);
                if (onAuthFailure) onAuthFailure(e.message);
            }
            return;
        }
    }

    // If client is already initialized and ready, skip re-initialization.
    if (client && client.info) {
        console.log("Client already ready, skipping re-initialization.");
        if (onClientReady) onClientReady();
        return;
    }

    console.log("Starting new client initialization process...");
    isClientInitializing = true;

    // Create a new promise for this initialization attempt
    clientReadyPromise = new Promise((resolve, reject) => {
        resolveClientReady = resolve;
        rejectClientReady = reject;
    });

    if (!client) {
        console.log("Client instance not found. Creating new client...");
        try {
            const { findChrome } = await import('find-chrome-bin');
            const chromeInfo = await findChrome();
            const executablePath = chromeInfo.executablePath;
            console.log("Chrome executable found at:", executablePath);

            client = new Client({
                authStrategy: new LocalAuth({ clientId: 'new_client', dataPath }),
                puppeteer: {
                executablePath,
                headless: true,
                args: [
                    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                    '--disable-gpu', '--disable-site-isolation-trials', '--disable-gpu-sandbox',
                    '--disable-software-rasterizer', '--shm-size=1gb'
                ],
            },
            });

            client.on('qr', qr => {
                console.log('QR CODE RECEIVED:', qr);
                if (onQrCode) onQrCode(qr);
            });
            client.on('ready', () => {
                console.log('Client is ready!');
                if (onClientReady) onClientReady();
                if (resolveClientReady) {
                    resolveClientReady();
                    resolveClientReady = null;
                    rejectClientReady = null;
                }
                isClientInitializing = false;
            });
            client.on('auth_failure', msg => {
                console.error('AUTHENTICATION FAILURE', msg);
                if (onAuthFailure) onAuthFailure(msg);
                if (rejectClientReady) rejectClientReady(new Error('Authentication failure: ' + msg));
                resolveClientReady = null;
                rejectClientReady = null;
                isClientInitializing = false;
            });
            client.on('disconnected', async (reason) => { // Make it async to await softLogoutAndReinitialize
                console.log('Client was disconnected:', reason);
                if (campaignState.status === 'running') {
                    //stopSending(campaignState.id, 'disconnected');
                    pauseSending(campaignState.id);
                    console.log("whatsapp-logic: Client disconnected while campaign active. Attempting re-initialization...");
                }
                if (onDisconnected) onDisconnected(reason);
                
                // Attempt to re-initialize the client after a disconnect
                // This will try to use the existing session files
                console.log("Attempting to re-initialize client after disconnect...");
                try {
                    // Pass the same callbacks to maintain communication with main process
                    await softLogoutAndReinitialize(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure);
                    console.log("Client re-initialization after disconnect successful.");
                } catch (reinitError) {
                    console.error("Failed to re-initialize client after disconnect:", reinitError.message);
                    // If re-initialization fails, then we can consider the client truly disconnected
                    // and potentially inform the user to restart or clear session.
                    // No need to reject clientReadyPromise here, as it's a new attempt.
                } finally {
                    isClientInitializing = false; // Ensure this is reset
                    resolveClientReady = null; // Clear any pending promises
                    rejectClientReady = null;
                }
            });
        } catch (e) {
            console.error("Failed to import or find Chrome or create client instance:", e);
            isClientInitializing = false;
            const errorMessage = e.message.includes('find-chrome-bin') ? "Chrome could not be found." : e.message;
            if(onAuthFailure) onAuthFailure(errorMessage);
            if (rejectClientReady) rejectClientReady(e);
            resolveClientReady = null;
            rejectClientReady = null;
            return;
        }
    } else {
        console.log("Client instance already exists. Attempting to re-initialize it.");
    }

    try {
        const initTimeoutMs = 90 * 1000;
        console.log("Calling client.initialize() with a timeout of", initTimeoutMs / 1000, "seconds.");
        await Promise.race([
            client.initialize(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Client initialization timed out')), initTimeoutMs))
        ]);
        console.log("Client initialized successfully.");
    } catch (error) {
        console.error("Error during client.initialize() or timeout:", error.message);
        console.error("Stack trace:", error.stack);
        // Do NOT logoutAndClearSession here. Let the user decide or retry with existing session.
        if (onAuthFailure) onAuthFailure(error.message);
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
            campaignState.id
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
 * A delay that can be interrupted by a 'stopping' campaign status.
 * @param {number} ms - The total milliseconds to wait.
 */
async function controlledDelay(ms) {
    const endTime = Date.now() + ms;

    while (Date.now() < endTime) {
        if (campaignState.status === 'stopping' || campaignState.status === 'paused') {
            console.log(`controlledDelay: Signal '${campaignState.status}' received, aborting delay.`);
            return;
        }

        const remaining = endTime - Date.now();
        const waitTime = Math.min(remaining, 1000); // Check every second
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
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
            if (i < maxRetries - 1) {
                await delay(5000); // Wait before retrying
            } else {
                throw new Error(`Failed to send message to ${chatId} after ${maxRetries} attempts: ${error.message}`);
            }
        }
    }
}

/**
 * Restarts the sending process from a persisted campaign state.
 * @param {object} persistedCampaign - The campaign object from the store.
 * @param {function} callbackProgress - Callback to report progress.
 */
function restartSendingFromState(persistedCampaign, callbackProgress, logCallback) {
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
 * @param {number} initialStartIndex - The index to start sending from (for resuming).
 * @param {string|null} campaignId - The ID of the campaign if it's being resumed.
 */
async function startSending(config, callbackProgress, logCallback, initialStartIndex = 0, campaignId = null) {
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
        campaignState.config.currentIndex = initialStartIndex > 0 ? initialStartIndex : (config.currentIndex > 0 ? config.currentIndex : 0);
        campaignState.sentCount = 0; // Reset for new campaign
        campaignState.contacts = []; // Reset contacts for a new campaign
        campaignState.totalContacts = 0;
    }
    // --- Or link to an existing, resumed campaign ---
    else {
        campaignState.id = campaignId;
        campaignState.status = 'running'; // Set to running to start the loop
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
            const excel = XLSX.readFile(excelPath);
            const nombreHoja = excel.SheetNames[0];
            campaignState.contacts = XLSX.utils.sheet_to_json(excel.Sheets[nombreHoja]);
            campaignState.totalContacts = campaignState.contacts.length;
            console.log(`whatsapp-logic: Data from '${nombreHoja}' sheet:`, campaignState.totalContacts, "rows.");
        }
        
        notifyProgress(); // Initial progress update

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
                    let processedMessage = message.replace(/{{(.*?)}}/g, (match, key) => dato[key.trim()] || ' ');

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
                    if (supervisorNumbers && supervisorNumbers.length > 0) {
                        for (const supNum of supervisorNumbers) {
                            await client.sendMessage(`${supNum}@c.us`, pauseMessage);
                        }
                    }
                    await controlledDelay(tiempoPausa); // USE CONTROLLED DELAY
                    if (campaignState.status !== 'stopping') {
                        
                    }
                } else {
                    // Apply send delay only if not doing a long pause
                    await controlledDelay(sendDelay * 1000); // USE CONTROLLED DELAY
                }

            } else {
                console.log(`El contacto ${numero} es invalido, no se le envió mensaje`);
                campaignState.config.currentIndex = i + 1; // Skip invalid contact
                notifyProgress();
            }
        } // --- End of loop ---

        if (campaignState.status !== 'stopping') {
            campaignState.status = 'finished';
            const finalMessage = `🏁 CAMPAÑA FINALIZADA

📊 Total de mensajes enviados: ${campaignState.sentCount}`;
            if (supervisorNumbers && supervisorNumbers.length > 0) {
                for (const supNum of supervisorNumbers) {
                    await client.sendMessage(`${supNum}@c.us`, finalMessage);
                }
            }
            
        }

    } catch (error) {
        console.error("whatsapp-logic: CRITICAL Error during message sending:", error.message, error.stack);
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
async function softLogoutAndReinitialize(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure) {
    console.log("softLogoutAndReinitialize called.");
    if (client) {
        try {
            console.log("Attempting client.logout()...");
            await client.logout();
            console.log("client.logout() successful.");
        }
        catch (error) {
            console.error("Error during client.logout():", error.message);
        }
    }
    await destroyClientInstance(); // Clean up client object
    console.log("Client instance destroyed after soft logout.");

    // Now reinitialize the client
    await initializeClient(dataPath, onQrCode, onClientReady, onDisconnected, onAuthFailure);
    console.log("Client reinitialized after soft logout.");
}

async function destroyClientInstance() {
    if (client) {
        console.log("Attempting to destroy client instance...");
        try {
            const destroyTimeoutMs = 60 * 1000; // 60 seconds for general destroy
            await Promise.race([
                client.destroy(),
                new Promise((_, reject) => setTimeout(() => {
                    console.warn("Client destroy timed out.");
                    reject(new Error('Client destroy timeout'));
                }, destroyTimeoutMs))
            ]);
            console.log("Client instance destroyed successfully.");
        } catch (error) {
            console.error("Error destroying client instance:", error.message);
        } finally {
            client = null;
        }
    } else {
        console.log("No active client instance to destroy.");
    }
}

/**
 * Logs out, destroys the client, and clears the session folder to allow for a new QR code.
 */
async function logoutAndClearSession(dataPath) {
    await destroyClientInstance(); // Use the new helper function

    // Add a small delay to ensure file handles are released
    await delay(2000); // 2 seconds delay

    // After ensuring the client is destroyed, delete the session folder
    try {
        // The path is relative to this file's location in /bot, so we go one level up.
        const sessionPath = dataPath;
        if (fs.existsSync(sessionPath)) {
            console.log(`Attempting to delete session folder: ${sessionPath}`);
            // Use fs.promises.rm for modern async/await syntax
            await fs.promises.rm(sessionPath, { recursive: true, force: true });
            console.log("Session folder successfully deleted.");
        } else {
            console.log("Session folder not found, no deletion needed.");
        }
    } catch (error) {
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
    if (isClientInitializing) {
        return { status: 'initializing' };
    }
    if (client && client.info) {
        return { status: 'ready', phoneNumber: client.info.wid.user };
    }
    if (client) {
        return { status: 'not_ready' }; // Client exists but not ready (e.g., QR code pending)
    }
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
    softLogoutAndReinitialize // Export the new function
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
 * Reads the Excel file and returns the headers of the "Datos Limpios" sheet.
 * @param {string} excelPath - The absolute path to the Excel file.
 * @returns {Promise<string[]>} A promise that resolves with an array of header strings.
 */
async function getExcelHeaders(excelPath) {
    try {
        const excel = XLSX.readFile(excelPath);
        const nombreHoja = excel.SheetNames[0];
        const sheet = excel.Sheets[nombreHoja];
        if (!sheet) {
            console.warn("whatsapp-logic: 'Datos Limpios' sheet not found in Excel file.");
            return [];
        }
        const datos = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Get data as array of arrays
        if (datos.length > 0) {
           const headers = datos[0]; // First row is the header
            return headers.filter(header => header !== 'item' && header !== 'numero' && header !== 'Numero' && header !== 'Item');
        }
        return [];
    } catch (error) {
        console.error("whatsapp-logic: Error reading Excel headers:", error);
        throw error;
    }
}
