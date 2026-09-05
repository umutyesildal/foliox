/**
 * Shared RPC retry loop for every Solana call the transaction flow makes.
 *
 * Why this exists: on the shared public devnet endpoint a 429 can outlast the
 * ~15s of internal retries @solana/web3.js already does (5 retries, 500ms→8s —
 * node_modules/@solana/web3.js `too_many_requests_retries`). Before this module
 * the app merely DESCRIBED the rate limit ("retrying automatically…") while the
 * flow actually died on the first surfaced error. Now every RPC call site in
 * the transaction flow (blockhash reads, simulation, send, confirmation
 * polling, lookup-table create/extend/read-backs) is wrapped in `withRetry`:
 *
 *   attempts: 1 initial + 5 retries (6 total)
 *   waits:    2s → 4s → 8s → 16s → 30s, ±25% jitter (≈60s of backoff)
 *   total:    ≈60–90s of sustained-throttle tolerance per call
 *
 * web3.js's own internal 429 retry is left ENABLED — it absorbs sub-second
 * blips cheaply, and `withRetry` only engages when an error actually surfaces
 * (i.e. after web3.js gave up). No double retry loop per call: the wrapping
 * happens at the flow's call sites, never inside web3.js internals.
 *
 * Non-transient failures (Anchor program errors, wallet rejections, "blockhash
 * not found") are NEVER retried — retrying a deterministic failure would just
 * burn the user's time. Retry exhaustion throws the typed
 * `RpcRetriesExhaustedError`, which the UI renders as honest next-action copy
 * instead of "unexpected error".
 */

/** Backoff schedule: wait before retry 1..5 (ms), before jitter. */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000];

/** Total logical attempts = 1 initial + one retry per delay (6). */
export const RETRY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Per-wait cap (the last schedule entry) — never sleep longer than this. */
export const RETRY_MAX_WAIT_MS = 30_000;

/** Wait jitter fraction (±25%) so concurrent clients do not sync their retries. */
const JITTER = 0.25;

/**
 * True for failures where waiting can actually help: shared-cluster rate
 * limits (429 / "Too Many Requests"), gateway overload (502/503/504 wordings),
 * and plain transport drops. Everything else (program errors, wallet
 * rejections, stale-blockhash) fails fast with its real reason.
 */
export function isTransientRpcError(error: unknown): boolean {
  if (!error) return false;
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : String(error);
  return /(\b429\b|too many requests|rate.?limit|service unavailable|bad gateway|gateway time-?out|\b502\b|\b503\b|\b504\b|econnreset|econnrefused|etimedout|socket hang up|fetch failed|failed to fetch|network request failed|websocket closed|connection closed)/i.test(
    text,
  );
}

/** Progress report fired before every retry wait (also consumed by tests). */
export interface RetryEvent {
  label: string;
  /** The attempt that just failed (1-based). */
  attempt: number;
  /** Total logical attempts that will be made. */
  attempts: number;
  /** How long the loop waits before the next attempt (ms). */
  waitMs: number;
  error: unknown;
}

export interface RetryOptions {
  /** Stable name for logs and error copy, e.g. "simulateTransaction". */
  label: string;
  /** Total logical attempts (default 6). */
  attempts?: number;
  /** Backoff schedule before retry n (default RETRY_DELAYS_MS). */
  delaysMs?: readonly number[];
  /**
   * Absolute wall-clock deadline (Date.now() basis). When set, no attempt
   * starts after it and the loop stops waiting past it — used by the
   * confirmation poller so its inner retries cannot outrun the outer budget.
   */
  deadline?: number;
  /** Fired before each retry wait — surface "retrying…" progress in the UI. */
  onRetry?: (event: RetryEvent) => void;
}

/**
 * Typed failure raised ONLY after every attempt is exhausted (or the deadline
 * passed). `message` is final user-facing copy: it states what was tried, how
 * long, and the next action — never "unexpected error".
 */
export class RpcRetriesExhaustedError extends Error {
  readonly label: string;
  readonly attempts: number;
  /** Total time spent waiting between attempts (ms, excluding call time). */
  readonly waitedMs: number;
  readonly cause?: unknown;

  constructor(params: {
    label: string;
    attempts: number;
    waitedMs: number;
    lastError: unknown;
  }) {
    const reason = params.lastError instanceof Error ? params.lastError.message : String(params.lastError);
    super(
      `The RPC stayed unavailable after ${params.attempts} attempts (~${Math.round(params.waitedMs / 1000)}s of backoff) while ${params.label}. Last reason: ${reason}. Nothing was lost — press Retry to try again.`,
    );
    this.name = "RpcRetriesExhaustedError";
    this.label = params.label;
    this.attempts = params.attempts;
    this.waitedMs = params.waitedMs;
    this.cause = params.lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** wait ± JITTER, capped at RETRY_MAX_WAIT_MS. */
export function jitteredWait(baseMs: number): number {
  const wait = Math.min(baseMs, RETRY_MAX_WAIT_MS);
  const delta = Math.round(wait * JITTER);
  return wait - delta + Math.floor(Math.random() * (delta * 2 + 1));
}

/**
 * Run `fn` with the shared exponential-backoff loop. Throws the original error
 * immediately for non-transient failures; throws `RpcRetriesExhaustedError`
 * only after every attempt (or the deadline) is spent.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? RETRY_ATTEMPTS;
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  let waitedMs = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt >= attempts;
      const pastDeadline = options.deadline !== undefined && Date.now() >= options.deadline;
      if (!isTransientRpcError(error) || isLast || pastDeadline) {
        if (!isTransientRpcError(error)) throw error;
        throw new RpcRetriesExhaustedError({
          label: options.label,
          attempts: attempt,
          waitedMs,
          lastError: error,
        });
      }
      const waitMs = jitteredWait(delays[Math.min(attempt - 1, delays.length - 1)] ?? RETRY_MAX_WAIT_MS);
      waitedMs += waitMs;
      options.onRetry?.({ label: options.label, attempt, attempts, waitMs, error });
      await sleep(waitMs);
      if (options.deadline !== undefined && Date.now() >= options.deadline) {
        throw new RpcRetriesExhaustedError({
          label: options.label,
          attempts: attempt + 1,
          waitedMs,
          lastError: error,
        });
      }
    }
  }
}

/** Same loop, capped at ONE retry — for background page reads (calm, short). */
export async function withRetryOnce<T>(fn: () => Promise<T>, label: string): Promise<T> {
  return withRetry(fn, { label, attempts: 2, delaysMs: [2_000] });
}
