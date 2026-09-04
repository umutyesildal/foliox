import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Retryable error state. `onRetry` is optional so genuinely unrecoverable
 * errors can render without a dead button. Destructive accent is semantic
 * (status only) per brand.md.
 */
export function ErrorState({
  title = "Request failed",
  message,
  onRetry,
  retryLabel = "Retry",
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {message ? (
          <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
