import { Radio, RotateCcw } from "lucide-react";
import { CLOCK_JUMPS, type SimulationClock } from "@/lib/clock";
import { advanceClock, resumeLiveClock } from "@/app/actions/session";

/**
 * The simulated present, and the controls to move it.
 *
 * This is deliberately always on screen. Every figure in the application is
 * cut against this instant, and a demo where the audience cannot see what
 * "now" means invites the reasonable suspicion that the numbers were chosen
 * rather than computed.
 */
export function ClockBar({ clock }: { clock: SimulationClock }) {
  const stamp = clock.now.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });

  // The weekday and the year are the two parts nobody reads, and on a phone
  // they are the difference between the date sitting on one line and the whole
  // bar reflowing.
  const shortStamp = clock.now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={
            clock.pinned
              ? "relative flex h-1.5 w-1.5 rounded-full bg-amber-500"
              : "relative flex h-1.5 w-1.5 rounded-full bg-emerald-500"
          }
        >
          {clock.pinned ? null : (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          )}
        </span>
        <span className="tnum text-[12.5px] font-medium text-ink-800">
          <span className="sm:hidden">{shortStamp} UTC</span>
          <span className="hidden sm:inline">{stamp} UTC</span>
        </span>
        <span className="text-[12px] text-ink-500">
          {clock.pinned ? (
            "clock pinned"
          ) : (
            <span className="inline-flex items-center gap-1">
              <Radio className="h-3 w-3" />
              day {clock.dayOfPlanYear} of the plan year
            </span>
          )}
        </span>
      </div>

      {/* Pushed right when there is room. On a phone there is not, and an
          `ml-auto` there only fights the wrap it is sitting on. */}
      <div className="flex items-center gap-1.5 sm:ml-auto">
        {CLOCK_JUMPS.map((jump) => (
          <form key={jump.days} action={advanceClock}>
            <input type="hidden" name="days" value={jump.days} />
            <button
              type="submit"
              className="rounded-md border border-ink-200/80 bg-white px-2 py-2 text-[11.5px] font-medium text-ink-700 transition hover:border-glass-400/60 hover:text-glass-800 sm:py-1"
            >
              {jump.label}
            </button>
          </form>
        ))}
        {clock.pinned ? (
          <form action={resumeLiveClock}>
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-md border border-glass-300 bg-glass-50 px-2 py-2 text-[11.5px] font-medium text-glass-800 transition hover:bg-glass-100 sm:py-1"
            >
              <RotateCcw className="h-3 w-3" />
              Back to live
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
