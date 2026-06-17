"use client";

/**
 * やさしい注意喚起 パネル
 * ============================================================
 *  6種類の「やさしい注意喚起」を一覧表示し、押すとうぃるが
 *  短いセリフを読み上げる。
 * ============================================================
 */

import { useState } from "react";
import { FLOW_CAUTIONS } from "@/lib/flowCautions";

type Props = {
  speak: (text: string) => void;
};

export default function FlowCautionPanel({ speak }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="caution-panel">
      <button
        type="button"
        className="caution-panel__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="caution-panel__title">やさしい注意喚起</span>
        <span className="caution-panel__chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="caution-panel__body">
          <div className="caution-panel__grid">
            {FLOW_CAUTIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="caution-panel__btn"
                onClick={() => speak(c.voiceText)}
                title={c.voiceText}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="caution-panel__hint">
            押すと、うぃるが短くやさしく読み上げます。
          </p>
        </div>
      )}
    </section>
  );
}
