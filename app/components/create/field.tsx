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
 * Labeled single-value range slider. Native range pseudo-elements (track /
 * thumb) render inconsistently across engines and zoom levels here, so the
 * visuals are plain divs — a 4px muted track with a primary-filled portion and
 * an absolutely-positioned 14px primary thumb — while the real
 * <input type="range"> is overlaid at opacity-0 to keep native keyboard
 * support and drag semantics. `children` fills the value slot on the label row
 * (mono readout or editable number input).
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
  const span = max - min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex h-4 items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-medium text-foreground">
          {label}
        </label>
        {children}
      </div>
      <div className="relative h-5 w-full">
        {/* Track */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted"
        />
        {/* Filled portion up to the thumb */}
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        {/* Thumb (after the input in DOM so `peer` focus ring applies) */}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={String(value)}
          onChange={(event) => onChange(Number(event.target.value))}
          className="peer absolute inset-0 h-full w-full cursor-pointer touch-none appearance-none border-0 bg-transparent p-0 opacity-0 focus-visible:outline-none"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-primary transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
