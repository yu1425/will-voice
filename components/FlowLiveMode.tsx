"use client";
import FlowTransportIcon from "./FlowTransportIcon";
import type { FlowScript } from "@/lib/tennisFlowScripts";
type Props = {
  currentScript: FlowScript;
  scriptsForCourt: FlowScript[];
  totalSteps: number;
  courts: 1 | 2;
  previewText: string;
  isSpeaking: boolean;
  isPaused: boolean;
  onToggle: () => void;
  onStepJump: (step: number) => void;
};
export default function FlowLiveMode({
  currentScript: s,
  scriptsForCourt,
  totalSteps,
  previewText,
  isSpeaking,
  isPaused,
  onToggle,
  onStepJump,
}: Props) {
  return (
    <div className="flow-manual">
      <section className="flow-surface" aria-label="個別の案内">
        <header className="flow-header">
          <span className="flow-eyebrow">
            STEP {String(s.step).padStart(2, "0")} / {totalSteps}
          </span>
          <span className="flow-status">
            {isSpeaking ? "案内中" : isPaused ? "一時停止中" : "選択中"}
          </span>
        </header>
        <h1>{s.title}</h1>
        <p className="flow-script-text flow-script-text--preview">
          {previewText}
        </p>
        <div
          className="flow-manual-transport"
          role="group"
          aria-label="選択した案内の操作"
        >
          <button
            type="button"
            className="flow-btn"
            aria-label="前の項目へ"
            disabled={s.step === 1}
            onClick={() => onStepJump(s.step - 1)}
          >
            ←
          </button>
          <button
            type="button"
            className="flow-btn flow-btn--primary"
            onClick={onToggle}
          >
            <FlowTransportIcon kind={isSpeaking ? "pause" : "play"} />
            {isSpeaking
              ? "一時停止"
              : isPaused
                ? "続きから再生"
                : "この案内を再生"}
          </button>
          <button
            type="button"
            className="flow-btn"
            aria-label="次の項目へ"
            disabled={s.step === totalSteps}
            onClick={() => onStepJump(s.step + 1)}
          >
            →
          </button>
        </div>
        <p className="flow-player-hint">
          項目を選び、必要なタイミングで再生します。
        </p>
        <details key={s.id} className="flow-script">
          <summary>このメニューの案内</summary>
          <p>{previewText}</p>
        </details>
      </section>
      <details className="flow-surface flow-overview" open>
        <summary>
          案内を選ぶ<span className="flow-summary-meta">{totalSteps}項目</span>
        </summary>
        <ol className="flow-menu-grid flow-menu-grid--manual">
          {scriptsForCourt.map((script) => (
            <li
              key={script.id}
              className={s.step === script.step ? "is-current" : ""}
            >
              <button
                type="button"
                aria-label={`${String(script.step).padStart(2, "0")} ${script.title}`}
                aria-current={s.step === script.step ? "step" : undefined}
                onClick={() => onStepJump(script.step)}
              >
                <span className="flow-menu-grid__number">
                  {String(script.step).padStart(2, "0")}
                </span>
                <strong>{script.title}</strong>
              </button>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
