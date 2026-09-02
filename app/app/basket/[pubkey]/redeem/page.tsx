"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import {
  EmptyState,
  ErrorState,
  FreshnessBadge,
  Skeleton,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { SiteFooter } from "@/components/shell";
import { AccrueCrankButton } from "@/components/basket/accrue-crank";
import { computeRedeemPreview, formatRawShares6, parseRawInput } from "@/components/basket/basket-math";
import {
  ApiError,
  fetchBasketDetail,
  numericToNumber,
  type BasketDetail,
} from "@/components/basket/basket-api";
import {
  buildRedeemInKind,
  deriveAta,
  type ExpectedAccount,
} from "@/lib/transactions";
import { formatUsd, scaledFromRaw, truncateAddress } from "@/lib/format";
import { RPC_ENDPOINT } from "@/lib/wallet";

/**
 * Redeem — burns basket shares and returns the underlying pro-rata, floored to
 * the raw token unit. The on-chain instruction is permissionless and
 * oracle-free: no whitelist, no pause, no backend account participates. This
 * page only previews and submits; it never gates redeem on any of them.
 */
export default function RedeemPage({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey: rawPubkey } = use(params);
  const pubkey = decodeURIComponent(rawPubkey);

  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const flow = useTransactionFlow();

  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not-found" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sharesInput, setSharesInput] = useState("");
  const [shareBalance, setShareBalance] = useState<bigint | null>(null);
  const [expectedAccounts, setExpectedAccounts] = useState<ExpectedAccount[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setErrorInfo(null);
    async function load() {
      try {
        const loaded = await fetchBasketDetail(pubkey, controller.signal);
        setDetail(loaded);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError && err.status === 404) {
          setStatus("not-found");
          return;
        }
        setErrorInfo({
          message: err instanceof Error ? err.message : "Could not reach the basket API.",
          code: err instanceof ApiError ? err.code : undefined,
        });
        setStatus("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [pubkey, reloadKey]);

  const refreshShareBalance = useCallback(async () => {
    if (!publicKey || !detail) return;
    try {
      const res = await connection.getTokenAccountBalance(
        deriveAta(publicKey, new PublicKey(detail.share_mint)),
      );
      setShareBalance(BigInt(res.value.amount));
    } catch {
      setShareBalance(null); // no share ATA — user holds no position
    }
  }, [connection, detail, publicKey]);

  useEffect(() => {
    void refreshShareBalance();
  }, [refreshShareBalance]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // holdings aligned to constituents; supply from the latest NAV snapshot
  const vaultBalances = useMemo<(bigint | null)[]>(() => {
    if (!detail) return [];
    const byMint = new Map(detail.holdings.map((h) => [h.mint, h.raw_amount]));
    return detail.constituents.map((mint) => {
      const raw = byMint.get(mint);
      return raw && /^\d+$/.test(raw.trim()) ? BigInt(raw.trim()) : null;
    });
  }, [detail]);

  const supply = useMemo(() => {
    const raw = detail?.nav?.supply;
    return raw && /^\d+$/.test(raw.trim()) ? BigInt(raw.trim()) : null;
  }, [detail?.nav?.supply]);

  const shares = parseRawInput(sharesInput);
  // No share ATA means zero redeemable shares — treat null as 0.
  const sharesExceedBalance =
    shares !== null && (shareBalance ?? 0n) < shares;
  const preview =
    shares !== null && shares > 0n && supply !== null && !vaultBalances.some((v) => v === null)
      ? computeRedeemPreview(vaultBalances as bigint[], supply, shares, detail?.exit_fee_bps ?? 0)
      : null;

  // NAV reference estimate: burn / supply × latest NAV (marked as estimate).
  const nav = numericToNumber(detail?.nav?.value ?? null);
  const usdEstimate =
    preview && supply !== null && nav !== null && supply > 0n
      ? (Number(preview.burn) / Number(supply)) * nav
      : null;

  const lastAccrualSeconds = numericToNumber(detail?.last_fee_accrual_ts ?? null);
  const secondsSinceAccrual =
    lastAccrualSeconds !== null && lastAccrualSeconds > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - lastAccrualSeconds)
      : null;
  const accrualStale = secondsSinceAccrual !== null && secondsSinceAccrual > 86400;

  const openReview = () => {
    if (!publicKey || !detail || shares === null || preview === null) return;
    const built = buildRedeemInKind({
      keys: {
        basket: new PublicKey(detail.pubkey),
        factory: new PublicKey(detail.factory),
        creator: new PublicKey(detail.creator),
        treasury: new PublicKey(detail.treasury),
        shareMint: new PublicKey(detail.share_mint),
        constituents: detail.constituents,
        user: publicKey,
      },
      sharesToBurn: shares,
      vaultBalances: vaultBalances as bigint[],
    });
    setExpectedAccounts(built.expectedAccounts);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    flow.reset();
  };

  const holdingsAligned = useMemo(() => {
    if (!detail) return [];
    const byMint = new Map(detail.holdings.map((h) => [h.mint, h]));
    return detail.constituents.map((mint) => byMint.get(mint) ?? null);
  }, [detail]);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/explore" className="underline underline-offset-4 hover:text-foreground">
          Explore
        </Link>
        <span aria-hidden="true"> / </span>
        <Link
          href={`/basket/${pubkey}`}
          className="font-mono tabular-nums underline underline-offset-4 hover:text-foreground"
        >
          {truncateAddress(pubkey, 6, 6)}
        </Link>
        <span aria-hidden="true"> / </span>
        <span>redeem</span>
      </nav>

      {status === "loading" ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {status === "not-found" ? (
        <EmptyState
          chip="NOT INDEXED"
          title="This basket is not indexed"
          description="There is nothing to redeem here — the backend has no basket at this address. The on-chain redeem instruction works over any RPC without the indexer."
          action={
            <Button render={<Link href="/explore" />} size="sm">
              Back to explore
            </Button>
          }
        />
      ) : null}

      {status === "error" ? (
        <ErrorState
          title="Basket unavailable"
          message={
            errorInfo
              ? `${errorInfo.code ? `${errorInfo.code}: ` : ""}${errorInfo.message}`
              : "Could not reach the basket API."
          }
          onRetry={retry}
        />
      ) : null}

      {status === "ready" && detail ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Redeem shares</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Burn shares, receive every underlying xStock pro-rata.{" "}
              <span className="font-mono">
                out = V × (shares − exit fee) / supply
              </span>{" "}
              per constituent, floored to the raw token unit. Exit fee {detail.exit_fee_bps} bps,
              split 90/10 to creator/treasury.
            </p>
            <FreshnessBadge
              source={detail.source}
              asOf={detail.nav?.asOf ?? detail.asOf ?? undefined}
            />
          </div>

          {accrualStale ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <span>
                Management fee last accrued {secondsSinceAccrual !== null ? Math.floor(secondsSinceAccrual / 3600) : "?"}h
                ago — running the crank first keeps the preview supply accurate (it runs inside
                redeem anyway).
              </span>
              <AccrueCrankButton
                basket={detail.pubkey}
                factory={detail.factory}
                creator={detail.creator}
                treasury={detail.treasury}
                shareMint={detail.share_mint}
                constituents={detail.constituents}
                secondsSinceAccrual={secondsSinceAccrual}
                variant="ghost"
                quiet
              />
            </div>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Shares to burn</CardTitle>
              <CardDescription className="text-xs">
                Raw base units (share mint has 6 decimals). Max is your share ATA balance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="redeem-shares" className="text-xs font-medium text-muted-foreground">
                    Shares (raw)
                  </label>
                  <input
                    id="redeem-shares"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 1000000"
                    value={sharesInput}
                    onChange={(e) => setSharesInput(e.target.value)}
                    aria-invalid={sharesExceedBalance}
                    className="h-9 w-56 rounded-md border border-border bg-card px-3 font-mono text-sm tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Wallet share balance</span>
                  <span className="font-mono text-sm tabular-nums">
                    {connected
                      ? shareBalance === null
                        ? "no share ATA"
                        : `${shareBalance} raw (${formatRawShares6(shareBalance)})`
                      : "connect a wallet"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!connected || shareBalance === null || shareBalance === 0n}
                  onClick={() => shareBalance !== null && setSharesInput(shareBalance.toString())}
                >
                  Max
                </Button>
              </div>

              {sharesExceedBalance ? (
                <p role="alert" className="text-xs text-destructive">
                  Shares exceed your balance — the program would reject with InsufficientShares.
                </p>
              ) : null}

              {preview && holdingsAligned ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Pro-rata preview (floor)
                  </h3>
                  <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                    {detail.constituents.map((mint, i) => {
                      const holding = holdingsAligned[i];
                      const multiplier = Number(holding?.multiplier ?? 1);
                      const decimals = holding?.decimals ?? 6;
                      const out = preview.outs[i] ?? 0n;
                      return (
                        <li key={mint} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                          <span className="font-mono text-xs tabular-nums">
                            {truncateAddress(mint, 6, 6)}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {out} raw
                            <span className="ml-2 text-foreground">
                              {scaledFromRaw(out, multiplier, decimals)} scaled
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <dl className="grid gap-1 font-mono text-xs tabular-nums text-muted-foreground">
                    <div className="flex justify-between gap-4">
                      <dt>exit fee ({detail.exit_fee_bps} bps, transferred not burned)</dt>
                      <dd>{formatRawShares6(preview.exitFee)} shares</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>burned</dt>
                      <dd>{formatRawShares6(preview.burn)} shares</dd>
                    </div>
                    {usdEstimate !== null ? (
                      <div className="flex justify-between gap-4">
                        <dt>NAV reference estimate</dt>
                        <dd>≈ {formatUsd(usdEstimate)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    Preview uses the last indexed vault holdings and supply; the program accrues
                    the management fee first and re-reads supply, and re-validates every vault
                    balance on-chain.{" "}
                    {usdEstimate !== null
                      ? "The USD figure is a NAV reference estimate, not a quote."
                      : ""}
                  </p>
                </div>
              ) : shares !== null && shares > 0n && (supply === null || vaultBalances.some((v) => v === null)) ? (
                <EmptyState
                  chip="NO SNAPSHOT"
                  title="Preview unavailable"
                  description="This preview replicates the on-chain pro-rata math from indexed vault holdings and supply. This basket has no complete snapshot yet — the on-chain instruction remains available over RPC."
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">What redeem does</CardTitle>
              <CardDescription className="font-mono text-[11px]">
                redeem_in_kind · permissionless · oracle-free
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs leading-relaxed">
              <p>
                No oracle, no whitelist, no pauser and no backend account is part of the
                instruction — redeem works over any RPC even if this indexer is offline. The
                whitelist pause blocks <span className="font-mono">mint</span> only, never redeem.
              </p>
              <p>
                Missing constituent ATAs are created for you inside the transaction (you pay the
                rent). Rounding dust stays in the vault and favors remaining holders.
              </p>
              <p className="rounded-md border border-border/60 bg-muted/40 p-2 text-muted-foreground">
                IRREVERSIBLE — burned shares cannot be re-minted, and the pro-rata underlying is
                transferred immediately on confirmation. Review the account list before signing.
                LEGAL_REVIEW_REQUIRED: not investment advice; xStocks are Backed Finance
                structured instruments carrying issuer, depeg and multiplier risk.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={openReview}
              disabled={
                !connected ||
                shares === null ||
                shares <= 0n ||
                sharesExceedBalance ||
                preview === null
              }
            >
              Review &amp; redeem
            </Button>
            {!connected ? (
              <span className="text-xs text-muted-foreground">Connect a wallet to redeem.</span>
            ) : null}
            {connected && shareBalance === 0n ? (
              <span className="text-xs text-muted-foreground">
                You hold no basket shares yet.
              </span>
            ) : null}
          </div>

          <TxReviewModal
            open={open}
            onClose={close}
            title="Review redeem"
            description="redeem_in_kind — burns your shares and transfers the pro-rata underlying to your wallet. Irreversible once confirmed."
            accounts={expectedAccounts ?? []}
            summary={
              preview ? (
                <dl className="grid gap-1 font-mono text-xs tabular-nums">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">shares burned</dt>
                    <dd>{shares?.toString() ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">exit fee ({detail.exit_fee_bps} bps)</dt>
                    <dd>{preview.exitFee.toString()}</dd>
                  </div>
                  {detail.constituents.map((mint, i) => (
                    <div key={mint} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        out[{i}] {truncateAddress(mint, 4, 4)}
                      </dt>
                      <dd>{(preview.outs[i] ?? 0n).toString()} raw</dd>
                    </div>
                  ))}
                </dl>
              ) : undefined
            }
            flowState={flow.state}
            onConfirm={() => {
              if (!publicKey || !detail || shares === null) return;
              void flow.run(() =>
                buildRedeemInKind({
                  keys: {
                    basket: new PublicKey(detail.pubkey),
                    factory: new PublicKey(detail.factory),
                    creator: new PublicKey(detail.creator),
                    treasury: new PublicKey(detail.treasury),
                    shareMint: new PublicKey(detail.share_mint),
                    constituents: detail.constituents,
                    user: publicKey,
                  },
                  sharesToBurn: shares,
                  vaultBalances: vaultBalances as bigint[],
                }).instructions,
              );
            }}
            confirmLabel="Simulate & sign"
            endpoint={RPC_ENDPOINT}
          />
        </>
      ) : null}

      <SiteFooter />
    </div>
  );
}
