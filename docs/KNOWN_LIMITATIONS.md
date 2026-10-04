# Known limitations — Hypothesis 0.1.0

Honest list for owners/QA.

## Product / data

- No real remote partner — Demo Partner Engine answers locally after a delay.
- No account, no sync across two phones.
- History / streak / garden are device-local only.
- Couple Plus is a demo paywall (no billing). CTA is logged locally.
- Completing a day locks today until next calendar day (or Test Lab «следующий тестовый день»).

## Notifications

- Native: Capacitor **local** notifications only (no FCM).
- Partner-answered ping while backgrounded is best-effort; OS may defer/suppress.
- Web: true background Web Push still needs VAPID + server sender (`config.js`).
- Exact daily alarm behavior varies by OEM battery optimizations.

## Platform

- Android APK sideload requires unknown-source confirmation.
- Service Worker disabled inside Capacitor WebView by design.
- iOS Xcode project is in `ios/`; building/signing `.ipa` requires macOS + Xcode (not Windows).
- Android build requires Node ≥ 22 and JDK 21.

## Privacy / network

- No advertising IDs, contacts, GPS, or accounts collected.
- App is designed to work offline after install; bundled assets only.
- Local analytics never leave the device without a future consent/integration.

## Post-hypothesis (explicit TODOs)

- Supabase + Auth
- Realtime partner sync
- Remote push (FCM/APNs)
- Production billing (RevenueCat)
- Production E2EE for answers
