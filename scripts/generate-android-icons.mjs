import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const res = resolve(root, 'android/app/src/main/res');

const densities = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

// Heart-only mark on transparent background (no baked square fill).
const iconSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="90" y1="70" x2="420" y2="450" gradientUnits="userSpaceOnUse">
      <stop stop-color="#E8A0C8"/>
      <stop offset="0.5" stop-color="#B18CFF"/>
      <stop offset="1" stop-color="#7B5CE8"/>
    </linearGradient>
  </defs>
  <path fill="url(#g)" d="M256 402c-18-14-128-92-128-192 0-48 36-84 84-84 28 0 52 14 68 36 16-22 40-36 68-36 48 0 84 36 84 84 0 100-110 178-128 192z"/>
  <circle cx="210" cy="214" r="18" fill="#ffffff" fill-opacity="0.45"/>
  <circle cx="302" cy="214" r="18" fill="#ffffff" fill-opacity="0.45"/>
</svg>`);

const splashSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1920" fill="#F4F0FF"/>
  <circle cx="540" cy="820" r="160" fill="#E8DFFF"/>
  <path fill="#9B74F0" d="M540 980c-16-12-110-80-110-166 0-42 31-73 73-73 24 0 45 12 59 31 14-19 35-31 59-31 42 0 73 31 73 73 0 86-94 154-110 166z"/>
  <text x="540" y="1120" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="86" font-weight="700" fill="#5B3DB8">Blizhe</text>
  <text x="540" y="1200" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="54" fill="#C46B9A">&#10084;</text>
</svg>`);

for (const [folder, size] of Object.entries(densities)) {
  const dir = resolve(res, folder);
  mkdirSync(dir, { recursive: true });
  // Keep transparent PNG for legacy/launcher shortcuts
  await sharp(iconSvg).resize(size, size).png().toFile(resolve(dir, 'ic_launcher.png'));
  await sharp(iconSvg).resize(size, size).png().toFile(resolve(dir, 'ic_launcher_round.png'));
  // Adaptive foreground: padded heart in safe zone
  const pad = Math.round(size * 0.18);
  const inner = size - pad * 2;
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: await sharp(iconSvg).resize(inner, inner).png().toBuffer(), left: pad, top: pad }])
    .png()
    .toFile(resolve(dir, 'ic_launcher_foreground.png'));
}

for (const dirName of ['pwa/icons', 'pwa/public/icons', 'icons']) {
  const dir = resolve(root, dirName);
  mkdirSync(dir, { recursive: true });
  for (const size of [192, 512]) {
    await sharp(iconSvg).resize(size, size).png().toFile(resolve(dir, `icon-${size}.png`));
  }
  // Maskable still needs safe padding on soft fill for PWA install
  const maskable = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 244, g: 240, b: 255, alpha: 1 } }
  })
    .composite([{ input: await sharp(iconSvg).resize(340, 340).png().toBuffer(), left: 86, top: 86 }])
    .png()
    .toBuffer();
  writeFileSync(resolve(dir, 'maskable-512.png'), maskable);
}

const splashPng = await sharp(splashSvg).png().toBuffer();
const splashTargets = [
  'drawable/splash.png',
  'drawable-port-mdpi/splash.png',
  'drawable-port-hdpi/splash.png',
  'drawable-port-xhdpi/splash.png',
  'drawable-port-xxhdpi/splash.png',
  'drawable-port-xxxhdpi/splash.png',
  'drawable-land-mdpi/splash.png',
  'drawable-land-hdpi/splash.png',
  'drawable-land-xhdpi/splash.png',
  'drawable-land-xxhdpi/splash.png',
  'drawable-land-xxxhdpi/splash.png'
];
for (const rel of splashTargets) {
  const out = resolve(res, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, splashPng);
}

const notifSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill="#FFFFFF" d="M12 20S5 15.5 5 10.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z"/>
</svg>`);
mkdirSync(resolve(res, 'drawable'), { recursive: true });
await sharp(notifSvg).resize(48, 48).png().toFile(resolve(res, 'drawable/ic_stat_icon.png'));

// Soft solid adaptive background (OS masks it); icon art itself stays transparent PNG
writeFileSync(
  resolve(res, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F4F0FF</color>\n</resources>\n`
);
writeFileSync(
  resolve(res, 'drawable/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <solid android:color="#F4F0FF"/>\n</shape>\n`
);

console.log('Transparent heart PNG icons generated (no baked square fill)');
