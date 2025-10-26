import React, { useState, useEffect } from 'react';
import { ProgressBar, Button, Field, Textarea, Accordion, AccordionItem, AccordionHeader, AccordionPanel, Input, Label, Spinner, Select, Option } from '@fluentui/react-components';

const Step4_Progress = ({ campaign, onPause, onResume, logs, onStartNew, sessionStatus, qrCodeData }) => {
  const [openAdvancedSettings, setOpenAdvancedSettings] = useState('none');
  const [advancedConfig, setAdvancedConfig] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [countdownState, setCountdownState] = useState({
    isActive: false,
    remainingTime: 0,
    totalTime: 0,
    type: 'idle'
  });

  // Lista de códigos de área comunes
  const countryCodes = [
    { value: '', label: '' },
    { value: '1', label: '1 (Estados Unidos/Canadá)' },
    { value: '52', label: '52 (México)' },
    { value: '502', label: '502 (Guatemala)' },
    { value: '503', label: '503 (El Salvador)' },
    { value: '504', label: '504 (Honduras)' },
    { value: '505', label: '505 (Nicaragua)' },
    { value: '506', label: '506 (Costa Rica)' },
    { value: '507', label: '507 (Panamá)' },
    { value: '509', label: '509 (Haití)' },
    { value: '598', label: '598 (Uruguay)' },
    { value: '56', label: '56 (Chile)' },
    { value: '57', label: '57 (Colombia)' },
    { value: '58', label: '58 (Venezuela)' },
    { value: '591', label: '591 (Bolivia)' },
    { value: '593', label: '593 (Ecuador)' },
    { value: '594', label: '594 (Guayana Francesa)' },
    { value: '595', label: '595 (Paraguay)' },
    { value: '596', label: '596 (Martinica)' },
    { value: '597', label: '597 (Surinam)' },
    { value: '599', label: '599 (Curazao)' },
    
  ];

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
      return `(Pausa automatica entre mensajes: ${formatTime(countdownState.remainingTime)})`;
    } else if (countdownState.type === 'sending' || countdownState.remainingTime <= 0) {
      return '(enviando mensajes)';
    }

    return null;
  };

  useEffect(() => {
    // Sync local state when the main campaign prop changes
    if (campaign && campaign.config) {
      setAdvancedConfig(campaign.config);
    } else {
      // When campaign is cleared, reset local state too
      setAdvancedConfig(null);
    }
  }, [campaign]);

  // Handle countdown updates from campaign
  useEffect(() => {
    if (campaign && campaign.countdown) {
      setCountdownState(campaign.countdown);
    } else {
      // Reset countdown state when no countdown data
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
      <div className="step-container">
        <Spinner label="Cargando configuración de campaña..." />
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
        // The error from main.js will be in result.error
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

  // Función para formatear la fecha de finalización
  const formatFinishTime = (finishTime) => {
    if (!finishTime) return 'N/A';
    return new Date(finishTime).toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="step-container">
      <h2>
        {isFinished ? 'Campaña Finalizada: ' : 'Campaña en Progreso: '}
        {campaign.config.campaignName}
      </h2>

      {isFinished && (
        <div className="campaign-finished-banner">
          <div className="success-indicator">
            <span className="success-icon">✅</span>
            <h3>CAMPAÑA FINALIZADA</h3>
          </div>

          <div className="campaign-stats">
            <div className="stat-item">
              <span className="stat-label">Mensajes Enviados:</span>
              <span className="stat-value">{campaign.config.currentIndex || 0} / {campaign.total}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Estado:</span>
              <span className="stat-value success">Completada con Éxito</span>
            </div>
          </div>
        </div>
      )}
      {sessionStatus === 'qr_received' && qrCodeData && (
        <div className="form-group" style={{ textAlign: 'center' }}>
          <h3>Escanee el código QR para continuar</h3>
          <img src={qrCodeData} alt="QR Code" />
        </div>
      )}
      {!isFinished && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <p style={{ margin: 0 }}>Enviados: {campaign.config.currentIndex || 0} / {campaign.total}</p>
            {getCountdownMessage() && (
              <span style={{
                fontSize: '14px',
                color: countdownState.type === 'pausing' ? '#d13438' : '#107c10',
                fontWeight: '500'
              }}>
                {getCountdownMessage()}
              </span>
            )}
          </div>
          <ProgressBar value={campaign.config.currentIndex || 0} max={campaign.total} />
        </>
      )}

      <div className="step-actions">
        {!isFinished ? (
          <>
            <Button appearance="primary" onClick={() => onPause(campaign.id)} disabled={!isPaused && sessionStatus === 'ready' ? false : true}>
              Pausar
            </Button>
            <Button appearance="primary" onClick={() => onResume(campaign.id)} disabled={isPaused && sessionStatus === 'ready' ? false : true}>
              Reanudar
            </Button>
          </>
        ) : (
          <div className="finished-message">
            <p style={{ margin: '0 0 10px 0', color: '#107c10', fontWeight: '500' }}>
              ¡Campaña completada exitosamente!
            </p>
          </div>
        )}

        <Button
          onClick={onStartNew}
          disabled={campaign.status === 'running'}
          appearance={isFinished ? "primary" : "secondary"}
          title={isFinished ? "Iniciar una nueva campaña con diferentes parámetros" : "Crear nueva campaña"}
        >
          {isFinished ? "Iniciar Nueva Campaña" : "Nueva Campaña"}
        </Button>
      </div>

      {/* Advanced Settings Accordion */}
      <div className="form-group">
        <Accordion collapsible openItems={openAdvancedSettings} onToggle={(event, data) => setOpenAdvancedSettings(data.openItems)}>
          <AccordionItem value="advanced-settings">
            <AccordionHeader>Configuración Avanzada</AccordionHeader>
            <AccordionPanel>
              <div className="form-group">
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
              <div className="form-group">
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
              <div className="form-group">
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
              <div className="form-group">
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
              <div className="form-group">
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
              <div className="form-group">
                <Label htmlFor="timeout-input">Tiempo de espera (milisegundos):</Label>
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
              <div className="form-group">
                <Label htmlFor="supervisorNumbers-input">Números de Supervisor (separados por coma):</Label>
                <Input
                  name="supervisorNumbers"
                  id="supervisorNumbers-input"
                  type="text"
                  value={advancedConfig.supervisorNumbers ? advancedConfig.supervisorNumbers.join(',') : ''}
                  onChange={handleConfigChange}
                  style={{ width: '100%' }}
                  disabled={!isPaused}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="currentIndex-input">Iniciar desde el índice:</Label>
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
              <div className="form-group">
                <Label htmlFor="countryCode-select">Código de Área del País:</Label>
                <Select
                  name="countryCode"
                  id="countryCode-select"
                  value={advancedConfig.countryCode ?? ''}
                  onChange={(e, data) => handleConfigChange({ target: { name: 'countryCode', value: data.value } })}
                  disabled={!isPaused}
                  placeholder="Selecciona un código de área"
                >
                  {countryCodes.map((code) => (
                    <Option key={code.value} value={code.value}>
                      {code.label}
                    </Option>
                  ))}
                </Select>
              </div>
              <div className="step-actions">
                {isPaused ? (
                    <Button appearance="primary" onClick={handleSaveAdvancedSettings} disabled={isSaving}>
                      {isSaving ? <Spinner size="tiny" /> : 'Guardar Configuración Avanzada'}
                    </Button>
                ) : (
                    <p style={{ fontStyle: 'italic', color: '#666' }}>
                    Debes pausar la campaña para poder guardar la configuración avanzada.
                    </p>
                )}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="form-group">
        <Accordion collapsible>
          <AccordionItem value="logs">
            <AccordionHeader>Registro de Actividad</AccordionHeader>
            <AccordionPanel>
              <Field label="Logs de la Consola">
                <Textarea
                  readOnly
                  value={logs.join('\n')}
                  className="logs-textarea"
                />
              </Field>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
};

export default Step4_Progress;
