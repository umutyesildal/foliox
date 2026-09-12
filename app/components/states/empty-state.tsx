import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Empty state: solid 1px border on bg-card (never dashed), a small mono state
 * chip (EMPTY / NOT INDEXED / NO WALLET …), one-sentence copy, and a real
 * action. Pass a real control (link or button with a handler) — dead buttons
 * are not allowed. Omit `action` when there is genuinely nothing to do.
 *
 * `preview` renders a labeled skeleton of the populated layout below the copy,
 * so an empty page still shows its shape instead of a 400px void.
 */
export function EmptyState({
  chip = "EMPTY",
  title,
  description,
  action,
  preview,
  previewLabel,
  className,
}: {
  chip?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Skeleton preview of the populated layout (aria-hidden decorative bars). */
  preview?: ReactNode;
  /** Visible mono caption for the preview, e.g. "layout preview — basket table". */
  previewLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-card p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-lg border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {chip}
        </span>
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      {description ? (
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex">{action}</div> : null}
      {preview ? (
        <div className="mt-5 border-t border-border/60 pt-4">
          {previewLabel ? (
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {previewLabel}
            </p>
          ) : null}
          <div aria-hidden="true" className="mt-3">
            {preview}
          </div>
        </div>
      ) : null}
    </div>
  );
}
