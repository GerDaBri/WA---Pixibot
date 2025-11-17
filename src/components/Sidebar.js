import React from 'react';
import { Text, makeStyles, shorthands } from '@fluentui/react-components';
import logo from '../../assets/logos/logo-principal.png';

const useStyles = makeStyles({
    sidebar: {
        width: '280px',
        minWidth: '280px',
        height: '100vh',
        backgroundColor: 'var(--sidebar-bg)',
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.padding('var(--spacing-xl)'),
        boxShadow: 'var(--shadow-lg)',
        position: 'relative',
        overflowY: 'auto',
    },
    logoSection: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        ...shorthands.gap('var(--spacing-md)'),
        ...shorthands.padding('var(--spacing-lg)', 0),
        ...shorthands.borderBottom('1px', 'solid', 'rgba(255, 255, 255, 0.1)'),
        marginBottom: 'var(--spacing-xl)',
    },
    logo: {
        width: '80px',
        height: '80px',
        objectFit: 'contain',
    },
    appName: {
        color: 'var(--sidebar-text)',
        fontSize: 'var(--font-size-xl)',
        fontWeight: 'var(--font-weight-bold)',
        letterSpacing: '0.5px',
    },
    section: {
        marginBottom: 'var(--spacing-2xl)',
    },
    sectionTitle: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        marginBottom: 'var(--spacing-lg)',
    },
    stepper: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('0'),
    },
    step: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('var(--spacing-md)'),
        ...shorthands.padding('var(--spacing-md)'),
        ...shorthands.borderRadius('var(--radius-sm)'),
        cursor: 'pointer',
        transition: 'all var(--transition-fast)',
        position: 'relative',
        '&:hover': {
            backgroundColor: 'var(--sidebar-hover)',
        },
    },
    stepActive: {
        backgroundColor: 'var(--sidebar-hover)',
    },
    stepIndicator: {
        width: '32px',
        height: '32px',
        ...shorthands.borderRadius('50%'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-semibold)',
        flexShrink: 0,
        transition: 'all var(--transition-base)',
    },
    stepCompleted: {
        backgroundColor: 'var(--primary-color)',
        color: 'white',
    },
    stepCurrent: {
        backgroundColor: 'var(--primary-color)',
        color: 'white',
        boxShadow: '0 0 0 4px rgba(76, 175, 80, 0.2)',
    },
    stepPending: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        color: 'rgba(255, 255, 255, 0.5)',
        ...shorthands.border('2px', 'dashed', 'rgba(255, 255, 255, 0.2)'),
    },
    stepLabel: {
        color: 'var(--sidebar-text)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-medium)',
    },
    stepConnector: {
        position: 'absolute',
        left: '26px',
        top: '44px',
        width: '2px',
        height: '32px',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    stepConnectorCompleted: {
        backgroundColor: 'var(--primary-color)',
    },
    whatsappStatus: {
        ...shorthands.padding('var(--spacing-lg)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        ...shorthands.border('1px', 'solid', 'rgba(255, 255, 255, 0.1)'),
    },
    statusRow: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('var(--spacing-sm)'),
        marginBottom: 'var(--spacing-sm)',
    },
    statusIcon: {
        fontSize: 'var(--font-size-lg)',
    },
    statusText: {
        color: 'var(--sidebar-text)',
        fontSize: 'var(--font-size-sm)',
        fontWeight: 'var(--font-weight-medium)',
    },
    statusLabel: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 'var(--font-size-xs)',
    },
    licenseInfo: {
        ...shorthands.padding('var(--spacing-lg)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        ...shorthands.border('1px', 'solid', 'rgba(255, 255, 255, 0.1)'),
    },
    licenseRow: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('var(--spacing-sm)'),
        marginBottom: 'var(--spacing-sm)',
        '&:last-child': {
            marginBottom: 0,
        },
    },
    licenseIcon: {
        fontSize: 'var(--font-size-base)',
    },
    licenseText: {
        color: 'var(--sidebar-text)',
        fontSize: 'var(--font-size-sm)',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    daysRemaining: {
        fontWeight: 'var(--font-weight-bold)',
        color: 'var(--primary-color)',
    },
    daysWarning: {
        color: 'var(--color-warning)',
    },
    daysExpired: {
        color: 'var(--color-error)',
    },
});

const Sidebar = ({ currentStep, sessionStatus, licenseDetails, userData }) => {
    const styles = useStyles();

    const steps = [
        { number: 0, label: 'Login', icon: '🔐' },
        { number: 1, label: 'Archivo', icon: '📁' },
        { number: 2, label: 'Configuración', icon: '⚙️' },
        { number: 3, label: 'WhatsApp', icon: '📱' },
        { number: 4, label: 'Envío', icon: '🚀' },
    ];

    const getStepStatus = (stepNumber) => {
        if (stepNumber < currentStep) return 'completed';
        if (stepNumber === currentStep) return 'current';
        return 'pending';
    };

    const getStepIndicatorClass = (status) => {
        if (status === 'completed') return styles.stepCompleted;
        if (status === 'current') return styles.stepCurrent;
        return styles.stepPending;
    };

    const getWhatsAppStatusConfig = (status) => {
        switch (status) {
            case 'ready':
                return { icon: '✅', text: 'Conectado', color: 'var(--color-success)' };
            case 'qr_received':
            case 'not_ready':
                return { icon: '📱', text: 'QR Pendiente', color: 'var(--color-info)' };
            case 'initializing':
                return { icon: '⏳', text: 'Inicializando...', color: 'var(--color-info)' };
            case 'disconnected':
                return { icon: '❌', text: 'Desconectado', color: 'var(--color-error)' };
            case 'auth_failure':
                return { icon: '🔒', text: 'Error Auth', color: 'var(--color-error)' };
            default:
                return { icon: '❓', text: 'Desconocido', color: 'var(--text-color-muted)' };
        }
    };

    const whatsappConfig = getWhatsAppStatusConfig(sessionStatus);

    const getDaysRemainingClass = (days) => {
        if (days <= 0) return styles.daysExpired;
        if (days <= 7) return styles.daysWarning;
        return styles.daysRemaining;
    };

    return (
        <div className={styles.sidebar}>
            {/* Logo Section */}
            <div className={styles.logoSection}>
                <img src={logo} alt="Pixibot Logo" className={styles.logo} />
                <Text className={styles.appName}>Pixibot</Text>
            </div>

            {/* Progress Steps */}
            <div className={styles.section}>
                <div className={styles.sectionTitle}>PROGRESO</div>
                <div className={styles.stepper}>
                    {steps.map((step, index) => {
                        const status = getStepStatus(step.number);
                        const showConnector = index < steps.length - 1;

                        return (
                            <div key={step.number}>
                                <div className={`${styles.step} ${status === 'current' ? styles.stepActive : ''}`}>
                                    <div className={`${styles.stepIndicator} ${getStepIndicatorClass(status)}`}>
                                        {status === 'completed' ? '✓' : step.icon}
                                    </div>
                                    <Text className={styles.stepLabel}>{step.label}</Text>
                                    {showConnector && (
                                        <div className={`${styles.stepConnector} ${status === 'completed' ? styles.stepConnectorCompleted : ''}`} />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* WhatsApp Status */}
            {currentStep >= 3 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}>WHATSAPP</div>
                    <div className={styles.whatsappStatus}>
                        <div className={styles.statusRow}>
                            <span className={styles.statusIcon} style={{ color: whatsappConfig.color }}>
                                {whatsappConfig.icon}
                            </span>
                            <Text className={styles.statusText}>{whatsappConfig.text}</Text>
                        </div>
                    </div>
                </div>
            )}

            {/* License Info */}
            {licenseDetails && currentStep > 0 && (
                <div className={styles.section}>
                    <div className={styles.sectionTitle}>LICENCIA</div>
                    <div className={styles.licenseInfo}>
                        <div className={styles.licenseRow}>
                            <span className={styles.licenseIcon}>📅</span>
                            <Text className={styles.licenseText}>
                                <span className={getDaysRemainingClass(licenseDetails.days_remaining || 0)}>
                                    {licenseDetails.days_remaining || 0} días
                                </span> restantes
                            </Text>
                        </div>
                        {userData?.email && (
                            <div className={styles.licenseRow}>
                                <span className={styles.licenseIcon}>👤</span>
                                <Text className={styles.licenseText} title={userData.email}>
                                    {userData.email}
                                </Text>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Sidebar;
