/**
 * Wallet / RPC helpers for FolioX.
 *
 * `RPC_ENDPOINT` reads the NEXT_PUBLIC_RPC_URL env var (inlined by Next at
 * build time, safe in client and server bundles):
 *  - default: localnet test validator at http://127.0.0.1:8899
 *  - devnet:  set NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
 *
 * The pure functions here are unit-testable with vitest as-is.
 */

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";

export type ClusterLabel =
  | "localnet"
  | "devnet"
  | "testnet"
  | "mainnet-beta"
  | "custom";

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:\d+)?$/;

/**
 * Cluster label derived from the RPC endpoint host. Used by the header network
 * indicator so the label always reflects the endpoint actually in use.
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
 * Human-readable message for a wallet-adapter error. Covers the
 * rejected-signature/rejected-connection case explicitly; unknown errors fall
 * through to the wallet's own message.
 */
export function describeWalletError(
  error: { name?: string; message?: string } | null | undefined,
): string {
  if (!error) return "The wallet request failed.";
  const name = error.name ?? "";
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("reject")) return "The request was rejected in the wallet.";
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
  const raw = error.message?.trim();
  return raw ? raw : "The wallet request failed.";
}
