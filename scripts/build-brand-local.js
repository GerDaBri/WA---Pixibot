#!/usr/bin/env node

/**
 * build-brand-local.js
 *
 * Script para construir la aplicación localmente con una marca específica.
 * Replica el flujo de GitHub Actions pero sin publicar.
 *
 * Uso:
 *   node scripts/build-brand-local.js <brand-name> [--no-restore]
 *
 * Ejemplos:
 *   node scripts/build-brand-local.js pixibot
 *   node scripts/build-brand-local.js elevatehub
 *   node scripts/build-brand-local.js pixibot --no-restore  # No restaura archivos originales
 *
 * El ejecutable generado estará en la carpeta ./release/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Directories
const ROOT_DIR = path.join(__dirname, '..');
const BRANDS_DIR = path.join(ROOT_DIR, 'brands');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const STYLES_DIR = path.join(SRC_DIR, 'styles');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const PACKAGE_JSON = path.join(ROOT_DIR, 'package.json');
const BRAND_CONFIG_JS = path.join(SRC_DIR, 'brandConfig.js');

// Backup storage
let backupFiles = {};

// ============================================
// Utility Functions
// ============================================

function log(message, type = 'info') {
    const icons = {
        info: '📌',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        step: '🔹',
        build: '🔨',
        restore: '🔄'
    };
    console.log(`${icons[type] || '•'} ${message}`);
}

function backupFile(filePath, backupName) {
    if (fs.existsSync(filePath)) {
        const backupPath = `${filePath}.local-backup`;
        fs.copyFileSync(filePath, backupPath);
        backupFiles[backupName] = { original: filePath, backup: backupPath };
        log(`Backed up: ${path.basename(filePath)}`, 'step');
    }
}

function restoreFile(backupName) {
    const backup = backupFiles[backupName];
    if (backup && fs.existsSync(backup.backup)) {
        // Check if it's a directory or file
        const isDirectory = fs.statSync(backup.backup).isDirectory();

        if (isDirectory) {
            // Remove current directory and copy backup
            if (fs.existsSync(backup.original)) {
                fs.rmSync(backup.original, { recursive: true, force: true });
            }
            fs.cpSync(backup.backup, backup.original, { recursive: true });
            fs.rmSync(backup.backup, { recursive: true, force: true });
        } else {
            fs.copyFileSync(backup.backup, backup.original);
            fs.unlinkSync(backup.backup);
        }
        log(`Restored: ${path.basename(backup.original)}`, 'step');
    }
}

function restoreAllFiles() {
    log('Restoring original files...', 'restore');
    Object.keys(backupFiles).forEach(backupName => {
        restoreFile(backupName);
    });
    log('Original files restored', 'success');
}

function getAvailableBrands() {
    return fs.readdirSync(BRANDS_DIR)
        .filter(dir => fs.statSync(path.join(BRANDS_DIR, dir)).isDirectory())
        .filter(dir => fs.existsSync(path.join(BRANDS_DIR, dir, 'brand.config.json')));
}

function loadBrandConfig(brandName) {
    const configPath = path.join(BRANDS_DIR, brandName, 'brand.config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(`Brand configuration not found: ${configPath}`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// ============================================
// Build Steps (matching GitHub Actions workflow)
// ============================================

function step1_backupFiles() {
    log('Step 1: Backing up original files...', 'build');

    backupFile(PACKAGE_JSON, 'package.json');
    backupFile(path.join(SRC_DIR, 'index.html'), 'index.html');
    backupFile(BRAND_CONFIG_JS, 'brandConfig.js');
    backupFile(path.join(STYLES_DIR, 'main.css'), 'main.css');
    backupFile(path.join(STYLES_DIR, 'theme.css'), 'theme.css');
    backupFile(path.join(STYLES_DIR, 'components.css'), 'components.css');

    // Backup assets directory info (we'll recreate it on restore)
    if (fs.existsSync(ASSETS_DIR)) {
        const assetsBackup = path.join(ROOT_DIR, 'assets.local-backup');
        if (fs.existsSync(assetsBackup)) {
            fs.rmSync(assetsBackup, { recursive: true, force: true });
        }
        fs.cpSync(ASSETS_DIR, assetsBackup, { recursive: true });
        backupFiles['assets'] = { original: ASSETS_DIR, backup: assetsBackup };
        log('Backed up: assets/', 'step');
    }

    log('Backup completed', 'success');
}

function step2_applyBrandConfig(brandConfig) {
    log(`Step 2: Applying brand configuration for: ${brandConfig.displayName}`, 'build');

    // Load and modify package.json
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));

    packageJson.name = brandConfig.name;
    packageJson.version = brandConfig.version;
    packageJson.description = brandConfig.description;
    packageJson.author = brandConfig.author;
    packageJson.license = brandConfig.license;

    // Update build configuration
    if (packageJson.build) {
        packageJson.build.appId = brandConfig.appId;
        packageJson.build.productName = brandConfig.productName;
        packageJson.build.publish.owner = brandConfig.github.owner;
        packageJson.build.publish.repo = brandConfig.github.repo;
        packageJson.build.publish.releaseType = brandConfig.github.releaseType;
    }

    fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2));

    log(`  - Product Name: ${brandConfig.productName}`, 'step');
    log(`  - App ID: ${brandConfig.appId}`, 'step');
    log(`  - Version: ${brandConfig.version}`, 'step');
    log('Brand configuration applied to package.json', 'success');
}

function step3_copyBrandAssets(brandConfig) {
    log('Step 3: Copying brand assets...', 'build');

    const brandAssetsDir = path.join(BRANDS_DIR, brandConfig.name, 'assets');

    // Remove existing assets
    if (fs.existsSync(ASSETS_DIR)) {
        fs.rmSync(ASSETS_DIR, { recursive: true, force: true });
    }

    // Copy brand assets
    if (fs.existsSync(brandAssetsDir)) {
        fs.cpSync(brandAssetsDir, ASSETS_DIR, { recursive: true });
        log('Copied brand assets directory', 'step');

        // Copy specific logo as logo-principal.png for consistent import
        if (brandConfig.assets && brandConfig.assets.logo) {
            const logoPath = path.join(brandAssetsDir, brandConfig.assets.logo);
            const targetLogoDir = path.join(ASSETS_DIR, 'logos');
            const targetLogoPath = path.join(targetLogoDir, 'logo-principal.png');

            if (fs.existsSync(logoPath)) {
                if (!fs.existsSync(targetLogoDir)) {
                    fs.mkdirSync(targetLogoDir, { recursive: true });
                }
                fs.copyFileSync(logoPath, targetLogoPath);
                log('Copied brand logo', 'step');
            }
        }
    } else {
        log(`Warning: Brand assets directory not found: ${brandAssetsDir}`, 'warning');
    }

    log('Brand assets copied', 'success');
}

function step4_copyBrandIndexHtml(brandConfig) {
    log('Step 4: Copying brand index.html...', 'build');

    const brandIndexHtml = path.join(BRANDS_DIR, brandConfig.name, 'index.html');
    const targetIndexHtml = path.join(SRC_DIR, 'index.html');

    if (fs.existsSync(brandIndexHtml)) {
        fs.copyFileSync(brandIndexHtml, targetIndexHtml);
        log('Copied brand index.html', 'success');
    } else {
        log('Warning: Brand index.html not found (using default)', 'warning');
    }
}

function step5_generateBrandConfigJS(brandConfig) {
    log('Step 5: Generating brandConfig.js for React...', 'build');

    const theme = brandConfig.theme || 'default';
    const uiStyle = brandConfig.uiStyle || 'classic';

    const content = `// This file is auto-generated during build by scripts/build-brand-local.js
// DO NOT EDIT MANUALLY - changes will be overwritten

export const brandConfig = {
    name: '${brandConfig.name}',
    displayName: '${brandConfig.displayName}',
    productName: '${brandConfig.productName}',
    title: '${brandConfig.title}',
    description: '${brandConfig.description}',
    version: '${brandConfig.version}',
    theme: '${theme}',
    uiStyle: '${uiStyle}',
};

export default brandConfig;
`;

    fs.writeFileSync(BRAND_CONFIG_JS, content, 'utf8');
    log(`  - Theme: ${theme}`, 'step');
    log(`  - UI Style: ${uiStyle}`, 'step');
    log('Generated brandConfig.js', 'success');
}

function step6_copyBrandCSSFiles(brandConfig) {
    log('Step 6: Copying brand CSS theme files...', 'build');

    const brandDir = path.join(BRANDS_DIR, brandConfig.name);
    const cssFiles = ['main.css', 'theme.css', 'components.css'];

    cssFiles.forEach(cssFile => {
        const brandCssPath = path.join(brandDir, cssFile);
        const targetCssPath = path.join(STYLES_DIR, cssFile);

        if (fs.existsSync(brandCssPath)) {
            fs.copyFileSync(brandCssPath, targetCssPath);
            log(`Copied brand ${cssFile}`, 'step');
        } else {
            log(`Warning: Brand ${cssFile} not found (using default)`, 'warning');
        }
    });

    log('Brand theme files applied', 'success');
}

function step7_buildWebpack() {
    log('Step 7: Building webpack bundle...', 'build');

    try {
        execSync('npm run webpack-build', {
            stdio: 'inherit',
            cwd: ROOT_DIR
        });
        log('Webpack build completed', 'success');
    } catch (error) {
        throw new Error(`Webpack build failed: ${error.message}`);
    }
}

function step8_buildElectron() {
    log('Step 8: Building Electron application (without publishing)...', 'build');

    try {
        // Build without publishing (--publish=never)
        execSync('npx electron-builder --publish=never', {
            stdio: 'inherit',
            cwd: ROOT_DIR
        });
        log('Electron build completed', 'success');
    } catch (error) {
        throw new Error(`Electron build failed: ${error.message}`);
    }
}

// ============================================
// Main Function
// ============================================

function main() {
    const args = process.argv.slice(2);
    const noRestore = args.includes('--no-restore');
    const brandName = args.find(arg => !arg.startsWith('--'));

    // Show usage if no brand specified
    if (!brandName) {
        console.log('\n📦 Build Brand Local - Construir aplicación con marca específica\n');
        console.log('Uso:');
        console.log('  node scripts/build-brand-local.js <brand-name> [--no-restore]\n');
        console.log('Opciones:');
        console.log('  --no-restore    No restaurar archivos originales después del build\n');
        console.log('Marcas disponibles:', getAvailableBrands().join(', '));
        console.log('\nEjemplos:');
        console.log('  node scripts/build-brand-local.js pixibot');
        console.log('  node scripts/build-brand-local.js elevatehub --no-restore\n');
        process.exit(1);
    }

    // Validate brand exists
    const availableBrands = getAvailableBrands();
    if (!availableBrands.includes(brandName)) {
        log(`Brand '${brandName}' not found. Available: ${availableBrands.join(', ')}`, 'error');
        process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`🏷️  Building ${brandName.toUpperCase()} for local testing`);
    console.log('='.repeat(60) + '\n');

    let buildSuccess = false;

    try {
        // Load brand configuration
        const brandConfig = loadBrandConfig(brandName);
        log(`Loaded configuration for ${brandConfig.displayName}`, 'success');
        console.log('');

        // Execute build steps (matching GitHub Actions workflow)
        step1_backupFiles();
        console.log('');

        step2_applyBrandConfig(brandConfig);
        console.log('');

        step3_copyBrandAssets(brandConfig);
        console.log('');

        step4_copyBrandIndexHtml(brandConfig);
        console.log('');

        step5_generateBrandConfigJS(brandConfig);
        console.log('');

        step6_copyBrandCSSFiles(brandConfig);
        console.log('');

        step7_buildWebpack();
        console.log('');

        step8_buildElectron();
        console.log('');

        buildSuccess = true;

        // Show output location
        console.log('='.repeat(60));
        log(`BUILD COMPLETED SUCCESSFULLY for ${brandConfig.displayName}`, 'success');
        console.log('='.repeat(60));
        console.log('\n📁 El ejecutable está en la carpeta: ./release/');
        console.log(`   Busca: ${brandConfig.productName} Setup ${brandConfig.version}.exe\n`);

    } catch (error) {
        log(`Build failed: ${error.message}`, 'error');
        console.error(error);
    } finally {
        // Restore original files unless --no-restore flag is used
        if (!noRestore) {
            console.log('');
            restoreAllFiles();
        } else {
            console.log('\n⚠️  Flag --no-restore activo: los archivos NO fueron restaurados');
            console.log('   Ejecuta "git checkout ." para restaurar manualmente si es necesario\n');
        }
    }

    process.exit(buildSuccess ? 0 : 1);
}

// Run
if (require.main === module) {
    main();
}

module.exports = {
    getAvailableBrands,
    loadBrandConfig
};
