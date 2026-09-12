"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { WalletError } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

import { HandleOnboarding } from "@/components/social/handle-onboarding";
import { RPC_ENDPOINT, describeWalletError } from "@/lib/wallet";

/**
 * RPC endpoint + cluster: NEXT_PUBLIC_RPC_URL overrides the endpoint;
 * NEXT_PUBLIC_CLUSTER (default "devnet") names the cluster used by the network
 * indicator and every explorer link — see lib/wallet.ts.
 *
 * Wallets: Phantom + Solflare, auto-connect explicitly OFF. Connecting is
 * always an explicit user action from the header WalletButton. Wallet errors
 * (including rejected signatures) are funneled into WalletFeedbackContext so
 * any component can render an inline state — no toast library dependency.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  // Stable adapter instances — WalletProvider requires a memoized list.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  // Bridge: WalletProvider's onError sits above WalletFeedbackProvider in the
  // tree, so feedback state registers a sink the error handler can call.
  const feedbackSinkRef = useRef<((name: string, message: string) => void) | null>(
    null,
  );
  const handleWalletError = useCallback((error: WalletError) => {
    feedbackSinkRef.current?.(error.name, describeWalletError(error));
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider
        wallets={wallets}
        autoConnect={false}
        onError={handleWalletError}
        localStorageKey="basalt:wallet"
      >
        <WalletFeedbackProvider sinkRef={feedbackSinkRef}>
          {children}
          {/* Non-modal handle-claim nudge — needs the wallet context above. */}
          <HandleOnboarding />
        </WalletFeedbackProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export interface WalletFeedbackError {
  name: string;
  message: string;
}

interface WalletFeedbackValue {
  error: WalletFeedbackError | null;
  reportError: (name: string, message: string) => void;
  clearError: () => void;
}

const WalletFeedbackContext = createContext<WalletFeedbackValue | null>(null);

function WalletFeedbackProvider({
  children,
  sinkRef,
}: {
  children: ReactNode;
  sinkRef: RefObject<((name: string, message: string) => void) | null>;
}) {
  const [error, setError] = useState<WalletFeedbackError | null>(null);

  const reportError = useCallback((name: string, message: string) => {
    setError({ name, message });
  }, []);
  const clearError = useCallback(() => setError(null), []);

  // Keep the sink pointing at the latest reportError without re-subscribing.
  const reportRef = useRef(reportError);
  reportRef.current = reportError;

  useEffect(() => {
    sinkRef.current = (name: string, message: string) =>
      reportRef.current(name, message);
    return () => {
      sinkRef.current = null;
    };
  }, [sinkRef]);

  const value = useMemo(
    () => ({ error, reportError, clearError }),
    [error, reportError, clearError],
  );

  return (
    <WalletFeedbackContext.Provider value={value}>
      {children}
    </WalletFeedbackContext.Provider>
  );
}

/** Access the latest wallet error (rejected signature/connection, timeouts). */
export function useWalletFeedback(): WalletFeedbackValue {
  const ctx = useContext(WalletFeedbackContext);
  if (!ctx) {
    throw new Error("useWalletFeedback must be used within AppProviders");
  }
  return ctx;
}

export default AppProviders;
