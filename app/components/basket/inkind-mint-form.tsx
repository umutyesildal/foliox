"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
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
  deriveAta,
  type ExpectedAccount,
} from "@/lib/transactions";
import { scaledFromRaw, truncateAddress } from "@/lib/format";
import { RPC_ENDPOINT } from "@/lib/wallet";

/**
 * In-kind mint: per-constituent RAW deposit inputs with live, exact-BigInt
 * replication of the program's WeightMismatch check (min(D·S/V) with the 1%
 * tolerance), scaled display, entry-fee/net-share preview, balance checks, and
 * the review → simulate → sign flow.
 */
export function InKindMintForm({
  detail,
  vaultBalances,
}: {
  detail: BasketDetail;
  /** Raw vault balance per constituent (null when the holding is not indexed). */
  vaultBalances: (bigint | null)[];
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
          const res = await connection.getTokenAccountBalance(ata);
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

  const gross = check?.ok ? check.gross : null;
  const entryFee = gross !== null ? entryFeeOf(gross, detail.entry_fee_bps) : null;
  const net = gross !== null && entryFee !== null ? gross - entryFee : null;

  const offTolerance = check?.ok ? offToleranceLegs(check.perLeg) : [];
  const weightError = !check?.ok && check ? check.error : null;

  const canReview =
    connected &&
    balances !== null &&
    allFilled &&
    check?.ok === true &&
    balanceErrors.every((e) => e === null);

  const openReview = () => {
    if (!publicKey || !check?.ok) return;
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
      keys: {
        basket: new PublicKey(detail.pubkey),
        factory: new PublicKey(detail.factory),
        creator: new PublicKey(detail.creator),
        treasury: new PublicKey(detail.treasury),
        shareMint: new PublicKey(detail.share_mint),
        constituents: detail.constituents,
        user: publicKey,
      },
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
    flow.reset();
  };

  if (missingVault || supply === null) {
    return (
      <EmptyState
        chip="NO SNAPSHOT"
        title="Vault ratios are not indexed yet"
        description="The in-kind form replicates the on-chain weight check from indexed vault holdings and supply. This basket has no complete holdings snapshot yet, so no deposit can be validated — nothing is guessed."
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
                <div className="flex h-11 items-center gap-4">
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
                    onChange={(e) =>
                      setInputs((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                    }
                    className="h-8 w-44 rounded-md border border-border bg-background px-3 font-mono text-xs tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring"
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Anchor on the largest filled leg; every other leg follows the vault ratio.
              const best = amounts.reduce<number>(
                (best, a, i) => (a !== null && a > (amounts[best] ?? 0n) ? i : best),
                -1,
              );
              if (best === -1) return;
              const proportional = proportionalDeposits(amounts as bigint[], vaultsForCheck, best);
              setInputs(proportional.map((a) => (a > 0n ? a.toString() : "")));
            }}
          >
            Fill proportional
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refreshBalances()}>
            Refresh balances
          </Button>
        </div>

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
          <Button onClick={openReview} disabled={!canReview}>
            Review &amp; mint
          </Button>
          {!connected ? (
            <span className="text-xs text-muted-foreground">Connect a wallet to mint.</span>
          ) : null}
        </div>

        <TxReviewModal
          open={open}
          onClose={close}
          title="Review in-kind mint"
          description="mint_in_kind — the entry fee splits 90/10 to creator/treasury; net shares mint to your wallet."
          accounts={[...(createAccounts ?? []), ...(expectedAccounts ?? [])]}
          summary={
            <dl className="grid gap-1 font-mono text-xs tabular-nums">
              {detail.constituents.map((mint, i) => (
                <div key={mint} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">
                    deposit[{i}] {truncateAddress(mint, 4, 4)}
                  </dt>
                  <dd>{amounts[i]?.toString() ?? "—"}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">gross shares</dt>
                <dd>{gross !== null ? `${gross} raw` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">entry fee ({detail.entry_fee_bps} bps)</dt>
                <dd>{entryFee !== null ? `${entryFee} raw` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">net shares</dt>
                <dd>{net !== null ? `${net} raw` : "—"}</dd>
              </div>
            </dl>
          }
          flowState={flow.state}
          onConfirm={() => {
            if (!publicKey || !check?.ok) return;
            void flow.run(() => [
              ...createIxs,
              ...buildMintInKind({
                keys: {
                  basket: new PublicKey(detail.pubkey),
                  factory: new PublicKey(detail.factory),
                  creator: new PublicKey(detail.creator),
                  treasury: new PublicKey(detail.treasury),
                  shareMint: new PublicKey(detail.share_mint),
                  constituents: detail.constituents,
                  user: publicKey,
                },
                amounts: amounts as bigint[],
                vaultBalances: vaultsForCheck,
              }).instructions,
            ]);
          }}
          confirmLabel="Simulate & sign"
          endpoint={RPC_ENDPOINT}
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
