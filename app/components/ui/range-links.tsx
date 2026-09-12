import Link from "next/link";
import type { ReactNode } from "react";

/**
 * RangeLinks — the one text range switcher rendered above charts (market
 * overview, stock detail, basket NAV history). Minimal type-driven style:
 * active = medium yellow (text-primary-text) with a yellow underline — the active
 * state is the one chrome element allowed to read yellow here, matching the
 * NEON FOUNDRY active-nav rule; inactive = muted, foreground on hover.
 *
 * Two modes — pass exactly one:
 *   hrefFor   link mode for server pages (the URL is the state) → <Link>s.
 *   onChange  button mode for client pages (component state) → <button>s.
 */

type RangeOption<T extends string> = {
  value: T;
  label?: string;
};

export function RangeLinks<T extends string>({
  options,
  value,
  hrefFor,
  onChange,
  label = "Range",
  ariaLabel = "Chart range",
  children,
  className = "flex flex-wrap items-center gap-3",
}: {
  /** Range keys — plain strings or { value, label } pairs. */
  options: readonly (T | RangeOption<T>)[];
  /** Currently selected range key. */
  value: T;
  /** Link mode: builds the href for a range (server components). */
  hrefFor?: (value: T) => string;
  /** Button mode: called with the newly selected range (client components). */
  onChange?: (value: T) => void;
  /** Leading caption inside the nav; pass null to omit. Defaults to "Range". */
  label?: string | null;
  /** aria-label of the wrapping <nav>. */
  ariaLabel?: string;
  /** Extra content appended inside the nav row (e.g. an adjacent Button). */
  children?: ReactNode;
  className?: string;
}) {
  if (hrefFor === undefined && onChange === undefined) {
    throw new Error(
      "RangeLinks: pass either hrefFor (link mode) or onChange (button mode)",
    );
  }

  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option } : option,
  ) as RangeOption<T>[];

  return (
    <nav aria-label={ariaLabel} className={className}>
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      {normalized.map((option) => {
        const active = option.value === value;
        const cls = `text-xs transition-colors ${
          active
            ? "font-medium text-primary-text underline decoration-primary-text/60 underline-offset-4"
            : "text-muted-foreground hover:text-foreground"
        }`;
        return hrefFor ? (
          <Link
            key={option.value}
            href={hrefFor(option.value)}
            aria-current={active ? "true" : undefined}
            className={cls}
          >
            {option.label ?? option.value}
          </Link>
        ) : (
          <button
            key={option.value}
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => onChange?.(option.value)}
            className={cls}
          >
            {option.label ?? option.value}
          </button>
        );
      })}
      {children}
    </nav>
  );
}
