const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read current version from package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersion = packageJson.version;

console.log(`Current version: ${currentVersion}`);

// Ask for new version
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter new version (or press Enter to use current): ', (newVersion) => {
  const version = newVersion.trim() || currentVersion;
  
  try {
    console.log(`\n🚀 Creating release for version ${version}...`);
    
    // Update package.json version if different
    if (version !== currentVersion) {
      packageJson.version = version;
      fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
      console.log(`✅ Updated package.json to version ${version}`);
    }
    
    // Git operations
    execSync('git add .', { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${version}"`, { stdio: 'inherit' });
    execSync(`git tag v${version}`, { stdio: 'inherit' });
    execSync('git push origin main', { stdio: 'inherit' });
    execSync(`git push origin v${version}`, { stdio: 'inherit' });
    
    console.log(`\n✅ Release v${version} created successfully!`);
    console.log(`📦 GitHub Actions will now build and publish the release automatically.`);
    console.log(`🔗 Check progress at: https://github.com/GerDaBri/WA---Pixibot/actions`);
    
  } catch (error) {
    console.error('❌ Error creating release:', error.message);
  }
  
  rl.close();
});