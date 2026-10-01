import type { AutoFlowEvent } from "./standardTwoHourFlow";
import { getAutoFlowElapsedSec } from "./standardTwoHourFlow";

export const SESSION_KEY = "will-standard-two-hour-auto-flow";
export const SESSION_SECONDS = 7200;
export type AutoStatus = "idle" | "running" | "paused" | "completed";
export type PendingCue = {
  eventId: string;
  positionSec: number;
  chime: boolean;
};
export type AutoSession = {
  version: 4;
  status: Exclude<AutoStatus, "idle">;
  startedAt: number;
  pausedAt: number | null;
  accumulatedPausedMs: number;
  firedEventIds: string[];
  courts: 1 | 2;
  pendingCue: PendingCue | null;
  lastActiveAt: number;
};

export function sessionElapsed(s: AutoSession, now: number): number {
  if (s.status === "completed") return SESSION_SECONDS;
  return Math.min(
    SESSION_SECONDS,
    getAutoFlowElapsedSec(
      s.startedAt,
      s.accumulatedPausedMs,
      now,
      s.status === "paused" ? s.pausedAt : null,
    ),
  );
}

export function createSession(courts: 1 | 2, now: number): AutoSession {
  return {
    version: 4,
    status: "running",
    startedAt: now,
    pausedAt: null,
    accumulatedPausedMs: 0,
    firedEventIds: ["opening"],
    courts,
    pendingCue: null,
    lastActiveAt: now,
  };
}

export function pauseSession(
  s: AutoSession,
  now: number,
  pendingCue: PendingCue | null,
): AutoSession {
  if (s.status !== "running") return s;
  return {
    ...s,
    status: "paused",
    pausedAt: now,
    pendingCue,
    lastActiveAt: now,
  };
}

export function resumeSession(s: AutoSession, now: number): AutoSession {
  if (s.status !== "paused" || s.pausedAt === null) return s;
  return {
    ...s,
    status: "running",
    pausedAt: null,
    pendingCue: null,
    accumulatedPausedMs: s.accumulatedPausedMs + Math.max(0, now - s.pausedAt),
    lastActiveAt: now,
  };
}

export function seekSession(
  s: AutoSession,
  event: AutoFlowEvent,
  events: AutoFlowEvent[],
  now: number,
): AutoSession {
  const completed = event.offsetSec >= SESSION_SECONDS;
  const status = completed
    ? "completed"
    : s.status === "running"
      ? "running"
      : "paused";
  return {
    ...s,
    status,
    startedAt: now - event.offsetSec * 1000,
    pausedAt: status === "paused" ? now : null,
    accumulatedPausedMs: 0,
    firedEventIds: events
      .filter((e) => e.offsetSec <= event.offsetSec)
      .map((e) => e.id),
    pendingCue:
      status === "paused" && event.audioSrc
        ? { eventId: event.id, positionSec: 0, chime: true }
        : null,
    lastActiveAt: now,
  };
}

/** Old saves remain readable. Reload never starts a voice or a clock unexpectedly. */
export function restoreSession(
  raw: unknown,
  events: AutoFlowEvent[],
  now: number,
): AutoSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<AutoSession> & { version?: number };
  if (
    ![1, 2, 3, 4].includes(Number(s.version)) ||
    !["running", "paused", "completed"].includes(String(s.status)) ||
    !Number.isFinite(s.startedAt) ||
    !Number.isFinite(s.accumulatedPausedMs) ||
    (s.accumulatedPausedMs ?? -1) < 0 ||
    !Array.isArray(s.firedEventIds) ||
    (s.status === "paused" &&
      (!Number.isFinite(s.pausedAt) || s.pausedAt! < s.startedAt!))
  )
    return null;
  const pauseAt =
    s.status === "paused"
      ? s.pausedAt!
      : Number.isFinite(s.lastActiveAt)
        ? Math.min(now, Math.max(s.startedAt!, s.lastActiveAt!))
        : now;
  const base: AutoSession = {
    version: 4,
    status: s.status === "completed" ? "completed" : "paused",
    startedAt: s.startedAt!,
    pausedAt: pauseAt,
    accumulatedPausedMs: s.accumulatedPausedMs!,
    courts: s.courts === 2 ? 2 : 1,
    firedEventIds: [],
    pendingCue: null,
    lastActiveAt: pauseAt,
  };
  const elapsed = sessionElapsed(base, now);
  if (elapsed >= SESSION_SECONDS)
    return {
      ...base,
      status: "completed",
      pausedAt: null,
      firedEventIds: events.map((e) => e.id),
    };
  const current =
    [...events].reverse().find((e) => e.offsetSec <= elapsed) ?? events[0];
  const pending = s.pendingCue;
  if (
    pending &&
    pending.eventId === current.id &&
    Number.isFinite(pending.positionSec) &&
    pending.positionSec >= 0
  ) {
    base.pendingCue = {
      eventId: pending.eventId,
      positionSec: pending.positionSec,
      chime: pending.chime === true,
    };
  } else if (s.status === "running" && current.audioSrc) {
    // A crashed/reloaded playback cannot preserve its media element. Retry only the current cue on explicit resume.
    base.pendingCue = { eventId: current.id, positionSec: 0, chime: false };
  }
  base.firedEventIds = events
    .filter((e) => e.offsetSec <= elapsed)
    .map((e) => e.id);
  return base;
}
