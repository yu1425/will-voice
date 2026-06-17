let currentAudio: HTMLAudioElement | null = null;

export function playRecordedAudio(
  src: string,
  options?: { onEnd?: () => void; onError?: () => void }
): void {
  stopRecordedAudio();
  const audio = new Audio(src);
  currentAudio = audio;
  audio.onended = () => {
    currentAudio = null;
    options?.onEnd?.();
  };
  audio.onerror = () => {
    currentAudio = null;
    options?.onError?.();
  };
  audio.play().catch(() => {
    currentAudio = null;
    options?.onError?.();
  });
}

export function stopRecordedAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio = null;
  }
}
