/**
 * 自動進行の節目に鳴らす、控えめな2音チャイム。
 * 開始ボタンのユーザー操作で AudioContext を unlock し、失敗しても
 * 呼び出し元の読み上げシーケンスを止めない。
 */
let context: AudioContext | null = null;
let activeNodes: OscillatorNode[] = [];

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  context ??= new AudioContextCtor();
  return context;
}

/** ユーザー操作内で呼び、後続のタイマー発火でも鳴らせる状態にする。 */
export async function unlockTransitionCue(): Promise<boolean> {
  try {
    const audioContext = getContext();
    if (!audioContext) return false;
    if (audioContext.state === "suspended") await audioContext.resume();
    return audioContext.state === "running";
  } catch {
    return false;
  }
}

/** 約0.65秒の、柔らかい上昇2音チャイムを再生する。 */
export async function playTransitionCue(): Promise<void> {
  try {
    const audioContext = getContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();
    if (audioContext.state !== "running") return;

    stopTransitionCue();
    const startedAt = audioContext.currentTime + 0.01;
    const tones = [
      { frequency: 880, at: 0, duration: 0.22 },
      { frequency: 1175, at: 0.26, duration: 0.28 },
    ];
    activeNodes = tones.map(({ frequency, at, duration }) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startedAt + at);
      gain.gain.setValueAtTime(0.0001, startedAt + at);
      gain.gain.exponentialRampToValueAtTime(0.075, startedAt + at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + at + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(startedAt + at);
      oscillator.stop(startedAt + at + duration + 0.03);
      oscillator.addEventListener("ended", () => {
        activeNodes = activeNodes.filter((node) => node !== oscillator);
      });
      return oscillator;
    });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 620));
  } catch {
    // 効果音非対応や再生拒否でも、次の音声アナウンスは継続する。
  }
}

export function stopTransitionCue(): void {
  for (const oscillator of activeNodes) {
    try {
      oscillator.stop();
    } catch {
      /* 既に停止済み */
    }
  }
  activeNodes = [];
}
