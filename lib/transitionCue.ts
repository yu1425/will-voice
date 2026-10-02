import { clampAudioVolume, getAudioVolume } from "./audioVolume";

/** 自動進行の節目に鳴らす転換音（OtoLogic「場面展開07-05」）。 */
const TRANSITION_CUE_SRC = "/audio/flow/v2/transition-scene-change07.mp3";
let transitionAudio: HTMLAudioElement | null = null;
let playbackGeneration = 0;
let finishPlayback: (() => void) | null = null;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof window.Audio !== "function")
    return null;
  if (!transitionAudio) {
    transitionAudio = new window.Audio(TRANSITION_CUE_SRC);
    transitionAudio.preload = "auto";
  }
  return transitionAudio;
}

/** ユーザー操作内で同じ要素を無音再生し、後続のタイマー再生に備える。 */
export async function unlockTransitionCue(): Promise<boolean> {
  stopTransitionCue();
  const ticket = playbackGeneration;
  try {
    const audio = getAudio();
    if (!audio) return false;
    audio.muted = true;
    await audio.play();
    return ticket === playbackGeneration;
  } catch {
    return false;
  } finally {
    // An old unlock must not pause or unmute a newer playback.
    if (ticket === playbackGeneration) stopTransitionCue();
  }
}

/** ファイルの再生終了まで待機する。停止・再生失敗時も待機を解放する。 */
export async function playTransitionCue(): Promise<void> {
  try {
    stopTransitionCue();
    const ticket = playbackGeneration;
    const audio = getAudio();
    if (!audio) return;
    audio.volume = getAudioVolume();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", finish);
        if (ticket === playbackGeneration) {
          audio.pause();
          finishPlayback = null;
        }
        resolve();
      };
      finishPlayback = finish;
      audio.addEventListener("ended", finish);
      audio.addEventListener("error", finish);
      try {
        audio.play().catch(finish);
      } catch {
        finish();
      }
    });
  } catch {
    // 効果音非対応や再生拒否でも、次の音声アナウンスは継続する。
  }
}

export function stopTransitionCue(): void {
  playbackGeneration++;
  finishPlayback?.();
  finishPlayback = null;
  if (transitionAudio) {
    transitionAudio.pause();
    transitionAudio.muted = false;
    // 一時停止中の転換音は、既存の進行制御に従って再開時に先頭から鳴らす。
    transitionAudio.currentTime = 0;
  }
}

export function setTransitionCueVolume(volume: number): void {
  if (transitionAudio) transitionAudio.volume = clampAudioVolume(volume);
}
