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
  label: string;
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
