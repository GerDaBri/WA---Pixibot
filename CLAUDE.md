# CLAUDE.md - AI Assistant Guide for Pixibot

## Project Overview

**Pixibot** is an Electron-based desktop application for WhatsApp bulk messaging campaigns with license management. It provides a multi-step wizard interface for creating and managing WhatsApp message campaigns using Excel contact lists.

### Key Information
- **Product Name**: Pixibot
- **Version**: 1.0.5
- **Type**: Electron Desktop Application
- **Primary Use Case**: WhatsApp bulk messaging campaigns with license validation
- **License**: ISC
- **Repository**: GerDaBri/Pixibot-Releases (migrated from WA---Pixibot)

---

## Technology Stack

### Core Technologies
- **Electron** (v37.4.0) - Desktop application framework
- **React** (v18.3.1) - UI framework
- **Webpack** (v5.101.3) - Module bundler and dev server
- **Node.js** - Backend runtime

### Key Dependencies
- **whatsapp-web.js** (v1.34.1) - WhatsApp Web API client
- **puppeteer** (v24.17.1) - Headless Chrome automation for WhatsApp
- **electron-updater** (v6.6.2) - Auto-update functionality
- **electron-store** (v10.1.0) - Persistent data storage
- **@fluentui/react-components** (v9.69.0) - Microsoft Fluent UI design system
- **winston** (v3.17.0) - Logging framework
- **xlsx** (v0.18.5) - Excel file processing
- **qrcode** - QR code generation for WhatsApp authentication

### Build Tools
- **electron-builder** (v26.0.12) - Application packaging
- **babel-loader** - JavaScript transpilation
- **webpack-dev-server** - Development server
- **concurrently** - Run multiple npm scripts

---

## Project Structure

```
WA---Pixibot/
├── electron/                    # Electron main process
│   ├── main.js                 # Main process entry point (IPC handlers, license validation, auto-updater)
│   ├── preload.js              # Preload script for IPC bridge
│   └── config.js               # Server configuration (dev/prod)
│
├── src/                        # React application source
│   ├── components/             # React UI components
│   │   ├── Step0_Login.js      # Login and license validation UI
│   │   ├── Step1_File.js       # Excel file upload
│   │   ├── Step2_Config.js     # Campaign configuration
│   │   ├── Step3_Send.js       # WhatsApp session setup
│   │   ├── Step4_Progress.js   # Campaign execution and monitoring
│   │   ├── SessionStatusIndicator.js  # WhatsApp connection status
│   │   └── UpdateNotification.js      # Auto-update notifications
│   ├── App.js                  # Main React application component
│   ├── index.js                # React entry point
│   ├── config.js               # Frontend configuration
│   └── styles/                 # CSS stylesheets
│
├── bot/                        # WhatsApp bot logic
│   └── whatsapp-logic.js       # Core WhatsApp campaign management (33k+ tokens)
│
├── brands/                     # Multi-brand configuration system
│   ├── pixibot/
│   │   └── brand.config.json   # Pixibot brand configuration
│   └── elevatehub/
│       └── brand.config.json   # ElevateHub brand configuration
│
├── scripts/                    # Build and deployment scripts
│   ├── build-brand.js          # Multi-brand build system
│   ├── release-brand.js        # Multi-brand release automation
│   ├── release.js              # GitHub release script
│   ├── simple-release.js       # Simple release script
│   ├── migrate-pixibot.js      # Repository migration script
│   └── post-migration-setup.js # Post-migration configuration
│
├── assets/                     # Static assets
│   ├── icon.ico                # Application icon
│   └── logos/                  # Brand logos
│       └── logo-principal.png
│
├── docs/                       # Documentation
├── .github/workflows/          # CI/CD workflows
│   └── build.yml               # GitHub Actions build workflow
│
├── package.json                # NPM configuration and scripts
├── webpack.config.js           # Webpack build configuration
├── whatsapp-config.json        # Puppeteer/WhatsApp configuration
├── DEVELOPMENT_SETUP.md        # Development environment setup (Spanish)
└── README.md                   # Project README

```

---

## Architecture & Design Patterns

### Multi-Process Architecture (Electron)

1. **Main Process** (electron/main.js)
   - Handles IPC communication with renderer
   - Manages WhatsApp client initialization
   - License validation and server communication
   - Campaign state persistence with electron-store
   - Auto-updater lifecycle management
   - File system operations
   - Single instance lock enforcement

2. **Renderer Process** (src/App.js)
   - React-based multi-step wizard UI
   - Campaign state management
   - Real-time UI updates via IPC events
   - License status display
   - Update notifications

3. **Preload Script** (electron/preload.js)
   - Context-isolated IPC bridge
   - Exposes `window.electronAPI` to renderer

### State Management

- **Campaign State**: Persisted to electron-store, survives app restarts
- **License State**: Cached with 7-day refresh interval
- **Session State**: WhatsApp authentication session stored in userData
- **UI State**: React local state + IPC event listeners

### IPC Communication Patterns

```javascript
// Main Process Handlers (electron/main.js)
ipcMain.handle('login-user', async (event, email, password) => { ... })
ipcMain.handle('check-license-status', async () => { ... })
ipcMain.handle('start-sending', (event, config) => { ... })
ipcMain.handle('pause-sending', (event, campaignId) => { ... })
ipcMain.handle('resume-sending', (event, campaignId) => { ... })
ipcMain.handle('get-campaign-status', () => { ... })
ipcMain.handle('initialize-client', () => { ... })
ipcMain.handle('logout', async () => { ... })

// Renderer Process Events (src/App.js)
window.electronAPI.on('qrcode', (url) => { ... })
window.electronAPI.on('ready', () => { ... })
window.electronAPI.on('campaign-update', (campaign) => { ... })
window.electronAPI.on('countdown-update', (data) => { ... })
window.electronAPI.on('update-available', (info) => { ... })
```

---

## Key Features & Workflows

### 1. License Management System

**Flow**:
1. App checks license on startup via `check-license-status`
2. If no valid license, show login screen (Step0_Login)
3. User logs in with email/password to remote server
4. Server validates credentials and returns license data
5. License cached locally with 7-day refresh interval
6. License status displayed in header (days remaining)

**License States**:
- `valid` - Active license with days remaining
- `expired` - License past end_date
- `suspended` - Administratively suspended
- `no_license` / `no_license_data` - No license stored (can login)
- `checking` - Validation in progress
- `error` - Validation failed

**Server Communication**:
- **Development**: `http://localhost:3000` (configurable via electron/config.js)
- **Production**: Remote HTTPS server (configurable via electron/config.js)
- Endpoints: `/login`, `/check_license`

### 2. WhatsApp Campaign Workflow

**Step-by-Step Process**:

1. **Step 0 - Login** (Step0_Login.js)
   - License validation
   - Email/password authentication
   - Display license information

2. **Step 1 - File Upload** (Step1_File.js)
   - Upload Excel file with contacts (.xlsx, .xls)
   - Template download option
   - Excel header detection
   - Stores file in `userData/excel_data/plantilla-wm.xlsx`

3. **Step 2 - Configuration** (Step2_Config.js)
   - Map Excel columns to message fields
   - Configure message template with placeholders
   - Set delays: `pausaCada` (pause after N messages), `demora` (delay between messages)
   - Optional media attachment (image, video, PDF)
   - Preview message with first contact data

4. **Step 3 - WhatsApp Setup** (Step3_Send.js)
   - Initialize WhatsApp client
   - QR code authentication (if not authenticated)
   - Session status monitoring
   - "Start Sending" button when ready

5. **Step 4 - Progress** (Step4_Progress.js)
   - Real-time campaign progress (sent/total)
   - Pause/Resume/Stop controls
   - Campaign statistics
   - Countdown timer for pauses
   - Edit configuration while paused
   - Campaign state persistence

**Campaign States**:
- `inactive` - No campaign active
- `running` - Actively sending messages
- `paused` - Paused by user or schedule
- `stopped` - Stopped by user
- `finished` - All messages sent

### 3. WhatsApp Session Management

- Uses `puppeteer` to launch headless Chrome
- `whatsapp-web.js` connects to WhatsApp Web
- Session data stored in `userData/session/`
- QR code authentication via IPC events
- Auto-reconnect on disconnection
- Session status polling for UI updates

### 4. Auto-Update System

- Uses `electron-updater` with GitHub releases
- Checks for updates on app startup (production only)
- Downloads updates automatically
- Notification UI (UpdateNotification.js)
- Migration support from old repository (WA---Pixibot → Pixibot-Releases)

### 5. Brand Configuration System

Supports multiple brands via `brands/` directory:

```json
{
  "name": "pixibot",
  "displayName": "Pixibot",
  "productName": "Pixibot",
  "appId": "com.yourcompany.whatsappbot",
  "github": {
    "owner": "GerDaBri",
    "repo": "Pixibot-Releases"
  },
  "colors": { "primary": "#007bff", ... },
  "assets": { "icon": "icon.ico", "logo": "logos/logo-principal.png" }
}
```

---

## Development Workflows

### Setup & Installation

```bash
# Clone repository
git clone <repository-url>
cd WA---Pixibot

# Install dependencies
npm install

# Start development server
npm start
# This runs: concurrently "npm run react-start" "wait-on http://localhost:3000 && electron ."
```

### Development Mode

1. **Webpack Dev Server**: Runs React app on `http://localhost:3000`
2. **Electron**: Loads from localhost:3000 (detected via `app.isPackaged` check)
3. **Hot Reload**: Webpack provides hot module replacement
4. **DevTools**: Electron DevTools available (not auto-opened in production)

### Building for Production

```bash
# Build React app + package Electron
npm run build
# This runs: webpack --mode production && electron-builder

# Build for CI (skip webpack, assumes dist/ exists)
npm run build:ci

# Build and publish to GitHub
npm run build:publish
```

### Release Process

```bash
# Simple release (no brand configuration)
npm run release:simple

# Full release with brand configuration
npm run release

# Build specific brand
node scripts/build-brand.js

# Release specific brand
node scripts/release-brand.js
```

### Migration Scripts

```bash
# Migrate from old repository to Pixibot-Releases
npm run migrate:pixibot

# Post-migration setup
npm run post-migrate:pixibot
```

---

## Code Conventions & Best Practices

### File Naming
- React components: PascalCase (e.g., `Step1_File.js`)
- JavaScript utilities: camelCase (e.g., `whatsapp-logic.js`)
- Configuration files: kebab-case (e.g., `brand.config.json`)

### IPC Patterns
- **Handlers**: Use `ipcMain.handle()` for async request/response
- **Events**: Use `mainWindow.webContents.send()` for one-way events
- **Context Isolation**: Always use preload script, never `nodeIntegration: true`

### Error Handling
- Log errors with winston logger
- Send errors to renderer via `log-message` event
- User-friendly error messages in UI
- Never expose internal errors to users

### State Persistence
- Use electron-store for campaign state
- Always persist before app quit
- Validate persisted state on load
- Clear invalid/corrupt state gracefully

### Logging
- **Main Process**: Winston logger to `userData/logs/app.log`
- **Renderer**: Send logs to main via `log-message` IPC
- **Bot Logic**: Separate logger instance
- Log levels: error, warn, info, debug

### Security Considerations
- Content Security Policy configured in BrowserWindow
- Context isolation enabled
- Web security enabled
- Never expose secrets in logs
- Validate all IPC inputs
- This application uses WhatsApp automation which may violate WhatsApp ToS

---

## Common Development Tasks

### Adding a New IPC Handler

1. Add handler in `electron/main.js`:
   ```javascript
   ipcMain.handle('my-handler', async (event, arg) => {
     // Implementation
     return result;
   });
   ```

2. Expose in `electron/preload.js`:
   ```javascript
   contextBridge.exposeInMainWorld('electronAPI', {
     myHandler: (arg) => ipcRenderer.invoke('my-handler', arg)
   });
   ```

3. Use in React component:
   ```javascript
   const result = await window.electronAPI.myHandler(arg);
   ```

### Adding a New Campaign Configuration Field

1. Update `Step2_Config.js` to add UI field
2. Modify `handleNextStep()` to include new field in config
3. Update `whatsapp-logic.js` to use new field
4. Update `Step4_Progress.js` to display/edit new field

### Modifying License Validation Logic

- Main validation logic in `electron/main.js` (lines 717-981)
- Helper functions: `parseServerDate()`, `validateServerTime()`, `calculateDaysRemaining()`
- Cache validation: `validateCachedLicense()` function
- 7-day refresh interval configurable in `electron/config.js`

### Working with WhatsApp Logic

- Core logic in `bot/whatsapp-logic.js` (33k+ tokens - very large file)
- Campaign management: `startSending()`, `pauseSending()`, `resumeSending()`, `stopSending()`
- Client management: `initializeClient()`, `destroyClientInstance()`
- State: `getCampaignStatus()`, `getClientStatus()`
- Excel: `getExcelHeaders()`, `getFirstExcelRow()`

---

## Testing & Debugging

### Development Mode Checks
- Updates disabled in development (`app.isPackaged` check)
- License server can be localhost (see DEVELOPMENT_SETUP.md)
- DevTools available

### Debugging IPC
- Add logs in preload, main, and renderer
- Check `userData/logs/app.log` for main process logs
- Use browser DevTools for renderer process

### Testing License Flow
1. Reset license data: Click license status → "Resetear Licencia"
2. Restart app (triggers reload)
3. Login screen should appear
4. Test with development server credentials

### Testing Campaign Resumption
1. Start a campaign
2. Close app (force quit or natural close)
3. Restart app
4. Campaign should auto-resume on startup

---

## Important Files Reference

### Configuration Files
- `package.json` - NPM scripts, dependencies, electron-builder config
- `webpack.config.js` - Webpack build configuration
- `whatsapp-config.json` - Puppeteer headless configuration
- `brands/*/brand.config.json` - Brand-specific settings
- `electron/config.js` - Server URLs (dev/prod)

### Core Application Logic
- `electron/main.js` - Main process (1328 lines)
- `src/App.js` - React root component (776 lines)
- `bot/whatsapp-logic.js` - WhatsApp campaign engine (33k+ tokens)

### UI Components
- `src/components/Step0_Login.js` - Authentication UI
- `src/components/Step1_File.js` - File upload
- `src/components/Step2_Config.js` - Campaign configuration
- `src/components/Step3_Send.js` - WhatsApp session setup
- `src/components/Step4_Progress.js` - Campaign monitoring
- `src/components/SessionStatusIndicator.js` - Connection status indicator
- `src/components/UpdateNotification.js` - Update notification UI

---

## Environment & Paths

### User Data Paths (electron)
```javascript
app.getPath('userData') // Base user data directory
├── temp_images/        // Temporary media files (IMAGE_DIR)
├── session/            // WhatsApp session data (SESSION_PATH)
├── logs/               // Application logs (LOGS_DIR)
│   └── app.log
└── excel_data/         // Uploaded Excel files
    └── plantilla-wm.xlsx
```

### Development vs Production
- **Development**: `app.isPackaged === false`
  - Loads from `http://localhost:3000`
  - No auto-updates
  - Can use local license server

- **Production**: `app.isPackaged === true`
  - Loads from `dist/index.html`
  - Auto-updates enabled
  - Uses production license server

---

## Troubleshooting Common Issues

### WhatsApp Won't Connect
- Check `whatsapp-config.json` puppeteer args
- Verify Chrome installation (puppeteer uses bundled Chrome)
- Check session data in `userData/session/`
- Look for errors in `userData/logs/app.log`
- Try logout and re-authenticate

### License Validation Fails
- Check server URL in `electron/config.js`
- Verify server is responding (check network logs)
- Look for HTML error pages (500/404) in logs
- Try "Resetear Licencia" to clear cache
- Check license expiration date

### Campaign Won't Resume After Restart
- Check persisted campaign state in electron-store
- Verify campaign.config.pausaCada exists
- Check if client initialized before resumption
- Review logs for initialization errors

### Build Fails
- Ensure `dist/` directory exists before `electron-builder`
- Run `npm run webpack-build` first
- Check electron-builder configuration in package.json
- Verify assets exist (icon.ico, logos)

---

## AI Assistant Guidelines

### When Making Changes

1. **Always Read Before Editing**: Use Read tool to see current file contents
2. **Respect Architecture**: Follow IPC patterns, don't break renderer/main isolation
3. **Test Both Modes**: Consider both development and production (`app.isPackaged`)
4. **Update Both Sides**: If changing IPC, update preload.js, main.js, AND component
5. **Preserve Logs**: Maintain existing logging patterns for debugging
6. **Handle Errors**: Add proper error handling and user-friendly messages
7. **Persist State**: If adding campaign config, ensure it's persisted to store
8. **Security First**: Never expose credentials, validate all user inputs

### Code Style Preferences

- **Language**: Mix of English (code) and Spanish (UI text, comments)
- **Indentation**: 4 spaces (as seen in main.js, App.js)
- **Quotes**: Single quotes for JavaScript strings
- **Semicolons**: Used consistently
- **Async/Await**: Preferred over promise chains
- **Arrow Functions**: Used extensively in React components
- **Console Logs**: Extensive logging with emoji prefixes (🔍, ✅, ❌, 🚀, etc.)

### Feature Development Checklist

- [ ] Add IPC handler in main.js
- [ ] Expose via preload.js
- [ ] Update React component to use new API
- [ ] Add error handling
- [ ] Add logging
- [ ] Update campaign state persistence if needed
- [ ] Test in development mode
- [ ] Test in production build
- [ ] Update CLAUDE.md if architecture changes

---

## Git & Version Control

### Branch Strategy
- Development happens on feature branches prefixed with `claude/`
- Example: `claude/claude-md-mhz4pflxyds4oxew-01ADkra8VQpVe1NbnFGAiN3v`
- Push to designated branch with `-u origin <branch-name>`

### Commit Guidelines
- Clear, descriptive messages
- Reference issue/task when applicable
- Follow repository's existing commit style
- Run `git status` and `git diff` before committing

### Release Process
- Releases published to `GerDaBri/Pixibot-Releases`
- Uses GitHub Releases with electron-updater
- Version in package.json and brand.config.json must match
- Migration system tracks repository changes

---

## Additional Resources

- **WhatsApp Web.js Docs**: https://wwebjs.dev/
- **Electron Docs**: https://www.electronjs.org/docs/latest
- **Fluent UI React**: https://react.fluentui.dev/
- **electron-updater**: https://www.electron.build/auto-update

---

## Version History

- **1.0.5** (Current) - Latest stable release
- **1.0.4** - Migration version (repository transition)
- Migration completed: 2025-10-27

---

## Notes for AI Assistants

- This is a **commercial WhatsApp automation tool** with license management
- The codebase is **bilingual** (English code, Spanish UI/comments)
- **License system is critical** - don't break validation logic
- **State persistence** is essential for campaign resumption
- The `whatsapp-logic.js` file is very large (33k+ tokens) - read selectively
- Always check `app.isPackaged` when making environment-dependent changes
- Security note: This application may violate WhatsApp Terms of Service

---

*Last Updated: 2025-11-14*
*CLAUDE.md Version: 1.0*
