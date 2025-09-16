const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read current version from package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersion = packageJson.version;

console.log(`📦 Current version: ${currentVersion}`);

// Get version from command line argument or use current
const newVersion = process.argv[2] || currentVersion;

if (newVersion === currentVersion) {
  console.log(`ℹ️ Using current version ${currentVersion} for release`);
} else {
  console.log(`🔄 Updating version from ${currentVersion} to ${newVersion}`);
  packageJson.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  console.log(`✅ Updated package.json`);
}

try {
  console.log(`\n🚀 Creating release for version ${newVersion}...`);
  
  // Add all changes
  execSync('git add .', { stdio: 'inherit' });
  
  // Check if there are changes to commit
  try {
    execSync('git diff --cached --exit-code', { stdio: 'pipe' });
    console.log('ℹ️ No changes to commit');
  } catch (error) {
    // There are changes, commit them
    execSync(`git commit -m "chore: prepare release v${newVersion}"`, { stdio: 'inherit' });
    console.log('✅ Changes committed');
  }
  
  // Delete existing tag if it exists
  try {
    execSync(`git tag -d v${newVersion}`, { stdio: 'pipe' });
    console.log(`🗑️ Deleted existing local tag v${newVersion}`);
  } catch (error) {
    // Tag doesn't exist locally, which is fine
  }
  
  // Delete remote tag if it exists
  try {
    execSync(`git push origin :refs/tags/v${newVersion}`, { stdio: 'pipe' });
    console.log(`🗑️ Deleted existing remote tag v${newVersion}`);
  } catch (error) {
    // Tag doesn't exist remotely, which is fine
  }
  
  // Create new tag
  execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
  console.log(`🏷️ Created tag v${newVersion}`);
  
  // Push changes and tag
  execSync('git push origin main', { stdio: 'inherit' });
  execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });
  
  console.log(`\n✅ Release v${newVersion} created successfully!`);
  console.log(`📦 GitHub Actions will build and publish automatically`);
  console.log(`🔗 Monitor progress: https://github.com/GerDaBri/WA---Pixibot/actions`);
  console.log(`📋 Releases: https://github.com/GerDaBri/WA---Pixibot/releases`);
  
} catch (error) {
  console.error('\n❌ Error creating release:', error.message);
  console.log('\n💡 Try running manually:');
  console.log(`   git tag v${newVersion}`);
  console.log(`   git push origin v${newVersion}`);
  process.exit(1);
}