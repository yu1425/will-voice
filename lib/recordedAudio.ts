import { clampAudioVolume, getAudioVolume } from "./audioVolume";

const MAX_PLAY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 700;
const DIAGNOSTIC_STORAGE_KEY = "will-recorded-audio-diagnostics";
const MAX_DIAGNOSTICS = 20;

let playbackAudio: HTMLAudioElement | null = null;
let currentAudio: HTMLAudioElement | null = null;
let playbackGeneration = 0;
let retryTimer: number | null = null;

/** 事前読み込み済みの <audio> をキャッシュ(次に流しそうな音声を先読みしておく) */
const preloadCache = new Map<string, HTMLAudioElement>();

type PlaybackFailureReason = "play-rejected" | "media-error";

type PlaybackDiagnostic = {
  at: string;
  src: string;
  attempt: number;
  reason: PlaybackFailureReason;
  errorName: string | null;
  errorMessage: string | null;
  mediaErrorCode: number | null;
  networkState: number;
  readyState: number;
  online: boolean | null;
  visibilityState: string | null;
};

function getPlaybackAudio(): HTMLAudioElement {
  if (!playbackAudio) {
    playbackAudio = new Audio();
    playbackAudio.preload = "auto";
  }
  return playbackAudio;
}
function describeError(error: unknown): {
  name: string | null;
  message: string | null;
} {
  if (!error || typeof error !== "object") {
    return {
      name: null,
      message: typeof error === "string" ? error : null,
    };
  }
  const candidate = error as { name?: unknown; message?: unknown };
  return {
    name: typeof candidate.name === "string" ? candidate.name : null,
    message: typeof candidate.message === "string" ? candidate.message : null,
  };
}

function recordPlaybackFailure(
  audio: HTMLAudioElement,
  src: string,
  attempt: number,
  reason: PlaybackFailureReason,
  error?: unknown,
): void {
  const described = describeError(error);
  const diagnostic: PlaybackDiagnostic = {
    at: new Date().toISOString(),
    src,
    attempt,
    reason,
    errorName: described.name,
    errorMessage: described.message,
    mediaErrorCode: audio.error?.code ?? null,
    networkState: audio.networkState,
    readyState: audio.readyState,
    online: typeof navigator === "undefined" ? null : navigator.onLine,
    visibilityState:
      typeof document === "undefined" ? null : document.visibilityState,
  };

  console.warn("[WILL Voice] recorded audio playback failed", diagnostic);
  if (typeof window === "undefined") return;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DIAGNOSTIC_STORAGE_KEY) ?? "[]",
    );
    const entries = Array.isArray(parsed) ? parsed : [];
    entries.push(diagnostic);
    window.localStorage.setItem(
      DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_DIAGNOSTICS)),
    );
  } catch {
    // Diagnostics must never interfere with playback recovery.
  }
}

function clearPlaybackHandlers(audio: HTMLAudioElement): void {
  audio.onended = null;
  audio.onerror = null;
  audio.onloadedmetadata = null;
}

function clearRetryTimer(): void {
  if (retryTimer === null) return;
  window.clearTimeout(retryTimer);
  retryTimer = null;
}

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
 * 再生要素は使い回し、一時的な失敗は1回だけ自動再試行する。
 * 2回続けて失敗した場合だけ onError を呼ぶ。
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

  const generation = playbackGeneration;
  const audio = getPlaybackAudio();
  currentAudio = audio;
  audio.volume = clampAudioVolume(options?.volume ?? getAudioVolume());
  audio.preload = "auto";
  clearPlaybackHandlers(audio);
  audio.src = src;

  let attempt = 0;
  let attemptSettled = false;
  let finished = false;

  const ownsPlayback = () =>
    generation === playbackGeneration && currentAudio === audio;

  const applyStartPosition = () => {
    if (!ownsPlayback()) return;
    const requested = Math.max(0, options?.startAtSec ?? 0);
    const maximum = Number.isFinite(audio.duration)
      ? Math.max(0, audio.duration - 0.01)
      : requested;
    try {
      audio.currentTime = Math.min(requested, maximum);
    } catch {
      // Metadata may not be ready yet; loadedmetadata will retry the seek.
    }
  };

  const finish = (callback?: () => void) => {
    if (finished || !ownsPlayback()) return;
    finished = true;
    clearRetryTimer();
    clearPlaybackHandlers(audio);
    audio.pause();
    currentAudio = null;
    callback?.();
  };

  const failAttempt = (
    reason: PlaybackFailureReason,
    error?: unknown,
  ): void => {
    if (finished || !ownsPlayback() || attemptSettled) return;
    attemptSettled = true;
    recordPlaybackFailure(audio, src, attempt, reason, error);
    audio.onerror = null;
    audio.onloadedmetadata = null;
    audio.pause();

    if (attempt >= MAX_PLAY_ATTEMPTS) {
      finish(options?.onError);
      return;
    }

    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      if (!ownsPlayback() || finished) return;
      startAttempt(true);
    }, RETRY_DELAY_MS);
  };

  const startAttempt = (reload: boolean) => {
    if (finished || !ownsPlayback()) return;
    attempt += 1;
    attemptSettled = false;
    audio.onerror = () => failAttempt("media-error");
    audio.onloadedmetadata = applyStartPosition;
    if (reload) {
      try {
        audio.load();
      } catch {
        // play() below remains authoritative for whether this attempt succeeds.
      }
    }
    if (audio.readyState >= 1) applyStartPosition();

    let playResult: Promise<void>;
    try {
      playResult = audio.play();
    } catch (error) {
      failAttempt("play-rejected", error);
      return;
    }
    playResult.catch((error) => failAttempt("play-rejected", error));
  };

  audio.onended = () => finish(options?.onEnd);
  startAttempt(true);
}

export function stopRecordedAudio(): void {
  playbackGeneration += 1;
  clearRetryTimer();
  if (!currentAudio) return;

  clearPlaybackHandlers(currentAudio);
  currentAudio.pause();
  currentAudio = null;
}

/** 録音音声を一時停止する(再生位置は保持する) */
export function pauseRecordedAudio(): void {
  currentAudio?.pause();
}

/** 一時停止中の録音音声を現在位置から再開する */
export function resumeRecordedAudio(): void {
  currentAudio?.play().catch((error) => {
    if (!currentAudio) return;
    recordPlaybackFailure(
      currentAudio,
      currentAudio.currentSrc || currentAudio.src,
      1,
      "play-rejected",
      error,
    );
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
