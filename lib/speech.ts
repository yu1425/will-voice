/**
 * 音声まわりのユーティリティ
 * ------------------------------------------------------------
 * ブラウザ標準の Web Speech API を使います(無料・APIキー不要)。
 *   - 音声認識:  SpeechRecognition (webkitSpeechRecognition)
 *   - 読み上げ:  SpeechSynthesis
 *
 * 【将来の差し替えポイント】
 *   読み上げをより自然な「うぃる専用ボイス」にしたい場合は、
 *   speakText() の中身を TTS API(例: OpenAI TTS, Google TTS など)に
 *   差し替えてください。呼び出し側(app/page.tsx)は変更不要です。
 */

import { sanitizeForVoicevox } from "./voicevoxText";

// ------------------------------------------------------------
// 型定義 (Web Speech API は標準のTS型に含まれないため最小限を補う)
// ------------------------------------------------------------
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): { transcript: string };
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  };
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** このブラウザが音声認識に対応しているか */
export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/** このブラウザが読み上げに対応しているか */
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// ------------------------------------------------------------
// 音声認識
// ------------------------------------------------------------
export type StartListeningOptions = {
  /** 確定したテキストを受け取る */
  onResult: (text: string) => void;
  /** エラー時 */
  onError?: (message: string) => void;
  /** 認識が終了したとき(マイクが止まったとき) */
  onEnd?: () => void;
  /** 認識言語 (デフォルト 日本語) */
  lang?: string;
};

/** 音声認識の操作ハンドル */
export type ListeningHandle = {
  stop: () => void;
};

/**
 * 音声認識を開始する。
 * @returns 停止用ハンドル。非対応ブラウザでは null。
 */
export function startListening(
  options: StartListeningOptions
): ListeningHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    options.onError?.(
      "このブラウザは音声認識に対応していません。Chrome での利用をおすすめします。"
    );
    return null;
  }

  const recognition = new Ctor();
  recognition.lang = options.lang ?? "ja-JP";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const text = result[0]?.transcript ?? "";
    if (text) {
      options.onResult(text);
    }
  };

  recognition.onerror = (event) => {
    const err = event as Event & { error?: string };
    let message = "音声認識でエラーが発生しました。";
    if (err.error === "not-allowed" || err.error === "service-not-allowed") {
      message = "マイクの使用が許可されていません。ブラウザの設定をご確認ください。";
    } else if (err.error === "no-speech") {
      message = "音声が聞き取れませんでした。もう一度お試しください。";
    }
    options.onError?.(message);
  };

  recognition.onend = () => {
    options.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    options.onError?.("音声認識を開始できませんでした。");
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* no-op */
      }
    },
  };
}

// ------------------------------------------------------------
// 読み上げ (SpeechSynthesis)
// ------------------------------------------------------------
export type SpeakOptions = {
  onStart?: () => void;
  onEnd?: () => void;
  lang?: string;
};

/**
 * テキストを読み上げる。
 *
 * ★将来の差し替えポイント★
 *   「うぃる専用ボイス」を使いたい場合は、ここを TTS API に置き換えます。
 *   (例: fetch("/api/tts") で音声を取得して <audio> で再生)
 */
export function speakText(text: string, options: SpeakOptions = {}): void {
  if (!isSpeechSynthesisSupported()) {
    options.onEnd?.();
    return;
  }

  // 読み上げ前に読み辞書(固有名詞・テニス用語・数字など)を適用する。
  // 標準音声でも VOICEVOX と同じ読みになるよう、共通の補正辞書を通す。
  const spoken = sanitizeForVoicevox(text);

  // 進行中の読み上げがあれば止める
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = options.lang ?? "ja-JP";
  utterance.rate = 1.0;
  utterance.pitch = 1.05; // ほんの少し明るく

  // 日本語ボイスがあれば優先して選ぶ
  const voices = window.speechSynthesis.getVoices();
  const jaVoice = voices.find((v) => v.lang.startsWith("ja"));
  if (jaVoice) {
    utterance.voice = jaVoice;
  }

  utterance.onstart = () => options.onStart?.();
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onEnd?.();

  window.speechSynthesis.speak(utterance);
}

/** 読み上げを止める */
export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}

/**
 * 読み上げ用にテキストを整える。
 * 絵文字や装飾記号は読み上げると不自然なので取り除く。
 * VOICEVOX 経由でも同じ整形が必要なので export している。
 */
export function sanitizeForSpeech(text: string): string {
  return text
    // 主な絵文字を除去
    .replace(/[🎾🙇‍♂️😊😭🙇✨🙌👍]/g, "")
    // 記号類を読みやすく
    .replace(/[「」【】『』]/g, "")
    .replace(/・/g, "、")
    // 余分な空白・改行を整理
    .replace(/\s*\n\s*/g, "。")
    .replace(/。+/g, "。")
    .replace(/\s+/g, " ")
    .trim();
}
