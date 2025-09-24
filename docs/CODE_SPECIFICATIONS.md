# Especificaciones de Código: Sistema de Notificaciones de Actualización

## Componente UpdateNotification.js

### Estructura del Componente

```javascript
import React, { useState, useEffect } from 'react';
import { Button, ProgressBar, Text } from '@fluentui/react-components';
import './update-notification.css';

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
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Función para formatear velocidad
  const formatSpeed = (bytesPerSecond) => {
    return formatBytes(bytesPerSecond) + '/s';
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
            </div>
            <div className="update-actions">
              <Button size="small" appearance="primary" onClick={onDownload}>
                Descargar
              </Button>
              <Button size="small" appearance="subtle" onClick={onIgnore}>
                Ignorar
              </Button>
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
            <div className="update-icon">✅</div>
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
            <div className="update-icon">❌</div>
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
```

## Estilos CSS (update-notification.css)

```css
.update-notification {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 9999;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 16px;
  max-width: 320px;
  min-width: 280px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.update-notification--slide-in {
  animation: slideInLeft 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.update-notification--slide-out {
  animation: slideOutLeft 0.3s cubic-bezier(0.55, 0.06, 0.68, 0.19);
}

@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideOutLeft {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(-100%);
    opacity: 0;
  }
}

.update-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.update-icon {
  font-size: 24px;
  text-align: center;
  margin-bottom: 4px;
}

.update-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.update-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}

.update-progress {
  margin: 8px 0 4px 0;
}

.update-progress-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}

.update-close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #666;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s ease;
}

.update-close-btn:hover {
  background-color: rgba(0, 0, 0, 0.1);
  color: #333;
}

.update-close-btn:focus {
  outline: 2px solid #0078d4;
  outline-offset: 2px;
}

/* Responsive adjustments */
@media (max-width: 480px) {
  .update-notification {
    left: 10px;
    right: 10px;
    max-width: none;
    min-width: auto;
  }
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .update-notification {
    background: white;
    border: 2px solid black;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
  }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  .update-notification--slide-in,
  .update-notification--slide-out {
    animation: none;
  }
}
```

## Modificaciones en preload.js

```javascript
// Agregar al objeto electronAPI existente:
updateEvents: {
  onUpdateAvailable: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('update-available', subscription);
    return () => ipcRenderer.removeListener('update-available', subscription);
  },
  onUpdateDownloaded: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('update-downloaded', subscription);
    return () => ipcRenderer.removeListener('update-downloaded', subscription);
  },
  onDownloadProgress: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('download-progress', subscription);
    return () => ipcRenderer.removeListener('download-progress', subscription);
  },
  onUpdateError: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('update-error', subscription);
    return () => ipcRenderer.removeListener('update-error', subscription);
  },
  removeAllUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.removeAllListeners('update-error');
  }
},

// Agregar método para controlar actualizaciones
checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
downloadUpdate: () => ipcRenderer.invoke('download-update'),
installUpdate: () => ipcRenderer.invoke('install-update')
```

## Modificaciones en main.js

### Agregar handlers IPC

```javascript
// Agregar después de los handlers existentes
ipcMain.handle('check-for-updates', () => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

ipcMain.handle('download-update', () => {
  if (app.isPackaged) {
    autoUpdater.downloadUpdate();
  }
});

ipcMain.handle('install-update', () => {
  if (app.isPackaged) {
    app.isQuitting = true;
    autoUpdater.quitAndInstall(false, true); // (isSilent, isForceRunAfter)
  }
});
```

### Modificar evento update-downloaded

```javascript
autoUpdater.on('update-downloaded', (info) => {
    logToRenderer('info', '✅ Update downloaded successfully:', info.version);
    if (mainWindow) {
        mainWindow.webContents.send('update-downloaded', info);
    }

    // Mostrar diálogo de confirmación (MANTENER EXISTENTE)
    dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Actualización disponible',
        message: '¡Actualización descargada con éxito!',
        detail: `La versión ${info.version} está lista para instalarse. ¿Desea reiniciar la aplicación ahora para aplicar la actualización?`,
        buttons: ['Yes', 'No'],
        defaultId: 0
    }).then((result) => {
        if (result.response === 0) {
            app.isQuitting = true;
            // MODIFICACIÓN: Reinicio automático con isForceRunAfter = true
            autoUpdater.quitAndInstall(false, true); // (isSilent, isForceRunAfter)
        }
    });
});
```

## Integración en App.js

### Estado para actualizaciones

```javascript
// Agregar al estado existente
const [updateStatus, setUpdateStatus] = useState('idle');
const [updateInfo, setUpdateInfo] = useState(null);
const [downloadProgress, setDownloadProgress] = useState(null);
const [updateError, setUpdateError] = useState(null);
```

### Configurar listeners

```javascript
// Agregar en useEffect de setupListeners
const setupUpdateListeners = () => {
  if (!window.electronAPI?.updateEvents) return;

  const unsubscribeAvailable = window.electronAPI.updateEvents.onUpdateAvailable((info) => {
    setUpdateStatus('available');
    setUpdateInfo(info);
    setUpdateError(null);
  });

  const unsubscribeProgress = window.electronAPI.updateEvents.onDownloadProgress((progress) => {
    setUpdateStatus('downloading');
    setDownloadProgress(progress);
  });

  const unsubscribeDownloaded = window.electronAPI.updateEvents.onUpdateDownloaded((info) => {
    setUpdateStatus('downloaded');
    setUpdateInfo(info);
    setDownloadProgress(null);
  });

  const unsubscribeError = window.electronAPI.updateEvents.onUpdateError((error) => {
    setUpdateStatus('error');
    setUpdateError(error);
  });

  return () => {
    unsubscribeAvailable();
    unsubscribeProgress();
    unsubscribeDownloaded();
    unsubscribeError();
  };
};
```

### Handlers para acciones

```javascript
const handleDownloadUpdate = () => {
  setUpdateStatus('downloading');
  window.electronAPI.downloadUpdate();
};

const handleInstallUpdate = () => {
  window.electronAPI.installUpdate();
};

const handleIgnoreUpdate = () => {
  setUpdateStatus('idle');
  setUpdateInfo(null);
  setUpdateError(null);
};

const handleRetryUpdate = () => {
  setUpdateError(null);
  setUpdateStatus('checking');
  window.electronAPI.checkForUpdates();
};

const handleCloseNotification = () => {
  setUpdateStatus('idle');
  setUpdateInfo(null);
  setDownloadProgress(null);
  setUpdateError(null);
};
```

### Renderizar componente

```javascript
// Agregar en el JSX del return
<UpdateNotification
  status={updateStatus}
  updateInfo={updateInfo}
  downloadProgress={downloadProgress}
  error={updateError}
  onDownload={handleDownloadUpdate}
  onInstall={handleInstallUpdate}
  onIgnore={handleIgnoreUpdate}
  onRetry={handleRetryUpdate}
  onClose={handleCloseNotification}
/>
```

## Consideraciones de Testing

### Unit Tests
- Estados del componente UpdateNotification
- Formateo de bytes y velocidad
- Manejo de props y callbacks

### Integration Tests
- Flujo completo de actualización
- Eventos IPC entre main y renderer
- Persistencia de estado durante actualización

### E2E Tests
- Simulación de actualización disponible
- Descarga y progreso
- Instalación y reinicio automático