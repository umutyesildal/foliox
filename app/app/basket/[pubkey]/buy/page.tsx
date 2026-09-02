"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, ErrorState, FreshnessBadge, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { InKindMintForm } from "@/components/basket/inkind-mint-form";
import { ZapInForm } from "@/components/basket/zap-in-form";
import {
  ApiError,
  fetchBasketDetail,
  type BasketDetail,
} from "@/components/basket/basket-api";
import { truncateAddress } from "@/lib/format";

type Tab = "inkind" | "zap";

/**
 * Buy — transaction workspace with two paths: In-Kind (raw per-constituent
 * deposits, the core protocol path) and Zap USDC (Jupiter periphery, backend
 * quotes only, sequential client-side swaps). Detail/holdings are fetched from
 * the indexer with an abortable client fetch.
 */
export default function BuyPage({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey: rawPubkey } = use(params);
  const pubkey = decodeURIComponent(rawPubkey);

  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not-found" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>("inkind");
  const TAB_ORDER: Tab[] = ["inkind", "zap"];
  const tablistRef = useRef<HTMLDivElement | null>(null);

  // Roving-focus keyboard support for the tablist (APG tabs pattern).
  const handleTabArrowKeys = useCallback((event: React.KeyboardEvent) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const current = TAB_ORDER.indexOf(tab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % TAB_ORDER.length;
    if (event.key === "ArrowLeft") next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TAB_ORDER.length - 1;
    setTab(TAB_ORDER[next]);
    const tabs = tablistRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[next]?.focus();
  }, [tab]);

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

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // Vault raw balances aligned to constituents order (null = not indexed).
  const vaultBalances = useMemo<(bigint | null)[]>(() => {
    if (!detail) return [];
    const byMint = new Map(detail.holdings.map((h) => [h.mint, h.raw_amount]));
    return detail.constituents.map((mint) => {
      const raw = byMint.get(mint);
      return raw && /^\d+$/.test(raw.trim()) ? BigInt(raw.trim()) : null;
    });
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
        <span>buy</span>
      </nav>

      {status === "loading" ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {status === "not-found" ? (
        <EmptyState
          chip="NOT INDEXED"
          title="This basket is not indexed"
          description="There is nothing to buy here — the backend has no basket at this address."
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
            <h1 className="text-3xl font-semibold tracking-tight">Buy shares</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Mint basket shares with the underlying xStocks (core path) or zap USDC through
              Jupiter (periphery). Shares are minted net of the entry fee
              {" "}{detail.entry_fee_bps} bps.
            </p>
            <FreshnessBadge
              source={detail.source}
              asOf={detail.nav?.asOf ?? detail.asOf ?? undefined}
            />
          </div>

          <div
            ref={tablistRef}
            role="tablist"
            aria-label="Buy method"
            className="flex w-fit items-center gap-1 rounded-md border border-border bg-card p-1"
          >
            <TabButton
              id="buy-tab-inkind"
              panelId="buy-panel-inkind"
              active={tab === "inkind"}
              onChangeTab={() => setTab("inkind")}
              onArrowKeyDown={handleTabArrowKeys}
              tabIndex={tab === "inkind" ? 0 : -1}
            >
              In-Kind
            </TabButton>
            <TabButton
              id="buy-tab-zap"
              panelId="buy-panel-zap"
              active={tab === "zap"}
              onChangeTab={() => setTab("zap")}
              onArrowKeyDown={handleTabArrowKeys}
              tabIndex={tab === "zap" ? 0 : -1}
            >
              Zap USDC
            </TabButton>
          </div>

          <div
            role="tabpanel"
            id="buy-panel-inkind"
            aria-labelledby="buy-tab-inkind"
            tabIndex={0}
            hidden={tab !== "inkind"}
          >
            {tab === "inkind" ? (
              <InKindMintForm detail={detail} vaultBalances={vaultBalances} />
            ) : null}
          </div>
          <div
            role="tabpanel"
            id="buy-panel-zap"
            aria-labelledby="buy-tab-zap"
            tabIndex={0}
            hidden={tab !== "zap"}
          >
            {tab === "zap" ? (
              <ZapInForm detail={detail} vaultBalances={vaultBalances} />
            ) : null}
          </div>
        </>
      ) : null}

    </div>
  );
}

function TabButton({
  id,
  panelId,
  active,
  onChangeTab,
  onArrowKeyDown,
  tabIndex,
  children,
}: {
  id: string;
  panelId: string;
  active: boolean;
  onChangeTab: () => void;
  onArrowKeyDown: (event: React.KeyboardEvent) => void;
  tabIndex: 0 | -1;
  children: string;
}) {
  return (
    <button
      role="tab"
      id={id}
      type="button"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={tabIndex}
      onClick={onChangeTab}
      onKeyDown={onArrowKeyDown}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
