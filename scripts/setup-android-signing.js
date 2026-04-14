#!/usr/bin/env node

/**
 * Setup Android signing configuration from environment variables
 * Reads .env file and updates tauri.conf.json with signing credentials
 * Run this before: npm run tauri android build
 */

const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');

const env = {};
envContent.split('\n').forEach(line => {
  if (!line.trim() || line.startsWith('#')) return;
  const [key, value] = line.split('=');
  if (key && value) {
    env[key.trim()] = value.trim();
  }
});

// Validate required env vars
const required = [
  'TAURI_ANDROID_KEYSTORE_PATH',
  'TAURI_ANDROID_KEYSTORE_PASSWORD',
  'TAURI_ANDROID_KEY_ALIAS',
  'TAURI_ANDROID_KEY_PASSWORD'
];

const missing = required.filter(key => !env[key]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables in .env:');
  missing.forEach(key => console.error(`   - ${key}`));
  process.exit(1);
}

// Update tauri.conf.json
const configPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

config.bundle.android = {
  minSdkVersion: 24,
  signingKeyAlias: env.TAURI_ANDROID_KEY_ALIAS,
  signingKeyPassword: env.TAURI_ANDROID_KEY_PASSWORD,
  signingKeyPath: env.TAURI_ANDROID_KEYSTORE_PATH,
  signingStorePassword: env.TAURI_ANDROID_KEYSTORE_PASSWORD
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

console.log('✅ Android signing configuration updated from .env');
console.log(`   Keystore: ${env.TAURI_ANDROID_KEYSTORE_PATH}`);
console.log(`   Alias: ${env.TAURI_ANDROID_KEY_ALIAS}`);
