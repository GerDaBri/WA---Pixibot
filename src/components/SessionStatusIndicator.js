import React from 'react';
import { Text, Spinner } from '@fluentui/react-components';
import {
    HourglassHalf20Regular,
    Phone20Regular,
    CheckmarkCircle20Filled,
    DismissCircle20Filled,
    LockClosed20Regular,
    Question20Regular
} from '@fluentui/react-icons';

const SessionStatusIndicator = ({ sessionStatus, onReconnect, onLogout }) => {
    const getStatusConfig = (status) => {
        switch (status) {
            case 'initializing':
                return {
                    color: '#0078d4',
                    Icon: HourglassHalf20Regular,
                    text: 'Inicializando...',
                    description: 'Conectando con WhatsApp Web'
                };
            case 'qr_received':
            case 'not_ready':
                return {
                    color: '#0078d4',
                    Icon: Phone20Regular,
                    text: 'QR Pendiente',
                    description: 'Escanea el código QR para conectar'
                };
            case 'ready':
                return {
                    color: '#107c10',
                    Icon: CheckmarkCircle20Filled,
                    text: 'Conectado',
                    description: 'Sesión de WhatsApp activa'
                };
            case 'disconnected':
                return {
                    color: '#d13438',
                    Icon: DismissCircle20Filled,
                    text: 'Desconectado',
                    description: 'Sesión cerrada o error de conexión'
                };
            case 'auth_failure':
                return {
                    color: '#d13438',
                    Icon: LockClosed20Regular,
                    text: 'Error de Autenticación',
                    description: 'Fallo en la autenticación de WhatsApp'
                };
            default:
                return {
                    color: '#605e5c',
                    Icon: Question20Regular,
                    text: 'Estado Desconocido',
                    description: 'Estado no definido'
                };
        }
    };

    const config = getStatusConfig(sessionStatus);
    const StatusIcon = config.Icon;

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
            <StatusIcon style={{ color: config.color, fontSize: '16px', flexShrink: 0 }} />
            <Text style={{ color: config.color, fontWeight: '500' }}>
                {config.text}
            </Text>
            {sessionStatus === 'initializing' && <Spinner size="tiny" />}
            {/* Removed buttons for disconnected status as auto-reconnection is now handled */}
        </div>
    );
};

export default SessionStatusIndicator;
