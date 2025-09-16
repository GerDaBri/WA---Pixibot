import React, { useState, useRef, useEffect } from 'react';
import {
  Textarea,
  RadioGroup,
  Radio,
  Button,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Input,
  Label,
} from '@fluentui/react-components';

function Step2_Config({ onNext, onBack, electronAPI, initialConfig }) {
  const [message, setMessage] = useState(initialConfig.message ?? '');
  const [campaignName, setCampaignName] = useState(initialConfig.campaignName ?? '');
  const [messageType, setMessageType] = useState(initialConfig.messageType ?? '1');
  const [selectedFilePath, setSelectedFilePath] = useState(initialConfig.mediaPath ?? '');
  const [pausaCada, setPausaCada] = useState(initialConfig.pausaCada ?? 1);
  const [pausaMinima, setPausaMinima] = useState(initialConfig.pausaMinima ?? 3);
  const [pausaMaxima, setPausaMaxima] = useState(initialConfig.pausaMaxima ?? 10);
  const [sendDelay, setSendDelay] = useState(initialConfig.sendDelay ?? 5);
  const [maxRetries, setMaxRetries] = useState(initialConfig.maxRetries ?? 3);
  const [timeout, setTimeoutValue] = useState(initialConfig.timeout ?? 60000);
  const [supervisorNumbers, setSupervisorNumbers] = useState(initialConfig.supervisorNumbers ? initialConfig.supervisorNumbers.join(',') : '');
  const [currentIndex, setCurrentIndex] = useState(initialConfig.currentIndex ?? 0);
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
    supervisorNumbers: supervisorNumbers.split(',').map(num => num.trim()).filter(num => num),
    currentIndex
  });

  const handleMediaSelect = async () => {
    const filePath = await electronAPI.openMediaDialog();
    if (filePath) {
      setSelectedFilePath(filePath);
    }
  };

  const handleNextClick = () => {
    const config = getCurrentConfig();
    onNext(config);
  };

  const handleBackClick = () => {
    onBack();
  };

  const isNextDisabled = (messageType === '1' && !message.trim()) || (messageType === '2' && !selectedFilePath);

  return (
    <div className="step-container">
      <h2>Paso 2: Configuración del Mensaje</h2>

      <div className="form-group">
        <Label htmlFor="campaign-name-input">Nombre de la Campaña:</Label>
        <Input
          id="campaign-name-input"
          type="text"
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Introduce el nombre de la campaña"
          style={{ width: '100%' }}
        />
      </div>

      <div className="form-group">
        <Label htmlFor="message-textarea">Mensaje:</Label>
        <Textarea
          id="message-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Escribe tu mensaje aquí..."
          rows={5}
          style={{ width: '100%' }}
          ref={messageTextareaRef}
        />
      </div>

      {excelHeaders.length > 0 && (
        <div className="form-group">
          <Label>Variables Disponibles:</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {excelHeaders.map((header) => (
              <Button
                key={header}
                size="small"
                appearance="outline"
                onClick={() => insertVariable(header)}
              >
                {`{{${header}}}`}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="form-group">
        <RadioGroup value={messageType} onChange={(e, data) => setMessageType(data.value)} layout="horizontal">
          <Radio value="1" label="Solo Texto" />
          <Radio value="2" label="Imagen/Archivos" />
        </RadioGroup>
      </div>

      {messageType === '2' && (
        <div className="form-group">
          {!selectedFilePath ? (
            <Button appearance="secondary" onClick={handleMediaSelect}>
              Seleccionar Archivo
            </Button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <Label style={{ marginRight: '10px' }}>Archivo Seleccionado:</Label>
                <Input value={selectedFilePath ? selectedFilePath.substring(selectedFilePath.lastIndexOf('/') + 1).substring(selectedFilePath.lastIndexOf('\\') + 1) : ''} readOnly style={{ flexGrow: 1 }} />
                <Button appearance="secondary" onClick={() => setSelectedFilePath('')} style={{ marginLeft: '10px' }}>
                  Eliminar Archivo
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="form-group">
        <Accordion collapsible openItems={openAdvancedSettings} onToggle={(event, data) => setOpenAdvancedSettings(data.openItems)}>
          <AccordionItem value="advanced-settings">
            <AccordionHeader>Configuración Avanzada</AccordionHeader>
            <AccordionPanel>
              <div className="form-group">
                <Label htmlFor="pausaCada-input">Pausa cada (mensajes):</Label>
                <Input
                  id="pausaCada-input"
                  type="number"
                  value={pausaCada}
                  onChange={(e) => setPausaCada(Number(e.target.value))}
                  min={1}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="pausaMinima-input">Pausa mínima (minutos):</Label>
                <Input
                  id="pausaMinima-input"
                  type="number"
                  value={pausaMinima}
                  onChange={(e) => setPausaMinima(Number(e.target.value))}
                  min={1}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="pausaMaxima-input">Pausa máxima (minutos):</Label>
                <Input
                  id="pausaMaxima-input"
                  type="number"
                  value={pausaMaxima}
                  onChange={(e) => setPausaMaxima(Number(e.target.value))}
                  min={2}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="sendDelay-input">Retraso de envío (segundos):</Label>
                <Input
                  id="sendDelay-input"
                  type="number"
                  value={sendDelay}
                  onChange={(e) => setSendDelay(Number(e.target.value))}
                  min={5}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="maxRetries-input">Máximo de reintentos:</Label>
                <Input
                  id="maxRetries-input"
                  type="number"
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                  min={1}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="timeout-input">Tiempo de espera (milisegundos):</Label>
                <Input
                  id="timeout-input"
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeoutValue(Number(e.target.value))}
                  min={60000}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="supervisorNumbers-input">Números de Supervisor (separados por coma):</Label>
                <Input
                  id="supervisorNumbers-input"
                  type="text"
                  value={supervisorNumbers}
                  onChange={(e) => setSupervisorNumbers(e.target.value)}
                  placeholder="Ej: 50499887766, 50411223344"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="form-group">
                <Label htmlFor="currentIndex-input">Iniciar desde el índice:</Label>
                <Input
                  id="currentIndex-input"
                  type="number"
                  value={currentIndex}
                  onChange={(e) => setCurrentIndex(Number(e.target.value))}
                  min={0}
                />
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="step-actions step-actions-spread">
        <Button appearance="secondary" onClick={handleBackClick}>
          Atrás
        </Button>
        <Button appearance="primary" onClick={handleNextClick} disabled={isNextDisabled}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}

export default Step2_Config;
