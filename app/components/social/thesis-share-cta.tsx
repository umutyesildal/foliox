"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ThesisComposerModal } from "@/components/social/thesis-composer";

/**
 * Dismissible post-trade CTA rendered inside the transaction success state:
 * "Share your thesis" opens the composer with the traded basket attached.
 * Dismisses for the lifetime of the success card; hides itself after posting.
 */
export function ThesisShareCta({
  basket,
  basketName,
}: {
  basket: string;
  basketName?: string | null;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [posted, setPosted] = useState(false);

  if (dismissed || posted) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
      <p className="text-xs text-muted-foreground">
        Made the trade? Tell the feed why.
      </p>
      <div className="flex items-center gap-1.5">
        {/* Default (yellow) on purpose: this is the single CTA of the
            post-trade success moment (NEON FOUNDRY review, 2026-09-12). */}
        <Button size="sm" onClick={() => setOpen(true)}>
          Share your thesis
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => setDismissed(true)}
        >
          ×
        </Button>
      </div>
      <ThesisComposerModal
        open={open}
        onClose={() => setOpen(false)}
        basket={basket}
        basketLabel={basketName ?? undefined}
        onPosted={() => setPosted(true)}
      />
    </div>
  );
}
