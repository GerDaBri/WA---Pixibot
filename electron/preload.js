const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Campaign lifecycle
    initializeClient: () => ipcRenderer.invoke('initialize-client'),
    getCampaignStatus: () => ipcRenderer.invoke('get-campaign-status'),
    saveCampaignConfig: (config) => ipcRenderer.invoke('save-campaign-config', config),
    updateCampaignConfig: (config) => ipcRenderer.invoke('update-campaign-config', config),
    clearCampaignState: () => ipcRenderer.invoke('clear-campaign-state'),
    startSending: (config) => ipcRenderer.invoke('start-sending', config),
    pauseSending: (campaignId) => ipcRenderer.invoke('pause-sending', campaignId),
    resumeSending: (campaignId) => ipcRenderer.invoke('resume-sending', campaignId),
    stopSending: (campaignId) => ipcRenderer.invoke('stop-sending', campaignId),
    logout: () => ipcRenderer.invoke('logout'),
    forceQuitApp: () => ipcRenderer.invoke('forceQuitApp'),

    // License management
    loginUser: (email, password) => ipcRenderer.invoke('login-user', email, password),
    checkLicenseStatus: () => ipcRenderer.invoke('check-license-status'),
    resetLicenseData: () => ipcRenderer.invoke('reset-license-data'),
    recalculateDaysRemaining: () => ipcRenderer.invoke('recalculate-days-remaining'),

    // File system
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    openMediaDialog: () => ipcRenderer.invoke('open-media-dialog'),
    readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),
    writeExcelFile: (fileContentBuffer) => ipcRenderer.invoke('write-excel-file', fileContentBuffer),
    getExcelHeaders: () => ipcRenderer.invoke('get-excel-headers'),
    getFirstExcelRow: () => ipcRenderer.invoke('get-first-excel-row'),
    getClientStatus: () => ipcRenderer.invoke('get-client-status'),

    // Event listeners
    on: (channel, callback) => {
        const subscription = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
            ipcRenderer.removeListener(channel, subscription);
        };
    },
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
