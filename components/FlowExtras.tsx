"use client";
import { useEffect, useState } from "react";
import { FLOW_QUICK_CAUTIONS } from "@/lib/flowCautions";
export default function FlowExtras({
  speak,
  active,
}: {
  speak: (text: string) => void;
  active: boolean;
}) {
  const [endAt, setEndAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(300);
  useEffect(() => {
    if (endAt === null) return;
    const tick = () => {
      const sec = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setRemaining(sec);
      if (sec === 0) {
        setEndAt(null);
        if (active && document.visibilityState === "visible")
          speak("時間になりました。次の案内へ進んでください。");
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endAt, active, speak]);
  return (
    <details className="flow-surface flow-extras">
      <summary>タイマー・声かけ</summary>
      <p className="flow-muted">
        練習を区切ったり、必要なときだけ声かけできます。
      </p>
      <div className="flow-setting">
        <strong className="flow-extra-time">
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </strong>
        <span>{endAt ? "計測中" : "停止中"}</span>
      </div>
      <div className="flow-actions">
        {[5, 10].map((m) => (
          <button
            key={m}
            type="button"
            className="flow-btn"
            disabled={endAt !== null}
            onClick={() => {
              setRemaining(m * 60);
              setEndAt(Date.now() + m * 60000);
            }}
          >
            {m}分を開始
          </button>
        ))}
        <button
          type="button"
          className="flow-btn"
          disabled={endAt === null}
          onClick={() => setEndAt(null)}
        >
          タイマーを一時停止
        </button>
        <button
          type="button"
          className="flow-btn"
          disabled={endAt !== null || remaining <= 0 || remaining === 300}
          onClick={() => setEndAt(Date.now() + remaining * 1000)}
        >
          残りから再開
        </button>
      </div>
      <button
        type="button"
        className="flow-btn"
        onClick={() => {
          setEndAt(null);
          setRemaining(300);
        }}
      >
        タイマーをリセット
      </button>
      <h2 className="flow-list-title">声かけ</h2>
      <p className="flow-muted">声かけはブラウザの音声で読み上げます。</p>
      <div className="flow-actions">
        {FLOW_QUICK_CAUTIONS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="flow-btn"
            onClick={() => speak(c.voiceText)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </details>
  );
}
