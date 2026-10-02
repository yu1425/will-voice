"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import FlowTransportIcon from "./FlowTransportIcon";
import FlowReadinessPanel, {
  type FlowReadinessHandle,
} from "./FlowReadinessPanel";
import FlowRunHistory from "./FlowRunHistory";
import PreGameFlowPanel from "./PreGameFlowPanel";
import {
  AUDIO_DIAGNOSTIC_EVENT,
  type PlaybackDiagnostic,
  unlockRecordedAudio,
} from "@/lib/recordedAudio";
import {
  checkpointFlowRun,
  countFlowRun,
  finishFlowRun,
  getActiveFlowRun,
  pauseFlowRun,
  resumeFlowRun,
  startFlowRun,
  type PauseReason,
} from "@/lib/flowRunHistory";
import type { FlowConditions } from "@/lib/flowPlan";
import { FLOW_VOICE_TEST } from "@/lib/flowScripts";
import { preloadRecordedAudio } from "@/lib/recordedAudio";
import {
  buildStandardTwoHourEvents,
  eventAtElapsed,
  getAutoFlowProgress,
  nextEventAtElapsed,
  type AutoFlowEvent,
} from "@/lib/standardTwoHourFlow";
import {
  createSession,
  pauseSession,
  resumeSession,
  restoreSession,
  seekSession,
  sessionElapsed,
  SESSION_KEY,
  SESSION_SECONDS,
  type AutoSession,
  type AutoStatus,
} from "@/lib/autoFlowSession";
import {
  playTransitionCue,
  stopTransitionCue,
  unlockTransitionCue,
} from "@/lib/transitionCue";
import {
  getFlowBackgroundTimelinePosition,
  isFlowBackgroundTimelinePlaying,
  pauseFlowBackgroundTimeline,
  playFlowBackgroundTimeline,
  primeFlowBackgroundTimeline,
  setFlowBackgroundTimelinePosition,
  stopFlowBackgroundTimeline,
} from "@/lib/flowBackgroundTimeline";
export type { AutoStatus } from "@/lib/autoFlowSession";

export type AutoFlowHandle = {
  pauseForNavigation: () => void;
  stopCurrentAudio: () => void;
  endSession: () => void;
  playChimeTest: () => Promise<void>;
  playVoiceTest: () => void;
};
type Props = {
  active: boolean;
  conditions: FlowConditions;
  onConditionsChange: (c: FlowConditions) => void;
  onSpeak: (text: string, audioSrc?: string, startAtSec?: number) => void;
  onStopSpeaking: () => void;
  onStatusChange: (status: AutoStatus) => void;
  chimeEnabled: boolean;
  onChimePlayingChange?: (playing: boolean) => void;
};
export function formatClock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
const offset = (seconds: number) => formatClock(seconds).slice(0, 5);
const showPlayer = () =>
  document.querySelector(".flow-scroll")?.scrollTo({ top: 0 });
const MAX_LATE_CUE_SEC = 90;

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (
    type: "release",
    listener: () => void,
    options?: AddEventListenerOptions,
  ) => void;
};
type WakeLockCapableNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};
type WakeLockState = "idle" | "active" | "unsupported" | "released" | "error";

const AutoFlowPanel = forwardRef<AutoFlowHandle, Props>(
  function AutoFlowPanel(props, ref) {
    const [session, setSession] = useState<AutoSession | null>(null);
    const sessionRef = useRef<AutoSession | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [cuePlaying, setCuePlaying] = useState(false);
    const [confirmEnd, setConfirmEnd] = useState(false);
    const [starting, setStarting] = useState(false);
    const [overviewOpen, setOverviewOpen] = useState(true);
    const readinessRef = useRef<FlowReadinessHandle>(null);
    const [startBlocked, setStartBlocked] = useState(false);
    const [wakeLockState, setWakeLockState] = useState<WakeLockState>("idle");
    const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
    const lastChimeEnabled = useRef(props.chimeEnabled);
    const callbacks = useRef(props);
    callbacks.current = props;
    const mounted = useRef(false);
    const generation = useRef(0);
    const inFlight = useRef<{
      eventId: string;
      stage: "chime" | "voice";
    } | null>(null);
    const events = useMemo(
      () =>
        buildStandardTwoHourEvents(session?.courts ?? props.conditions.courts),
      [session?.courts, props.conditions.courts],
    );
    const eventsRef = useRef(events);
    eventsRef.current = events;
    const current = eventAtElapsed(events, elapsed);
    const next = nextEventAtElapsed(events, elapsed);
    const menuEvents = events.filter(
      (event) => !event.autoOnly && event.offsetSec < SESSION_SECONDS,
    );
    const previous =
      [...menuEvents]
        .reverse()
        .find((event) => event.offsetSec < current.offsetSec) ?? null;
    const status = session?.status ?? "idle";
    const progress = getAutoFlowProgress(elapsed);

    const save = useCallback((s: AutoSession | null) => {
      sessionRef.current = s;
      if (mounted.current) setSession(s);
      try {
        if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        else localStorage.removeItem(SESSION_KEY);
      } catch {
        /* Keep the active session usable when storage is unavailable. */
      }
    }, []);
    const cancelPlayback = useCallback(() => {
      generation.current++;
      inFlight.current = null;
      stopTransitionCue();
      callbacks.current.onStopSpeaking();
      if (mounted.current) {
        setCuePlaying(false);
        setStarting(false);
      }
    }, []);
    const releaseWakeLock = useCallback(async () => {
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      if (!sentinel || sentinel.released) return;
      try {
        await sentinel.release();
      } catch {
        /* The browser may have already released it while backgrounding. */
      }
    }, []);
    const requestWakeLock = useCallback(async () => {
      if (
        sessionRef.current?.status !== "running" ||
        document.visibilityState !== "visible"
      )
        return;
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        setWakeLockState("active");
        return;
      }
      const wakeLock = (navigator as WakeLockCapableNavigator).wakeLock;
      if (!wakeLock?.request) {
        setWakeLockState("unsupported");
        return;
      }
      try {
        const sentinel = await wakeLock.request("screen");
        if (sessionRef.current?.status !== "running") {
          await sentinel.release();
          return;
        }
        wakeLockRef.current = sentinel;
        setWakeLockState("active");
        sentinel.addEventListener(
          "release",
          () => {
            if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
            if (mounted.current && sessionRef.current?.status === "running")
              setWakeLockState("released");
          },
          { once: true },
        );
      } catch {
        if (mounted.current) setWakeLockState("error");
      }
    }, []);
    const playTimelineAt = useCallback(async (positionSec: number) => {
      const s = sessionRef.current;
      if (!s || s.status !== "running") return false;
      return playFlowBackgroundTimeline({
        courts: s.courts,
        chimeEnabled: callbacks.current.chimeEnabled,
        positionSec,
        onError: () =>
          window.dispatchEvent(new Event("will-flow-audio-error")),
      });
    }, []);
    const announce = useCallback(
      async (event: AutoFlowEvent, chime: boolean, startAtSec = 0) => {
        cancelPlayback();
        if (
          !event.audioSrc ||
          !callbacks.current.active ||
          sessionRef.current?.status !== "running"
        )
          return;
        const ticket = generation.current;
        inFlight.current = {
          eventId: event.id,
          stage: chime && callbacks.current.chimeEnabled ? "chime" : "voice",
        };
        if (chime && callbacks.current.chimeEnabled) {
          setCuePlaying(true);
          await playTransitionCue();
          if (ticket !== generation.current || !mounted.current) return;
          await new Promise<void>((resolve) => setTimeout(resolve, 600));
        }
        if (
          ticket !== generation.current ||
          !mounted.current ||
          !callbacks.current.active ||
          sessionRef.current?.status !== "running"
        )
          return;
        setCuePlaying(false);
        inFlight.current = { eventId: event.id, stage: "voice" };
        callbacks.current.onSpeak(event.voiceText, event.audioSrc, startAtSec);
      },
      [cancelPlayback],
    );

    const pauseAll = useCallback(
      (reason: PauseReason = "manual") => {
        const s = sessionRef.current;
        if (s?.status === "running") {
          const now = Date.now();
          pauseFlowRun(s.runId, reason, now);
          const timelinePosition = pauseFlowBackgroundTimeline();
          const at = Math.floor(
            timelinePosition ?? sessionElapsed(s, now),
          );
          const paused = pauseSession(s, now, null);
          // Keep the saved wall-clock aligned to the native timeline position.
          paused.startedAt =
            now - paused.accumulatedPausedMs - at * 1000;
          paused.firedEventIds = eventsRef.current
            .filter((e) => e.offsetSec <= at)
            .map((e) => e.id);
          save(
            at >= SESSION_SECONDS
              ? { ...paused, status: "completed", pendingCue: null }
              : paused,
          );
          if (at >= SESSION_SECONDS) finishFlowRun(s.runId, true, now);
          if (mounted.current) setElapsed(at);
        }
        cancelPlayback();
      },
      [save, cancelPlayback],
    );

    const advance = useCallback(
      (allowAudio: boolean) => {
        const s = sessionRef.current;
        if (!s || s.status !== "running") return;
        const now = Date.now();
        checkpointFlowRun(s.runId, now);
        const timelinePosition = getFlowBackgroundTimelinePosition();
        const at = Math.floor(
          timelinePosition !== null && isFlowBackgroundTimelinePlaying()
            ? timelinePosition
            : sessionElapsed(s, now),
        );
        const due = eventsRef.current.filter(
          (e) => e.offsetSec <= at && !s.firedEventIds.includes(e.id),
        );
        setElapsed(at);
        save({
          ...s,
          lastActiveAt: now,
          status: at >= SESSION_SECONDS ? "completed" : "running",
          firedEventIds: [...s.firedEventIds, ...due.map((e) => e.id)],
        });
        if (at >= SESSION_SECONDS) {
          finishFlowRun(s.runId, true, now);
          stopFlowBackgroundTimeline();
          cancelPlayback();
          return;
        }
        // A throttled/background timer may fire late. Play one recent cue, but
        // never dump a queue of stale announcements after a long suspension.
        if (
          allowAudio &&
          callbacks.current.active &&
          !isFlowBackgroundTimelinePlaying() &&
          due.length === 1 &&
          at - due[0].offsetSec <= MAX_LATE_CUE_SEC
        )
          void announce(due[0], due[0].chime !== false);
      },
      [save, announce, cancelPlayback],
    );

    useEffect(() => {
      mounted.current = true;
      try {
        const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
        const restored = restoreSession(
          raw,
          buildStandardTwoHourEvents(raw?.courts === 2 ? 2 : 1),
          Date.now(),
        );
        if (restored) {
          let run = getActiveFlowRun();
          if (restored.status !== "completed") {
            if (!run || (restored.runId && restored.runId !== run.id))
              run = startFlowRun(restored.courts, restored.startedAt);
            restored.runId = run.id;
            if (raw?.status === "running" || run.status === "running")
              pauseFlowRun(run.id, "navigation", restored.lastActiveAt);
          } else if (run && run.id === restored.runId) {
            finishFlowRun(run.id, true, restored.lastActiveAt);
          }
        }
        save(restored);
        if (restored) setElapsed(sessionElapsed(restored, Date.now()));
      } catch {
        save(null);
      }
      const error = () => {
        const s = sessionRef.current;
        if (!s || s.status !== "running") return;
        const event = eventAtElapsed(
          eventsRef.current,
          sessionElapsed(s, Date.now()),
        );
        pauseAll("audio-error");
        if (sessionRef.current?.status === "paused" && event.audioSrc)
          save({
            ...sessionRef.current,
            pendingCue: { eventId: event.id, positionSec: 0, chime: false },
          });
      };
      const diagnostic = (event: Event) => {
        const detail = (event as CustomEvent<PlaybackDiagnostic>).detail;
        const s = sessionRef.current;
        if (
          !detail ||
          s?.status !== "running" ||
          inFlight.current?.stage !== "voice"
        )
          return;
        const cue = eventsRef.current.find(
          (item) => item.id === inFlight.current?.eventId,
        );
        if (cue?.audioSrc !== (detail.flowAudioSrc ?? detail.src)) return;
        if (detail.type === "retry" && !detail.retryStarted) return;
        // Generated AI audio may fail then fall back to a fixed recording without pausing.
        if (detail.type === "final-failure" && detail.src !== cue.audioSrc)
          return;
        countFlowRun(
          s.runId,
          detail.type === "retry"
            ? "audioRetryCount"
            : detail.type === "recovery"
              ? "audioRecoveryCount"
              : "audioFinalFailureCount",
          Date.now(),
        );
      };
      window.addEventListener(AUDIO_DIAGNOSTIC_EVENT, diagnostic);
      window.addEventListener("will-flow-audio-error", error);
      return () => {
        mounted.current = false;
        window.removeEventListener("will-flow-audio-error", error);
        window.removeEventListener(AUDIO_DIAGNOSTIC_EVENT, diagnostic);
      };
    }, [save, pauseAll]);
    useEffect(() => {
      if (!props.active) pauseAll("navigation");
    }, [props.active, pauseAll]);
    useEffect(() => {
      props.onStatusChange(status);
    }, [status, props.onStatusChange]);
    useEffect(() => {
      if (lastChimeEnabled.current === props.chimeEnabled) return;
      lastChimeEnabled.current = props.chimeEnabled;
      if (status !== "running") return;
      const s = sessionRef.current;
      if (!s) return;
      const position =
        getFlowBackgroundTimelinePosition() ?? sessionElapsed(s, Date.now());
      void playTimelineAt(position);
    }, [props.chimeEnabled, status, playTimelineAt]);
    useEffect(() => {
      props.onChimePlayingChange?.(cuePlaying);
    }, [cuePlaying, props.onChimePlayingChange]);
    useEffect(() => {
      if (
        session &&
        status !== "completed" &&
        props.conditions.courts !== session.courts
      )
        props.onConditionsChange({
          ...props.conditions,
          courts: session.courts,
        });
    }, [session, status, props.conditions, props.onConditionsChange]);
    useEffect(() => {
      preloadRecordedAudio(current.audioSrc);
      preloadRecordedAudio(next?.audioSrc);
    }, [current.audioSrc, next?.audioSrc]);
    useEffect(() => {
      if (status !== "running") return;
      const id = setInterval(() => advance(true), 1000);
      return () => clearInterval(id);
    }, [status, advance]);
    useEffect(() => {
      if (status !== "running") {
        void releaseWakeLock();
        setWakeLockState("idle");
        return;
      }
      void requestWakeLock();
      const visibility = () => {
        if (document.visibilityState !== "visible") return;
        void requestWakeLock();
        // iOS may pause media while switching apps. Resume the same native
        // two-hour timeline first, then reconcile the UI without replaying cues.
        if (!isFlowBackgroundTimelinePlaying()) {
          const s = sessionRef.current;
          const position =
            getFlowBackgroundTimelinePosition() ??
            (s ? sessionElapsed(s, Date.now()) : 0);
          void playTimelineAt(position);
        }
        advance(false);
      };
      document.addEventListener("visibilitychange", visibility);
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        void releaseWakeLock();
      };
    }, [
      status,
      advance,
      releaseWakeLock,
      requestWakeLock,
      playTimelineAt,
    ]);

    const start = async (onlineOverride = false) => {
      if (starting) return;
      if (onlineOverride && navigator.onLine === false) {
        setStartBlocked(true);
        return;
      }
      stopFlowBackgroundTimeline();
      cancelPlayback();
      setStarting(true);
      const ticket = generation.current;
      // Prime the real two-hour native media element directly from the user's
      // tap. This is what allows iOS to keep the session alive after the app
      // is backgrounded or the screen is locked.
      const unlocking = Promise.all([
        primeFlowBackgroundTimeline(
          props.conditions.courts,
          props.chimeEnabled,
        ),
        unlockTransitionCue(),
        unlockRecordedAudio(),
      ]);
      const ready = onlineOverride || (await readinessRef.current?.prepare());
      const [timelinePrimed] = await unlocking;
      if (
        !mounted.current ||
        ticket !== generation.current ||
        !callbacks.current.active
      )
        return;
      if (!ready || !timelinePrimed) {
        setStartBlocked(true);
        setStarting(false);
        return;
      }
      setStartBlocked(false);
      const now = Date.now();
      const run = startFlowRun(props.conditions.courts, now);
      save({ ...createSession(props.conditions.courts, now), runId: run.id });
      setElapsed(0);
      setConfirmEnd(false);
      showPlayer();
      const timelineStarted = await playTimelineAt(0);
      if (!timelineStarted) {
        finishFlowRun(run.id, false, Date.now());
        save(null);
        setStartBlocked(true);
      }
      setStarting(false);
    };
    const resume = () => {
      const s = sessionRef.current;
      if (!s || s.status !== "paused") return;
      cancelPlayback();
      const now = Date.now();
      resumeFlowRun(s.runId, now);
      const resumed = resumeSession(s, now);
      save(resumed);
      const position = sessionElapsed(resumed, now);
      setElapsed(position);
      void playTimelineAt(position);
    };
    const seek = (event: AutoFlowEvent) => {
      const s = sessionRef.current;
      if (!s) return;
      cancelPlayback();
      countFlowRun(s.runId, "seekCount", Date.now());
      const moved = seekSession(s, event, eventsRef.current, Date.now());
      save(moved);
      if (moved.status === "completed") {
        finishFlowRun(s.runId, true, Date.now());
        stopFlowBackgroundTimeline();
      } else if (moved.status === "running") {
        void playTimelineAt(event.offsetSec);
      } else {
        pauseFlowBackgroundTimeline();
        setFlowBackgroundTimelinePosition(event.offsetSec);
      }
      setElapsed(event.offsetSec);
      setConfirmEnd(false);
      showPlayer();
    };
    const finish = useCallback(() => {
      const s = sessionRef.current;
      if (s && s.status !== "completed")
        finishFlowRun(s.runId, false, Date.now());
      stopFlowBackgroundTimeline();
      cancelPlayback();
      save(null);
      setElapsed(0);
      setConfirmEnd(false);
      setStartBlocked(false);
      showPlayer();
    }, [cancelPlayback, save]);
    const testVoice = useCallback(() => {
      pauseAll("manual");
      callbacks.current.onSpeak(
        FLOW_VOICE_TEST.displayText,
        FLOW_VOICE_TEST.audioSrc,
      );
    }, [pauseAll]);
    const testChime = useCallback(async () => {
      pauseAll("manual");
      const ticket = generation.current;
      await unlockTransitionCue();
      if (ticket !== generation.current || !mounted.current) return;
      setCuePlaying(true);
      await playTransitionCue();
      if (ticket === generation.current && mounted.current)
        setCuePlaying(false);
    }, [pauseAll]);
    useImperativeHandle(
      ref,
      () => ({
        pauseForNavigation: () => pauseAll("navigation"),
        stopCurrentAudio: () => pauseAll("manual"),
        endSession: finish,
        playChimeTest: testChime,
        playVoiceTest: testVoice,
      }),
      [pauseAll, finish, testChime, testVoice],
    );

    return (
      <section className="auto-flow" aria-label="自動進行">
        <section className="flow-surface flow-progress">
          <header className="flow-header">
            <span className="flow-eyebrow">
              標準2時間 · {session?.courts ?? props.conditions.courts}面
            </span>
            <span
              className={`flow-status flow-status--${status}`}
              role="status"
            >
              {status === "idle"
                ? "開始前"
                : status === "paused"
                  ? "一時停止中"
                  : status === "completed"
                    ? "完了"
                    : "進行中"}
            </span>
          </header>
          <h1>{current.title}</h1>
          {status === "idle" ? (
            <p className="flow-lead">
              開始すると、時間に合わせて案内が流れます。途中の切り替えはメニューを選ぶだけ。
            </p>
          ) : (
            <>
              <div className="flow-progress__clock">
                <strong>{formatClock(elapsed)}</strong>
                <span> / 02:00:00</span>
              </div>
              <div
                className="flow-progress__bar"
                role="progressbar"
                aria-label="開催全体の進捗"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percentage}
              >
                <span
                  style={{ width: `${(elapsed / SESSION_SECONDS) * 100}%` }}
                />
              </div>
              <div className="flow-progress__numbers">
                <span>{progress.percentage}%完了</span>
                <span>残り {formatClock(progress.remainingSec)}</span>
              </div>
              {next && (
                <button
                  type="button"
                  className="flow-next-card"
                  aria-label={`${next.title}へ移動`}
                  onClick={() => seek(next)}
                >
                  <span className="flow-next-heading">
                    <span>次のメニュー</span>
                    <span className="flow-countdown">
                      あと {Math.floor((next.offsetSec - elapsed) / 60)}:
                      {String((next.offsetSec - elapsed) % 60).padStart(2, "0")}
                    </span>
                  </span>
                  <span className="flow-next-menu">
                    <time>{offset(next.offsetSec)}</time>
                    <strong>{next.title}</strong>
                    <span aria-hidden="true">→</span>
                  </span>
                </button>
              )}
              {previous && (
                <button
                  type="button"
                  className="flow-previous-card"
                  aria-label={`${previous.title}へ戻る`}
                  onClick={() => seek(previous)}
                >
                  <span
                    className="flow-previous-card__arrow"
                    aria-hidden="true"
                  >
                    ←
                  </span>
                  <span className="flow-previous-card__label">
                    前のメニュー
                  </span>
                  <time>{offset(previous.offsetSec)}</time>
                  <strong>{previous.title}</strong>
                </button>
              )}
            </>
          )}
          {status !== "idle" && status !== "completed" && (
            <PreGameFlowPanel events={events} elapsed={elapsed} />
          )}
          {status === "idle" && (
            <FlowReadinessPanel
              ref={readinessRef}
              chimeEnabled={props.chimeEnabled}
              onVoiceTest={testVoice}
              onChimeTest={testChime}
            />
          )}
          {status === "idle" && startBlocked && (
            <div className="flow-end-confirm" role="alert">
              <p>
                固定案内音声の準備が完了していません。通信接続後に再試行してください。オンライン再生で開始する場合、通信が切れると音声を再生できないことがあります。
              </p>
              <div className="flow-actions">
                <button
                  type="button"
                  className="flow-btn"
                  disabled={starting}
                  onClick={() => void start()}
                >
                  再試行
                </button>
                <button
                  type="button"
                  className="flow-btn"
                  disabled={starting}
                  onClick={() => void start(true)}
                >
                  オンラインのまま開始
                </button>
              </div>
            </div>
          )}
          <div
            className="flow-player-controls"
            role="group"
            aria-label="自動進行全体の操作"
          >
            <button
              type="button"
              className="flow-btn flow-btn--primary"
              disabled={starting}
              onClick={() => {
                if (status === "idle") void start();
                else if (status === "completed") finish();
                else if (status === "running") pauseAll();
                else resume();
              }}
            >
              <FlowTransportIcon
                kind={status === "running" ? "pause" : "play"}
              />
              {starting
                ? "準備中…"
                : status === "idle"
                  ? "自動進行を開始"
                  : status === "paused"
                    ? "再開"
                    : status === "completed"
                      ? "開始画面へ"
                      : "一時停止"}
            </button>
            {status !== "idle" && status !== "completed" && (
              <button
                type="button"
                className="flow-btn flow-end-trigger"
                onClick={() => setConfirmEnd((v) => !v)}
                aria-expanded={confirmEnd}
              >
                <FlowTransportIcon kind="stop" />
                終了
              </button>
            )}
          </div>
          <p className="flow-player-hint">
            {status === "paused"
              ? "再開すると、時計と中断した案内が続きます。"
              : "時計と音声をまとめて操作します。"}
          </p>
          {status === "running" && (
            <p className="flow-player-hint" role="status">
              {wakeLockState === "active"
                ? "iPhoneバックグラウンド進行音声を再生中。別アプリへの切り替えや画面ロック中も、1本の音声タイムラインで案内を継続します。"
                : wakeLockState === "unsupported"
                  ? "バックグラウンド進行音声を再生中です。画面スリープ防止には非対応ですが、案内は1本の音声タイムラインで継続します。"
                  : wakeLockState === "error"
                    ? "バックグラウンド進行音声を再生中です。画面スリープ防止の開始には失敗しましたが、音声タイムラインは継続します。"
                    : "バックグラウンド進行音声を再生中です。"}
            </p>
          )}
          {confirmEnd && (
            <div className="flow-end-confirm" role="alert">
              <h2>自動進行を終了しますか？</h2>
              <p>時計と音声を止め、開始前に戻ります。</p>
              <div className="flow-actions">
                <button
                  type="button"
                  className="flow-btn"
                  onClick={() => setConfirmEnd(false)}
                >
                  戻る
                </button>
                <button
                  type="button"
                  className="flow-btn flow-btn--danger"
                  onClick={finish}
                >
                  終了する
                </button>
              </div>
            </div>
          )}
          <details className="flow-script">
            <summary>このメニューの案内</summary>
            <p>{current.displayText}</p>
          </details>
        </section>
        <details
          className="flow-surface flow-overview"
          open={overviewOpen}
          onToggle={(event) => setOverviewOpen(event.currentTarget.open)}
        >
          <summary>
            <span>進行メニュー</span>
            <span className="flow-summary-meta">
              {menuEvents.length}項目 · 2時間
            </span>
          </summary>
          <p className="flow-muted">
            {status === "idle"
              ? "開始前に順番を確認できます。"
              : "項目を選ぶと、その開始時刻へ移動します。"}
          </p>
          <ol className="flow-menu-grid" aria-label="進行メニュー一覧">
            {menuEvents.map((event, index) => (
              <li
                key={event.id}
                className={
                  event.id === current.id && status !== "idle"
                    ? "is-current"
                    : event.offsetSec < elapsed
                      ? "is-complete"
                      : ""
                }
              >
                <button
                  type="button"
                  disabled={status === "idle"}
                  aria-label={`${String(index + 1).padStart(2, "0")} ${offset(event.offsetSec)} ${event.title}`}
                  aria-current={
                    event.id === current.id && status !== "idle"
                      ? "step"
                      : undefined
                  }
                  onClick={() => seek(event)}
                >
                  <span className="flow-menu-grid__number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <time>{offset(event.offsetSec)}</time>
                  <strong>{event.title}</strong>
                </button>
              </li>
            ))}
          </ol>
        </details>
        <FlowRunHistory />
      </section>
    );
  },
);
export default AutoFlowPanel;
