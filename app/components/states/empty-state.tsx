import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Empty state with an optional action slot. Pass a real control (link or
 * button with a handler) — dead buttons are not allowed. Omit `action` when
 * there is genuinely nothing to do.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-dashed border-border p-6",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2 flex">{action}</div> : null}
    </div>
  );
}
