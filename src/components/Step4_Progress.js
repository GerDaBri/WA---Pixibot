import React, { useState, useEffect } from 'react';
import {
    ProgressBar,
    Button,
    Textarea,
    Accordion,
    AccordionItem,
    AccordionHeader,
    AccordionPanel,
    Input,
    Label,
    Spinner,
    makeStyles,
    shorthands,
    Text,
} from '@fluentui/react-components';
import { HourglassHalf20Regular, Settings20Regular, TrendingLines20Regular } from '@fluentui/react-icons';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-xl)',
        animation: 'fadeIn 0.4s ease',
    },
    headerSection: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        ...shorthands.padding('var(--spacing-lg)'),
        backgroundColor: 'var(--surface-color)',
        ...shorthands.borderRadius('var(--radius-xl)'),
        boxShadow: 'var(--shadow-lg)',
    },
    campaignTitle: {
        fontSize: 'var(--font-size-xl)',
        fontWeight: '700',
        color: 'var(--text-color-primary)',
    },
    metricsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 'var(--spacing-lg)',
    },
    metricCard: {
        backgroundColor: 'var(--surface-color)',
        ...shorthands.borderRadius('var(--radius-lg)'),
        ...shorthands.padding('var(--spacing-xl)'),
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-sm)',
        transition: 'all 0.3s ease',
        '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: 'var(--shadow-lg)',
        },
    },
    metricIcon: {
        fontSize: '32px',
        marginBottom: 'var(--spacing-xs)',
    },
    metricLabel: {
        fontSize: 'var(--font-size-xs)',
        color: 'var(--text-color-secondary)',
        textTransform: 'uppercase',
        fontWeight: '600',
        letterSpacing: '0.5px',
    },
    metricValue: {
        fontSize: 'var(--font-size-2xl)',
        fontWeight: '700',
        color: 'var(--text-color-primary)',
    },
    metricSubtext: {
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-color-secondary)',
        marginTop: 'var(--spacing-xs)',
    },
    progressSection: {
        backgroundColor: 'var(--surface-color)',
        ...shorthands.borderRadius('var(--radius-xl)'),
        ...shorthands.padding('var(--spacing-2xl)'),
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-lg)',
    },
    progressHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    progressText: {
        fontSize: 'var(--font-size-lg)',
        fontWeight: '600',
        color: 'var(--text-color-primary)',
    },
    countdownBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--spacing-xs)',
        ...shorthands.padding('var(--spacing-sm)', 'var(--spacing-md)'),
        ...shorthands.borderRadius('var(--radius-md)'),
        fontSize: 'var(--font-size-sm)',
        fontWeight: '600',
    },
    countdownPausing: {
        backgroundColor: '#fff3cd',
        color: '#856404',
        ...shorthands.border('1px', 'solid', '#ffeaa7'),
    },
    countdownSending: {
        backgroundColor: '#d4edda',
        color: '#155724',
        ...shorthands.border('1px', 'solid', '#c3e6cb'),
    },
    controlPanel: {
        backgroundColor: 'var(--surface-color)',
        ...shorthands.borderRadius('var(--radius-xl)'),
        ...shorthands.padding('var(--spacing-2xl)'),
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-lg)',
    },
    controlButtons: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 'var(--spacing-md)',
    },
    controlButton: {
        height: '48px',
        fontSize: 'var(--font-size-base)',
        fontWeight: '600',
        ...shorthands.borderRadius('var(--radius-md)'),
        transition: 'all 0.3s ease',
        '&:hover:not(:disabled)': {
            transform: 'translateY(-2px)',
            boxShadow: 'var(--shadow-md)',
        },
    },
    finishedBanner: {
        backgroundColor: '#d4edda',
        ...shorthands.border('2px', 'solid', '#c3e6cb'),
        ...shorthands.borderRadius('var(--radius-xl)'),
        ...shorthands.padding('var(--spacing-2xl)'),
        textAlign: 'center',
        animation: 'slideUp 0.5s ease',
    },
    successIcon: {
        fontSize: '64px',
        marginBottom: 'var(--spacing-md)',
        animation: 'bounce 1s ease',
    },
    finishedTitle: {
        fontSize: 'var(--font-size-2xl)',
        fontWeight: '700',
        color: '#155724',
        marginBottom: 'var(--spacing-lg)',
    },
    statsTable: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--spacing-md)',
        ...shorthands.padding('var(--spacing-lg)'),
        backgroundColor: 'white',
        ...shorthands.borderRadius('var(--radius-md)'),
        marginTop: 'var(--spacing-lg)',
    },
    statRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        ...shorthands.padding('var(--spacing-sm)'),
    },
    accordionSection: {
        backgroundColor: 'var(--surface-color)',
        ...shorthands.borderRadius('var(--radius-xl)'),
        boxShadow: 'var(--shadow-md)',
        ...shorthands.overflow('hidden'),
    },
    formGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: 'var(--spacing-lg)',
        ...shorthands.padding('var(--spacing-lg)', '0'),
    },
    formGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-xs)',
    },
    logsTextarea: {
        fontFamily: 'monospace',
        fontSize: 'var(--font-size-sm)',
        minHeight: '300px',
        height: '300px',
        width: '100%',
        backgroundColor: '#000000 !important',
        color: '#ffffff !important',
        ...shorthands.borderRadius('var(--radius-md)'),
        ...shorthands.padding('var(--spacing-md)'),
        ...shorthands.border('1px', 'solid', '#333'),
        '& textarea': {
            backgroundColor: '#000000 !important',
            color: '#ffffff !important',
            width: '100%',
            height: '100%',
        },
    },
    saveButton: {
        marginTop: 'var(--spacing-lg)',
        height: '48px',
        fontSize: 'var(--font-size-base)',
        fontWeight: '600',
        background: 'var(--primary-gradient)',
        ...shorthands.borderRadius('var(--radius-md)'),
    },
    disabledMessage: {
        fontStyle: 'italic',
        color: 'var(--text-color-secondary)',
        textAlign: 'center',
        ...shorthands.padding('var(--spacing-lg)'),
    },
});

const Step4_Progress = ({ campaign, onPause, onResume, logs, onStartNew, sessionStatus, qrCodeData }) => {
    const styles = useStyles();
    const [openAdvancedSettings, setOpenAdvancedSettings] = useState('none');
    const [openLogs, setOpenLogs] = useState('none');
    const [advancedConfig, setAdvancedConfig] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [countdownState, setCountdownState] = useState({
        isActive: false,
        remainingTime: 0,
        totalTime: 0,
        type: 'idle'
    });

    // Function to format time in m:ss format
    const formatTime = (milliseconds) => {
        if (milliseconds <= 0) return '0:00';

        const totalSeconds = Math.ceil(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // Function to get countdown message based on state
    const getCountdownMessage = () => {
        if (!countdownState.isActive) {
            return null;
        }

        if (countdownState.type === 'pausing' && countdownState.remainingTime > 0) {
            return `⏸️ Pausa automática: ${formatTime(countdownState.remainingTime)}`;
        } else if (countdownState.type === 'sending' || countdownState.remainingTime <= 0) {
            return '📤 Enviando mensajes';
        }

        return null;
    };

    useEffect(() => {
        // Sync local state when the main campaign prop changes
        if (campaign && campaign.config) {
            setAdvancedConfig(campaign.config);
        } else {
            setAdvancedConfig(null);
        }
    }, [campaign]);

    // Handle countdown updates from campaign
    useEffect(() => {
        if (campaign && campaign.countdown) {
            setCountdownState(campaign.countdown);
        } else {
            setCountdownState({
                isActive: false,
                remainingTime: 0,
                totalTime: 0,
                type: 'idle'
            });
        }
    }, [campaign?.countdown]);

    // Show test message when campaign is running but no countdown data yet
    useEffect(() => {
        if (campaign && campaign.status === 'running' && !campaign.countdown) {
            setCountdownState({
                isActive: true,
                remainingTime: 0,
                totalTime: 0,
                type: 'sending'
            });
        }
    }, [campaign?.status, campaign?.countdown]);

    // Guard clause: Render loading state if campaign or our local config state is not yet available
    if (!campaign || !campaign.config || !advancedConfig) {
        return (
            <div className={styles.container}>
                <div className={styles.progressSection}>
                    <Spinner size="huge" label="Cargando configuración de campaña..." />
                </div>
            </div>
        );
    }

    const handleConfigChange = (event) => {
        const { name, value, type } = event.target;
        let parsedValue = value;
        if (type === 'number') {
            parsedValue = value ? Number(value) : 0;
            if (name === 'pausaMaxima') {
                parsedValue = Math.max(2, parsedValue);
            }
        } else if (name === 'supervisorNumbers') {
            parsedValue = value.split(',').map(num => num.trim()).filter(num => num);
        }
        setAdvancedConfig(prev => ({ ...prev, [name]: parsedValue }));
    };

    const handleSaveAdvancedSettings = async () => {
        setIsSaving(true);
        let configToSave = { ...advancedConfig };
        if (configToSave.pausaMaxima < configToSave.pausaMinima) {
            configToSave.pausaMinima = configToSave.pausaMaxima - 1;
        }
        console.log("Saving advanced settings:", configToSave);
        try {
            const result = await window.electronAPI.updateCampaignConfig(configToSave);
            if (result.success) {
                alert("Configuración avanzada guardada y aplicada con éxito!");
            } else {
                alert(`Error al guardar: ${result.error}`);
            }
        } catch (error) {
            console.error("Error calling updateCampaignConfig:", error);
            alert("Se produjo un error inesperado al guardar la configuración.");
        } finally {
            setIsSaving(false);
        }
    };

    const isPaused = campaign.status === 'paused';
    const isFinished = campaign.status === 'finished';
    const isRunning = campaign.status === 'running';
    const currentIndex = campaign.config.currentIndex || 0;
    const total = campaign.total || 0;
    const remaining = Math.max(0, total - currentIndex);
    const progressPercent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;

    return (
        <div className={styles.container}>
            {/* Finished Banner */}
            {isFinished && (
                <div className={styles.finishedBanner}>
                    <div className={styles.successIcon}>🎉</div>
                    <div className={styles.finishedTitle}>
                        ¡{campaign.config.campaignName || 'CAMPAÑA'} FINALIZADA CON ÉXITO!
                    </div>
                    <Text size={400}>Todos los mensajes han sido enviados exitosamente</Text>
                    <div className={styles.statsTable}>
                        <div className={styles.statRow}>
                            <Text weight="semibold">Mensajes Enviados:</Text>
                            <Text>{currentIndex} / {total}</Text>
                        </div>
                        <div className={styles.statRow}>
                            <Text weight="semibold">Tasa de Éxito:</Text>
                            <Text style={{ color: '#155724', fontWeight: '600' }}>100%</Text>
                        </div>
                    </div>
                </div>
            )}

            {/* Campaign Header - Only show when not finished */}
            {!isFinished && (
                <div className={styles.headerSection}>
                    <div className={styles.campaignTitle}>
                        {isRunning ? '▶️ ' : '⏸️ '}
                        {campaign.config.campaignName || 'Campaña Sin Nombre'}
                    </div>
                </div>
            )}

            {/* Metrics Grid */}
            {!isFinished && (
                <div className={styles.metricsGrid}>
                    <div className={styles.metricCard}>
                        <div className={styles.metricIcon}>📤</div>
                        <div className={styles.metricLabel}>Enviados</div>
                        <div className={styles.metricValue}>{currentIndex}</div>
                        <div className={styles.metricSubtext}>mensajes completados</div>
                    </div>

                    <div className={styles.metricCard}>
                        <div className={styles.metricIcon}>📊</div>
                        <div className={styles.metricLabel}>Total</div>
                        <div className={styles.metricValue}>{total}</div>
                        <div className={styles.metricSubtext}>contactos en campaña</div>
                    </div>

                    <div className={styles.metricCard}>
                        <div className={styles.metricIcon}>
                            <HourglassHalf20Regular style={{ fontSize: '24px' }} />
                        </div>
                        <div className={styles.metricLabel}>Restantes</div>
                        <div className={styles.metricValue}>{remaining}</div>
                        <div className={styles.metricSubtext}>pendientes de envío</div>
                    </div>

                    <div className={styles.metricCard}>
                        <div className={styles.metricIcon}>
                            <TrendingLines20Regular style={{ fontSize: '24px' }} />
                        </div>
                        <div className={styles.metricLabel}>Progreso</div>
                        <div className={styles.metricValue}>{progressPercent}%</div>
                        <div className={styles.metricSubtext}>completado</div>
                    </div>
                </div>
            )}

            {/* Progress Section */}
            {!isFinished && (
                <div className={styles.progressSection}>
                    <div className={styles.progressHeader}>
                        <Text className={styles.progressText}>
                            {currentIndex} de {total} mensajes enviados
                        </Text>
                        {getCountdownMessage() && (
                            <div className={`${styles.countdownBadge} ${countdownState.type === 'pausing' ? styles.countdownPausing : styles.countdownSending}`}>
                                {getCountdownMessage()}
                            </div>
                        )}
                    </div>
                    <ProgressBar
                        value={currentIndex}
                        max={total}
                        thickness="large"
                        shape="rounded"
                    />
                </div>
            )}

            {/* Control Panel */}
            <div className={styles.controlPanel}>
                <Text size={500} weight="semibold">Panel de Control</Text>
                <div className={styles.controlButtons}>
                    {!isFinished ? (
                        <>
                            <Button
                                appearance="primary"
                                onClick={() => onPause(campaign.id)}
                                disabled={isPaused || sessionStatus !== 'ready'}
                                className={styles.controlButton}
                            >
                                ⏸️ Pausar
                            </Button>
                            <Button
                                appearance="primary"
                                onClick={() => onResume(campaign.id)}
                                disabled={!isPaused || sessionStatus !== 'ready'}
                                className={styles.controlButton}
                            >
                                ▶️ Reanudar
                            </Button>
                        </>
                    ) : null}
                    <Button
                        appearance={isFinished ? "primary" : "secondary"}
                        onClick={onStartNew}
                        disabled={campaign.status === 'running'}
                        className={styles.controlButton}
                    >
                        {isFinished ? '🆕 Nueva Campaña' : '➕ Nueva Campaña'}
                    </Button>
                </div>
            </div>

            {/* Advanced Settings Accordion */}
            <div className={styles.accordionSection}>
                <Accordion
                    collapsible
                    openItems={openAdvancedSettings}
                    onToggle={(event, data) => setOpenAdvancedSettings(data.openItems)}
                >
                    <AccordionItem value="advanced-settings">
                        <AccordionHeader>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <Settings20Regular />
                                <Text size={400} weight="semibold">Configuración Avanzada</Text>
                            </div>
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="pausaCada-input">Pausa cada (mensajes):</Label>
                                    <Input
                                        name="pausaCada"
                                        id="pausaCada-input"
                                        type="number"
                                        value={advancedConfig.pausaCada}
                                        onChange={handleConfigChange}
                                        min={1}
                                        disabled={!isPaused}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="pausaMinima-input">Pausa mínima (minutos):</Label>
                                    <Input
                                        name="pausaMinima"
                                        id="pausaMinima-input"
                                        type="number"
                                        value={advancedConfig.pausaMinima}
                                        onChange={handleConfigChange}
                                        min={1}
                                        disabled={!isPaused}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="pausaMaxima-input">Pausa máxima (minutos):</Label>
                                    <Input
                                        name="pausaMaxima"
                                        id="pausaMaxima-input"
                                        type="number"
                                        value={advancedConfig.pausaMaxima}
                                        onChange={handleConfigChange}
                                        min={2}
                                        disabled={!isPaused}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="sendDelay-input">Retraso de envío (segundos):</Label>
                                    <Input
                                        name="sendDelay"
                                        id="sendDelay-input"
                                        type="number"
                                        value={advancedConfig.sendDelay}
                                        onChange={handleConfigChange}
                                        min={5}
                                        disabled={!isPaused}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="maxRetries-input">Máximo de reintentos:</Label>
                                    <Input
                                        name="maxRetries"
                                        id="maxRetries-input"
                                        type="number"
                                        value={advancedConfig.maxRetries}
                                        onChange={handleConfigChange}
                                        min={1}
                                        disabled={!isPaused}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="timeout-input">Tiempo de espera (ms):</Label>
                                    <Input
                                        name="timeout"
                                        id="timeout-input"
                                        type="number"
                                        value={advancedConfig.timeout}
                                        onChange={handleConfigChange}
                                        min={60000}
                                        disabled={!isPaused}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="currentIndex-input">Iniciar desde índice:</Label>
                                    <Input
                                        name="currentIndex"
                                        id="currentIndex-input"
                                        type="number"
                                        value={advancedConfig.currentIndex ?? 0}
                                        onChange={handleConfigChange}
                                        min={0}
                                        disabled={!isPaused}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <Label htmlFor="countryCode-input">Código de país:</Label>
                                    <Input
                                        name="countryCode"
                                        id="countryCode-input"
                                        type="text"
                                        value={advancedConfig.countryCode ?? ''}
                                        onChange={handleConfigChange}
                                        disabled={!isPaused}
                                        placeholder="Ej: 502"
                                    />
                                </div>
                            </div>
                            <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                                <Label htmlFor="supervisorNumbers-input">Números de Supervisor (separados por coma):</Label>
                                <Input
                                    name="supervisorNumbers"
                                    id="supervisorNumbers-input"
                                    type="text"
                                    value={advancedConfig.supervisorNumbers ? advancedConfig.supervisorNumbers.join(',') : ''}
                                    onChange={handleConfigChange}
                                    disabled={!isPaused}
                                    placeholder="Ej: 5049999999, 5049999999"
                                />
                            </div>
                            {isPaused ? (
                                <Button
                                    appearance="primary"
                                    onClick={handleSaveAdvancedSettings}
                                    disabled={isSaving}
                                    className={styles.saveButton}
                                >
                                    {isSaving ? <><Spinner size="tiny" /> Guardando...</> : '💾 Guardar Configuración Avanzada'}
                                </Button>
                            ) : (
                                <Text className={styles.disabledMessage}>
                                    Debes pausar la campaña para poder guardar la configuración avanzada.
                                </Text>
                            )}
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </div>

            {/* Logs Accordion */}
            <div className={styles.accordionSection}>
                <Accordion
                    collapsible
                    openItems={openLogs}
                    onToggle={(event, data) => setOpenLogs(data.openItems)}
                >
                    <AccordionItem value="logs">
                        <AccordionHeader>
                            <Text size={400} weight="semibold">📋 Registro de Actividad</Text>
                        </AccordionHeader>
                        <AccordionPanel>
                            <Textarea
                                readOnly
                                value={logs.join('\n')}
                                className={styles.logsTextarea}
                                resize="vertical"
                            />
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </div>
        </div>
    );
};

export default Step4_Progress;
