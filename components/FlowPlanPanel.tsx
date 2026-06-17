"use client";

/**
 * 今日の進行プラン パネル
 * ============================================================
 *  - 参加人数 / コート数 / 開催時間 / 初参加人数 / 初心者多め / 雰囲気 を入力
 *  - 入力に応じて、その場で進行プランを表示
 *  - プランをコピーできる
 * ============================================================
 */

import { useMemo, useState } from "react";
import {
  buildFlowPlan,
  formatPlanTime,
  planToText,
  type FlowConditions,
  type FlowDurationHours,
  type FlowVibe,
} from "@/lib/flowPlan";

type Props = {
  conditions: FlowConditions;
  onChange: (next: FlowConditions) => void;
};

const DURATION_OPTIONS: { value: FlowDurationHours; label: string }[] = [
  { value: 1, label: "1時間" },
  { value: 1.5, label: "1.5時間" },
  { value: 2, label: "2時間" },
  { value: 3, label: "3時間" },
];

const VIBE_OPTIONS: { value: FlowVibe; label: string }[] = [
  { value: "casual", label: "ゆるめ" },
  { value: "standard", label: "標準" },
  { value: "serious", label: "しっかり" },
];

export default function FlowPlanPanel({ conditions, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const plan = useMemo(() => buildFlowPlan(conditions), [conditions]);

  const patch = (partial: Partial<FlowConditions>) => {
    onChange({ ...conditions, ...partial });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(planToText(plan));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op */
    }
  };

  const handleParticipants = (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return patch({ participants: 0 });
    patch({ participants: Math.max(0, Math.min(40, Math.floor(n))) });
  };

  const handleNewcomers = (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return patch({ newcomerCount: 0 });
    patch({ newcomerCount: Math.max(0, Math.min(40, Math.floor(n))) });
  };

  return (
    <section className="plan-panel">
      <button
        type="button"
        className="plan-panel__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="plan-panel__title">今日の進行プラン</span>
        <span className="plan-panel__chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="plan-panel__body">
          {/* 入力欄 */}
          <div className="plan-form">
            <div className="plan-form__row">
              <label className="plan-form__label" htmlFor="cond-participants">
                参加人数
              </label>
              <input
                id="cond-participants"
                type="number"
                className="plan-form__input"
                value={conditions.participants || ""}
                onChange={(e) => handleParticipants(e.target.value)}
                min={0}
                max={40}
                inputMode="numeric"
                placeholder="人"
              />
            </div>

            <div className="plan-form__row">
              <span className="plan-form__label">コート数</span>
              <div className="plan-form__choices">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`plan-form__chip ${
                      conditions.courts === n ? "plan-form__chip--active" : ""
                    }`}
                    onClick={() => patch({ courts: n as 1 | 2 })}
                  >
                    {n}面
                  </button>
                ))}
              </div>
            </div>

            <div className="plan-form__row">
              <span className="plan-form__label">開催時間</span>
              <div className="plan-form__choices">
                {DURATION_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`plan-form__chip ${
                      conditions.durationHours === o.value
                        ? "plan-form__chip--active"
                        : ""
                    }`}
                    onClick={() => patch({ durationHours: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="plan-form__row">
              <label className="plan-form__label" htmlFor="cond-newcomers">
                初参加者の人数
              </label>
              <input
                id="cond-newcomers"
                type="number"
                className="plan-form__input"
                value={conditions.newcomerCount || ""}
                onChange={(e) => handleNewcomers(e.target.value)}
                min={0}
                max={40}
                inputMode="numeric"
                placeholder="人"
              />
            </div>

            <div className="plan-form__row">
              <label className="plan-form__check">
                <input
                  type="checkbox"
                  checked={conditions.manyBeginners}
                  onChange={(e) =>
                    patch({ manyBeginners: e.target.checked })
                  }
                />
                <span>初心者が多い</span>
              </label>
            </div>

            <div className="plan-form__row">
              <span className="plan-form__label">雰囲気</span>
              <div className="plan-form__choices">
                {VIBE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`plan-form__chip ${
                      conditions.vibe === o.value
                        ? "plan-form__chip--active"
                        : ""
                    }`}
                    onClick={() => patch({ vibe: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* プラン表示 */}
          <div className="plan-result">
            <div className="plan-result__head">
              <span className="plan-result__title">プラン</span>
              <button
                type="button"
                className="plan-result__copy"
                onClick={handleCopy}
              >
                {copied ? "コピー済み" : "プランをコピー"}
              </button>
            </div>
            <ol className="plan-result__list">
              {plan.map((it, i) => (
                <li key={i} className="plan-result__item">
                  <span className="plan-result__time">
                    {formatPlanTime(it.startMin)}〜{formatPlanTime(it.endMin)}
                  </span>
                  <span className="plan-result__label">{it.label}</span>
                </li>
              ))}
            </ol>
            <p className="plan-result__hint">
              ※ 当日の状況に応じて、ステップの長さは前後しても大丈夫です。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
