// Browser regression fixture only; never imported by the app or deployed routes.
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import AutoFlowPanel from "../../components/AutoFlowPanel";
import { DEFAULT_CONDITIONS } from "../../lib/flowPlan";
import { playRecordedAudio, stopRecordedAudio } from "../../lib/recordedAudio";
import { setAudioVolume } from "../../lib/audioVolume";
function Harness() {
  const [revision, setRevision] = useState(0);
  const [, setSpeaking] = useState(false);
  const [conditions, setConditions] = useState(DEFAULT_CONDITIONS);
  const speak = useCallback(
    (_: string, src?: string, startAtSec = 0) => {
      if (!src) return;
      setSpeaking(true);
      playRecordedAudio(src, { startAtSec, onEnd: () => setSpeaking(false) });
    },
    [revision],
  );
  const stop = useCallback(() => {
    stopRecordedAudio();
    setSpeaking(false);
  }, []);
  return (
    <>
      <button onClick={() => setRevision((n) => n + 1)}>
        再生コールバックを更新
      </button>
      <AutoFlowPanel
        active
        conditions={conditions}
        onConditionsChange={setConditions}
        onSpeak={speak}
        onStopSpeaking={stop}
        onStatusChange={() => {}}
        chimeEnabled
      />
    </>
  );
}
setAudioVolume(0.3);
createRoot(document.getElementById("root")!).render(<Harness />);
