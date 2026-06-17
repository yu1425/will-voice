/**
 * VOICEVOX 読み上げユーティリティ (クライアント側)
 * ============================================================
 *  - サーバー側の Route Handler (app/api/voicevox/tts) に
 *    テキストを送り、返ってきた WAV を <audio> 再生します。
 *  - VOICEVOX ENGINE が起動していない / 通信失敗の場合は、
 *    既存の SpeechSynthesis (lib/speech.ts) にフォールバックします。
 *
 *  使い方:
 *    const result = await speakWithVoicevox(text, { speakerId: 3 });
 *    if (result.usedFallback) {
 *      // 「VOICEVOXが見つからなかったため、標準音声で読み上げます」など
 *    }
 *
 *  ※ ブラウザから直接 http://127.0.0.1:50021 を叩かないこと(CORS/接続先制約)。
 *     必ず /api/voicevox/tts を経由します。
 * ============================================================
 */

import { speakText, type SpeakOptions } from "./speech";
import { sanitizeForVoicevox } from "./voicevoxText";

/** VOICEVOX 既定の speaker id (ずんだもん ノーマル想定。環境変数で上書き可) */
export const DEFAULT_VOICEVOX_SPEAKER_ID = 3;

/** 1つの再生セッションを止めるためのハンドル */
export type VoicevoxHandle = {
  stop: () => void;
};

/** VOICEVOX 音声パラメータ(任意で上書き可能) */
export type VoicevoxAudioParams = {
  speedScale?: number;
  pitchScale?: number;
  intonationScale?: number;
  volumeScale?: number;
  prePhonemeLength?: number;
  postPhonemeLength?: number;
};

export type SpeakWithVoicevoxOptions = SpeakOptions & {
  /** ずんだもんなどの speaker id (省略時は既定値) */
  speakerId?: number;
  /** 音声パラメータの上書き(指定したものだけ反映) */
  params?: VoicevoxAudioParams;
  /** AbortSignal 経由でキャンセルしたい場合 */
  signal?: AbortSignal;
};

export type SpeakWithVoicevoxResult = {
  /** VOICEVOX が使えず、標準音声(SpeechSynthesis)にフォールバックしたか */
  usedFallback: boolean;
  /** フォールバック理由(ユーザー向け表示に使える) */
  fallbackReason?: string;
  /** 再生ハンドル(VOICEVOX/SpeechSynthesis どちらでも対応) */
  handle?: VoicevoxHandle;
};

let currentAudio: HTMLAudioElement | null = null;

/**
 * VOICEVOX で読み上げる。失敗時は標準音声にフォールバック。
 */
export async function speakWithVoicevox(
  text: string,
  options: SpeakWithVoicevoxOptions = {}
): Promise<SpeakWithVoicevoxResult> {
  // クライアント側でも読み補正をかけておく。
  // こうしておくと、サーバー(route handler)が古いコードのままでも、
  // すでに補正済みのテキストが VOICEVOX ENGINE に届く(二重適用は冪等)。
  const spoken = sanitizeForVoicevox(text);
  if (!spoken) {
    options.onEnd?.();
    return { usedFallback: false };
  }

  // 進行中の再生があれば止める
  stopVoicevox();

  try {
    const res = await fetch("/api/voicevox/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spoken,
        speakerId: options.speakerId ?? DEFAULT_VOICEVOX_SPEAKER_ID,
        params: options.params,
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      // VOICEVOX ENGINE 未起動 (503) / その他エラー → 標準音声に切替
      const reason =
        res.status === 503
          ? "VOICEVOXが見つからなかったため、標準音声で読み上げます"
          : "VOICEVOXの応答が得られなかったため、標準音声で読み上げます";
      return fallback(text, options, reason);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    audio.addEventListener("play", () => options.onStart?.());
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
    };
    audio.addEventListener("ended", () => {
      cleanup();
      options.onEnd?.();
    });
    audio.addEventListener("error", () => {
      cleanup();
      options.onEnd?.();
    });

    try {
      await audio.play();
    } catch {
      // autoplay 拒否などの再生失敗 → 標準音声に逃がす
      cleanup();
      return fallback(text, options, "音声を再生できなかったため、標準音声で読み上げます");
    }

    return {
      usedFallback: false,
      handle: {
        stop: () => {
          audio.pause();
          cleanup();
        },
      },
    };
  } catch {
    // ネットワーク失敗・タイムアウト等
    return fallback(
      text,
      options,
      "VOICEVOXに接続できなかったため、標準音声で読み上げます"
    );
  }
}

/** 現在の VOICEVOX 再生を止める */
export function stopVoicevox(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* no-op */
    }
    currentAudio = null;
  }
}

/** VOICEVOX ENGINE が利用可能か確認(speakers が取れるか) */
export async function checkVoicevoxAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/voicevox/speakers", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export type VoicevoxSpeaker = {
  name: string;
  speaker_uuid: string;
  styles: { id: number; name: string }[];
};

/** 利用可能な話者一覧(ずんだもんなどを探す用) */
export async function fetchVoicevoxSpeakers(): Promise<{
  ok: boolean;
  defaultSpeakerId?: number;
  speakers?: VoicevoxSpeaker[];
  error?: string;
}> {
  try {
    const res = await fetch("/api/voicevox/speakers", { cache: "no-store" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      ok: true,
      defaultSpeakerId: data.defaultSpeakerId,
      speakers: data.speakers,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 話者一覧から「ずんだもん」のスタイル一覧だけを抜き出す。
 * speaker_uuid の若干の表記揺れも考慮し、まず name で一致を試す。
 */
export type ZundamonStyle = {
  styleId: number;
  styleName: string;
};

export function pickZundamonStyles(
  speakers: VoicevoxSpeaker[] | undefined
): ZundamonStyle[] {
  if (!speakers) return [];
  const zundamon = speakers.find((s) => s.name.includes("ずんだもん"));
  if (!zundamon) return [];
  return zundamon.styles.map((style) => ({
    styleId: style.id,
    styleName: style.name,
  }));
}

/** 標準音声へのフォールバック共通処理 */
function fallback(
  text: string,
  options: SpeakWithVoicevoxOptions,
  reason: string
): SpeakWithVoicevoxResult {
  speakText(text, {
    onStart: options.onStart,
    onEnd: options.onEnd,
    lang: options.lang,
  });
  return { usedFallback: true, fallbackReason: reason };
}
