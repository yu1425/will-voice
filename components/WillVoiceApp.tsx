"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import PageNavigation from "./PageNavigation";
import { getAudioVolume, setAudioVolume } from "@/lib/audioVolume";
import { setTransitionCueVolume, stopTransitionCue } from "@/lib/transitionCue";
import ChatMessage, { ChatMessageData } from "@/components/ChatMessage";
import FlowMode, { type FlowModeHandle } from "@/components/FlowMode";
import FlowTransportIcon from "./FlowTransportIcon";
import { generateWillReply } from "@/lib/generateWillReply";
import { WILL_GREETING } from "@/lib/willPrompt";
import {
  getJapaneseVoices,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speakText,
  startListening,
  stopSpeaking,
  type ListeningHandle,
} from "@/lib/speech";
import {
  speakWithVoicevox,
  stopVoicevox,
  setVoicevoxVolume,
  fetchVoicevoxSpeakers,
  pickZundamonStyles,
  type VoicevoxHandle,
  type ZundamonStyle,
} from "@/lib/voicevox";
import {
  playRecordedAudio,
  stopRecordedAudio,
  setRecordedAudioVolume,
} from "@/lib/recordedAudio";

/** 簡易ID生成 */
function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** ローカル環境かどうかを判定 (SSR時は true を返す) */
function isLocalhost(): boolean {
  if (typeof window === "undefined") return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

type VoiceMode = "standard" | "voicevox" | "recorded";
type VoicevoxStatus = "unknown" | "connected" | "disconnected" | "fallback";
type OptionalVoiceModes = {
  standard: boolean;
  voicevox: boolean;
};

const VOICE_MODE_STORAGE_KEY = "will-voice-mode";
const VOICEVOX_STYLE_STORAGE_KEY = "will-voicevox-style-id";
const VOICEVOX_PRESET_STORAGE_KEY = "will-voicevox-preset";
const VOICEVOX_PARAMS_STORAGE_KEY = "will-voicevox-params";
const STANDARD_VOICE_STORAGE_KEY = "will-standard-voice-uri";
const RECORDED_VOLUME_STORAGE_KEY = "will-recorded-volume";
const OPTIONAL_VOICE_MODES_STORAGE_KEY = "will-optional-voice-modes";
const FLOW_SETTINGS_STORAGE_KEY = "will-standard-two-hour-auto-flow-settings";

type VoicevoxPresetName = "標準" | "明るめ" | "聞き取りやすさ重視" | "ゆっくり";

type AudioPresetParams = {
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
};

const AUDIO_PRESETS: Record<VoicevoxPresetName, AudioPresetParams> = {
  標準: {
    speedScale: 1.0,
    pitchScale: 0.0,
    intonationScale: 1.0,
    volumeScale: 1.0,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.2,
  },
  明るめ: {
    speedScale: 1.05,
    pitchScale: 0.0,
    intonationScale: 1.15,
    volumeScale: 1.0,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.2,
  },
  聞き取りやすさ重視: {
    speedScale: 0.95,
    pitchScale: 0.0,
    intonationScale: 1.05,
    volumeScale: 1.0,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.25,
  },
  ゆっくり: {
    speedScale: 0.88,
    pitchScale: 0.0,
    intonationScale: 1.0,
    volumeScale: 1.0,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.3,
  },
};
const PRESET_NAMES: VoicevoxPresetName[] = [
  "標準",
  "明るめ",
  "聞き取りやすさ重視",
  "ゆっくり",
];
const DEFAULT_PRESET: VoicevoxPresetName = "明るめ";

const VOICE_TEST_TEXT =
  "本日はご参加ありがとうございます。ショートラリーとボレーボレーを、それぞれ5分ずつ行います。聞こえ方に問題がなければ、この設定で進行してください。";

export default function WillVoiceApp({ mode }: { mode: "flow" | "chat" }) {
  const [messages, setMessages] = useState<ChatMessageData[]>([
    { id: makeId(), role: "will", text: WILL_GREETING },
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [recognitionOk, setRecognitionOk] = useState(true);

  const [voiceMode, setVoiceMode] = useState<VoiceMode>("recorded");
  const [voicevoxStatus, setVoicevoxStatus] =
    useState<VoicevoxStatus>("unknown");
  const [zundamonStyles, setZundamonStyles] = useState<ZundamonStyle[]>([]);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [speakersError, setSpeakersError] = useState<string | null>(null);
  const [audioPreset, setAudioPreset] =
    useState<VoicevoxPresetName>(DEFAULT_PRESET);
  const [audioParams, setAudioParams] = useState<AudioPresetParams>(
    AUDIO_PRESETS[DEFAULT_PRESET],
  );
  const [isLocal, setIsLocal] = useState(true);
  const [japaneseVoices, setJapaneseVoices] = useState<SpeechSynthesisVoice[]>(
    [],
  );
  const [standardVoiceURI, setStandardVoiceURI] = useState<string | null>(null);
  const [recordedVolume, setRecordedVolume] = useState(1);
  // 録音音声だけを標準表示にし、追加の音声は設定で任意に表示する。
  const [optionalVoiceModes, setOptionalVoiceModes] =
    useState<OptionalVoiceModes>({
      standard: false,
      voicevox: false,
    });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chimeEnabled, setChimeEnabled] = useState(true);
  const [isChimePlaying, setIsChimePlaying] = useState(false);
  const flowModeRef = useRef<FlowModeHandle>(null);

  const listeningRef = useRef<ListeningHandle | null>(null);
  const voicevoxHandleRef = useRef<VoicevoxHandle | null>(null);
  const voicevoxAbortRef = useRef<AbortController | null>(null);
  const speechGenerationRef = useRef(0);
  const appMountedRef = useRef(true);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("settings") === "1")
      setSettingsOpen(true);
  }, []);
  useEffect(() => {
    if (!settingsOpen || mode !== "flow") return;
    const panel = document.getElementById("audio-volume-settings");
    panel?.querySelector<HTMLButtonElement>(".settings-close")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
        document
          .querySelector<HTMLButtonElement>(".page-menu-trigger")
          ?.focus();
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),a[href]",
        ),
      );
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault();
        nodes[0].focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [settingsOpen, mode]);

  // 初期化(クライアントのみ)
  useEffect(() => {
    setRecognitionOk(isSpeechRecognitionSupported());
    if (new URLSearchParams(window.location.search).get("settings") === "1") {
      setSettingsOpen(true);
    }
    if (mode === "chat" && !isSpeechRecognitionSupported()) {
      setNotice(
        "このブラウザは音声認識に対応していません。スマホ/PCの Chrome でお試しください😊",
      );
    }
    if (isSpeechSynthesisSupported()) {
      window.speechSynthesis.getVoices();
    }

    const local = isLocalhost();
    setIsLocal(local);

    try {
      const flowSettings = JSON.parse(
        window.localStorage.getItem(FLOW_SETTINGS_STORAGE_KEY) ?? "{}",
      );
      if (typeof flowSettings.chimeEnabled === "boolean")
        setChimeEnabled(flowSettings.chimeEnabled);
    } catch {
      /* Ignore invalid chime preferences without blocking other saved settings. */
    }
    try {
      let savedOptionalVoiceModes: OptionalVoiceModes = {
        standard: false,
        voicevox: false,
      };
      const savedOptionalModes = window.localStorage.getItem(
        OPTIONAL_VOICE_MODES_STORAGE_KEY,
      );
      if (savedOptionalModes) {
        const parsed = JSON.parse(
          savedOptionalModes,
        ) as Partial<OptionalVoiceModes>;
        savedOptionalVoiceModes = {
          standard: parsed.standard === true,
          voicevox: parsed.voicevox === true,
        };
        setOptionalVoiceModes(savedOptionalVoiceModes);
      }

      // 公開環境では VOICEVOX モードを復元しない（localhost のみ有効）
      if (local) {
        const savedVoice = window.localStorage.getItem(VOICE_MODE_STORAGE_KEY);
        const isVisibleOptionalMode =
          (savedVoice === "standard" && savedOptionalVoiceModes.standard) ||
          (savedVoice === "voicevox" && savedOptionalVoiceModes.voicevox);
        if (savedVoice === "recorded" || isVisibleOptionalMode) {
          setVoiceMode(savedVoice);
        }
      }
      const savedPreset = window.localStorage.getItem(
        VOICEVOX_PRESET_STORAGE_KEY,
      );
      if (savedPreset && savedPreset in AUDIO_PRESETS) {
        const p = savedPreset as VoicevoxPresetName;
        setAudioPreset(p);
        const rawParams = window.localStorage.getItem(
          VOICEVOX_PARAMS_STORAGE_KEY,
        );
        if (rawParams) {
          const parsed = JSON.parse(rawParams) as Partial<AudioPresetParams>;
          setAudioParams({ ...AUDIO_PRESETS[p], ...parsed });
        } else {
          setAudioParams(AUDIO_PRESETS[p]);
        }
      }
      const savedVoiceURI = window.localStorage.getItem(
        STANDARD_VOICE_STORAGE_KEY,
      );
      if (savedVoiceURI) setStandardVoiceURI(savedVoiceURI);

      const savedVolume = window.localStorage.getItem(
        RECORDED_VOLUME_STORAGE_KEY,
      );
      if (savedVolume) {
        const v = Number(savedVolume);
        if (Number.isFinite(v) && v >= 0 && v <= 1) {
          setAudioVolume(v);
          setRecordedVolume(v);
        }
      }
    } catch {
      /* no-op */
    }
  }, []);

  // 標準音声のボイス一覧を取得(ブラウザによっては非同期でロードされる)
  useEffect(() => {
    if (!isSpeechSynthesisSupported()) return;
    const load = () => setJapaneseVoices(getJapaneseVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  /** VOICEVOX 話者一覧を取得し、状態を更新 */
  const refreshSpeakers = useCallback(async () => {
    const result = await fetchVoicevoxSpeakers();
    if (!result.ok) {
      setVoicevoxStatus("disconnected");
      setZundamonStyles([]);
      setStyleId(null);
      setSpeakersError(result.error ?? "VOICEVOX に接続できませんでした。");
      return;
    }
    setSpeakersError(null);
    setVoicevoxStatus("connected");

    const styles = pickZundamonStyles(result.speakers);
    setZundamonStyles(styles);

    let initialId: number | null = null;
    try {
      const saved = window.localStorage.getItem(VOICEVOX_STYLE_STORAGE_KEY);
      if (saved !== null) {
        const parsed = Number(saved);
        if (
          Number.isFinite(parsed) &&
          styles.some((s) => s.styleId === parsed)
        ) {
          initialId = parsed;
        }
      }
    } catch {
      /* no-op */
    }
    if (
      initialId === null &&
      result.defaultSpeakerId !== undefined &&
      styles.some((s) => s.styleId === result.defaultSpeakerId)
    ) {
      initialId = result.defaultSpeakerId;
    }
    if (initialId === null && styles.length > 0) {
      initialId = styles[0].styleId;
    }
    setStyleId(initialId);
  }, []);

  useEffect(() => {
    if (voiceMode === "voicevox" && isLocalhost()) {
      refreshSpeakers();
    }
  }, [voiceMode, refreshSpeakers]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isThinking]);

  const addMessage = useCallback(
    (role: ChatMessageData["role"], text: string) => {
      setMessages((prev) => [...prev, { id: makeId(), role, text }]);
    },
    [],
  );

  /** 音声モード切替 */
  const handleVoiceModeChange = useCallback((mode: VoiceMode) => {
    setVoiceMode(mode);
    try {
      window.localStorage.setItem(VOICE_MODE_STORAGE_KEY, mode);
    } catch {
      /* no-op */
    }
    setNotice(null);
    if (mode === "standard" || mode === "recorded")
      setVoicevoxStatus("unknown");
  }, []);

  const handleOptionalVoiceModeChange = useCallback(
    (mode: keyof OptionalVoiceModes, visible: boolean) => {
      setOptionalVoiceModes((previous) => {
        const next = { ...previous, [mode]: visible };
        try {
          window.localStorage.setItem(
            OPTIONAL_VOICE_MODES_STORAGE_KEY,
            JSON.stringify(next),
          );
        } catch {
          /* no-op */
        }
        return next;
      });

      // 選択中の音声を非表示にした場合は、常に使える録音音声へ戻す。
      if (!visible && voiceMode === mode) {
        handleVoiceModeChange("recorded");
      }
    },
    [handleVoiceModeChange, voiceMode],
  );

  const handleStyleChange = useCallback((id: number) => {
    setStyleId(id);
    try {
      window.localStorage.setItem(VOICEVOX_STYLE_STORAGE_KEY, String(id));
    } catch {
      /* no-op */
    }
  }, []);

  const handlePresetChange = useCallback((name: VoicevoxPresetName) => {
    const params = AUDIO_PRESETS[name];
    setAudioPreset(name);
    setAudioParams(params);
    try {
      window.localStorage.setItem(VOICEVOX_PRESET_STORAGE_KEY, name);
      window.localStorage.setItem(
        VOICEVOX_PARAMS_STORAGE_KEY,
        JSON.stringify(params),
      );
    } catch {
      /* no-op */
    }
  }, []);

  const handleStandardVoiceChange = useCallback((uri: string) => {
    setStandardVoiceURI(uri);
    try {
      window.localStorage.setItem(STANDARD_VOICE_STORAGE_KEY, uri);
    } catch {
      /* no-op */
    }
  }, []);

  const handleRecordedVolumeChange = useCallback((v: number) => {
    setAudioVolume(v);
    setRecordedAudioVolume(v);
    setVoicevoxVolume(v);
    setTransitionCueVolume(v);
    setRecordedVolume(v);
    try {
      window.localStorage.setItem(RECORDED_VOLUME_STORAGE_KEY, String(v));
    } catch {
      /* no-op */
    }
  }, []);
  const handleChimeChange = useCallback((enabled: boolean) => {
    setChimeEnabled(enabled);
    try {
      window.localStorage.setItem(
        FLOW_SETTINGS_STORAGE_KEY,
        JSON.stringify({ chimeEnabled: enabled }),
      );
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  /** 全方式の読み上げ停止 */
  const stopAllSpeaking = useCallback(() => {
    setNotice(null);
    stopTransitionCue();
    speechGenerationRef.current += 1;
    voicevoxAbortRef.current?.abort();
    voicevoxAbortRef.current = null;
    stopSpeaking();
    stopVoicevox();
    stopRecordedAudio();
    voicevoxHandleRef.current = null;
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    appMountedRef.current = true;
    return () => {
      appMountedRef.current = false;
      // Browser Back/Forward may bypass the header links. Capture the session playhead before releasing its audio.
      window.dispatchEvent(new Event("will-flow-leave"));
      stopAllSpeaking();
      listeningRef.current?.stop();
    };
  }, [stopAllSpeaking]);

  /**
   * 任意のテキストを現在の音声モードで読み上げる(進行モードからも利用)。
   * audioSrc がある場合は録音音声モードでその音声を再生し、失敗時は標準音声にフォールバック。
   * VOICEVOX 失敗時は内部で SpeechSynthesis にフォールバックする。
   */
  const speak = useCallback(
    async (
      text: string,
      audioSrc?: string,
      requireRecording = false,
      startAtSec = 0,
    ) => {
      if (requireRecording) setNotice(null);
      // 旧セッションを完全停止してから、新しい再生だけを現行セッションにする。
      stopAllSpeaking();
      const generation = ++speechGenerationRef.current;
      const isCurrent = () => generation === speechGenerationRef.current;
      const finishIfCurrent = () => {
        if (!isCurrent()) return;
        setIsSpeaking(false);
      };
      const fallbackToStandard = () => {
        if (!isCurrent()) return;
        speakText(text, {
          onEnd: finishIfCurrent,
          voiceURI: standardVoiceURI ?? undefined,
        });
      };

      setIsSpeaking(true);

      if ((requireRecording || voiceMode === "recorded") && audioSrc) {
        playRecordedAudio(audioSrc, {
          volume: getAudioVolume(),
          startAtSec,
          onEnd: finishIfCurrent,
          onError: requireRecording
            ? () => {
                if (!isCurrent()) return;
                finishIfCurrent();
                window.dispatchEvent(new Event("will-flow-audio-error"));
                setNotice(
                  "案内を再生できませんでした。接続を確認して、再生または再開ボタンでやり直してください。",
                );
              }
            : fallbackToStandard,
        });
        return;
      }

      if (requireRecording) {
        finishIfCurrent();
        setNotice("案内音声が見つかりません。ページを読み込み直してください。");
        return;
      }

      if (voiceMode === "voicevox") {
        if (!isLocalhost()) {
          fallbackToStandard();
          return;
        }

        const controller = new AbortController();
        voicevoxAbortRef.current = controller;
        const result = await speakWithVoicevox(text, {
          speakerId: styleId ?? undefined,
          params: audioParams,
          signal: controller.signal,
          onEnd: finishIfCurrent,
        });

        if (controller.signal.aborted || !isCurrent()) {
          result.handle?.stop();
          return;
        }

        voicevoxAbortRef.current = null;
        voicevoxHandleRef.current = result.handle ?? null;

        if (result.usedFallback) {
          setVoicevoxStatus("fallback");
          if (result.fallbackReason) setNotice(result.fallbackReason);
        } else {
          setVoicevoxStatus("connected");
        }
        return;
      }

      speakText(text, {
        onEnd: finishIfCurrent,
        voiceURI: standardVoiceURI ?? undefined,
      });
    },
    [audioParams, standardVoiceURI, stopAllSpeaking, styleId, voiceMode],
  );

  const speakRecorded = useCallback(
    (text: string, audioSrc?: string, startAtSec = 0) => {
      void speak(text, audioSrc, true, startAtSec);
    },
    [speak],
  );
  const leavePage = useCallback(() => {
    flowModeRef.current?.pauseForNavigation();
    listeningRef.current?.stop();
    window.dispatchEvent(new Event("will-flow-leave"));
    stopAllSpeaking();
  }, [stopAllSpeaking]);

  /** ユーザー発話受領 → うぃる返答生成 → 読み上げ */
  const handleUserMessage = useCallback(
    async (text: string) => {
      const replyGeneration = speechGenerationRef.current;
      addMessage("user", text);
      setIsThinking(true);

      let reply = "";
      try {
        reply = await generateWillReply(text);
      } catch {
        reply =
          "お疲れ様です！うまくお返事できませんでした🙇‍♂️ もう一度お試しください。";
      }

      if (
        !appMountedRef.current ||
        replyGeneration !== speechGenerationRef.current
      )
        return;
      setIsThinking(false);
      addMessage("will", reply);
      await speak(reply);
    },
    [addMessage, speak],
  );

  /** テキスト送信 */
  const handleTextSubmit = useCallback(() => {
    const text = textInput.trim();
    if (!text || isThinking) return;
    setTextInput("");
    handleUserMessage(text);
  }, [textInput, isThinking, handleUserMessage]);

  /** マイクボタン */
  const handleMicClick = useCallback(() => {
    if (isListening) {
      listeningRef.current?.stop();
      return;
    }
    if (isSpeaking) {
      stopAllSpeaking();
    }
    setNotice(null);

    const handle = startListening({
      lang: "ja-JP",
      onResult: (text) => handleUserMessage(text),
      onError: (message) => {
        setNotice(message);
        setIsListening(false);
      },
      onEnd: () => {
        setIsListening(false);
        listeningRef.current = null;
      },
    });

    if (handle) {
      listeningRef.current = handle;
      setIsListening(true);
    }
  }, [isListening, isSpeaking, handleUserMessage, stopAllSpeaking]);

  const handleVoiceTest = useCallback(() => {
    speak(VOICE_TEST_TEXT);
  }, [speak]);

  const micDisabled = !recognitionOk || isThinking;

  const statusLabel = useMemo(() => {
    if (voiceMode !== "voicevox") return null;
    switch (voicevoxStatus) {
      case "connected":
        return { text: "接続済み", cls: "voicevox-status__pill--ok" };
      case "fallback":
        return {
          text: "標準音声にフォールバック中",
          cls: "voicevox-status__pill--warn",
        };
      case "disconnected":
        return { text: "未接続", cls: "voicevox-status__pill--ng" };
      default:
        return { text: "確認中…", cls: "voicevox-status__pill--neutral" };
    }
  }, [voiceMode, voicevoxStatus]);

  return (
    <div
      className={`app app--${mode}${settingsOpen ? " app--settings-open" : ""}`}
    >
      {/* 共通ヘッダー: ブランド領域は常にHOMEへ戻る */}
      <header className="header">
        <Link
          href="/"
          className="header__brand"
          aria-label="うぃる HOMEへ"
          onClick={leavePage}
        >
          <div className="header__avatar">
            <Image
              src="/will.png"
              alt="うぃる"
              width={40}
              height={40}
              priority
            />
          </div>
          <div className="header__titles">
            <span className="header__title">うぃる</span>
            <span className="header__subtitle">
              WILL.tennis 公式キャラクター
            </span>
          </div>
        </Link>
        <PageNavigation
          current={mode}
          onNavigate={leavePage}
          onSettings={() => setSettingsOpen(true)}
        />
      </header>

      {settingsOpen && mode === "flow" && (
        <div
          className="settings-scrim"
          aria-hidden="true"
          onClick={() => setSettingsOpen(false)}
        />
      )}
      {settingsOpen && (
        <section
          id="audio-volume-settings"
          className="settings-panel"
          aria-label={mode === "flow" ? "設定" : "音量設定"}
          role={mode === "flow" ? "dialog" : undefined}
          aria-modal={mode === "flow" ? true : undefined}
        >
          <div className="settings-dialog-heading">
            <h2 className="settings-panel__heading">設定</h2>
            <button
              type="button"
              className="settings-close"
              aria-label="設定を閉じる"
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="settings-panel__volume">
            <label htmlFor="audio-volume">
              音声音量 <output>{Math.round(recordedVolume * 100)}%</output>
            </label>
            <input
              id="audio-volume"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(recordedVolume * 100)}
              onChange={(e) =>
                handleRecordedVolumeChange(Number(e.target.value) / 100)
              }
            />
            <p className="flow-muted">
              {mode === "flow"
                ? "自動進行・個別進行・声かけに共通です"
                : "録音・VOICEVOX・チャイムは再生中にも反映します。標準音声は次の再生から反映します。"}
            </p>
          </div>
          {mode === "flow" && (
            <>
              <div className="settings-panel__section">
                <div className="settings-panel__row">
                  <label htmlFor="flow-chime">チャイム</label>
                  <label className="settings-panel__switch">
                    <input
                      id="flow-chime"
                      type="checkbox"
                      role="switch"
                      aria-label="チャイム"
                      checked={chimeEnabled}
                      onChange={(e) => handleChimeChange(e.target.checked)}
                    />
                    <span aria-hidden="true">
                      {chimeEnabled ? "ON" : "OFF"}
                    </span>
                  </label>
                </div>
                <p className="flow-muted">メニュー切替時に再生します</p>
                <button
                  type="button"
                  className="flow-btn"
                  onClick={() => void flowModeRef.current?.playChimeTest()}
                >
                  <FlowTransportIcon kind="play" />
                  チャイムを試聴
                </button>
              </div>
              <div className="settings-panel__section">
                <h3>音声テスト</h3>
                <div className="flow-actions">
                  <button
                    type="button"
                    className="flow-btn"
                    onClick={() => flowModeRef.current?.playVoiceTest()}
                  >
                    <FlowTransportIcon kind="play" />
                    テスト再生
                  </button>
                  <button
                    type="button"
                    className="flow-btn"
                    disabled={!isSpeaking && !isChimePlaying}
                    onClick={() => flowModeRef.current?.stopCurrentAudio()}
                  >
                    <FlowTransportIcon kind="stop" />
                    試聴を停止
                  </button>
                </div>
              </div>
              <div className="settings-panel__section settings-panel__about">
                <h3>アプリについて</h3>
                <p>VOICEVOX: ずんだもん</p>
              </div>
            </>
          )}
        </section>
      )}
      <div hidden={mode === "flow"}>
        {settingsOpen && (
          <section
            id="voice-display-settings"
            className="settings-panel"
            aria-label="表示設定"
          >
            <div>
              <p className="settings-panel__title">表示する読み上げ音声</p>
              <p className="settings-panel__hint">
                録音音声は常に表示されます。必要な音声だけ追加してください。
              </p>
            </div>
            <label className="settings-panel__option">
              <input
                type="checkbox"
                checked={optionalVoiceModes.standard}
                onChange={(e) =>
                  handleOptionalVoiceModeChange("standard", e.target.checked)
                }
              />
              標準音声を表示
            </label>
            <label className="settings-panel__option">
              <input
                type="checkbox"
                checked={optionalVoiceModes.voicevox}
                onChange={(e) =>
                  handleOptionalVoiceModeChange("voicevox", e.target.checked)
                }
              />
              VOICEVOXを表示
            </label>
          </section>
        )}

        {/* 音声モード切替 */}
        <div className="voice-mode" role="radiogroup" aria-label="読み上げ音声">
          <span className="voice-mode__label">読み上げ:</span>
          <button
            type="button"
            role="radio"
            aria-checked={voiceMode === "recorded"}
            className={`voice-mode__btn ${
              voiceMode === "recorded" ? "voice-mode__btn--active" : ""
            }`}
            onClick={() => {
              stopAllSpeaking();
              handleVoiceModeChange("recorded");
            }}
            title="録音済みのうぃる音声で再生します（進行モードのみ）"
          >
            録音音声
          </button>
          {optionalVoiceModes.standard && (
            <button
              type="button"
              role="radio"
              aria-checked={voiceMode === "standard"}
              className={`voice-mode__btn ${
                voiceMode === "standard" ? "voice-mode__btn--active" : ""
              }`}
              onClick={() => {
                stopAllSpeaking();
                handleVoiceModeChange("standard");
              }}
              title="ブラウザ標準の音声合成で読み上げます"
            >
              標準音声
            </button>
          )}
          {optionalVoiceModes.voicevox && (
            <button
              type="button"
              role="radio"
              aria-checked={voiceMode === "voicevox"}
              className={`voice-mode__btn ${
                voiceMode === "voicevox" ? "voice-mode__btn--active" : ""
              }`}
              onClick={() => {
                stopAllSpeaking();
                handleVoiceModeChange("voicevox");
              }}
              title="VOICEVOX:ずんだもん で読み上げます"
            >
              VOICEVOX
            </button>
          )}
        </div>

        {/* 標準音声 詳細パネル */}
        {voiceMode === "standard" && japaneseVoices.length > 0 && (
          <div className="voicevox-panel">
            <div className="voicevox-panel__row">
              <label htmlFor="standard-voice" className="voicevox-panel__label">
                ボイス:
              </label>
              <select
                id="standard-voice"
                className="voicevox-panel__select"
                value={standardVoiceURI ?? ""}
                onChange={(e) => handleStandardVoiceChange(e.target.value)}
              >
                <option value="">自動選択</option>
                {japaneseVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* VOICEVOX 詳細パネル */}
        {voiceMode === "voicevox" && (
          <div className="voicevox-panel">
            <div className="voicevox-panel__row">
              <span className="voicevox-panel__credit">
                音声: VOICEVOX:ずんだもん
              </span>
              {isLocal && statusLabel && (
                <span className={`voicevox-status__pill ${statusLabel.cls}`}>
                  {statusLabel.text}
                </span>
              )}
            </div>

            {!isLocal ? (
              <div className="voicevox-panel__hint voicevox-panel__hint--public">
                公開版ではVOICEVOXに接続できないため、標準音声で読み上げます。
                ローカル環境でVOICEVOXを起動している場合のみ、VOICEVOX音声を利用できます。
              </div>
            ) : zundamonStyles.length > 0 ? (
              <div className="voicevox-panel__row">
                <label
                  htmlFor="zundamon-style"
                  className="voicevox-panel__label"
                >
                  話者スタイル:
                </label>
                <select
                  id="zundamon-style"
                  className="voicevox-panel__select"
                  value={styleId ?? ""}
                  onChange={(e) => handleStyleChange(Number(e.target.value))}
                >
                  {zundamonStyles.map((s) => (
                    <option key={s.styleId} value={s.styleId}>
                      ずんだもん {s.styleName} (id: {s.styleId})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="voicevox-panel__refresh"
                  onClick={() => refreshSpeakers()}
                  title="話者一覧を再取得"
                >
                  ↻
                </button>
              </div>
            ) : (
              <div className="voicevox-panel__hint">
                {voicevoxStatus === "disconnected"
                  ? "VOICEVOXに接続できませんでした。VOICEVOXアプリを起動してから「↻」で再確認してください。標準音声で読み上げます。"
                  : voicevoxStatus === "unknown"
                    ? "VOICEVOX の話者一覧を確認しています…"
                    : "ずんだもんの話者が見つかりませんでした。VOICEVOXのバージョンをご確認ください。"}
                {speakersError && (
                  <span className="voicevox-panel__error">
                    {" "}
                    ({speakersError})
                  </span>
                )}
                <button
                  type="button"
                  className="voicevox-panel__refresh"
                  onClick={() => refreshSpeakers()}
                  title="再確認"
                >
                  ↻
                </button>
              </div>
            )}

            {/* 音声チューニング (localhost のみ) */}
            {isLocal && (
              <div className="voicevox-tuning">
                <div className="voicevox-tuning__label">音声チューニング:</div>
                <div className="voicevox-tuning__presets">
                  {PRESET_NAMES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`voicevox-tuning__preset-btn${audioPreset === name ? " voicevox-tuning__preset-btn--active" : ""}`}
                      onClick={() => handlePresetChange(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="voicevox-tuning__test-btn"
                  onClick={handleVoiceTest}
                  disabled={isSpeaking}
                >
                  この設定で音声テスト
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {notice && (
        <div className="notice" role="alert">
          {notice}
        </div>
      )}

      {/* タブ別本体 */}
      {mode === "chat" ? (
        <>
          <div className="chat-log" ref={logRef}>
            <header className="content-page-heading content-page-heading--chat">
              <p>CHAT</p>
              <h1>チャット</h1>
              <span>うぃるに気軽に聞いてみる</span>
            </header>
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} />
            ))}

            {isThinking && (
              <div className="msg-row msg-row--will">
                <div className="msg-avatar">
                  <Image src="/will.png" alt="うぃる" width={36} height={36} />
                </div>
                <div className="msg-bubble-wrap">
                  <span className="msg-name">うぃる</span>
                  <div className="msg-bubble msg-bubble--will">
                    <span className="typing" aria-label="入力中">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className={`status-bar ${isListening ? "status-bar--listening" : ""}`}
            aria-live="polite"
          >
            {isListening && (
              <>
                <span className="status-dot status-dot--listening" />
                お話をきいています…
              </>
            )}
            {!isListening && isSpeaking && (
              <>
                <span className="status-dot status-dot--speaking" />
                うぃるが読み上げています…
              </>
            )}
          </div>

          <footer className="footer">
            <div className="chat-input-row">
              <button
                type="button"
                className={`mic-icon-btn${isListening ? " mic-icon-btn--active" : ""}`}
                onClick={handleMicClick}
                disabled={micDisabled}
                aria-label={isListening ? "マイクを停止" : "マイクで話す"}
                title={isListening ? "マイクを停止" : "マイクで話す"}
              >
                {isListening ? "■" : "🎤"}
              </button>
              <input
                type="text"
                className="chat-input"
                placeholder="メッセージを入力…"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleTextSubmit();
                  }
                }}
                disabled={isThinking}
                aria-label="メッセージを入力"
              />
              <button
                type="button"
                className="chat-send-btn"
                onClick={handleTextSubmit}
                disabled={!textInput.trim() || isThinking}
                aria-label="送信"
              >
                送信
              </button>
            </div>
            <p className="footer__credit">
              音声: VOICEVOX:ずんだもん / ブラウザ標準音声
              {voiceMode === "recorded" &&
                "(録音音声は進行モード専用のため、チャットでは標準音声で読み上げます)"}
            </p>
          </footer>
        </>
      ) : (
        <>
          <div className="flow-scroll">
            <header className="content-page-heading">
              <p>VOICE</p>
              <h1>進行アシスタント</h1>
              <span>WILL.tennisの進行を音声でサポート</span>
            </header>
            <FlowMode
              ref={flowModeRef}
              chimeEnabled={chimeEnabled}
              onChimePlayingChange={setIsChimePlaying}
              speak={speak}
              speakRecorded={speakRecorded}
              stopSpeaking={stopAllSpeaking}
              isSpeaking={isSpeaking}
              voiceMode={voiceMode}
            />
          </div>

          <div
            className={`status-bar ${isSpeaking ? "status-bar--speaking" : ""}`}
            aria-live="polite"
          >
            {isSpeaking && (
              <>
                <span className="status-dot status-dot--speaking" />
                うぃるが読み上げています…
              </>
            )}
          </div>

          <footer className="footer footer--slim">
            <p className="footer__credit">音声: VOICEVOX:ずんだもん</p>
          </footer>
        </>
      )}
    </div>
  );
}
