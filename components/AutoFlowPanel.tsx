"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlowConditions } from "@/lib/flowPlan";
import { FLOW_VOICE_TEST } from "@/lib/flowScripts";
import { preloadRecordedAudio } from "@/lib/recordedAudio";
import {
  buildStandardTwoHourEvents,
  eventAtElapsed,
  getAutoFlowElapsedSec,
  getAutoFlowProgress,
  nextEventAtElapsed,
  type AutoFlowEvent,
} from "@/lib/standardTwoHourFlow";
import {
  playTransitionCue,
  stopTransitionCue,
  unlockTransitionCue,
} from "@/lib/transitionCue";

const STATE_KEY = "will-standard-two-hour-auto-flow";
const SETTINGS_KEY = "will-standard-two-hour-auto-flow-settings";
export type AutoStatus = "idle" | "running" | "paused" | "completed";
type Session = {
  version: 3;
  status: Exclude<AutoStatus, "idle">;
  startedAt: number;
  pausedAt: number | null;
  accumulatedPausedMs: number;
  firedEventIds: string[];
  courts: 1 | 2;
};
type Props = {
  active: boolean;
  conditions: FlowConditions;
  onConditionsChange: (c: FlowConditions) => void;
  onSpeak: (text: string, audioSrc?: string) => void;
  onStopSpeaking: () => void;
  isSpeaking: boolean;
  onSyncStep: (step: number) => void;
  onStatusChange: (status: AutoStatus) => void;
};
export function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
function formatOffset(seconds: number) {
  return formatClock(seconds).slice(0, 5);
}
function timeOfDay(time: number) {
  return new Date(time).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function showProgress() {
  document.querySelector(".flow-scroll")?.scrollTo({ top: 0 });
}
function restore(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
    if (
      !s ||
      ![1, 2, 3].includes(s.version) ||
      !["running", "paused", "completed"].includes(s.status) ||
      !Number.isFinite(s.startedAt) ||
      !Number.isFinite(s.accumulatedPausedMs) ||
      s.accumulatedPausedMs < 0 ||
      !Array.isArray(s.firedEventIds) ||
      (s.status === "paused" &&
        (!Number.isFinite(s.pausedAt) || s.pausedAt < s.startedAt))
    )
      return null;
    return { ...s, version: 3, courts: s.courts === 2 ? 2 : 1 };
  } catch {
    return null;
  }
}

export default function AutoFlowPanel({
  active,
  conditions,
  onConditionsChange,
  onSpeak,
  onStopSpeaking,
  isSpeaking,
  onSyncStep,
  onStatusChange,
}: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [chimeEnabled, setChimeEnabled] = useState(true);
  const [cuePlaying, setCuePlaying] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<AutoFlowEvent | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const sequence = useRef(0);
  const mounted = useRef(true);
  const observed = useRef(Date.now());
  const events = useMemo(
    () => buildStandardTwoHourEvents(session?.courts ?? conditions.courts),
    [session?.courts, conditions.courts],
  );
  const current = eventAtElapsed(events, elapsedSec);
  const next = nextEventAtElapsed(events, elapsedSec);
  const status = session?.status ?? "idle";
  const save = useCallback((s: Session | null) => {
    sessionRef.current = s;
    setSession(s);
    try {
      if (s) localStorage.setItem(STATE_KEY, JSON.stringify(s));
      else localStorage.removeItem(STATE_KEY);
    } catch {
      /* storage may be unavailable */
    }
  }, []);
  const cancel = useCallback(() => {
    sequence.current++;
    stopTransitionCue();
    setCuePlaying(false);
  }, []);
  const stopAudio = useCallback(() => {
    cancel();
    onStopSpeaking();
  }, [cancel, onStopSpeaking]);
  const announce = useCallback(
    async (e: AutoFlowEvent, cue: boolean) => {
      cancel();
      onStopSpeaking();
      if (!e.audioSrc || !activeRef.current) return;
      const ticket = sequence.current;
      if (cue && chimeEnabled) {
        setCuePlaying(true);
        await playTransitionCue();
        if (ticket !== sequence.current || !mounted.current) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
      }
      if (ticket !== sequence.current || !mounted.current || !activeRef.current)
        return;
      setCuePlaying(false);
      onSpeak(e.voiceText, e.audioSrc);
    },
    [cancel, onSpeak, onStopSpeaking, chimeEnabled],
  );
  const advance = useCallback(
    (allowAudio: boolean) => {
      const s = sessionRef.current;
      if (!s || s.status !== "running") return;
      const elapsed = Math.min(
        7200,
        getAutoFlowElapsedSec(s.startedAt, s.accumulatedPausedMs, Date.now()),
      );
      const due = events.filter(
        (e) => e.offsetSec <= elapsed && !s.firedEventIds.includes(e.id),
      );
      setElapsedSec(elapsed);
      if (activeRef.current) {
        const e = eventAtElapsed(events, elapsed);
        if (e.refStep) onSyncStep(e.refStep);
      }
      if (due.length || elapsed === 7200)
        save({
          ...s,
          status: elapsed === 7200 ? "completed" : "running",
          firedEventIds: [...s.firedEventIds, ...due.map((e) => e.id)],
        });
      if (elapsed === 7200) {
        stopAudio();
        return;
      }
      // Missed announcements are consumed, never queued after a background gap.
      if (activeRef.current && allowAudio && due.length === 1)
        void announce(due[0], true);
    },
    [events, onSyncStep, save, announce, stopAudio],
  );

  useEffect(() => {
    mounted.current = true;
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      if (typeof settings.chimeEnabled === "boolean")
        setChimeEnabled(settings.chimeEnabled);
    } catch {
      /* no-op */
    }
    const stored = restore();
    if (stored) {
      const elapsed =
        stored.status === "completed"
          ? 7200
          : Math.min(
              7200,
              getAutoFlowElapsedSec(
                stored.startedAt,
                stored.accumulatedPausedMs,
                Date.now(),
                stored.status === "paused" ? stored.pausedAt : null,
              ),
            );
      const restoredEvents = buildStandardTwoHourEvents(stored.courts);
      save({
        ...stored,
        status: elapsed === 7200 ? "completed" : stored.status,
        firedEventIds: restoredEvents
          .filter((e) => e.offsetSec <= elapsed)
          .map((e) => e.id),
      });
      setElapsedSec(elapsed);
    }
    return () => {
      mounted.current = false;
      sequence.current++;
      stopTransitionCue();
    };
  }, [save]);
  useEffect(() => {
    const leave = () => {
      activeRef.current = false;
      stopAudio();
    };
    window.addEventListener("will-flow-leave", leave);
    return () => window.removeEventListener("will-flow-leave", leave);
  }, [stopAudio]);
  useEffect(() => onStatusChange(status), [onStatusChange, status]);
  useEffect(() => {
    if (active && status !== "idle" && current.refStep)
      onSyncStep(current.refStep);
  }, [active, status, current.refStep, onSyncStep]);
  useEffect(() => {
    if (pendingSeek)
      document
        .querySelector(".flow-seek-confirm")
        ?.scrollIntoView({ block: "center" });
  }, [pendingSeek]);
  useEffect(() => {
    if (
      session &&
      status !== "completed" &&
      conditions.courts !== session.courts
    )
      onConditionsChange({ ...conditions, courts: session.courts });
  }, [session, conditions, onConditionsChange, status]);
  useEffect(() => {
    preloadRecordedAudio(current.audioSrc);
    preloadRecordedAudio(next?.audioSrc);
  }, [current.audioSrc, next?.audioSrc]);
  useEffect(() => {
    setPendingSeek(null);
    if (!active) stopAudio();
    else advance(false);
  }, [active, advance, stopAudio]);
  useEffect(() => {
    if (status !== "running") return;
    observed.current = Date.now();
    const tick = () => {
      const now = Date.now();
      const gap = now - observed.current;
      observed.current = now;
      advance(gap < 2500 && document.visibilityState === "visible");
    };
    const visibility = () => {
      observed.current = Date.now();
      if (document.visibilityState === "visible") advance(false);
      else stopAudio();
    };
    const id = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [status, advance, stopAudio]);

  const start = async () => {
    stopAudio();
    const ticket = sequence.current;
    await unlockTransitionCue();
    if (ticket !== sequence.current || !mounted.current || !activeRef.current)
      return;
    const first = buildStandardTwoHourEvents(conditions.courts)[0];
    save({
      version: 3,
      status: "running",
      startedAt: Date.now(),
      pausedAt: null,
      accumulatedPausedMs: 0,
      firedEventIds: [first.id],
      courts: conditions.courts,
    });
    setElapsedSec(0);
    showProgress();
    onSyncStep(first.refStep!);
    onSpeak(first.voiceText, first.audioSrc);
  };
  const pauseResume = () => {
    const s = sessionRef.current;
    if (!s || s.status === "completed") return;
    if (s.status === "running") {
      stopAudio();
      const now = Date.now();
      setElapsedSec(
        Math.min(
          7200,
          getAutoFlowElapsedSec(s.startedAt, s.accumulatedPausedMs, now),
        ),
      );
      save({ ...s, status: "paused", pausedAt: now });
    } else if (s.pausedAt !== null)
      save({
        ...s,
        status: "running",
        pausedAt: null,
        accumulatedPausedMs: s.accumulatedPausedMs + Date.now() - s.pausedAt,
      });
  };
  const seek = (e: AutoFlowEvent) => {
    stopAudio();
    const now = Date.now();
    const nextStatus =
      e.offsetSec === 7200
        ? "completed"
        : sessionRef.current?.status === "paused"
          ? "paused"
          : "running";
    save({
      version: 3,
      status: nextStatus,
      startedAt: now - e.offsetSec * 1000,
      pausedAt: nextStatus === "paused" ? now : null,
      accumulatedPausedMs: 0,
      courts: session?.courts ?? conditions.courts,
      firedEventIds: events
        .filter((x) => x.offsetSec <= e.offsetSec)
        .map((x) => x.id),
    });
    setElapsedSec(e.offsetSec);
    showProgress();
    setPendingSeek(null);
    if (e.refStep) onSyncStep(e.refStep);
    void announce(e, true);
  };
  const testCue = async () => {
    stopAudio();
    const ticket = sequence.current;
    await unlockTransitionCue();
    if (ticket !== sequence.current || !mounted.current || !activeRef.current)
      return;
    setCuePlaying(true);
    await playTransitionCue();
    if (ticket === sequence.current && mounted.current) setCuePlaying(false);
  };
  const afterNext = next
    ? events.find((event) => event.offsetSec > next.offsetSec)
    : null;
  const progress = getAutoFlowProgress(elapsedSec);

  if (status === "idle")
    return (
      <section className="flow-surface auto-flow" aria-label="自動進行">
        <header className="flow-header">
          <div>
            <p className="flow-eyebrow">STANDARD SESSION</p>
            <h1>自動進行</h1>
          </div>
          <span className="flow-status">標準2時間</span>
        </header>
        <p className="flow-lead">
          開始すると、標準2時間メニューに沿ってチャイムと音声案内が自動で流れます。
        </p>
        <div className="flow-setting">
          <span>コート数</span>
          <div className="flow-choice" aria-label="コート数">
            {([1, 2] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={conditions.courts === c}
                onClick={() => onConditionsChange({ ...conditions, courts: c })}
              >
                {c}面
              </button>
            ))}
          </div>
        </div>
        <div className="flow-setting">
          <label>
            <input
              type="checkbox"
              checked={chimeEnabled}
              onChange={(e) => {
                setChimeEnabled(e.target.checked);
                try {
                  localStorage.setItem(
                    SETTINGS_KEY,
                    JSON.stringify({ chimeEnabled: e.target.checked }),
                  );
                } catch {
                  /* no-op */
                }
              }}
            />{" "}
            チャイム {chimeEnabled ? "ON" : "OFF"}
          </label>
          <button
            type="button"
            className="flow-btn"
            onClick={() => void testCue()}
          >
            試聴
          </button>
        </div>
        <div className="flow-actions">
          <button
            type="button"
            className="flow-btn"
            onClick={() =>
              onSpeak(FLOW_VOICE_TEST.displayText, FLOW_VOICE_TEST.audioSrc)
            }
          >
            音声テスト
          </button>
          <button
            type="button"
            className="flow-btn"
            onClick={stopAudio}
            disabled={!isSpeaking && !cuePlaying}
          >
            音声を止める
          </button>
          <button
            type="button"
            className="flow-btn flow-btn--primary flow-btn--full"
            onClick={() => void start()}
          >
            自動進行を開始
          </button>
        </div>
        <p className="flow-help">
          <Link
            href="/guide"
            onClick={() => {
              activeRef.current = false;
              stopAudio();
            }}
          >
            初めて使う方へ → 使い方
          </Link>
          <span>全体の自己紹介は、ゲーム前に行います。</span>
        </p>
        <details className="flow-overview">
          <summary>全体の流れを見る</summary>
          <p className="flow-muted">開始からの経過時間 · 標準2時間</p>
          <Timeline events={events} currentId={null} elapsedSec={0} />
        </details>
      </section>
    );
  return (
    <section className="auto-flow" aria-label="自動進行">
      <div className="flow-surface flow-progress">
        <header className="flow-header">
          <span className="flow-eyebrow">自動進行 · {session?.courts}面</span>
          <span className={`flow-status flow-status--${status}`} role="status">
            {status === "paused"
              ? "一時停止中"
              : status === "completed"
                ? "進行完了"
                : "進行中"}
          </span>
        </header>
        <h1>{current.title}</h1>
        <div className="flow-progress__clock">
          <strong>{formatClock(elapsedSec)}</strong>
          <span> / 02:00:00</span>
        </div>
        <div className="flow-progress__numbers">
          <span>
            進行 <strong>{progress.percentage}%</strong>
          </span>
          <span>残り {formatClock(progress.remainingSec)}</span>
        </div>
        <div
          className="flow-progress__bar"
          role="progressbar"
          aria-label="2時間の進捗"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percentage}
        >
          <span style={{ width: `${(elapsedSec / 7200) * 100}%` }} />
        </div>
        {next && (
          <div className="flow-progress__next">
            <div>
              <span>次</span>
              <strong>
                {formatOffset(next.offsetSec)} {next.title}
              </strong>
            </div>
            <div>
              <span>あと</span>
              <strong>
                {formatClock(next.offsetSec - elapsedSec).slice(3)}
              </strong>
            </div>
          </div>
        )}
        {afterNext && (
          <div className="flow-progress__later">
            <span>その次</span>
            <strong>
              {formatOffset(afterNext.offsetSec)} {afterNext.title}
            </strong>
          </div>
        )}
        <div className="flow-progress__times">
          <span>開始 {timeOfDay(session!.startedAt)}</span>
          <span>
            {status === "paused" ? "終了予定（一時停止中）" : "終了予定"}{" "}
            {timeOfDay(
              session!.startedAt +
                session!.accumulatedPausedMs +
                (session!.pausedAt ? Date.now() - session!.pausedAt : 0) +
                7200000,
            )}
          </span>
        </div>
        <div className="flow-controls">
          <div className="flow-actions">
            <button
              type="button"
              className="flow-btn flow-btn--primary flow-btn--full"
              disabled={status === "completed"}
              onClick={pauseResume}
            >
              {status === "paused" ? "進行を再開" : "進行を一時停止"}
            </button>
            <button
              type="button"
              className="flow-btn"
              onClick={() => void announce(current, false)}
              disabled={!current.audioSrc}
            >
              もう一度聞く
            </button>
            <button
              type="button"
              className="flow-btn"
              onClick={stopAudio}
              disabled={!isSpeaking && !cuePlaying}
            >
              音声を止める
            </button>
          </div>
          <p className="flow-audio-state" role="status">
            {cuePlaying
              ? "チャイムを再生中"
              : isSpeaking
                ? "音声案内を再生中"
                : "音声は再生していません"}
          </p>
          <details className="flow-script">
            <summary>案内内容を見る</summary>
            <p>{current.displayText}</p>
          </details>
        </div>
      </div>
      <details className="flow-overview">
        <summary>全体の流れを見る</summary>
        <p className="flow-muted">開始からの経過時間 · タップして移動</p>
        {pendingSeek && (
          <div className="flow-seek-confirm" role="alert">
            <p>
              {formatOffset(pendingSeek.offsetSec)} {pendingSeek.title}
              へ移動しますか？
            </p>
            <div className="flow-actions">
              <button
                type="button"
                className="flow-btn flow-btn--primary"
                onClick={() => seek(pendingSeek)}
              >
                移動して案内
              </button>
              <button
                type="button"
                className="flow-btn"
                onClick={() => setPendingSeek(null)}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
        <Timeline
          events={events}
          currentId={current.id}
          elapsedSec={elapsedSec}
          onSeek={(e) => (status === "running" ? setPendingSeek(e) : seek(e))}
        />
      </details>
      <button
        type="button"
        className="flow-btn flow-btn--danger flow-btn--full"
        onClick={() => {
          stopAudio();
          save(null);
          setElapsedSec(0);
          showProgress();
          setPendingSeek(null);
        }}
      >
        {status === "completed" ? "開始前の画面に戻る" : "自動進行を終了"}
      </button>
    </section>
  );
}
function Timeline({
  events,
  currentId,
  elapsedSec,
  onSeek,
}: {
  events: AutoFlowEvent[];
  currentId: string | null;
  elapsedSec: number;
  onSeek?: (e: AutoFlowEvent) => void;
}) {
  return (
    <ol className="flow-timeline" aria-label="自動進行タイムライン">
      {events.map((e) => {
        const isCurrent = e.id === currentId;
        const complete = !!currentId && e.offsetSec < elapsedSec && !isCurrent;
        const content = (
          <>
            <span className="flow-timeline__dot" aria-hidden="true">
              {complete ? "✓" : ""}
            </span>
            <time>{formatOffset(e.offsetSec)}</time>
            <span className="flow-timeline__title">{e.title}</span>
            {isCurrent && <span className="flow-timeline__label">現在</span>}
          </>
        );
        return (
          <li
            key={e.id}
            className={`${isCurrent ? "is-current" : ""} ${complete ? "is-complete" : ""}`}
          >
            {onSeek ? (
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onSeek(e)}
              >
                {content}
              </button>
            ) : (
              <div>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
