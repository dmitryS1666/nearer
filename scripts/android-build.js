import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const mode = process.argv[2] === 'release' ? 'release' : 'debug';
const androidDir = resolve(root, 'android');
const isWin = process.platform === 'win32';
const gradlew = resolve(androidDir, isWin ? 'gradlew.bat' : 'gradlew');

const defaultSdk = resolve(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const studioJbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
const env = {
  ...process.env,
  ANDROID_HOME: process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdk,
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || defaultSdk,
  JAVA_HOME: process.env.JAVA_HOME || (existsSync(studioJbr) ? studioJbr : process.env.JAVA_HOME)
};
env.PATH = `${resolve(env.JAVA_HOME || '', 'bin')}${isWin ? ';' : ':'}${resolve(env.ANDROID_HOME, 'platform-tools')}${isWin ? ';' : ':'}${env.PATH || ''}`;

if (!existsSync(gradlew)) {
  console.error('Android project missing. Run: npx cap add android');
  process.exit(1);
}

const task = mode === 'release' ? 'assembleRelease' : 'assembleDebug';
console.log(`Building ${task}…`);
const result = spawnSync(gradlew, [task, '--stacktrace'], {
  cwd: androidDir,
  env,
  stdio: 'inherit',
  shell: isWin
});
if (result.status !== 0) process.exit(result.status || 1);

const artifactsDir = resolve(root, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

if (mode === 'debug') {
  const src = resolve(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
  const dest = resolve(artifactsDir, 'app-debug.apk');
  if (!existsSync(src)) {
    console.error('Debug APK not found at', src);
    process.exit(1);
  }
  copyFileSync(src, dest);
  const mb = (statSync(dest).size / (1024 * 1024)).toFixed(2);
  console.log(`PASS debug APK: ${dest} (${mb} MB)`);
} else {
  const src = resolve(androidDir, 'app/build/outputs/apk/release/app-release.apk');
  const alt = resolve(androidDir, 'app/build/outputs/apk/release/app-release-unsigned.apk');
  const found = existsSync(src) ? src : existsSync(alt) ? alt : null;
  if (!found) {
    console.error('Release APK not found');
    process.exit(1);
  }
  const dest = resolve(artifactsDir, 'blizhe-0.1.0-hypothesis.apk');
  copyFileSync(found, dest);
  const mb = (statSync(dest).size / (1024 * 1024)).toFixed(2);
  console.log(`PASS release APK: ${dest} (${mb} MB)`);
}
