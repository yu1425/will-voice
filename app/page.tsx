"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import ChatMessage, { ChatMessageData } from "@/components/ChatMessage";
import FlowMode from "@/components/FlowMode";
import { generateWillReply } from "@/lib/generateWillReply";
import { WILL_GREETING } from "@/lib/willPrompt";
import {
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
  fetchVoicevoxSpeakers,
  pickZundamonStyles,
  type VoicevoxHandle,
  type ZundamonStyle,
} from "@/lib/voicevox";
import { playRecordedAudio, stopRecordedAudio } from "@/lib/recordedAudio";

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
type Tab = "chat" | "flow";

const VOICE_MODE_STORAGE_KEY = "will-voice-mode";
const VOICEVOX_STYLE_STORAGE_KEY = "will-voicevox-style-id";
const TAB_STORAGE_KEY = "will-active-tab";
const VOICEVOX_PRESET_STORAGE_KEY = "will-voicevox-preset";
const VOICEVOX_PARAMS_STORAGE_KEY = "will-voicevox-params";

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
  "標準":              { speedScale: 1.0,  pitchScale: 0.0, intonationScale: 1.0,  volumeScale: 1.0, prePhonemeLength: 0.1, postPhonemeLength: 0.2  },
  "明るめ":            { speedScale: 1.05, pitchScale: 0.0, intonationScale: 1.15, volumeScale: 1.0, prePhonemeLength: 0.1, postPhonemeLength: 0.2  },
  "聞き取りやすさ重視": { speedScale: 0.95, pitchScale: 0.0, intonationScale: 1.05, volumeScale: 1.0, prePhonemeLength: 0.1, postPhonemeLength: 0.25 },
  "ゆっくり":          { speedScale: 0.88, pitchScale: 0.0, intonationScale: 1.0,  volumeScale: 1.0, prePhonemeLength: 0.1, postPhonemeLength: 0.3  },
};
const PRESET_NAMES: VoicevoxPresetName[] = ["標準", "明るめ", "聞き取りやすさ重視", "ゆっくり"];
const DEFAULT_PRESET: VoicevoxPresetName = "明るめ";

const VOICE_TEST_TEXT =
  "本日はご参加ありがとうございます。ショートラリーとボレーボレーを、それぞれ5分ずつ行います。聞こえ方に問題がなければ、この設定で進行してください。";

export default function Page() {
  const [tab, setTab] = useState<Tab>("chat");
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
  const [voicevoxStatus, setVoicevoxStatus] = useState<VoicevoxStatus>("unknown");
  const [zundamonStyles, setZundamonStyles] = useState<ZundamonStyle[]>([]);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [speakersError, setSpeakersError] = useState<string | null>(null);
  const [audioPreset, setAudioPreset] = useState<VoicevoxPresetName>(DEFAULT_PRESET);
  const [audioParams, setAudioParams] = useState<AudioPresetParams>(AUDIO_PRESETS[DEFAULT_PRESET]);
  const [isLocal, setIsLocal] = useState(true);

  const listeningRef = useRef<ListeningHandle | null>(null);
  const voicevoxHandleRef = useRef<VoicevoxHandle | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // 初期化(クライアントのみ)
  useEffect(() => {
    setRecognitionOk(isSpeechRecognitionSupported());
    if (!isSpeechRecognitionSupported()) {
      setNotice(
        "このブラウザは音声認識に対応していません。スマホ/PCの Chrome でお試しください😊"
      );
    }
    if (isSpeechSynthesisSupported()) {
      window.speechSynthesis.getVoices();
    }

    const local = isLocalhost();
    setIsLocal(local);

    try {
      // 公開環境では VOICEVOX モードを復元しない（localhost のみ有効）
      if (local) {
        const savedVoice = window.localStorage.getItem(VOICE_MODE_STORAGE_KEY);
        if (savedVoice === "voicevox" || savedVoice === "standard" || savedVoice === "recorded") {
          setVoiceMode(savedVoice);
        }
      }
      const savedTab = window.localStorage.getItem(TAB_STORAGE_KEY);
      if (savedTab === "chat" || savedTab === "flow") {
        setTab(savedTab);
      }
      const savedPreset = window.localStorage.getItem(VOICEVOX_PRESET_STORAGE_KEY);
      if (savedPreset && savedPreset in AUDIO_PRESETS) {
        const p = savedPreset as VoicevoxPresetName;
        setAudioPreset(p);
        const rawParams = window.localStorage.getItem(VOICEVOX_PARAMS_STORAGE_KEY);
        if (rawParams) {
          const parsed = JSON.parse(rawParams) as Partial<AudioPresetParams>;
          setAudioParams({ ...AUDIO_PRESETS[p], ...parsed });
        } else {
          setAudioParams(AUDIO_PRESETS[p]);
        }
      }
    } catch {
      /* no-op */
    }
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
        if (Number.isFinite(parsed) && styles.some((s) => s.styleId === parsed)) {
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
    []
  );

  /** タブ切替 */
  const handleTabChange = useCallback((next: Tab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* no-op */
    }
  }, []);

  /** 音声モード切替 */
  const handleVoiceModeChange = useCallback((mode: VoiceMode) => {
    setVoiceMode(mode);
    try {
      window.localStorage.setItem(VOICE_MODE_STORAGE_KEY, mode);
    } catch {
      /* no-op */
    }
    setNotice(null);
    if (mode === "standard" || mode === "recorded") setVoicevoxStatus("unknown");
  }, []);

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
      window.localStorage.setItem(VOICEVOX_PARAMS_STORAGE_KEY, JSON.stringify(params));
    } catch {
      /* no-op */
    }
  }, []);

  /** 全方式の読み上げ停止 */
  const stopAllSpeaking = useCallback(() => {
    stopSpeaking();
    stopVoicevox();
    stopRecordedAudio();
    voicevoxHandleRef.current = null;
    setIsSpeaking(false);
  }, []);

  /**
   * 任意のテキストを現在の音声モードで読み上げる(進行モードからも利用)。
   * audioSrc がある場合は録音音声モードでその音声を再生し、失敗時は標準音声にフォールバック。
   * VOICEVOX 失敗時は内部で SpeechSynthesis にフォールバックする。
   */
  const speak = useCallback(
    async (text: string, audioSrc?: string) => {
      // 連続して呼ばれたときに備えて前回の再生を止める
      stopAllSpeaking();
      setIsSpeaking(true);

      if (voiceMode === "recorded" && audioSrc) {
        playRecordedAudio(audioSrc, {
          onEnd: () => setIsSpeaking(false),
          onError: () => {
            // 録音音声の再生失敗時は標準音声にフォールバック
            speakText(text, { onEnd: () => setIsSpeaking(false) });
          },
        });
        return;
      }

      if (voiceMode === "voicevox") {
        if (!isLocalhost()) {
          // 公開環境では VOICEVOX ENGINE に接続できないため標準音声で再生
          speakText(text, { onEnd: () => setIsSpeaking(false) });
          return;
        }
        const result = await speakWithVoicevox(text, {
          speakerId: styleId ?? undefined,
          params: audioParams,
          onEnd: () => setIsSpeaking(false),
        });
        voicevoxHandleRef.current = result.handle ?? null;
        if (result.usedFallback) {
          setVoicevoxStatus("fallback");
          if (result.fallbackReason) setNotice(result.fallbackReason);
        } else {
          setVoicevoxStatus("connected");
        }
      } else {
        speakText(text, {
          onEnd: () => setIsSpeaking(false),
        });
      }
    },
    [voiceMode, styleId, audioParams, stopAllSpeaking]
  );

  /** ユーザー発話受領 → うぃる返答生成 → 読み上げ */
  const handleUserMessage = useCallback(
    async (text: string) => {
      addMessage("user", text);
      setIsThinking(true);

      let reply = "";
      try {
        reply = await generateWillReply(text);
      } catch {
        reply =
          "お疲れ様です！うまくお返事できませんでした🙇‍♂️ もう一度お試しください。";
      }

      setIsThinking(false);
      addMessage("will", reply);
      await speak(reply);
    },
    [addMessage, speak]
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
    <div className="app">
      {/* ヘッダー */}
      <header className="header">
        <div className="header__avatar">
          <Image src="/will.png" alt="うぃる" width={40} height={40} priority />
        </div>
        <div className="header__titles">
          <span className="header__title">うぃる AIボイス</span>
          <span className="header__subtitle">WILL.tennis マスコット</span>
        </div>
      </header>

      {/* タブ切替 */}
      <div className="tabs" role="tablist" aria-label="モード">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chat"}
          className={`tabs__btn ${tab === "chat" ? "tabs__btn--active" : ""}`}
          onClick={() => handleTabChange("chat")}
        >
          通常チャット
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "flow"}
          className={`tabs__btn ${tab === "flow" ? "tabs__btn--active" : ""}`}
          onClick={() => handleTabChange("flow")}
        >
          進行モード
        </button>
      </div>

      {/* 音声モード切替 */}
      <div className="voice-mode" role="radiogroup" aria-label="読み上げ音声">
        <span className="voice-mode__label">読み上げ:</span>
        <button
          type="button"
          role="radio"
          aria-checked={voiceMode === "standard"}
          className={`voice-mode__btn ${
            voiceMode === "standard" ? "voice-mode__btn--active" : ""
          }`}
          onClick={() => handleVoiceModeChange("standard")}
          title="ブラウザ標準の音声合成で読み上げます"
        >
          標準音声
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={voiceMode === "recorded"}
          className={`voice-mode__btn ${
            voiceMode === "recorded" ? "voice-mode__btn--active" : ""
          }`}
          onClick={() => handleVoiceModeChange("recorded")}
          title="録音済みのうぃる音声で再生します（進行モードのみ）"
        >
          録音音声
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={voiceMode === "voicevox"}
          className={`voice-mode__btn ${
            voiceMode === "voicevox" ? "voice-mode__btn--active" : ""
          }`}
          onClick={() => handleVoiceModeChange("voicevox")}
          title="VOICEVOX:ずんだもん で読み上げます"
        >
          VOICEVOX
        </button>
      </div>
      {voiceMode === "recorded" && (
        <div className="recorded-panel">
          進行モードの各ステップで、うぃるの録音音声を再生します。録音のないステップは標準音声で読み上げます。チャットモードは標準音声を使用します。
        </div>
      )}

      {/* VOICEVOX 詳細パネル */}
      {voiceMode === "voicevox" && (
        <div className="voicevox-panel">
          <div className="voicevox-panel__row">
            <span className="voicevox-panel__credit">音声: VOICEVOX:ずんだもん</span>
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
              <label htmlFor="zundamon-style" className="voicevox-panel__label">
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
                <span className="voicevox-panel__error"> ({speakersError})</span>
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

      {notice && <div className="notice">{notice}</div>}

      {/* タブ別本体 */}
      {tab === "chat" ? (
        <>
          <div className="chat-log" ref={logRef}>
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
            </p>
          </footer>
        </>
      ) : (
        <>
          <div className="flow-scroll">
            <FlowMode
              speak={speak}
              stopSpeaking={stopAllSpeaking}
              isSpeaking={isSpeaking}
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
            <p className="footer__credit">
              音声: VOICEVOX:ずんだもん / ブラウザ標準音声
            </p>
          </footer>
        </>
      )}
    </div>
  );
}
