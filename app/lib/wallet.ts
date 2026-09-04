/**
 * Wallet / RPC helpers for FolioX.
 *
 * Cluster wiring (both env vars are inlined by Next at build time, safe in
 * client and server bundles):
 *  - NEXT_PUBLIC_CLUSTER — explicit cluster: "localnet" | "devnet" |
 *    "testnet" | "mainnet-beta". Default when unset: "devnet" (this is the
 *    devnet-showcase repo state; explorer links and the network indicator
 *    read CLUSTER, so every address/tx link carries ?cluster=devnet).
 *  - NEXT_PUBLIC_RPC_URL — RPC endpoint override. When unset, the well-known
 *    public endpoint for the resolved cluster is used (devnet →
 *    https://api.devnet.solana.com). When set without NEXT_PUBLIC_CLUSTER,
 *    the cluster label is derived from the endpoint host.
 *
 * The pure functions here are unit-testable with vitest as-is.
 */

export type ClusterLabel =
  | "localnet"
  | "devnet"
  | "testnet"
  | "mainnet-beta"
  | "custom";

/** Well-known public RPC endpoint per cluster (localnet = test validator). */
const DEFAULT_ENDPOINTS: Record<Exclude<ClusterLabel, "custom">, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

const KNOWN_CLUSTERS: readonly ClusterLabel[] = [
  "localnet",
  "devnet",
  "testnet",
  "mainnet-beta",
];

function normalizeCluster(value: string | undefined): ClusterLabel | null {
  const v = value?.trim().toLowerCase();
  return v && (KNOWN_CLUSTERS as readonly string[]).includes(v)
    ? (v as ClusterLabel)
    : null;
}

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:\d+)?$/;

/**
 * Cluster label derived from the RPC endpoint host. Used as the fallback when
 * NEXT_PUBLIC_CLUSTER is unset but a custom RPC URL is configured.
 */
export function clusterFromEndpoint(endpoint: string): ClusterLabel {
  if (!endpoint) return "custom";
  let host: string;
  try {
    host = new URL(endpoint).host;
  } catch {
    return "custom";
  }
  if (LOCAL_HOST_PATTERN.test(host)) return "localnet";
  if (host === "api.devnet.solana.com") return "devnet";
  if (host === "api.testnet.solana.com") return "testnet";
  if (host === "api.mainnet-beta.solana.com") return "mainnet-beta";
  return "custom";
}

/**
 * Resolved cluster for this build:
 *  1. NEXT_PUBLIC_CLUSTER when it names a known cluster;
 *  2. else the host of NEXT_PUBLIC_RPC_URL when that env var is set;
 *  3. else "devnet" (the default for this repo state).
 */
export const CLUSTER: ClusterLabel =
  normalizeCluster(process.env.NEXT_PUBLIC_CLUSTER) ??
  (process.env.NEXT_PUBLIC_RPC_URL
    ? clusterFromEndpoint(process.env.NEXT_PUBLIC_RPC_URL)
    : "devnet");

/** RPC endpoint actually used everywhere (providers, tx flows, health). */
export const RPC_ENDPOINT: string =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (CLUSTER === "custom" ? DEFAULT_ENDPOINTS.localnet : DEFAULT_ENDPOINTS[CLUSTER]);

/**
 * Explorer query fragment for the given cluster (?cluster=… — mainnet-beta
 * needs none, localnet maps to ?cluster=custom&customUrl=<endpoint>).
 * Single source of truth for every explorer link in the app.
 */
export function explorerClusterQuery(
  cluster: ClusterLabel,
  endpoint: string,
): string {
  switch (cluster) {
    case "devnet":
      return "?cluster=devnet";
    case "testnet":
      return "?cluster=testnet";
    case "mainnet-beta":
      return "";
    case "localnet":
      return `?cluster=custom&customUrl=${encodeURIComponent(endpoint)}`;
    case "custom":
    default:
      // Unrecognized endpoint — fall back to host sniffing so a devnet URL
      // passed via NEXT_PUBLIC_RPC_URL still lands on the right cluster.
      return explorerClusterQuery(clusterFromEndpoint(endpoint), endpoint);
  }
}

/**
 * Human-readable message for a wallet-adapter error. Covers the
 * rejected-signature/rejected-connection case explicitly; rate-limited public
 * RPC errors get calm honest copy (web3.js already retries internally with
 * backoff — "Server responded with 429. Retrying after 4000ms delay…" is the
 * shared api.devnet.solana.com limit, not a broken wallet); unknown errors
 * fall through to the wallet's own message.
 */
export function describeWalletError(
  error: { name?: string; message?: string } | null | undefined,
): string {
  if (!error) return "The wallet request failed.";
  const name = error.name ?? "";
  const message = error.message ?? "";
  const lowered = message.toLowerCase();
  if (isRateLimitErrorText(`${name} ${message}`)) {
    return describeRpcRateLimit();
  }
  if (lowered.includes("reject")) return "The request was rejected in the wallet.";
  if (name === "WalletWindowClosedError") {
    return "The wallet window was closed before the request finished.";
  }
  if (name === "WalletWindowBlockedError") {
    return "The wallet window was blocked by the browser.";
  }
  if (name === "WalletNotReadyError") {
    return "The wallet is not ready. Unlock it and try again.";
  }
  if (name === "WalletTimeoutError") {
    return "The wallet did not respond in time.";
  }
  if (name === "WalletNotConnectedError") {
    return "Connect a wallet before signing.";
  }
  if (name === "WalletDisconnectedError") {
    return "The wallet was disconnected.";
  }
  const raw = message.trim();
  return raw ? raw : "The wallet request failed.";
}

/** Matches HTTP 429 / rate-limit wording out of raw RPC or wallet errors. */
function isRateLimitErrorText(text: string): boolean {
  return /\b429\b|too many requests|rate.?limit/i.test(text);
}

/** True when an error is the public devnet RPC rate limit (429). */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : String(error);
  return isRateLimitErrorText(text);
}

/**
 * Calm inline copy for rate-limit errors — the honest state: the public
 * cluster is throttling shared traffic and web3.js retries automatically.
 */
export function describeRpcRateLimit(endpoint: string = RPC_ENDPOINT): string {
  return `devnet public RPC is rate-limited — retrying automatically (${endpoint}). This usually clears in a few seconds; no action needed.`;
}

/** Map a thrown error to display text: calm copy for 429s, raw otherwise. */
export function describeRpcError(err: unknown): string {
  if (isRateLimitError(err)) return describeRpcRateLimit();
  return err instanceof Error ? err.message : String(err);
}
