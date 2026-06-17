"use client";

/**
 * 進行モードの1ステップを表示するカード。
 *  - 表示用テキスト(displayText)を画面に出す
 *  - 読み上げは選択中の長さ (通常 / 短め / かなり短め) で実行
 *  - 初心者向け補足ボタン (beginnerTip があるときだけ表示)
 *  - 簡易テキスト編集、コピー、停止/再生
 */

import { useState } from "react";
import type { FlowScript, VoiceLength } from "@/lib/tennisFlowScripts";
import { sanitizeForVoicevox } from "@/lib/voicevoxText";

type Props = {
  script: FlowScript;
  /** 編集後のテキスト(undefined なら未編集) */
  editedText: string | undefined;
  /** 実際に読み上げに渡すテキスト(人数調整プレフィックス込み・補正前) */
  speakingText: string;
  isEditing: boolean;
  isSpeaking: boolean;
  voiceLength: VoiceLength;
  onVoiceLengthChange: (l: VoiceLength) => void;
  onSpeak: () => void;
  onSpeakBeginnerTip: () => void;
  onStop: () => void;
  onCopy: () => Promise<void> | void;
  onEditToggle: () => void;
  onEditChange: (value: string) => void;
  onEditReset: () => void;
};

const LENGTH_OPTIONS: { value: VoiceLength; label: string }[] = [
  { value: "normal", label: "通常" },
  { value: "short", label: "短め" },
  { value: "veryShort", label: "かなり短め" },
];

export default function FlowStepCard({
  script,
  editedText,
  speakingText,
  isEditing,
  isSpeaking,
  voiceLength,
  onVoiceLengthChange,
  onSpeak,
  onSpeakBeginnerTip,
  onStop,
  onCopy,
  onEditToggle,
  onEditChange,
  onEditReset,
}: Props) {
  const [copiedFlash, setCopiedFlash] = useState(false);

  const displayedText = editedText !== undefined ? editedText : script.displayText;
  const isEdited = editedText !== undefined;

  const handleCopy = async () => {
    await onCopy();
    setCopiedFlash(true);
    window.setTimeout(() => setCopiedFlash(false), 1500);
  };

  return (
    <div className="flow-card">
      <div className="flow-card__head">
        <span className="flow-card__step">STEP {script.step}</span>
        <h2 className="flow-card__title">{script.title}</h2>
        {script.audioSrc && (
          <span className="flow-card__audio-tag">録音音声あり</span>
        )}
        {isEdited && <span className="flow-card__edited-tag">編集済み</span>}
      </div>

      {/* 読み上げの長さ切替 */}
      <div className="flow-card__length" role="radiogroup" aria-label="読み上げの長さ">
        <span className="flow-card__length-label">読み上げの長さ:</span>
        {LENGTH_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={voiceLength === o.value}
            className={`flow-card__length-btn ${
              voiceLength === o.value ? "flow-card__length-btn--active" : ""
            }`}
            onClick={() => onVoiceLengthChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {isEditing ? (
        <textarea
          className="flow-card__edit"
          value={displayedText}
          onChange={(e) => onEditChange(e.target.value)}
          rows={Math.max(8, displayedText.split("\n").length + 1)}
          aria-label="セリフを編集"
        />
      ) : (
        <div className="flow-card__body">{displayedText}</div>
      )}

      <div className="flow-card__actions">
        {isSpeaking ? (
          <button
            type="button"
            className="flow-card__btn flow-card__btn--stop"
            onClick={onStop}
          >
            ■ 停止
          </button>
        ) : (
          <button
            type="button"
            className="flow-card__btn flow-card__btn--primary"
            onClick={onSpeak}
          >
            ▶ 読み上げ
          </button>
        )}

        {script.beginnerTip && (
          <button
            type="button"
            className="flow-card__btn flow-card__btn--tip"
            onClick={onSpeakBeginnerTip}
            title={script.beginnerTip}
          >
            初心者向け補足を読む
          </button>
        )}

        <button
          type="button"
          className="flow-card__btn"
          onClick={handleCopy}
        >
          {copiedFlash ? "コピー済み" : "コピー"}
        </button>

        <button
          type="button"
          className="flow-card__btn"
          onClick={onEditToggle}
        >
          {isEditing ? "編集を終了" : "編集"}
        </button>

        {isEdited && (
          <button
            type="button"
            className="flow-card__btn flow-card__btn--ghost"
            onClick={onEditReset}
            title="元の文面に戻します"
          >
            元に戻す
          </button>
        )}
      </div>

      <p className="flow-card__hint">
        読み上げは{isEdited ? "編集後のテキスト" : `「${LENGTH_OPTIONS.find((o) => o.value === voiceLength)?.label}」`}を使います。
        参加人数を入力していると、対象のステップでは人数に応じた一言が冒頭に加わります。
      </p>

      {/* 読み上げ確認(デバッグ用・通常は折りたたみ) */}
      <details className="flow-card__inspect">
        <summary className="flow-card__inspect-summary">読み上げ確認</summary>
        <div className="flow-card__inspect-body">
          <div className="flow-card__inspect-block">
            <span className="flow-card__inspect-label">表示用テキスト</span>
            <pre className="flow-card__inspect-text">{displayedText}</pre>
          </div>
          <div className="flow-card__inspect-block">
            <span className="flow-card__inspect-label">読み上げ用テキスト</span>
            <pre className="flow-card__inspect-text">{speakingText}</pre>
          </div>
          <div className="flow-card__inspect-block">
            <span className="flow-card__inspect-label">
              補正後にVOICEVOXへ送る最終テキスト
            </span>
            <pre className="flow-card__inspect-text flow-card__inspect-text--final">
              {sanitizeForVoicevox(speakingText)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}
