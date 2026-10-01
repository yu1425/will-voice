import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const temp = mkdtempSync(join(tmpdir(), "will-unified-tests-"));
try {
  execFileSync("node", [
    "node_modules/typescript/bin/tsc",
    "lib/autoFlowSession.ts",
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
    createSession,
    pauseSession,
    resumeSession,
    seekSession,
    restoreSession,
    sessionElapsed,
  } = require(join(temp, "autoFlowSession.js"));
  const { buildStandardTwoHourEvents } = require(
    join(temp, "standardTwoHourFlow.js"),
  );
  const events = buildStandardTwoHourEvents(2);
  const created = createSession(2, 100000);
  assert.equal(sessionElapsed(created, 112000), 12);
  const paused = pauseSession(created, 112000, {
    eventId: "opening",
    positionSec: 8.4,
    chime: false,
  });
  assert.equal(sessionElapsed(paused, 122000), 12);
  assert.deepEqual(pauseSession(paused, 122000, null), paused);
  const resumed = resumeSession(paused, 122000);
  assert.equal(sessionElapsed(resumed, 123000), 13);
  assert.equal(resumed.pendingCue, null);
  assert.equal(resumed.accumulatedPausedMs, 10000);
  const cross = events.find((e) => e.id === "cross-rally");
  const pausedSeek = seekSession(paused, cross, events, 140000);
  assert.equal(pausedSeek.status, "paused");
  assert.equal(sessionElapsed(pausedSeek, 170000), 1200);
  assert.deepEqual(pausedSeek.pendingCue, {
    eventId: cross.id,
    positionSec: 0,
    chime: true,
  });
  const runningSeek = seekSession(resumed, cross, events, 170000);
  assert.equal(runningSeek.status, "running");
  assert.equal(runningSeek.pendingCue, null);
  assert.equal(sessionElapsed(runningSeek, 171000), 1201);
  const back = seekSession(runningSeek, events[1], events, 180000);
  assert.deepEqual(back.firedEventIds, ["opening", "volley"]);
  assert.equal(sessionElapsed(back, 181000), 301);
  assert.equal(
    seekSession(paused, events.at(-1), events, 190000).status,
    "completed",
  );
  const restored = restoreSession(paused, events, 200000);
  assert.equal(restored.status, "paused");
  assert.deepEqual(restored.pendingCue, paused.pendingCue);
  assert.equal(restored.courts, 2);
  const reloadRunning = restoreSession(
    { ...runningSeek, lastActiveAt: 171000 },
    events,
    200000,
  );
  assert.equal(reloadRunning.status, "paused");
  assert.equal(sessionElapsed(reloadRunning, 200000), 1201);
  assert.equal(reloadRunning.pendingCue.eventId, "cross-rally");
  for (const version of [1, 2, 3]) {
    const legacy = restoreSession(
      { ...created, version, lastActiveAt: undefined },
      events,
      150000,
    );
    assert.equal(legacy.status, "paused");
    assert.equal(legacy.version, 4);
    assert.equal(sessionElapsed(legacy, 250000), 50);
  }
  for (const raw of [
    null,
    {},
    { ...created, accumulatedPausedMs: -1 },
    { ...paused, pausedAt: NaN },
  ])
    assert.equal(restoreSession(raw, events, 200000), null);
  assert.equal(
    restoreSession({ ...created, status: "completed" }, events, 200000).status,
    "completed",
  );
  console.log(
    "PASS: unified clock/voice session, pause/resume, silent paused seek, backward seek, explicit restore and v1-v3 migration",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
