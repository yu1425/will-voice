import { clampAudioVolume, getAudioVolume } from "./audioVolume";

/**
 * 自動進行の節目に鳴らす告知チャイム。
 * 屋外やBluetoothスピーカーでも切替に気づきやすいよう、
 * 3打のベル音を重ねて約3秒の余韻を作る。
 */
let context: AudioContext | null = null;
let masterGain: GainNode | null = null;
let playbackGeneration = 0;
let activeNodes: OscillatorNode[] = [];

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
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
    stopTransitionCue();
    const ticket = playbackGeneration;
    const audioContext = getContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();
    // A manual stop during resume must not let this old call start or stop a newer cue.
    if (ticket !== playbackGeneration || audioContext.state !== "running")
      return;

    masterGain ??= audioContext.createGain();
    masterGain.gain.setValueAtTime(getAudioVolume(), audioContext.currentTime);
    masterGain.disconnect();
    masterGain.connect(audioContext.destination);
    const startedAt = audioContext.currentTime + 0.015;
    // 音程調整前（4c7a9b5）の3打ベルを復元。最後の音のグライドも行わない。
    const strikes = [
      { frequency: 659.25, at: 0, tail: 1.7 },
      { frequency: 830.61, at: 0.48, tail: 1.8 },
      { frequency: 987.77, at: 0.96, tail: 1.9 },
    ];
    const partials = [
      { ratio: 1, gain: 0.13, tailScale: 1 },
      { ratio: 2.01, gain: 0.04, tailScale: 0.72 },
      { ratio: 2.98, gain: 0.016, tailScale: 0.52 },
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
          begin,
        );
        gain.gain.setValueAtTime(0.0001, begin);
        gain.gain.exponentialRampToValueAtTime(partial.gain, begin + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, begin + duration);

        oscillator.connect(gain).connect(masterGain);
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
  playbackGeneration++;
  for (const oscillator of activeNodes) {
    try {
      oscillator.stop();
    } catch {
      /* 既に停止済み */
    }
  }
  activeNodes = [];
}

export function setTransitionCueVolume(volume: number): void {
  if (context && masterGain)
    masterGain.gain.setValueAtTime(
      clampAudioVolume(volume),
      context.currentTime,
    );
}
