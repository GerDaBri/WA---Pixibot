import React, { useEffect, useState } from 'react';
import {
    Button,
    Spinner,
    Text,
    Image,
    makeStyles,
    shorthands,
} from '@fluentui/react-components';
import {
    Folder20Regular,
    CheckmarkCircle20Filled,
    DismissCircle20Filled,
    LockClosed20Regular,
    Rocket20Regular,
    Play20Regular,
    ArrowClockwise20Regular,
    Chat20Regular,
    SignOut20Regular,
    ArrowLeft20Regular
} from '@fluentui/react-icons';

// New FilePreview Component
const FilePreview = ({ filePath }) => {
    if (!filePath) {
        return null;
    }

    const lastSlashIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const fileName = filePath.substring(lastSlashIndex + 1);
    const fileExtension = fileName.split('.').pop().toLowerCase();

    // Construct the src using only the filename, as the app:// protocol handler expects a path relative to IMAGE_DIR
    const src = `app://${encodeURIComponent(fileName)}`;

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension)) {
        return <Image src={src} alt="Image Preview" style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: 'var(--radius-md)' }} />;
    } else if (['mp4', 'webm', 'ogg'].includes(fileExtension)) {
        let mimeType = '';
        switch (fileExtension) {
            case 'mp4':
                mimeType = 'video/mp4';
                break;
            case 'webm':
                mimeType = 'video/webm';
                break;
            case 'ogg':
                mimeType = 'video/ogg';
                break;
            default:
                mimeType = `video/${fileExtension}`; // Fallback
        }
        return (
            <video controls style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: 'var(--radius-md)' }}>
                <source src={src} type={mimeType} />
                Your browser does not support the video tag.
            </video>
        );
    } else if (fileExtension === 'pdf') {
        return (
            <iframe
                src={src}
                title="PDF Preview"
                style={{ width: '100%', height: '200px', border: 'none', borderRadius: 'var(--radius-md)' }}
            >
                <p>Your browser does not support iframes. You can <a href={src} target="_blank" rel="noopener noreferrer">download the PDF</a> instead.</p>
            </iframe>
        );
    } else {
        // Generic file preview
        return (
            <div style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', textAlign: 'center', backgroundColor: 'var(--surface-color)' }}>
                <Text>
                    <Folder20Regular style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                    Archivo adjunto: {fileName}
                </Text>
                <Text size="small" style={{ display: 'block', marginTop: '8px', color: 'var(--text-color-secondary)' }}>No hay vista previa disponible para este tipo de archivo.</Text>
                <a href={src} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: '12px', color: 'var(--primary-color)' }}>Descargar {fileName}</a>
            </div>
        );
    }
};

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-xl)',
        animation: 'fadeIn 0.4s ease',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--spacing-xl)',
        '@media (max-width: 900px)': {
            gridTemplateColumns: '1fr',
        },
    },
    card: {
        backgroundColor: 'var(--surface-color)',
        ...shorthands.borderRadius('var(--radius-xl)'),
        ...shorthands.padding('var(--spacing-2xl)'),
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-lg)',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        ...shorthands.borderBottom('2px solid var(--border-color)'),
        paddingBottom: 'var(--spacing-md)',
        marginBottom: 'var(--spacing-md)',
    },
    cardIcon: {
        fontSize: '24px',
    },
    cardTitle: {
        fontSize: 'var(--font-size-lg)',
        fontWeight: '600',
        color: 'var(--text-color-primary)',
    },
    qrContainer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--spacing-lg)',
        ...shorthands.padding('var(--spacing-xl)'),
    },
    qrCode: {
        width: '280px',
        height: '280px',
        ...shorthands.borderRadius('var(--radius-lg)'),
        ...shorthands.padding('var(--spacing-md)'),
        backgroundColor: 'white',
        boxShadow: 'var(--shadow-md)',
        ...shorthands.border('3px', 'solid', 'var(--primary-color)'),
        animation: 'qrPulse 2s ease-in-out infinite',
    },
    instructionsList: {
        listStylePosition: 'inside',
        ...shorthands.padding('0'),
        ...shorthands.margin('0'),
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-sm)',
    },
    instructionItem: {
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-color-secondary)',
        lineHeight: '1.6',
    },
    statusBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--spacing-xs)',
        ...shorthands.padding('var(--spacing-sm)', 'var(--spacing-lg)'),
        ...shorthands.borderRadius('var(--radius-lg)'),
        fontSize: 'var(--font-size-base)',
        fontWeight: '600',
        boxShadow: 'var(--shadow-sm)',
    },
    statusSuccess: {
        backgroundColor: '#d4edda',
        color: '#155724',
        ...shorthands.border('1px', 'solid', '#c3e6cb'),
    },
    statusError: {
        backgroundColor: '#f8d7da',
        color: '#721c24',
        ...shorthands.border('1px', 'solid', '#f5c6cb'),
    },
    statusWarning: {
        backgroundColor: '#fff3cd',
        color: '#856404',
        ...shorthands.border('1px', 'solid', '#ffeaa7'),
    },
    previewContainer: {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-md)',
    },
    messagePreview: {
        ...shorthands.borderRadius('var(--radius-md)'),
        ...shorthands.padding('var(--spacing-lg)'),
        background: 'linear-gradient(135deg, #DCF8C6 0%, #d5f5c8 100%)',
        boxShadow: 'var(--shadow-sm)',
        maxWidth: '100%',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
        fontSize: 'var(--font-size-base)',
        lineHeight: '1.5',
        ...shorthands.border('1px', 'solid', 'rgba(0, 0, 0, 0.06)'),
        minHeight: '120px',
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--spacing-md)',
        ...shorthands.padding('var(--spacing-lg)'),
        backgroundColor: 'var(--background-color)',
        ...shorthands.borderRadius('var(--radius-md)'),
    },
    statItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-xs)',
    },
    statLabel: {
        fontSize: 'var(--font-size-xs)',
        color: 'var(--text-color-secondary)',
        textTransform: 'uppercase',
        fontWeight: '500',
        letterSpacing: '0.5px',
    },
    statValue: {
        fontSize: 'var(--font-size-base)',
        color: 'var(--text-color-primary)',
        fontWeight: '600',
    },
    startButton: {
        width: '100%',
        height: '56px',
        fontSize: 'var(--font-size-lg)',
        fontWeight: '600',
        background: 'var(--primary-gradient)',
        ...shorthands.borderRadius('var(--radius-md)'),
        boxShadow: 'var(--shadow-md)',
        ...shorthands.border('none'),
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: 'var(--shadow-lg)',
        },
        '&:active': {
            transform: 'translateY(0)',
        },
        '&:disabled': {
            background: '#e0e0e0',
            cursor: 'not-allowed',
            transform: 'none',
        },
    },
    actionButtons: {
        display: 'flex',
        gap: 'var(--spacing-md)',
        marginTop: 'var(--spacing-lg)',
    },
    backButton: {
        flex: '1',
    },
    logoutButton: {
        flex: '1',
        height: '40px',
        fontSize: 'var(--font-size-sm)',
    },
    centeredContent: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--spacing-lg)',
        minHeight: '300px',
    },
    phoneNumber: {
        fontSize: 'var(--font-size-base)',
        color: 'var(--text-color-secondary)',
        fontFamily: 'monospace',
        ...shorthands.padding('var(--spacing-sm)', 'var(--spacing-md)'),
        backgroundColor: 'var(--background-color)',
        ...shorthands.borderRadius('var(--radius-sm)'),
    },
});

function Step3_Send({ onBack, onNext, electronAPI, campaign, qrCodeData, sessionStatus, setSessionStatus, setQrCodeData }) {
    const styles = useStyles();
    const [firstRowData, setFirstRowData] = useState(null);
    const [previewMessage, setPreviewMessage] = useState('');
    const [phoneNumber, setPhoneNumber] = useState(null);
    const [showReconnectButton, setShowReconnectButton] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    useEffect(() => {
        console.log("Step3_Send: useEffect for reconnect button - sessionStatus:", sessionStatus);
        if (sessionStatus === 'disconnected' || sessionStatus === 'auth_failure') {
            console.log("Step3_Send: Setting timer for reconnect button (5 seconds)");
            const timer = setTimeout(() => {
                console.log("Step3_Send: Timer expired - showing reconnect button");
                setShowReconnectButton(true);
            }, 5000);

            return () => {
                console.log("Step3_Send: Clearing reconnect timer");
                clearTimeout(timer);
                setShowReconnectButton(false);
            };
        } else {
            console.log("Step3_Send: Hiding reconnect button - sessionStatus is:", sessionStatus);
            setShowReconnectButton(false);
        }
    }, [sessionStatus]);

    useEffect(() => {
        console.log("Step3_Send: sessionStatus changed to", sessionStatus);
        console.log("Step3_Send: Button disabled state will be", sessionStatus !== 'ready' || (campaign?.total > 0 && campaign?.sent === campaign?.total));
    }, [sessionStatus, campaign]);

    useEffect(() => {
        const fetchFirstRow = async () => {
            if (campaign?.config?.excelPath && electronAPI) {
                try {
                    const result = await electronAPI.getFirstExcelRow(campaign.config.excelPath);
                    if (result && result.success) {
                        setFirstRowData(result.firstRow);
                    } else {
                        console.error("Failed to fetch first Excel row:", result ? result.error : "Unknown error");
                        setFirstRowData(null);
                    }
                } catch (error) {
                    console.error("Error calling getFirstExcelRow IPC:", error);
                    setFirstRowData(null);
                }
            }
        };

        fetchFirstRow();
    }, [campaign, electronAPI]);

    useEffect(() => {
        if (campaign?.config?.message && firstRowData) {
            let processedMessage = campaign.config.message;
            for (const key in firstRowData) {
                if (Object.hasOwnProperty.call(firstRowData, key)) {
                    const placeholder = new RegExp(`{{${key}}}`, 'g');
                    const value = firstRowData[key];
                    processedMessage = processedMessage.replace(placeholder, value);
                }
            }
            setPreviewMessage(processedMessage);
        } else if (campaign?.config?.message) {
            setPreviewMessage(campaign.config.message); // Show raw message if no data yet
        } else {
            setPreviewMessage('');
        }
    }, [campaign, firstRowData]);

    useEffect(() => {
        const fetchClientStatus = async () => {
            if (electronAPI) {
                const status = await electronAPI.getClientStatus();
                if (status.status === 'ready' && status.phoneNumber) {
                    setPhoneNumber(status.phoneNumber);
                } else {
                    setPhoneNumber(null);
                }
            }
        };

        if (sessionStatus === 'ready') {
            setIsLoggingOut(false);
        }

        fetchClientStatus();
    }, [electronAPI, sessionStatus]);

    const handleLogout = async () => {
        if (electronAPI) {
            setIsLoggingOut(true);
            const result = await electronAPI.logout();
            if (!result.success) {
                setIsLoggingOut(false);
                alert(`Error al cerrar sesión: ${result.error || 'Error desconocido'}`);
            }
        }
    };

    const handleStartSending = () => {
        console.log("Step3_Send: Attempting to start sending.");
        if (electronAPI && campaign?.config && campaign.config.excelPath && sessionStatus === 'ready') {
            console.log("Step3_Send: Starting sending process.");
            electronAPI.startSending(campaign.config);
            if (onNext) {
                onNext();
            }
        } else {
            console.warn("Step3_Send: Cannot start sending: client not ready or config missing. Current sessionStatus:", sessionStatus);
        }
    };

    const getMessageTypeLabel = () => {
        if (campaign?.config?.messageType === '1') return 'Solo Texto';
        if (campaign?.config?.messageType === '2') return 'Con Archivo';
        return 'N/A';
    };

    const getTotalContacts = () => {
        return campaign?.total || 0;
    };

    return (
        <div className={styles.container}>
            <div className={styles.grid}>
                {/* Left Panel: WhatsApp Connection */}
                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <span className={styles.cardIcon}><Chat20Regular /></span>
                        <span className={styles.cardTitle}>Conexión WhatsApp</span>
                    </div>

                    {sessionStatus === 'initializing' && (
                        <div className={styles.centeredContent}>
                            <Spinner size="huge" label="Conectando a WhatsApp..." />
                            <Text>Inicializando cliente...</Text>
                        </div>
                    )}

                    {sessionStatus === 'qr_received' && qrCodeData && (
                        <div className={styles.qrContainer}>
                            <Text weight="semibold" size={400}>Escanea el código QR con tu teléfono:</Text>
                            <Image src={qrCodeData} alt="QR Code" className={styles.qrCode} />
                            <ol className={styles.instructionsList}>
                                <li className={styles.instructionItem}>Abre WhatsApp en tu teléfono</li>
                                <li className={styles.instructionItem}>Ve a Configuración {'>'} Dispositivos vinculados</li>
                                <li className={styles.instructionItem}>Toca "Vincular un dispositivo"</li>
                                <li className={styles.instructionItem}>Apunta tu teléfono a esta pantalla para escanear el código</li>
                            </ol>
                            <Spinner size="small" label="Esperando escaneo..." />
                        </div>
                    )}

                    {sessionStatus === 'ready' && (
                        <div className={styles.centeredContent}>
                            <div className={`${styles.statusBadge} ${styles.statusSuccess}`}>
                                <CheckmarkCircle20Filled />
                                <span>Sesión Activa</span>
                            </div>
                            {phoneNumber && (
                                <div style={{ textAlign: 'center' }}>
                                    <Text size={300} style={{ color: 'var(--text-color-secondary)', display: 'block', marginBottom: '8px' }}>Número conectado:</Text>
                                    <div className={styles.phoneNumber}>{phoneNumber}</div>
                                </div>
                            )}
                            <Text style={{ textAlign: 'center', color: 'var(--text-color-secondary)' }}>
                                Tu sesión de WhatsApp está lista para enviar mensajes
                            </Text>
                            <Button
                                appearance="secondary"
                                onClick={handleLogout}
                                disabled={isLoggingOut}
                                className={styles.logoutButton}
                                icon={<SignOut20Regular />}
                            >
                                {isLoggingOut ? <><Spinner size="tiny" /> Cerrando Sesión...</> : 'Cerrar Sesión'}
                            </Button>
                        </div>
                    )}

                    {sessionStatus === 'disconnected' && (
                        <div className={styles.centeredContent}>
                            <div className={`${styles.statusBadge} ${styles.statusError}`}>
                                <DismissCircle20Filled />
                                <span>Sesión Desconectada</span>
                            </div>
                            <Text style={{ textAlign: 'center', color: 'var(--text-color-secondary)' }}>
                                La conexión con WhatsApp se ha perdido
                            </Text>
                            {showReconnectButton && (
                                <Button
                                    appearance="primary"
                                    onClick={() => {
                                        console.log("Step3_Send: Reconnect button clicked - calling initializeClient");
                                        electronAPI.initializeClient();
                                    }}
                                    icon={<ArrowClockwise20Regular />}
                                >
                                    Reconectar
                                </Button>
                            )}
                        </div>
                    )}

                    {sessionStatus === 'auth_failure' && (
                        <div className={styles.centeredContent}>
                            <div className={`${styles.statusBadge} ${styles.statusError}`}>
                                <LockClosed20Regular />
                                <span>Error de Autenticación</span>
                            </div>
                            <Text style={{ textAlign: 'center', color: 'var(--text-color-secondary)' }}>
                                Por favor, intenta reconectar o reinicia la aplicación
                            </Text>
                            {showReconnectButton && (
                                <Button
                                    appearance="primary"
                                    onClick={() => {
                                        console.log("Step3_Send: Reconnect button clicked (auth_failure) - calling initializeClient");
                                        electronAPI.initializeClient();
                                    }}
                                    icon={<ArrowClockwise20Regular />}
                                >
                                    Reconectar
                                </Button>
                            )}
                        </div>
                    )}

                    <div className={styles.actionButtons}>
                        <Button appearance="secondary" onClick={() => onBack()} className={styles.backButton} icon={<ArrowLeft20Regular />}>
                            Atrás
                        </Button>
                    </div>
                </div>

                {/* Right Panel: Message Preview */}
                <div className={styles.card}>
                    <div className={styles.cardHeader}>
                        <span className={styles.cardTitle}>Vista Previa del Mensaje</span>
                    </div>

                    <div className={styles.previewContainer}>
                        {campaign?.config?.mediaPath && (
                            <FilePreview filePath={campaign.config.mediaPath} />
                        )}
                        <div className={styles.messagePreview}>
                            {previewMessage || 'El mensaje aparecerá aquí...'}
                        </div>
                    </div>

                    <Button
                        appearance="primary"
                        onClick={handleStartSending}
                        disabled={sessionStatus !== 'ready' || (campaign?.total > 0 && campaign?.sent === campaign?.total)}
                        className={styles.startButton}
                        icon={campaign?.sent > 0 && campaign?.sent < campaign?.total ? <Play20Regular /> : <Rocket20Regular />}
                    >
                        {campaign?.sent > 0 && campaign?.sent < campaign?.total ? 'Reanudar Envío' : 'Comenzar Envío'}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export default Step3_Send;
