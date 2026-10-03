/**
 * Creates a local hypothesis keystore + android/keystore.properties.
 * Passwords are written ONLY to local gitignored files — never printed.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const signingDir = resolve(root, 'signing');
const storeFile = resolve(signingDir, 'blizhe-hypothesis.jks');
const propsFile = resolve(root, 'android/keystore.properties');

if (existsSync(storeFile) && existsSync(propsFile)) {
  console.log('Keystore already exists — skipping generation.');
  process.exit(0);
}

mkdirSync(signingDir, { recursive: true });
const password = randomBytes(18).toString('base64url');
const alias = 'blizhe';

const result = spawnSync(
  'keytool',
  [
    '-genkeypair',
    '-v',
    '-keystore',
    storeFile,
    '-storetype',
    'JKS',
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-alias',
    alias,
    '-storepass',
    password,
    '-keypass',
    password,
    '-dname',
    'CN=Blizhe Hypothesis, OU=Product Validation, O=Blizhe, L=Local, ST=Local, C=RU'
  ],
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('keytool failed. Ensure JDK keytool is on PATH.');
  process.exit(result.status || 1);
}

writeFileSync(
  propsFile,
  [
    `storeFile=${storeFile.replace(/\\/g, '/')}`,
    `storePassword=${password}`,
    `keyAlias=${alias}`,
    `keyPassword=${password}`,
    ''
  ].join('\n'),
  { mode: 0o600 }
);

writeFileSync(
  resolve(signingDir, 'README.txt'),
  [
    'LOCAL HYPOTHESIS KEYSTORE',
    'Do not commit this folder.',
    'Back up blizhe-hypothesis.jks and android/keystore.properties to a password manager / secure drive.',
    'If lost, you cannot update the same app signature for sideloaded testers.',
    ''
  ].join('\n')
);

console.log('Hypothesis keystore created.');
console.log('Store path:', storeFile);
console.log('Properties path:', propsFile);
console.log('Passwords were written to keystore.properties only (not printed).');
