# Configuración de Desarrollo - Servidor Local de Licencias

## Resumen
Este proyecto ahora soporta configuración automática entre servidor local (desarrollo) y servidor de producción basado en variables de entorno.

## Configuración Automática

### Detección de Entorno
La aplicación detecta automáticamente el entorno usando `app.isPackaged`:

- **Desarrollo**: `app.isPackaged = false` (código fuente, no empaquetado)
- **Producción**: `app.isPackaged = true` (aplicación empaquetada)

### URLs de Servidor
- **Desarrollo**: `http://localhost:3001` (servidor local)
- **Producción**: `https://licencias.superbotsx.com` (servidor de producción)

## Cómo Usar

### 1. Para Desarrollo (con servidor local)
```bash
npm start  # Automáticamente detecta desarrollo y usa servidor local
```

### 2. Para Producción
```bash
npm run build  # Construye la aplicación
npm run dist   # Crea el instalador/paquete
```
La aplicación empaquetada automáticamente usará el servidor de producción.

### 3. Verificar Configuración
Al iniciar la aplicación, verás en los logs:
```
main.js: Login attempt using server: http://localhost:3001 Mode: development (unpacked)
```
o
```
main.js: Login attempt using server: https://licencias.superbotsx.com Mode: production (packaged)
```

## Tu Servidor Local
Asegúrate de que tu servidor local esté ejecutándose en `http://localhost:3001` y que implemente los siguientes endpoints:

### Endpoints Requeridos
- `POST /login` - Autenticación de usuario
- `GET /check_license` - Validación de licencia

### Formato de Respuesta
Las respuestas deben seguir el mismo formato que el servidor de producción.

## Archivos Modificados
- `electron/config.js` - Configuración del proceso principal
- `src/config.js` - Configuración del proceso renderer
- `electron/main.js` - Lógica de requests HTTP/HTTPS

## Troubleshooting
- Si la aplicación no conecta al servidor correcto, verifica los logs de inicio
- Asegúrate de que tu servidor local esté ejecutándose en el puerto 3001
- Para desarrollo: ejecuta `npm start` desde el código fuente (no empaquetado)
- Para producción: usa la aplicación empaquetada/instalada
- Los logs mostrarán "development (unpacked)" o "production (packaged)"

## Notas de Seguridad
- El servidor local usa HTTP (no HTTPS) para desarrollo
- Los tokens JWT se firman con una clave de desarrollo
- No uses datos sensibles en el servidor local