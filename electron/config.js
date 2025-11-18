// Electron main process configuration
const { app } = require('electron');
const isPackaged = app.isPackaged;

module.exports = {
    // Server URL for license verification - switches based on packaging
    serverUrl: isPackaged
        ? 'https://licencias.superbotsx.com' // Production server (packaged)
        : 'http://localhost/servidor/', // Local development server (unpacked)

    // License check interval (2 days in milliseconds)
    licenseCheckInterval:  60 * 60 * 24 * 2 * 1000,

    //2 minutes in milliseconds
    //licenseCheckInterval: 2 * 60 * 1000,

    // App name - dynamically retrieved from package.json via Electron
    // This ensures the correct brand name is used during build
    get appName() {
        return app.getName();
    },

    // Environment info
    isPackaged: isPackaged,
    isDevelopment: !isPackaged
};