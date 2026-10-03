# iOS next step

Android is the V0 deliverable. The codebase is structured for iOS without rewriting product UI.

## Add iOS (macOS + Xcode required)

```bash
npm install @capacitor/ios@8.5.2
npx cap add ios
npm run build
npx cap sync ios
npx cap open ios
```

## Expectations

- Same `www/` web assets
- Platform adapters already gate Service Worker off on native
- Local notifications / haptics / status bar / share use Capacitor plugins
- Portrait lock and splash/icons need iOS asset catalog pass in Xcode
- Apple Developer account needed for device install / TestFlight

## Not in V0

- App Store billing
- APNs production push
- Sign in with Apple
