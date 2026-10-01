"use client";
import Link from "next/link";
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
import { stopTransitionCue } from "@/lib/transitionCue";

type Props = {
  speak: (text: string, audioSrc?: string) => void;
  speakRecorded: (text: string, audioSrc?: string) => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  voiceMode: "standard" | "voicevox" | "recorded";
  chimeEnabled: boolean;
  onChimePlayingChange: (playing: boolean) => void;
};
export type FlowModeHandle = Pick<
  AutoFlowHandle,
  "stopCurrentAudio" | "playChimeTest" | "playVoiceTest"
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
  const [editing, setEditing] = useState(false);
  const [playbackContext, setPlaybackContext] = useState<
    "step" | "extras" | "auto"
  >("step");
  const autoRef = useRef<AutoFlowHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      stopCurrentAudio: () => autoRef.current?.stopCurrentAudio(),
      playChimeTest: async () => {
        await autoRef.current?.playChimeTest();
      },
      playVoiceTest: () => autoRef.current?.playVoiceTest(),
    }),
    [],
  );
  const [ending, setEnding] = useState(false);
  const speakAuto = useCallback(
    (text: string, audioSrc?: string) => {
      setPlaybackContext("auto");
      speakRecorded(text, audioSrc);
    },
    [speakRecorded],
  );
  const speakExtra = useCallback(
    (text: string, audioSrc?: string) => {
      autoRef.current?.stopCurrentAudio();
      setPlaybackContext("extras");
      speakRecorded(text, audioSrc);
    },
    [speakRecorded],
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
  const syncStep = useCallback((n: number) => {
    setStep(n);
    try {
      localStorage.setItem("will-flow-step", String(n));
    } catch {
      /* no-op */
    }
  }, []);
  const jump = (n: number) => {
    stopSpeaking();
    syncStep(n);
    document.querySelector(".flow-scroll")?.scrollTo({ top: 0 });
    setEditing(false);
    setEditedText(null);
  };
  const scripts = useMemo(
    () => getScriptsForCourt(conditions.courts === 2 ? "double" : "single"),
    [conditions.courts],
  );
  const current = scripts.find((s) => s.step === step) ?? scripts[0];
  const changeMode = (next: typeof mode) => {
    if (next === mode) return;
    stopTransitionCue();
    stopSpeaking();
    setMode(next);
    setEnding(false);
    document.querySelector(".flow-scroll")?.scrollTo({ top: 0 });
    setEditing(false);
    setEditedText(null);
  };
  const autoOngoing = autoStatus === "running" || autoStatus === "paused";
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
      <div hidden={mode !== "auto"}>
        <AutoFlowPanel
          ref={autoRef}
          active={mode === "auto"}
          conditions={conditions}
          onConditionsChange={changeConditions}
          onSpeak={speakAuto}
          onStopSpeaking={stopSpeaking}
          isSpeaking={isSpeaking}
          onSyncStep={syncStep}
          onStatusChange={setAutoStatus}
          chimeEnabled={chimeEnabled}
          onChimePlayingChange={onChimePlayingChange}
        />
      </div>
      <div hidden={mode !== "manual"}>
        {autoOngoing && (
          <div className="flow-background-status" role="status">
            <div className="flow-header">
              <strong>
                自動進行は{autoStatus === "paused" ? "一時停止中" : "継続中"}
                です
              </strong>
              <button
                type="button"
                className="flow-text-button"
                onClick={() => changeMode("auto")}
              >
                自動進行に戻る
              </button>
            </div>
            <p>この画面では自動の音声案内は鳴りません。</p>
          </div>
        )}
        <FlowLiveMode
          currentScript={current}
          scriptsForCourt={scripts}
          totalSteps={TOTAL_STEPS}
          courts={conditions.courts}
          isSpeaking={isSpeaking}
          onSpeak={() => {
            setPlaybackContext("step");
            return editedText === null
              ? speakRecorded(current.voiceText, current.audioSrc)
              : speak(editedText);
          }}
          onStop={stopSpeaking}
          onStepJump={jump}
          previewText={editedText ?? current.displayText}
        />
        <p className="flow-help">
          <Link href="/guide" onClick={stopSpeaking}>
            初めて使う方へ → 使い方
          </Link>
        </p>
      </div>
      <FlowExtras
        speakRecorded={speakExtra}
        stopSpeaking={() => autoRef.current?.stopCurrentAudio()}
        isSpeaking={isSpeaking}
        isCueSpeaking={isSpeaking && playbackContext === "extras"}
        active
      />
      <details className="flow-surface flow-session-settings">
        <summary>開催設定</summary>
        <div className="flow-setting">
          <span>コート数</span>
          {autoOngoing ? (
            <strong>{conditions.courts}面</strong>
          ) : (
            <div className="flow-choice" aria-label="コート数設定">
              {([1, 2] as const).map((courts) => (
                <button
                  key={courts}
                  type="button"
                  aria-pressed={conditions.courts === courts}
                  onClick={() => {
                    autoRef.current?.stopCurrentAudio();
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
        {autoOngoing && (
          <p className="flow-muted">進行中はコート数を変更できません</p>
        )}
        <p className="flow-setting-label">案内文</p>
        <button
          type="button"
          className="flow-btn"
          onClick={() => {
            if (mode === "auto") changeMode("manual");
            stopSpeaking();
            setEditing(!editing);
          }}
        >
          案内文を編集
        </button>
        {editing && (
          <>
            <label className="flow-edit-label" htmlFor="manual-script">
              このSTEPの案内文
            </label>
            <textarea
              id="manual-script"
              value={editedText ?? current.displayText}
              onChange={(event) => setEditedText(event.target.value)}
            />
            <p className="flow-muted">
              編集した文は
              {voiceMode === "voicevox" ? "選択中の音声" : "ブラウザの音声"}
              で読み上げます。STEPを移動すると元に戻ります。
              {voiceMode !== "voicevox" &&
                "音量の変更は次の再生から反映します。"}
            </p>
            <button
              type="button"
              className="flow-btn"
              onClick={() => setEditedText(null)}
            >
              元の案内に戻す
            </button>
          </>
        )}
        {autoStatus !== "idle" && (
          <div className="flow-session-end">
            {!ending ? (
              <button
                type="button"
                className="flow-text-button flow-text-button--danger"
                onClick={() => {
                  if (autoStatus === "completed") {
                    autoRef.current?.endSession();
                    changeMode("auto");
                  } else setEnding(true);
                }}
              >
                {autoStatus === "completed"
                  ? "開始前の画面に戻る"
                  : "自動進行を終了"}
              </button>
            ) : (
              <div className="flow-end-confirm" role="alert">
                <h3>自動進行を終了しますか？</h3>
                <p>進行中の時計と音声を終了し、開始前の画面に戻ります。</p>
                <div className="flow-actions">
                  <button
                    type="button"
                    className="flow-btn"
                    onClick={() => setEnding(false)}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    className="flow-btn flow-btn--danger"
                    onClick={() => {
                      autoRef.current?.endSession();
                      setEnding(false);
                      changeMode("auto");
                      setEditing(false);
                      setEditedText(null);
                    }}
                  >
                    終了する
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </details>
    </div>
  );
});
export default FlowMode;
