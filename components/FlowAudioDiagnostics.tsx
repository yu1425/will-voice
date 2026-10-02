"use client";
import { useEffect, useState } from "react";
import {
  AUDIO_DIAGNOSTIC_EVENT,
  clearRecordedAudioDiagnostics,
  getRecordedAudioDiagnostics,
  type PlaybackDiagnostic,
} from "@/lib/recordedAudio";
import { getFlowAudioTitle } from "@/lib/offlineFlowAudio";

export default function FlowAudioDiagnostics() {
  const [entries, setEntries] = useState<PlaybackDiagnostic[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const refresh = () => setEntries(getRecordedAudioDiagnostics());
    refresh();
    window.addEventListener(AUDIO_DIAGNOSTIC_EVENT, refresh);
    return () => window.removeEventListener(AUDIO_DIAGNOSTIC_EVENT, refresh);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      setMessage("診断ログをコピーしました。");
    } catch {
      setMessage(
        "コピーできませんでした。この端末のクリップボード設定を確認してください。",
      );
    }
  };
  return (
    <details className="flow-support settings-panel__section">
      <summary>
        <span>音声診断</span>
        <span className="flow-summary-meta">{entries.length}件</span>
      </summary>
      <div className="flow-support-body">
        <p className="flow-muted">
          この端末だけに直近20件を保存します。外部へ送信しません。
        </p>
        {entries.length === 0 ? (
          <p>診断ログはありません。</p>
        ) : (
          <ol className="flow-diagnostics-list">
            {[...entries].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <time>{new Date(entry.at).toLocaleTimeString("ja-JP")}</time>{" "}
                <strong>
                  {getFlowAudioTitle(entry.flowAudioSrc ?? entry.src)}
                </strong>
                <p>
                  {entry.type === "recovery"
                    ? "復旧成功（自動再試行）"
                    : entry.type === "final-failure"
                      ? "2回目も再生に失敗・最終失敗"
                      : "1回目の再生に失敗 → 自動再試行"}
                  {entry.errorName ? ` · ${entry.errorName}` : ""}
                </p>
                <details>
                  <summary>技術詳細</summary>
                  <pre>
                    {JSON.stringify(
                      {
                        mediaErrorCode: entry.mediaErrorCode,
                        networkState: entry.networkState,
                        readyState: entry.readyState,
                        online: entry.online,
                        visibilityState: entry.visibilityState,
                        errorMessage: entry.errorMessage,
                        src: entry.src,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        )}
        <div className="flow-actions">
          <button
            type="button"
            className="flow-btn"
            disabled={!entries.length}
            onClick={() => void copy()}
          >
            診断ログをコピー
          </button>
          <button
            type="button"
            className="flow-btn"
            disabled={!entries.length}
            onClick={() => setConfirm(true)}
          >
            診断ログを消去
          </button>
        </div>
        {confirm && (
          <div className="flow-end-confirm">
            <p>診断ログを消去しますか？</p>
            <div className="flow-actions">
              <button
                type="button"
                className="flow-btn"
                onClick={() => setConfirm(false)}
              >
                戻る
              </button>
              <button
                type="button"
                className="flow-btn"
                onClick={() => {
                  const ok = clearRecordedAudioDiagnostics();
                  setEntries(getRecordedAudioDiagnostics());
                  setConfirm(false);
                  setMessage(
                    ok ? "診断ログを消去しました。" : "消去できませんでした。",
                  );
                }}
              >
                消去する
              </button>
            </div>
          </div>
        )}
        <p role="status">{message}</p>
      </div>
    </details>
  );
}
