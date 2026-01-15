# Plan de Migración de Repositorio para Pixibot

## Análisis de la Situación Actual

### El Problema
Las aplicaciones Pixibot existentes (v1.0.5, v1.0.6, v1.0.7) buscan actualizaciones en `WA---Pixibot`. Si simplemente cambiamos todo a `Pixibot-Releases`, esas aplicaciones **nunca recibirán la actualización**.

### Estrategia de Migración en 2 Fases

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FASE 1: v1.0.8                                  │
│                                                                         │
│  • Se publica en WA---Pixibot (repo actual)                            │
│  • Las apps existentes la reciben normalmente                          │
│  • INCLUYE código para buscar futuras updates en Pixibot-Releases      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     FASE 2: v1.0.9 en adelante                         │
│                                                                         │
│  • Se publican en Pixibot-Releases (repo nuevo)                        │
│  • Las apps con v1.0.8+ ya buscan aquí                                 │
│  • Migración completa                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## FASE 1: Cambios para v1.0.8 (Esta actualización)

### Archivos a Modificar

#### 1. `electron/main.js` - Configurar auto-updater para buscar en nuevo repo

**Cambio**: Modificar la lógica del auto-updater para que SIEMPRE use `Pixibot-Releases` (sin importar la versión actual).

```javascript
// ANTES (líneas 251-273):
if (app.isPackaged && app.getName() === 'Pixibot') {
    const currentVersion = app.getVersion();
    const migrationVersion = '1.0.4';

    if (currentVersion <= migrationVersion) {
        autoUpdater.setFeedURL({...});
    } else {
        logToRenderer('info', '✅ Using standard Pixibot-Releases repository');
    }
}

// DESPUÉS:
if (app.isPackaged && app.getName() === 'Pixibot') {
    logToRenderer('info', '🔄 Pixibot: Configurando actualizaciones desde Pixibot-Releases');
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'GerDaBri',
        repo: 'Pixibot-Releases',
        releaseType: 'release'
    });
    logToRenderer('info', '✅ Pixibot: Auto-updater configurado para Pixibot-Releases');
}
```

**Razón**: Esta es la clave de la migración. La app v1.0.8 buscará actualizaciones en `Pixibot-Releases`, donde estarán las futuras versiones.

---

#### 2. `brands/pixibot/brand.config.json` - SIN CAMBIOS por ahora

**NO modificar** - Mantener `"repo": "WA---Pixibot"` para que v1.0.8 se publique en el repo actual.

```json
"github": {
  "owner": "GerDaBri",
  "repo": "WA---Pixibot",  // ← Mantener así para FASE 1
  "releaseType": "release"
}
```

---

#### 3. `package.json` - SIN CAMBIOS por ahora

**NO modificar** - Mantener para que electron-builder publique en `WA---Pixibot`.

```json
"publish": {
  "provider": "github",
  "owner": "GerDaBri",
  "repo": "WA---Pixibot",  // ← Mantener así para FASE 1
  "releaseType": "release"
}
```

---

#### 4. `.github/workflows/build.yml` - SIN CAMBIOS por ahora

**NO modificar** - La lógica actual funciona para publicar en `WA---Pixibot`.

---

## Resumen FASE 1 (v1.0.8)

| Archivo | Cambio |
|---------|--------|
| `electron/main.js` | **MODIFICAR** - setFeedURL siempre a `Pixibot-Releases` |
| `brands/pixibot/brand.config.json` | Sin cambios |
| `package.json` | Sin cambios |
| `.github/workflows/build.yml` | Sin cambios |

### Resultado de FASE 1:
- v1.0.8 se publica en `WA---Pixibot` ✓
- Apps existentes reciben v1.0.8 ✓
- Apps con v1.0.8 buscarán updates en `Pixibot-Releases` ✓

---

## FASE 2: Cambios para v1.0.9+ (Después de que usuarios actualicen)

Una vez que los usuarios tengan v1.0.8, hacer estos cambios:

#### 1. `brands/pixibot/brand.config.json`

```json
// Cambiar:
"github": {
  "owner": "GerDaBri",
  "repo": "Pixibot-Releases",  // ← Cambiar aquí
  "releaseType": "release"
}
```

#### 2. `package.json`

```json
// Cambiar:
"publish": {
  "provider": "github",
  "owner": "GerDaBri",
  "repo": "Pixibot-Releases",  // ← Cambiar aquí
  "releaseType": "release"
}
```

#### 3. `.github/workflows/build.yml`

Modificar para que pixibot use `BRAND_RELEASE_TOKEN`:

```yaml
# Eliminar la lógica condicional
# Usar siempre BRAND_RELEASE_TOKEN para todos los brands
```

---

## Prerrequisitos

### Para FASE 1:
- Ninguno adicional - usa la configuración actual

### Para FASE 2:
- Verificar que `BRAND_RELEASE_TOKEN` existe en secrets de `WA---Pixibot`
- El token debe tener permisos para crear releases en `Pixibot-Releases`

---

## Plan de Ejecución

### Ahora (FASE 1):
1. ✅ Modificar `electron/main.js` - setFeedURL a Pixibot-Releases
2. ✅ Hacer commit y crear tag `pixibot-v1.0.8`
3. ✅ GitHub Actions publica en `WA---Pixibot`
4. ✅ Usuarios existentes reciben la actualización

### Después (FASE 2) - Cuando confirmes que usuarios actualizaron:
1. Modificar `brand.config.json` → repo: `Pixibot-Releases`
2. Modificar `package.json` → repo: `Pixibot-Releases`
3. Modificar `build.yml` → usar `BRAND_RELEASE_TOKEN`
4. Crear tag `pixibot-v1.0.9`
5. GitHub Actions publica en `Pixibot-Releases`

---

**¿Apruebas este plan para proceder con la FASE 1?**
