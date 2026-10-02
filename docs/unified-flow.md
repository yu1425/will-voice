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
| Navigation or hidden page | Leave       | Pause                | Save current WAV position                           |
| Reload                    | Restore     | Stay paused          | No unsolicited playback                             |
| Manual                    | Select item | No automatic clock   | Stop old audio, select only                         |
| Manual                    | Play/pause  | No automatic clock   | Start/pause/resume selected WAV                     |

No independent automatic audio stop/replay toolbar. No timer or quick cues in auto mode. Existing WAVs and bell frequencies are unchanged. Settings preview pauses auto before playing a test. Audio volume remains shared. New state schema v4 reads v1/v2/v3 without launching old cues.

## Navigation

Header menu order: Flow, Chat, Settings, Guide. Hover on a fine pointer, click/tap, keyboard, Escape and outside click are supported. The Guide link is last. Starting court configuration is above the player; running configuration is read-only. Supporting disclosure panels have a defined surface even when collapsed.

## Verification

52 production-build Chromium checks passed, including all 16 cached WAV fetches offline, native playback at every fixed flow position, byte-range responses, pre-game display, countdown, cursor resume, silent paused seek, boundaries, Back/Forward, menu controls, shared volume, diagnostics, history and no horizontal overflow at 320/390/480/1440px. A separate readiness audit covers preparation failure, retry, AI fallback, bounded generation waits, completion by seek, history clearing and unavailable browser storage. Native runtime errors: 0. Screenshots are inspected locally and are not committed.

`node scripts/test-recorded-audio.mjs`, `node scripts/test-flow.mjs`, `node scripts/test-unified-flow.mjs`, `node scripts/test-offline-flow-audio.mjs`, `node scripts/test-flow-run-history.mjs`, `npx tsc --noEmit`, `npm run build`, audit script syntax checks, and `git diff --check` passed. Existing WAVs, the protected untracked audio directory/ZIP, fixed event timing and `lib/transitionCue.ts` remain unchanged from origin/main `2c5ea5343e693f76becf39896ca9ec2ef094addc`. Measured evidence: `docs/unified-flow-audit.json` and `docs/flow-readiness-audit.json`.

Physical iPhone/iPad Safari, Bluetooth speaker audibility and screen locking are not certified by headless tests. Visibility changes are simulated. The installed WebKit binary (revision 2203) does not match the available Playwright runtime (expects 2336); that attempted run could not produce results and is not a passing WebKit audit.

## Outdoor readiness and offline scope

- Open the flow page before the event. Expand **開催前チェック**, use **音声を準備**, and wait for **音声準備完了**. The displayed total is derived from both court timelines plus `FLOW_VOICE_TEST` (currently 16 unique WAVs).
- Preparation checks Cache Storage, downloads only missing files with at most three concurrent requests, validates full audio responses and verifies writes. A request has a 20-second timeout. Preloading alone does not mean prepared.
- Readiness requires all files in `will-voice-flow-audio-v1` and a controlling worker that reports the same cache version through the `WILL_FLOW_AUDIO_VERSION` handshake. The worker script is registered as `/sw.js?audio-cache=<cacheName>`, so a stale worker with the same base pathname cannot be mistaken for the current version. Start automatically attempts preparation; failure keeps the session idle and offers retry or explicit online start. Online override cannot start while the browser reports offline. Unsupported Service Worker/Cache Storage environments retain explicit online playback.
- The check shows connection status, shared volume (warns at 0%), the existing voice test and, when enabled, the existing chime test. Confirm audibility at the connected speaker; the browser cannot certify the Bluetooth output device.
- Once prepared, the same open page can run the fixed two-hour recordings after disconnecting. This does **not** promise launching a new browser/page completely offline. Cache eviction, private mode, background suspension and physical output still depend on the device/browser.
- The worker caches only its small generated audio manifest and the selected fixed WAVs. It never applies cache-first to HTML, `/_next/static/`, APIs, generated TTS, other audio, or the protected audio directory. The URL list comes from `/flow-audio-manifest`, using the same event builder as preparation.
- `install`, `skipWaiting`, `activate`, `clients.claim` and a cache-version handshake are implemented. Each worker keeps its manifest in a version-specific config cache. Old audio/config caches are removed only within this app's namespace, only after the replacement is complete and the expected worker controls the page; preparation also performs the cleanup so an update that activates before downloads finish does not leak ~16MB per version. An existing prepared version can continue serving immutable v2 URLs during a worker update. Changing WAV contents requires a new URL/version; bump `FLOW_AUDIO_CACHE` for a new asset set.
- Cached full responses support single byte ranges (206/416), including native iOS media requests. Cache failures degrade to normal online requests; other site caches are preserved. See [Service Worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) and [Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range).
- For fixed flow cues in AI voice mode, offline status, generation failure, a disconnect during generation or a 12-second generation timeout uses the fixed recording at runtime. The saved voice preference is preserved. If that recording also fails twice, the flow pauses; it never silently falls through to browser speech.

## Playback diagnostics and local run history

- The reused playback element retries once after 700ms. Failure on the first attempt does not emit `will-flow-audio-error`. Retry success records recovery; only a final recording failure emits the existing flow error/pause signal. A late promise from an earlier attempt cannot fail a newer attempt.
- Settings contain a collapsed **音声診断** panel. `getRecordedAudioDiagnostics()` safely reads legacy entries and rejects malformed entries; `clearRecordedAudioDiagnostics()` safely clears them. Up to 20 local entries show cue names, time, first failure/automatic retry, recovery or final failure. Technical fields are behind a disclosure. JSON copy and confirmed clear are provided; no logs are sent to a server.
- `will-recorded-audio-diagnostic` publishes failure/retry, actual retry start (`retryStarted`), recovery and final failure without a React dependency. The auto player subscribes only for its current in-flight voice. Tests, individual playback and stale/canceled retries do not inflate the active run's counts. Generated AI failures that successfully fall back do not count as final safety pauses.
- **開催履歴** is closed by default below the existing 3x4 progression menu. An active run is stored separately at `will-flow-active-run`; completed/ended runs live at `will-flow-run-history`, retaining the latest 20. The optional `runId` extends AutoSession v4 without invalidating v1-v4 restoration.
- Reload, pause, resume and seek keep one run identity. Finishing writes/upserts one record; repeated completion/reload cannot duplicate it. Reaching 02:00 saves completion; explicit early end saves an interrupted run. Actual duration counts running wall time, excluding pauses and without adding seek offsets.
- Manual pauses and safety pauses (visibility, navigation, audio error) are distinguished. Seek, actual audio retry, recovery and final recording failure counts are retained, with safety reasons visible. No participant names or personal details are stored. Storage exceptions leave playback usable; run history is held in memory when localStorage is unavailable and cannot then survive reload.

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
- Two-court practice rotation is sequential, not simultaneous: people first move from one court, then the same number of people who were originally on the destination court move back to the other court.
