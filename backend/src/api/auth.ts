/**
 * api/auth.ts — wallet-signature auth for the SOCIAL WRITE surface only.
 *
 * This is the backend's first authenticated surface, and its scope is
 * deliberately narrow: profiles, follows, posts, likes, comments. Nothing
 * here touches funds or transactions — the backend still never signs or
 * submits Solana txs (AGENTS.md §2 #5). The flow is SIWS-lite:
 *
 *   1. client POST /auth/nonce {wallet}          → single-use nonce (5 min TTL)
 *   2. client signs the EXACT message (wallet adapter signMessage):
 *        FolioX Social\nWallet: <wallet>\nNonce: <nonce>
 *   3. client POST /auth/verify {wallet, nonce, signature(base58 ed25519)}
 *      → HMAC token `v1.<b64url payload>.<b64url hmac>` (7 days)
 *   4. later writes carry `Authorization: Bearer <token>`
 *
 * Nonces live in a process-local Map (single-instance backend, same lifecycle
 * as the in-memory quote/NAV caches); token verification is stateless.
 */
import crypto from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";

export const AUTH_MESSAGE_PREFIX = "FolioX Social";
export const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
export const NONCE_TTL_MS = 5 * 60 * 1000;

const DEV_FALLBACK_SECRET = "foliox-dev-social-secret-do-not-use-in-prod";

export function socialAuthSecret(): string {
  const secret = process.env.SOCIAL_AUTH_SECRET;
  if (!secret) {
    console.warn(
      "[auth] SOCIAL_AUTH_SECRET not set — using dev fallback token secret. " +
        "Set SOCIAL_AUTH_SECRET in production or tokens are forgeable across restarts.",
    );
    return DEV_FALLBACK_SECRET;
  }
  return secret;
}

/** The exact bytes a wallet must sign — shared by verify and client-side tests. */
export function buildAuthMessage(wallet: string, nonce: string): string {
  return `${AUTH_MESSAGE_PREFIX}\nWallet: ${wallet}\nNonce: ${nonce}`;
}

export function isValidWalletPubkey(s: string): boolean {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    const bytes = bs58.decode(s);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

// --- nonce store ---------------------------------------------------------------

interface NonceEntry {
  expiresAt: number;
}

const nonces = new Map<string, NonceEntry>(); // key: `${wallet}:${nonce}`

/** Periodic sweep so expired entries don't accumulate. */
function sweepNonces(nowMs: number): void {
  for (const [key, entry] of nonces) {
    if (entry.expiresAt <= nowMs) nonces.delete(key);
  }
}

export function issueNonce(wallet: string, nowMs: number = Date.now()): { nonce: string; expiresAt: string } {
  const nonce = crypto.randomBytes(16).toString("hex");
  nonces.set(`${wallet}:${nonce}`, { expiresAt: nowMs + NONCE_TTL_MS });
  if (nonces.size > 10_000) sweepNonces(nowMs);
  return { nonce, expiresAt: new Date(nowMs + NONCE_TTL_MS).toISOString() };
}

/**
 * Single-use consume: unknown, expired, or already-used nonces all return
 * false (replay can never mint a second token from one signature session).
 */
export function consumeNonce(wallet: string, nonce: string, nowMs: number = Date.now()): boolean {
  const key = `${wallet}:${nonce}`;
  const entry = nonces.get(key);
  if (!entry) return false;
  nonces.delete(key);
  return entry.expiresAt > nowMs;
}

/** Test hook — clears the in-process nonce store. */
export function clearNonces(): void {
  nonces.clear();
}

// --- tokens --------------------------------------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export interface TokenPayload {
  wallet: string;
  exp: number; // unix seconds
}

export function signToken(wallet: string, secret: string, nowMs: number = Date.now()): { token: string; expiresAt: string } {
  const payload: TokenPayload = { wallet, exp: Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return { token: `v1.${body}.${mac}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function verifyToken(token: string, secret: string, nowMs: number = Date.now()): TokenPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, mac] = parts;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  let macBuf: Buffer;
  try {
    macBuf = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (macBuf.length !== expected.length || !crypto.timingSafeEqual(macBuf, expected)) return null;
  let payload: TokenPayload;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (typeof parsed.wallet !== "string" || typeof parsed.exp !== "number") return null;
    payload = parsed;
  } catch {
    return null;
  }
  if (payload.exp * 1000 <= nowMs) return null;
  return payload;
}

/** Extract + verify the bearer token from an Authorization header (or null). */
export function walletFromAuthHeader(header: string | undefined, secret: string, nowMs: number = Date.now()): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const payload = verifyToken(match[1], secret, nowMs);
  return payload ? payload.wallet : null;
}

/**
 * Verify an ed25519 signature (base58) over the exact auth message.
 * Wallet adapters sign UTF-8 bytes of the displayed message.
 */
export function verifyWalletSignature(wallet: string, nonce: string, signatureBase58: string): boolean {
  if (!isValidWalletPubkey(wallet) || typeof signatureBase58 !== "string") return false;
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signatureBase58);
  } catch {
    return false;
  }
  if (sig.length !== nacl.sign.signatureLength) return false;
  const message = Buffer.from(buildAuthMessage(wallet, nonce), "utf8");
  return nacl.sign.detached.verify(message, sig, bs58.decode(wallet));
}
