#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const BRANDS_DIR = path.join(__dirname, '..', 'brands');

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

function getCurrentGitBranch() {
    try {
        return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch (error) {
        console.error('✗ Failed to get current git branch:', error.message);
        return null;
    }
}

function getLatestTag() {
    try {
        return execSync('git describe --tags --abbrev=0 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    } catch (error) {
        return '';
    }
}

function createReleaseTag(brandConfig) {
    const tagName = `${brandConfig.name}-v${brandConfig.version}`;
    const releaseMessage = `Release ${brandConfig.displayName} v${brandConfig.version}`;

    try {
        // Check if tag already exists
        const existingTags = execSync('git tag -l', { encoding: 'utf8' });
        if (existingTags.includes(tagName)) {
            console.log(`⚠️  Tag ${tagName} already exists. Skipping tag creation.`);
            return tagName;
        }

        // Create annotated tag
        execSync(`git tag -a "${tagName}" -m "${releaseMessage}"`, { stdio: 'inherit' });
        console.log(`✓ Created tag: ${tagName}`);

        return tagName;
    } catch (error) {
        console.error('✗ Failed to create tag:', error.message);
        throw error;
    }
}

function pushTagToRemote(tagName) {
    try {
        console.log(`📤 Pushing tag ${tagName} to remote...`);
        execSync(`git push origin "${tagName}"`, { stdio: 'inherit' });
        console.log(`✓ Tag ${tagName} pushed to remote`);
    } catch (error) {
        console.error('✗ Failed to push tag:', error.message);
        throw error;
    }
}

function promptUser(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function selectBrand() {
    const brands = getAvailableBrands();

    if (brands.length === 0) {
        console.error('✗ No brands found in brands/ directory');
        process.exit(1);
    }

    if (brands.length === 1) {
        return brands[0];
    }

    console.log('Available brands:');
    brands.forEach((brand, index) => {
        const config = loadBrandConfig(brand);
        console.log(`${index + 1}. ${config.displayName} (${brand})`);
    });

    const answer = await promptUser('Select a brand (number or name): ');

    // Try to parse as number first
    const index = parseInt(answer) - 1;
    if (!isNaN(index) && index >= 0 && index < brands.length) {
        return brands[index];
    }

    // Try to match by name
    if (brands.includes(answer)) {
        return answer;
    }

    console.error(`✗ Invalid selection: ${answer}`);
    process.exit(1);
}

async function confirmAction(message) {
    const answer = await promptUser(`${message} (y/N): `);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

async function main() {
    try {
        console.log('🚀 Brand Release Tool');
        console.log('===================');

        // Check git status
        const currentBranch = getCurrentGitBranch();
        if (!currentBranch) {
            console.error('✗ Not in a git repository');
            process.exit(1);
        }

        console.log(`📍 Current branch: ${currentBranch}`);

        // Check for uncommitted changes
        const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
        if (gitStatus.trim()) {
            console.log('⚠️  You have uncommitted changes:');
            console.log(gitStatus);
            const proceed = await confirmAction('Continue anyway?');
            if (!proceed) {
                console.log('Aborted.');
                process.exit(0);
            }
        }

        // Select brand
        const brandName = await selectBrand();
        const brandConfig = loadBrandConfig(brandName);

        console.log(`\n🏷️  Selected brand: ${brandConfig.displayName}`);
        console.log(`📦 Version: ${brandConfig.version}`);
        console.log(`🏷️  Tag will be: ${brandName}-v${brandConfig.version}`);

        // Confirm release
        const confirm = await confirmAction(`Create and push release tag for ${brandConfig.displayName}?`);
        if (!confirm) {
            console.log('Aborted.');
            process.exit(0);
        }

        // Create and push tag
        const tagName = createReleaseTag(brandConfig);
        pushTagToRemote(tagName);

        console.log(`\n✅ Release completed successfully!`);
        console.log(`🏷️  Tag: ${tagName}`);
        console.log(`🔗 GitHub repository: https://github.com/${brandConfig.github.owner}/${brandConfig.github.repo}/releases/tag/${tagName}`);

    } catch (error) {
        console.error('✗ Release failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    getAvailableBrands,
    loadBrandConfig,
    createReleaseTag,
    pushTagToRemote
};