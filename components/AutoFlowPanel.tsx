"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntroTiming } from "@/lib/flowPlan";
import {
  STANDARD_TWO_HOUR_DURATION_SEC,
  buildStandardTwoHourEvents,
  eventAtElapsed,
  getAutoFlowElapsedSec,
  nextEventAtElapsed,
  type AutoFlowEvent,
} from "@/lib/standardTwoHourFlow";

const AUTO_FLOW_STORAGE_KEY = "will-standard-two-hour-auto-flow";
const AUTO_FLOW_VERSION = 1;

type AutoFlowStatus = "idle" | "running" | "paused" | "completed";

type SavedAutoFlow = {
  version: number;
  status: Exclude<AutoFlowStatus, "idle">;
  startedAt: number;
  pausedAt: number | null;
  accumulatedPausedMs: number;
  firedEventIds: string[];
  introTiming: IntroTiming;
};

type Props = {
  introTiming: IntroTiming;
  onSpeak: (text: string) => void;
  onSyncStep: (step: number) => void;
  onActiveChange: (active: boolean) => void;
};

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function readSavedAutoFlow(): SavedAutoFlow | null {
  try {
    const raw = window.localStorage.getItem(AUTO_FLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedAutoFlow>;
    if (
      parsed.version !== AUTO_FLOW_VERSION ||
      (parsed.status !== "running" && parsed.status !== "paused" && parsed.status !== "completed") ||
      !Number.isFinite(parsed.startedAt) ||
      !Number.isFinite(parsed.accumulatedPausedMs) ||
      !Array.isArray(parsed.firedEventIds) ||
      (parsed.introTiming !== "start" && parsed.introTiming !== "afterServe")
    ) {
      return null;
    }
    return {
      version: AUTO_FLOW_VERSION,
      status: parsed.status,
      startedAt: parsed.startedAt as number,
      pausedAt: typeof parsed.pausedAt === "number" ? parsed.pausedAt : null,
      accumulatedPausedMs: Math.max(0, parsed.accumulatedPausedMs as number),
      firedEventIds: parsed.firedEventIds.filter((id): id is string => typeof id === "string"),
      introTiming: parsed.introTiming,
    };
  } catch {
    return null;
  }
}

export default function AutoFlowPanel({
  introTiming,
  onSpeak,
  onSyncStep,
  onActiveChange,
}: Props) {
  const [status, setStatus] = useState<AutoFlowStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [accumulatedPausedMs, setAccumulatedPausedMs] = useState(0);
  const [firedEventIds, setFiredEventIds] = useState<string[]>([]);
  const [savedIntroTiming, setSavedIntroTiming] = useState<IntroTiming>(introTiming);
  const [elapsedSec, setElapsedSec] = useState(0);
  const restoredRef = useRef(false);
  const lastObservedAtRef = useRef<number | null>(null);

  const events = useMemo(
    () => buildStandardTwoHourEvents(savedIntroTiming),
    [savedIntroTiming]
  );
  const currentEvent = eventAtElapsed(events, elapsedSec);
  const nextEvent = nextEventAtElapsed(events, elapsedSec);
  const active = status === "running" || status === "paused";

  const persist = useCallback(
    (nextStatus: AutoFlowStatus, values: {
      startedAt: number | null;
      pausedAt: number | null;
      accumulatedPausedMs: number;
      firedEventIds: string[];
      introTiming: IntroTiming;
    }) => {
      try {
        if (nextStatus === "idle" || values.startedAt === null) {
          window.localStorage.removeItem(AUTO_FLOW_STORAGE_KEY);
          return;
        }
        const value: SavedAutoFlow = {
          version: AUTO_FLOW_VERSION,
          status: nextStatus,
          startedAt: values.startedAt,
          pausedAt: values.pausedAt,
          accumulatedPausedMs: values.accumulatedPausedMs,
          firedEventIds: values.firedEventIds,
          introTiming: values.introTiming,
        };
        window.localStorage.setItem(AUTO_FLOW_STORAGE_KEY, JSON.stringify(value));
      } catch {
        /* localStorage が使えない環境でも画面内の進行は継続する */
      }
    },
    []
  );

  const syncCurrentEvent = useCallback(
    (event: AutoFlowEvent) => {
      if (event.refStep) onSyncStep(event.refStep);
    },
    [onSyncStep]
  );

  // 復元時は現在地へ同期するだけで、過去の音声を流さない。
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = readSavedAutoFlow();
    if (!saved) return;

    const restoredEvents = buildStandardTwoHourEvents(saved.introTiming);
    const restoredElapsed = getAutoFlowElapsedSec(
      saved.startedAt,
      saved.accumulatedPausedMs,
      Date.now(),
      saved.status === "paused" ? saved.pausedAt : null
    );
    const completed = restoredElapsed >= STANDARD_TWO_HOUR_DURATION_SEC;
    const elapsed = Math.min(restoredElapsed, STANDARD_TWO_HOUR_DURATION_SEC);
    const completedEventIds = restoredEvents
      .filter((event) => event.offsetSec <= elapsed)
      .map((event) => event.id);
    const nextStatus: AutoFlowStatus = completed ? "completed" : saved.status;

    setStatus(nextStatus);
    setStartedAt(saved.startedAt);
    setPausedAt(nextStatus === "paused" ? saved.pausedAt : null);
    setAccumulatedPausedMs(saved.accumulatedPausedMs);
    setFiredEventIds(completedEventIds);
    setSavedIntroTiming(saved.introTiming);
    setElapsedSec(elapsed);
    syncCurrentEvent(eventAtElapsed(restoredEvents, elapsed));
    persist(nextStatus, {
      ...saved,
      pausedAt: nextStatus === "paused" ? saved.pausedAt : null,
      firedEventIds: completedEventIds,
    });
  }, [persist, syncCurrentEvent]);

  useEffect(() => {
    onActiveChange(active);
    return () => onActiveChange(false);
  }, [active, onActiveChange]);

  const advance = useCallback(
    (announce: boolean) => {
      if (status !== "running" || startedAt === null) return;
      const now = Date.now();
      const elapsed = Math.min(
        getAutoFlowElapsedSec(startedAt, accumulatedPausedMs, now),
        STANDARD_TWO_HOUR_DURATION_SEC
      );
      const dueEvents = events.filter(
        (event) => event.offsetSec <= elapsed && !firedEventIds.includes(event.id)
      );
      const canAnnounce = announce && dueEvents.length === 1;
      const latestDue = dueEvents[dueEvents.length - 1];
      const allFired = dueEvents.length
        ? [...firedEventIds, ...dueEvents.map((event) => event.id)]
        : firedEventIds;
      const completed = elapsed >= STANDARD_TWO_HOUR_DURATION_SEC;
      const nextStatus: AutoFlowStatus = completed ? "completed" : "running";

      setElapsedSec(elapsed);
      if (dueEvents.length) setFiredEventIds(allFired);
      if (latestDue) {
        syncCurrentEvent(latestDue);
        if (canAnnounce) onSpeak(latestDue.speakText);
      } else {
        syncCurrentEvent(eventAtElapsed(events, elapsed));
      }
      if (completed) setStatus("completed");
      persist(nextStatus, {
        startedAt,
        pausedAt: null,
        accumulatedPausedMs,
        firedEventIds: allFired,
        introTiming: savedIntroTiming,
      });
    },
    [
      accumulatedPausedMs,
      events,
      firedEventIds,
      onSpeak,
      persist,
      savedIntroTiming,
      startedAt,
      status,
      syncCurrentEvent,
    ]
  );

  useEffect(() => {
    if (status !== "running") return;
    lastObservedAtRef.current = Date.now();
    const tick = () => {
      const now = Date.now();
      const gap = now - (lastObservedAtRef.current ?? now);
      lastObservedAtRef.current = now;
      // バックグラウンド復帰後に古い案内を鳴らさない。
      advance(gap <= 15_000 && document.visibilityState === "visible");
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        lastObservedAtRef.current = Date.now();
        advance(false);
      }
    };
    const interval = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [advance, status]);

  const start = () => {
    const now = Date.now();
    const initialEvent = buildStandardTwoHourEvents(introTiming)[0];
    const initialFired = [initialEvent.id];
    setStatus("running");
    setStartedAt(now);
    setPausedAt(null);
    setAccumulatedPausedMs(0);
    setFiredEventIds(initialFired);
    setSavedIntroTiming(introTiming);
    setElapsedSec(0);
    syncCurrentEvent(initialEvent);
    persist("running", {
      startedAt: now,
      pausedAt: null,
      accumulatedPausedMs: 0,
      firedEventIds: initialFired,
      introTiming,
    });
    onSpeak(initialEvent.speakText);
  };

  const pause = () => {
    if (status !== "running" || startedAt === null) return;
    const now = Date.now();
    const nextElapsed = getAutoFlowElapsedSec(startedAt, accumulatedPausedMs, now);
    setElapsedSec(Math.min(nextElapsed, STANDARD_TWO_HOUR_DURATION_SEC));
    setStatus("paused");
    setPausedAt(now);
    persist("paused", {
      startedAt,
      pausedAt: now,
      accumulatedPausedMs,
      firedEventIds,
      introTiming: savedIntroTiming,
    });
  };

  const resume = () => {
    if (status !== "paused" || startedAt === null || pausedAt === null) return;
    const nextAccumulated = accumulatedPausedMs + (Date.now() - pausedAt);
    setAccumulatedPausedMs(nextAccumulated);
    setPausedAt(null);
    setStatus("running");
    persist("running", {
      startedAt,
      pausedAt: null,
      accumulatedPausedMs: nextAccumulated,
      firedEventIds,
      introTiming: savedIntroTiming,
    });
  };

  const end = () => {
    setStatus("idle");
    setStartedAt(null);
    setPausedAt(null);
    setAccumulatedPausedMs(0);
    setFiredEventIds([]);
    setSavedIntroTiming(introTiming);
    setElapsedSec(0);
    persist("idle", {
      startedAt: null,
      pausedAt: null,
      accumulatedPausedMs: 0,
      firedEventIds: [],
      introTiming,
    });
  };

  if (status === "idle") {
    return (
      <section className="auto-flow" aria-label="2時間 自動進行">
        <div className="auto-flow__intro">
          <span>2時間 自動進行</span>
          <small>標準メニューを時刻どおりに案内します</small>
        </div>
        <button type="button" className="auto-flow__start" onClick={start}>
          ▶ 2時間進行を開始
        </button>
      </section>
    );
  }

  const remaining = nextEvent
    ? Math.max(0, nextEvent.offsetSec - elapsedSec)
    : 0;
  const isCompleted = status === "completed";
  return (
    <section className="auto-flow auto-flow--active" aria-live="polite">
      <div className="auto-flow__status">
        {isCompleted ? "自動進行 完了" : status === "paused" ? "自動進行 一時停止中" : "自動進行中"}
      </div>
      <div className="auto-flow__current-label">現在</div>
      <h2 className="auto-flow__title">{currentEvent.title}</h2>
      <div className="auto-flow__elapsed">
        {formatClock(elapsedSec)} <span>/ 02:00:00</span>
      </div>
      {nextEvent ? (
        <div className="auto-flow__next">
          <span>次</span>
          <strong>{formatClock(nextEvent.offsetSec).slice(0, 5)} {nextEvent.title}</strong>
          <em>あと {formatClock(remaining)}</em>
        </div>
      ) : (
        <p className="auto-flow__next">全メニューが完了しました</p>
      )}
      <div className="auto-flow__actions">
        {!isCompleted && (
          <button type="button" className="auto-flow__action auto-flow__action--pause" onClick={status === "paused" ? resume : pause}>
            {status === "paused" ? "▶ 進行を再開" : "Ⅱ 進行を一時停止"}
          </button>
        )}
        <button type="button" className="auto-flow__action" onClick={() => onSpeak(currentEvent.speakText)}>
          🔊 今の案内をもう一度再生
        </button>
        <button type="button" className="auto-flow__end" onClick={isCompleted ? start : end}>
          {isCompleted ? "新しい進行を開始" : "自動進行を終了"}
        </button>
      </div>
      <p className="auto-flow__hint">進行の一時停止は時計を止めます。音声の一時停止とは別の操作です。</p>
    </section>
  );
}
