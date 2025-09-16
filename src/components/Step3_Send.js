import React, { useEffect, useState } from 'react';
import {
  Button,
  Spinner,
  Text,
  Image,
  Card,
  CardHeader,
} from '@fluentui/react-components';

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
    return <Image src={src} alt="Image Preview" style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }} />;
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
      <video controls style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }}>
        <source src={src} type={mimeType} />
        Your browser does not support the video tag.
      </video>
    );
  } else if (fileExtension === 'pdf') {
    return (
      <iframe
        src={src}
        title="PDF Preview"
        style={{ width: '100%', height: '200px', border: 'none' }}
      >
        <p>Your browser does not support iframes. You can <a href={src} target="_blank" rel="noopener noreferrer">download the PDF</a> instead.</p>
      </iframe>
    );
  } else {
    // Generic file preview
    return (
      <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px', textAlign: 'center' }}>
        <Text>📁 Archivo adjunto: {fileName}</Text>
        <Text size="small" style={{ display: 'block', marginTop: '5px' }}>No hay vista previa disponible para este tipo de archivo.</Text>
        <a href={src} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: '10px' }}>Descargar {fileName}</a>
      </div>
    );
  }
};

function Step3_Send({ onBack, onNext, electronAPI, campaign, qrCodeData, sessionStatus, setSessionStatus, setQrCodeData }) {
  const [firstRowData, setFirstRowData] = useState(null);
  const [previewMessage, setPreviewMessage] = useState('');
  const [phoneNumber, setPhoneNumber] = useState(null);
  const [showReconnectButton, setShowReconnectButton] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (sessionStatus === 'disconnected' || sessionStatus === 'auth_failure') {
      const timer = setTimeout(() => {
        setShowReconnectButton(true);
      }, 5000);

      return () => {
        clearTimeout(timer);
        setShowReconnectButton(false);
      };
    } else {
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
  }, [electronAPI, sessionStatus]); // Re-fetch when electronAPI or sessionStatus changes

  const handleLogout = async () => {
    if (electronAPI) {
      setIsLoggingOut(true);
      const result = await electronAPI.logout();
      if (!result.success) {
        setIsLoggingOut(false);
        alert(`Error al cerrar sesión: ${result.error || 'Error desconocido'}`);
      }
      // On success, App.js will receive an event and change sessionStatus,
      // causing this component to re-render without the logout button.
    }
  };

  const handleStartSending = () => {
    console.log("Step3_Send: Attempting to start sending.");
    if (electronAPI && campaign?.config && campaign.config.excelPath && sessionStatus === 'ready') {
      console.log("Step3_Send: Starting sending process.");
      // The full config is now campaign.config, and startFromIndex is managed by whatsapp-logic
      electronAPI.startSending(campaign.config);
      // Transition to Step 4 after starting the sending process
      if (onNext) {
        onNext();
      }
    } else {
      console.warn("Step3_Send: Cannot start sending: client not ready or config missing. Current sessionStatus:", sessionStatus);
    }
  };

  return (
    <div className="step-container">
        <h2>Paso 3: Conexión y Envío</h2>
        <div className="step3-layout">
            {/* Left Panel: Control */}
            <Card className="step3-panel session-control-panel">
                <CardHeader header={<Text weight="bold">Control de Sesión</Text>} />
                <div className="session-status-container">
                {sessionStatus === 'initializing' && (
                    <Spinner label="Conectando a WhatsApp..." />
                )}
                {sessionStatus === 'qr_received' && qrCodeData && (
                    <>
                    <Text>Escanea el código QR con tu teléfono:</Text>
                    <Image src={qrCodeData} alt="QR Code" className="qr-code" />
                    <Spinner label="Esperando escaneo..." />
                    </>
                )}
                {sessionStatus === 'ready' && (
                    <>
                    <Text className="status-text status-text-success">✅ Sesión Activa</Text>
                    {phoneNumber && <Text className="status-text">Número: {phoneNumber}</Text>}
                    <div className="step-actions">
                        <Button 
                            appearance="secondary" 
                            onClick={handleLogout} 
                            disabled={sessionStatus !== 'ready' || isLoggingOut}
                            icon={isLoggingOut ? <Spinner size="tiny" /> : undefined}
                        >
                            {isLoggingOut ? 'Cerrando Sesión...' : 'Cerrar Sesión'}
                        </Button>
                    </div>
                    </>
                )}
                {sessionStatus === 'disconnected' && (
                    <>
                    <Text className="status-text status-text-error">Sesión Desconectada</Text>
                    <div className="step-actions">
                        {showReconnectButton && (
                            <Button appearance="primary" onClick={() => electronAPI.initializeClient()}>
                                Reconectar
                            </Button>
                        )}
                    </div>
                    </>
                )}
                {sessionStatus === 'auth_failure' && (
                    <>
                    <Text className="status-text status-text-error">❌ Error de Autenticación</Text>
                    <Text style={{ textAlign: 'center', marginTop: '10px' }}>Por favor, intenta reconectar o reinicia la aplicación.</Text>
                    <div className="step-actions">
                        {showReconnectButton && (
                            <Button appearance="primary" onClick={() => electronAPI.initializeClient()}>
                                Reconectar
                            </Button>
                        )}
                    </div>
                    </>
                )}
                </div>
                <div className="step-actions">
                    <Button appearance="secondary" onClick={() => onBack()}>
                    Atrás
                    </Button>
                </div>
            </Card>

            {/* Right Panel: Preview and Action */}
            <div className="step3-panel">
                {campaign?.config && (
                <Card>
                    <CardHeader header={<Text weight="bold">Vista Previa del Mensaje</Text>} />
                    <div className="message-preview">
                        {campaign.config.mediaPath && (
                            <FilePreview filePath={campaign.config.mediaPath} />
                        )}
                        <div>{previewMessage}</div>
                    </div>
                </Card>
                )}

                <Card className="session-control-panel">
                    <Button
                        appearance="primary"
                        onClick={handleStartSending}
                        disabled={sessionStatus !== 'ready' || (campaign?.total > 0 && campaign?.sent === campaign?.total)}
                        style={{ width: '100%' }}
                    >
                        {campaign?.sent > 0 && campaign?.sent < campaign?.total ? 'Reanudar Envío' : 'Comenzar Envío'}
                    </Button>
                </Card>
            </div>
        </div>
    </div>
  );
}

export default Step3_Send;
