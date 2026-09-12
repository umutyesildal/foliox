"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Small copy affordance for addresses/mints. Pure token styling; announces the
 * copy via a temporary "copied" mono label (no toast chrome).
 */
export function CopyButton({
  value,
  label = "Copy to clipboard",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(() => {
    const done = () => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(done);
    } else {
      done();
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={`${label}: ${value}`}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-lg border border-border bg-background px-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
