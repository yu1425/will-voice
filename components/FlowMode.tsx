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
import AutoFlowPanel, {
  type AutoStatus,
  type AutoFlowHandle,
} from "./AutoFlowPanel";
import FlowLiveMode from "./FlowLiveMode";
import FlowExtras from "./FlowExtras";
import { getScriptsForCourt, TOTAL_STEPS } from "@/lib/tennisFlowScripts";
import { DEFAULT_CONDITIONS, type FlowConditions } from "@/lib/flowPlan";
import { getRecordedAudioPosition } from "@/lib/recordedAudio";

type Props = {
  speak: (text: string, audioSrc?: string) => void;
  speakRecorded: (text: string, audioSrc?: string, startAtSec?: number) => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  voiceMode: "standard" | "voicevox" | "recorded" | "openai";
  chimeEnabled: boolean;
  onChimePlayingChange: (playing: boolean) => void;
};
export type FlowModeHandle = Pick<
  AutoFlowHandle,
  "pauseForNavigation" | "stopCurrentAudio" | "playChimeTest" | "playVoiceTest"
>;
const FlowMode = forwardRef<FlowModeHandle, Props>(function FlowMode(
  {
    speak,
    speakRecorded,
    stopSpeaking,
    isSpeaking,
    voiceMode,
    chimeEnabled,
    onChimePlayingChange,
  },
  ref,
) {
  const [conditions, setConditions] =
    useState<FlowConditions>(DEFAULT_CONDITIONS);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [autoStatus, setAutoStatus] = useState<AutoStatus>("idle");
  const [editedText, setEditedText] = useState<string | null>(null);
  const [manualCursor, setManualCursor] = useState<{
    id: string;
    positionSec: number;
  } | null>(null);
  const [playbackContext, setPlaybackContext] = useState<
    "step" | "extras" | "auto"
  >("step");
  const autoRef = useRef<AutoFlowHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      pauseForNavigation: () => autoRef.current?.pauseForNavigation(),
      stopCurrentAudio: () => autoRef.current?.stopCurrentAudio(),
      playChimeTest: async () => {
        await autoRef.current?.playChimeTest();
      },
      playVoiceTest: () => autoRef.current?.playVoiceTest(),
    }),
    [],
  );
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("will-flow-conditions") ?? "{}",
      );
      if (saved.courts === 1 || saved.courts === 2)
        setConditions({ ...DEFAULT_CONDITIONS, courts: saved.courts });
      const n = Number(localStorage.getItem("will-flow-step"));
      if (Number.isInteger(n) && n >= 1 && n <= TOTAL_STEPS) setStep(n);
    } catch {
      /* no-op */
    }
  }, []);
  const changeConditions = useCallback((c: FlowConditions) => {
    setConditions(c);
    try {
      localStorage.setItem("will-flow-conditions", JSON.stringify(c));
    } catch {
      /* no-op */
    }
  }, []);
  const speakAuto = useCallback(
    (text: string, src?: string, position?: number) => {
      setPlaybackContext("auto");
      speakRecorded(text, src, position);
    },
    [speakRecorded],
  );
  const speakExtra = useCallback(
    (text: string, src?: string) => {
      setManualCursor(null);
      setPlaybackContext("extras");
      speakRecorded(text, src);
    },
    [speakRecorded],
  );
  const scripts = useMemo(
    () => getScriptsForCourt(conditions.courts === 2 ? "double" : "single"),
    [conditions.courts],
  );
  const current = scripts.find((s) => s.step === step) ?? scripts[0];
  const autoOngoing = autoStatus === "running" || autoStatus === "paused";
  const jump = (n: number) => {
    stopSpeaking();
    setStep(n);
    setManualCursor(null);
    setEditedText(null);
    try {
      localStorage.setItem("will-flow-step", String(n));
    } catch {
      /* no-op */
    }
    document.querySelector(".flow-scroll")?.scrollTo({ top: 0 });
  };
  const changeMode = (next: typeof mode) => {
    if (next === mode) return;
    autoRef.current?.pauseForNavigation();
    stopSpeaking();
    setManualCursor(null);
    setEditedText(null);
    setMode(next);
    document.querySelector(".flow-scroll")?.scrollTo({ top: 0 });
  };
  const toggleManual = () => {
    if (isSpeaking && playbackContext === "step") {
      const position = getRecordedAudioPosition();
      setManualCursor(
        position ? { id: current.id, positionSec: position.positionSec } : null,
      );
      stopSpeaking();
      return;
    }
    const position =
      manualCursor?.id === current.id ? manualCursor.positionSec : 0;
    setManualCursor(null);
    setPlaybackContext("step");
    if (editedText === null)
      speakRecorded(current.voiceText, current.audioSrc, position);
    else speak(editedText);
  };
  return (
    <div className="flow-page">
      <div className="flow-mode-switch" role="group" aria-label="進行方法">
        {(["auto", "manual"] as const).map((m) => (
          <button
            type="button"
            key={m}
            aria-pressed={mode === m}
            onClick={() => changeMode(m)}
          >
            {m === "auto" ? "自動進行" : "個別進行"}
          </button>
        ))}
      </div>
      <section
        className={`flow-surface flow-setup${autoOngoing ? " flow-setup--locked" : ""}`}
        aria-label="開催準備"
      >
        <div>
          <h2>{autoOngoing ? "開催情報" : "開催準備"}</h2>
          <p>
            {mode === "auto"
              ? `標準2時間 · ${voiceMode === "openai" ? "AI音声" : "ずんだもん"}`
              : "必要な項目を選んで案内"}
          </p>
        </div>
        <div className="flow-setup-courts">
          <span>コート数</span>
          {autoOngoing ? (
            <strong>{conditions.courts}面</strong>
          ) : (
            <div className="flow-choice" role="group" aria-label="コート数">
              {([1, 2] as const).map((courts) => (
                <button
                  key={courts}
                  type="button"
                  aria-pressed={conditions.courts === courts}
                  onClick={() => {
                    stopSpeaking();
                    setManualCursor(null);
                    setEditedText(null);
                    changeConditions({ ...conditions, courts });
                  }}
                >
                  {courts}面
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      <div hidden={mode !== "auto"}>
        <AutoFlowPanel
          ref={autoRef}
          active={mode === "auto"}
          conditions={conditions}
          onConditionsChange={changeConditions}
          onSpeak={speakAuto}
          onStopSpeaking={stopSpeaking}
          onStatusChange={setAutoStatus}
          chimeEnabled={chimeEnabled}
          onChimePlayingChange={onChimePlayingChange}
        />
      </div>
      <div hidden={mode !== "manual"} className="flow-manual-workspace">
        {autoOngoing && (
          <div className="flow-background-status" role="status">
            <span>自動進行は一時停止中です。</span>
            <button
              type="button"
              className="flow-text-button"
              onClick={() => changeMode("auto")}
            >
              自動進行に戻る →
            </button>
          </div>
        )}
        <FlowLiveMode
          currentScript={current}
          scriptsForCourt={scripts}
          totalSteps={TOTAL_STEPS}
          courts={conditions.courts}
          isSpeaking={isSpeaking && playbackContext === "step"}
          isPaused={manualCursor?.id === current.id}
          onToggle={toggleManual}
          onStepJump={jump}
          previewText={editedText ?? current.displayText}
        />
        <FlowExtras
          speakRecorded={speakExtra}
          stopSpeaking={stopSpeaking}
          isSpeaking={isSpeaking}
          isCueSpeaking={isSpeaking && playbackContext === "extras"}
          active={mode === "manual"}
        />
        <details className="flow-surface flow-session-settings">
          <summary>
            案内文の調整<span className="flow-summary-meta">個別進行のみ</span>
          </summary>
          <label className="flow-edit-label" htmlFor="manual-script">
            {current.title}
          </label>
          <textarea
            id="manual-script"
            value={editedText ?? current.displayText}
            onChange={(event) => {
              stopSpeaking();
              setManualCursor(null);
              setEditedText(event.target.value);
            }}
          />
          <p className="flow-muted">
            編集文は
            {voiceMode === "openai"
              ? "AI音声"
              : voiceMode === "voicevox"
                ? "選択中の音声"
                : "ブラウザの音声"}
            で再生します。項目を変えると元に戻ります。
          </p>
          <button
            type="button"
            className="flow-btn"
            onClick={() => {
              stopSpeaking();
              setManualCursor(null);
              setEditedText(null);
            }}
          >
            元の案内に戻す
          </button>
        </details>
      </div>
    </div>
  );
});
export default FlowMode;
