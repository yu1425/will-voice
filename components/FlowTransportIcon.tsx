type Props = { kind: "play" | "pause" | "stop" | "replay" };
/** Small monochrome transport symbols; text labels carry their accessible meaning. */
export default function FlowTransportIcon({ kind }: Props) {
  return (
    <svg
      className="flow-transport-icon"
      width="16"
      height="16"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "play" ? (
        <path fill="currentColor" d="M6 3.5 16 10 6 16.5Z" />
      ) : kind === "pause" ? (
        <>
          <rect fill="currentColor" x="4" y="3" width="4" height="14" rx="1" />
          <rect fill="currentColor" x="12" y="3" width="4" height="14" rx="1" />
        </>
      ) : kind === "stop" ? (
        <rect fill="currentColor" x="4" y="4" width="12" height="12" rx="1" />
      ) : (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 7a6.5 6.5 0 1 1-.2 5" />
          <path d="M4 3v4h4" />
        </g>
      )}
    </svg>
  );
}
