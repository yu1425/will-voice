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

export type PlaybackDiagnostic = {
  version: 2;
  type: "retry" | "recovery" | "final-failure";
  /** Transient event flag: count a retry only when its play attempt actually starts. */
  retryStarted?: boolean;
  at: string;
  src: string;
  flowAudioSrc?: string;
  attempt: number;
  reason: PlaybackFailureReason | null;
  errorName: string | null;
  errorMessage: string | null;
  mediaErrorCode: number | null;
  networkState: number;
  readyState: number;
  online: boolean | null;
  visibilityState: string | null;
};

export const AUDIO_DIAGNOSTIC_EVENT = "will-recorded-audio-diagnostic";
export function getRecordedAudioDiagnostics(): PlaybackDiagnostic[] {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(DIAGNOSTIC_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (value) =>
          value &&
          typeof value === "object" &&
          typeof value.src === "string" &&
          typeof value.at === "string" &&
          Number.isFinite(Date.parse(value.at)) &&
          [1, 2].includes(value.attempt),
      )
      .slice(-MAX_DIAGNOSTICS)
      .map((value) => ({
        version: 2,
        type:
          value.type === "recovery"
            ? "recovery"
            : value.attempt === 1
              ? "retry"
              : "final-failure",
        at: value.at,
        src: value.src,
        attempt: value.attempt,
        flowAudioSrc:
          typeof value.flowAudioSrc === "string"
            ? value.flowAudioSrc
            : undefined,
        reason: ["play-rejected", "media-error"].includes(value.reason)
          ? value.reason
          : null,
        errorName: typeof value.errorName === "string" ? value.errorName : null,
        errorMessage:
          typeof value.errorMessage === "string" ? value.errorMessage : null,
        mediaErrorCode: Number.isFinite(value.mediaErrorCode)
          ? value.mediaErrorCode
          : null,
        networkState: Number.isFinite(value.networkState)
          ? value.networkState
          : 0,
        readyState: Number.isFinite(value.readyState) ? value.readyState : 0,
        online: typeof value.online === "boolean" ? value.online : null,
        visibilityState:
          typeof value.visibilityState === "string"
            ? value.visibilityState
            : null,
      }));
  } catch {
    return [];
  }
}
export function clearRecordedAudioDiagnostics(): boolean {
  try {
    window.localStorage.removeItem(DIAGNOSTIC_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function getPlaybackAudio(): HTMLAudioElement {
  if (!playbackAudio) {
    playbackAudio = new Audio();
    playbackAudio.preload = "auto";
  }
  return playbackAudio;
}
/** Unlock the reused native element in the tap handler, before asynchronous preparation. */
export async function unlockRecordedAudio(): Promise<void> {
  const audio = getPlaybackAudio();
  const generation = playbackGeneration;
  audio.volume = 0;
  audio.src =
    "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      audio.play(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 1000);
      }),
    ]);
  } catch {
    /* Normal playback retry/diagnostics handle a failed unlock. */
  } finally {
    clearTimeout(timeout);
    if (generation === playbackGeneration) audio.pause();
  }
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

function recordPlaybackDiagnostic(
  audio: HTMLAudioElement,
  src: string,
  attempt: number,
  reason: PlaybackFailureReason | null,
  error?: unknown,
  type: PlaybackDiagnostic["type"] = attempt >= MAX_PLAY_ATTEMPTS
    ? "final-failure"
    : "retry",
  flowAudioSrc?: string,
): PlaybackDiagnostic {
  const described = describeError(error);
  const diagnostic: PlaybackDiagnostic = {
    version: 2,
    type,
    at: new Date().toISOString(),
    src,
    flowAudioSrc,
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

  if (type !== "recovery")
    console.warn("[WILL Voice] recorded audio playback failed", diagnostic);
  if (typeof window === "undefined") return diagnostic;

  try {
    const entries = getRecordedAudioDiagnostics();
    entries.push(diagnostic);
    window.localStorage.setItem(
      DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_DIAGNOSTICS)),
    );
  } catch {
    // Diagnostics must never interfere with playback recovery.
  }
  window.dispatchEvent(
    new CustomEvent(AUDIO_DIAGNOSTIC_EVENT, { detail: diagnostic }),
  );
  return diagnostic;
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
    flowAudioSrc?: string;
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
  let lastFailure: PlaybackDiagnostic | null = null;

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
    lastFailure = recordPlaybackDiagnostic(
      audio,
      src,
      attempt,
      reason,
      error,
      undefined,
      options?.flowAudioSrc,
    );
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
    const attemptNumber = attempt;
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
      if (attemptNumber === 2 && lastFailure)
        window.dispatchEvent(
          new CustomEvent(AUDIO_DIAGNOSTIC_EVENT, {
            detail: {
              ...lastFailure,
              at: new Date().toISOString(),
              attempt: 2,
              retryStarted: true,
            },
          }),
        );
      playResult = audio.play();
    } catch (error) {
      failAttempt("play-rejected", error);
      return;
    }
    playResult
      .then(() => {
        if (
          attemptNumber === 2 &&
          attempt === attemptNumber &&
          !attemptSettled &&
          !finished &&
          ownsPlayback()
        )
          recordPlaybackDiagnostic(
            audio,
            src,
            attempt,
            null,
            undefined,
            "recovery",
            options?.flowAudioSrc,
          );
      })
      .catch((error) => {
        if (attempt === attemptNumber) failAttempt("play-rejected", error);
      });
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
    recordPlaybackDiagnostic(
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
