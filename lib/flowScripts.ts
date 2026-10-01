import definitions from "./flowScripts.json";
import { sanitizeForVoicevox } from "./voicevoxText";

/** 表示・読み・録音パス・時刻の共通原稿。生成ツールもこのJSONを参照する。 */
export function getFlowScripts(courts: 1 | 2 = 1) {
  const mode = courts === 2 ? "double" : "single";
  return definitions.map(({ variants, ...event }) => {
    const variant = variants.find((v) => v.courtMode === mode) ?? variants[0];
    return {
      ...event,
      ...variant,
      voiceText: sanitizeForVoicevox(variant.displayText),
    };
  });
}

export const FLOW_VOICE_TEST = {
  displayText: "音声テストです。聞こえ方をご確認ください。",
  audioSrc: "/audio/flow/v2/voice-test.wav",
};
