"use client";
import { useEffect, useState } from "react";
import {
  clearFlowRunHistory,
  FLOW_HISTORY_EVENT,
  getFlowRunHistory,
  type FlowRun,
} from "@/lib/flowRunHistory";

export default function FlowRunHistory() {
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const refresh = () => setRuns(getFlowRunHistory());
    refresh();
    window.addEventListener(FLOW_HISTORY_EVENT, refresh);
    return () => window.removeEventListener(FLOW_HISTORY_EVENT, refresh);
  }, []);
  return (
    <details className="flow-surface flow-support flow-history">
      <summary>
        <span>開催履歴</span>
        <span className="flow-summary-meta">{runs.length}件 · 端末内</span>
      </summary>
      <div className="flow-support-body">
        {runs.length === 0 ? (
          <p className="flow-muted">終了した開催はまだありません。</p>
        ) : (
          <ol className="flow-history-list">
            {[...runs].reverse().map((run) => (
              <li key={run.id}>
                <div className="flow-header">
                  <time>
                    {new Date(run.startedAt).toLocaleString("ja-JP", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <strong>
                    {run.courts}面 ·{" "}
                    {run.completedNormally ? "完走" : "途中終了"}
                  </strong>
                </div>
                <p>
                  実進行 {Math.floor(run.actualDurationSec / 60)}分 ·
                  手動一時停止 {run.manualPauseCount} · 安全停止{" "}
                  {run.safetyPauseCount} · 時刻移動 {run.seekCount}
                </p>
                <p>
                  音声retry {run.audioRetryCount} · 自動復旧{" "}
                  {run.audioRecoveryCount} · 最終失敗{" "}
                  {run.audioFinalFailureCount}
                </p>
                <details>
                  <summary>安全停止の内訳</summary>
                  <p>
                    画面非表示 {run.pauseReasons.visibility} · 画面移動{" "}
                    {run.pauseReasons.navigation} · 音声エラー{" "}
                    {run.pauseReasons["audio-error"]}
                  </p>
                </details>
              </li>
            ))}
          </ol>
        )}
        <p className="flow-muted">
          直近20開催。実進行時間は一時停止を除き、時刻移動では増えません。参加者情報は保存しません。
        </p>
        <button
          type="button"
          className="flow-btn"
          disabled={!runs.length}
          onClick={() => setConfirm(true)}
        >
          履歴を消去
        </button>
        {confirm && (
          <div className="flow-end-confirm">
            <p>開催履歴を消去しますか？</p>
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
                  const ok = clearFlowRunHistory();
                  setConfirm(false);
                  setMessage(
                    ok
                      ? "履歴を消去しました。"
                      : "この画面の履歴を消去しました。端末への保存はできませんでした。",
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
