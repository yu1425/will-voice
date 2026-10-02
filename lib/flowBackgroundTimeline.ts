import { clampAudioVolume, getAudioVolume } from './audioVolume';

export const FLOW_BACKGROUND_TIMELINE_URLS = [
  '/audio/flow/v2/background-timeline-1court-plain.m4a',
  '/audio/flow/v2/background-timeline-1court-chime.m4a',
  '/audio/flow/v2/background-timeline-2court-plain.m4a',
  '/audio/flow/v2/background-timeline-2court-chime.m4a',
] as const;

export function getFlowBackgroundTimelineSrc(
  courts: 1 | 2,
  chimeEnabled: boolean,
): string {
  return `/audio/flow/v2/background-timeline-${courts}court-${chimeEnabled ? 'chime' : 'plain'}.m4a`;
}

let timelineAudio: HTMLAudioElement | null = null;
let activeSrc: string | null = null;

function getTimelineAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!timelineAudio) {
    timelineAudio = document.createElement('audio');
    timelineAudio.preload = 'auto';
    timelineAudio.setAttribute('playsinline', '');
    timelineAudio.setAttribute('webkit-playsinline', '');
    timelineAudio.setAttribute('aria-hidden', 'true');
    timelineAudio.style.display = 'none';
    document.body.appendChild(timelineAudio);
  }
  return timelineAudio;
}

function applySrc(audio: HTMLAudioElement, src: string): boolean {
  if (
    activeSrc === src &&
    new URL(audio.src || src, window.location.href).pathname === src
  )
    return false;
  audio.src = src;
  activeSrc = src;
  audio.load();
  return true;
}

export async function primeFlowBackgroundTimeline(
  courts: 1 | 2,
  chimeEnabled: boolean,
): Promise<boolean> {
  const audio = getTimelineAudio();
  if (!audio) return false;
  const src = getFlowBackgroundTimelineSrc(courts, chimeEnabled);
  try {
    applySrc(audio, src);
    const originalVolume = audio.volume;
    audio.volume = 0;
    audio.currentTime = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.volume = originalVolume;
    return true;
  } catch {
    try { audio.pause(); } catch { /* noop */ }
    return false;
  }
}

export async function playFlowBackgroundTimeline(options: {
  courts: 1 | 2;
  chimeEnabled: boolean;
  positionSec: number;
  onEnded?: () => void;
  onError?: () => void;
}): Promise<boolean> {
  const audio = getTimelineAudio();
  if (!audio) return false;
  const src = getFlowBackgroundTimelineSrc(options.courts, options.chimeEnabled);
  try {
    const sourceChanged = applySrc(audio, src);
    audio.onended = options.onEnded ?? null;
    audio.onerror = options.onError ?? null;
    audio.volume = clampAudioVolume(getAudioVolume());
    const position = Math.max(0, Math.min(7199.9, options.positionSec));
    if (sourceChanged || audio.readyState < 1) {
      await new Promise<void>((resolve) => {
        if (audio.readyState >= 1) {
          resolve();
          return;
        }
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          audio.removeEventListener('loadedmetadata', finish);
          resolve();
        };
        const timeout = window.setTimeout(finish, 5000);
        audio.addEventListener('loadedmetadata', finish, { once: true });
      });
    }
    try {
      audio.currentTime = position;
    } catch {
      /* play() below remains authoritative if seeking is unavailable */
    }
    await audio.play();
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'WILL Voice 自動進行',
          artist: 'WILL.tennis',
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        /* Media Session metadata is optional. */
      }
    }
    return true;
  } catch {
    options.onError?.();
    return false;
  }
}

export function pauseFlowBackgroundTimeline(): number | null {
  const audio = timelineAudio;
  if (!audio) return null;
  try { audio.pause(); } catch { /* noop */ }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = 'paused'; } catch { /* unsupported */ }
  }
  return Number.isFinite(audio.currentTime) ? audio.currentTime : null;
}

export function stopFlowBackgroundTimeline(): void {
  const audio = timelineAudio;
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.onloadedmetadata = null;
  try { audio.pause(); } catch { /* noop */ }
  try { audio.currentTime = 0; } catch { /* noop */ }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = 'none'; } catch { /* unsupported */ }
  }
}

export function getFlowBackgroundTimelinePosition(): number | null {
  const audio = timelineAudio;
  if (!audio || !Number.isFinite(audio.currentTime)) return null;
  return audio.currentTime;
}

export function setFlowBackgroundTimelinePosition(positionSec: number): void {
  const audio = timelineAudio;
  if (!audio) return;
  const position = Math.max(0, Math.min(7199.9, positionSec));
  try {
    audio.currentTime = position;
  } catch {
    /* metadata may not be ready; the next play call reapplies the position */
  }
}

export function isFlowBackgroundTimelinePlaying(): boolean {
  return Boolean(timelineAudio && !timelineAudio.paused && !timelineAudio.ended);
}

export function setFlowBackgroundTimelineVolume(volume: number): void {
  if (timelineAudio) timelineAudio.volume = clampAudioVolume(volume);
}
