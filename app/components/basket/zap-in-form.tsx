"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, FreshnessBadge } from "@/components/states";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { ThesisShareCta } from "@/components/social/thesis-share-cta";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { useAltPrewarm } from "@/components/basket/use-alt-prewarm";
import {
  bpsToPct,
  feesLine,
  grouped,
  SummaryRow,
  TxSummaryCard,
} from "@/components/basket/summary-card";
import { formatRawShares6 } from "@/components/basket/basket-math";
import {
  fetchZapInQuote,
  type BasketDetail,
  type ZapInQuote,
} from "@/components/basket/basket-api";
import {
  buildCreateAtaInstructions,
  buildMintInKind,
  buildMintInKindTransaction,
  deriveAta,
  type BasketCoreKeys,
  type ExpectedAccount,
} from "@/lib/transactions";
import { scaledFromRaw, truncateAddress } from "@/lib/format";
import { withRetry, withRetryOnce } from "@/lib/rpc-retry";
import { RPC_ENDPOINT, describeRpcError, describeWalletError } from "@/lib/wallet";

const JUPITER_SWAP_URL = "https://quote-api.jup.ag/v6/swap";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // backend default (quotes.ts)

/** Basket display name out of the metadata JSON (null when unparseable). */
function basketName(detail: BasketDetail): string | null {
  const mj = detail.metadata_json;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  const n = obj && typeof obj === "object" ? (obj as Record<string, unknown>).name : null;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

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
  tickers,
  onSuccess,
}: {
  detail: BasketDetail;
  vaultBalances: (bigint | null)[];
  /** Mint → ticker map (page API data) for the human-language review card. */
  tickers?: Map<string, string>;
  /** Called after a confirmed closing mint so the page can refetch detail. */
  onSuccess?: () => void;
}) {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const flow = useTransactionFlow();

  // n ≥ 4 baskets: the closing mint compiles through a wallet-signed lookup
  // table — prepared in the background (shared with the in-kind form's table).
  const coreKeys: BasketCoreKeys | null = useMemo(
    () =>
      publicKey
        ? {
            basket: new PublicKey(detail.pubkey),
            factory: new PublicKey(detail.factory),
            creator: new PublicKey(detail.creator),
            treasury: new PublicKey(detail.treasury),
            shareMint: new PublicKey(detail.share_mint),
            constituents: detail.constituents,
            user: publicKey,
          }
        : null,
    [detail, publicKey],
  );
  const prewarm = useAltPrewarm(coreKeys);
  const needsAlt = prewarm.needsAlt;

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
          await withRetryOnce(
            () => connection.getTokenAccountBalance(deriveAta(publicKey, new PublicKey(mint))),
            "token balance read",
          );
        } catch {
          missing.push(i);
        }
      }),
    );
    if (missing.length > 0) {
      try {
        const blockhash = await withRetry(
          () => connection.getLatestBlockhash("confirmed"),
          { label: "blockhash read" },
        );
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
        // Re-sending is safe: an identical signed transaction dedups on-cluster.
        const signature = await withRetry(
          () => connection.sendRawTransaction(signed.serialize()),
          { label: "ATA prepare send" },
        );
        await withRetry(
          () =>
            connection.confirmTransaction(
              { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
              "confirmed",
            ),
          { label: "ATA prepare confirm" },
        );
      } catch (err) {
        const reason = describeWalletError(
          err as { name?: string; message?: string } | null,
        );
        setSwapWarning(
          `Prepare step failed: ${reason} Nothing was swapped, your funds are safe. Press "Execute ${quote.legs.length} swap legs" to retry.`,
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
        // Re-sending is safe: an identical signed transaction dedups on-cluster.
        const signature = await withRetry(
          () => connection.sendRawTransaction(signed.serialize()),
          { label: `swap leg ${i + 1} send` },
        );
        const confirmed = await withRetry(
          () => connection.confirmTransaction(signature, "confirmed"),
          { label: `swap leg ${i + 1} confirm` },
        );
        if (confirmed.value.err) throw new Error(`leg ${i + 1} failed on-chain`);
        setLegStates((prev) => prev.map((s, j) => (j === i ? "confirmed" : s)));
      } catch (err) {
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        const reason = describeWalletError(
          err as { name?: string; message?: string } | null,
        );
        setSwapWarning(
          `Leg ${i + 1} did not complete: ${reason} The zap is sequential and non-atomic — you may be holding intermediate tokens. No funds are lost, but continuing requires extra transactions.`,
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
          const res = await withRetryOnce(
            () => connection.getTokenAccountBalance(deriveAta(publicKey, new PublicKey(mint))),
            "token balance read",
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
      keys: coreKeys!,
      amounts: received,
      vaultBalances: vaultBalances.map((v) => v ?? 0n),
    });
    setExpectedAccounts(built.expectedAccounts);
    setOpen(true);
  }, [connection, detail, publicKey, coreKeys, vaultBalances]);

  const close = () => {
    setOpen(false);
    // Once a signature exists the tx is sent — closing only hides the UI; the
    // confirmation keeps running and the page-level banner reports the outcome.
    if (!flow.state.signature) flow.reset();
  };

  /**
   * Start (or Retry) the closing mint. Re-invocable after a failure: the
   * lookup table is cached and re-verified on-chain, so a retry never re-asks
   * approvals for an existing table. Shares the background pre-warm's
   * preparation — no duplicate approvals.
   */
  const startMint = () => {
    if (!publicKey || !coreKeys || !mintAmounts) return;
    const parsed = mintAmounts;
    void flow.run(
      async () => {
        if (!needsAlt) {
          return buildMintInKind({
            keys: coreKeys,
            amounts: parsed,
            vaultBalances: vaultBalances.map((v) => v ?? 0n),
          }).instructions;
        }
        const table = await prewarm.ensureAlt();
        return buildMintInKindTransaction({
          connection,
          keys: coreKeys,
          amounts: parsed,
          vaultBalances: vaultBalances.map((v) => v ?? 0n),
          lookupTableAddresses: [table],
        });
      },
      needsAlt ? () => prewarm.ensureAlt() : undefined,
      {
        onComplete: () => onSuccess?.(),
        describe: {
          kind: "buy",
          label: "buy",
          successLine:
            quote && /^\d+$/.test(quote.expectedShares?.trim() ?? "")
              ? `🎉 Done — +${grouped(formatRawShares6(BigInt(quote.expectedShares!.trim())))} shares`
              : "🎉 Done",
          actionHref: "/portfolio",
          actionLabel: "View Portfolio",
        },
      },
    );
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Zap USDC</CardTitle>
        <CardDescription className="text-xs">
          Split USDC across the target weights via Jupiter, then mint in-kind with what arrives.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
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
              className="h-9 w-40 rounded-md border border-border bg-background px-3 font-mono text-sm tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring"
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
              className="h-9 w-24 rounded-md border border-border bg-background px-3 font-mono text-sm tabular-nums outline-none focus:border-ring"
            />
          </div>
          <Button
            onClick={() => void getQuote()}
            disabled={!amountRaw || slippage === null || phase === "quoting"}
            className="mt-5"
          >
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
          <>
            {/* Six data columns — scroll horizontally on phones instead of
                clipping (the parent border keeps its rounding while scrolled). */}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[36rem] text-xs">
                <caption className="sr-only">Jupiter quote legs</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="h-9 px-3 font-medium">Leg</th>
                    <th className="h-9 px-3 text-right font-medium">Allocation</th>
                    <th className="h-9 px-3 text-right font-medium">In (USDC raw)</th>
                    <th className="h-9 px-3 text-right font-medium">Expected out</th>
                    <th className="h-9 px-3 text-right font-medium">Impact</th>
                    <th className="h-9 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.legs.map((leg, i) => (
                    <tr key={leg.index} className="h-11 border-b border-border last:border-0">
                      <td className="px-3 font-mono tabular-nums">
                        {truncateAddress(leg.outputMint, 4, 4)}
                        {leg.routeLabels.length ? (
                          <span className="ml-2 text-muted-foreground">via {leg.routeLabels.join(" → ")}</span>
                        ) : null}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {leg.allocationBps !== null ? `${leg.allocationBps} bps` : "—"}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">{leg.inAmount}</td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {leg.expectedOutAmount ?? leg.note ?? "—"}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {leg.priceImpactPct ?? "—"}
                      </td>
                      <td className="px-3 font-mono tabular-nums text-muted-foreground">
                        {legStates[i]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* provenance + backend warning — one quiet note, always inline for zap quotes */}
            <div
              role="note"
              className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"
            >
              <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                <FreshnessBadge source={quote.provenance.source} asOf={quote.provenance.asOf} />
                <span>slippage {quote.provenance.slippageBps} bps</span>
                {quote.expectedShares ? (
                  <span>est. {formatRawShares6(BigInt(quote.expectedShares))} shares</span>
                ) : (
                  <span className="font-sans">no indexed supply — no share estimate</span>
                )}
              </div>
              <p>{quote.warning}</p>
              <p className="font-mono text-[11px]">{quote.mintAccountsNote}</p>
            </div>

            {swapWarning ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
              >
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
                Buy with received tokens
              </Button>
            </div>
            {connected && !signTransaction ? (
              <p role="alert" className="text-xs text-muted-foreground">
                This wallet cannot sign the Jupiter swap transactions.
              </p>
            ) : null}
          </>
        ) : null}

        <TxReviewModal
          open={open}
          onClose={close}
          title={`Buy ${basketName(detail) ?? "basket"} with USDC`}
          description="One press: we check the mint on-chain first, then your wallet opens for a single approval."
          accounts={expectedAccounts ?? []}
          summary={
            <TxSummaryCard>
              <SummaryRow
                label="You deposit"
                value={
                  mintAmounts
                    ? detail.constituents
                        .map((mint, i) => {
                          const holding = detail.holdings.find((h) => h.mint === mint);
                          const scaled = scaledFromRaw(
                            mintAmounts[i] ?? 0n,
                            Number(holding?.multiplier ?? 1),
                            holding?.decimals ?? 6,
                          );
                          return `${tickers?.get(mint) ?? truncateAddress(mint, 4, 4)} ${grouped(scaled)}`;
                        })
                        .join(" · ")
                    : "—"
                }
              />
              {quote?.expectedShares && /^\d+$/.test(quote.expectedShares.trim()) ? (
                <SummaryRow
                  label="You receive"
                  emphasis
                  value={`≈${grouped(formatRawShares6(BigInt(quote.expectedShares.trim())))} shares (after ${bpsToPct(detail.entry_fee_bps)} entry fee)`}
                />
              ) : null}
              <SummaryRow
                label="Fees"
                muted
                value={`${feesLine(detail.entry_fee_bps, detail.exit_fee_bps, detail.management_fee_bps)} (90% supports the creator)`}
              />
            </TxSummaryCard>
          }
          flowState={flow.state}
          onConfirm={startMint}
          onRetry={startMint}
          confirmLabel="Buy shares"
          endpoint={RPC_ENDPOINT}
          pendingTxId={flow.state.pendingTxId}
          successLine={
            quote && /^\d+$/.test(quote.expectedShares?.trim() ?? "")
              ? `🎉 Done — +${grouped(formatRawShares6(BigInt(quote.expectedShares!.trim())))} shares`
              : "🎉 Done"
          }
          successExtra={
            flow.state.status === "confirmed" ? (
              <ThesisShareCta basket={detail.pubkey} basketName={basketName(detail)} />
            ) : undefined
          }
          setupProgress={prewarm.setupProgress}
          errorSlot={
            flow.state.mintPaused ? (
              <div
                role="alert"
                className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed"
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
      </CardContent>
    </Card>
  );
}
