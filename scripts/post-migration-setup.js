const fs = require('fs');
const path = require('path');

// Post-migration script to update Pixibot configuration for future releases
console.log('🔄 Post-Migration Setup for Pixibot');
console.log('===================================');

try {
  const brandConfigPath = path.join(__dirname, '..', 'brands', 'pixibot', 'brand.config.json');

  if (!fs.existsSync(brandConfigPath)) {
    console.error('❌ Error: Pixibot brand configuration not found');
    process.exit(1);
  }

  // Load current configuration
  const brandConfig = JSON.parse(fs.readFileSync(brandConfigPath, 'utf8'));
  console.log(`📋 Current configuration for ${brandConfig.brandName}:`);
  console.log(`   Repository: ${brandConfig.github.owner}/${brandConfig.github.repo}`);

  // Update to use new repository for future releases
  brandConfig.github.repo = 'Pixibot-Releases';
  brandConfig.migration.completed = true;
  brandConfig.migration.completedDate = new Date().toISOString();
  brandConfig.migration.nextVersionRepo = 'Pixibot-Releases';

  // Write updated configuration
  fs.writeFileSync(brandConfigPath, JSON.stringify(brandConfig, null, 2));
  console.log('✅ Updated Pixibot configuration for future releases');
  console.log(`   New repository: ${brandConfig.github.owner}/${brandConfig.github.repo}`);
  console.log(`   Migration completed: ${brandConfig.migration.completedDate}`);

  // Commit the changes
  const { execSync } = require('child_process');
  console.log('\n📝 Committing configuration changes...');

  execSync('git add brands/pixibot/brand.config.json', { stdio: 'inherit' });
  execSync('git commit -m "feat(migration): update Pixibot config for future releases in Pixibot-Releases"', { stdio: 'inherit' });
  execSync('git push origin main', { stdio: 'inherit' });

  // Create and push tag for version 1.0.5
  console.log('\n🏷️ Creating and pushing tag for pixibot-v1.0.5...');
  execSync(`git tag pixibot-v${brandConfig.version}`, { stdio: 'inherit' });
  execSync(`git push origin pixibot-v${brandConfig.version}`, { stdio: 'inherit' });
  console.log(`✅ Tag pixibot-v${brandConfig.version} created and pushed successfully!`);

  console.log('\n✅ Post-migration setup completed successfully!');
  console.log('\n📋 Summary:');
  console.log('===========');
  console.log('✅ Migration version 1.0.4 published to WA---Pixibot');
  console.log('✅ Future versions will be published to Pixibot-Releases');
  console.log('✅ Configuration updated and committed');
  console.log('\n🎯 Next steps:');
  console.log('1. Monitor migration adoption (users receiving 1.0.4)');
  console.log('2. After successful migration, future releases will automatically go to Pixibot-Releases');
  console.log('3. No further manual intervention required');

} catch (error) {
  console.error('\n❌ Error during post-migration setup:', error.message);
  process.exit(1);
}