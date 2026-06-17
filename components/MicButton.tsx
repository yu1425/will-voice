/**
 * マイクボタン
 * ------------------------------------------------------------
 * 押すと音声認識を開始/停止します。
 * 状態に応じて見た目とラベルが変わります。
 */

type Props = {
  /** 認識中かどうか */
  isListening: boolean;
  /** 押せない状態(読み上げ中・処理中・非対応など) */
  disabled?: boolean;
  onClick: () => void;
};

export default function MicButton({ isListening, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      className={`mic-button ${isListening ? "mic-button--active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isListening}
      aria-label={isListening ? "音声入力を停止" : "音声で話しかける"}
    >
      <span className="mic-button__icon" aria-hidden="true">
        {isListening ? "■" : "🎤"}
      </span>
      <span className="mic-button__label">
        {isListening ? "聞いています…" : "押して話す"}
      </span>
    </button>
  );
}
