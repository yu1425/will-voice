"use client";

import Link from "next/link";
import FlowTransportIcon from "./FlowTransportIcon";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { flowCueState } from "@/lib/flowCueState";
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
export type AutoFlowHandle = {
  stopCurrentAudio: () => void;
  endSession: () => void;
  playChimeTest: () => Promise<void>;
  playVoiceTest: () => void;
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
  chimeEnabled: boolean;
  onChimePlayingChange?: (playing: boolean) => void;
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

const AutoFlowPanel = forwardRef<AutoFlowHandle, Props>(function AutoFlowPanel(
  {
    active,
    conditions,
    onConditionsChange,
    onSpeak,
    onStopSpeaking,
    isSpeaking,
    onSyncStep,
    onStatusChange,
    chimeEnabled,
    onChimePlayingChange,
  }: Props,
  ref,
) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [cuePlaying, setCuePlaying] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<AutoFlowEvent | null>(null);
  const [audioState, dispatchAudio] = useReducer(flowCueState, "waiting");
  const [stopNotice, setStopNotice] = useState(false);
  // Playback callbacks may change without changing the session or subscribing to a new clock.
  const callbacks = useRef({ onSpeak, onStopSpeaking, onSyncStep });
  callbacks.current = { onSpeak, onStopSpeaking, onSyncStep };
  const chimeEnabledRef = useRef(chimeEnabled);
  chimeEnabledRef.current = chimeEnabled;
  const activeRef = useRef(active);
  activeRef.current = active;
  const playbackGeneration = useRef(0);
  const mounted = useRef(true);
  const observed = useRef(Date.now());
  const events = useMemo(
    () => buildStandardTwoHourEvents(session?.courts ?? conditions.courts),
    [session?.courts, conditions.courts],
  );
  const eventsRef = useRef(events);
  eventsRef.current = events;
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
  // Invalidate only the in-flight cue/WAV. New events get a fresh ticket; clock state is untouched.
  const cancelCurrentPlayback = useCallback(() => {
    playbackGeneration.current++;
    stopTransitionCue();
    setCuePlaying(false);
  }, []);
  const stopCurrentPlayback = useCallback(() => {
    cancelCurrentPlayback();
    callbacks.current.onStopSpeaking();
    dispatchAudio("wait");
    setStopNotice(false);
  }, [cancelCurrentPlayback]);
  const stopAudioByUser = () => {
    stopCurrentPlayback();
    dispatchAudio("stop-current");
    setStopNotice(true);
  };
  const announce = useCallback(
    async (e: AutoFlowEvent, cue: boolean) => {
      cancelCurrentPlayback();
      callbacks.current.onStopSpeaking();
      setStopNotice(false);
      if (!e.audioSrc || !activeRef.current) {
        dispatchAudio(e.offsetSec === 7200 ? "end" : "wait");
        return;
      }
      dispatchAudio("play");
      const ticket = playbackGeneration.current;
      if (cue && chimeEnabledRef.current) {
        setCuePlaying(true);
        await playTransitionCue();
        if (ticket !== playbackGeneration.current || !mounted.current) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
      }
      if (
        ticket !== playbackGeneration.current ||
        !mounted.current ||
        !activeRef.current
      )
        return;
      setCuePlaying(false);
      callbacks.current.onSpeak(e.voiceText, e.audioSrc);
    },
    [cancelCurrentPlayback],
  );
  const advance = useCallback(
    (allowAudio: boolean) => {
      const s = sessionRef.current;
      if (!s || s.status !== "running") return;
      const elapsed = Math.min(
        7200,
        getAutoFlowElapsedSec(s.startedAt, s.accumulatedPausedMs, Date.now()),
      );
      const currentEvents = eventsRef.current;
      const due = currentEvents.filter(
        (e) => e.offsetSec <= elapsed && !s.firedEventIds.includes(e.id),
      );
      setElapsedSec(elapsed);
      if (activeRef.current) {
        const e = eventAtElapsed(currentEvents, elapsed);
        if (e.refStep) callbacks.current.onSyncStep(e.refStep);
      }
      if (due.length || elapsed === 7200)
        save({
          ...s,
          status: elapsed === 7200 ? "completed" : "running",
          firedEventIds: [...s.firedEventIds, ...due.map((e) => e.id)],
        });
      if (elapsed === 7200) {
        stopCurrentPlayback();
        dispatchAudio("end");
        return;
      }
      // Missed announcements are consumed, never queued after a background gap.
      if (activeRef.current && allowAudio && due.length === 1)
        void announce(due[0], true);
    },
    [save, announce, stopCurrentPlayback],
  );

  useEffect(() => {
    mounted.current = true;
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
      dispatchAudio(
        elapsed === 7200
          ? "end"
          : stored.status === "paused"
            ? "pause-flow"
            : "wait",
      );
    }
    return () => {
      mounted.current = false;
      playbackGeneration.current++;
      stopTransitionCue();
    };
  }, [save]);
  useEffect(() => {
    if (!isSpeaking && !cuePlaying)
      dispatchAudio(
        sessionRef.current?.status === "paused" ? "settled-paused" : "settled",
      );
  }, [isSpeaking, cuePlaying]);
  useEffect(() => {
    if (!stopNotice) return;
    const id = setTimeout(() => setStopNotice(false), 2500);
    return () => clearTimeout(id);
  }, [stopNotice]);
  useEffect(() => {
    const leave = () => {
      activeRef.current = false;
      stopCurrentPlayback();
    };
    window.addEventListener("will-flow-leave", leave);
    return () => window.removeEventListener("will-flow-leave", leave);
  }, [stopCurrentPlayback]);
  useEffect(() => onStatusChange(status), [onStatusChange, status]);
  useEffect(() => {
    onChimePlayingChange?.(cuePlaying);
  }, [cuePlaying, onChimePlayingChange]);
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
    if (!active) stopCurrentPlayback();
    else advance(false);
  }, [active, advance, stopCurrentPlayback]);
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
      else stopCurrentPlayback();
    };
    const id = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [status, advance, stopCurrentPlayback]);

  const start = async () => {
    stopCurrentPlayback();
    const ticket = playbackGeneration.current;
    await unlockTransitionCue();
    if (
      ticket !== playbackGeneration.current ||
      !mounted.current ||
      !activeRef.current
    )
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
    dispatchAudio("play");
    callbacks.current.onSpeak(first.voiceText, first.audioSrc);
  };
  const pauseResume = () => {
    const s = sessionRef.current;
    if (!s || s.status === "completed") return;
    if (s.status === "running") {
      stopCurrentPlayback();
      dispatchAudio("pause-flow");
      const now = Date.now();
      setElapsedSec(
        Math.min(
          7200,
          getAutoFlowElapsedSec(s.startedAt, s.accumulatedPausedMs, now),
        ),
      );
      save({ ...s, status: "paused", pausedAt: now });
    } else if (s.pausedAt !== null) {
      dispatchAudio("resume-flow");
      save({
        ...s,
        status: "running",
        pausedAt: null,
        accumulatedPausedMs: s.accumulatedPausedMs + Date.now() - s.pausedAt,
      });
    }
  };
  const seek = (e: AutoFlowEvent) => {
    stopCurrentPlayback();
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
  const testCue = useCallback(async () => {
    stopCurrentPlayback();
    const ticket = playbackGeneration.current;
    await unlockTransitionCue();
    if (ticket !== playbackGeneration.current || !mounted.current) return;
    dispatchAudio("play");
    setCuePlaying(true);
    await playTransitionCue();
    if (ticket === playbackGeneration.current && mounted.current)
      setCuePlaying(false);
  }, [stopCurrentPlayback]);
  const testVoice = useCallback(() => {
    stopCurrentPlayback();
    dispatchAudio("play");
    callbacks.current.onSpeak(
      FLOW_VOICE_TEST.displayText,
      FLOW_VOICE_TEST.audioSrc,
    );
  }, [stopCurrentPlayback]);
  const afterNext = next
    ? events.find((event) => event.offsetSec > next.offsetSec)
    : null;
  const progress = getAutoFlowProgress(elapsedSec);
  const finishSession = useCallback(() => {
    stopCurrentPlayback();
    save(null);
    dispatchAudio("wait");
    setElapsedSec(0);
    setPendingSeek(null);
    showProgress();
  }, [save, stopCurrentPlayback]);
  useImperativeHandle(
    ref,
    () => ({
      stopCurrentAudio: stopCurrentPlayback,
      endSession: finishSession,
      playChimeTest: testCue,
      playVoiceTest: testVoice,
    }),
    [stopCurrentPlayback, finishSession, testCue, testVoice],
  );

  if (status === "idle")
    return (
      <section className="flow-surface auto-flow" aria-label="自動進行">
        <header className="flow-header">
          <div>
            <p className="flow-eyebrow">自動進行 · {conditions.courts}面</p>
            <h1>開始・ショートラリー</h1>
          </div>
          <span className="flow-status">標準2時間</span>
        </header>
        <p className="flow-lead">
          開始すると、標準2時間メニューに沿ってチャイムと音声案内が自動で流れます。
        </p>
        <div className="flow-actions">
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
              stopCurrentPlayback();
            }}
          >
            初めて使う方へ → 使い方
          </Link>
          <span>全体の自己紹介は、ゲーム前に行います。</span>
        </p>
        <details className="flow-overview">
          <summary>全体の進行</summary>
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
        <div className="flow-progress__numbers">
          <span>
            <strong>{progress.percentage}%完了</strong>
          </span>
          <span>
            残り {formatClock(progress.remainingSec).replace(/^0(?=\d:)/, "")}
          </span>
        </div>
        {next && (
          <section className="flow-progress__next" aria-label="次のメニュー">
            <div className="flow-next-heading">
              <h2>次のメニュー</h2>
              <span className="flow-countdown">
                あと {Math.floor((next.offsetSec - elapsedSec) / 60)}:
                {String((next.offsetSec - elapsedSec) % 60).padStart(2, "0")}
              </span>
            </div>
            <div className="flow-next-menu">
              <time>{formatOffset(next.offsetSec)}</time>
              <strong>{next.title}</strong>
            </div>
          </section>
        )}
        {afterNext && (
          <section
            className="flow-progress__later"
            aria-label="その次のメニュー"
          >
            <h2>その次</h2>
            <div className="flow-later-menu">
              <time>{formatOffset(afterNext.offsetSec)}</time>
              <strong>{afterNext.title}</strong>
            </div>
          </section>
        )}
        <div className="flow-controls" role="group" aria-label="進行操作">
          <button
            type="button"
            className="flow-btn flow-btn--primary flow-btn--full"
            disabled={status === "completed"}
            onClick={pauseResume}
          >
            <FlowTransportIcon kind={status === "paused" ? "play" : "pause"} />
            {status === "paused" ? "進行を再開" : "進行を一時停止"}
          </button>
        </div>
        <div className="flow-controls-details">
          <div
            className="flow-audio-controls"
            role="group"
            aria-label="音声操作"
          >
            <div className="flow-audio-heading">
              <span>音声</span>
              <span
                className={`flow-audio-state${isSpeaking || cuePlaying ? " is-playing" : ""}`}
                role="status"
                data-cue-state={audioState}
              >
                {isSpeaking || cuePlaying ? "再生中" : "待機中"}
              </span>
            </div>
            <div className="flow-actions">
              <button
                type="button"
                className="flow-btn"
                onClick={() => void announce(current, false)}
                disabled={!current.audioSrc}
              >
                <FlowTransportIcon kind="replay" />
                もう一度聞く
              </button>
              <button
                type="button"
                className="flow-btn"
                onClick={stopAudioByUser}
                disabled={!isSpeaking && !cuePlaying}
              >
                <FlowTransportIcon kind="stop" />
                今の音声を止める
              </button>
            </div>
            {stopNotice && (
              <p className="flow-audio-notice" role="status">
                今の音声を停止しました
                <br />
                次の案内は自動で再生されます
              </p>
            )}
          </div>
          <p className="flow-progress__times">
            {timeOfDay(session!.startedAt)}開始 ·{" "}
            {timeOfDay(
              session!.startedAt +
                session!.accumulatedPausedMs +
                (session!.pausedAt ? Date.now() - session!.pausedAt : 0) +
                7200000,
            )}
            終了予定
          </p>
          <details className="flow-script">
            <summary>この案内の内容</summary>
            <p>{current.displayText}</p>
          </details>
        </div>
      </div>
      <details className="flow-overview">
        <summary>全体の進行</summary>
        <p className="flow-muted">時刻をタップすると、その時点へ移動できます</p>
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
    </section>
  );
});
export default AutoFlowPanel;
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
