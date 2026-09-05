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
  fetchMintPriceSources,
  fetchMintTickers,
  type BasketDetail,
} from "@/components/basket/basket-api";
import { truncateAddress } from "@/lib/format";

type Tab = "inkind" | "zap";

const MAX_COMPOSITION_PARTS = 4;

/** metadata_json may arrive as object or JSON text — parse defensively. */
function metaName(mj: unknown): string | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const n = (obj as Record<string, unknown>).name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

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
  const [mintTickers, setMintTickers] = useState<Map<string, string>>(new Map());
  const [priceSources, setPriceSources] = useState<Map<string, string>>(new Map());
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

  // Optional ticker context for the composition line — degrades to truncated mints.
  useEffect(() => {
    const controller = new AbortController();
    fetchMintTickers(controller.signal)
      .then(setMintTickers)
      .catch(() => setMintTickers(new Map()));
    return () => controller.abort();
  }, [reloadKey]);

  // Price-source context for the Zap gate — degrades to "unknown" (map empty).
  useEffect(() => {
    const controller = new AbortController();
    fetchMintPriceSources(controller.signal)
      .then(setPriceSources)
      .catch(() => setPriceSources(new Map()));
    return () => controller.abort();
  }, [reloadKey]);

  // Zap USDC honesty gate: Jupiter can never quote `mock:*` devnet mints, so
  // the zap path is disabled up-front (via the API's price_source field)
  // instead of letting every leg fail at quote time. Unknown sources (no
  // whitelist data) do not disable — the quote error then speaks for itself.
  const zapUsdcUnavailable = useMemo(() => {
    if (!detail || priceSources.size === 0) return false;
    return detail.constituents.some(
      (mint) => (priceSources.get(mint) ?? "").startsWith("mock:"),
    );
  }, [detail, priceSources]);

  // Guard in case a keyboard path lands on the disabled tab.
  useEffect(() => {
    if (tab === "zap" && zapUsdcUnavailable) setTab("inkind");
  }, [tab, zapUsdcUnavailable]);

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

  // Name-first identity, same resolution order as the detail page.
  const name = useMemo(() => (detail ? metaName(detail.metadata_json) : null), [detail]);
  const composition = useMemo(() => {
    if (!detail) return null;
    const parts = detail.constituents.map((mint, i) => {
      const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
      const bps = detail.weights_bps[i];
      return bps !== undefined ? `${ticker} ${Math.round(bps / 100)}` : ticker;
    });
    if (parts.length === 0) return null;
    const shown = parts.slice(0, MAX_COMPOSITION_PARTS).join(" · ");
    return parts.length > MAX_COMPOSITION_PARTS
      ? `${shown} · +${parts.length - MAX_COMPOSITION_PARTS}`
      : shown;
  }, [detail, mintTickers]);
  const headline = name ?? composition ?? truncateAddress(pubkey, 6, 6);

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
          {/* compact identity header — name + composition, detail via the breadcrumb */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-3xl font-semibold tracking-tight" title={detail.pubkey}>
                {headline}
              </h1>
              {name && composition ? (
                <p className="font-mono text-xs tabular-nums text-muted-foreground">{composition}</p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Mint shares against the underlying xStocks or zap in with USDC — net of the{" "}
                <span className="font-mono tabular-nums">
                  {(detail.entry_fee_bps / 100).toFixed(2)}%
                </span>{" "}
                entry fee.
              </p>
            </div>
            <FreshnessBadge
              source={detail.source}
              asOf={detail.nav?.asOf ?? detail.asOf ?? undefined}
            />
          </div>

          <div
            ref={tablistRef}
            role="tablist"
            aria-label="Buy method"
            className="flex w-fit items-center gap-4 border-b border-border"
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
              disabled={zapUsdcUnavailable}
              disabledReason="Zap needs Jupiter-listed tokens — unavailable on devnet. Use In-Kind."
            >
              Zap USDC
            </TabButton>
          </div>
          {zapUsdcUnavailable ? (
            <p className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
              Zap needs Jupiter-listed tokens — unavailable on devnet. Use In-Kind.
            </p>
          ) : null}

          <div
            role="tabpanel"
            id="buy-panel-inkind"
            aria-labelledby="buy-tab-inkind"
            tabIndex={0}
            hidden={tab !== "inkind"}
          >
            {tab === "inkind" ? (
              <InKindMintForm detail={detail} vaultBalances={vaultBalances} tickers={mintTickers} onSuccess={retry} />
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
              <ZapInForm detail={detail} vaultBalances={vaultBalances} tickers={mintTickers} onSuccess={retry} />
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
  disabled = false,
  disabledReason,
  children,
}: {
  id: string;
  panelId: string;
  active: boolean;
  onChangeTab: () => void;
  onArrowKeyDown: (event: React.KeyboardEvent) => void;
  tabIndex: 0 | -1;
  disabled?: boolean;
  disabledReason?: string;
  children: string;
}) {
  return (
    <button
      role="tab"
      id={id}
      type="button"
      aria-selected={active}
      aria-controls={panelId}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      tabIndex={disabled ? -1 : tabIndex}
      onClick={() => {
        if (!disabled) onChangeTab();
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        onArrowKeyDown(event);
      }}
      className={`-mb-px border-b-2 px-1 pb-2 pt-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        disabled
          ? "cursor-not-allowed border-transparent text-muted-foreground/50"
          : active
            ? "border-foreground font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
