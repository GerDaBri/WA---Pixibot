# 🔄 Auto-Updates con electron-updater

## Estado Actual
✅ **electron-updater configurado y funcionando**

## Configuración Implementada

### 1. GitHub Actions Workflow
- **Archivo**: `.github/workflows/build.yml`
- **Trigger**: Push de tags que empiecen con `v` (ej: `v1.0.2`)
- **Acción**: Construye y publica automáticamente en GitHub Releases

### 2. Configuración electron-builder
- **Provider**: GitHub
- **Repository**: `GerDaBri/WA---Pixibot`
- **Release Type**: Release (no draft)
- **NSIS**: Configurado para instalación personalizable

### 3. Implementación en main.js
- ✅ Auto-download habilitado
- ✅ Auto-install en cierre de app
- ✅ Notificaciones al usuario
- ✅ Progress tracking
- ✅ Error handling mejorado
- ✅ Solo verifica updates en producción

## 🚀 Cómo Crear un Release

### Método 1: Script Simple (Recomendado)
```bash
# Usar versión actual
npm run release:simple

# O especificar nueva versión
node scripts/simple-release.js 1.0.2
```

### Método 2: Script Interactivo
```bash
npm run release
```

### Método 3: Manual
```bash
# 1. Actualizar versión en package.json (opcional)
# 2. Commit cambios si los hay
git add .
git commit -m "chore: prepare release v1.0.2"

# 3. Crear y push tag
git tag v1.0.2
git push origin main
git push origin v1.0.2
```

### ⚠️ Solución de Problemas Comunes

**Error: "nothing to commit, working tree clean"**
- Usa `npm run release:simple` en lugar de `npm run release`
- O crea el tag manualmente: `git tag v1.0.2 && git push origin v1.0.2`

**Error: "tag already exists"**
- El script simple maneja esto automáticamente
- O elimina manualmente: `git tag -d v1.0.2 && git push origin :refs/tags/v1.0.2`

## 📦 Proceso de Publicación

1. **Push del tag** → Activa GitHub Actions
2. **GitHub Actions** → Construye la app para Windows
3. **electron-builder** → Crea instalador y archivos de update
4. **GitHub Releases** → Publica automáticamente
5. **electron-updater** → Detecta nueva versión en apps instaladas

## 🔍 Verificación de Updates

### En la App
- Los logs aparecen en la consola de la app
- Notificaciones visuales al usuario
- Diálogo de confirmación para instalar

### En GitHub
- Verificar en: https://github.com/GerDaBri/WA---Pixibot/releases
- Verificar Actions: https://github.com/GerDaBri/WA---Pixibot/actions

## 🛠️ Troubleshooting

### Update no detectado
1. Verificar que la app esté en modo producción (`app.isPackaged = true`)
2. Verificar conexión a internet
3. Revisar logs en la consola de la app

### Build falla en GitHub Actions
1. Verificar que el tag siga el formato `v*.*.*`
2. Revisar logs en GitHub Actions
3. Verificar que package.json tenga la versión correcta

### Error de permisos
1. Verificar que el repositorio sea público o tenga permisos correctos
2. GitHub token se genera automáticamente en Actions

## 📋 Checklist Pre-Release

- [ ] Versión actualizada en `package.json`
- [ ] Cambios commiteados y pusheados
- [ ] Tag creado con formato `v*.*.*`
- [ ] GitHub Actions ejecutándose correctamente
- [ ] Release publicado en GitHub
- [ ] Instalador disponible para descarga

## 🔧 Configuración Avanzada

### Cambiar frecuencia de verificación
En `main.js`, modificar:
```javascript
// Verificar cada 5 minutos
setInterval(() => {
  autoUpdater.checkForUpdatesAndNotify();
}, 5 * 60 * 1000);
```

### Personalizar notificaciones
Modificar los eventos en `main.js` para cambiar mensajes y comportamiento.

### Configurar canal de updates
En `package.json`, agregar:
```json
"build": {
  "publish": {
    "provider": "github",
    "channel": "latest" // o "beta", "alpha"
  }
}