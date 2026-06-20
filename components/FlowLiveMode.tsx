"use client";

/**
 * 進行モード - 当日モード
 * ============================================================
 *  テニス会の当日、コート上でスマホ片手で使う前提のシンプル画面。
 *
 *  - 大きい「読み上げ」「次へ」ボタン
 *  - 小さい「戻る」
 *  - 現在ステップを強く表示、次のステップを下に小さく
 *  - 6つのクイック注意喚起 + 音声テスト
 *  - タイマー(5分/10分/一時停止/リセット)
 *
 *  細かい設定(編集・コピー・条件入力・プラン)は準備モードに任せる。
 * ============================================================
 */

import { FLOW_QUICK_CAUTIONS, VOICE_TEST_TEXT } from "@/lib/flowCautions";
import type { FlowScript } from "@/lib/tennisFlowScripts";
import { TENNIS_FLOW_SCRIPTS, TOTAL_STEPS } from "@/lib/tennisFlowScripts";

type Props = {
  currentScript: FlowScript;
  nextScript: FlowScript | null;
  /** 実際に読み上げる予定のテキスト(人数調整プレフィックス込みの可能性あり) */
  previewText: string;
  isSpeaking: boolean;
  totalSteps: number;
  onSpeak: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSpeakRaw: (text: string) => void;
  scriptsForCourt: FlowScript[];
  onStepJump: (step: number) => void;
  // Timer
  timerRemaining: number;
  timerRunning: boolean;
  timerSec: number;
  onStartTimer: (sec: number) => void;
  onPauseTimer: () => void;
  onResetTimer: () => void;
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function FlowLiveMode({
  currentScript,
  nextScript,
  previewText,
  isSpeaking,
  totalSteps,
  onSpeak,
  onStop,
  onPrev,
  onNext,
  onSpeakRaw,
  scriptsForCourt,
  onStepJump,
  timerRemaining,
  timerRunning,
  timerSec,
  onStartTimer,
  onPauseTimer,
  onResetTimer,
}: Props) {
  const isFirst = currentScript.step === 1;
  const isLast = currentScript.step === totalSteps;

  return (
    <div className="flow-live">
      {/* 現在ステップの強調表示 */}
      <div className="flow-live__hero">
        <div className="flow-live__step-badge">
          STEP {currentScript.step} / {totalSteps}
        </div>
        <h1 className="flow-live__title">{currentScript.title}</h1>
        {nextScript ? (
          <p className="flow-live__next-hint">
            次: <span className="flow-live__next-label">{nextScript.title}</span>
          </p>
        ) : (
          <p className="flow-live__next-hint">これが最後のステップです</p>
        )}
      </div>

      {/* 読み上げ予定テキスト */}
      <div className="flow-live__preview" aria-label="読み上げ予定">
        {previewText}
      </div>

      {/* メインの読み上げ/停止 */}
      <div className="flow-live__main">
        {isSpeaking ? (
          <button
            type="button"
            className="flow-live__big flow-live__big--stop"
            onClick={onStop}
          >
            ■ 停止
          </button>
        ) : (
          <button
            type="button"
            className="flow-live__big flow-live__big--primary"
            onClick={onSpeak}
          >
            ▶ 読み上げ
          </button>
        )}
      </div>

      {/* 次へ (大) / 戻る (小) */}
      <div className="flow-live__nav">
        <button
          type="button"
          className="flow-live__next-btn"
          onClick={onNext}
          disabled={isLast}
        >
          次へ →
          {nextScript && (
            <span className="flow-live__next-sub"> STEP {nextScript.step} {nextScript.shortLabel}</span>
          )}
        </button>
        <button
          type="button"
          className="flow-live__back-btn"
          onClick={onPrev}
          disabled={isFirst}
        >
          ← 戻る
        </button>
      </div>

      {/* ステップ一覧チップ */}
      <div className="flow-live__steps" role="tablist" aria-label="ステップ選択">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => {
          const matched =
            scriptsForCourt.find((s) => s.step === n) ??
            TENNIS_FLOW_SCRIPTS.find((s) => s.step === n);
          const isActive = currentScript.step === n;
          return (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`flow-step-chip ${
                isActive ? "flow-step-chip--active" : ""
              }`}
              onClick={() => onStepJump(n)}
              title={matched?.title}
            >
              <span className="flow-step-chip__num">{n}</span>
              <span className="flow-step-chip__label">
                {matched?.shortLabel ?? ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* タイマー(コンパクト) */}
      <div className="flow-live__timer">
        <span
          className={`flow-live__timer-time ${
            timerRunning ? "flow-live__timer-time--running" : ""
          } ${timerRemaining === 0 ? "flow-live__timer-time--done" : ""}`}
        >
          {formatTime(timerRemaining)}
        </span>
        <div className="flow-live__timer-btns">
          <button
            type="button"
            className="flow-live__timer-btn"
            onClick={() => onStartTimer(5 * 60)}
            disabled={timerRunning}
          >
            5分
          </button>
          <button
            type="button"
            className="flow-live__timer-btn"
            onClick={() => onStartTimer(10 * 60)}
            disabled={timerRunning}
          >
            10分
          </button>
          {timerRunning ? (
            <button
              type="button"
              className="flow-live__timer-btn flow-live__timer-btn--warn"
              onClick={onPauseTimer}
            >
              一時停止
            </button>
          ) : (
            <button
              type="button"
              className="flow-live__timer-btn"
              onClick={onResetTimer}
              disabled={timerRemaining === timerSec}
            >
              リセット
            </button>
          )}
        </div>
      </div>

      {/* クイック注意喚起 */}
      <div className="flow-live__quick">
        <div className="flow-live__quick-head">クイック注意喚起</div>
        <div className="flow-live__quick-grid">
          {FLOW_QUICK_CAUTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flow-live__quick-btn"
              onClick={() => onSpeakRaw(c.voiceText)}
              title={c.voiceText}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* 音声テスト */}
      <button
        type="button"
        className="flow-live__test-btn"
        onClick={() => onSpeakRaw(VOICE_TEST_TEXT)}
      >
        🔊 音声テスト
      </button>
    </div>
  );
}
