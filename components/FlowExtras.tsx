"use client";
import { useEffect, useRef, useState } from "react";
import FlowTransportIcon from "./FlowTransportIcon";
import { FLOW_QUICK_CAUTIONS } from "@/lib/flowCautions";
import { FLOW_TIMER_ENDED } from "@/lib/flowCues";
type TimerStatus = "idle" | "running" | "paused" | "ended";
export default function FlowExtras({
  speakRecorded,
  stopSpeaking,
  isSpeaking,
  isCueSpeaking,
  active,
}: {
  speakRecorded: (text: string, audioSrc?: string) => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  isCueSpeaking: boolean;
  active: boolean;
}) {
  const [endAt, setEndAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(300);
  const [selectedMinutes, setSelectedMinutes] = useState(5);
  const [timerStatus, setTimerStatus] = useState<TimerStatus>("idle");
  const [lastCue, setLastCue] = useState<typeof FLOW_TIMER_ENDED | null>(null);
  const deadline = useRef<number | null>(null);
  const callbacks = useRef({ speakRecorded, active });
  callbacks.current = { speakRecorded, active };
  const begin = (seconds: number) => {
    const time = Date.now() + seconds * 1000;
    deadline.current = time;
    setEndAt(time);
    setRemaining(seconds);
    setTimerStatus("running");
  };
  useEffect(() => {
    if (endAt === null) return;
    const tick = () => {
      if (deadline.current !== endAt) return;
      const sec = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setRemaining(sec);
      if (sec !== 0) return;
      // Consume the deadline once, even if playback triggers a parent render.
      deadline.current = null;
      setEndAt(null);
      setTimerStatus("ended");
      if (callbacks.current.active && document.visibilityState === "visible") {
        setLastCue(FLOW_TIMER_ENDED);
        callbacks.current.speakRecorded(
          FLOW_TIMER_ENDED.voiceText,
          FLOW_TIMER_ENDED.audioSrc,
        );
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endAt]);
  const say = (cue: typeof FLOW_TIMER_ENDED) => {
    setLastCue(cue);
    speakRecorded(cue.voiceText, cue.audioSrc);
  };
  return (
    <details className="flow-surface flow-extras">
      <summary>タイマー・声かけ</summary>
      <section className="flow-extras__timer" aria-label="タイマー操作">
        <h2 className="flow-list-title">タイマー</h2>
        <div className="flow-timer-display">
          <strong className="flow-extra-time">
            {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </strong>
          <span role="status">
            {timerStatus === "running"
              ? "進行中"
              : timerStatus === "paused"
                ? "一時停止中"
                : "停止中"}
          </span>
        </div>
        {(timerStatus === "idle" || timerStatus === "ended") && (
          <>
            <p className="flow-setting-label">時間</p>
            <div
              className="flow-choice flow-timer-choice"
              role="group"
              aria-label="タイマーの時間"
            >
              {[5, 10].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={selectedMinutes === minutes}
                  onClick={() => {
                    setSelectedMinutes(minutes);
                    setRemaining(minutes * 60);
                    setTimerStatus("idle");
                  }}
                >
                  {minutes}分
                </button>
              ))}
            </div>
          </>
        )}
        <div
          className={`flow-actions${timerStatus === "idle" ? " flow-timer-actions--idle" : ""}`}
        >
          <button
            type="button"
            className="flow-btn flow-btn--primary"
            onClick={() => {
              if (timerStatus === "running") {
                setRemaining(
                  Math.max(
                    0,
                    Math.ceil(
                      ((deadline.current ?? Date.now()) - Date.now()) / 1000,
                    ),
                  ),
                );
                deadline.current = null;
                setEndAt(null);
                setTimerStatus("paused");
              } else begin(remaining > 0 ? remaining : selectedMinutes * 60);
            }}
          >
            <FlowTransportIcon
              kind={timerStatus === "running" ? "pause" : "play"}
            />
            {timerStatus === "running"
              ? "一時停止"
              : timerStatus === "paused"
                ? "再開"
                : "タイマー開始"}
          </button>
          {timerStatus !== "idle" && (
            <button
              type="button"
              className="flow-btn"
              onClick={() => {
                deadline.current = null;
                setEndAt(null);
                setRemaining(selectedMinutes * 60);
                setTimerStatus("idle");
              }}
            >
              リセット
            </button>
          )}
        </div>
      </section>
      <section className="flow-extras__cues" aria-label="声かけ操作">
        <div className="flow-header">
          <h2 className="flow-list-title">声かけ</h2>
          <span className="flow-muted">ずんだもん</span>
        </div>
        <p className="flow-muted">タップすると、ずんだもんが読み上げます。</p>
        <div className="flow-actions">
          {FLOW_QUICK_CAUTIONS.map((cue) => (
            <button
              key={cue.id}
              type="button"
              className="flow-btn"
              aria-label={cue.label}
              data-playing={isCueSpeaking && lastCue?.id === cue.id}
              onClick={() => say(cue)}
            >
              {cue.label}
              {isCueSpeaking && lastCue?.id === cue.id && <small>再生中</small>}
            </button>
          ))}
        </div>
        <div
          className="flow-extras__audio"
          role="group"
          aria-label="声かけ音声操作"
        >
          <div className="flow-audio-heading">
            <span>音声</span>
            <span className="flow-audio-state" role="status">
              {isCueSpeaking ? "再生中" : "待機中"}
            </span>
          </div>
          <div className="flow-actions">
            <button
              type="button"
              className="flow-btn"
              disabled={!lastCue}
              onClick={() => lastCue && say(lastCue)}
            >
              <FlowTransportIcon kind="replay" />
              もう一度聞く
            </button>
            <button
              type="button"
              className="flow-btn"
              disabled={!isSpeaking}
              onClick={stopSpeaking}
            >
              <FlowTransportIcon kind="stop" />
              今の音声を止める
            </button>
          </div>
        </div>
      </section>
    </details>
  );
}
