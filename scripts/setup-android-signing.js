#!/usr/bin/env node

/**
 * Setup Android signing configuration from environment variables
 * Reads .env file and creates gradle.properties for signing
 * Run this before: npm run tauri android build
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found. Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

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

// Create gradle.properties for signing
const gradlePropsPath = path.join(__dirname, '..', 'src-tauri', 'gen', 'android', 'gradle.properties');
const gradleProps = `
# Android signing configuration (auto-generated from .env)
org.gradle.jvmargs=-Xmx2048m
android.useAndroidX=true

# Signing config
KEYSTORE_PATH=${env.TAURI_ANDROID_KEYSTORE_PATH}
KEYSTORE_PASSWORD=${env.TAURI_ANDROID_KEYSTORE_PASSWORD}
KEY_ALIAS=${env.TAURI_ANDROID_KEY_ALIAS}
KEY_PASSWORD=${env.TAURI_ANDROID_KEY_PASSWORD}
`;

// Only write if gen/android exists (created after tauri android init)
if (fs.existsSync(path.dirname(gradlePropsPath))) {
  fs.writeFileSync(gradlePropsPath, gradleProps.trim() + '\n');
  console.log('✅ Gradle signing configuration created');
} else {
  console.log('⚠️  src-tauri/gen/android not found. Run: npm run tauri android init');
  console.log('✅ .env configuration ready for signing');
}

console.log(`   Keystore: ${env.TAURI_ANDROID_KEYSTORE_PATH}`);
console.log(`   Alias: ${env.TAURI_ANDROID_KEY_ALIAS}`);
