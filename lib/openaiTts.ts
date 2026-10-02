import { getAudioVolume } from "./audioVolume";
import { playRecordedAudio } from "./recordedAudio";

export type OpenAiTtsStatus = {
  configured: boolean;
  model: string;
  voice: string;
};

export type OpenAiTtsResult =
  | { ok: true }
  | { ok: false; reason: string; status?: number };

type SpeakOptions = {
  signal?: AbortSignal;
  startAtSec?: number;
  onEnd?: () => void;
  onError?: () => void;
  flowAudioSrc?: string;
};

const audioCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 24;

function cacheAudio(key: string, url: string) {
  audioCache.set(key, url);
  if (audioCache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = audioCache.keys().next().value;
  if (!oldest) return;
  const oldUrl = audioCache.get(oldest);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  audioCache.delete(oldest);
}
export async function fetchOpenAiTtsStatus(): Promise<OpenAiTtsStatus> {
  const res = await fetch("/api/openai/tts", { cache: "no-store" });
  if (!res.ok) throw new Error("OpenAI TTS status request failed");
  return (await res.json()) as OpenAiTtsStatus;
}

export async function speakWithOpenAiTts(
  text: string,
  options: SpeakOptions = {},
): Promise<OpenAiTtsResult> {
  const input = text.trim();
  if (!input) {
    options.onEnd?.();
    return { ok: true };
  }

  let url = audioCache.get(input);
  if (!url) {
    let res: Response;
    try {
      res = await fetch("/api/openai/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input }),
        signal: options.signal,
      });
    } catch {
      if (options.signal?.aborted) return { ok: false, reason: "aborted" };
      return { ok: false, reason: "AI音声に接続できませんでした。" };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason:
          res.status === 503
            ? "OpenAI APIキーが未設定です。"
            : "AI音声を生成できませんでした。",
      };
    }
    let blob: Blob;
    try {
      blob = await res.blob();
    } catch {
      return {
        ok: false,
        reason: options.signal?.aborted
          ? "aborted"
          : "AI音声を取得できませんでした。",
      };
    }
    if (options.signal?.aborted) return { ok: false, reason: "aborted" };
    url = URL.createObjectURL(blob);
    cacheAudio(input, url);
  }

  playRecordedAudio(url, {
    volume: getAudioVolume(),
    startAtSec: options.startAtSec,
    onEnd: options.onEnd,
    onError: options.onError,
    flowAudioSrc: options.flowAudioSrc,
  });
  return { ok: true };
}
