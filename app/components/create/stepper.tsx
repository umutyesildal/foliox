import { cn } from "@/lib/utils";

export interface CreateStep {
  key: string;
  label: string;
  /** Short reason shown while the step is invalid ("Need 2-20 constituents"). */
  hint?: string;
}

/**
 * Six-step wizard stepper: a slim horizontal track of roman-numeral circles
 * (I-VI, mono — roman-empire experiment) joined by thin line segments that
 * fill as steps are reached. Current = filled (primary/yellow) circle with a
 * medium-weight label; done = primary-outlined circle (clickable to jump back,
 * never past validation); upcoming = muted. Labels hide below sm so mobile
 * shows the number track only.
 */

/** Roman numerals for the step circles (indexes 0-5 → I-VI). */
const ROMAN = ["I", "II", "III", "IV", "V", "VI"] as const;
export function Stepper({
  steps,
  current,
  validThrough,
  onSelect,
  className,
}: {
  steps: CreateStep[];
  current: number;
  /** Highest step index whose validation passed (clickable targets). */
  validThrough: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Create wizard steps" className={className}>
      <ol className="flex w-full items-center gap-x-1 sm:gap-x-1.5">
        {steps.map((step, index) => {
          const isCurrent = index === current;
          const isDone = index < current;
          const isClickable = index <= validThrough && !isCurrent;
          const label = (
            <span
              className={cn(
                "hidden min-w-0 truncate text-xs sm:block",
                isCurrent
                  ? "font-medium text-primary-text"
                  : isDone
                    ? "text-muted-foreground group-hover/step:text-primary-text"
                    : "text-muted-foreground/60",
              )}
            >
              {step.label}
            </span>
          );
          return (
            <li key={step.key} className="flex min-w-0 items-center" aria-current={isCurrent ? "step" : undefined}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-3 shrink-0 transition-colors sm:w-5",
                    index <= current ? "bg-primary/50" : "bg-border",
                  )}
                />
              )}
              {isClickable ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  title={step.label}
                  className="group/step flex items-center gap-1.5 rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <StepNumber index={index} state="done" />
                  {label}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 p-1" title={step.label}>
                  <StepNumber
                    index={index}
                    state={isCurrent ? "current" : isDone ? "done" : "upcoming"}
                  />
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepNumber({
  index,
  state,
}: {
  index: number;
  state: "current" | "done" | "upcoming";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] tabular-nums transition-colors",
        state === "current" && "bg-primary text-primary-foreground",
        state === "done" && "border border-primary/60 text-primary-text",
        state === "upcoming" && "border border-border/60 text-muted-foreground/60",
      )}
    >
      {ROMAN[index]}
    </span>
  );
}
