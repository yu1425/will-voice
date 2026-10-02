# Unified flow player

## Design references consulted before implementation

- Mariabs interval timer: configuration, one play/pause action, interval navigation. https://www.mariabs.com/
- Apple Keynote on iPad: selecting a starting slide and moving with the navigator. https://support.apple.com/en-mide/guide/keynote-ipad/tan72233051/ipados
- Apple QuickTime: a play/pause transport and a single playhead. https://support.apple.com/en-is/guide/quicktime-player/qtp6cee0761b/mac
- W3C disclosure navigation: native links, an expanded-state button, keyboard and Escape behavior. https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/

## Contract

| Context                   | Action      | Clock                | Announcement                                        |
| ------------------------- | ----------- | -------------------- | --------------------------------------------------- |
| Auto                      | Start       | Start                | Current cue                                         |
| Auto                      | Pause       | Freeze               | Save WAV position; cancel bell/pending launch       |
| Auto                      | Resume      | Resume               | Resume interrupted WAV, or restart interrupted bell |
| Auto running              | Select item | Seek to its offset   | Cancel old cue, play selected cue                   |
| Auto paused               | Select item | Seek and stay paused | Wait until Resume                                   |
| Auto                      | End         | Clear session        | Cancel all pending playback                         |
| WILL internal navigation  | Leave flow UI | Continue             | Persistent runtime keeps clock/media active         |
| Hidden/background page    | Background  | Continue if browser runs | Never pauses intentionally; recent cue may catch up |
| Reload                    | Restore      | Stay paused           | No unsolicited playback                             |
| Manual                    | Select item | No automatic clock   | Stop old audio, select only                         |
| Manual                    | Play/pause  | No automatic clock   | Start/pause/resume selected WAV                     |

No independent automatic audio stop/replay toolbar. No timer or quick cues in auto mode. Existing WAVs and bell frequencies are unchanged. Settings preview pauses auto before playing a test. Audio volume remains shared. New state schema v4 reads v1/v2/v3 without launching old cues.

## Navigation

Header menu order: Flow, Chat, Settings, Guide. Hover on a fine pointer, click/tap, keyboard, Escape and outside click are supported. The Guide link is last. Starting court configuration is above the player; running configuration is read-only. Supporting disclosure panels have a defined surface even when collapsed.

## Background continuity and screen sleep

- Automatic mode uses one continuous two-hour native media timeline instead of relying on JavaScript timers to start each future cue. The fixed announcements and optional chimes are pre-mixed into four M4A variants: 1/2 courts × chime on/off.
- The same native `<audio>` element remains mounted in the root layout while HOME, Chat, Settings or Guide is shown. Internal App Router navigation therefore does not interrupt playback.
- The timeline is primed directly from the user's start tap, attached to the DOM, and exposed to Media Session. This is specifically intended for iPhone app switching and screen locking: Safari only has to continue one already-playing media stream; it does not need to wake JavaScript at each cue boundary.
- Automatic flow no longer pauses on `visibilitychange` or `pagehide`. When the page is visible, the UI reads the native timeline's `currentTime`; after a throttled/background period it reconciles to the media position without replaying old cues.
- Pause/resume/seek operate on the same native timeline. Changing the chime setting switches to the matching timeline at the current position instead of restarting the session.
- While the document is visible, the app still requests a Screen Wake Lock. If iOS releases the lock while backgrounded, it is requested again on return. Wake Lock is only a convenience; background audio continuity no longer depends on it.
- Physical iPhone + Bluetooth + lock-screen behavior still requires device testing, but the runtime no longer depends on a background JavaScript timer to launch future announcements.

## Two-court member rotation

- At 20:00, before cross rally, only the members on one half of each court are rotated. Operations calls several members on each court; only those people move to the neighboring court while the opposite half stays put.
- At 30:00, before serve/return, the opposite half—the members who were not rotated at 20:00—is handled the same way. The previously rotated half stays put.
- The one-court displayed scripts are unchanged. The 20:00 and 30:00 two-court WAVs were regenerated with VOICEVOX Zundamon Normal. Display text uses natural Japanese, while the TTS input explicitly spells out ambiguous readings such as `運営`, `片面`, `数名` and `側`; commas are deliberately retained to create short pauses.

## Verification

Production build and core unit tests cover the fixed-flow/session/readiness layers. A dedicated background-timeline browser audit verifies that one native two-hour media element remains running across WILL internal navigation and simulated background visibility, that pause/resume/seek operate on its native position, and that chime variants switch without resetting progress. The readiness audit covers preparation failure, retry, AI fallback, bounded generation waits, completion by seek, history clearing and unavailable browser storage. Physical iPhone lock-screen execution remains a device test rather than a headless-browser claim.

`node scripts/test-recorded-audio.mjs`, `node scripts/test-flow.mjs`, `node scripts/test-unified-flow.mjs`, `node scripts/test-offline-flow-audio.mjs`, `node scripts/test-flow-run-history.mjs`, `npx tsc --noEmit`, `npm run build`, audit script syntax checks, and `git diff --check` passed. The protected untracked audio directory/ZIP, fixed event timing and `lib/transitionCue.ts` remain unchanged. The two updated two-court WAVs are tracked in `reports/flow-audio-v2-audit.json`, and `FLOW_AUDIO_CACHE` is bumped so prepared devices fetch the new recordings. Measured evidence: `docs/unified-flow-audit.json` and `docs/flow-readiness-audit.json`.

Physical iPhone/iPad Safari, Bluetooth speaker audibility and screen locking are not certified by headless tests. Visibility changes are simulated. The installed WebKit binary (revision 2203) does not match the available Playwright runtime (expects 2336); that attempted run could not produce results and is not a passing WebKit audit.

## Outdoor readiness and offline scope

- Open the flow page before the event. Expand **開催前チェック**, use **音声を準備**, and wait for **音声準備完了**. The manifest currently contains 20 fixed audio assets: 16 cue/test WAVs plus four two-hour iPhone background M4A timelines.
- Preparation checks Cache Storage, downloads only missing files with at most three concurrent requests, validates full audio responses and verifies writes. A request has a 20-second timeout. The full prepared audio set is about 40MB, of which the four background timelines are about 24MB.
- Readiness requires all files in `will-voice-flow-audio-v4` and a controlling worker that reports the same cache version through the `WILL_FLOW_AUDIO_VERSION` handshake. The worker script is registered as `/sw.js?audio-cache=<cacheName>`, so a stale worker with the same base pathname cannot be mistaken for the current version. Start automatically attempts preparation; failure keeps the session idle and offers retry or explicit online start. Online override cannot start while the browser reports offline. Unsupported Service Worker/Cache Storage environments retain explicit online playback.
- The check shows connection status, shared volume (warns at 0%), the existing voice test and, when enabled, the existing chime test. Confirm audibility at the connected speaker; the browser cannot certify the Bluetooth output device.
- Once prepared, the same open page can run the fixed two-hour recordings after disconnecting. This does **not** promise launching a new browser/page completely offline. Cache eviction, private mode, background suspension and physical output still depend on the device/browser.
- The worker caches only its generated audio manifest and the fixed cue/timeline assets. It never applies cache-first to HTML, `/_next/static/`, APIs, generated TTS, other audio, or the protected audio directory. The URL list comes from `/flow-audio-manifest`.
- `install`, `skipWaiting`, `activate`, `clients.claim` and a cache-version handshake are implemented. Each worker keeps its manifest in a version-specific config cache. Old audio/config caches are removed only within this app's namespace, only after the replacement is complete and the expected worker controls the page; preparation also performs the cleanup so an update that activates before downloads finish does not leak the old ~40MB asset set. An existing prepared version can continue serving immutable v2 URLs during a worker update. Changing WAV contents requires a new URL/version; bump `FLOW_AUDIO_CACHE` for a new asset set.
- Cached full responses support single byte ranges (206/416), including native iOS media requests. Cache failures degrade to normal online requests; other site caches are preserved. See [Service Worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) and [Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range).
- For fixed flow cues in AI voice mode, offline status, generation failure, a disconnect during generation or a 12-second generation timeout uses the fixed recording at runtime. The saved voice preference is preserved. If that recording also fails twice, the flow pauses; it never silently falls through to browser speech.

## Playback diagnostics and local run history

- The reused playback element retries once after 700ms. Failure on the first attempt does not emit `will-flow-audio-error`. Retry success records recovery; only a final recording failure emits the existing flow error/pause signal. A late promise from an earlier attempt cannot fail a newer attempt.
- Settings contain a collapsed **音声診断** panel. `getRecordedAudioDiagnostics()` safely reads legacy entries and rejects malformed entries; `clearRecordedAudioDiagnostics()` safely clears them. Up to 20 local entries show cue names, time, first failure/automatic retry, recovery or final failure. Technical fields are behind a disclosure. JSON copy and confirmed clear are provided; no logs are sent to a server.
- `will-recorded-audio-diagnostic` publishes failure/retry, actual retry start (`retryStarted`), recovery and final failure without a React dependency. The auto player subscribes only for its current in-flight voice. Tests, individual playback and stale/canceled retries do not inflate the active run's counts. Generated AI failures that successfully fall back do not count as final safety pauses.
- **開催履歴** is closed by default below the existing 3x4 progression menu. An active run is stored separately at `will-flow-active-run`; completed/ended runs live at `will-flow-run-history`, retaining the latest 20. The optional `runId` extends AutoSession v4 without invalidating v1-v4 restoration.
- Reload, pause, resume and seek keep one run identity. Finishing writes/upserts one record; repeated completion/reload cannot duplicate it. Reaching 02:00 saves completion; explicit early end saves an interrupted run. Actual duration counts running wall time, excluding pauses and without adding seek offsets.
- Manual pauses and safety pauses are distinguished. Visibility changes and WILL internal page navigation no longer create pauses; navigation pauses remain available for explicit auto→manual mode changes and reload restoration, while audio errors remain safety pauses. Seek, actual audio retry, recovery and final recording failure counts are retained, with safety reasons visible. No participant names or personal details are stored. Storage exceptions leave playback usable; run history is held in memory when localStorage is unavailable and cannot then survive reload.

## Next announcement and pre-game display

- The existing compact **次のメニュー** card remains a seek button. Its countdown uses the same elapsed clock, freezes on pause and disappears on completion. The original small pill-style countdown and typography are retained; no urgency styling or additional sound is introduced.
- **ゲーム前進行** is visible from the existing gather event at 40:00 until the silent game event at 50:00. It marks completed/current/remaining steps using event offsets: gather, random table (43:00), rules (43:33), introductions (44:02), and **50:00 主催者が口頭でゲーム開始**. The timings and `chime: false` handoff for rules/introductions are unchanged. No game-start recording is added.

## Reproduce browser verification

Use an available Playwright installation and isolated production/preview URL; no Playwright production dependency is needed:

```sh
WILL_AUDIT_URL=http://localhost:3100 WILL_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs WILL_CHROME_PATH=/path/to/chrome-headless-shell WILL_AUDIT_OUTPUT=/tmp/will-flow-audit node scripts/audit-unified-flow.mjs
WILL_AUDIT_URL=http://localhost:3100 WILL_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs WILL_CHROME_PATH=/path/to/chrome-headless-shell WILL_AUDIT_OUTPUT=/tmp/will-readiness-audit node scripts/audit-flow-readiness.mjs
```

The readiness audit mocks API availability/failures; it never requests paid TTS generation. Optional compatible WebKit verification uses `WILL_BROWSER_ENGINE=webkit` and `WILL_BROWSER_PATH` instead of `WILL_CHROME_PATH`. A compatible engine is required; this does not replace physical iPhone testing.

## Parent character site / HOME

- `/` is the parent site for the WILL.tennis official character `うぃる`, rather than a redirect to `/flow`.
- Primary content: progression assistant (`/flow`) and chat (`/chat`). Support: settings (`/settings`) and guide (`/guide`).
- The header menu order is HOME -> progression -> chat -> contextual settings -> guide. Flow/chat settings open their own content settings; the settings index routes to the appropriate content.
- Automatic and manual 12-item selectors share a compact 3-column x 4-row visual language to reduce scrolling while preserving direct item selection.

- The fixed header is parent-brand navigation: the character/avatar + `うぃる / WILL.tennis 公式キャラクター` links to HOME. Page-specific titles (progression, chat, settings, guide) live below that header.
- Two-court practice rotation changes one side at a time: several members on the operations-designated side exchange courts before cross rally, then the previously stationary side exchanges several members before serve/return.
