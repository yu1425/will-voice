/**
 * 自動進行の節目に鳴らす告知チャイム。
 * 屋外やBluetoothスピーカーでも切替に気づきやすいよう、
 * 3打のベル音を重ねて約3秒の余韻を作る。
 */
let context: AudioContext | null = null;
let activeNodes: OscillatorNode[] = [];

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
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

/** 約3秒。3打目まで明確に聞かせ、ベルらしい長い余韻を残す。 */
export async function playTransitionCue(): Promise<void> {
  try {
    const audioContext = getContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();
    if (audioContext.state !== "running") return;

    stopTransitionCue();

    const startedAt = audioContext.currentTime + 0.015;
    // 「ドゥーン、トゥーン、トゥーン」の3打。
    // 音階は D5 → E5 → F5（ドレミを一音上げた「レミファ」の感覚）。
    // 1打目を少し太く長く、2・3打目を軽くして切替合図として聞き取りやすくする。
    const strikes = [
      { frequency: 587.33, at: 0, tail: 1.8, gainScale: 1 },
      { frequency: 659.25, at: 0.72, tail: 1.55, gainScale: 0.86 },
      { frequency: 698.46, at: 1.42, tail: 1.45, gainScale: 0.82 },
    ];
    const partials = [
      { ratio: 0.5, gain: 0.042, tailScale: 1.05 },
      { ratio: 1, gain: 0.11, tailScale: 1 },
      { ratio: 2.01, gain: 0.028, tailScale: 0.7 },
      { ratio: 2.98, gain: 0.009, tailScale: 0.48 },
    ];

    const nodes: OscillatorNode[] = [];

    for (const strike of strikes) {
      for (const partial of partials) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const begin = startedAt + strike.at;
        const duration = strike.tail * partial.tailScale;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(
          strike.frequency * partial.ratio,
          begin
        );

        gain.gain.setValueAtTime(0.0001, begin);
        gain.gain.exponentialRampToValueAtTime(
          partial.gain * strike.gainScale,
          begin + 0.018
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          begin + duration
        );

        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(begin);
        oscillator.stop(begin + duration + 0.04);
        oscillator.addEventListener("ended", () => {
          activeNodes = activeNodes.filter((node) => node !== oscillator);
        });
        nodes.push(oscillator);
      }
    }

    activeNodes = nodes;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 2950));
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
