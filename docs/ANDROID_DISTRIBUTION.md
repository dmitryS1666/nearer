# Android distribution — hypothesis APK

## Artifacts

| File | Path | Notes |
|------|------|-------|
| Debug | `artifacts/app-debug.apk` | Faster rebuilds, debug-signed |
| Hypothesis release | `artifacts/blizhe-0.1.0-hypothesis.apk` | Signed with local hypothesis keystore |

Typical size (V0): ~3–5 MB.

## Option A — Direct APK (default)

1. Send `blizhe-0.1.0-hypothesis.apk` via chat / drive / QR.
2. Tester opens the file on Android.
3. System may warn about unknown source — use the **standard one-time allow** for that install source.
4. Do **not** ask testers to disable global device security.

```bash
adb install -r artifacts/blizhe-0.1.0-hypothesis.apk
```

## Option B — Firebase App Distribution (optional)

Not required for hypothesis build.

If you have a Firebase project later:

1. Add Android app with package `app.blizhe.couple`
2. Install Firebase CLI / App Distribution
3. Upload `blizhe-0.1.0-hypothesis.apk`
4. Invite testers by email

Do not block delivery on Firebase setup.

## Signing (owner)

- Keystore: `signing/blizhe-hypothesis.jks` (gitignored)
- Props: `android/keystore.properties` (gitignored)
- Example templates: `.env.signing.example`, `android/keystore.properties.example`
- Regenerate: `node scripts/create-hypothesis-keystore.mjs` (only if missing)
- **Back up** keystore + properties to a password manager. Never commit secrets.

Package id `app.blizhe.couple` is for hypothesis only — re-validate ownership before Play Store.
