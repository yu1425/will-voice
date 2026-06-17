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

const STEP_KEY = "will-flow-step";
const EDIT_KEY = "will-flow-edits";
const CONDITIONS_KEY = "will-flow-conditions";
const VOICE_LENGTH_KEY = "will-flow-voice-length";
const VIEW_MODE_KEY = "will-flow-view-mode";

type ViewMode = "prepare" | "live";

type Props = {
  /** 読み上げ実行(VOICEVOX/標準音声/録音音声は親側で判定) */
  speak: (text: string, audioSrc?: string) => void;
  /** 読み上げ停止 */
  stopSpeaking: () => void;
  /** 現在読み上げ中か */
  isSpeaking: boolean;
};

export default function FlowMode({ speak, stopSpeaking, isSpeaking }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("prepare");
  const [conditions, setConditions] = useState<FlowConditions>(DEFAULT_CONDITIONS);
  const [stepNumber, setStepNumber] = useState(1);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [voiceLength, setVoiceLength] = useState<VoiceLength>("normal");

  // タイマー
  const [timerSec, setTimerSec] = useState(5 * 60);
  const [timerRemaining, setTimerRemaining] = useState(5 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [customMin, setCustomMin] = useState("");

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

      const vm = window.localStorage.getItem(VIEW_MODE_KEY);
      if (vm === "prepare" || vm === "live") {
        setViewMode(vm);
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

  const nextScript = useMemo(
    () => scriptsForCourt.find((s) => s.step === stepNumber + 1) ?? null,
    [scriptsForCourt, stepNumber]
  );

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

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    persist(VIEW_MODE_KEY, mode);
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
      const base = edited !== undefined ? edited : pickVoiceText(script, voiceLength);

      // 編集テキスト or 人数調整が無効なステップなら、プレフィックスは付けない
      if (edited !== undefined) return base;
      if (!isCrowdAdjustedStep(script.step)) return base;

      const prefix = getCrowdPrefix(conditions.participants, conditions.courts);
      if (!prefix) return base;
      return `${prefix}\n${base}`;
    },
    [edits, voiceLength, conditions.participants, conditions.courts]
  );

  const handleSpeak = useCallback(
    (script: FlowScript) => {
      speak(buildSpeakText(script), script.audioSrc);
    },
    [speak, buildSpeakText]
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
  const timerIntervalRef = useRef<number | null>(null);

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
    setTimerRunning(true);
  }, []);

  const pauseTimer = useCallback(() => setTimerRunning(false), []);

  const resetTimer = useCallback(() => {
    setTimerRunning(false);
    setTimerRemaining(timerSec);
  }, [timerSec]);

  useEffect(() => {
    if (!timerRunning) {
      clearTimerInterval();
      return;
    }
    timerIntervalRef.current = window.setInterval(() => {
      setTimerRemaining((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          speak(TIMER_FINISH_MESSAGE);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return clearTimerInterval;
  }, [timerRunning, speak]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const handleCustomStart = () => {
    const m = Number(customMin);
    if (!Number.isFinite(m) || m <= 0) return;
    const sec = Math.min(60, Math.max(1, Math.floor(m))) * 60;
    startTimer(sec);
  };

  // ============ render ============
  // 表示モード切替トグル(両モード共通で先頭に表示)
  const viewToggle = (
    <div className="flow-viewmode" role="radiogroup" aria-label="表示モード">
      <button
        type="button"
        role="radio"
        aria-checked={viewMode === "prepare"}
        className={`flow-viewmode__btn ${
          viewMode === "prepare" ? "flow-viewmode__btn--active" : ""
        }`}
        onClick={() => handleViewModeChange("prepare")}
      >
        準備モード
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={viewMode === "live"}
        className={`flow-viewmode__btn ${
          viewMode === "live" ? "flow-viewmode__btn--active" : ""
        }`}
        onClick={() => handleViewModeChange("live")}
      >
        当日モード
      </button>
    </div>
  );

  // 当日モード
  if (viewMode === "live") {
    return (
      <div className="flow-mode flow-mode--live">
        {viewToggle}
        {currentScript && (
          <FlowLiveMode
            currentScript={currentScript}
            nextScript={nextScript}
            previewText={buildSpeakText(currentScript)}
            isSpeaking={isSpeaking}
            totalSteps={TOTAL_STEPS}
            onSpeak={() => handleSpeak(currentScript)}
            onStop={stopSpeaking}
            onPrev={handlePrev}
            onNext={handleNext}
            onSpeakRaw={speak}
            timerRemaining={timerRemaining}
            timerRunning={timerRunning}
            timerSec={timerSec}
            onStartTimer={startTimer}
            onPauseTimer={pauseTimer}
            onResetTimer={resetTimer}
          />
        )}
      </div>
    );
  }

  // 準備モード(従来通り)
  return (
    <div className="flow-mode">
      {viewToggle}

      <FlowPlanPanel conditions={conditions} onChange={handleConditionsChange} />

      <FlowCautionPanel speak={speak} />

      {/* 現在ステップ ナビ */}
      <div className="flow-nav">
        <button
          type="button"
          className="flow-nav__btn"
          onClick={handlePrev}
          disabled={stepNumber === 1}
        >
          ← 前へ
        </button>
        <span className="flow-nav__current">
          ステップ {stepNumber} / {TOTAL_STEPS}
        </span>
        <button
          type="button"
          className="flow-nav__btn"
          onClick={handleNext}
          disabled={stepNumber === TOTAL_STEPS}
        >
          次へ →
        </button>
      </div>

      {/* ステップ一覧チップ */}
      <div className="flow-steps" role="tablist" aria-label="進行ステップ">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => {
          const matched =
            scriptsForCourt.find((s) => s.step === n) ??
            TENNIS_FLOW_SCRIPTS.find((s) => s.step === n);
          const isActive = stepNumber === n;
          return (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`flow-step-chip ${
                isActive ? "flow-step-chip--active" : ""
              }`}
              onClick={() => handleStepJump(n)}
              title={matched?.title}
            >
              <span className="flow-step-chip__num">{n}</span>
              <span className="flow-step-chip__label">
                {matched?.shortLabel ?? ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* 現ステップカード */}
      {currentScript && (
        <FlowStepCard
          key={currentScript.id}
          script={currentScript}
          editedText={edits[currentScript.id]}
          speakingText={buildSpeakText(currentScript)}
          isEditing={editingId === currentScript.id}
          isSpeaking={isSpeaking}
          voiceLength={voiceLength}
          onVoiceLengthChange={handleVoiceLengthChange}
          onSpeak={() => handleSpeak(currentScript)}
          onSpeakBeginnerTip={() => handleSpeakBeginnerTip(currentScript)}
          onStop={stopSpeaking}
          onCopy={() => handleCopy(currentScript)}
          onEditToggle={() =>
            setEditingId(editingId === currentScript.id ? null : currentScript.id)
          }
          onEditChange={(v) => handleEdit(currentScript.id, v)}
          onEditReset={() => handleEditReset(currentScript.id)}
        />
      )}

      {/* タイマー */}
      <div className="flow-timer">
        <div className="flow-timer__head">
          <span className="flow-timer__label">タイマー</span>
          <span
            className={`flow-timer__time ${
              timerRemaining === 0 ? "flow-timer__time--done" : ""
            } ${timerRunning ? "flow-timer__time--running" : ""}`}
          >
            {formatTime(timerRemaining)}
          </span>
        </div>

        <div className="flow-timer__preset">
          <button
            type="button"
            className="flow-timer__btn"
            onClick={() => startTimer(5 * 60)}
            disabled={timerRunning}
          >
            5分
          </button>
          <button
            type="button"
            className="flow-timer__btn"
            onClick={() => startTimer(10 * 60)}
            disabled={timerRunning}
          >
            10分
          </button>

          <div className="flow-timer__custom">
            <input
              type="number"
              className="flow-timer__input"
              placeholder="分"
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              min={1}
              max={60}
              inputMode="numeric"
              aria-label="カスタム分数"
            />
            <button
              type="button"
              className="flow-timer__btn"
              onClick={handleCustomStart}
              disabled={timerRunning || !customMin}
            >
              開始
            </button>
          </div>

          {timerRunning ? (
            <button
              type="button"
              className="flow-timer__btn flow-timer__btn--warn"
              onClick={pauseTimer}
            >
              一時停止
            </button>
          ) : (
            <button
              type="button"
              className="flow-timer__btn"
              onClick={resetTimer}
              disabled={timerRemaining === timerSec}
            >
              リセット
            </button>
          )}
        </div>

        <p className="flow-timer__hint">
          タイマー終了時に「次のメニューに移りましょう」と読み上げます。
        </p>
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
  return out;
}
