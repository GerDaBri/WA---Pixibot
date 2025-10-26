import React from 'react';
import { Text, Spinner } from '@fluentui/react-components';

const SessionStatusIndicator = ({ sessionStatus, onReconnect, onLogout }) => {
    const getStatusConfig = (status) => {
        switch (status) {
            case 'initializing':
                return {
                    color: '#0078d4',
                    icon: '⏳',
                    text: 'Inicializando...',
                    description: 'Conectando con WhatsApp Web'
                };
            case 'qr_received':
            case 'not_ready':
                return {
                    color: '#0078d4',
                    icon: '📱',
                    text: 'QR Pendiente',
                    description: 'Escanea el código QR para conectar'
                };
            case 'ready':
                return {
                    color: '#107c10',
                    icon: '✅',
                    text: 'Conectado',
                    description: 'Sesión de WhatsApp activa'
                };
            case 'disconnected':
                return {
                    color: '#d13438',
                    icon: '❌',
                    text: 'Desconectado',
                    description: 'Sesión cerrada o error de conexión'
                };
            case 'auth_failure':
                return {
                    color: '#d13438',
                    icon: '🔒',
                    text: 'Error de Autenticación',
                    description: 'Fallo en la autenticación de WhatsApp'
                };
            default:
                return {
                    color: '#605e5c',
                    icon: '❓',
                    text: 'Estado Desconocido',
                    description: 'Estado no definido'
                };
        }
    };

    const config = getStatusConfig(sessionStatus);

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            backgroundColor: `${config.color}10`,
            border: `1px solid ${config.color}30`,
            borderRadius: '4px',
            margin: '8px 0'
        }}>
            <Text style={{ color: config.color, fontWeight: '500' }}>
                {config.icon} {config.text}
            </Text>
            {sessionStatus === 'initializing' && <Spinner size="tiny" />}
            {/* Removed buttons for disconnected status as auto-reconnection is now handled */}
        </div>
    );
};

export default SessionStatusIndicator;
