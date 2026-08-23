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
  options?: { onEnd?: () => void; onError?: () => void; volume?: number }
): void {
  stopRecordedAudio();

  const audio = new Audio(src);
  audio.volume = options?.volume ?? 1;
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
