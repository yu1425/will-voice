"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FlowConditions, IntroTiming } from "@/lib/flowPlan";
import { preloadRecordedAudio } from "@/lib/recordedAudio";
import { STANDARD_TWO_HOUR_DURATION_SEC, buildStandardTwoHourEvents, eventAtElapsed, getAutoFlowElapsedSec, nextEventAtElapsed, type AutoFlowEvent } from "@/lib/standardTwoHourFlow";
import { playTransitionCue, stopTransitionCue, unlockTransitionCue } from "@/lib/transitionCue";

const STATE_KEY = "will-standard-two-hour-auto-flow";
const SETTINGS_KEY = "will-standard-two-hour-auto-flow-settings";
const VERSION = 2;
type Status = "idle" | "running" | "paused" | "completed";
type SavedState = { version: number; status: Exclude<Status, "idle">; startedAt: number; pausedAt: number | null; accumulatedPausedMs: number; firedEventIds: string[]; introTiming: IntroTiming };
type Props = { conditions: FlowConditions; onConditionsChange: (conditions: FlowConditions) => void; onSpeak: (text: string, audioSrc?: string) => void; onStopSpeaking: () => void; isSpeaking: boolean; onSyncStep: (step: number) => void };

function formatClock(seconds: number) { const safe = Math.max(0, seconds); return `${String(Math.floor(safe / 3600)).padStart(2, "0")}:${String(Math.floor((safe % 3600) / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`; }
function formatOffset(seconds: number) { return formatClock(seconds).slice(0, 5); }
function savedState(): SavedState | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(STATE_KEY) ?? "null") as Partial<SavedState> | null;
    if (!value || (value.version !== 1 && value.version !== VERSION) || (value.status !== "running" && value.status !== "paused" && value.status !== "completed") || !Number.isFinite(value.startedAt) || !Number.isFinite(value.accumulatedPausedMs) || !Array.isArray(value.firedEventIds) || (value.introTiming !== "start" && value.introTiming !== "afterServe")) return null;
    return { version: VERSION, status: value.status, startedAt: value.startedAt as number, pausedAt: typeof value.pausedAt === "number" ? value.pausedAt : null, accumulatedPausedMs: Math.max(0, value.accumulatedPausedMs as number), firedEventIds: value.firedEventIds.filter((id): id is string => typeof id === "string"), introTiming: value.introTiming };
  } catch { return null; }
}

export default function AutoFlowPanel({ conditions, onConditionsChange, onSpeak, onStopSpeaking, isSpeaking, onSyncStep }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [accumulatedPausedMs, setAccumulatedPausedMs] = useState(0);
  const [firedEventIds, setFiredEventIds] = useState<string[]>([]);
  const [savedIntroTiming, setSavedIntroTiming] = useState<IntroTiming>(conditions.introTiming);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [chimeEnabled, setChimeEnabled] = useState(true);
  const restoredRef = useRef(false);
  const lastObservedRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const events = useMemo(() => buildStandardTwoHourEvents(savedIntroTiming), [savedIntroTiming]);
  const current = eventAtElapsed(events, elapsedSec);
  const next = nextEventAtElapsed(events, elapsedSec);

  const persist = useCallback((nextStatus: Status, values: Omit<SavedState, "version" | "status">) => {
    try { if (nextStatus === "idle") window.localStorage.removeItem(STATE_KEY); else window.localStorage.setItem(STATE_KEY, JSON.stringify({ version: VERSION, status: nextStatus, ...values })); } catch { /* no-op */ }
  }, []);
  const sync = useCallback((event: AutoFlowEvent) => { if (event.refStep) onSyncStep(event.refStep); }, [onSyncStep]);
  const cancelSequence = useCallback(() => { sequenceRef.current += 1; stopTransitionCue(); }, []);
  const announce = useCallback(async (event: AutoFlowEvent, cue: boolean) => {
    const sequence = ++sequenceRef.current;
    if (cue && chimeEnabled) { await playTransitionCue(); await new Promise<void>((resolve) => window.setTimeout(resolve, 700)); }
    if (sequence !== sequenceRef.current) return;
    onSpeak(event.speakText, event.audioSrc);
  }, [chimeEnabled, onSpeak]);

  useEffect(() => {
    try { const value = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}"); if (typeof value.chimeEnabled === "boolean") setChimeEnabled(value.chimeEnabled); } catch { /* no-op */ }
  }, []);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const stored = savedState(); if (!stored) return;
    const restoredEvents = buildStandardTwoHourEvents(stored.introTiming);
    const rawElapsed = getAutoFlowElapsedSec(stored.startedAt, stored.accumulatedPausedMs, Date.now(), stored.status === "paused" ? stored.pausedAt : null);
    const elapsed = Math.min(rawElapsed, STANDARD_TWO_HOUR_DURATION_SEC);
    const nextStatus: Status = elapsed >= STANDARD_TWO_HOUR_DURATION_SEC ? "completed" : stored.status;
    const fired = restoredEvents.filter((event) => event.offsetSec <= elapsed).map((event) => event.id);
    setStatus(nextStatus); setStartedAt(stored.startedAt); setPausedAt(nextStatus === "paused" ? stored.pausedAt : null); setAccumulatedPausedMs(stored.accumulatedPausedMs); setFiredEventIds(fired); setSavedIntroTiming(stored.introTiming); setElapsedSec(elapsed); sync(eventAtElapsed(restoredEvents, elapsed));
    persist(nextStatus, { ...stored, pausedAt: nextStatus === "paused" ? stored.pausedAt : null, firedEventIds: fired });
  }, [persist, sync]);
  useEffect(() => { preloadRecordedAudio(current.audioSrc); preloadRecordedAudio(next?.audioSrc); }, [current, next]);

  const advance = useCallback((allowAnnouncement: boolean) => {
    if (status !== "running" || startedAt === null) return;
    const elapsed = Math.min(getAutoFlowElapsedSec(startedAt, accumulatedPausedMs, Date.now()), STANDARD_TWO_HOUR_DURATION_SEC);
    const due = events.filter((event) => event.offsetSec <= elapsed && !firedEventIds.includes(event.id));
    const fired = due.length ? [...firedEventIds, ...due.map((event) => event.id)] : firedEventIds;
    const event = due.at(-1) ?? eventAtElapsed(events, elapsed);
    const nextStatus: Status = elapsed >= STANDARD_TWO_HOUR_DURATION_SEC ? "completed" : "running";
    setElapsedSec(elapsed); setFiredEventIds(fired); sync(event); if (nextStatus === "completed") setStatus("completed");
    persist(nextStatus, { startedAt, pausedAt: null, accumulatedPausedMs, firedEventIds: fired, introTiming: savedIntroTiming });
    if (allowAnnouncement && due.length === 1) void announce(event, true);
  }, [accumulatedPausedMs, announce, events, firedEventIds, persist, savedIntroTiming, startedAt, status, sync]);
  useEffect(() => {
    if (status !== "running") return;
    lastObservedRef.current = Date.now();
    const tick = () => { const now = Date.now(); const gap = now - (lastObservedRef.current ?? now); lastObservedRef.current = now; advance(gap <= 15_000 && document.visibilityState === "visible"); };
    const visibility = () => { if (document.visibilityState === "visible") { lastObservedRef.current = Date.now(); advance(false); } };
    const interval = window.setInterval(tick, 1000); document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visibility); };
  }, [advance, status]);

  const setChime = (value: boolean) => { setChimeEnabled(value); try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ chimeEnabled: value })); } catch { /* no-op */ } };
  const start = async () => {
    await unlockTransitionCue(); cancelSequence(); const now = Date.now(); const event = buildStandardTwoHourEvents(conditions.introTiming)[0]; const fired = [event.id];
    setStatus("running"); setStartedAt(now); setPausedAt(null); setAccumulatedPausedMs(0); setFiredEventIds(fired); setSavedIntroTiming(conditions.introTiming); setElapsedSec(0); sync(event);
    persist("running", { startedAt: now, pausedAt: null, accumulatedPausedMs: 0, firedEventIds: fired, introTiming: conditions.introTiming }); onSpeak(event.speakText, event.audioSrc);
  };
  const pause = () => { if (status !== "running" || startedAt === null) return; const now = Date.now(); const elapsed = Math.min(getAutoFlowElapsedSec(startedAt, accumulatedPausedMs, now), STANDARD_TWO_HOUR_DURATION_SEC); setElapsedSec(elapsed); setStatus("paused"); setPausedAt(now); persist("paused", { startedAt, pausedAt: now, accumulatedPausedMs, firedEventIds, introTiming: savedIntroTiming }); };
  const resume = () => { if (status !== "paused" || startedAt === null || pausedAt === null) return; const pausedMs = accumulatedPausedMs + Date.now() - pausedAt; setAccumulatedPausedMs(pausedMs); setPausedAt(null); setStatus("running"); persist("running", { startedAt, pausedAt: null, accumulatedPausedMs: pausedMs, firedEventIds, introTiming: savedIntroTiming }); };
  const seek = (event: AutoFlowEvent) => {
    cancelSequence(); const now = Date.now(); const elapsed = event.offsetSec; const nextStatus: Status = elapsed >= STANDARD_TWO_HOUR_DURATION_SEC ? "completed" : status === "paused" ? "paused" : "running"; const nextPausedAt = nextStatus === "paused" ? now : null; const fired = events.filter((item) => item.offsetSec <= elapsed).map((item) => item.id);
    setElapsedSec(elapsed); setStartedAt(now - elapsed * 1000); setAccumulatedPausedMs(0); setPausedAt(nextPausedAt); setFiredEventIds(fired); setStatus(nextStatus); sync(event); persist(nextStatus, { startedAt: now - elapsed * 1000, pausedAt: nextPausedAt, accumulatedPausedMs: 0, firedEventIds: fired, introTiming: savedIntroTiming }); void announce(event, true);
  };
  const stopAudio = () => { cancelSequence(); onStopSpeaking(); };
  const end = () => { stopAudio(); setStatus("idle"); setStartedAt(null); setPausedAt(null); setAccumulatedPausedMs(0); setFiredEventIds([]); setElapsedSec(0); setSavedIntroTiming(conditions.introTiming); persist("idle", { startedAt: 0, pausedAt: null, accumulatedPausedMs: 0, firedEventIds: [], introTiming: conditions.introTiming }); };

  if (status === "idle") return <section className="auto-flow auto-flow--setup" aria-label="2時間オート進行"><header className="auto-flow__setup-head"><span>STANDARD FLOW</span><h1>2時間オート</h1><p>開始後は時刻に沿って、切替案内と進行を担当します。</p></header><div className="auto-flow__setup-grid"><Setting label="コート数"><Choice selected={conditions.courts === 1} onClick={() => onConditionsChange({ ...conditions, courts: 1 })}>1面</Choice><Choice selected={conditions.courts === 2} onClick={() => onConditionsChange({ ...conditions, courts: 2 })}>2面</Choice></Setting><Setting label="自己紹介"><Choice selected={conditions.introTiming === "start"} onClick={() => onConditionsChange({ ...conditions, introTiming: "start" })}>開始時</Choice><Choice selected={conditions.introTiming === "afterServe"} onClick={() => onConditionsChange({ ...conditions, introTiming: "afterServe" })}>サーブ後</Choice></Setting></div><div className="auto-flow__chime"><label><input type="checkbox" checked={chimeEnabled} onChange={(e) => setChime(e.target.checked)} /> 切替チャイム</label><button type="button" onClick={() => { void unlockTransitionCue().then(playTransitionCue); }}>チャイムを試す</button></div><div className="auto-flow__setup-actions"><button type="button" onClick={() => onSpeak("音声テストです。聞こえ方をご確認ください。")}>音声テスト</button><button type="button" className="auto-flow__start" onClick={() => void start()}>2時間進行を開始</button></div><Timeline events={buildStandardTwoHourEvents(conditions.introTiming)} currentId={null} firedIds={[]} onSeek={() => undefined} disabled /></section>;
  const remaining = next ? Math.max(0, next.offsetSec - elapsedSec) : 0;
  return <section className="auto-flow" aria-live="polite"><div className="auto-flow__status">{status === "completed" ? "自動進行 完了" : status === "paused" ? "自動進行 一時停止中" : "自動進行中"}</div><p className="auto-flow__current-label">現在のメニュー</p><h1 className="auto-flow__title">{current.title}</h1><div className="auto-flow__countdown"><span>次の切替まで</span><strong>{next ? formatClock(remaining) : "完了"}</strong><small>{formatClock(elapsedSec)} / 02:00:00</small></div>{next && <p className="auto-flow__next">次　<strong>{formatOffset(next.offsetSec)} {next.title}</strong></p>}<div className="auto-flow__actions">{status !== "completed" && <button type="button" className="auto-flow__primary" onClick={status === "paused" ? resume : pause}>{status === "paused" ? "進行を再開" : "進行を一時停止"}</button>}<button type="button" onClick={() => void announce(current, false)}>今の案内を再生</button>{isSpeaking && <button type="button" onClick={stopAudio}>音声を停止</button>}</div><details className="auto-flow__script"><summary>案内内容を見る</summary><p>{current.speakText}</p></details><Timeline events={events} currentId={current.id} firedIds={firedEventIds} onSeek={seek} /><button type="button" className="auto-flow__end" onClick={status === "completed" ? () => void start() : end}>{status === "completed" ? "新しい進行を開始" : "自動進行を終了"}</button></section>;
}

function Setting({ label, children }: { label: string; children: ReactNode }) { return <div><span className="auto-flow__setting-label">{label}</span><div className="auto-flow__choice">{children}</div></div>; }
function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" className={selected ? "is-selected" : ""} onClick={onClick}>{children}</button>; }
function Timeline({ events, currentId, firedIds, onSeek, disabled = false }: { events: AutoFlowEvent[]; currentId: string | null; firedIds: string[]; onSeek: (event: AutoFlowEvent) => void; disabled?: boolean }) { return <div className="auto-timeline" aria-label="自動進行タイムライン">{events.map((event) => <button key={event.id} type="button" disabled={disabled} onClick={() => onSeek(event)} className={`auto-timeline__item${event.id === currentId ? " is-current" : ""}${firedIds.includes(event.id) && event.id !== currentId ? " is-complete" : ""}`}><time>{formatOffset(event.offsetSec)}</time><span>{event.title}</span></button>)}</div>; }
