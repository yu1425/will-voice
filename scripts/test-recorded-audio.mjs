import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../lib/recordedAudio.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

let audioInstances = 0;
let playOutcomes = [];
let playCalls = 0;
const audios = [];
let rejectDeferred;
class MockAudio {
  constructor() {
    audioInstances += 1;
    audios.push(this);
    this.preload = "";
    this.src = "";
    this.currentSrc = "";
    this.volume = 1;
    this.currentTime = 0;
    this.duration = 60;
    this.readyState = 4;
    this.networkState = 1;
    this.error = null;
    this.ended = false;
    this.paused = true;
    this.onended = null;
    this.onerror = null;
    this.onloadedmetadata = null;
  }
  load() {
    this.currentSrc = this.src;
  }
  pause() {
    this.paused = true;
  }
  play() {
    playCalls += 1;
    const outcome = playOutcomes.shift() ?? "resolve";
    if (outcome === "deferred")
      return new Promise((resolve, reject) => {
        rejectDeferred = reject;
      });
    if (outcome === "reject") {
      this.paused = true;
      return Promise.reject(
        new DOMException("simulated transient failure", "AbortError"),
      );
    }
    this.paused = false;
    return Promise.resolve();
  }
}
Object.defineProperty(globalThis, "Audio", {
  value: MockAudio,
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: { visibilityState: "visible" },
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    dispatchEvent: (event) => events.push(event.detail),
  },
  configurable: true,
});
const events = [];
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options) {
    this.type = type;
    this.detail = options.detail;
  }
};

const module = { exports: {} };
const fakeRequire = (id) => {
  if (id === "./audioVolume") {
    return {
      clampAudioVolume: (value) => Math.max(0, Math.min(1, value)),
      getAudioVolume: () => 1,
    };
  }
  throw new Error(`Unexpected require: ${id}`);
};
new Function("require", "module", "exports", compiled)(
  fakeRequire,
  module,
  module.exports,
);
const api = module.exports;
const waitForRetry = () => new Promise((resolve) => setTimeout(resolve, 20));
storage.clear();
playOutcomes = ["reject", "resolve"];
let transientErrors = 0;
api.playRecordedAudio("/audio/flow/v2/43-game-rules.wav", {
  onError: () => {
    transientErrors += 1;
  },
});
await waitForRetry();

assert.equal(playCalls, 2);
assert.equal(transientErrors, 0);
assert.equal(audioInstances, 1);
let diagnostics = JSON.parse(
  localStorage.getItem("will-recorded-audio-diagnostics") ?? "[]",
);
assert.equal(diagnostics.length, 2);
assert.equal(diagnostics[0].attempt, 1);
assert.equal(diagnostics[0].reason, "play-rejected");
assert.equal(diagnostics[0].errorName, "AbortError");
assert.deepEqual(
  diagnostics.map((entry) => entry.type),
  ["retry", "recovery"],
);
assert.deepEqual(
  events.map((entry) => entry.type),
  ["retry", "retry", "recovery"],
);
assert.equal(events[1].retryStarted, true);
api.stopRecordedAudio();

storage.clear();
playOutcomes = ["reject", "reject"];
let persistentErrors = 0;
api.playRecordedAudio("/audio/flow/v2/44-self-intro.wav", {
  onError: () => {
    persistentErrors += 1;
  },
});
await waitForRetry();

assert.equal(playCalls, 4);
assert.equal(persistentErrors, 1);
assert.equal(audioInstances, 1);
diagnostics = JSON.parse(
  localStorage.getItem("will-recorded-audio-diagnostics") ?? "[]",
);
assert.deepEqual(
  diagnostics.map((entry) => entry.attempt),
  [1, 2],
);
assert.ok(
  diagnostics.every((entry) => entry.src.endsWith("44-self-intro.wav")),
);
assert.deepEqual(
  diagnostics.map((entry) => entry.type),
  ["retry", "final-failure"],
);
storage.clear();
playOutcomes = ["deferred", "resolve"];
let staleErrors = 0;
api.playRecordedAudio("/audio/flow/v2/43-game-rules.wav", {
  onError: () => staleErrors++,
});
audios[0].onerror();
await waitForRetry();
rejectDeferred(
  new DOMException("old attempt aborted during reload", "AbortError"),
);
await waitForRetry();
assert.equal(staleErrors, 0);
assert.deepEqual(
  api.getRecordedAudioDiagnostics().map((entry) => entry.type),
  ["retry", "recovery"],
);
api.stopRecordedAudio();
// Cancel during the retry delay; a stale retry cannot play or report recovery.
storage.clear();
playOutcomes = ["reject", "resolve"];
api.playRecordedAudio("/audio/flow/v2/00-opening.wav");
await Promise.resolve();
api.stopRecordedAudio();
const beforeCancel = playCalls;
await waitForRetry();
assert.equal(playCalls, beforeCancel);
assert.equal(
  api.getRecordedAudioDiagnostics().some((entry) => entry.type === "recovery"),
  false,
);
// Legacy entries are readable, corrupt entries are ignored, and recording repairs malformed JSON.
localStorage.setItem(
  "will-recorded-audio-diagnostics",
  JSON.stringify([
    diagnostics[0],
    null,
    {},
    { ...diagnostics[1], type: undefined, version: undefined },
  ]),
);
assert.equal(api.getRecordedAudioDiagnostics().length, 2);
assert.equal(api.getRecordedAudioDiagnostics()[1].type, "final-failure");
localStorage.setItem("will-recorded-audio-diagnostics", "broken");
assert.deepEqual(api.getRecordedAudioDiagnostics(), []);
playOutcomes = ["reject", "resolve"];
api.playRecordedAudio("/audio/flow/v2/00-opening.wav");
await waitForRetry();
assert.equal(api.getRecordedAudioDiagnostics().length, 2);
assert.equal(api.clearRecordedAudioDiagnostics(), true);
assert.deepEqual(api.getRecordedAudioDiagnostics(), []);
api.stopRecordedAudio();
for (let index = 0; index < 12; index++) {
  playOutcomes = ["reject", "resolve"];
  api.playRecordedAudio("/audio/flow/v2/voice-test.wav");
  await waitForRetry();
  api.stopRecordedAudio();
}
assert.equal(api.getRecordedAudioDiagnostics().length, 20);
window.localStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};
assert.deepEqual(api.getRecordedAudioDiagnostics(), []);
assert.equal(api.clearRecordedAudioDiagnostics(), false);
playOutcomes = ["reject", "resolve"];
const beforeBlocked = events.length;
api.playRecordedAudio("/audio/flow/v2/voice-test.wav");
await waitForRetry();
assert.deepEqual(
  events.slice(beforeBlocked).map((entry) => entry.type),
  ["retry", "retry", "recovery"],
);
api.stopRecordedAudio();

console.log(
  "PASS: recorded audio reuses one playback element, retries one transient failure, logs diagnostics, and surfaces persistent failure",
);
