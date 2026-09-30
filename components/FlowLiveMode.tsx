"use client";
import FlowTransportIcon from "./FlowTransportIcon";
import { useEffect, useState } from "react";
import type { FlowScript } from "@/lib/tennisFlowScripts";
type Props = {
  currentScript: FlowScript;
  scriptsForCourt: FlowScript[];
  totalSteps: number;
  previewText: string;
  isSpeaking: boolean;
  isSpeakingPaused: boolean;
  onSpeak: () => void;
  onPauseSpeaking: () => void;
  onResumeSpeaking: () => void;
  onStop: () => void;
  onStepJump: (step: number) => void;
};
export default function FlowLiveMode({
  currentScript: s,
  scriptsForCourt,
  totalSteps,
  previewText,
  isSpeaking,
  isSpeakingPaused,
  onSpeak,
  onPauseSpeaking,
  onResumeSpeaking,
  onStop,
  onStepJump,
}: Props) {
  const [scriptExpanded, setScriptExpanded] = useState(false);
  useEffect(() => setScriptExpanded(false), [s.id, previewText]);
  return (
    <div className="flow-manual">
      <section className="flow-surface">
        <header className="flow-header">
          <span className="flow-eyebrow">個別進行</span>
          <span className="flow-status">
            STEP {s.step} / {totalSteps}
          </span>
        </header>
        <h1>{s.title}</h1>
        <div className="flow-manual__script">
          <p
            className={`flow-script-text${scriptExpanded ? "" : " flow-script-text--preview"}`}
          >
            {previewText}
          </p>
          <button
            type="button"
            className="flow-text-button"
            aria-expanded={scriptExpanded}
            onClick={() => setScriptExpanded(!scriptExpanded)}
          >
            {scriptExpanded ? "案内内容を閉じる" : "案内内容をすべて読む"}
          </button>
        </div>
        <div className="flow-actions">
          <button
            type="button"
            className="flow-btn flow-btn--primary flow-btn--full"
            onClick={onSpeak}
          >
            <FlowTransportIcon kind="replay" />
            もう一度聞く
          </button>
          <button
            type="button"
            className="flow-btn"
            onClick={isSpeakingPaused ? onResumeSpeaking : onPauseSpeaking}
            disabled={!isSpeaking}
          >
            <FlowTransportIcon kind={isSpeakingPaused ? "play" : "pause"} />
            {isSpeakingPaused ? "音声を再開" : "音声を一時停止"}
          </button>
          <button
            type="button"
            className="flow-btn"
            onClick={onStop}
            disabled={!isSpeaking}
          >
            <FlowTransportIcon kind="stop" />
            今の音声を止める
          </button>
        </div>
        <p className="flow-audio-state" role="status">
          {isSpeakingPaused
            ? "音声を一時停止中"
            : isSpeaking
              ? "音声案内を再生中"
              : "音声は再生していません"}
        </p>
        <div className="flow-manual__nav">
          <button
            type="button"
            className="flow-btn"
            disabled={s.step === 1}
            onClick={() => onStepJump(s.step - 1)}
          >
            ← 前へ
          </button>
          <button
            type="button"
            className="flow-btn"
            disabled={s.step === totalSteps}
            onClick={() => onStepJump(s.step + 1)}
          >
            次へ →
          </button>
        </div>
      </section>
      <section className="flow-surface">
        <h2 className="flow-list-title">STEP一覧</h2>
        <ol className="flow-step-list">
          {scriptsForCourt.map((script) => (
            <li key={script.id}>
              <button
                type="button"
                aria-current={s.step === script.step ? "step" : undefined}
                onClick={() => onStepJump(script.step)}
              >
                <span>{String(script.step).padStart(2, "0")}</span>
                <strong>{script.title}</strong>
                {s.step === script.step && <small>選択中</small>}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
