# Plan de Implementación: Sistema de Alertas de Actualización

## Resumen Ejecutivo

Este documento detalla el plan completo para implementar un sistema de notificaciones discretas de actualización con reinicio automático en la aplicación WhatsApp Bot (Pixibot).

## Objetivos

1. **Mantener funcionalidad existente**: Preservar el diálogo de confirmación actual
2. **Agregar notificaciones discretas**: Toast en esquina superior izquierda
3. **Implementar reinicio automático**: La app se reinicia sola después de instalar
4. **Mejorar experiencia de usuario**: Feedback visual del progreso de descarga

## Archivos a Modificar

### 1. `electron/preload.js`
**Propósito**: Exponer eventos de actualización al renderer process

```javascript
// Agregar al objeto electronAPI:
updateEvents: {
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onUpdateError: (callback) => ipcRenderer.on('update-error', callback),
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.removeAllListeners('update-error');
  }
}
```

### 2. `src/components/UpdateNotification.js` (NUEVO)
**Propósito**: Componente React para mostrar notificaciones de actualización

**Estados del componente**:
- `idle`: Sin actualizaciones
- `available`: Actualización disponible
- `downloading`: Descargando
- `downloaded`: Listo para instalar
- `error`: Error en el proceso

**Props principales**:
```javascript
{
  status: string,
  updateInfo: { version: string, releaseNotes?: string },
  downloadProgress: { percent: number, speed: number, transferred: number, total: number },
  error: string,
  onDownload: function,
  onInstall: function,
  onIgnore: function,
  onRetry: function,
  onClose: function
}
```

### 3. `src/App.js`
**Propósito**: Integrar el sistema de actualizaciones globalmente

**Modificaciones**:
- Agregar estado para actualizaciones
- Configurar listeners de eventos
- Integrar componente UpdateNotification
- Manejar cleanup de listeners

**Nuevo estado**:
```javascript
const [updateStatus, setUpdateStatus] = useState('idle');
const [updateInfo, setUpdateInfo] = useState(null);
const [downloadProgress, setDownloadProgress] = useState(null);
const [updateError, setUpdateError] = useState(null);
```

### 4. `electron/main.js`
**Propósito**: Configurar reinicio automático después de instalación

**Modificaciones en el evento `update-downloaded`**:
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
            // NUEVA FUNCIONALIDAD: Reinicio automático
            autoUpdater.quitAndInstall(false, true); // (isSilent, isForceRunAfter)
        }
    });
});
```

### 5. `src/styles/update-notification.css` (NUEVO)
**Propósito**: Estilos para el componente de notificación

**Características principales**:
- Posición fija en esquina superior izquierda
- Animaciones suaves de entrada/salida
- Diseño responsive y accesible
- Z-index alto para estar sobre otros elementos

### 6. `docs/AUTO_UPDATES.md`
**Propósito**: Actualizar documentación existente

**Secciones a agregar**:
- Nuevas funcionalidades de UI
- Configuración de reinicio automático
- Troubleshooting para notificaciones
- Screenshots del nuevo sistema

## Flujo de Implementación

### Fase 1: Preparación del Backend
1. Modificar `electron/preload.js` para exponer eventos
2. Actualizar `electron/main.js` para reinicio automático
3. Probar eventos de actualización en desarrollo

### Fase 2: Desarrollo del Frontend
1. Crear componente `UpdateNotification.js`
2. Desarrollar estilos CSS
3. Integrar en `App.js`
4. Probar estados y transiciones

### Fase 3: Integración y Testing
1. Probar flujo completo de actualización
2. Verificar reinicio automático
3. Testear manejo de errores
4. Validar en diferentes escenarios

### Fase 4: Documentación y Deployment
1. Actualizar documentación
2. Crear release de prueba
3. Validar en producción
4. Monitorear funcionamiento

## Consideraciones Técnicas

### Compatibilidad
- ✅ Compatible con sistema existente
- ✅ No rompe funcionalidades actuales
- ✅ Funciona con GitHub Actions workflow
- ✅ Mantiene configuración de electron-updater

### Performance
- Componente lazy-loaded
- Listeners optimizados
- Cleanup automático de memoria
- Animaciones con CSS transforms

### Seguridad
- Validación de eventos IPC
- Sanitización de datos de actualización
- Manejo seguro de errores
- Logs para auditoría

### Accesibilidad
- Contraste adecuado (WCAG 2.1)
- Navegación por teclado
- Aria-labels apropiados
- Tamaños de botón accesibles

## Métricas de Éxito

### Funcionalidad
- [ ] Notificaciones aparecen correctamente
- [ ] Progreso de descarga se muestra en tiempo real
- [ ] Reinicio automático funciona después de instalación
- [ ] Manejo de errores es robusto

### Experiencia de Usuario
- [ ] Notificaciones no son intrusivas
- [ ] Animaciones son suaves
- [ ] Feedback es claro y útil
- [ ] Proceso es intuitivo

### Técnico
- [ ] No hay memory leaks
- [ ] Performance no se ve afectada
- [ ] Compatibilidad con todas las pantallas
- [ ] Logs son informativos

## Riesgos y Mitigaciones

### Riesgo: Reinicio automático falla
**Mitigación**: Fallback al comportamiento actual + logging detallado

### Riesgo: Notificaciones interfieren con UI
**Mitigación**: Z-index cuidadoso + posicionamiento fijo + testing exhaustivo

### Riesgo: Memory leaks por listeners
**Mitigación**: Cleanup automático + useEffect dependencies + testing de memoria

### Riesgo: Incompatibilidad con versiones futuras
**Mitigación**: Código modular + documentación detallada + versionado semántico

## Cronograma Estimado

- **Fase 1**: 2-3 horas
- **Fase 2**: 4-5 horas  
- **Fase 3**: 2-3 horas
- **Fase 4**: 1-2 horas

**Total estimado**: 9-13 horas de desarrollo

## Próximos Pasos

1. **Inmediato**: Modificar `preload.js` y `main.js`
2. **Siguiente**: Crear componente `UpdateNotification`
3. **Después**: Integrar en `App.js`
4. **Final**: Testing y documentación

## Notas Adicionales

- Mantener compatibilidad con el sistema de licencias existente
- Considerar estado de campañas activas durante actualizaciones
- Preservar configuración de usuario después del reinicio
- Implementar logging detallado para debugging