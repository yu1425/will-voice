"use client";
import FlowTransportIcon from "./FlowTransportIcon";
import { useEffect, useState } from "react";
import type { FlowScript } from "@/lib/tennisFlowScripts";
type Props = {
  currentScript: FlowScript;
  scriptsForCourt: FlowScript[];
  totalSteps: number;
  courts: 1 | 2;
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
  courts,
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
        <p className="flow-eyebrow">個別進行 · {courts}面</p>
        <p className="flow-step-position">
          STEP {String(s.step).padStart(2, "0")} / {totalSteps}
        </p>
        <h1>{s.title}</h1>
        <div className="flow-manual__script">
          <h2>案内</h2>
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
            {scriptExpanded ? "全文を閉じる" : "全文を見る"}
          </button>
        </div>
        <div className="flow-audio-heading">
          <span>音声</span>
          <span className="flow-audio-state" role="status">
            {isSpeaking && !isSpeakingPaused ? "再生中" : "待機中"}
          </span>
        </div>
        <div className="flow-actions">
          <button type="button" className="flow-btn" onClick={onSpeak}>
            <FlowTransportIcon kind="replay" />
            もう一度聞く
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
        <button
          type="button"
          className="flow-text-button"
          onClick={isSpeakingPaused ? onResumeSpeaking : onPauseSpeaking}
          disabled={!isSpeaking}
        >
          <FlowTransportIcon kind={isSpeakingPaused ? "play" : "pause"} />
          {isSpeakingPaused ? "音声を再開" : "音声を一時停止"}
        </button>
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
                {s.step === script.step && <small>現在</small>}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
