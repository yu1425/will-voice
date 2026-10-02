import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "will-transition-tests-"));
const originalWindow = globalThis.window;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const instances = [];
class TestAudio extends EventTarget {
  constructor(src) {
    super();
    this.src = src;
    this.currentTime = 0;
    this.volume = 1;
    this.muted = false;
    this.paused = true;
    this.calls = [];
    this.nextPlay = null;
    instances.push(this);
  }
  play() {
    this.paused = false;
    this.calls.push({
      position: this.currentTime,
      muted: this.muted,
      volume: this.volume,
    });
    const next = this.nextPlay;
    this.nextPlay = null;
    if (next instanceof Error) throw next;
    return next ?? Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

try {
  execFileSync("node", [
    "node_modules/typescript/bin/tsc",
    "lib/transitionCue.ts",
    "--outDir", temp,
    "--module", "commonjs",
    "--target", "ES2022",
    "--skipLibCheck",
  ]);
  const require = createRequire(import.meta.url);
  const {
    unlockTransitionCue,
    playTransitionCue,
    stopTransitionCue,
    setTransitionCueVolume,
  } = require(join(temp, "transitionCue.js"));
  const { setAudioVolume } = require(join(temp, "audioVolume.js"));

  delete globalThis.window;
  assert.equal(await unlockTransitionCue(), false);
  await playTransitionCue();
  stopTransitionCue();
  setTransitionCueVolume(0.5);
  assert.equal(instances.length, 0);
  globalThis.window = {};
  assert.equal(await unlockTransitionCue(), false);
  await playTransitionCue();

  globalThis.window = { Audio: TestAudio };
  assert.equal(await unlockTransitionCue(), true);
  const audio = instances[0];
  assert.equal(audio.src, "/audio/flow/v2/transition-scene-change07.mp3");
  assert.ok(statSync("public" + audio.src).size > 1000);
  assert.equal(audio.calls[0].muted, true);
  assert.equal(audio.paused, true);
  assert.equal(audio.muted, false);
  assert.equal(audio.currentTime, 0);

  setAudioVolume(0.3);
  let ended = false;
  const playback = playTransitionCue().then(() => { ended = true; });
  await Promise.resolve();
  assert.equal(ended, false, "the announcement must wait for the MP3 end");
  assert.equal(audio.calls.at(-1).muted, false);
  assert.equal(audio.volume, 0.3);
  audio.currentTime = 1.2;
  setTransitionCueVolume(0.2);
  assert.equal(audio.volume, 0.2);
  assert.equal(audio.currentTime, 1.2);
  assert.equal(audio.paused, false);
  for (const [input, expected] of [[-1, 0], [2, 1], [NaN, 1]]) {
    setTransitionCueVolume(input);
    assert.equal(audio.volume, expected);
  }
  audio.dispatchEvent(new Event("ended"));
  await playback;
  assert.equal(audio.paused, true);

  const interrupted = playTransitionCue();
  audio.currentTime = 2;
  stopTransitionCue();
  await interrupted;
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  const resumed = playTransitionCue();
  assert.equal(audio.calls.at(-1).position, 0);
  audio.dispatchEvent(new Event("ended"));
  await resumed;

  const oldPlay = deferred();
  audio.nextPlay = oldPlay.promise;
  const cancelled = playTransitionCue();
  const newer = playTransitionCue();
  await cancelled;
  oldPlay.reject(new Error("cancelled play"));
  await Promise.resolve();
  assert.equal(audio.paused, false, "a late rejection must not stop the newer cue");
  audio.dispatchEvent(new Event("ended"));
  await newer;

  const oldUnlock = deferred();
  audio.nextPlay = oldUnlock.promise;
  const unlocking = unlockTransitionCue();
  const afterUnlock = playTransitionCue();
  oldUnlock.resolve();
  assert.equal(await unlocking, false);
  assert.equal(audio.paused, false, "a stale unlock must not pause newer playback");
  assert.equal(audio.muted, false);
  audio.dispatchEvent(new Event("ended"));
  await afterUnlock;

  audio.nextPlay = Promise.reject(new Error("autoplay refused"));
  await playTransitionCue();
  assert.equal(audio.paused, true);
  audio.nextPlay = new Error("unsupported play");
  await playTransitionCue();
  assert.equal(audio.paused, true);
  const failed = playTransitionCue();
  audio.dispatchEvent(new Event("error"));
  await failed;
  assert.equal(audio.paused, true);
  audio.nextPlay = Promise.reject(new Error("unlock refused"));
  assert.equal(await unlockTransitionCue(), false);
  assert.equal(audio.muted, false);
  assert.equal(audio.paused, true);
  assert.equal(instances.length, 1, "timer playback reuses the unlocked audio element");

  console.log("PASS: MP3 path, SSR, silent unlock, ended ordering, volume, stop/restart, stale play/unlock races and playback errors");
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  rmSync(temp, { recursive: true, force: true });
}
