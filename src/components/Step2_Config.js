import React, { useState, useRef, useEffect } from 'react';
import {
  Textarea,
  Button,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Input,
  Label,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  section: {
    marginBottom: 'var(--spacing-2xl)',
  },
  sectionTitle: {
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--text-color-primary)',
    marginBottom: 'var(--spacing-lg)',
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('var(--spacing-sm)'),
  },
  sectionIcon: {
    fontSize: 'var(--font-size-xl)',
  },
  messageBox: {
    position: 'relative',
  },
  textarea: {
    width: '100%',
    minHeight: '160px',
    fontSize: 'var(--font-size-base)',
    lineHeight: '1.6',
    ...shorthands.padding('var(--spacing-md)'),
    ...shorthands.borderRadius('var(--radius-md)'),
    ...shorthands.border('2px', 'solid', 'rgba(0, 0, 0, 0.1)'),
    transition: 'all var(--transition-fast)',
    fontFamily: 'var(--font-family)',
    resize: 'vertical',
    '&:focus': {
      ...shorthands.border('2px', 'solid', 'var(--primary-color)'),
      boxShadow: '0 0 0 4px rgba(76, 175, 80, 0.1)',
    },
  },
  charCounter: {
    position: 'absolute',
    bottom: 'var(--spacing-sm)',
    right: 'var(--spacing-md)',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--text-color-muted)',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    ...shorthands.padding('var(--spacing-xs)', 'var(--spacing-sm)'),
    ...shorthands.borderRadius('var(--radius-sm)'),
    pointerEvents: 'none',
  },
  charCounterWarning: {
    color: 'var(--color-warning)',
  },
  charCounterError: {
    color: 'var(--color-error)',
  },
  variablesGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    ...shorthands.gap('var(--spacing-sm)'),
    marginTop: 'var(--spacing-md)',
  },
  variableChip: {
    ...shorthands.padding('var(--spacing-sm)', 'var(--spacing-md)'),
    ...shorthands.borderRadius('var(--radius-md)'),
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    ...shorthands.border('1px', 'solid', 'rgba(76, 175, 80, 0.3)'),
    color: 'var(--primary-color)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    fontFamily: 'monospace',
    '&:hover': {
      backgroundColor: 'rgba(76, 175, 80, 0.2)',
      ...shorthands.border('1px', 'solid', 'var(--primary-color)'),
      transform: 'translateY(-2px)',
      boxShadow: 'var(--shadow-sm)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
  },
  messageTypeCards: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    ...shorthands.gap('var(--spacing-lg)'),
    marginTop: 'var(--spacing-md)',
  },
  messageTypeCard: {
    ...shorthands.padding('var(--spacing-xl)'),
    ...shorthands.borderRadius('var(--radius-lg)'),
    ...shorthands.border('2px', 'solid', 'rgba(0, 0, 0, 0.1)'),
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    textAlign: 'center',
    backgroundColor: 'var(--surface-color)',
    '&:hover': {
      ...shorthands.border('2px', 'solid', 'rgba(76, 175, 80, 0.4)'),
      transform: 'translateY(-2px)',
      boxShadow: 'var(--shadow-md)',
    },
  },
  messageTypeCardActive: {
    ...shorthands.border('2px', 'solid', 'var(--primary-color)'),
    backgroundColor: 'rgba(76, 175, 80, 0.05)',
    boxShadow: 'var(--shadow-md)',
  },
  messageTypeIcon: {
    fontSize: '48px',
    marginBottom: 'var(--spacing-md)',
  },
  messageTypeTitle: {
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--text-color-primary)',
    marginBottom: 'var(--spacing-xs)',
  },
  messageTypeDescription: {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--text-color-secondary)',
  },
  mediaSection: {
    ...shorthands.padding('var(--spacing-lg)'),
    ...shorthands.borderRadius('var(--radius-md)'),
    backgroundColor: 'rgba(76, 175, 80, 0.02)',
    ...shorthands.border('1px', 'solid', 'rgba(76, 175, 80, 0.2)'),
    marginTop: 'var(--spacing-lg)',
  },
  mediaPreview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.padding('var(--spacing-md)'),
    ...shorthands.borderRadius('var(--radius-md)'),
    backgroundColor: 'var(--surface-color)',
    ...shorthands.border('1px', 'solid', 'rgba(0, 0, 0, 0.1)'),
    marginTop: 'var(--spacing-md)',
  },
  mediaInfo: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('var(--spacing-md)'),
    flex: 1,
  },
  mediaIcon: {
    fontSize: '32px',
  },
  mediaFileName: {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--text-color-primary)',
    wordBreak: 'break-word',
  },
  advancedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    ...shorthands.gap('var(--spacing-lg)'),
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('var(--spacing-sm)'),
  },
  inputLabel: {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--text-color-primary)',
  },
  inputDescription: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--text-color-secondary)',
    marginTop: 'var(--spacing-xs)',
  },
});

function Step2_Config({ onNext, onBack, electronAPI, initialConfig }) {
  const styles = useStyles();
  const [message, setMessage] = useState(initialConfig.message ?? '');
  const [campaignName, setCampaignName] = useState(initialConfig.campaignName ?? '');
  const [messageType, setMessageType] = useState(initialConfig.messageType ?? '1');
  const [selectedFilePath, setSelectedFilePath] = useState(initialConfig.mediaPath ?? '');
  const [pausaCada, setPausaCada] = useState(initialConfig.pausaCada ?? 1);
  const [pausaMinima, setPausaMinima] = useState(initialConfig.pausaMinima ?? 5);
  const [pausaMaxima, setPausaMaxima] = useState(initialConfig.pausaMaxima ?? 8);
  const [sendDelay, setSendDelay] = useState(initialConfig.sendDelay ?? 5);
  const [maxRetries, setMaxRetries] = useState(initialConfig.maxRetries ?? 3);
  const [timeout, setTimeoutValue] = useState(initialConfig.timeout ?? 60000);
  const [supervisorNumbers, setSupervisorNumbers] = useState(
    initialConfig.supervisorNumbers ? initialConfig.supervisorNumbers.join(',') : ''
  );
  const [currentIndex, setCurrentIndex] = useState(initialConfig.currentIndex ?? 0);
  const [countryCode, setCountryCode] = useState(initialConfig.countryCode ?? '');
  const [openAdvancedSettings, setOpenAdvancedSettings] = useState('none');
  const [excelHeaders, setExcelHeaders] = useState(initialConfig.excelHeaders ?? []);

  const messageTextareaRef = useRef(null);

  useEffect(() => {
    if (initialConfig.excelHeaders) {
      setExcelHeaders(initialConfig.excelHeaders);
    }
  }, [initialConfig.excelHeaders]);

  const insertVariable = (variableName) => {
    const textarea = messageTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = message.substring(0, start) + `{{${variableName}}}` + message.substring(end);

    setMessage(newText);

    setTimeout(() => {
      textarea.selectionStart = start + `{{${variableName}}}`.length;
      textarea.selectionEnd = start + `{{${variableName}}}`.length;
      textarea.focus();
    }, 0);
  };

  const getCurrentConfig = () => ({
    campaignName,
    message,
    messageType,
    mediaPath: selectedFilePath,
    pausaCada,
    pausaMinima,
    pausaMaxima,
    sendDelay,
    maxRetries,
    timeout,
    supervisorNumbers: supervisorNumbers.split(',').map((num) => num.trim()).filter((num) => num),
    currentIndex,
    countryCode,
  });

  const handleMediaSelect = async () => {
    const filePath = await electronAPI.openMediaDialog();
    if (filePath) {
      setSelectedFilePath(filePath);
    }
  };

  const handleNextClick = () => {
    const config = getCurrentConfig();
    if (config.pausaMaxima < config.pausaMinima) {
      config.pausaMinima = config.pausaMaxima - 1;
    }
    onNext(config);
  };

  const handleBackClick = () => {
    onBack();
  };

  const isNextDisabled =
    (messageType === '1' && !message.trim()) || (messageType === '2' && !selectedFilePath);

  const getFileName = () => {
    if (!selectedFilePath) return '';
    const lastSlashIndex = Math.max(selectedFilePath.lastIndexOf('/'), selectedFilePath.lastIndexOf('\\'));
    return selectedFilePath.substring(lastSlashIndex + 1);
  };

  const getCharCounterClass = () => {
    const length = message.length;
    if (length > 4000) return styles.charCounterError;
    if (length > 3500) return styles.charCounterWarning;
    return '';
  };

  return (
    <div className="step-container">
      <h2>Paso 2: Configuración del Mensaje</h2>

      {/* Basic Information Section */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionIcon}>📝</span>
          Información Básica
        </div>
        <div className="form-group">
          <Label htmlFor="campaign-name-input" style={{ fontWeight: 600 }}>
            Nombre de la Campaña
          </Label>
          <Input
            id="campaign-name-input"
            type="text"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Ej: Promoción Black Friday 2024"
            style={{ width: '100%' }}
            size="large"
          />
        </div>
      </div>

      {/* Message Section */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionIcon}>💬</span>
          Contenido del Mensaje
        </div>

        <div className="form-group">
          <Label htmlFor="message-textarea" style={{ fontWeight: 600 }}>
            Mensaje
          </Label>
          <div className={styles.messageBox}>
            <textarea
              id="message-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe tu mensaje aquí... Usa las variables del Excel para personalizar."
              className={styles.textarea}
              ref={messageTextareaRef}
            />
            <div className={`${styles.charCounter} ${getCharCounterClass()}`}>
              {message.length} / 4096
            </div>
          </div>
        </div>

        {excelHeaders.length > 0 && (
          <div className="form-group">
            <Label style={{ fontWeight: 600 }}>Variables Disponibles (haz clic para insertar)</Label>
            <div className={styles.variablesGrid}>
              {excelHeaders.map((header) => (
                <div
                  key={header}
                  className={styles.variableChip}
                  onClick={() => insertVariable(header)}
                >
                  {`{{${header}}}`}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Message Type Section */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionIcon}>📎</span>
          Tipo de Mensaje
        </div>

        <div className={styles.messageTypeCards}>
          <div
            className={`${styles.messageTypeCard} ${messageType === '1' ? styles.messageTypeCardActive : ''}`}
            onClick={() => setMessageType('1')}
          >
            <div className={styles.messageTypeIcon}>💬</div>
            <div className={styles.messageTypeTitle}>Solo Texto</div>
            <div className={styles.messageTypeDescription}>Enviar mensaje de texto únicamente</div>
          </div>

          <div
            className={`${styles.messageTypeCard} ${messageType === '2' ? styles.messageTypeCardActive : ''}`}
            onClick={() => setMessageType('2')}
          >
            <div className={styles.messageTypeIcon}>🖼️</div>
            <div className={styles.messageTypeTitle}>Con Multimedia</div>
            <div className={styles.messageTypeDescription}>Agregar imagen, video o PDF</div>
          </div>
        </div>

        {messageType === '2' && (
          <div className={styles.mediaSection}>
            {!selectedFilePath ? (
              <Button appearance="primary" onClick={handleMediaSelect} size="large">
                📎 Seleccionar Archivo Multimedia
              </Button>
            ) : (
              <>
                <div className={styles.mediaPreview}>
                  <div className={styles.mediaInfo}>
                    <div className={styles.mediaIcon}>📄</div>
                    <div className={styles.mediaFileName}>{getFileName()}</div>
                  </div>
                  <Button appearance="subtle" onClick={() => setSelectedFilePath('')}>
                    🗑️ Eliminar
                  </Button>
                </div>
                <Button appearance="outline" onClick={handleMediaSelect} style={{ marginTop: 'var(--spacing-md)' }}>
                  Cambiar Archivo
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Advanced Settings Section */}
      <div className={styles.section}>
        <Accordion
          collapsible
          openItems={openAdvancedSettings}
          onToggle={(event, data) => setOpenAdvancedSettings(data.openItems)}
        >
          <AccordionItem value="advanced-settings">
            <AccordionHeader expandIconPosition="end">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                <span style={{ fontSize: 'var(--font-size-lg)' }}>⚙️</span>
                <span style={{ fontWeight: 600 }}>Configuración Avanzada</span>
              </div>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.advancedGrid}>
                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Pausa cada (mensajes)</Label>
                  <Input
                    type="number"
                    value={pausaCada}
                    onChange={(e) => setPausaCada(Number(e.target.value))}
                    min={1}
                  />
                  <div className={styles.inputDescription}>Número de mensajes antes de pausar</div>
                </div>

                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Pausa mínima (minutos)</Label>
                  <Input
                    type="number"
                    value={pausaMinima}
                    onChange={(e) => setPausaMinima(Number(e.target.value))}
                    min={1}
                  />
                  <div className={styles.inputDescription}>Tiempo mínimo de pausa</div>
                </div>

                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Pausa máxima (minutos)</Label>
                  <Input
                    type="number"
                    value={pausaMaxima}
                    onChange={(e) => setPausaMaxima(Math.max(2, Number(e.target.value)))}
                    min={2}
                  />
                  <div className={styles.inputDescription}>Tiempo máximo de pausa</div>
                </div>

                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Retraso de envío (segundos)</Label>
                  <Input
                    type="number"
                    value={sendDelay}
                    onChange={(e) => setSendDelay(Number(e.target.value))}
                    min={5}
                  />
                  <div className={styles.inputDescription}>Demora entre mensajes</div>
                </div>

                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Máximo de reintentos</Label>
                  <Input
                    type="number"
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(Number(e.target.value))}
                    min={1}
                  />
                  <div className={styles.inputDescription}>Reintentos por mensaje fallido</div>
                </div>

                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Timeout (ms)</Label>
                  <Input
                    type="number"
                    value={timeout}
                    onChange={(e) => setTimeoutValue(Number(e.target.value))}
                    min={60000}
                  />
                  <div className={styles.inputDescription}>Tiempo de espera por mensaje</div>
                </div>
              </div>

              <div style={{ marginTop: 'var(--spacing-lg)' }}>
                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Números de supervisor</Label>
                  <Input
                    type="text"
                    value={supervisorNumbers}
                    onChange={(e) => setSupervisorNumbers(e.target.value)}
                    placeholder="Ej: 5049999999, 5049999999"
                    style={{ width: '100%' }}
                  />
                  <div className={styles.inputDescription}>Separados por coma, sin espacios adicionales</div>
                </div>
              </div>

              <div style={{ marginTop: 'var(--spacing-lg)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)' }}>
                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Iniciar desde índice</Label>
                  <Input
                    type="number"
                    value={currentIndex}
                    onChange={(e) => setCurrentIndex(Number(e.target.value))}
                    min={0}
                  />
                  <div className={styles.inputDescription}>Contacto inicial (0 = primero)</div>
                </div>

                <div className={styles.inputGroup}>
                  <Label className={styles.inputLabel}>Código de país</Label>
                  <Input
                    type="text"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    placeholder="Ej: 502"
                  />
                  <div className={styles.inputDescription}>Código de área del país</div>
                </div>
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Actions */}
      <div className="step-actions step-actions-spread">
        <Button appearance="secondary" onClick={handleBackClick} size="large">
          ← Atrás
        </Button>
        <Button appearance="primary" onClick={handleNextClick} disabled={isNextDisabled} size="large">
          Siguiente →
        </Button>
      </div>
    </div>
  );
}

export default Step2_Config;
