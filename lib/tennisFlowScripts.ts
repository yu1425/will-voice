import { getFlowScripts } from "./flowScripts";

export type FlowScript = {
  id: string;
  step: number;
  title: string;
  shortLabel: string;
  displayText: string;
  voiceText: string;
  voiceTextShort?: string;
  voiceTextVeryShort?: string;
  beginnerTip?: string;
  courtMode?: "single" | "double" | "both";
  audioSrc?: string;
  recordedText?: string;
};
export type VoiceLength = "normal" | "short" | "veryShort";
export const TIMER_FINISH_MESSAGE =
  "時間になりました。いったん手を止めて、次の案内をお待ちください。";
export const TOTAL_STEPS = getFlowScripts().length;
export function getScriptsForCourt(mode: "single" | "double"): FlowScript[] {
  return getFlowScripts(mode === "double" ? 2 : 1).map((s) => ({
    ...s,
    courtMode: mode,
    step: s.refStep,
    shortLabel: s.title,
    recordedText: s.displayText,
  }));
}
export const TENNIS_FLOW_SCRIPTS = getScriptsForCourt("single");
export function findScript(step: number, mode: "single" | "double") {
  return getScriptsForCourt(mode).find((s) => s.step === step);
}
export function pickVoiceText(script: FlowScript, length: VoiceLength): string {
  return (
    (length === "short"
      ? script.voiceTextShort
      : length === "veryShort"
        ? script.voiceTextVeryShort
        : undefined) ?? script.voiceText
  );
}
export function getCrowdPrefix(
  _participants: number,
  _courts: 1 | 2,
): string | null {
  return null;
}
export function isCrowdAdjustedStep(_step: number): boolean {
  return false;
}
