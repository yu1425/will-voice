import type { PlanItem } from "./flowPlan";
import { FLOW_RECORDINGS } from "./tennisFlowScripts";

/** 標準2時間進行は、条件によって時刻境界を動かさない固定メニュー。 */
export const STANDARD_TWO_HOUR_DURATION_SEC = 2 * 60 * 60;

export type AutoFlowEvent = {
  id: string;
  offsetSec: number;
  phaseId: string;
  title: string;
  speakText: string;
  /** 録音音声モードで意味が矛盾しない既存録音だけを紐付ける。 */
  audioSrc?: string;
  refStep?: number;
};

const minutes = (value: number) => value * 60;

/**
 * 自動進行は個別進行の録音順をそのまま基準にする。
 * 例外は STEP 2 のショートラリー / ボレーボレーだけを5分ずつに分けることと、
 * サーブ・レシーブの5分交代キューだけ。
 */
export function buildStandardTwoHourEvents(): AutoFlowEvent[] {
  return [
    {
      id: "opening",
      offsetSec: 0,
      phaseId: "opening",
      title: "開始あいさつ",
      speakText: FLOW_RECORDINGS.opening.recordedText,
      audioSrc: FLOW_RECORDINGS.opening.audioSrc,
      refStep: 1,
    },
    {
      id: "short-rally",
      offsetSec: minutes(5),
      phaseId: "short-rally",
      title: "ショートラリー",
      speakText: FLOW_RECORDINGS.shortVolley.recordedText,
      audioSrc: FLOW_RECORDINGS.shortVolley.audioSrc,
      refStep: 2,
    },
    {
      id: "volley-volley",
      offsetSec: minutes(10),
      phaseId: "volley-volley",
      title: "ボレーボレー",
      speakText:
        "5分経ちました。ショートラリーはここまでです。続いてボレーボレーに移ります。肩の力を抜いて、ゆっくり続けていきましょう。",
      refStep: 2,
    },
    {
      id: "long-rally",
      offsetSec: minutes(15),
      phaseId: "long-rally",
      title: "ロングラリー",
      speakText: FLOW_RECORDINGS.longRally.recordedText,
      audioSrc: FLOW_RECORDINGS.longRally.audioSrc,
      refStep: 3,
    },
    {
      id: "cross-rally",
      offsetSec: minutes(25),
      phaseId: "cross-rally",
      title: "クロスラリー",
      speakText: FLOW_RECORDINGS.crossRally.recordedText,
      audioSrc: FLOW_RECORDINGS.crossRally.audioSrc,
      refStep: 4,
    },
    {
      id: "serve-return",
      offsetSec: minutes(35),
      phaseId: "serve-return",
      title: "サーブ・リターン",
      speakText: FLOW_RECORDINGS.serveReturn.recordedText,
      audioSrc: FLOW_RECORDINGS.serveReturn.audioSrc,
      refStep: 5,
    },
    {
      id: "serve-return-switch",
      offsetSec: minutes(40),
      phaseId: "serve-return-switch",
      title: "サーブ・リターン交代",
      speakText:
        "5分経ちました。サーブ側とリターン側を交代してください。",
      refStep: 5,
    },
    {
      id: "self-intro",
      offsetSec: minutes(45),
      phaseId: "self-intro",
      title: "ゲーム前の自己紹介",
      speakText: FLOW_RECORDINGS.selfIntro.recordedText,
      audioSrc: FLOW_RECORDINGS.selfIntro.audioSrc,
      refStep: 6,
    },
    {
      id: "random-table",
      offsetSec: minutes(50),
      phaseId: "random-table",
      title: "乱数表の案内",
      speakText: FLOW_RECORDINGS.randomTable.recordedText,
      audioSrc: FLOW_RECORDINGS.randomTable.audioSrc,
      refStep: 7,
    },
    {
      id: "game",
      offsetSec: minutes(55),
      phaseId: "game",
      title: "ゲーム形式（ダブルス）",
      speakText: FLOW_RECORDINGS.game.recordedText,
      audioSrc: FLOW_RECORDINGS.game.audioSrc,
      refStep: 8,
    },
    {
      id: "mini-game",
      offsetSec: minutes(105),
      phaseId: "mini-game",
      title: "ミニゲーム（リレーラリー）",
      speakText: FLOW_RECORDINGS.miniGame.recordedText,
      audioSrc: FLOW_RECORDINGS.miniGame.audioSrc,
      refStep: 9,
    },
    {
      id: "closing",
      offsetSec: STANDARD_TWO_HOUR_DURATION_SEC,
      phaseId: "closing",
      title: "終了あいさつ",
      speakText: FLOW_RECORDINGS.closing.recordedText,
      audioSrc: FLOW_RECORDINGS.closing.audioSrc,
      refStep: 10,
    },
  ];
}

/** 指定時点で表示すべきイベント。開始前は先頭、終了後は終了案内を返す。 */
export function eventAtElapsed(
  events: AutoFlowEvent[],
  elapsedSec: number
): AutoFlowEvent {
  return (
    [...events].reverse().find((event) => event.offsetSec <= elapsedSec) ?? events[0]
  );
}

/** 次の境界イベントを返す。終了案内の次は null。 */
export function nextEventAtElapsed(
  events: AutoFlowEvent[],
  elapsedSec: number
): AutoFlowEvent | null {
  return events.find((event) => event.offsetSec > elapsedSec) ?? null;
}

/** 準備画面およびコピー用の、個別進行順に合わせた標準2時間メニュー。 */
export function buildStandardTwoHourPlan(): PlanItem[] {
  return [
    { startMin: 0, endMin: 5, label: "開始あいさつ・準備", refStep: 1 },
    { startMin: 5, endMin: 10, label: "ショートラリー", refStep: 2 },
    { startMin: 10, endMin: 15, label: "ボレーボレー", refStep: 2 },
    { startMin: 15, endMin: 25, label: "ロングラリー", refStep: 3 },
    { startMin: 25, endMin: 35, label: "クロスラリー", refStep: 4 },
    { startMin: 35, endMin: 45, label: "サーブ・リターン", refStep: 5 },
    { startMin: 45, endMin: 50, label: "ゲーム前の自己紹介", refStep: 6 },
    { startMin: 50, endMin: 55, label: "乱数表の案内", refStep: 7 },
    { startMin: 55, endMin: 105, label: "ゲーム形式（ダブルス）", refStep: 8 },
    { startMin: 105, endMin: 120, label: "ミニゲーム（リレーラリー）", refStep: 9 },
  ];
}

/** Date.now() ベースで実時間の経過秒数を計算する純粋関数。 */
export function getAutoFlowElapsedSec(
  startedAt: number,
  accumulatedPausedMs: number,
  now: number,
  pausedAt?: number | null
): number {
  const end = pausedAt ?? now;
  return Math.max(0, Math.floor((end - startedAt - accumulatedPausedMs) / 1000));
}
