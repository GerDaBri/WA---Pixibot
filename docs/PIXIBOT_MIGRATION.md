# 🚀 Migración de Pixibot a Nueva Arquitectura

## 📋 Resumen de la Migración

Esta guía describe el proceso de migración de las aplicaciones actuales de Pixibot desde el repositorio `WA---Pixibot` al nuevo repositorio `Pixibot-Releases` usando la arquitectura de marca blanca.

## 🎯 Objetivos de la Migración

- ✅ **Repositorio dedicado**: Separar releases de Pixibot del código fuente
- ✅ **Arquitectura consistente**: Usar el mismo sistema que ElevateHub
- ✅ **Migración automática**: Las aplicaciones existentes se migran automáticamente
- ✅ **Sin interrupciones**: Los usuarios no pierden funcionalidad

## 🏗️ Arquitectura Post-Migración

```
📁 Código Fuente (Compartido)
└── GerDaBri/WA---Pixibot
    ├── código fuente completo
    └── brands/pixibot/ (configuración específica)

📁 Releases Pixibot
└── GerDaBri/Pixibot-Releases
    ├── releases automáticas
    └── instaladores de Pixibot
```

## 🔄 Proceso de Migración

### Fase 1: Preparación (✅ Completada)

- [x] **Crear repositorio** `GerDaBri/Pixibot-Releases`
- [x] **Configurar marca** `brands/pixibot/brand.config.json`
- [x] **Implementar lógica de migración** en `electron/main.js`
- [x] **Crear script de migración** `scripts/migrate-pixibot.js`

### Fase 2: Release de Migración (Próxima)

#### 1. Ejecutar migración
```bash
npm run migrate:pixibot
```

#### 2. Proceso automático:
- ✅ **Versión de migración**: `1.0.4`
- ✅ **Configuración aplicada**: Pixibot branding
- ✅ **Repositorio de migración**: `WA---Pixibot` (repo actual para que apps existentes la encuentren)
- ✅ **Repositorio futuro**: `Pixibot-Releases` (para versiones > 1.0.4)
- ✅ **Lógica de migración**: Incluida en el código
- ✅ **Tag creado**: `pixibot-v1.0.4`
- ✅ **GitHub Actions**: Build automático activado
- ✅ **Publicación inicial**: En `WA---Pixibot` (para migración)
- ✅ **Publicación futura**: En `Pixibot-Releases` (después de migración)

### Fase 3: Comportamiento de las Aplicaciones

#### Aplicaciones Existentes (< 1.0.4)
1. **Detectan actualización** en repositorio actual (`WA---Pixibot`)
2. **Descargan versión 1.0.4** desde `WA---Pixibot` (versión de migración)
3. **Se actualizan automáticamente**
4. **Cambio automático**: Después de instalar 1.0.4, buscan futuras actualizaciones en `Pixibot-Releases`

#### Nuevas Instalaciones (≥ 1.0.4)
1. **Instalación desde** `WA---Pixibot` (versión 1.0.4) o `Pixibot-Releases` (versiones futuras)
2. **Configuración inicial**: `Pixibot-Releases` como repositorio
3. **Actualizaciones futuras**: Desde `Pixibot-Releases`

## 🔧 Detalles Técnicos

### Lógica de Migración en `electron/main.js`

```javascript
// Migration logic for Pixibot
if (app.isPackaged && app.getName() === 'Pixibot') {
    const currentVersion = app.getVersion();
    const migrationVersion = '1.0.4';

    // Check if we need to migrate from old repository
    if (currentVersion < migrationVersion) {
        logToRenderer('info', '🔄 Migration: Updating repository configuration for Pixibot');

        // Set feed URL to new repository for migration
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'GerDaBri',
            repo: 'Pixibot-Releases',
            releaseType: 'release'
        });

        logToRenderer('info', '✅ Migration: Now using Pixibot-Releases repository');
    }
}
```

### Configuración de Marca Pixibot

```json
{
  "brandName": "Pixibot",
  "productName": "Pixibot",
  "appId": "com.yourcompany.whatsappbot",
  "repository": {
    "owner": "GerDaBri",
    "repo": "Pixibot-Releases"
  },
  "migration": {
    "enabled": true,
    "currentVersion": "1.0.3",
    "migrationVersion": "1.0.4",
    "oldRepository": "WA---Pixibot",
    "newRepository": "Pixibot-Releases",
    "migrationStrategy": "publish_migration_in_old_repo"
  }
}
```

## 📋 Checklist de Migración

### Pre-Migración
- [x] **Repositorio creado**: `GerDaBri/Pixibot-Releases`
- [x] **Configuración de marca**: `brands/pixibot/brand.config.json`
- [x] **Lógica de migración**: Implementada en `electron/main.js`
- [x] **Script de migración**: `scripts/migrate-pixibot.js`
- [x] **GitHub Actions**: Configurado para múltiples marcas

### Durante la Migración
- [ ] **Ejecutar migración**: `npm run migrate:pixibot`
- [ ] **Verificar build**: GitHub Actions ejecutándose correctamente
- [ ] **Verificar publicación**: Release creado en `WA---Pixibot` (repo actual para migración)
- [ ] **Verificar instalador**: Nombre correcto "Pixibot Setup 1.0.4.exe"
- [ ] **Verificar migración automática**: Apps existentes detectan y descargan 1.0.4

### Post-Migración
- [ ] **Testing de instalación**: Nueva instalación funciona correctamente
- [ ] **Testing de migración**: Aplicación existente se migra automáticamente
- [ ] **Testing de actualización**: Futuras actualizaciones desde nuevo repositorio
- [ ] **Monitoreo**: Verificar que usuarios reciben la actualización

## 🚨 Consideraciones de Seguridad

### ✅ Medidas de Seguridad Implementadas

1. **Versión específica de migración**: Solo la versión 1.0.4 incluye lógica de migración
2. **Validación de versión**: Solo migra si la versión actual es inferior a 1.0.4
3. **Repositorio específico**: Solo afecta aplicaciones llamadas "Pixibot"
4. **Logging detallado**: Todas las acciones de migración se registran
5. **Rollback posible**: Se puede revertir creando una versión anterior

### ⚠️ Precauciones

- **No interrumpir durante migración**: Asegurar que el proceso complete
- **Monitorear logs**: Revisar logs de aplicaciones durante la migración
- **Comunicación a usuarios**: Informar sobre posible reinicio automático
- **Backup de datos**: Los datos de usuario se mantienen seguros

## 📊 Métricas de Éxito

### Métricas a Monitorear

1. **Tasa de adopción**: Porcentaje de usuarios que reciben la versión 1.0.4
2. **Tasa de migración**: Porcentaje de usuarios que cambian al nuevo repositorio
3. **Estabilidad**: Número de errores o crashes durante la migración
4. **Rendimiento**: Tiempo de descarga e instalación de la actualización

### Herramientas de Monitoreo

- **GitHub Actions logs**: Estado de builds y publicaciones
- **Application logs**: Logs internos de migración en aplicaciones
- **GitHub Releases**: Descargas y estadísticas de releases
- **User feedback**: Reportes de usuarios sobre la experiencia

## 🔄 Rollback Plan

### Si Algo Sale Mal

1. **Detener publicación**: Si hay problemas críticos, detener el release
2. **Nueva versión correctiva**: Crear versión 1.0.5 con correcciones
3. **Comunicación**: Informar a usuarios sobre el problema
4. **Solución alternativa**: Proporcionar instaladores manuales si es necesario

### Procedimiento de Rollback

```bash
# 1. Crear versión correctiva
node scripts/release-brand.js
# Seleccionar: pixibot
# Versión: 1.0.5 (con correcciones)

# 2. Si es necesario revertir configuración de post-migración
# Revertir brands/pixibot/brand.config.json a usar WA---Pixibot

# 3. Monitorear adopción de versión correctiva
# 4. Verificar que problemas se resuelvan
```

## 🎯 Próximos Pasos

1. **Ejecutar migración**: `npm run migrate:pixibot` (publica 1.0.4 en `WA---Pixibot`)
2. **Verificar funcionamiento**: Confirmar que apps existentes detectan 1.0.4
3. **Monitorear adopción**: Seguimiento de usuarios que reciben la actualización 1.0.4
4. **Post-migración**: `npm run post-migrate:pixibot` (actualiza config para versiones futuras)
5. **Releases futuros**: Versiones > 1.0.4 se publican automáticamente en `Pixibot-Releases`

## 📞 Soporte

Para cualquier problema durante la migración:

1. **Revisar logs**: `C:\Users\{usuario}\AppData\Roaming\Pixibot\logs\app.log`
2. **Reportar errores**: Documentar cualquier problema encontrado
3. **Contacto**: Mantener comunicación con equipo de desarrollo

---

**Estado**: 🚧 En preparación | **Versión objetivo**: 1.0.4 | **Fecha estimada**: Próximos días