"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Local labeled text field for the Create wizard (the shared ui/ set has no
 * Input primitive). Brand tokens only; Geist Mono is applied by the caller via
 * `mono` for numeric fields.
 */
export function TextField({
  label,
  hint,
  hideLabel = false,
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
  mono = false,
  className,
  invalid = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Visually hide the label while keeping it for screen readers. */
  hideLabel?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "text" | "decimal" | "numeric";
  mono?: boolean;
  className?: string;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className={cn("text-xs font-medium text-muted-foreground", hideLabel && "sr-only")}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive/60",
          mono && "font-mono tabular-nums",
        )}
      />
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Labeled single-value range slider on a native <input type="range"> — the
 * base-ui Slider renders without a visible track/thumb in this app, so the
 * wizard uses this plain control instead: slim 2px monochrome track, 12px
 * solid thumb, ~32px compact row, keyboard operable. `children` fills the
 * value slot on the label row (mono readout or editable number input).
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  children,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex h-4 items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-medium text-foreground">
          {label}
        </label>
        {children}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(
          "h-3 w-full cursor-pointer appearance-none bg-transparent",
          // WebKit: 2px track, 12px thumb centered on it via -5px offset.
          "[&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted",
          "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:-mt-[5px]",
          // Firefox: same geometry (thumb auto-centers on the track).
          "[&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted",
          "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground",
          // Focus remains visible on the thumb in both engines.
          "[&:focus-visible::-webkit-slider-thumb]:ring-2 [&:focus-visible::-webkit-slider-thumb]:ring-ring/50",
          "[&:focus-visible::-moz-range-thumb]:ring-2 [&:focus-visible::-moz-range-thumb]:ring-ring/50",
        )}
      />
    </div>
  );
}
