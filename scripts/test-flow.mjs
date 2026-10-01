import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  statSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const temp = mkdtempSync(join(tmpdir(), "will-flow-tests-"));
try {
  execFileSync("node", [
    "node_modules/typescript/bin/tsc",
    "lib/standardTwoHourFlow.ts",
    "lib/tennisFlowScripts.ts",
    "lib/flowCues.ts",
    "--outDir",
    temp,
    "--module",
    "commonjs",
    "--target",
    "ES2022",
    "--resolveJsonModule",
    "--esModuleInterop",
    "--skipLibCheck",
  ]);
  const require = createRequire(import.meta.url);
  const {
    buildStandardTwoHourEvents,
    eventAtElapsed,
    nextEventAtElapsed,
    getAutoFlowElapsedSec,
    getAutoFlowProgress,
    buildStandardTwoHourPlan,
  } = require(join(temp, "standardTwoHourFlow.js"));
  const { getScriptsForCourt } = require(join(temp, "tennisFlowScripts.js"));
  const { sanitizeForVoicevox } = require(join(temp, "voicevoxText.js"));
  const expected = [
    ["opening", 0],
    ["volley", 300],
    ["long-rally", 600],
    ["cross-rally", 1200],
    ["serve-return", 1800],
    ["serve-return-switch", 2100],
    ["random-table", 2400],
    ["game-rules", 2580],
    ["self-intro", 2760],
    ["game-start", 3000],
    ["mini-game", 6300],
    ["closing", 7020],
    ["completed", 7200],
  ];
  for (const courts of [1, 2]) {
    const events = buildStandardTwoHourEvents(courts);
    assert.deepEqual(
      events.map((e) => [e.id, e.offsetSec]),
      expected,
    );
    for (const e of events.slice(0, -1)) {
      assert.ok(e.audioSrc);
      assert.ok(existsSync("public" + e.audioSrc));
      assert.ok(statSync("public" + e.audioSrc).size > 1000);
      assert.equal(eventAtElapsed(events, e.offsetSec).id, e.id);
      assert.equal(
        eventAtElapsed(events, e.offsetSec - 1).id,
        events[Math.max(0, events.indexOf(e) - 1)].id,
      );
      assert.equal(e.voiceText, sanitizeForVoicevox(e.displayText));
      assert.equal(sanitizeForVoicevox(e.voiceText), e.voiceText);
      const manual = getScriptsForCourt(
        courts === 2 ? "double" : "single",
      ).find((s) => s.step === e.refStep);
      assert.equal(manual.displayText, e.displayText);
      assert.equal(manual.audioSrc, e.audioSrc);
    }
    assert.equal(events.at(-1).audioSrc, undefined);
    assert.equal(events.at(-1).voiceText, "");
    assert.equal(nextEventAtElapsed(events, 7200), null);
  }
  for (const [elapsed, pct] of [
    [0, 0],
    [1800, 25],
    [3600, 50],
    [5400, 75],
    [7200, 100],
  ])
    assert.deepEqual(getAutoFlowProgress(elapsed), {
      elapsedSec: elapsed,
      remainingSec: 7200 - elapsed,
      percentage: pct,
    });
  assert.equal(getAutoFlowElapsedSec(10000, 2000, 42000), 30);
  assert.equal(getAutoFlowElapsedSec(10000, 2000, 42000, 22000), 10);
  assert.equal(getAutoFlowElapsedSec(10000, 22000, 52000), 20);
  assert.equal(buildStandardTwoHourPlan().at(-1).endMin, 120);
  assert.equal(
    sanitizeForVoicevox(
      "WILL.tennisで乱数表。4ポイント先取、2人、3球、1列、2本、3本。近くの方、先頭の方、打った方、次の方。方向と方法。",
    ),
    "ウィルテニスでらんすうひょう。よんポイントせんしゅ、ふたり、さんきゅう、いちれつ、にほん、さんぼん。ちかくのかた、せんとうのかた、うったかた、つぎのかた。方向と方法。",
  );
  const doubleScripts = getScriptsForCourt("double");
  for (const id of ["cross-rally", "serve-return"]) {
    const script = doubleScripts.find((item) => item.id === id);
    assert.ok(script);
    assert.match(script.displayText, /どちらか一つのコートから何人か/);
    assert.match(
      script.displayText,
      /移動先のコートにもともといた人の中から、同じ人数だけ反対のコートへ移動/,
    );
    assert.doesNotMatch(script.displayText, /各コートから何人か/);
  }
  const audit = JSON.parse(
    readFileSync("reports/flow-audio-v2-audit.json", "utf8"),
  );
  assert.equal(audit.files.length, 16);
  assert.ok(audit.files.every((f) => f.readingChecks.every((c) => c.pass)));
  for (const id of ["cross-rally", "serve-return"]) {
    const script = doubleScripts.find((item) => item.id === id);
    const entry = audit.files.find(
      (file) => file.id === id && file.courtMode === "double",
    );
    assert.equal(entry.displayText, script.displayText);
    assert.equal(readFileSync("public" + entry.audioSrc).length, entry.bytes);
  }
  const { FLOW_RECORDED_CUES } = require(join(temp, "flowCues.js"));
  const extras = JSON.parse(
    readFileSync("reports/flow-extras-audio-audit.json", "utf8"),
  );
  assert.equal(extras.styleId, 3);
  assert.equal(extras.speaker, "ずんだもん");
  assert.equal(extras.style, "ノーマル");
  assert.equal(FLOW_RECORDED_CUES.length, 7);
  assert.equal(extras.files.length, 7);
  for (const cue of FLOW_RECORDED_CUES) {
    const entry = extras.files.find((file) => file.id === cue.id);
    assert.equal(entry.displayText, cue.displayText);
    assert.equal(entry.voiceText, cue.voiceText);
    assert.equal(entry.audioSrc, cue.audioSrc);
    assert.ok(entry.readingChecks.every((check) => check.pass));
    const wav = readFileSync("public" + cue.audioSrc);
    assert.equal(wav.length, entry.bytes);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  }
  console.log(
    "PASS: both court timelines, boundaries, shared scripts/audio, progress, paused clock, normalization, 16 flow WAVs and 7 Zundamon cue/timer WAVs",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
