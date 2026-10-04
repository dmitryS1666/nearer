# iOS — Capacitor shell

iOS native project lives next to Android:

```
pwa/        → web assets (Vite → pwa/www)
android/    → Android Studio / Gradle
ios/        → Xcode project (Capacitor 8.5.2)
```

Bundle id: `app.blizhe.couple`  
Version: `0.1.0` (build `1`)  
Orientation: **portrait only**

## Requirements

- **macOS** + Xcode (15+ recommended)
- Node ≥ 22
- Apple Developer account for device / TestFlight (simulator works without paid account)

Building/signing the `.ipa` is **not** supported on Windows — only the `ios/` project is committed from this machine.

## Sync & open

```bash
npm install
npm run build
npm run cap:sync:ios   # copies pwa/www → ios/App/App/public
npm run ios            # opens Xcode (macOS)
```

Or:

```bash
npx cap sync ios
npx cap open ios
```

## First run in Xcode

1. Open `ios/App/App.xcodeproj` (or via `npm run ios`).
2. Select team under **Signing & Capabilities**.
3. Pick a simulator (e.g. iPhone 15) or a physical device.
4. Run ▶.

Capacitor 8 uses Swift Package Manager for plugins (`CapApp-SPM`) — CocoaPods is not required for this project.

## What already works via shared PWA

- Same UI / product flow as Android
- Service Worker disabled on native (`platform/runtime.js`)
- Local notifications / haptics / status bar / share through Capacitor plugins
- Local-first IndexedDB storage

## Still do on Mac before TestFlight

- App icons in `ios/App/App/Assets.xcassets`
- Launch screen polish (lavender / warm off-white)
- Notification permission UX on a real device
- Privacy Nutrition Labels if submitting to App Store

## Not in V0

- App Store billing / RevenueCat
- APNs remote push
- Sign in with Apple
- Real partner sync
