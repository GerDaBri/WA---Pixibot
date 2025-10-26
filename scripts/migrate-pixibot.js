const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Migration script for Pixibot
console.log('🚀 Starting Pixibot Migration Process');
console.log('=====================================');

try {
  // 1. Create migration version (1.0.4)
  const migrationVersion = '1.0.4';
  console.log(`📦 Creating migration version: ${migrationVersion}`);

  // 2. Update package.json for migration
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  // Backup current version
  const currentVersion = packageJson.version;
  console.log(`📋 Current version: ${currentVersion}`);

  // Update to migration version
  packageJson.version = migrationVersion;
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  console.log(`✅ Updated package.json to version ${migrationVersion}`);

  // 3. Apply Pixibot brand configuration
  console.log('🏷️  Applying Pixibot brand configuration...');

  // Copy Pixibot assets
  const pixibotAssetsDir = path.join(__dirname, '..', 'brands', 'pixibot', 'assets');
  const mainAssetsDir = path.join(__dirname, '..', 'assets');

  // Copy logo
  fs.copyFileSync(
    path.join(pixibotAssetsDir, 'logos', 'logo-principal.png'),
    path.join(mainAssetsDir, 'logos', 'logo-principal.png')
  );

  // Copy icon
  fs.copyFileSync(
    path.join(pixibotAssetsDir, 'icon.ico'),
    path.join(mainAssetsDir, 'icon.ico')
  );

  console.log('✅ Pixibot assets copied');

  // 4. Copy Pixibot index.html if exists
  const pixibotIndexHtml = path.join(__dirname, '..', 'brands', 'pixibot', 'index.html');
  const mainIndexHtml = path.join(__dirname, '..', 'src', 'index.html');

  if (fs.existsSync(pixibotIndexHtml)) {
    fs.copyFileSync(pixibotIndexHtml, mainIndexHtml);
    console.log('✅ Pixibot index.html copied');
  }

  // 5. Build the application
  console.log('\n🔨 Building application...');
  execSync('npm run webpack-build', { stdio: 'inherit' });
  console.log('✅ Webpack build completed');

  // 6. Create git commit for migration
  console.log('\n📝 Creating git commit for migration...');
  execSync('git add .', { stdio: 'inherit' });

  try {
    execSync('git diff --cached --exit-code', { stdio: 'pipe' });
    console.log('ℹ️  No changes to commit');
  } catch {
    execSync(`git commit -m "feat(migration): prepare Pixibot migration v${migrationVersion}"`, { stdio: 'inherit' });
    console.log('✅ Migration changes committed');
  }

  // 7. Create and push migration tag
  const migrationTag = `pixibotm-v${migrationVersion}`;
  console.log(`\n🏷️  Creating migration tag: ${migrationTag}`);

  // Delete existing tag if exists
  try {
    execSync(`git tag -d ${migrationTag}`, { stdio: 'pipe' });
    execSync(`git push origin :refs/tags/${migrationTag}`, { stdio: 'pipe' });
    console.log(`🗑️  Existing tag ${migrationTag} deleted`);
  } catch {
    // Tag doesn't exist, continue
  }

  // Create new tag
  execSync(`git tag ${migrationTag}`, { stdio: 'inherit' });
  execSync('git push origin main', { stdio: 'inherit' });
  execSync(`git push origin ${migrationTag}`, { stdio: 'inherit' });

  console.log(`\n✅ Migration release ${migrationTag} created successfully!`);
  console.log(`📦 GitHub Actions will build and publish to WA---Pixibot (migration repository)`);
  console.log(`🔗 Monitor progress: https://github.com/GerDaBri/WA---Pixibot/actions`);
  console.log(`📋 Release page: https://github.com/GerDaBri/WA---Pixibot/releases`);
  console.log(`📋 Future releases will be published to: https://github.com/GerDaBri/Pixibot-Releases/releases`);

  console.log('\n🎯 Migration Summary:');
  console.log('===================');
  console.log(`✅ Migration version: ${migrationVersion}`);
  console.log(`✅ Repository: Pixibot-Releases`);
  console.log(`✅ Migration logic: Included in main.js`);
  console.log(`✅ Assets: Pixibot branding`);
  console.log(`✅ Auto-migration: Applications will automatically migrate`);

} catch (error) {
  console.error('\n❌ Error during migration:', error.message);
  process.exit(1);
}