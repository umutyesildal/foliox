"use client";

import { useCallback, useMemo, useState } from "react";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, FreshnessBadge } from "@/components/states";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { formatRawShares6 } from "@/components/basket/basket-math";
import {
  fetchZapInQuote,
  type BasketDetail,
  type ZapInQuote,
} from "@/components/basket/basket-api";
import {
  buildCreateAtaInstructions,
  buildMintInKind,
  deriveAta,
  type ExpectedAccount,
} from "@/lib/transactions";
import { truncateAddress } from "@/lib/format";
import { RPC_ENDPOINT } from "@/lib/wallet";

const JUPITER_SWAP_URL = "https://quote-api.jup.ag/v6/swap";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // backend default (quotes.ts)

type LegStatus = "idle" | "sending" | "confirmed" | "failed";
type Phase = "idle" | "quoting" | "quoted" | "swapping" | "ready-to-mint" | "done";

/**
 * Zap USDC: POST /quotes/zap-in returns Jupiter QUOTE legs only (the backend
 * never signs). The client executes the swaps SEQUENTIALLY — V0 zap is
 * non-atomic — and then calls mint_in_kind with the actually received amounts.
 * The verbatim backend warning is rendered inline, always.
 */
export function ZapInForm({
  detail,
  vaultBalances,
}: {
  detail: BasketDetail;
  vaultBalances: (bigint | null)[];
}) {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const flow = useTransactionFlow();

  const [amountUsdc, setAmountUsdc] = useState("");
  const [slippageBps, setSlippageBps] = useState("50");
  const [quote, setQuote] = useState<ZapInQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [legStates, setLegStates] = useState<LegStatus[]>([]);
  const [swapWarning, setSwapWarning] = useState<string | null>(null);
  const [expectedAccounts, setExpectedAccounts] = useState<ExpectedAccount[] | null>(null);
  const [mintAmounts, setMintAmounts] = useState<bigint[] | null>(null);
  const [open, setOpen] = useState(false);

  const amountRaw = useMemo(() => {
    const s = amountUsdc.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
    const [int, frac = ""] = s.split(".");
    const raw = BigInt(int + frac.padEnd(6, "0"));
    return raw > 0n ? raw.toString() : null;
  }, [amountUsdc]);

  const slippage = useMemo(() => {
    const n = Number(slippageBps);
    return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : null;
  }, [slippageBps]);

  const getQuote = useCallback(async () => {
    if (!amountRaw || slippage === null) return;
    setPhase("quoting");
    setQuoteError(null);
    setSwapWarning(null);
    setQuote(null);
    try {
      const q = await fetchZapInQuote(
        { basket: detail.pubkey, amountUSDC: amountRaw, slippageBps: slippage },
        new AbortController().signal,
      );
      setQuote(q);
      setLegStates(q.legs.map(() => "idle"));
      setPhase("quoted");
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : "Quote failed.");
      setPhase("idle");
    }
  }, [amountRaw, slippage, detail.pubkey]);

  /**
   * Execute per the backend-documented flow: (1) prepare missing user ATAs,
   * (2) run every Jupiter leg sequentially, (3) open the mint review with the
   * actually received balances.
   */
  const executeSwaps = useCallback(async () => {
    if (!publicKey || !quote || !signTransaction) return;
    setPhase("swapping");
    setSwapWarning(null);

    // (1) prepare — create missing constituent ATAs so swaps have destinations.
    const missing: number[] = [];
    await Promise.all(
      detail.constituents.map(async (mint, i) => {
        try {
          await connection.getTokenAccountBalance(deriveAta(publicKey, new PublicKey(mint)));
        } catch {
          missing.push(i);
        }
      }),
    );
    if (missing.length > 0) {
      try {
        const blockhash = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({
          feePayer: publicKey,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        });
        tx.add(
          ...buildCreateAtaInstructions(
            publicKey,
            publicKey,
            missing.map((i) => new PublicKey(detail.constituents[i])),
          ),
        );
        const signed = await signTransaction(tx);
        const signature = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(
          { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
          "confirmed",
        );
      } catch (err) {
        setSwapWarning(
          `Prepare step failed: ${
            err instanceof Error ? err.message : "unknown error"
          }. Nothing was swapped.`,
        );
        setPhase("quoted");
        return;
      }
    }

    // (2) sequential, non-atomic legs.
    for (let i = 0; i < quote.legs.length; i++) {
      const leg = quote.legs[i];
      if (!leg.jupiterQuote) {
        setLegStates((prev) => prev.map((s, j) => (j === i ? "confirmed" : s)));
        continue; // zero-amount leg skipped by the backend
      }
      setLegStates((prev) => prev.map((s, j) => (j === i ? "sending" : s)));
      try {
        const res = await fetch(JUPITER_SWAP_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quoteResponse: leg.jupiterQuote,
            userPublicKey: publicKey.toBase58(),
            wrapAndUnwrapSol: true,
          }),
        });
        if (!res.ok) throw new Error(`Jupiter swap API responded ${res.status}`);
        const payload = (await res.json()) as { swapTransaction?: string };
        if (!payload.swapTransaction) throw new Error("Jupiter returned no swap transaction");
        // Base64 → bytes without relying on a Buffer global in the client bundle.
        const swapTx = VersionedTransaction.deserialize(
          Uint8Array.from(atob(payload.swapTransaction), (c) => c.charCodeAt(0)),
        );
        const signed = await signTransaction(swapTx);
        const signature = await connection.sendRawTransaction(signed.serialize());
        const confirmed = await connection.confirmTransaction(signature, "confirmed");
        if (confirmed.value.err) throw new Error(`leg ${i + 1} failed on-chain`);
        setLegStates((prev) => prev.map((s, j) => (j === i ? "confirmed" : s)));
      } catch (err) {
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        setSwapWarning(
          `Leg ${i + 1} did not complete: ${
            err instanceof Error ? err.message : "unknown error"
          }. The zap is sequential and non-atomic — you may be holding intermediate tokens. No funds are lost, but continuing requires extra transactions.`,
        );
        setPhase("quoted");
        return;
      }
    }
    setPhase("ready-to-mint");
  }, [connection, detail.constituents, publicKey, quote, signTransaction]);

  const openMintReview = useCallback(async () => {
    if (!publicKey) return;
    // Amounts = what actually arrived (balance deltas), never the quote.
    const received = await Promise.all(
      detail.constituents.map(async (mint) => {
        try {
          const res = await connection.getTokenAccountBalance(
            deriveAta(publicKey, new PublicKey(mint)),
          );
          return BigInt(res.value.amount);
        } catch {
          return 0n;
        }
      }),
    );
    if (received.some((amount) => amount <= 0n)) {
      setSwapWarning(
        "A constituent leg delivered zero raw units — mint_in_kind requires every amount > 0. No mint was prepared.",
      );
      return;
    }
    setMintAmounts(received);
    const built = buildMintInKind({
      keys: {
        basket: new PublicKey(detail.pubkey),
        factory: new PublicKey(detail.factory),
        creator: new PublicKey(detail.creator),
        treasury: new PublicKey(detail.treasury),
        shareMint: new PublicKey(detail.share_mint),
        constituents: detail.constituents,
        user: publicKey,
      },
      amounts: received,
      vaultBalances: vaultBalances.map((v) => v ?? 0n),
    });
    setExpectedAccounts(built.expectedAccounts);
    setOpen(true);
  }, [connection, detail, publicKey, vaultBalances]);

  const close = () => {
    setOpen(false);
    flow.reset();
  };

  const supply = detail.nav?.supply;
  const supplyValid = Boolean(supply && /^\d+$/.test(supply.trim()));

  if (!supplyValid || vaultBalances.some((v) => v === null)) {
    return (
      <EmptyState
        chip="NO SNAPSHOT"
        title="Zap preview unavailable"
        description="The zap ends in mint_in_kind, which is validated against indexed vault holdings and supply. This basket has no complete holdings snapshot yet."
      />
    );
  }

  const legsDone = quote ? quote.legs.every((_, i) => legStates[i] === "confirmed") : false;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        The quote splits your USDC across the basket&apos;s target weights. Swaps run one by one in
        your wallet, then the received tokens are minted in-kind. Jupiter is periphery — the core
        mint is the same <span className="font-mono">mint_in_kind</span> as the in-kind tab.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="zap-usdc" className="text-xs font-medium text-muted-foreground">
            USDC amount
          </label>
          <input
            id="zap-usdc"
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 250.50"
            value={amountUsdc}
            onChange={(e) => setAmountUsdc(e.target.value)}
            className="h-9 w-40 rounded-md border border-border bg-card px-3 font-mono text-sm tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="zap-slippage" className="text-xs font-medium text-muted-foreground">
            Slippage (bps)
          </label>
          <input
            id="zap-slippage"
            inputMode="numeric"
            value={slippageBps}
            onChange={(e) => setSlippageBps(e.target.value)}
            className="h-9 w-24 rounded-md border border-border bg-card px-3 font-mono text-sm tabular-nums outline-none focus:border-ring"
          />
        </div>
        <Button onClick={() => void getQuote()} disabled={!amountRaw || slippage === null || phase === "quoting"}>
          {phase === "quoting" ? "Quoting…" : "Get quote"}
        </Button>
      </div>

      {quoteError ? (
        <ErrorState
          title="Quote unavailable"
          message={quoteError}
          onRetry={() => void getQuote()}
        />
      ) : null}

      {quote ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <FreshnessBadge
              source={quote.provenance.source}
              asOf={quote.provenance.asOf}
            />
            <span className="font-mono tabular-nums text-muted-foreground">
              slippage {quote.provenance.slippageBps} bps
            </span>
            {quote.expectedShares ? (
              <span className="font-mono tabular-nums text-muted-foreground">
                est. {formatRawShares6(BigInt(quote.expectedShares))} shares
              </span>
            ) : (
              <span className="text-muted-foreground">no indexed supply — no share estimate</span>
            )}
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Jupiter quote legs</caption>
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">Leg</th>
                  <th className="px-3 py-2 font-medium">Allocation</th>
                  <th className="px-3 py-2 text-right font-medium">In (USDC raw)</th>
                  <th className="px-3 py-2 text-right font-medium">Expected out</th>
                  <th className="px-3 py-2 text-right font-medium">Impact</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {quote.legs.map((leg, i) => (
                  <tr key={leg.index} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {truncateAddress(leg.outputMint, 4, 4)}
                      {leg.routeLabels.length ? (
                        <span className="ml-2 text-muted-foreground">via {leg.routeLabels.join(" → ")}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {leg.allocationBps !== null ? `${leg.allocationBps} bps` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{leg.inAmount}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {leg.expectedOutAmount ?? leg.note ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {leg.priceImpactPct ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{legStates[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* verbatim backend warning — always inline for zap quotes */}
          <div
            role="note"
            className="rounded-md border border-[hsl(var(--status-caution))]/40 bg-[hsl(var(--status-caution))]/10 p-3 text-xs leading-relaxed text-[hsl(var(--status-caution))]"
          >
            {quote.warning}
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            {quote.mintAccountsNote}
          </p>

          {swapWarning ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
              {swapWarning}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void executeSwaps()}
              disabled={phase !== "quoted" || !connected || !signTransaction}
            >
              {phase === "swapping" ? "Swapping…" : `Execute ${quote.legs.length} swap legs`}
            </Button>
            <Button
              onClick={() => void openMintReview()}
              disabled={phase !== "ready-to-mint" || !legsDone}
              variant="outline"
            >
              Mint with received tokens
            </Button>
          </div>
          {connected && !signTransaction ? (
            <p role="alert" className="text-xs text-muted-foreground">
              This wallet cannot sign the Jupiter swap transactions.
            </p>
          ) : null}
        </div>
      ) : null}

      <TxReviewModal
        open={open}
        onClose={close}
        title="Review mint after zap"
        description="mint_in_kind with the amounts that actually arrived — not the quoted amounts. The entry fee splits 90/10 to creator/treasury."
        accounts={expectedAccounts ?? []}
        summary={
          <dl className="grid gap-1 font-mono text-xs tabular-nums">
            {detail.constituents.map((mint, i) => (
              <div key={mint} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  deposit[{i}] {truncateAddress(mint, 4, 4)}
                </dt>
                <dd>{mintAmounts ? `${mintAmounts[i]} raw` : "—"}</dd>
              </div>
            ))}
          </dl>
        }
        flowState={flow.state}
        onConfirm={() => {
          if (!publicKey || !mintAmounts) return;
          void flow.run(() =>
            buildMintInKind({
              keys: {
                basket: new PublicKey(detail.pubkey),
                factory: new PublicKey(detail.factory),
                creator: new PublicKey(detail.creator),
                treasury: new PublicKey(detail.treasury),
                shareMint: new PublicKey(detail.share_mint),
                constituents: detail.constituents,
                user: publicKey,
              },
              amounts: mintAmounts,
              vaultBalances: vaultBalances.map((v) => v ?? 0n),
            }).instructions,
          );
        }}
        confirmLabel="Simulate & sign"
        endpoint={RPC_ENDPOINT}
        errorSlot={
          flow.state.mintPaused ? (
            <div
              role="alert"
              className="mt-4 rounded-md border border-[hsl(var(--status-caution))]/40 bg-[hsl(var(--status-caution))]/10 p-3 text-xs leading-relaxed"
            >
              <p className="font-medium">MintPaused — the on-chain whitelist gate stopped this mint</p>
              <p className="mt-1 text-muted-foreground">
                A constituent is PausedNewMints; new mints are blocked before any token moves. Your
                swapped tokens stay in your wallet. Redeem is never affected by this pause.
              </p>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
