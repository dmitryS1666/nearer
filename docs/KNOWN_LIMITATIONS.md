# Known limitations — Nearer 0.1.x (Garden v2)

Honest list for owners/QA.

## Product / data

- Thematic **Garden v2** periods grow only from **mutual** period answers (not legacy daily, reactions, or challenge).
- Legacy daily question bank remains optional and still uses `completedDays` / streak; that memorial progress is **not** a thematic plant.
- Demo Partner answers only legacy daily keys and **never** writes into real periods. On a linked pair Demo Partner is disabled.
- Couple Plus remains a demo paywall (no billing). History / completed plants are **not** gated by paid slots.
- Completing a legacy calendar day still locks that optional ritual until the next calendar day (or Test Lab «следующий тестовый день»).

## Pairing / sync / recovery

- Sync payload format **v3**: only the **current pair circle** is sent. Older clients cannot overwrite a v3 snapshot (`client_outdated`).
- Archive affiliation uses per-entity `circleId` plus `lastBoundPairId` (survives leave). Leaving clears sync access, not local history origin. A new pair does **not** absorb the previous archive.
- Unscoped / unprovable entities stay local and are not auto-synced.
- **Content backup** restores archive + periods but **not** `deviceLink` keys; restore while linked to another pair does not remap old circles onto the live pair.
- **Pair recovery bundle** (passphrase) restores keys for the same server pair. Without it, create a new pair after leave.
- If both phones and both files (backup + recovery) are lost, content and keys are unrecoverable — production-ready ops still require user backup discipline.
- Offline dual-start of two themes resolves on sync to one active (earlier `createdAt`/`id`); the other is paused with answers kept. Status conflicts use `statusUpdatedAt`/`statusVersion`, not content clocks alone.

## Notifications

- Native: Capacitor **local** notifications only (no FCM).
- Partner-answered ping while backgrounded is best-effort; OS may defer/suppress.
- Web: true background Web Push still needs VAPID + server sender (`config.js`).

## Platform

- Android APK sideload requires unknown-source confirmation.
- Service Worker disabled inside Capacitor WebView by design.
- iOS Xcode project is in `ios/`; building/signing `.ipa` requires macOS + Xcode.
- Android build requires Node ≥ 22 and JDK 21.

## Privacy / network

- No advertising IDs, contacts, GPS, or accounts collected.
- App is designed to work offline after install; sync needs network when linked.
- Local analytics never leave the device without a future consent/integration.
- AI summaries / Memory PDF / seasonal garden art are out of scope for this MVP.

## Explicit non-goals (this MVP)

- AI period summary, billing, ambient sound, PDF export, photos inside a period, procedural plant growth, new global navigation.
