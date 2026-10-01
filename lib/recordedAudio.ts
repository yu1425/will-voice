import { clampAudioVolume, getAudioVolume } from "./audioVolume";

let currentAudio: HTMLAudioElement | null = null;

/** 事前読み込み済みの <audio> をキャッシュ(次に流しそうな音声を先読みしておく) */
const preloadCache = new Map<string, HTMLAudioElement>();

/**
 * 次に読み上げそうな録音音声を先読みしておく(初回再生のラグを減らす)。
 * 実際の再生では使わず、ブラウザのHTTPキャッシュを温めるだけの軽量な処理。
 */
export function preloadRecordedAudio(src: string | undefined): void {
  if (!src || preloadCache.has(src)) return;
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = src;
  audio.load();
  preloadCache.set(src, audio);
}

/**
 * 録音音声（public/audio 以下の音声ファイル）を再生する。
 * 再生に失敗した場合は onError を一度だけ呼ぶ(呼び出し側で標準音声にフォールバック)。
 */
export function playRecordedAudio(
  src: string,
  options?: {
    onEnd?: () => void;
    onError?: () => void;
    volume?: number;
    startAtSec?: number;
  },
): void {
  stopRecordedAudio();

  const audio = new Audio(src);
  audio.volume = clampAudioVolume(options?.volume ?? getAudioVolume());
  currentAudio = audio;
  const seekToSavedPosition = () => {
    if (currentAudio !== audio || !options?.startAtSec) return;
    const maximum = Number.isFinite(audio.duration)
      ? Math.max(0, audio.duration - 0.01)
      : options.startAtSec;
    audio.currentTime = Math.min(Math.max(0, options.startAtSec), maximum);
  };
  if (options?.startAtSec)
    audio.addEventListener("loadedmetadata", seekToSavedPosition, {
      once: true,
    });

  // play() の reject と error イベントは同時に発火しうるため、
  // 終了/エラーのコールバックは最大1回だけ呼ぶようにガードする。
  let settled = false;
  const finish = (cb?: () => void) => {
    if (settled) return;
    settled = true;
    const ownsPlayback = currentAudio === audio;
    if (ownsPlayback) currentAudio = null;
    audio.onended = null;
    audio.onerror = null;
    // A rejected play() may leave paused=false despite a media error. Explicitly release that element.
    audio.pause();
    if (ownsPlayback) cb?.();
  };

  audio.onended = () => finish(options?.onEnd);
  audio.onerror = () => finish(options?.onError);
  audio.play().catch(() => finish(options?.onError));
}

export function stopRecordedAudio(): void {
  if (currentAudio) {
    // 意図的な停止では onEnd/onError を呼ばないようハンドラを外してから止める。
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio = null;
  }
}

/** 録音音声を一時停止する(再生位置は保持する) */
export function pauseRecordedAudio(): void {
  currentAudio?.pause();
}

/** 一時停止中の録音音声を現在位置から再開する */
export function resumeRecordedAudio(): void {
  currentAudio?.play().catch(() => {
    // 再生再開に失敗した場合は、次の読み上げ操作で再試行する。
  });
}

/** 再生位置を変えず、現在の録音へ即座に反映する。 */
export function setRecordedAudioVolume(volume: number): void {
  if (currentAudio) currentAudio.volume = clampAudioVolume(volume);
}

/** Capture before cancelling; one session control owns both clock and this playhead. */
export function getRecordedAudioPosition(): {
  src: string;
  positionSec: number;
} | null {
  if (!currentAudio || currentAudio.ended) return null;
  return {
    src: currentAudio.src,
    positionSec: Number.isFinite(currentAudio.currentTime)
      ? currentAudio.currentTime
      : 0,
  };
}
