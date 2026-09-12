"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  fetchMeProfile,
  putMeProfile,
  SocialApiError,
  type ProfilePatch,
  type SocialProfile,
} from "@/lib/social-api";
import { useSocialAuth } from "@/lib/social-auth";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Edit-profile modal: handle / display name / avatar URL / bio / visibility,
 * saved with PUT /me/profile (absent field = unchanged; explicit null clears —
 * empty inputs are sent as null here so clearing works). HANDLE_TAKEN renders
 * inline; wallet sign-in is requested transparently on save via useSocialAuth.
 *
 * Shared by the profile page ("Edit profile") and the thesis composer's
 * PROFILE_REQUIRED recovery ("Claim a handle first").
 */
export function ProfileEditorModal({
  open,
  onClose,
  onSaved,
  title = "Edit profile",
  submitLabel = "Save profile",
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the saved profile after a successful PUT. */
  onSaved?: (profile: SocialProfile) => void;
  title?: string;
  submitLabel?: string;
}) {
  const social = useSocialAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [handleTaken, setHandleTaken] = useState(false);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [hadProfile, setHadProfile] = useState(false);

  // Load the caller's own profile (private fields included) when opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const token = await social.ensureAuth();
        const payload = await fetchMeProfile(token);
        if (cancelled) return;
        const p = payload.profile;
        setHadProfile(p !== null);
        setHandle(p?.handle ?? "");
        setDisplayName(p?.displayName ?? "");
        setAvatarUrl(p?.avatarUrl ?? "");
        setBio(p?.bio ?? "");
        setIsPublic(p?.isPublic ?? true);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Could not load your profile.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- social.ensureAuth is stable enough for open-toggled loads
  }, [open]);

  // Escape closes; basic focus handoff like TxReviewModal.
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

  const handleValid = HANDLE_RE.test(handle);
  const canSave = handleValid && !saving && !loading;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setHandleTaken(false);
    try {
      const token = await social.ensureAuth();
      const patch: ProfilePatch = {
        handle: handle.trim() || null,
        displayName: displayName.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
        bio: bio.trim() || null,
        isPublic,
      };
      const { profile } = await putMeProfile(token, patch);
      onSaved?.(profile);
      onClose();
    } catch (err) {
      if (err instanceof SocialApiError && err.code === "HANDLE_TAKEN") {
        setHandleTaken(true);
      } else if (err instanceof Error) {
        setSaveError(err.message);
      } else {
        setSaveError("Saving the profile failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-4 backdrop-blur-[2px] sm:items-center"
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-5 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {hadProfile
                ? "Shown on the feed, leaderboard and your profile page."
                : "Claim a handle to post theses, follow traders and appear on the leaderboard."}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            ×
          </Button>
        </div>

        {loading ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading your profile…
          </p>
        ) : loadError ? (
          <div role="alert" className="mt-4 space-y-2">
            <p className="text-sm text-foreground">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => onClose()}>
              Close
            </Button>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) void save();
            }}
          >
            <Field label="Handle" hint="3–20 characters: a-z, 0-9, underscore.">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="font-mono text-sm text-muted-foreground">
                  @
                </span>
                <input
                  value={handle}
                  onChange={(event) => {
                    setHandle(event.target.value.toLowerCase());
                    setHandleTaken(false);
                  }}
                  placeholder="roman_index"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={handle.length > 0 && !handleValid ? true : undefined}
                  className="h-9 w-full rounded-sm border border-border bg-background px-2.5 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              {handleTaken ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  That handle is taken — pick another.
                </p>
              ) : handle.length > 0 && !handleValid ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Use 3–20 characters from a-z, 0-9 and _.
                </p>
              ) : null}
            </Field>

            <Field label="Display name" hint="Optional — shown instead of the handle.">
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Aurelius"
                maxLength={40}
                className="h-9 w-full rounded-sm border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </Field>

            <Field label="Avatar URL" hint="Optional https image.">
              <input
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
                placeholder="https://…"
                type="url"
                className="h-9 w-full rounded-sm border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </Field>

            <Field label="Bio" hint="Optional, ~200 characters.">
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                maxLength={280}
                rows={3}
                className="w-full resize-y rounded-sm border border-border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </Field>

            <label className="flex items-start gap-2.5 rounded-sm border border-border bg-background p-3 text-sm">
              <input
                type="checkbox"
                checked={!isPublic}
                onChange={(event) => setIsPublic(!event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
              />
              <span>
                Hide my trades from the public feed and leaderboard
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  Your profile page stays reachable by link; public surfaces stop showing your
                  activity.
                </span>
              </span>
            </label>

            {saveError ? (
              <p role="alert" className="text-sm text-foreground">
                {saveError}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                {saving ? "Saving…" : submitLabel}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {hint ? <span className="ml-2 text-[11px] text-muted-foreground/80">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
