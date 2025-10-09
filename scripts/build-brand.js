#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BRANDS_DIR = path.join(__dirname, '..', 'brands');
const SRC_DIR = path.join(__dirname, '..', 'src');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

// Backup files
let backupFiles = {};

function backupFile(filePath, backupName) {
    if (fs.existsSync(filePath)) {
        const backupPath = `${filePath}.backup`;
        fs.copyFileSync(filePath, backupPath);
        backupFiles[backupName] = backupPath;
        console.log(`✓ Backed up ${filePath}`);
    }
}

function restoreFile(filePath, backupName) {
    if (backupFiles[backupName] && fs.existsSync(backupFiles[backupName])) {
        fs.copyFileSync(backupFiles[backupName], filePath);
        fs.unlinkSync(backupFiles[backupName]);
        console.log(`✓ Restored ${filePath}`);
    }
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

function applyBrandConfig(brandConfig) {
    // Backup original files
    backupFile(PACKAGE_JSON, 'package.json');
    backupFile(path.join(SRC_DIR, 'index.html'), 'index.html');

    // Read and modify package.json
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));

    // Apply brand-specific configuration
    packageJson.name = brandConfig.name;
    packageJson.version = brandConfig.version;
    packageJson.description = brandConfig.description;
    packageJson.author = brandConfig.author;
    packageJson.license = brandConfig.license;

    if (packageJson.build) {
        packageJson.build.appId = brandConfig.appId;
        packageJson.build.productName = brandConfig.productName;

        if (packageJson.build.publish) {
            packageJson.build.publish.owner = brandConfig.github.owner;
            packageJson.build.publish.repo = brandConfig.github.repo;
            packageJson.build.publish.releaseType = brandConfig.github.releaseType;
        }
    }

    // Write modified package.json
    fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2));
    console.log(`✓ Applied brand configuration for ${brandConfig.displayName}`);

    // Copy brand assets
    const brandAssetsDir = path.join(BRANDS_DIR, brandConfig.name, 'assets');
    if (fs.existsSync(brandAssetsDir)) {
        // Remove existing assets
        if (fs.existsSync(ASSETS_DIR)) {
            fs.rmSync(ASSETS_DIR, { recursive: true, force: true });
        }

        // Copy brand assets
        fs.cpSync(brandAssetsDir, ASSETS_DIR, { recursive: true });
        console.log(`✓ Copied brand assets for ${brandConfig.displayName}`);

        // Copy specific logo as logo-principal.png for consistent import
        if (brandConfig.assets && brandConfig.assets.logo) {
            const logoPath = path.join(brandAssetsDir, brandConfig.assets.logo);
            const targetLogoPath = path.join(ASSETS_DIR, 'logos', 'logo-principal.png');
            if (fs.existsSync(logoPath)) {
                fs.copyFileSync(logoPath, targetLogoPath);
                console.log(`✓ Copied brand logo for ${brandConfig.displayName}`);
            }
        }
    }

    // Copy brand index.html
    const brandIndexHtml = path.join(BRANDS_DIR, brandConfig.name, 'index.html');
    if (fs.existsSync(brandIndexHtml)) {
        fs.copyFileSync(brandIndexHtml, path.join(SRC_DIR, 'index.html'));
        console.log(`✓ Copied brand index.html for ${brandConfig.displayName}`);
    }
}

function buildBrand() {
    console.log('🚀 Building application...');
    try {
        execSync('npm run webpack-build', { stdio: 'inherit' });
        console.log('✓ Webpack build completed');
    } catch (error) {
        console.error('✗ Webpack build failed:', error.message);
        throw error;
    }
}

function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: node scripts/build-brand.js <brand-name>');
        console.log('Available brands:', getAvailableBrands().join(', '));
        process.exit(1);
    }

    const brandName = args[0];
    const availableBrands = getAvailableBrands();

    if (!availableBrands.includes(brandName)) {
        console.error(`✗ Brand '${brandName}' not found. Available brands: ${availableBrands.join(', ')}`);
        process.exit(1);
    }

    try {
        console.log(`🏷️  Building for brand: ${brandName}`);

        // Load brand configuration
        const brandConfig = loadBrandConfig(brandName);
        console.log(`✓ Loaded configuration for ${brandConfig.displayName}`);

        // Apply brand configuration
        applyBrandConfig(brandConfig);

        // Build the application
        buildBrand();

        console.log(`✅ Build completed successfully for ${brandConfig.displayName}`);

    } catch (error) {
        console.error('✗ Build failed:', error.message);
        process.exit(1);
    } finally {
        // Always restore original files
        console.log('🔄 Restoring original files...');
        restoreFile(PACKAGE_JSON, 'package.json');
        restoreFile(path.join(SRC_DIR, 'index.html'), 'index.html');
        console.log('✓ Original files restored');
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    getAvailableBrands,
    loadBrandConfig,
    applyBrandConfig,
    buildBrand
};