/** Current cue lifecycle only. None of these states grant or revoke future events. */
export type FlowCueState =
  "waiting" | "playing" | "stopped-manually" | "paused-by-flow" | "ended";
export type FlowCueAction =
  | "play"
  | "stop-current"
  | "pause-flow"
  | "resume-flow"
  | "settled"
  | "settled-paused"
  | "wait"
  | "end";
export function flowCueState(
  state: FlowCueState,
  action: FlowCueAction,
): FlowCueState {
  switch (action) {
    case "play":
      return "playing";
    case "stop-current":
      return "stopped-manually";
    case "pause-flow":
      return "paused-by-flow";
    case "resume-flow":
      return state === "playing" ? "playing" : "waiting";
    case "settled":
      return state === "playing" ? "waiting" : state;
    case "settled-paused":
      return state === "playing" ? "paused-by-flow" : state;
    case "wait":
      return "waiting";
    case "end":
      return "ended";
  }
}
