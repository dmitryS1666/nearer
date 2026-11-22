# Android pilot report — API routing

Repository: `dmitryS1666/nearer`  
Base: `049c0234c885275960a16aed1683e8fe768636d9` (`origin/main` at the start of this change)  
APK: `blizhe-0.1.0-hypothesis.apk`  
Release: https://github.com/dmitryS1666/nearer/releases/tag/android-hypothesis-0.1.0

Garden v2, archive ownership, and the encrypted sync protocol are unchanged. This change only fixes where `/api/*` is sent from a Capacitor build, and how native HTTP preserves fetch status codes.

## What changed

- Web and PWA keep same-origin paths (`/api/pairs`, `/api/pairs/join`, `/api/pairs/me`, `/api/pairs/sync`, `/api/plus/intent`, `/api/link-preview`). An empty push subscription URL is left alone; a `/api/` subscription URL would go through the same helper.
- Native Capacitor resolves those paths to `https://nearer.other.dev-regiuslab.by`. That host is a public API origin, not a credential.
- Calls go through `CapacitorHttp.request`, then a `Response`, so `status`, `ok`, and `json()` stay fetch-compatible. Capacitor 8.5.2's global fetch patch does **not** do that for GET: it proxies GET/HEAD through `/_capacitor_http_interceptor_` in the WebView. The explicit adapter is what the app uses. `CapacitorHttp.enabled` is still `true` in the packaged `assets/capacitor.config.json` and does not open server CORS.
- Plus still requires `x-blizhe-intent: 1`. `sec-fetch-site: cross-site` is still rejected. A missing `Origin` is still accepted. `https://localhost`, `http://localhost`, and `capacitor://localhost` are now accepted as the app's own WebView origin. `https://localhost.evil.example` and a missing intent header stay 403. A 403 or 409 is not treated as success.
- The browser E2E no longer requires the partner's sentence to remain on Today. After a mutual answer the screen advances to the next question; the test now requires the partner text in IndexedDB and that Today actually moved forward.

## APK

| Field | Value |
| --- | --- |
| File | `artifacts/blizhe-0.1.0-hypothesis.apk` (not committed) |
| Size | 3.28 MB |
| Package | `app.blizhe.couple` |
| versionName / versionCode | `0.1.0` / `1` |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 |
| SHA-256 | `A3C04C1C5AFBD6779282F12F8184635CAB2965B070F05A0A8C554B38BF74F572` |
| Signature | APK Signature Scheme v2, one signer. v1/v3/v4 not used |
| Certificate SHA-256 | `eddb081821b81b9d8f93128d5900861a9329226ac45e36a39ebcb50d7a0f12a6` |
| Certificate | `CN=Blizhe Hypothesis, OU=Product Validation, O=Blizhe, L=Local, ST=Local, C=RU` |
| Key | RSA 2048 |
| `apksigner verify` | Verified |
| Built with | Node 22.23.3 (fnm), Android Studio JBR 21, Gradle `assembleRelease` |

`npm run android:build:release` fails on the default Node 20.16.0 because Capacitor CLI 8.5.2 requires Node >= 22. Vite also warns that 20.16 is below 20.19. The release build used Node 22.23.3. `BUILD SUCCESSFUL in 1m 4s`.

The APK downloaded from the release is 3435940 bytes and hashes to the same SHA-256.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| `npm test` | PASS | 130 tests, 55 suites, 0 failed. Node 20.16.0. Includes native-vs-web URLs, pair/join/sync GET+PUT, link preview, Plus 403/409/offline, and Capacitor origin rules. |
| `npm run build` | PASS | Vite build completed. Bundle contains `https://nearer.other.dev-regiuslab.by` and still emits relative `/api/` for web. |
| `npm run test:smoke` | PASS | `smoke_web=PASS` |
| `npm run test:e2e:garden` | PASS | Two Playwright contexts, local Vite `/api/pairs`. `e2e-garden=PASS` in ~63s after the Today assertion fix. On-screen keyboard overlap was not part of this script. |
| `npm run test:e2e` (Python) | NOT RUN | `python pwa/test_pwa.py` exits 0 with "Playwright not installed". The Node garden E2E above is the browser run that executed. |
| Published `GET /health` | PASS | `200 {"status":"ok"}` |
| Published `GET /api/pairs/me` without a token | PASS | `401 {"error":"unauthorized"}`. No `Access-Control-Allow-Origin`. |
| Published CORS preflight `OPTIONS /api/pairs` from `Origin: https://localhost` | PASS (no CORS added) | `404 {"error":"not_found"}`. No allow-origin header. Same-origin PWA does not need it. Native HTTP does not use this preflight. |
| Published Plus, no Origin, invalid plan | PASS | `400 {"error":"invalid_plan"}`. The intent gate let the body through. Not a 403. |
| Published Plus, `sec-fetch-site: cross-site` | PASS | `403 {"error":"forbidden"}` |
| Published Plus, `Origin: https://localhost`, invalid plan | PASS after deploy | Before this commit was deployed, the same request was `403`. Deploy run [45054189217](https://github.com/dmitryS1666/nearer/actions/runs/45054189217) on `21a6e2c` succeeded. A later probe returned `400 {"error":"invalid_plan"}` for `https://localhost` and `capacitor://localhost`. `sec-fetch-site: cross-site`, `https://localhost.evil.example`, and a missing intent header stayed `403`. The APK adapter still does not send `Origin`. |
| Published Plus, valid body, no Origin | BLOCKED | `503 {"error":"email_not_configured"}`. Request id `ee85c4a8-2d56-43b5-b2a3-ffe97051af22`. The handler ran. SMTP is not configured, so this is not a pass. No letter was sent. Plus is still a non-billing interest request. |
| Published `POST /api/link-preview` for `https://example.com` | PASS | `200`, title `example.com` |
| Published two-client pair + encrypted sync | PASS | Not two phones. Node clients against `https://nearer.other.dev-regiuslab.by`: create `201`, join `200`, both `linked` on the same pair, PUT sync `200` revision 1, the other device decrypted `{marker:"pilot-sync"}`, ciphertext did not contain that marker, stale PUT `409 conflict` and `ok: false`, retry `200` revision 2. First `DELETE` returned `200` and removed the pair; the second token then got `401`. |
| Signed APK install on emulator `emulator-5554` (`sdk_gphone16k_x86_64`) | PASS | `adb install` Success after uninstalling an older build whose certificate did not match. That uninstall deleted the previous app data. This is normal Android signature behavior, not a data-loss bug in the new build. |
| Emulator cold start | PASS | Onboarding rendered: «Ближе каждый день.» |
| Profile survives force-stop | PASS | Entered Dima / Katya, reached Today. After `am force-stop` and relaunch the header was still «СЕГОДНЯ · DIMA», not onboarding. |
| Same profile survives airplane mode + force-stop | PASS | `settings get global airplane_mode_on` was `1`, status bar showed the airplane icon. Relaunch still showed «СЕГОДНЯ · DIMA» and the local Today screen. No process crash in logcat. |
| A submitted question answer survives kill / airplane on a device | NOT RUN | No daily or period answer was submitted on the emulator. Profile text is not that answer. |
| Two physical phones: create/join, both answers, garden bloom, wishlist, moments, offline edits, reconnect, kill, same-pair keys, reject a foreign circle | NOT RUN | Only one emulator was attached. The published-backend pair above is two Node clients, not two phones. |
| APK observed calling the HTTPS API, and not `localhost` / `app.local` / `capacitor://…/api` | NOT RUN for a real API call | Logcat for this session had no `nearer.other`, `localhost/api`, `capacitor://localhost/api`, or `app.local` lines. The emulator session never paired, so the native adapter was not exercised on device. Unit tests cover the URL and header shape. |
| On-device Plus submit | NOT RUN | Would also be blocked by live SMTP `503` until mail is configured. |
| iOS | NOT RUN | No macOS/Xcode build in this run. |

## Limitations that remain

- Live SMTP is not configured. Plus returns `503 email_not_configured` and does not send mail. Do not treat that as a successful purchase. There is still no billing.
- Production now accepts `https://localhost`, `http://localhost`, and `capacitor://localhost` on Plus when `x-blizhe-intent: 1` is present and `sec-fetch-site` is not `cross-site`. That was checked live after Deploy run 45054189217. The shipped adapter still does not send `Origin` or `Sec-Fetch-Site`.
- Server CORS was not widened. A WebView `fetch` from `https://localhost` to the API will fail the browser preflight. That is intentional.
- Capacitor's fetch patch is enabled, but app `/api` calls do not rely on the GET interceptor. This was read from Capacitor 8.5.2 `native-bridge.js` and `HttpRequestHandler.java`, and covered by unit tests of the adapter. It was not traced in logcat on a device.
- Sync blobs can be up to the existing ~768 KB server limit. The native bridge is a worse place for a payload that large than browser `fetch`. That limit was not changed.
- One emulator cannot show two-device merge, foreign-circle rejection, or wishlist/moment sync. Those remain covered by the existing Node tests and the two-browser garden E2E against the local API, not by a phone pair.
- The hypothesis certificate is the local pilot key (`CN=Blizhe Hypothesis`). It is not a Play Store key.
- `pwa/sw.js` is an unused older shell. The served worker is `pwa/public/sw.js`, which does not cache `/api/`.
