import React, { useState, useEffect } from 'react';
import { Button, ProgressBar, Text } from '@fluentui/react-components';
import { CheckmarkCircle20Filled, DismissCircle20Filled } from '@fluentui/react-icons';
import '../styles/update-notification.css';

const UpdateNotification = ({
  status = 'idle',
  updateInfo = null,
  downloadProgress = null,
  error = null,
  onDownload = () => {},
  onInstall = () => {},
  onIgnore = () => {},
  onRetry = () => {},
  onClose = () => {}
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Mostrar/ocultar notificación basado en status
  useEffect(() => {
    if (status !== 'idle') {
      setIsVisible(true);
      setIsAnimating(true);
    }
  }, [status]);

  // Función para formatear bytes
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Función para formatear velocidad - mejorada para mostrar velocidades más precisas
  const formatSpeed = (bytesPerSecond) => {
    if (!bytesPerSecond || bytesPerSecond === 0) return '0 KB/s';
    
    const k = 1024;
    if (bytesPerSecond < k) return Math.round(bytesPerSecond) + ' B/s';
    if (bytesPerSecond < k * k) return (bytesPerSecond / k).toFixed(1) + ' KB/s';
    if (bytesPerSecond < k * k * k) return (bytesPerSecond / (k * k)).toFixed(1) + ' MB/s';
    return (bytesPerSecond / (k * k * k)).toFixed(1) + ' GB/s';
  };

  // Renderizar contenido según estado
  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className="update-content">
            <div className="update-icon">🔍</div>
            <div className="update-text">
              <Text weight="semibold">Verificando actualizaciones...</Text>
            </div>
          </div>
        );

      case 'available':
        return (
          <div className="update-content">
            <div className="update-icon">🔄</div>
            <div className="update-text">
              <Text weight="semibold">Nueva actualización disponible</Text>
              {updateInfo?.version && (
                <Text size={200}>Versión: {updateInfo.version}</Text>
              )}
              <Text size={200}>Descargando automáticamente...</Text>
            </div>
          </div>
        );

      case 'downloading':
        return (
          <div className="update-content">
            <div className="update-icon">⬇️</div>
            <div className="update-text">
              <Text weight="semibold">Descargando actualización...</Text>
              {downloadProgress && (
                <>
                  <ProgressBar 
                    value={downloadProgress.percent} 
                    max={100}
                    className="update-progress"
                  />
                  <div className="update-progress-details">
                    <Text size={200}>
                      {downloadProgress.percent}% ({formatSpeed(downloadProgress.speed)})
                    </Text>
                    <Text size={200}>
                      {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
                    </Text>
                  </div>
                </>
              )}
            </div>
          </div>
        );

      case 'downloaded':
        return (
          <div className="update-content">
            <div className="update-icon">
              <CheckmarkCircle20Filled style={{ fontSize: '24px', color: 'var(--color-success)' }} />
            </div>
            <div className="update-text">
              <Text weight="semibold">Actualización descargada</Text>
              <Text size={200}>¿Instalar y reiniciar ahora?</Text>
            </div>
            <div className="update-actions">
              <Button size="small" appearance="primary" onClick={onInstall}>
                Sí
              </Button>
              <Button size="small" appearance="subtle" onClick={onClose}>
                Más tarde
              </Button>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="update-content">
            <div className="update-icon">
              <DismissCircle20Filled style={{ fontSize: '24px', color: 'var(--color-error)' }} />
            </div>
            <div className="update-text">
              <Text weight="semibold">Error al actualizar</Text>
              <Text size={200}>{error || 'No se pudo descargar'}</Text>
            </div>
            <div className="update-actions">
              <Button size="small" appearance="primary" onClick={onRetry}>
                Reintentar
              </Button>
              <Button size="small" appearance="subtle" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (!isVisible || status === 'idle') {
    return null;
  }

  return (
    <div 
      className={`update-notification ${isAnimating ? 'update-notification--slide-in' : ''}`}
      role="alert"
      aria-live="polite"
    >
      {renderContent()}
      <button 
        className="update-close-btn"
        onClick={onClose}
        aria-label="Cerrar notificación"
      >
        ×
      </button>
    </div>
  );
};

export default UpdateNotification;