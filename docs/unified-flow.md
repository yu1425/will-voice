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

34 production-build browser checks passed, including native WAV cursor resume, silent paused seek, automatic boundaries after resume, Back/Forward navigation, menu hover/tap/keyboard/Escape, volume 100/50/20/30%, manual timer/cues, error retry and no horizontal overflow at 320/390/480/1440px. Native runtime errors: 0. Screenshots were inspected locally, rather than adding another set of PNGs to the repository.

`node scripts/test-flow.mjs`, `node scripts/test-unified-flow.mjs`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. All 23 WAVs and `lib/transitionCue.ts` are unchanged from the starting SHA. Detailed measured evidence: `docs/unified-flow-audit.json`.

Real iPad Safari, Bluetooth speaker audibility and physical screen locking are not certified by headless browser tests. The visibility-change test is simulated and labeled as such.

## Parent character site / HOME

- `/` is the parent site for the WILL.tennis official character `うぃる`, rather than a redirect to `/flow`.
- Primary content: progression assistant (`/flow`) and chat (`/chat`). Support: settings (`/settings`) and guide (`/guide`).
- The header menu order is HOME -> progression -> chat -> contextual settings -> guide. Flow/chat settings open their own content settings; the settings index routes to the appropriate content.
- Automatic and manual 12-item selectors share a compact 3-column x 4-row visual language to reduce scrolling while preserving direct item selection.

- The fixed header is parent-brand navigation: the character/avatar + `うぃる / WILL.tennis 公式キャラクター` links to HOME. Page-specific titles (progression, chat, settings, guide) live below that header.
- Two-court practice rotation is sequential, not simultaneous: people first move from one court, then the same number of people who were originally on the destination court move back to the other court.
