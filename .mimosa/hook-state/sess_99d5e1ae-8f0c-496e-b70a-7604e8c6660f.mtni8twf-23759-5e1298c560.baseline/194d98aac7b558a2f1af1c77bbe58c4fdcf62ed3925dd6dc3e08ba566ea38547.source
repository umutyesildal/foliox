/**
 * rpc/backoff.ts — shared 429 backoff + read pacing for EVERY Solana RPC loop
 * (indexer listener, whitelist/holdings syncs, NAV supply reads, fee-crank
 * blockhash). The backend is strictly read-only against RPC (AGENTS.md §2 #5);
 * this module only shapes WHEN those reads happen.
 *
 * Contract:
 *   * `isRateLimitError` — 429 / "Too Many Requests" detection on the thrown
 *     error text (web3.js surfaces the upstream status in its message).
 *   * `backoffDelayMs(attempt)` — exponential 2s→4s→8s… with ±25% jitter,
 *     hard-capped at 60s so a sustained outage backs off but never wedges.
 *   * `withRpcBackoff(fn)` — the ONE retry layer. Non-rate-limit errors
 *     propagate immediately (callers' existing catches behave unchanged).
 *     Rate-limited failures wait `backoffDelayMs` between attempts; after
 *     `maxAttempts` the LAST error is rethrown. Callers keep their single
 *     catch and never retry the same batch again — a getSignaturesForAddress
 *     call that already went through backoff is never double-fired by a
 *     second wrapper.
 *   * `rateLimitedWarn(key, msg)` — one log line per key per window
 *     (60s default): backoff stays visible in the log without spamming it.
 *   * `createPacer(gapMs)` — minimum spacing between sequential reads so a
 *     batch of account reads cannot land as a single burst (the 12 sequential
 *     getAccountInfo calls of a holdings pass were a prime 429 trigger).
 */

/** First-wait before the 1st retry (attempt 1 → 2s, attempt 2 → 4s, …). */
export const RPC_BACKOFF_BASE_MS = 2_000;
/** Hard cap — a sustained 429 outage never waits longer than this per retry. */
export const RPC_BACKOFF_CAP_MS = 60_000;
/** Total attempts (1 initial + 2 backoff retries) before the error propagates. */
export const RPC_BACKOFF_MAX_ATTEMPTS = 3;
/** One warn line per key per this window (spec of the fix: ≤1 log/min). */
export const RATE_LIMIT_LOG_WINDOW_MS = 60_000;

/** True when the error is an upstream rate limit (429 / Too Many Requests). */
export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /429|too many requests/i.test(msg);
}

/**
 * Exponential backoff with jitter: baseMs × 2^(attempt-1), ±25% jitter,
 * capped at capMs. attempt is 1-based (the wait BEFORE retry #1).
 */
export function backoffDelayMs(
  attempt: number,
  rng: () => number = Math.random,
  capMs: number = RPC_BACKOFF_CAP_MS,
  baseMs: number = RPC_BACKOFF_BASE_MS,
): number {
  const exp = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), capMs);
  const jitter = 0.75 + rng() * 0.5; // 0.75x – 1.25x
  return Math.max(0, Math.min(Math.round(exp * jitter), capMs));
}

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- rate-limited warn (one line per key per window) -------------------------

const lastWarnAtMs = new Map<string, number>();

/** Log `msg` under `key` at most once per `windowMs`. Returns true when logged. */
export function rateLimitedWarn(
  key: string,
  msg: string,
  now: () => number = Date.now,
  windowMs: number = RATE_LIMIT_LOG_WINDOW_MS,
): boolean {
  const t = now();
  const last = lastWarnAtMs.get(key);
  if (last !== undefined && t - last < windowMs) return false;
  lastWarnAtMs.set(key, t);
  console.warn(msg);
  return true;
}

/** Test/maintenance hook: forget all rate-limited-warn windows. */
export function resetRateLimitedWarn(): void {
  lastWarnAtMs.clear();
}

// --- the one retry layer ------------------------------------------------------

export interface RpcBackoffOptions {
  /** Total attempts including the first (default 3 → 2 backoff retries). */
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  /** Injectable RNG for deterministic jitter in tests. */
  rng?: () => number;
  /** Injectable sleep (tests: instant). */
  sleep?: (ms: number) => Promise<void>;
  /** Log-suppression key (one warn line per key per minute). */
  logKey?: string;
  /** Injectable clock for the log-suppression window. */
  now?: () => number;
}

/**
 * Run one RPC read through the shared 429 backoff. See the module contract:
 * non-429 errors rethrow immediately; 429s back off exponentially (jitter,
 * 60s cap) and retry until `maxAttempts`, then rethrow the LAST error. There
 * is deliberately NO retry in the callers — this is the single retry layer.
 */
export async function withRpcBackoff<T>(fn: () => Promise<T>, opts: RpcBackoffOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? RPC_BACKOFF_MAX_ATTEMPTS);
  const doSleep = opts.sleep ?? sleep;
  const rng = opts.rng ?? Math.random;
  const baseMs = opts.baseMs ?? RPC_BACKOFF_BASE_MS;
  const capMs = opts.capMs ?? RPC_BACKOFF_CAP_MS;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (!isRateLimitError(err) || attempt >= maxAttempts) throw err;
      const delay = backoffDelayMs(attempt, rng, capMs, baseMs);
      rateLimitedWarn(
        opts.logKey ?? "rpc",
        `[rpc] 429 rate-limited — backing off ${delay}ms before retry ` +
          `${attempt}/${maxAttempts - 1} (cap ${capMs}ms, jittered; ≤1 log/min per key)`,
        opts.now,
      );
      await doSleep(delay);
    }
  }
}

// --- sequential-read pacing ---------------------------------------------------

export interface Pacer {
  /** Await this before each sequential read; enforces the minimum gap. */
  wait(): Promise<void>;
}

/**
 * Minimum spacing between sequential RPC reads (default pacer for the NAV
 * supply loop and the holdings batch pass). gapMs ≤ 0 disables pacing.
 */
export function createPacer(
  gapMs: number,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Pacer {
  const now = opts.now ?? Date.now;
  const doSleep = opts.sleep ?? sleep;
  let lastMs = 0;
  return {
    async wait(): Promise<void> {
      if (gapMs <= 0) return;
      const waitMs = gapMs - (now() - lastMs);
      if (waitMs > 0) await doSleep(Math.min(waitMs, gapMs));
      lastMs = now();
    },
  };
}
