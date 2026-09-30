import type { IntroTiming, PlanItem } from "./flowPlan";
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
 * 自己紹介のタイミングだけを差し替えた自動進行イベントを返す。
 * 旧録音を無理に短い切替キューへ流用せず、フェーズとして意味が一致するものだけ使う。
 */
export function buildStandardTwoHourEvents(
  introTiming: IntroTiming
): AutoFlowEvent[] {
  const startsWithIntro = introTiming === "start";
  return [
    {
      id: "opening",
      offsetSec: 0,
      phaseId: "warm-up",
      title: startsWithIntro ? "ウォームアップ・自己紹介" : "ウォームアップ",
      speakText: startsWithIntro
        ? "本日はご参加ありがとうございます。まずは軽く体を温めながら、近くのかたとお名前だけ自己紹介をお願いします。"
        : "本日はご参加ありがとうございます。まずは軽く体を温めていきましょう。全体の自己紹介はサーブ練習のあとに行います。",
      refStep: 1,
    },
    {
      id: "short-rally",
      offsetSec: minutes(5),
      phaseId: "short-rally",
      title: "ショートラリー",
      speakText:
        "それではショートラリーに移ります。ペアで5分ほど、相手が返しやすいボールをつないでください。",
      audioSrc: FLOW_RECORDINGS.shortVolley.audioSrc,
      refStep: 2,
    },
    {
      id: "volley-volley",
      offsetSec: minutes(10),
      phaseId: "volley-volley",
      title: "ボレーボレー",
      speakText:
        "5分経ちました。続いてボレーボレーに切り替えます。肩の力を抜いて、ゆっくり続けてください。",
      refStep: 2,
    },
    {
      id: "long-rally",
      offsetSec: minutes(15),
      phaseId: "long-rally",
      title: "ロングラリー",
      speakText:
        "続いてロングラリーです。ある程度打ったら交代しながら、なるべく同じ相手が続かないように進めてください。",
      audioSrc: FLOW_RECORDINGS.longRally.audioSrc,
      refStep: 3,
    },
    {
      id: "cross-rally",
      offsetSec: minutes(25),
      phaseId: "cross-rally",
      title: "クロスラリー",
      speakText:
        "続いてクロスラリーです。なるべく同じ相手が続かないように、軽くメンバーを入れ替えてください。",
      audioSrc: FLOW_RECORDINGS.crossRally.audioSrc,
      refStep: 4,
    },
    {
      id: "serve-return",
      offsetSec: minutes(35),
      phaseId: "serve-return",
      title: "サーブ・レシーブ",
      speakText:
        "続いてサーブ・レシーブです。片側がサーブ、反対側がレシーブで始めてください。5分後に交代します。",
      audioSrc: FLOW_RECORDINGS.serveReturnDetail.audioSrc,
      refStep: 5,
    },
    {
      id: "serve-return-switch",
      offsetSec: minutes(40),
      phaseId: "serve-return-switch",
      title: "サーブ・レシーブ交代",
      speakText:
        "5分経ちました。サーブ側とレシーブ側を交代してください。",
      refStep: 5,
    },
    ...(startsWithIntro
      ? [
          {
            id: "game",
            offsetSec: minutes(45),
            phaseId: "game",
            title: "ゲーム形式（ダブルス）",
            speakText:
              "ここからゲーム形式です。ダブルスで4ポイント先取、デュースなし、1ゲームごとに交代でお願いします。サーブは最大3回までで大丈夫です。",
            audioSrc: FLOW_RECORDINGS.game.audioSrc,
            refStep: 8,
          },
        ]
      : [
          {
            id: "self-intro",
            offsetSec: minutes(45),
            phaseId: "self-intro",
            title: "自己紹介",
            speakText:
              "ここで軽く自己紹介をお願いします。お名前、テニス歴、初参加かどうかくらいで大丈夫です。",
            audioSrc: FLOW_RECORDINGS.selfIntro.audioSrc,
            refStep: 6,
          },
          {
            id: "game",
            offsetSec: minutes(50),
            phaseId: "game",
            title: "ゲーム形式（ダブルス）",
            speakText:
              "ここからゲーム形式です。ダブルスで4ポイント先取、デュースなし、1ゲームごとに交代でお願いします。サーブは最大3回までで大丈夫です。",
            audioSrc: FLOW_RECORDINGS.game.audioSrc,
            refStep: 8,
          },
        ]),
    {
      id: "mini-game",
      offsetSec: minutes(105),
      phaseId: "mini-game",
      title: "ミニゲーム・ブレイク",
      speakText:
        "ゲームはここまでです。最後はミニゲームに移ります。リレーラリーを基本に、軽く楽しみながら締めましょう。",
      audioSrc: FLOW_RECORDINGS.miniGame.audioSrc,
      refStep: 9,
    },
    {
      id: "closing",
      offsetSec: STANDARD_TWO_HOUR_DURATION_SEC,
      phaseId: "closing",
      title: "終了",
      speakText:
        "本日の進行は終了です。ご参加ありがとうございました。忘れ物に気をつけてお帰りください。",
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

/** 準備画面およびコピー用の、条件非依存な標準2時間メニュー。 */
export function buildStandardTwoHourPlan(introTiming: IntroTiming): PlanItem[] {
  const introAtStart = introTiming === "start";
  return [
    {
      startMin: 0,
      endMin: 5,
      label: introAtStart ? "ウォームアップ・自己紹介" : "ウォームアップ",
      refStep: 1,
    },
    { startMin: 5, endMin: 15, label: "ショートラリー・ボレー", refStep: 2 },
    { startMin: 15, endMin: 25, label: "ロングラリー", refStep: 3 },
    { startMin: 25, endMin: 35, label: "クロスラリー", refStep: 4 },
    { startMin: 35, endMin: 45, label: "サーブ・レシーブ", refStep: 5 },
    ...(introAtStart
      ? [{ startMin: 45, endMin: 105, label: "ゲーム形式（ダブルス）", refStep: 8 }]
      : [
          { startMin: 45, endMin: 50, label: "自己紹介", refStep: 6 },
          { startMin: 50, endMin: 105, label: "ゲーム形式（ダブルス）", refStep: 8 },
        ]),
    { startMin: 105, endMin: 120, label: "ミニゲーム・ブレイク", refStep: 9 },
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
