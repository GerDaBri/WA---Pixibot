// Application configuration
// Note: In renderer process, we can't directly access app.isPackaged
// We'll use a simple heuristic: if we're running on localhost:3000, we're in development
import brandConfig from './brandConfig';

const isDevelopment = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';

export const config = {
    // Server URL for license verification - switches based on environment
    serverUrl: isDevelopment
        ? 'http://localhost/servidor/'  // Local development server
        : 'https://licencias.superbotsx.com', // Production server

    // License check interval (2 days in milliseconds)
    licenseCheckInterval: 60 * 60 * 24 * 2 * 1000,

    // App name - dynamically loaded from brand configuration
    appName: brandConfig.displayName,

    // Environment info
    isDevelopment: isDevelopment
};