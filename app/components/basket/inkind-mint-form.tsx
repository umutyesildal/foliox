"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { useAltPrewarm } from "@/components/basket/use-alt-prewarm";
import {
  bpsToPct,
  feesLine,
  grouped,
  SummaryRow,
  TxSummaryCard,
} from "@/components/basket/summary-card";
import {
  checkGrossShares,
  entryFeeOf,
  formatRawShares6,
  offToleranceLegs,
  parseRawInput,
  proportionalDeposits,
} from "@/components/basket/basket-math";
import type { BasketDetail } from "@/components/basket/basket-api";
import {
  buildCreateAtaInstructions,
  buildMintInKind,
  buildMintInKindTransaction,
  deriveAta,
  type BasketCoreKeys,
  type ExpectedAccount,
} from "@/lib/transactions";
import { scaledFromRaw, truncateAddress } from "@/lib/format";
import { withRetryOnce } from "@/lib/rpc-retry";
import { CLUSTER, RPC_ENDPOINT } from "@/lib/wallet";

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

/**
 * In-kind mint: per-constituent RAW deposit inputs with live, exact-BigInt
 * replication of the program's WeightMismatch check (min(D·S/V) with the 1%
 * tolerance), scaled display, entry-fee/net-share preview, balance checks, and
 * the review → simulate → sign flow. The basket's lookup table is prepared in
 * the background on form open (one-time setup), so a confirmed trade after the
 * first is a single approval.
 */
export function InKindMintForm({
  detail,
  vaultBalances,
  tickers,
  onSuccess,
}: {
  detail: BasketDetail;
  /** Raw vault balance per constituent (null when the holding is not indexed). */
  vaultBalances: (bigint | null)[];
  /** Mint → ticker map (page API data) for the human-language review card. */
  tickers?: Map<string, string>;
  /** Called after a confirmed mint so the page can refetch detail/holdings. */
  onSuccess?: () => void;
}) {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const flow = useTransactionFlow();
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<string[]>(() => detail.constituents.map(() => ""));
  const [balances, setBalances] = useState<(bigint | null)[] | null>(null);
  const [expectedAccounts, setExpectedAccounts] = useState<ExpectedAccount[] | null>(null);
  const [createAccounts, setCreateAccounts] = useState<ExpectedAccount[]>([]);
  const [createIxs, setCreateIxs] = useState<ReturnType<typeof buildCreateAtaInstructions>>([]);
  /** Inline note from the Fill proportional handler (honest fallbacks only). */
  const [fillNote, setFillNote] = useState<string | null>(null);

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

  // One-time basket account (lookup table) preparation — starts now, quietly,
  // so Confirm later needs only the main approval.
  const prewarm = useAltPrewarm(coreKeys);
  const { needsAlt } = prewarm;

  const supply = useMemo(() => {
    const raw = detail.nav?.supply;
    if (!raw || !/^\d+$/.test(raw.trim())) return null;
    return BigInt(raw.trim());
  }, [detail.nav?.supply]);

  const holdings = useMemo(() => {
    const byMint = new Map(detail.holdings.map((h) => [h.mint, h]));
    return detail.constituents.map((mint) => byMint.get(mint) ?? null);
  }, [detail]);

  const missingVault = vaultBalances.some((v) => v === null);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;
    const results = await Promise.all(
      detail.constituents.map(async (mint) => {
        try {
          const ata = deriveAta(publicKey, new PublicKey(mint));
          // Background page read: one calm retry through the shared loop
          // before the "no ATA / zero balance" fallback.
          const res = await withRetryOnce(
            () => connection.getTokenAccountBalance(ata),
            "token balance read",
          );
          return BigInt(res.value.amount);
        } catch {
          return null; // ATA does not exist — treated as zero balance below
        }
      }),
    );
    setBalances(results);
  }, [connection, detail.constituents, publicKey]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  const amounts = inputs.map((input) => parseRawInput(input));
  const allFilled = amounts.every((a) => a !== null && a > 0n);
  const vaultsForCheck = vaultBalances.map((v) => v ?? 0n);
  const check =
    allFilled && supply !== null && !missingVault
      ? checkGrossShares(amounts as bigint[], vaultsForCheck, supply)
      : null;

  const balanceErrors = amounts.map((amount, i) => {
    if (amount === null) return null;
    if (balances === null) return "Checking balance…";
    const balance = balances[i] ?? 0n;
    if (balance < amount) {
      return balances[i] === null
        ? "You have no ATA for this token — you hold no position."
        : "Raw amount exceeds your balance.";
    }
    return null;
  });

  // One honest devnet line when any leg lacks an ATA (holds no position):
  // the repo's own faucet funds every mock mint, so say how instead of
  // leaving the user stuck.
  const showFaucetHint =
    CLUSTER === "devnet" &&
    connected &&
    balances !== null &&
    balances.some((b) => b === null);

  const gross = check?.ok ? check.gross : null;
  const entryFee = gross !== null ? entryFeeOf(gross, detail.entry_fee_bps) : null;
  const net = gross !== null && entryFee !== null ? gross - entryFee : null;

  // Plain-language review-card helpers: pretty tickers (page API data, short
  // mint prefix fallback) and whole-token amounts — never raw base units.
  const name = basketName(detail);
  const tickerOf = (mint: string): string =>
    tickers?.get(mint) ?? truncateAddress(mint, 4, 4);
  const successLineText =
    net !== null
      ? `🎉 Done — +${grouped(formatRawShares6(net))} shares${name ? ` of ${name}` : ""}`
      : "🎉 Done";
  const depositLine = check?.ok
    ? (amounts as bigint[])
        .map((amount, i) => {
          const holding = holdings[i];
          const scaled = scaledFromRaw(
            amount,
            Number(holding?.multiplier ?? 1),
            holding?.decimals ?? 6,
          );
          return `${tickerOf(detail.constituents[i])} ${grouped(scaled)}`;
        })
        .join(" · ")
    : null;

  // After a successful buy the form resets — the next buy starts clean (the
  // balance refresh itself is hooked into the flow's onComplete above).
  const justConfirmed = flow.state.status === "confirmed";
  useEffect(() => {
    if (!justConfirmed) return;
    setInputs(detail.constituents.map(() => ""));
    setFillNote(null);
  }, [justConfirmed, detail.constituents]);

  const offTolerance = check?.ok ? offToleranceLegs(check.perLeg) : [];
  const weightError = !check?.ok && check ? check.error : null;

  const canReview =
    connected &&
    balances !== null &&
    allFilled &&
    check?.ok === true &&
    balanceErrors.every((e) => e === null);

  const openReview = () => {
    if (!publicKey || !coreKeys || !check?.ok) return;
    const parsed = amounts as bigint[];
    // Missing user ATAs are created idempotently in the same tx (rent disclosed).
    const missingAtaIndices: number[] = [];
    detail.constituents.forEach((mint, i) => {
      if ((balances?.[i] ?? null) === null) missingAtaIndices.push(i);
    });
    const preIxs = missingAtaIndices.map((i) =>
      buildCreateAtaInstructions(publicKey, publicKey, [new PublicKey(detail.constituents[i])]),
    ).flat();
    const built = buildMintInKind({
      keys: coreKeys,
      amounts: parsed,
      vaultBalances: vaultsForCheck,
    });
    setCreateIxs(preIxs);
    setCreateAccounts(
      missingAtaIndices.map((i) => ({
        label: `user_ata[${i}] (create)`,
        pubkey: deriveAta(publicKey, new PublicKey(detail.constituents[i])),
        note: "Created idempotently in the same tx — you pay ATA rent",
        writable: true,
      })),
    );
    setExpectedAccounts(built.expectedAccounts);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    // Once a signature exists the tx is sent — closing only hides the UI; the
    // confirmation keeps running and the page-level banner reports the outcome.
    if (!flow.state.signature) flow.reset();
  };

  /**
   * Start (or Retry) the mint flow. Re-invocable after a failure: the lookup
   * table is cached at module level and re-verified on-chain, so a retry
   * resumes from the failed step without re-asking approvals for an existing
   * table. If the background pre-warm is still running, this awaits the SAME
   * preparation — no duplicate approvals.
   */
  const startMint = () => {
    if (!publicKey || !coreKeys || !check?.ok) return;
    const parsed = amounts as bigint[];
    void flow.run(
      async () => {
        if (!needsAlt) {
          // n ≤ 3: legacy wire exactly as before — the flow hook adds
          // the compute-budget instructions.
          return [
            ...createIxs,
            ...buildMintInKind({
              keys: coreKeys,
              amounts: parsed,
              vaultBalances: vaultsForCheck,
            }).instructions,
          ];
        }
        // n ≥ 4: v0 through the wallet-signed lookup table.
        const table = await prewarm.ensureAlt();
        return buildMintInKindTransaction({
          connection,
          keys: coreKeys,
          amounts: parsed,
          vaultBalances: vaultsForCheck,
          preInstructions: createIxs,
          lookupTableAddresses: [table],
        });
      },
      needsAlt ? () => prewarm.ensureAlt() : undefined,
      {
        onComplete: () => {
          void refreshBalances();
          onSuccess?.();
        },
        describe: {
          kind: "buy",
          label: "buy",
          successLine: successLineText,
          actionHref: "/portfolio",
          actionLabel: "View Portfolio",
        },
      },
    );
  };

  /**
   * One click fills EVERY constituent input — never a silent no-op:
   *  1. anchored on the largest typed amount, every leg follows the vault ratio;
   *  2. with nothing typed, the largest proportional fill the wallet can
   *     actually afford (D_i = min_j floor(B_j · V_i / V_j));
   *  3. when ratios are unusable (zero vault leg, rounding collapse, no
   *     balances) — equal raw shares plus an honest inline note.
   */
  const fillProportional = () => {
    setFillNote(null);
    const filledIdx: number[] = [];
    amounts.forEach((a, i) => {
      if (a !== null && a > 0n) filledIdx.push(i);
    });

    if (filledIdx.length > 0) {
      const best = filledIdx.reduce((b, i) =>
        (amounts[i] ?? 0n) > (amounts[b] ?? 0n) ? i : b,
      );
      const proportional = proportionalDeposits(amounts as bigint[], vaultsForCheck, best);
      if (proportional.every((a) => a > 0n)) {
        setInputs(proportional.map((a) => a.toString()));
        return;
      }
      // A proportional leg rounds to zero raw units — fall through to the
      // equal-shares fallback with a note.
    } else if (connected && balances !== null && vaultsForCheck.every((v) => v > 0n)) {
      // No typed anchor: the largest affordable proportional fill. D_i is capped
      // by every leg's balance transposed through the vault ratios, so the fill
      // never exceeds any single balance.
      let bestI = -1;
      let bestDi = 0n;
      vaultsForCheck.forEach((vi, i) => {
        let di = balances[i] ?? 0n;
        vaultsForCheck.forEach((vj, j) => {
          const cap = ((balances[j] ?? 0n) * vi) / vj;
          if (cap < di) di = cap;
        });
        if (di > bestDi) {
          bestDi = di;
          bestI = i;
        }
      });
      if (bestI >= 0 && bestDi > 0n) {
        const anchorVault = vaultsForCheck[bestI];
        const fill = vaultsForCheck.map((vj) => (bestDi * vj) / anchorVault);
        if (fill.every((a) => a > 0n)) {
          setInputs(fill.map((a) => a.toString()));
          return;
        }
      }
      // Balances too small to give every leg at least 1 raw unit — fallback.
    } else {
      // Nothing typed and no balances to scale from (wallet disconnected or
      // still loading) — a nominal, clearly-labelled placeholder instead of a
      // dead button. The review gate re-validates everything anyway.
      setInputs(detail.constituents.map(() => "1000000"));
      setFillNote(
        "No typed amount and no wallet balances to scale from yet — filled every leg with a nominal 1,000,000 raw units. Edit before reviewing.",
      );
      return;
    }

    const positiveBalances = (balances ?? []).filter(
      (b): b is bigint => b !== null && b > 0n,
    );
    const equal =
      positiveBalances.length > 0
        ? positiveBalances.reduce((m, b) => (b < m ? b : m))
        : 1_000_000n;
    setInputs(detail.constituents.map(() => equal.toString()));
    setFillNote(
      vaultsForCheck.some((v) => v === 0n)
        ? "A vault leg holds zero raw units, so proportional ratios are undefined — filled equal raw shares instead. The on-chain mint would abort with ZeroVault."
        : "Vault ratios are too coarse for these amounts (a proportional leg rounds to zero raw units) — filled equal raw shares instead.",
    );
  };

  if (missingVault || supply === null) {
    return (
      <EmptyState
        chip="NO SNAPSHOT"
        title="Vault ratios are not indexed yet"
        description="This basket has no complete holdings snapshot yet, so deposits can't be validated — nothing is guessed."
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Deposit amounts</CardTitle>
        <CardDescription className="text-xs">
          Raw base units per constituent — deposits must track current vault ratios within the 1%
          tolerance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border">
          {detail.constituents.map((mint, i) => {
            const holding = holdings[i];
            const multiplier = Number(holding?.multiplier ?? 1);
            const decimals = holding?.decimals ?? 6;
            const raw = amounts[i];
            const balance = balances?.[i];
            return (
              <li key={mint} className="py-1.5">
                {/* Wraps on phones: ticker + input on the first line, scaled
                    amount and wallet balance flow to the next — no clipping. */}
                <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 py-1">
                  <label
                    htmlFor={`inkind-${i}`}
                    className="w-24 shrink-0 truncate font-mono text-xs tabular-nums"
                    title={mint}
                  >
                    {truncateAddress(mint, 6, 6)}
                  </label>
                  <input
                    id={`inkind-${i}`}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="raw amount"
                    value={inputs[i]}
                    onChange={(e) => {
                      setFillNote(null);
                      setInputs((prev) => prev.map((v, j) => (j === i ? e.target.value : v)));
                    }}
                    className="h-9 w-44 rounded-md border border-border bg-background px-3 font-mono text-xs tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring"
                    aria-invalid={balanceErrors[i] !== null}
                  />
                  <span
                    className="ml-auto font-mono text-xs tabular-nums text-muted-foreground"
                    aria-live="polite"
                  >
                    {raw !== null ? scaledFromRaw(raw, multiplier, decimals) : "—"}
                  </span>
                  <span
                    className="w-32 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground"
                    title={mint}
                  >
                    {balance === undefined
                      ? "…"
                      : balance === null
                        ? "no ATA"
                        : `${balance} raw`}
                  </span>
                </div>
                {balanceErrors[i] ? (
                  <p role="alert" className="pb-1 text-xs text-destructive">
                    {balanceErrors[i]}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fillProportional}>
            Fill proportional
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refreshBalances()}>
            Refresh balances
          </Button>
        </div>

        {fillNote ? (
          <p role="note" className="text-xs leading-5 text-muted-foreground">
            {fillNote}
          </p>
        ) : null}

        {showFaucetHint ? (
          <p className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
            Devnet test tokens: run{" "}
            <code className="break-all rounded bg-background px-1 py-0.5 font-mono text-[11px]">
              npx tsx scripts/faucet.ts --to {publicKey?.toBase58() ?? "<YOUR_WALLET>"}
            </code>{" "}
            in the repo, then Refresh balances.
          </p>
        ) : null}

        {/* live weight-check report — thin per-leg bar + one line */}
        <div aria-live="polite" className="space-y-2">
          {check?.ok ? (
            <div className="flex h-1 gap-px overflow-hidden rounded-full" aria-hidden="true">
              {check.perLeg.map((g, i) => {
                const max = check.perLeg.reduce((m, x) => (x > m ? x : m), check.gross);
                const pct = max > 0n ? Number((g * 100n) / max) : 0;
                const off = offTolerance.includes(i);
                return (
                  <div key={i} className="h-1 flex-1 bg-muted">
                    <div
                      className={`h-1 rounded-full ${off ? "bg-foreground" : "bg-foreground/70"}`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
          {!allFilled ? (
            <p className="text-xs text-muted-foreground">
              Enter an amount for every constituent to validate the ratio.
            </p>
          ) : check?.ok ? (
            <p className="text-xs text-muted-foreground">
              Within the 1% tolerance — leg {check.limitingIndex + 1} is limiting.
            </p>
          ) : (
            <p role="alert" className="text-xs text-destructive">
              {weightError?.kind === "WeightMismatch"
                ? `WeightMismatch — deposits exceed the 1% tolerance. Leg ${
                    weightError.minIndex + 1
                  } is limiting${offTolerance.length ? `; off-tolerance: ${offTolerance.map((i) => i + 1).join(", ")}` : ""}.`
                : weightError?.kind === "ZeroAmount"
                  ? "Every leg needs an amount greater than zero."
                  : weightError?.kind === "ZeroVault"
                    ? `Vault leg ${weightError.index + 1} holds zero raw units — mint against it is impossible.`
                    : "The deposit does not produce shares (ZeroShares)."}
            </p>
          )}
        </div>

        {check?.ok ? (
          <dl className="grid gap-1 rounded-md border border-border p-3 font-mono text-xs tabular-nums">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">gross shares</dt>
              <dd>{formatRawShares6(check.gross)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">entry fee · {detail.entry_fee_bps} bps</dt>
              <dd>−{formatRawShares6(entryFee ?? 0n)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">net shares</dt>
              <dd className="font-medium text-foreground">{formatRawShares6(net ?? 0n)}</dd>
            </div>
          </dl>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={openReview} disabled={!canReview} data-testid="buy-trigger">
            Buy shares
          </Button>
          {!connected ? (
            <span className="text-xs text-muted-foreground">Connect a wallet to buy.</span>
          ) : null}
        </div>

        {/* one-time basket setup — chip while preparing, explainer line after */}
        {needsAlt && connected ? (
          <p
            data-testid="alt-prewarm"
            aria-live="polite"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            {prewarm.status === "preparing" ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                />
                {prewarm.awaitingWallet
                  ? "Setup — approve in your wallet…"
                  : "Preparing your basket account… one-time setup"}
              </>
            ) : prewarm.status === "failed" ? (
              "One-time setup will be requested with your first trade — every trade after that is a single click."
            ) : (
              "One-time setup for this basket: you may approve 1–2 setup transactions; every trade after this is a single click."
            )}
          </p>
        ) : null}

        <TxReviewModal
          open={open}
          onClose={close}
          title={`Buy ${name ?? "basket"}`}
          description="One press: we check the transaction on-chain first, then your wallet opens for a single approval."
          accounts={[...(createAccounts ?? []), ...(expectedAccounts ?? [])]}
          summary={
            <TxSummaryCard>
              <SummaryRow
                label="You deposit"
                value={depositLine ?? "—"}
              />
              <SummaryRow
                label="You receive"
                emphasis
                value={
                  net !== null
                    ? `≈${grouped(formatRawShares6(net))} shares (after ${bpsToPct(detail.entry_fee_bps)} entry fee)`
                    : "—"
                }
              />
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
          successLine={successLineText}
          setupProgress={prewarm.setupProgress}
          errorSlot={
            flow.state.mintPaused ? (
              <div
                role="alert"
                className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed"
              >
                <p className="font-medium">MintPaused — the on-chain whitelist gate stopped this mint</p>
                <p className="mt-1 text-muted-foreground">
                  One of the basket&apos;s constituents is set to <span className="font-mono">PausedNewMints</span>{" "}
                  in the whitelist program, which blocks new mints before any token moves. Nothing was
                  signed. Redeem is never affected by this pause.
                </p>
              </div>
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
}
