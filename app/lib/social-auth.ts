"use client";

/**
 * Wallet-sign-in for the social layer: nonce → signMessage → verify → bearer
 * token, cached in localStorage under `basalt:social-token`.
 *
 * Contract (social backend): the signature is base58 ed25519 over EXACTLY
 * `Basalt Social\nWallet: ${wallet}\nNonce: ${nonce}` (UTF-8 bytes). The
 * connected wallet adapter produces the signature; `bs58` encodes it.
 *
 * Usage: `const social = useSocialAuth()` → `social.ensureAuth()` resolves the
 * token (cached until `expiresAt`, re-prompts transparently otherwise) and
 * `social.authedFetch(path, init)` attaches the Authorization header,
 * re-authenticating once on a 401. A single sign-in flow is deduped per wallet
 * at module level so N components never open N wallet prompts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";

import { requestNonce, verifyWallet } from "@/lib/social-api";
import { SocialApiError } from "@/lib/social-api";
import { apiFetch } from "@/lib/api-client";
import { describeWalletError } from "@/lib/wallet";

const STORAGE_KEY = "basalt:social-token";

interface StoredAuth {
  token: string;
  wallet: string;
  /** Expiry in ms since epoch; null when the payload had no parsable date. */
  expMs: number | null;
}

/** The exact message bytes the backend verifies — do not reword. */
export function socialSignMessage(wallet: string, nonce: string): string {
  return `Basalt Social\nWallet: ${wallet}\nNonce: ${nonce}`;
}

function readStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; wallet?: unknown; expMs?: unknown };
    if (typeof parsed.token !== "string" || typeof parsed.wallet !== "string") return null;
    const expMs =
      typeof parsed.expMs === "number" && Number.isFinite(parsed.expMs) ? parsed.expMs : null;
    return { token: parsed.token, wallet: parsed.wallet, expMs };
  } catch {
    return null;
  }
}

function storeAuth(auth: StoredAuth): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // Storage may be unavailable (private mode) — auth still works per-session.
  }
}

export function clearStoredAuth(wallet?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!wallet) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const stored = readStoredAuth();
    // Only clear when it belongs to this wallet — another tab may have switched.
    if (stored && stored.wallet.toLowerCase() === wallet.toLowerCase()) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function isFresh(auth: StoredAuth): boolean {
  // Unparsable expiry: keep the token and rely on the 401 re-auth path rather
  // than forcing a signature for every action.
  if (auth.expMs === null) return true;
  // Refresh 30s early so a request never leaves with a token that dies in flight.
  return auth.expMs > Date.now() + 30_000;
}

/** Thrown when the wallet request failed before any token existed. */
export class SocialAuthError extends Error {
  /** True when the user declined the signature — rendered as quiet copy. */
  rejected: boolean;
  constructor(message: string, rejected = false) {
    super(message);
    this.name = "SocialAuthError";
    this.rejected = rejected;
  }
}

type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>;

/**
 * Full handshake for one wallet. Deduped per wallet: concurrent callers share
 * the same in-flight promise, so two components never open two wallet prompts.
 */
export function authenticateWallet(
  wallet: string,
  signMessage: SignMessageFn,
): Promise<string> {
  const key = wallet.toLowerCase();
  const existing = authInFlight.get(key);
  if (existing) return existing;

  const flow = (async () => {
    try {
      const { nonce } = await requestNonce(wallet);
      const message = new TextEncoder().encode(socialSignMessage(wallet, nonce));
      let signatureBytes: Uint8Array;
      try {
        signatureBytes = await signMessage(message);
      } catch (err) {
        const described = describeWalletError(
          err as { name?: string; message?: string } | null,
        );
        const lowered = described.toLowerCase();
        throw new SocialAuthError(
          lowered.includes("reject") ? "Signature request declined." : described,
          lowered.includes("reject"),
        );
      }
      const signature = bs58.encode(signatureBytes);
      const verified = await verifyWallet(wallet, nonce, signature);
      const expMs = Date.parse(verified.expiresAt);
      const auth: StoredAuth = {
        token: verified.token,
        wallet: verified.wallet,
        expMs: Number.isFinite(expMs) ? expMs : null,
      };
      storeAuth(auth);
      return auth.token;
    } finally {
      authInFlight.delete(key);
    }
  })();
  authInFlight.set(key, flow);
  return flow;
}

const authInFlight = new Map<string, Promise<string>>();

/** Shared 401-retry core for `authedFetch`. Uses the validated apiFetch. */
async function authedFetchWithToken(
  wallet: string,
  signMessage: SignMessageFn,
  path: string,
  init: RequestInit | undefined,
  token: string,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  let res = await apiFetch(path, { ...init, headers, cache: init?.cache ?? "no-store" });
  if (res.status === 401) {
    // Token expired/revoked server-side: drop it, sign again once, retry once.
    clearStoredAuth(wallet);
    const fresh = await authenticateWallet(wallet, signMessage);
    headers.set("authorization", `Bearer ${fresh}`);
    res = await apiFetch(path, { ...init, headers, cache: init?.cache ?? "no-store" });
  }
  return res;
}

/**
 * Hook view of the social auth state for the connected wallet. `ensureAuth`
 * resolves a cached token when one exists for this wallet and re-runs the
 * handshake otherwise. All failures surface as `SocialAuthError` (with
 * `rejected` for a declined signature) — callers render inline copy, never
 * `alert()`.
 */
export function useSocialAuth() {
  const { publicKey, connected, signMessage } = useWallet();
  const wallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  const [stored, setStored] = useState<StoredAuth | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStored(readStoredAuth());
    setHydrated(true);
  }, []);

  // A token minted for a different wallet never authorizes this one.
  const activeAuth =
    stored && wallet && stored.wallet.toLowerCase() === wallet.toLowerCase() ? stored : null;

  const ensureAuth = useCallback(async (): Promise<string> => {
    if (!connected || !wallet) {
      throw new SocialAuthError("Connect a wallet first.");
    }
    if (!signMessage) {
      throw new SocialAuthError("This wallet cannot sign messages.");
    }
    if (activeAuth && isFresh(activeAuth)) return activeAuth.token;
    setAuthing(true);
    setError(null);
    try {
      const token = await authenticateWallet(wallet, signMessage as SignMessageFn);
      setStored(readStoredAuth());
      return token;
    } catch (err) {
      const message =
        err instanceof SocialApiError && err.status === 0
          ? "Could not reach the social API."
          : err instanceof Error
            ? err.message
            : "Wallet sign-in failed.";
      setError(message);
      throw err instanceof Error ? err : new SocialAuthError(message);
    } finally {
      setAuthing(false);
    }
  }, [activeAuth, connected, signMessage, wallet]);

  /**
   * fetch wrapper for write endpoints: attaches the bearer token and re-auths
   * once on 401. `path` must be a literal `/api/v1/...` route — it goes
   * through the same validated apiFetch as every other app request.
   */
  const authedFetch = useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      const token = await ensureAuth();
      if (!wallet) throw new SocialAuthError("Connect a wallet first.");
      try {
        return await authedFetchWithToken(wallet, signMessage as SignMessageFn, path, init, token);
      } catch (err) {
        if (err instanceof SocialAuthError) setError(err.message);
        throw err;
      }
    },
    [ensureAuth, signMessage, wallet],
  );

  const signOut = useCallback(() => {
    clearStoredAuth(wallet ?? undefined);
    setStored(null);
  }, [wallet]);

  return {
    /** True once a fresh cached token exists for the connected wallet. */
    isAuthed: !!activeAuth && isFresh(activeAuth) && hydrated,
    /** Connected wallet (base58) or null. */
    authWallet: wallet,
    connected,
    hydrated,
    authing,
    error,
    ensureAuth,
    authedFetch,
    signOut,
  };
}

export type SocialAuth = ReturnType<typeof useSocialAuth>;
