import type { AutoFlowEvent } from "@/lib/standardTwoHourFlow";

export default function PreGameFlowPanel({
  events,
  elapsed,
}: {
  events: AutoFlowEvent[];
  elapsed: number;
}) {
  const start = events.find((event) => event.id === "gather-break");
  const end = events.find((event) => event.id === "game-play");
  if (!start || !end || elapsed < start.offsetSec || elapsed >= end.offsetSec)
    return null;
  const steps = events.filter(
    (event) =>
      event.offsetSec >= start.offsetSec && event.offsetSec <= end.offsetSec,
  );
  const currentIndex = steps.reduce(
    (last, event, index) => (event.offsetSec <= elapsed ? index : last),
    0,
  );
  return (
    <section className="flow-pregame" aria-label="ゲーム前進行">
      <h2>ゲーム前進行</h2>
      <ol>
        {steps.map((event, index) => (
          <li
            key={event.id}
            aria-current={index === currentIndex ? "step" : undefined}
            className={
              index === currentIndex
                ? "is-current"
                : index < currentIndex
                  ? "is-complete"
                  : ""
            }
          >
            <span aria-hidden="true">
              {index < currentIndex ? "✓" : index === currentIndex ? "●" : "○"}
            </span>
            <time>
              {String(Math.floor(event.offsetSec / 60)).padStart(2, "0")}:
              {String(event.offsetSec % 60).padStart(2, "0")}
            </time>
            <span>
              {event.id === "game-play"
                ? "主催者が口頭でゲーム開始"
                : event.title}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
