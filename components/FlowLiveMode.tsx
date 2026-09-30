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
import { TENNIS_FLOW_SCRIPTS, type FlowScript } from "@/lib/tennisFlowScripts";
import type { ReactNode } from "react";

type Props = {
  autoFlow: ReactNode;
  manualControlsDisabled: boolean;
  currentScript: FlowScript;
  nextScript: FlowScript | null;
  /** 実際に読み上げる予定のテキスト */
  previewText: string;
  /** 次STEPで実際に読み上げる予定のテキスト */
  nextPreviewText: string | null;
  /** 現在STEPで録音音声と recordedText のセットを使うか */
  usesRecordedAudio: boolean;
  isSpeaking: boolean;
  isSpeakingPaused: boolean;
  totalSteps: number;
  onSpeak: () => void;
  onPauseSpeaking: () => void;
  onResumeSpeaking: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSpeakRaw: (text: string) => void;
  scriptsForCourt: FlowScript[];
  onStepJump: (step: number) => void;
  voiceMode: "standard" | "voicevox" | "recorded";
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

/** 次ステップの中身を一目で把握できるよう、短い一言だけ抜き出す */
function nextStepPreview(source: string): string {
  const firstLine = source.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

export default function FlowLiveMode({
  autoFlow,
  manualControlsDisabled,
  currentScript,
  nextScript,
  previewText,
  nextPreviewText,
  usesRecordedAudio,
  isSpeaking,
  isSpeakingPaused,
  totalSteps,
  onSpeak,
  onPauseSpeaking,
  onResumeSpeaking,
  onStop,
  onPrev,
  onNext,
  onSpeakRaw,
  scriptsForCourt,
  onStepJump,
  voiceMode,
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
      {autoFlow}
      {/* 優先表示エリア: 現在ステップ・読み上げ・次へ/戻る */}
      <div className="flow-live__top">
        {/* 現在ステップの強調表示 */}
        <div className="flow-surface flow-live__hero">
          <header className="flow-section-head">
            <div>
              <span className="flow-eyebrow">INDIVIDUAL FLOW</span>
              <h1 className="flow-section-title">{currentScript.title}</h1>
            </div>
            <span className="flow-duration-badge">
              STEP {currentScript.step} / {totalSteps}
            </span>
          </header>
          {nextScript ? (
            <>
              <p className="flow-live__next-hint">
                次: <span className="flow-live__next-label">{nextScript.title}</span>
              </p>
              {nextPreviewText && (
                <p className="flow-live__next-preview">
                  {nextStepPreview(nextPreviewText)}
                </p>
              )}
            </>
          ) : (
            <p className="flow-live__next-hint">これが最後のステップです</p>
          )}
        </div>

        {/* 読み上げ予定テキスト */}
        <div className="flow-live__preview" aria-label="読み上げ予定">
          {usesRecordedAudio && (
            <span className="flow-live__recorded-label">録音音声</span>
          )}
          {previewText}
        </div>

        {/* 音声操作は再生状態で位置や個数を変えない */}
        <div className="flow-action-grid flow-live__main">
          <button
            type="button"
            className="flow-btn flow-btn--primary"
            onClick={onSpeak}
          >
            {isSpeaking ? "案内を最初から再生" : "案内を再生"}
          </button>
          <button
            type="button"
            className="flow-btn flow-btn--secondary"
            onClick={isSpeakingPaused ? onResumeSpeaking : onPauseSpeaking}
            disabled={!isSpeaking}
          >
            {isSpeakingPaused ? "音声を再開" : "音声を一時停止"}
          </button>
          <button
            type="button"
            className="flow-btn flow-btn--secondary"
            onClick={onStop}
            disabled={!isSpeaking}
          >
            音声を停止
          </button>
        </div>

        {/* 次へ (大) / 戻る (小) */}
        <div className="flow-live__nav">
          <button
            type="button"
            className="flow-live__next-btn"
            onClick={onNext}
            disabled={isLast || manualControlsDisabled}
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
            disabled={isFirst || manualControlsDisabled}
          >
            ← 戻る
          </button>
        </div>
      </div>

      {/* 補助操作エリア: ステップ一覧・タイマー・クイック注意喚起 */}
      <div className="flow-live__scroll">
        {manualControlsDisabled && (
          <p className="flow-live__manual-note">
            自動進行中はタイムラインに合わせて手動ステップ移動を止めています。
          </p>
        )}
        {/* ステップ一覧チップ */}
        <div className="flow-live__steps" role="tablist" aria-label="ステップ選択">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => {
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
                disabled={manualControlsDisabled}
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
          <div className="flow-live__quick-head">
            クイック注意喚起
            {voiceMode === "recorded" && (
              <span className="flow-live__quick-note">(標準音声で読み上げます)</span>
            )}
          </div>
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
          音声テスト
        </button>
      </div>
    </div>
  );
}
