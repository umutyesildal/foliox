"use client";

/**
 * Handle onboarding ("her cüzdan bir username seçmeli"): a non-modal,
 * fixed bottom-right nudge shown when a connected wallet has not claimed a
 * handle yet. Claiming opens the shared ProfileEditorModal with claim copy;
 * a successful save persists `basalt:handle-claimed:<wallet>` = "1" and hides
 * the card. Dismiss hides it for this wallet for the tab session
 * (`basalt:handle-dismissed:<wallet>` in sessionStorage).
 *
 * Flags follow the SSR/try-catch guard pattern of social-auth's
 * readStoredAuth/storeAuth: never touch storage on the server, never throw
 * when storage is unavailable (private mode). A module-level cache mirrors
 * the last known values so consumers read them synchronously during render —
 * the card can only appear after a wallet connects (always post-hydration),
 * so there is no first-paint flash while effects would otherwise load state.
 */

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { SocialAvatar } from "@/components/social/avatar";
import { ProfileEditorModal } from "@/components/social/profile-editor";
import { Button } from "@/components/ui/button";

const CLAIMED_PREFIX = "basalt:handle-claimed:";
const DISMISSED_PREFIX = "basalt:handle-dismissed:";

/** Module-local change signal so every mounted surface re-reads its flag
 *  after a same-tab claim/dismiss; cross-tab updates arrive via `storage`. */
const claimedCache = new Map<string, boolean>();
const dismissedCache = new Map<string, boolean>();
const flagListeners = new Set<() => void>();

function notifyFlagsChanged(): void {
  for (const listener of flagListeners) listener();
}

/** Has this wallet claimed a handle (persisted in localStorage)? */
export function readHandleClaimed(wallet: string): boolean {
  const cached = claimedCache.get(wallet);
  if (cached !== undefined) return cached;
  let claimed = false;
  if (typeof window !== "undefined") {
    try {
      claimed = window.localStorage.getItem(CLAIMED_PREFIX + wallet) === "1";
    } catch {
      // Storage unavailable (private mode) — treat as unclaimed.
      claimed = false;
    }
  }
  claimedCache.set(wallet, claimed);
  return claimed;
}

/** Persist the claimed flag and refresh every subscribed surface. */
export function writeHandleClaimed(wallet: string): void {
  claimedCache.set(wallet, true);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CLAIMED_PREFIX + wallet, "1");
    } catch {
      // Storage unavailable — the in-memory cache still hides the nudge.
    }
  }
  notifyFlagsChanged();
}

function readHandleDismissed(wallet: string): boolean {
  const cached = dismissedCache.get(wallet);
  if (cached !== undefined) return cached;
  let dismissed = false;
  if (typeof window !== "undefined") {
    try {
      dismissed = window.sessionStorage.getItem(DISMISSED_PREFIX + wallet) === "1";
    } catch {
      dismissed = false;
    }
  }
  dismissedCache.set(wallet, dismissed);
  return dismissed;
}

function writeHandleDismissed(wallet: string): void {
  dismissedCache.set(wallet, true);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(DISMISSED_PREFIX + wallet, "1");
    } catch {
      // Storage unavailable — dismissal still holds for this tab via cache.
    }
  }
  notifyFlagsChanged();
}

/**
 * Synchronous flag view for one wallet, kept fresh across same-tab
 * claim/dismiss (module signal) and other tabs (storage events). With no
 * wallet there is nothing to nudge, so both flags read "done".
 */
export function useHandleFlags(wallet: string | null): {
  claimed: boolean;
  dismissed: boolean;
} {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!wallet) return;
    const refresh = () => bump((n) => n + 1);
    flagListeners.add(refresh);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key &&
        !event.key.startsWith(CLAIMED_PREFIX) &&
        !event.key.startsWith(DISMISSED_PREFIX)
      ) {
        return;
      }
      // null key = another tab cleared storage; re-read everything.
      claimedCache.clear();
      dismissedCache.clear();
      refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      flagListeners.delete(refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [wallet]);

  if (!wallet) return { claimed: true, dismissed: true };
  return {
    claimed: readHandleClaimed(wallet),
    dismissed: readHandleDismissed(wallet),
  };
}

/**
 * Non-modal claim nudge. Renders null on the server and while disconnected,
 * and stays out of the way once the wallet has claimed (persisted) or
 * dismissed (this session) — re-evaluated whenever the publicKey changes.
 */
export function HandleOnboarding() {
  const { publicKey, connected } = useWallet();
  const wallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { claimed, dismissed } = useHandleFlags(wallet);
  const [modalOpen, setModalOpen] = useState(false);

  const dismiss = () => {
    if (wallet) writeHandleDismissed(wallet);
  };

  if (!connected || !wallet || claimed || dismissed || modalOpen) return null;

  return (
    <>
      <aside
        aria-label="Claim a handle"
        className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-4"
      >
        <div className="flex items-start gap-3">
          <SocialAvatar wallet={wallet} className="mt-0.5" />
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold text-foreground">
              Pick your username
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Claim a handle so the feed and leaderboard show you properly.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            title="Dismiss"
            className="-mr-1.5 -mt-1.5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={dismiss}
          >
            ×
          </Button>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => setModalOpen(true)}>
            Claim handle
          </Button>
        </div>
      </aside>
      <ProfileEditorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          if (wallet) writeHandleClaimed(wallet);
          setModalOpen(false);
        }}
        title="Claim your handle"
        submitLabel="Claim handle"
      />
    </>
  );
}
