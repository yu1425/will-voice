import definitions from "./flowCues.json";
import { sanitizeForVoicevox } from "./voicevoxText";
export const FLOW_RECORDED_CUES = definitions.map((cue) => ({
  ...cue,
  voiceText: sanitizeForVoicevox(cue.displayText),
}));
export const FLOW_TIMER_ENDED = FLOW_RECORDED_CUES.find(
  (cue) => cue.id === "timer-ended",
)!;
