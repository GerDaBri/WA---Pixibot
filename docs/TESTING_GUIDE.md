# Guía de Testing: Sistema de Notificaciones de Actualización

## Resumen

Esta guía detalla cómo probar el nuevo sistema de notificaciones de actualización con reinicio automático implementado en la aplicación WhatsApp Bot (Pixibot).

## Prerrequisitos para Testing

### Entorno de Desarrollo
- Node.js 20+ instalado
- Dependencias del proyecto instaladas (`npm install`)
- Aplicación funcionando en modo desarrollo

### Entorno de Producción
- Aplicación empaquetada con `npm run build`
- Acceso a GitHub repository para crear releases
- Permisos para crear tags y releases

## Tipos de Testing

### 1. Unit Testing

#### Componente UpdateNotification
```bash
# Crear archivo: src/components/__tests__/UpdateNotification.test.js

import { render, screen, fireEvent } from '@testing-library/react';
import UpdateNotification from '../UpdateNotification';

describe('UpdateNotification', () => {
  test('no renderiza cuando status es idle', () => {
    const { container } = render(<UpdateNotification status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  test('muestra mensaje correcto cuando hay actualización disponible', () => {
    render(
      <UpdateNotification 
        status="available" 
        updateInfo={{ version: '1.0.4' }}
      />
    );
    expect(screen.getByText('Nueva actualización disponible')).toBeInTheDocument();
    expect(screen.getByText('Versión: 1.0.4')).toBeInTheDocument();
  });

  test('muestra progreso de descarga correctamente', () => {
    const progress = {
      percent: 75,
      speed: 1024000,
      transferred: 15728640,
      total: 20971520
    };
    
    render(
      <UpdateNotification 
        status="downloading" 
        downloadProgress={progress}
      />
    );
    
    expect(screen.getByText('Descargando actualización...')).toBeInTheDocument();
    expect(screen.getByText('75% (1.00 MB/s)')).toBeInTheDocument();
  });

  test('llama callback correcto al hacer click en descargar', () => {
    const mockOnDownload = jest.fn();
    render(
      <UpdateNotification 
        status="available" 
        onDownload={mockOnDownload}
      />
    );
    
    fireEvent.click(screen.getByText('Descargar'));
    expect(mockOnDownload).toHaveBeenCalledTimes(1);
  });
});
```

#### Funciones de Utilidad
```bash
# Crear archivo: src/utils/__tests__/formatters.test.js

import { formatBytes, formatSpeed } from '../formatters';

describe('formatBytes', () => {
  test('formatea bytes correctamente', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1048576)).toBe('1.00 MB');
    expect(formatBytes(1073741824)).toBe('1.00 GB');
  });
});

describe('formatSpeed', () => {
  test('formatea velocidad correctamente', () => {
    expect(formatSpeed(1024)).toBe('1.00 KB/s');
    expect(formatSpeed(1048576)).toBe('1.00 MB/s');
  });
});
```

### 2. Integration Testing

#### Testing de Eventos IPC
```bash
# Crear archivo: __tests__/integration/update-events.test.js

const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

describe('Update Events Integration', () => {
  let mainWindow;

  beforeAll(async () => {
    await app.whenReady();
    mainWindow = new BrowserWindow({
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
  });

  test('main process envía evento update-available', (done) => {
    mainWindow.webContents.once('ipc-message', (event, channel, data) => {
      if (channel === 'update-available') {
        expect(data).toHaveProperty('version');
        done();
      }
    });

    // Simular evento de autoUpdater
    autoUpdater.emit('update-available', { version: '1.0.4' });
  });

  test('renderer puede solicitar descarga de actualización', (done) => {
    ipcMain.once('download-update', () => {
      done();
    });

    mainWindow.webContents.send('download-update');
  });

  afterAll(() => {
    mainWindow.close();
    app.quit();
  });
});
```

### 3. E2E Testing

#### Flujo Completo de Actualización
```bash
# Crear archivo: __tests__/e2e/update-flow.test.js

const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('Update Flow E2E', () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    electronApp = await electron.launch({ args: ['.'] });
    page = await electronApp.firstWindow();
  });

  test('muestra notificación cuando hay actualización disponible', async () => {
    // Simular actualización disponible
    await page.evaluate(() => {
      window.electronAPI.updateEvents.onUpdateAvailable({
        version: '1.0.4',
        releaseNotes: 'Bug fixes and improvements'
      });
    });

    // Verificar que aparece la notificación
    await expect(page.locator('.update-notification')).toBeVisible();
    await expect(page.locator('text=Nueva actualización disponible')).toBeVisible();
  });

  test('inicia descarga al hacer click en descargar', async () => {
    await page.click('text=Descargar');
    
    // Simular progreso de descarga
    await page.evaluate(() => {
      window.electronAPI.updateEvents.onDownloadProgress({
        percent: 50,
        speed: 1024000,
        transferred: 10485760,
        total: 20971520
      });
    });

    await expect(page.locator('text=Descargando actualización...')).toBeVisible();
    await expect(page.locator('text=50%')).toBeVisible();
  });

  test('muestra opción de instalación cuando descarga completa', async () => {
    await page.evaluate(() => {
      window.electronAPI.updateEvents.onUpdateDownloaded({
        version: '1.0.4'
      });
    });

    await expect(page.locator('text=Actualización descargada')).toBeVisible();
    await expect(page.locator('text=¿Instalar y reiniciar ahora?')).toBeVisible();
  });

  test.afterAll(async () => {
    await electronApp.close();
  });
});
```

## Testing Manual

### Escenario 1: Actualización Disponible

1. **Preparación:**
   - Crear release en GitHub con versión superior a la actual
   - Asegurar que la app esté en modo producción (`app.isPackaged = true`)

2. **Pasos:**
   - Abrir la aplicación
   - Esperar verificación automática de actualizaciones (5 minutos)
   - Verificar que aparece notificación en esquina superior izquierda

3. **Resultados esperados:**
   - ✅ Notificación aparece con ícono 🔄
   - ✅ Muestra versión disponible
   - ✅ Botones "Descargar" e "Ignorar" funcionan

### Escenario 2: Descarga de Actualización

1. **Preparación:**
   - Tener actualización disponible (Escenario 1)
   - Conexión a internet estable

2. **Pasos:**
   - Hacer click en "Descargar"
   - Observar progreso de descarga

3. **Resultados esperados:**
   - ✅ Cambia a estado "downloading" con ícono ⬇️
   - ✅ Barra de progreso se actualiza en tiempo real
   - ✅ Muestra velocidad de descarga y tamaños
   - ✅ Porcentaje se actualiza correctamente

### Escenario 3: Instalación y Reinicio

1. **Preparación:**
   - Tener actualización descargada (Escenario 2)
   - Campaña activa opcional para probar persistencia

2. **Pasos:**
   - Esperar a que termine la descarga
   - Verificar notificación de "Actualización descargada"
   - Hacer click en "Sí" para instalar

3. **Resultados esperados:**
   - ✅ Aparece diálogo modal de confirmación (existente)
   - ✅ Al confirmar, la aplicación se cierra
   - ✅ Actualización se instala automáticamente
   - ✅ **Aplicación se reinicia automáticamente** (nueva funcionalidad)
   - ✅ Estado de campaña se preserva (si aplicable)

### Escenario 4: Manejo de Errores

1. **Preparación:**
   - Simular error de red durante descarga
   - O usar release con archivo corrupto

2. **Pasos:**
   - Intentar descargar actualización
   - Observar comportamiento en caso de error

3. **Resultados esperados:**
   - ✅ Notificación cambia a estado "error" con ícono ❌
   - ✅ Muestra mensaje de error descriptivo
   - ✅ Botón "Reintentar" funciona correctamente
   - ✅ Logs registran el error para debugging

## Testing de Performance

### Métricas a Monitorear

1. **Memoria:**
   - No debe haber memory leaks por listeners
   - Componente debe limpiarse correctamente al desmontar

2. **CPU:**
   - Animaciones no deben consumir CPU excesivo
   - Polling de actualizaciones debe ser eficiente

3. **Red:**
   - Descarga no debe bloquear otras operaciones
   - Progreso debe actualizarse sin saturar IPC

### Herramientas de Monitoreo

```bash
# Monitorear memoria
process.memoryUsage()

# Monitorear CPU
process.cpuUsage()

# Logs de performance
console.time('update-check')
console.timeEnd('update-check')
```

## Testing de Accesibilidad

### Checklist WCAG 2.1

- [ ] Contraste de colores adecuado (4.5:1 mínimo)
- [ ] Navegación por teclado funcional
- [ ] Aria-labels en botones y elementos interactivos
- [ ] Soporte para lectores de pantalla
- [ ] Tamaños de botón accesibles (44px mínimo)

### Testing con Herramientas

```bash
# Instalar axe-core para testing automatizado
npm install --save-dev @axe-core/playwright

# Usar en tests E2E
const { injectAxe, checkA11y } = require('axe-playwright');

test('notificación es accesible', async () => {
  await injectAxe(page);
  await checkA11y(page, '.update-notification');
});
```

## Troubleshooting

### Problemas Comunes

1. **Notificación no aparece:**
   - Verificar que `app.isPackaged = true`
   - Revisar logs de electron-updater
   - Confirmar conectividad a GitHub

2. **Progreso no se actualiza:**
   - Verificar eventos IPC en DevTools
   - Confirmar que listeners están configurados
   - Revisar cleanup de event listeners

3. **Reinicio automático falla:**
   - Verificar parámetros de `quitAndInstall(false, true)`
   - Revisar permisos de instalación
   - Confirmar que no hay procesos bloqueando

4. **Memory leaks:**
   - Verificar cleanup en useEffect
   - Confirmar que listeners se remueven
   - Usar React DevTools Profiler

### Logs de Debugging

```javascript
// Habilitar logs detallados de electron-updater
process.env.ELECTRON_ENABLE_LOGGING = true;

// Logs personalizados
console.log('Update status:', updateStatus);
console.log('Update info:', updateInfo);
console.log('Download progress:', downloadProgress);
```

## Criterios de Aceptación

### Funcionalidad ✅
- [ ] Notificaciones aparecen correctamente en todas las pantallas
- [ ] Progreso de descarga se muestra en tiempo real
- [ ] Reinicio automático funciona después de instalación
- [ ] Manejo de errores es robusto y informativo
- [ ] Estado de aplicación se preserva durante actualización

### UX ✅
- [ ] Notificaciones no son intrusivas
- [ ] Animaciones son suaves y apropiadas
- [ ] Feedback es claro y útil
- [ ] Proceso es intuitivo para el usuario
- [ ] Accesibilidad cumple estándares WCAG 2.1

### Técnico ✅
- [ ] No hay memory leaks
- [ ] Performance no se ve afectada
- [ ] Compatibilidad con todas las pantallas
- [ ] Logs son informativos para debugging
- [ ] Código es mantenible y bien documentado

## Automatización de Testing

### GitHub Actions Workflow

```yaml
# .github/workflows/test-updates.yml
name: Test Update System

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test-updates:
    runs-on: windows-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run unit tests
      run: npm run test:unit
      
    - name: Run integration tests
      run: npm run test:integration
      
    - name: Run E2E tests
      run: npm run test:e2e
      
    - name: Test build with updates
      run: npm run build
```

### Scripts de Package.json

```json
{
  "scripts": {
    "test:unit": "jest src/components/__tests__",
    "test:integration": "jest __tests__/integration",
    "test:e2e": "playwright test __tests__/e2e",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

Esta guía proporciona un framework completo para probar el sistema de notificaciones de actualización, asegurando que funcione correctamente en todos los escenarios posibles.