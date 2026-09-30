"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AutoFlowPanel, { type AutoStatus } from "./AutoFlowPanel";
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
  isSpeakingPaused: boolean;
  onPauseSpeaking: () => void;
  onResumeSpeaking: () => void;
  voiceMode: "standard" | "voicevox" | "recorded";
};
export default function FlowMode({
  speak,
  speakRecorded,
  stopSpeaking,
  isSpeaking,
  isSpeakingPaused,
  onPauseSpeaking,
  onResumeSpeaking,
  voiceMode,
}: Props) {
  const [conditions, setConditions] =
    useState<FlowConditions>(DEFAULT_CONDITIONS);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [autoStatus, setAutoStatus] = useState<AutoStatus>("idle");
  const [editedText, setEditedText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
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
          active={mode === "auto"}
          conditions={conditions}
          onConditionsChange={changeConditions}
          onSpeak={speakRecorded}
          onStopSpeaking={stopSpeaking}
          isSpeaking={isSpeaking}
          onSyncStep={syncStep}
          onStatusChange={setAutoStatus}
        />
      </div>
      <div hidden={mode !== "manual"}>
        {autoOngoing && (
          <div className="flow-background-status" role="status">
            <strong>
              自動進行は{autoStatus === "paused" ? "一時停止中" : "継続中"}です
            </strong>
            <p>音声案内はこの画面では停止しています。</p>
            <button
              type="button"
              className="flow-btn"
              onClick={() => changeMode("auto")}
            >
              自動進行に戻る
            </button>
          </div>
        )}
        <FlowLiveMode
          currentScript={current}
          scriptsForCourt={scripts}
          totalSteps={TOTAL_STEPS}
          isSpeaking={isSpeaking}
          isSpeakingPaused={isSpeakingPaused}
          onSpeak={() =>
            editedText === null
              ? speakRecorded(current.voiceText, current.audioSrc)
              : speak(editedText)
          }
          onPauseSpeaking={onPauseSpeaking}
          onResumeSpeaking={onResumeSpeaking}
          onStop={stopSpeaking}
          onStepJump={jump}
          previewText={editedText ?? current.displayText}
        />
        <FlowExtras speak={speak} active={mode === "manual"} />
        <details className="flow-surface flow-manual-settings">
          <summary>コート数・案内を調整</summary>
          <div className="flow-setting">
            <span>コート数</span>
            <div className="flow-choice">
              {([1, 2] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={autoOngoing}
                  aria-pressed={conditions.courts === c}
                  onClick={() => {
                    stopSpeaking();
                    setEditedText(null);
                    changeConditions({ ...conditions, courts: c });
                  }}
                >
                  {c}面
                </button>
              ))}
            </div>
          </div>
          {autoOngoing && (
            <p className="flow-muted">
              コート数を変えるには自動進行を終了してください。
            </p>
          )}
          <button
            type="button"
            className="flow-btn"
            onClick={() => {
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
                onChange={(e) => setEditedText(e.target.value)}
              />
              <p className="flow-muted">
                編集した文は
                {voiceMode === "voicevox" ? "選択中の音声" : "ブラウザの音声"}
                で読み上げます。STEPを移動すると元の案内に戻ります。
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
        </details>
        <p className="flow-help">
          <Link href="/guide" onClick={stopSpeaking}>
            初めて使う方へ → 使い方
          </Link>
        </p>
      </div>
    </div>
  );
}
