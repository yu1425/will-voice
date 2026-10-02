"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { getAudioVolume } from "@/lib/audioVolume";
import {
  audioReadiness,
  checkFlowAudio,
  prepareFlowAudio,
  type AudioReadiness,
} from "@/lib/offlineFlowAudio";

export type FlowReadinessHandle = { prepare: () => Promise<boolean> };
export default forwardRef<
  FlowReadinessHandle,
  {
    chimeEnabled: boolean;
    onVoiceTest: () => void;
    onChimeTest: () => Promise<void>;
  }
>(function FlowReadinessPanel({ chimeEnabled, onVoiceTest, onChimeTest }, ref) {
  const [result, setResult] = useState<AudioReadiness>(() =>
    audioReadiness(0, [], true, false),
  );
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [volume, setVolume] = useState(1);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      setOnline(navigator.onLine);
      setVolume(getAudioVolume());
    };
    refresh();
    void checkFlowAudio().then((value) => {
      if (mounted.current) setResult(value);
    });
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("will-audio-volume-changed", refresh);
    const controlled = () => {
      void checkFlowAudio().then((value) => {
        if (mounted.current) setResult(value);
      });
    };
    navigator.serviceWorker?.addEventListener("controllerchange", controlled);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("will-audio-volume-changed", refresh);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        controlled,
      );
    };
  }, []);
  const prepare = useCallback(async () => {
    setBusy(true);
    const value = await prepareFlowAudio((progress) => {
      if (mounted.current) setResult(progress);
    });
    if (mounted.current) {
      setResult(value);
      setBusy(false);
    }
    return value.ready;
  }, []);
  useImperativeHandle(ref, () => ({ prepare }), [prepare]);
  return (
    <details
      className="flow-readiness flow-support"
      onToggle={() => setVolume(getAudioVolume())}
    >
      <summary>
        <span>開催前チェック</span>
        <span className="flow-summary-meta" role="status">
          {busy
            ? `音声を準備中 ${result.cached + result.failed} / ${result.total}`
            : result.ready
              ? "音声準備完了"
              : "音声を準備してください"}
        </span>
      </summary>
      <div className="flow-support-body">
        <p>
          案内音声{" "}
          <strong>
            {result.cached} / {result.total}
          </strong>{" "}
          準備済み
        </p>
        <p>
          通信：
          {online === null ? "不明" : online ? "オンライン" : "オフライン"} ·
          音量 {Math.round(volume * 100)}% · チャイム{" "}
          {chimeEnabled ? "ON" : "OFF"}
        </p>
        {volume === 0 && (
          <p className="flow-warning" role="status">
            音量が0%です。設定で音量を上げてください。
          </p>
        )}
        {!result.supported ? (
          <p className="flow-warning">
            この環境では音声を保存できません。オンライン再生を利用できます。
          </p>
        ) : online === false && !result.ready ? (
          <p className="flow-warning">
            固定案内音声が準備されていません。通信接続後に音声を準備してください。
          </p>
        ) : result.failed > 0 ? (
          <p className="flow-warning">
            {result.failed}件を取得できませんでした。再試行できます。
          </p>
        ) : result.cached === result.total && !result.workerReady ? (
          <p className="flow-warning">
            オフライン再生を有効にできませんでした。再試行してください。
          </p>
        ) : null}
        <div className="flow-actions">
          <button
            type="button"
            className="flow-btn"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {busy
              ? "音声を準備中…"
              : result.failed
                ? "音声準備を再試行"
                : "音声を準備"}
          </button>
          <button type="button" className="flow-btn" onClick={onVoiceTest}>
            テスト音を再生
          </button>
          {chimeEnabled && (
            <button
              type="button"
              className="flow-btn"
              onClick={() => void onChimeTest()}
            >
              チャイムを確認
            </button>
          )}
        </div>
        <p className="flow-muted">
          接続先のスピーカーから聞こえるか確認してください。Bluetooth接続先はこの画面では判定できません。
        </p>
        <p className="flow-muted">
          準備後は、この画面を開いたまま固定案内音声で進行できます。保存済み音声は再取得しません。
        </p>
      </div>
    </details>
  );
});
