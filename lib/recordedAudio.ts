let currentAudio: HTMLAudioElement | null = null;

/**
 * 録音音声（public/audio 以下の WAV など）を再生する。
 * 再生に失敗した場合は onError を一度だけ呼ぶ(呼び出し側で標準音声にフォールバック)。
 */
export function playRecordedAudio(
  src: string,
  options?: { onEnd?: () => void; onError?: () => void }
): void {
  stopRecordedAudio();

  const audio = new Audio(src);
  currentAudio = audio;

  // play() の reject と error イベントは同時に発火しうるため、
  // 終了/エラーのコールバックは最大1回だけ呼ぶようにガードする。
  let settled = false;
  const finish = (cb?: () => void) => {
    if (settled) return;
    settled = true;
    if (currentAudio === audio) currentAudio = null;
    audio.onended = null;
    audio.onerror = null;
    cb?.();
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
