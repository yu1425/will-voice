import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const compiled = ts.transpileModule(
  readFileSync("lib/flowRunHistory.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
function fresh() {
  const module = { exports: {} };
  new Function("module", "exports", compiled)(module, module.exports);
  return module.exports;
}
let api = fresh();
let run = api.startFlowRun(2, 1000);
api.pauseFlowRun(run.id, "manual", 11000);
api.pauseFlowRun(run.id, "manual", 21000);
api.resumeFlowRun(run.id, 31000);
api.countFlowRun(run.id, "seekCount", 32000);
api.countFlowRun(run.id, "audioRetryCount", 33000);
api.countFlowRun(run.id, "audioRecoveryCount", 34000);
api.pauseFlowRun(run.id, "visibility", 35000);
// A reload reads the same active run and does not count the paused interval.
api = fresh();
assert.equal(api.getActiveFlowRun().id, run.id);
api.resumeFlowRun(run.id, 41000);
api.pauseFlowRun(run.id, "navigation", 42000);
api.resumeFlowRun(run.id, 43000);
api.countFlowRun(run.id, "audioFinalFailureCount", 44000);
api.pauseFlowRun(run.id, "audio-error", 44000);
api.finishFlowRun(run.id, true, 45000);
api.finishFlowRun(run.id, true, 46000);
const history = api.getFlowRunHistory();
assert.equal(history.length, 1);
assert.equal(history[0].completedNormally, true);
assert.equal(history[0].status, "completed");
assert.equal(history[0].manualPauseCount, 1);
assert.equal(history[0].safetyPauseCount, 3);
assert.equal(history[0].seekCount, 1);
assert.equal(history[0].audioRetryCount, 1);
assert.equal(history[0].audioRecoveryCount, 1);
assert.equal(history[0].audioFinalFailureCount, 1);
assert.equal(history[0].actualDurationSec, 16);
assert.deepEqual(history[0].pauseReasons, {
  manual: 1,
  visibility: 1,
  navigation: 1,
  "audio-error": 1,
});
assert.equal(fresh().getFlowRunHistory()[0].id, run.id);
for (let i = 0; i < 25; i++) {
  run = api.startFlowRun(1, 50000 + i * 1000);
  api.finishFlowRun(run.id, false, 50500 + i * 1000);
}
assert.equal(api.getFlowRunHistory().length, 20);
assert.equal(api.getFlowRunHistory()[0].completedNormally, false);
assert.equal(api.getFlowRunHistory()[0].status, "ended");
assert.equal(api.clearFlowRunHistory(), true);
assert.equal(fresh().getFlowRunHistory().length, 0);
for (const corrupt of ["broken", "{}", '[null,{"id":"invalid"}]']) {
  storage.set(api.FLOW_HISTORY_KEY, corrupt);
  storage.set(api.FLOW_ACTIVE_RUN_KEY, corrupt);
  assert.deepEqual(fresh().getFlowRunHistory(), []);
  assert.equal(fresh().getActiveFlowRun(), null);
}
globalThis.localStorage = {
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
api = fresh();
run = api.startFlowRun(1, 1000);
api.finishFlowRun(run.id, false, 2000);
assert.equal(api.getFlowRunHistory().length, 1);
assert.equal(api.clearFlowRunHistory(), false);
console.log(
  "PASS: completion/end, all pause reasons, seek/audio counts, actual duration, reload identity, idempotence, 20-run cap, corrupt/blocked storage",
);
