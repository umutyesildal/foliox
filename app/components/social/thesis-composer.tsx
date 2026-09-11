"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/format";
import { createThesis, SocialApiError, type FullPost } from "@/lib/social-api";
import { useSocialAuth } from "@/lib/social-auth";
import { ProfileEditorModal } from "@/components/social/profile-editor";

const TITLE_MAX = 120;
const BODY_MAX = 2000;

/**
 * Thesis composer modal: title + body, attached to the basket page it was
 * opened from (optional — theses can be standalone). Submits POST /posts with
 * a wallet-signed token.
 *
 * 404 PROFILE_REQUIRED (no social profile yet) swaps the form for a
 * "Claim a handle first" panel that opens the profile editor inline; saving a
 * profile returns to the draft with the text preserved.
 */
export function ThesisComposerModal({
  open,
  onClose,
  basket,
  basketLabel,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  /** Basket pubkey attached to the thesis (optional). */
  basket?: string | null;
  /** Display name for the basket chip. */
  basketLabel?: string | null;
  /** Called after a successful post (before close). */
  onPosted?: (post: FullPost) => void;
}) {
  const social = useSocialAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileClaimed, setProfileClaimed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit =
    title.trim().length > 0 && body.trim().length > 0 && !submitting && !needsProfile;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await social.ensureAuth();
      const { post } = await createThesis(token, {
        title: title.trim(),
        body: body.trim(),
        ...(basket ? { basket } : {}),
      });
      onPosted?.(post);
      setTitle("");
      setBody("");
      onClose();
    } catch (err) {
      if (err instanceof SocialApiError && (err.code === "PROFILE_REQUIRED" || err.status === 404)) {
        setNeedsProfile(true);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Publishing the thesis failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-4 backdrop-blur-[2px] sm:items-center"
        role="presentation"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Write a thesis"
          tabIndex={-1}
          className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Write a thesis</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Published to the public feed under your handle.
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              ×
            </Button>
          </div>

          {needsProfile ? (
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium">Claim a handle first</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Theses are signed with a public handle. Your draft stays in this window — claim a
                handle, then publish.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setProfileEditorOpen(true)}>
                  Claim a handle
                </Button>
                <Button size="sm" variant="outline" onClick={onClose}>
                  Discard draft
                </Button>
              </div>
              {profileClaimed ? (
                <p role="status" className="mt-3 text-xs text-muted-foreground">
                  Handle claimed — you can publish now.
                </p>
              ) : null}
            </div>
          ) : (
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) void submit();
              }}
            >
              {basket ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Basket
                  </span>
                  <span
                    className="truncate font-mono text-xs text-foreground"
                    title={basket}
                  >
                    {basketLabel ?? truncateAddress(basket, 6, 4)}
                  </span>
                </div>
              ) : null}

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Title
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={TITLE_MAX}
                  placeholder="Why this basket, in one line"
                  className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Thesis
                </span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={BODY_MAX}
                  rows={6}
                  placeholder="The assets, the weights, and the reasoning — not advice."
                  className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <span className="mt-1 block text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                  {body.length}/{BODY_MAX}
                </span>
              </label>

              {error ? <p role="alert" className="text-sm text-foreground">{error}</p> : null}

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {submitting ? "Publishing…" : "Publish thesis"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      <ProfileEditorModal
        open={profileEditorOpen}
        onClose={() => setProfileEditorOpen(false)}
        title="Claim a handle"
        submitLabel="Claim handle"
        onSaved={() => {
          setProfileClaimed(true);
          setNeedsProfile(false);
        }}
      />
    </>
  );
}
