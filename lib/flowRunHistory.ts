export const FLOW_HISTORY_KEY = "will-flow-run-history";
export const FLOW_ACTIVE_RUN_KEY = "will-flow-active-run";
export const FLOW_HISTORY_EVENT = "will-flow-run-history-changed";
export type PauseReason =
  | "manual"
  | "visibility"
  | "navigation"
  | "audio-error";
export type FlowRun = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  status: "running" | "paused" | "completed" | "ended";
  courts: 1 | 2;
  actualDurationSec: number;
  manualPauseCount: number;
  safetyPauseCount: number;
  pauseReasons: Record<PauseReason, number>;
  seekCount: number;
  audioRetryCount: number;
  audioRecoveryCount: number;
  audioFinalFailureCount: number;
  completedNormally: boolean;
  runningSince: number | null;
};
let active: FlowRun | null | undefined;
let history: FlowRun[] | undefined;
const counterKeys = [
  "actualDurationSec",
  "manualPauseCount",
  "safetyPauseCount",
  "seekCount",
  "audioRetryCount",
  "audioRecoveryCount",
  "audioFinalFailureCount",
] as const;
function valid(value: unknown): value is FlowRun {
  if (!value || typeof value !== "object") return false;
  const run = value as FlowRun;
  return (
    typeof run.id === "string" &&
    Number.isFinite(run.startedAt) &&
    (run.endedAt === null || Number.isFinite(run.endedAt)) &&
    ["running", "paused", "completed", "ended"].includes(run.status) &&
    [1, 2].includes(run.courts) &&
    typeof run.completedNormally === "boolean" &&
    (run.runningSince === null || Number.isFinite(run.runningSince)) &&
    counterKeys.every((key) => Number.isFinite(run[key]) && run[key] >= 0) &&
    run.pauseReasons != null &&
    ["manual", "visibility", "navigation", "audio-error"].every(
      (key) =>
        Number.isFinite(run.pauseReasons[key as PauseReason]) &&
        run.pauseReasons[key as PauseReason] >= 0,
    )
  );
}
function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function changed() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(FLOW_HISTORY_EVENT));
}
function saveActive(run: FlowRun | null) {
  active = run;
  write(FLOW_ACTIVE_RUN_KEY, run);
}
export function getActiveFlowRun(): FlowRun | null {
  if (active === undefined) {
    const raw = read(FLOW_ACTIVE_RUN_KEY);
    active = valid(raw) ? raw : null;
  }
  return active;
}
export function getFlowRunHistory(): FlowRun[] {
  if (!history) {
    const raw = read(FLOW_HISTORY_KEY);
    history = Array.isArray(raw) ? raw.filter(valid).slice(-20) : [];
  }
  return [...history];
}
export function clearFlowRunHistory(): boolean {
  history = [];
  const saved = write(FLOW_HISTORY_KEY, []);
  changed();
  return saved;
}
export function startFlowRun(courts: 1 | 2, now: number): FlowRun {
  const run: FlowRun = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${now}-${Math.random().toString(36).slice(2)}`,
    startedAt: now,
    endedAt: null,
    courts,
    status: "running",
    actualDurationSec: 0,
    manualPauseCount: 0,
    safetyPauseCount: 0,
    seekCount: 0,
    audioRetryCount: 0,
    audioRecoveryCount: 0,
    audioFinalFailureCount: 0,
    completedNormally: false,
    pauseReasons: { manual: 0, visibility: 0, navigation: 0, "audio-error": 0 },
    runningSince: now,
  };
  saveActive(run);
  return run;
}
function update(
  id: string | undefined,
  now: number,
  mutate: (run: FlowRun) => FlowRun,
): void {
  const run = getActiveFlowRun();
  if (!run || run.id !== id) return;
  saveActive(
    mutate({
      ...run,
      pauseReasons: { ...run.pauseReasons },
      actualDurationSec:
        run.actualDurationSec +
        (run.runningSince === null
          ? 0
          : Math.max(0, now - run.runningSince) / 1000),
      runningSince: run.status === "running" ? now : null,
    }),
  );
}
export function checkpointFlowRun(id: string | undefined, now: number) {
  update(id, now, (run) => run);
}
export function pauseFlowRun(
  id: string | undefined,
  reason: PauseReason,
  now: number,
) {
  update(id, now, (run) => {
    if (run.status !== "running") return run;
    run.pauseReasons[reason]++;
    if (reason === "manual") run.manualPauseCount++;
    else run.safetyPauseCount++;
    return { ...run, status: "paused", runningSince: null };
  });
}
export function resumeFlowRun(id: string | undefined, now: number) {
  update(id, now, (run) => ({ ...run, status: "running", runningSince: now }));
}
export function countFlowRun(
  id: string | undefined,
  counter:
    | "seekCount"
    | "audioRetryCount"
    | "audioRecoveryCount"
    | "audioFinalFailureCount",
  now: number,
) {
  update(id, now, (run) => ({ ...run, [counter]: run[counter] + 1 }));
}
export function finishFlowRun(
  id: string | undefined,
  completedNormally: boolean,
  now: number,
) {
  checkpointFlowRun(id, now);
  const run = getActiveFlowRun();
  if (!run || run.id !== id) return;
  const ended: FlowRun = {
    ...run,
    endedAt: now,
    status: completedNormally ? "completed" : "ended",
    completedNormally,
    runningSince: null,
  };
  history = [
    ...getFlowRunHistory().filter((item) => item.id !== id),
    ended,
  ].slice(-20);
  write(FLOW_HISTORY_KEY, history);
  saveActive(null);
  changed();
}
