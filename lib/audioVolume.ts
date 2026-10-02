/** 全再生方式で共通の0〜1音量。音声生成中も最新値を取得できる。 */
let volume = 1;
export function clampAudioVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}
export function getAudioVolume(): number {
  return volume;
}
export function setAudioVolume(value: number): void {
  volume = clampAudioVolume(value);
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("will-audio-volume-changed"));
}
