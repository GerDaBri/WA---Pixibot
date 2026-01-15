/**
 * WhatsApp Adapter Factory
 *
 * Factory module for creating WhatsApp adapters.
 * Currently supports Baileys adapter (default).
 */

const BaileysAdapter = require('./baileys-adapter');

// Available adapter types
const ADAPTER_TYPES = {
    BAILEYS: 'baileys'
};

// Default adapter
const DEFAULT_ADAPTER = ADAPTER_TYPES.BAILEYS;

/**
 * Create a WhatsApp adapter instance
 * @param {string} type - Adapter type ('baileys')
 * @returns {BaseWhatsAppAdapter} - Adapter instance
 */
function createAdapter(type = DEFAULT_ADAPTER) {
    switch (type.toLowerCase()) {
        case ADAPTER_TYPES.BAILEYS:
            return new BaileysAdapter();

        default:
            console.warn(`Unknown adapter type: ${type}, falling back to default (${DEFAULT_ADAPTER})`);
            return new BaileysAdapter();
    }
}

/**
 * Get the default adapter type
 * @returns {string}
 */
function getDefaultAdapterType() {
    return DEFAULT_ADAPTER;
}

/**
 * Get all available adapter types
 * @returns {object}
 */
function getAdapterTypes() {
    return { ...ADAPTER_TYPES };
}

module.exports = {
    createAdapter,
    getDefaultAdapterType,
    getAdapterTypes,
    ADAPTER_TYPES,

    // Direct class exports for convenience
    BaileysAdapter
};
