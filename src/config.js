// Application configuration
// Note: In renderer process, we can't directly access app.isPackaged
// We'll use a simple heuristic: if we're running on localhost:3000, we're in development
const isDevelopment = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';

export const config = {
    // Server URL for license verification - switches based on environment
    serverUrl: isDevelopment
        ? 'http://localhost/servidor/'  // Local development server
        : 'https://licencias.superbotsx.com', // Production server

    // License check interval (7 days in milliseconds)
    licenseCheckInterval: 2 * 24 * 60 * 60 * 1000,

    // App name
    appName: 'Pixibot',

    // Environment info
    isDevelopment: isDevelopment
};