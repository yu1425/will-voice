import type { PlanItem } from "./flowPlan";
import { getFlowScripts } from "./flowScripts";

export const STANDARD_TWO_HOUR_DURATION_SEC = 7200;
export type AutoFlowEvent = {
  id: string;
  offsetSec: number;
  phaseId: string;
  title: string;
  displayText: string;
  voiceText: string;
  audioSrc?: string;
  refStep?: number;
  /** 自動進行だけで流す補助案内。12項目のメニューには表示しない。 */
  autoOnly?: boolean;
};

export function buildStandardTwoHourEvents(courts: 1 | 2 = 1): AutoFlowEvent[] {
  return [
    ...getFlowScripts(courts),
    {
      id: "completed",
      offsetSec: 7200,
      phaseId: "completed",
      title: "進行完了",
      displayText: "2時間の進行が完了しました。お疲れさまでした。",
      voiceText: "",
    },
  ];
}
export function eventAtElapsed(
  events: AutoFlowEvent[],
  elapsedSec: number,
): AutoFlowEvent {
  return (
    [...events].reverse().find((event) => event.offsetSec <= elapsedSec) ??
    events[0]
  );
}
export function nextEventAtElapsed(
  events: AutoFlowEvent[],
  elapsedSec: number,
): AutoFlowEvent | null {
  return events.find((event) => event.offsetSec > elapsedSec) ?? null;
}
export function buildStandardTwoHourPlan(): PlanItem[] {
  const events = buildStandardTwoHourEvents();
  return events.slice(0, -1).map((event, index) => ({
    startMin: event.offsetSec / 60,
    endMin: events[index + 1].offsetSec / 60,
    label: event.title,
    refStep: event.refStep,
  }));
}
export function getAutoFlowElapsedSec(
  startedAt: number,
  accumulatedPausedMs: number,
  now: number,
  pausedAt?: number | null,
): number {
  return Math.max(
    0,
    Math.floor(((pausedAt ?? now) - startedAt - accumulatedPausedMs) / 1000),
  );
}
export function getAutoFlowProgress(elapsed: number) {
  const elapsedSec = Math.max(0, Math.min(7200, elapsed));
  return {
    elapsedSec,
    remainingSec: 7200 - elapsedSec,
    percentage: Math.round((elapsedSec / 7200) * 100),
  };
}
