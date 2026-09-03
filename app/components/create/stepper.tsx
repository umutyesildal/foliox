import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CreateStep {
  key: string;
  label: string;
  /** Short reason shown while the step is invalid ("Need 2-20 constituents"). */
  hint?: ReactNode;
}

/**
 * Six-step wizard stepper. Completed steps are buttons (jump back); the
 * current step is aria-current; future steps are inert labels — the wizard
 * never lets a click skip a validation gate.
 */
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
    <ol
      className={cn("flex flex-wrap items-start gap-x-1 gap-y-2", className)}
      aria-label="Create wizard steps"
    >
      {steps.map((step, index) => {
        const isCurrent = index === current;
        const isDone = index < current;
        const canJump = index <= validThrough && !isCurrent;
        return (
          <li key={step.key} className="flex min-w-0 items-start gap-1">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "mt-2.5 h-px w-3 shrink-0 transition-colors",
                  index <= current ? "bg-foreground/70" : "bg-border",
                )}
              />
            )}
            {canJump ? (
              <button
                type="button"
                onClick={() => onSelect(index)}
                className="rounded-sm px-1.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <StepChip index={index} label={step.label} state="done" />
              </button>
            ) : (
              <span className="px-1.5 py-1" aria-current={isCurrent ? "step" : undefined}>
                <StepChip
                  index={index}
                  label={step.label}
                  state={isCurrent ? "current" : isDone ? "done" : "upcoming"}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepChip({
  index,
  label,
  state,
}: {
  index: number;
  label: string;
  state: "current" | "done" | "upcoming";
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs",
        state === "current" && "text-foreground",
        state === "done" && "text-muted-foreground hover:text-foreground",
        state === "upcoming" && "text-muted-foreground/70",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 items-center justify-center rounded-full border font-mono text-[10px] tabular-nums",
          state === "current" && "border-primary bg-primary/10 text-primary",
          state === "done" && "border-border text-muted-foreground",
          state === "upcoming" && "border-border/60 text-muted-foreground/70",
        )}
      >
        {state === "done" ? "✓" : index + 1}
      </span>
      <span className={cn(state === "current" && "font-medium")}>{label}</span>
    </span>
  );
}
