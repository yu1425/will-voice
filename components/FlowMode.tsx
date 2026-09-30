"use client";

/**
 * テニス会 進行モード
 * ============================================================
 *  - 今日の進行プランパネル (FlowPlanPanel)
 *  - やさしい注意喚起パネル (FlowCautionPanel)
 *  - ステップ一覧 + 現ステップカード (FlowStepCard)
 *  - タイマー (5分/10分/カスタム)
 *
 *  読み上げは親(page.tsx)から渡される speak(text) を使う:
 *    VOICEVOX→失敗時 標準音声フォールバックは親側で担保。
 * ============================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FlowStepCard from "./FlowStepCard";
import FlowPlanPanel from "./FlowPlanPanel";
import FlowCautionPanel from "./FlowCautionPanel";
import FlowLiveMode from "./FlowLiveMode";
import AutoFlowPanel from "./AutoFlowPanel";
import {
  TENNIS_FLOW_SCRIPTS,
  TIMER_FINISH_MESSAGE,
  TOTAL_STEPS,
  getCrowdPrefix,
  getScriptsForCourt,
  isCrowdAdjustedStep,
  pickVoiceText,
  type FlowScript,
  type VoiceLength,
} from "@/lib/tennisFlowScripts";
import {
  DEFAULT_CONDITIONS,
  type FlowConditions,
  type FlowDurationHours,
  type FlowVibe,
} from "@/lib/flowPlan";
import { preloadRecordedAudio } from "@/lib/recordedAudio";

const STEP_KEY = "will-flow-step";
const EDIT_KEY = "will-flow-edits";
const CONDITIONS_KEY = "will-flow-conditions";
const VOICE_LENGTH_KEY = "will-flow-voice-length";

type Props = {
  /** 読み上げ実行(VOICEVOX/標準音声/録音音声は親側で判定) */
  speak: (text: string, audioSrc?: string) => void;
  /** 読み上げ停止 */
  stopSpeaking: () => void;
  /** 現在読み上げ中か */
  isSpeaking: boolean;
  /** 読み上げを一時停止中か */
  isSpeakingPaused: boolean;
  /** 読み上げを現在位置で一時停止 */
  onPauseSpeaking: () => void;
  /** 一時停止中の読み上げを現在位置から再開 */
  onResumeSpeaking: () => void;
  /** 現在の読み上げ音声モード(注意喚起は録音音声非対応なので案内表示に使う) */
  voiceMode: "standard" | "voicevox" | "recorded";
};

export default function FlowMode({
  speak,
  stopSpeaking,
  isSpeaking,
  isSpeakingPaused,
  onPauseSpeaking,
  onResumeSpeaking,
  voiceMode,
}: Props) {
  const [conditions, setConditions] = useState<FlowConditions>(DEFAULT_CONDITIONS);
  const [stepNumber, setStepNumber] = useState(1);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [voiceLength, setVoiceLength] = useState<VoiceLength>("normal");
  const [flowTab, setFlowTab] = useState<"auto" | "manual">("auto");

  // タイマー
  const [timerSec, setTimerSec] = useState(5 * 60);
  const [timerRemaining, setTimerRemaining] = useState(5 * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  // 初期復元
  useEffect(() => {
    try {
      const c = window.localStorage.getItem(CONDITIONS_KEY);
      if (c) {
        const parsed = JSON.parse(c) as Partial<FlowConditions>;
        setConditions((prev) => ({
          ...prev,
          ...sanitizeConditions(parsed),
        }));
      }

      const s = window.localStorage.getItem(STEP_KEY);
      if (s !== null) {
        const n = Number(s);
        if (Number.isFinite(n) && n >= 1 && n <= TOTAL_STEPS) {
          setStepNumber(n);
        }
      }

      const e = window.localStorage.getItem(EDIT_KEY);
      if (e !== null) {
        const parsed = JSON.parse(e);
        if (parsed && typeof parsed === "object") {
          setEdits(parsed as Record<string, string>);
        }
      }

      const v = window.localStorage.getItem(VOICE_LENGTH_KEY);
      if (v === "normal" || v === "short" || v === "veryShort") {
        setVoiceLength(v);
      }
    } catch {
      /* no-op */
    }
  }, []);

  const courtMode: "single" | "double" =
    conditions.courts === 2 ? "double" : "single";

  const scriptsForCourt = useMemo(
    () => getScriptsForCourt(courtMode),
    [courtMode]
  );

  const currentScript = useMemo(
    () =>
      scriptsForCourt.find((s) => s.step === stepNumber) ?? scriptsForCourt[0],
    [scriptsForCourt, stepNumber]
  );

  // コート数切替などで stepNumber が現在の courtMode に存在しない場合、
  // 無言で先頭ステップへ飛ばすのではなく stepNumber 自体を実際のステップに
  // 合わせて補正する(表示中の「ステップ X」ラベルと中身がズレないようにする)。
  useEffect(() => {
    if (currentScript && currentScript.step !== stepNumber) {
      setStepNumber(currentScript.step);
    }
  }, [currentScript, stepNumber]);

  const nextScript = useMemo(
    () => scriptsForCourt.find((s) => s.step === stepNumber + 1) ?? null,
    [scriptsForCourt, stepNumber]
  );

  // 現在と次のステップの録音音声を先読みし、最初の読み上げからラグを減らす
  useEffect(() => {
    preloadRecordedAudio(currentScript?.audioSrc);
    preloadRecordedAudio(nextScript?.audioSrc);
  }, [currentScript, nextScript]);

  const persist = (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* no-op */
    }
  };

  const handleConditionsChange = useCallback((next: FlowConditions) => {
    setConditions(next);
    persist(CONDITIONS_KEY, JSON.stringify(next));
  }, []);

  const handleVoiceLengthChange = useCallback((l: VoiceLength) => {
    setVoiceLength(l);
    persist(VOICE_LENGTH_KEY, l);
  }, []);

  const handleStepJump = useCallback((n: number) => {
    if (n < 1 || n > TOTAL_STEPS) return;
    setStepNumber(n);
    persist(STEP_KEY, String(n));
    setEditingId(null);
  }, []);

  const handleAutoFlowStepSync = useCallback(
    (n: number) => handleStepJump(n),
    [handleStepJump]
  );

  const handlePrev = useCallback(() => {
    if (stepNumber > 1) handleStepJump(stepNumber - 1);
  }, [stepNumber, handleStepJump]);

  const handleNext = useCallback(() => {
    if (stepNumber < TOTAL_STEPS) handleStepJump(stepNumber + 1);
  }, [stepNumber, handleStepJump]);

  const handleEdit = useCallback((id: string, value: string) => {
    setEdits((prev) => {
      const next = { ...prev, [id]: value };
      persist(EDIT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleEditReset = useCallback((id: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      persist(EDIT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** 実際にうぃるに渡す読み上げテキストを組み立てる */
  const buildSpeakText = useCallback(
    (script: FlowScript): string => {
      const edited = edits[script.id];
      if (edited !== undefined) return edited;

      // 録音再生時は、実際の発話内容をそのままプレビューに使う。
      // voiceLength や人数調整は録音内容を変えられないため適用しない。
      if (
        voiceMode === "recorded" &&
        script.audioSrc &&
        script.recordedText
      ) {
        return script.recordedText;
      }

      const base = pickVoiceText(script, voiceLength);

      // 人数調整が無効なステップなら、プレフィックスは付けない
      if (!isCrowdAdjustedStep(script.step)) return base;

      const prefix = getCrowdPrefix(conditions.participants, conditions.courts);
      if (!prefix) return base;
      return `${prefix}\n${base}`;
    },
    [
      edits,
      voiceMode,
      voiceLength,
      conditions.participants,
      conditions.courts,
    ]
  );

  const usesRecordedAudio = useCallback(
    (script: FlowScript): boolean =>
      voiceMode === "recorded" &&
      edits[script.id] === undefined &&
      Boolean(script.audioSrc && script.recordedText),
    [voiceMode, edits]
  );

  const handleSpeak = useCallback(
    (script: FlowScript) => {
      // 録音パスと実発話テキストが揃った未編集STEPだけ録音を使う。
      // 編集済み・録音テキスト未定義なら、表示中の文章を合成音声で読む。
      speak(
        buildSpeakText(script),
        usesRecordedAudio(script) ? script.audioSrc : undefined
      );
    },
    [speak, buildSpeakText, usesRecordedAudio]
  );

  const handleSpeakBeginnerTip = useCallback(
    (script: FlowScript) => {
      if (script.beginnerTip) speak(script.beginnerTip);
    },
    [speak]
  );

  const handleCopy = useCallback(
    async (script: FlowScript) => {
      const edited = edits[script.id];
      const text = edited !== undefined ? edited : script.displayText;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* no-op */
      }
    },
    [edits]
  );

  // ============ タイマー ============
  // 実時刻(Date.now())ベースで残り時間を計算する。setInterval のカウンタを
  // 直接減算する方式だと、画面ロックやタブのバックグラウンド化で tick が
  // 間引かれた際に実際の経過時間とズレるため、常に「終了予定時刻との差」から
  // 残り秒数を再計算する。
  const timerIntervalRef = useRef<number | null>(null);
  const timerEndAtRef = useRef<number | null>(null);

  const clearTimerInterval = () => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const startTimer = useCallback((sec: number) => {
    if (sec <= 0) return;
    setTimerSec(sec);
    setTimerRemaining(sec);
    timerEndAtRef.current = Date.now() + sec * 1000;
    setTimerRunning(true);
  }, []);

  const pauseTimer = useCallback(() => {
    // 一時停止時点の残り秒数を確定させてから止める
    if (timerEndAtRef.current !== null) {
      const remaining = Math.max(
        0,
        Math.round((timerEndAtRef.current - Date.now()) / 1000)
      );
      setTimerRemaining(remaining);
    }
    timerEndAtRef.current = null;
    setTimerRunning(false);
  }, []);

  const resetTimer = useCallback(() => {
    timerEndAtRef.current = null;
    setTimerRunning(false);
    setTimerRemaining(timerSec);
  }, [timerSec]);

  useEffect(() => {
    if (!timerRunning) {
      clearTimerInterval();
      return;
    }

    const tick = () => {
      const endAt = timerEndAtRef.current;
      if (endAt === null) return;
      const remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      setTimerRemaining(remaining);
      if (remaining <= 0) {
        timerEndAtRef.current = null;
        setTimerRunning(false);
        speak(TIMER_FINISH_MESSAGE);
      }
    };

    // 画面ロック解除やタブ復帰の直後にも即座に正しい残り時間を反映する
    const handleVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    timerIntervalRef.current = window.setInterval(tick, 1000);
    return () => {
      clearTimerInterval();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [timerRunning, speak]);

  const handleFlowTabChange = useCallback(
    (next: "auto" | "manual") => {
      if (next === flowTab) return;
      stopSpeaking();
      setFlowTab(next);
    },
    [flowTab, stopSpeaking]
  );

  // ============ render ============
  // 自動進行と個別進行は同じ「進行」ページ内の表示方式としてタブで切り替える。
  // 両方を常にマウントし、自動進行の時計はタブ移動でも維持する。
  return (
    <div className="flow-mode flow-mode--workspace">
      <div className="flow-kind-tabs" role="tablist" aria-label="進行方式">
        <button
          type="button"
          role="tab"
          aria-selected={flowTab === "auto"}
          className={flowTab === "auto" ? "is-active" : ""}
          onClick={() => handleFlowTabChange("auto")}
        >
          自動進行
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={flowTab === "manual"}
          className={flowTab === "manual" ? "is-active" : ""}
          onClick={() => handleFlowTabChange("manual")}
        >
          個別進行
        </button>
      </div>

      <div hidden={flowTab !== "auto"}>
        <AutoFlowPanel
          active={flowTab === "auto"}
          conditions={conditions}
          onConditionsChange={handleConditionsChange}
          onSpeak={speak}
          onStopSpeaking={stopSpeaking}
          isSpeaking={isSpeaking}
          onSyncStep={handleAutoFlowStepSync}
        />
      </div>

      <div hidden={flowTab !== "manual"} className="flow-manual">
        {currentScript && (
          <FlowLiveMode
            autoFlow={null}
            manualControlsDisabled={false}
            currentScript={currentScript}
            nextScript={nextScript}
            previewText={buildSpeakText(currentScript)}
            nextPreviewText={nextScript ? buildSpeakText(nextScript as FlowScript) : null}
            usesRecordedAudio={usesRecordedAudio(currentScript)}
            isSpeaking={isSpeaking}
            totalSteps={TOTAL_STEPS}
            onSpeak={() => handleSpeak(currentScript)}
            onStop={stopSpeaking}
            isSpeakingPaused={isSpeakingPaused}
            onPauseSpeaking={onPauseSpeaking}
            onResumeSpeaking={onResumeSpeaking}
            onPrev={handlePrev}
            onNext={handleNext}
            onSpeakRaw={speak}
            scriptsForCourt={scriptsForCourt}
            onStepJump={handleStepJump}
            voiceMode={voiceMode}
            timerRemaining={timerRemaining}
            timerRunning={timerRunning}
            timerSec={timerSec}
            onStartTimer={startTimer}
            onPauseTimer={pauseTimer}
            onResetTimer={resetTimer}
          />
        )}
        <details className="flow-manual__settings">
          <summary>進行設定・セリフ編集</summary>
          <FlowPlanPanel conditions={conditions} onChange={handleConditionsChange} />
          <FlowCautionPanel speak={speak} voiceMode={voiceMode} />
          {currentScript && (
            <FlowStepCard
              key={currentScript.id}
              script={currentScript}
              editedText={edits[currentScript.id]}
              speakingText={buildSpeakText(currentScript)}
              isEditing={editingId === currentScript.id}
              isSpeaking={isSpeaking}
              voiceLength={voiceLength}
              usesRecordedAudio={usesRecordedAudio(currentScript)}
              onVoiceLengthChange={handleVoiceLengthChange}
              onSpeak={() => handleSpeak(currentScript)}
              onSpeakBeginnerTip={() => handleSpeakBeginnerTip(currentScript)}
              onStop={stopSpeaking}
              isSpeakingPaused={isSpeakingPaused}
              onPauseSpeaking={onPauseSpeaking}
              onResumeSpeaking={onResumeSpeaking}
              onCopy={() => handleCopy(currentScript)}
              onEditToggle={() => setEditingId(editingId === currentScript.id ? null : currentScript.id)}
              onEditChange={(value) => handleEdit(currentScript.id, value)}
              onEditReset={() => handleEditReset(currentScript.id)}
            />
          )}
        </details>
      </div>
    </div>
  );

}

/** localStorage から読んだ conditions を安全な値域にクランプ */
function sanitizeConditions(
  raw: Partial<FlowConditions>
): Partial<FlowConditions> {
  const out: Partial<FlowConditions> = {};
  if (typeof raw.participants === "number" && Number.isFinite(raw.participants)) {
    out.participants = Math.max(0, Math.min(40, Math.floor(raw.participants)));
  }
  if (raw.courts === 1 || raw.courts === 2) out.courts = raw.courts;
  if (
    raw.durationHours === 1 ||
    raw.durationHours === 1.5 ||
    raw.durationHours === 2 ||
    raw.durationHours === 3
  ) {
    out.durationHours = raw.durationHours as FlowDurationHours;
  }
  if (typeof raw.newcomerCount === "number" && Number.isFinite(raw.newcomerCount)) {
    out.newcomerCount = Math.max(0, Math.min(40, Math.floor(raw.newcomerCount)));
  }
  if (typeof raw.manyBeginners === "boolean") {
    out.manyBeginners = raw.manyBeginners;
  }
  if (raw.vibe === "casual" || raw.vibe === "standard" || raw.vibe === "serious") {
    out.vibe = raw.vibe as FlowVibe;
  }
  if (raw.introTiming === "start" || raw.introTiming === "afterServe") {
    out.introTiming = raw.introTiming;
  }
  return out;
}
