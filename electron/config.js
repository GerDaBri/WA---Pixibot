// Electron main process configuration
const { app } = require('electron');
const isPackaged = app.isPackaged;

module.exports = {
    // Server URL for license verification - switches based on packaging
    serverUrl: isPackaged
        ? 'https://licencias.superbotsx.com' // Production server (packaged)
        : 'http://localhost/servidor/', // Local development server (unpacked)

    // License check interval (2 days in milliseconds)
    licenseCheckInterval:  60 * 1000,

    //2 minutes in milliseconds
    //licenseCheckInterval: 2 * 60 * 1000, 
    
    // App name
    appName: 'Pixibot',

    // Environment info
    isPackaged: isPackaged,
    isDevelopment: !isPackaged
};