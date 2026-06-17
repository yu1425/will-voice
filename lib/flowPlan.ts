/**
 * 今日の進行プラン生成
 * ============================================================
 *  参加人数・コート数・開催時間・初参加人数・雰囲気 から、
 *  当日の時間配分プランをルールベースで作ります。
 *  まだ AI API は使わず、シンプルなテンプレ + 微調整で生成します。
 * ============================================================
 */

export type FlowVibe = "casual" | "standard" | "serious";
export type FlowDurationHours = 1 | 1.5 | 2 | 3;

export type FlowConditions = {
  /** 参加人数 */
  participants: number;
  /** コート数 */
  courts: 1 | 2;
  /** 開催時間(時間単位) */
  durationHours: FlowDurationHours;
  /** 初参加者の人数 */
  newcomerCount: number;
  /** 初心者が多いか */
  manyBeginners: boolean;
  /** 雰囲気 */
  vibe: FlowVibe;
};

export const DEFAULT_CONDITIONS: FlowConditions = {
  participants: 8,
  courts: 1,
  durationHours: 2,
  newcomerCount: 0,
  manyBeginners: false,
  vibe: "standard",
};

export type PlanItem = {
  /** 開始(分。開始からの累計) */
  startMin: number;
  /** 終了(分) */
  endMin: number;
  /** 表示ラベル */
  label: string;
  /** 対応する step 番号(参考。プランの再生は手動) */
  refStep?: number;
};

/**
 * 時間(分)を "h:mm" に整形
 */
export function formatPlanTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

type Segment = { label: string; min: number; refStep?: number };

/**
 * 開催時間ごとのベーステンプレ。
 * 合計が durationHours*60 と一致するよう、最後の項目で帳尻を合わせます。
 */
function baseSegments(durationHours: FlowDurationHours): Segment[] {
  if (durationHours === 1) {
    return [
      { label: "開始あいさつ・ショートラリー・ボレーボレー", min: 10, refStep: 2 },
      { label: "ロングラリー・クロスラリー", min: 10, refStep: 4 },
      { label: "サーブリターン", min: 7, refStep: 5 },
      { label: "自己紹介・乱数表説明", min: 5, refStep: 7 },
      { label: "ダブルスゲーム", min: 23, refStep: 8 },
      { label: "ミニゲーム・終了あいさつ", min: 5, refStep: 10 },
    ];
  }
  if (durationHours === 1.5) {
    return [
      { label: "開始あいさつ・ショートラリー", min: 10, refStep: 1 },
      { label: "ボレーボレー", min: 5, refStep: 2 },
      { label: "ロングラリー", min: 8, refStep: 3 },
      { label: "クロスラリー", min: 8, refStep: 4 },
      { label: "サーブリターン", min: 8, refStep: 5 },
      { label: "自己紹介・乱数表説明", min: 6, refStep: 7 },
      { label: "ダブルスゲーム", min: 35, refStep: 8 },
      { label: "ミニゲーム・終了あいさつ", min: 10, refStep: 10 },
    ];
  }
  if (durationHours === 2) {
    return [
      { label: "開始あいさつ・ショートラリー", min: 10, refStep: 1 },
      { label: "ボレーボレー", min: 10, refStep: 2 },
      { label: "ロングラリー", min: 10, refStep: 3 },
      { label: "クロスラリー", min: 10, refStep: 4 },
      { label: "サーブリターン", min: 10, refStep: 5 },
      { label: "自己紹介・乱数表説明", min: 10, refStep: 7 },
      { label: "ダブルスゲーム", min: 50, refStep: 8 },
      { label: "ミニゲーム・終了あいさつ", min: 10, refStep: 10 },
    ];
  }
  // 3h
  return [
    { label: "開始あいさつ・ショートラリー", min: 10, refStep: 1 },
    { label: "ボレーボレー", min: 10, refStep: 2 },
    { label: "ロングラリー", min: 10, refStep: 3 },
    { label: "クロスラリー", min: 10, refStep: 4 },
    { label: "サーブリターン", min: 10, refStep: 5 },
    { label: "自己紹介・乱数表説明", min: 10, refStep: 7 },
    { label: "ダブルスゲーム", min: 110, refStep: 8 },
    { label: "ミニゲーム・終了あいさつ", min: 10, refStep: 10 },
  ];
}

/**
 * 条件に応じてセグメントを微調整。
 * - 初心者が多い/初参加者多め → 自己紹介+ルール説明を少し延ばす
 * - 雰囲気=しっかり → ロング/クロス/サーブを少し延ばし、ミニゲームを縮める
 * - 雰囲気=ゆるめ → ミニゲームを延ばし、サーブリターンを少し縮める
 * - 人数が多い+1面 → ゲーム時間を少し延ばす(回転を多くするため)
 */
function adjustSegments(
  segs: Segment[],
  c: FlowConditions
): Segment[] {
  const out = segs.map((s) => ({ ...s }));
  const find = (kw: string) => out.find((s) => s.label.includes(kw));

  const isBeginnerHeavy =
    c.manyBeginners || c.newcomerCount >= Math.max(2, Math.floor(c.participants * 0.25));

  if (isBeginnerHeavy) {
    const intro = find("自己紹介");
    if (intro) intro.min += 3;
    const game = find("ダブルスゲーム");
    if (game) game.min -= 3;
  }

  if (c.vibe === "serious") {
    const cross = find("クロスラリー");
    if (cross) cross.min += 2;
    const serve = find("サーブリターン");
    if (serve) serve.min += 2;
    const mini = find("ミニゲーム");
    if (mini) mini.min = Math.max(5, mini.min - 4);
  } else if (c.vibe === "casual") {
    const mini = find("ミニゲーム");
    if (mini) mini.min += 4;
    const serve = find("サーブリターン");
    if (serve) serve.min = Math.max(5, serve.min - 2);
    const cross = find("クロスラリー");
    if (cross) cross.min = Math.max(5, cross.min - 2);
  }

  // 1面で人数が多めなら、ゲーム時間を少し増やす(待ち時間多くなるため回転確保)
  if (c.courts === 1 && c.participants >= 10) {
    const game = find("ダブルスゲーム");
    if (game) game.min += 5;
    const mini = find("ミニゲーム");
    if (mini) mini.min = Math.max(5, mini.min - 5);
  }

  return out;
}

/** 条件から進行プランを生成 */
export function buildFlowPlan(c: FlowConditions): PlanItem[] {
  const total = Math.round(c.durationHours * 60);
  const adjusted = adjustSegments(baseSegments(c.durationHours), c);

  // 合計を total に合わせる(最後の項目で帳尻)
  const sum = adjusted.reduce((acc, s) => acc + s.min, 0);
  const diff = total - sum;
  if (diff !== 0 && adjusted.length > 0) {
    const last = adjusted[adjusted.length - 1];
    last.min = Math.max(5, last.min + diff);
  }

  let cursor = 0;
  const items: PlanItem[] = [];
  for (const seg of adjusted) {
    items.push({
      startMin: cursor,
      endMin: cursor + seg.min,
      label: seg.label,
      refStep: seg.refStep,
    });
    cursor += seg.min;
  }
  return items;
}

/**
 * プランをLINEに貼り付けやすいテキスト形式に整形
 */
export function planToText(items: PlanItem[]): string {
  return items
    .map(
      (it) =>
        `${formatPlanTime(it.startMin)}〜${formatPlanTime(it.endMin)} ${it.label}`
    )
    .join("\n");
}
