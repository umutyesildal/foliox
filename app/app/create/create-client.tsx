"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { Connection, TransactionSignature, VersionedTransaction } from "@solana/web3.js";

import { Button } from "@/components/ui/button";
import { useWalletFeedback } from "@/app/providers";
import {
  DeployPanel,
  FeesEditor,
  LegalCheckboxes,
  LegalReviewTag,
  MintPicker,
  SeedPreview,
  Stepper,
  SummaryRail,
  WalletGateBanner,
  WeightsEditor,
  formatRawAsTokenUnits,
  type StepValidity,
} from "@/components/create";
import { ENTRY_FEE_CAP_BPS, EXIT_FEE_CAP_BPS, MANAGEMENT_FEE_CAP_BPS } from "@/lib/create-basket";
import { truncateAddress } from "@/lib/format";
import {
  equalWeights,
  tickerFromRow,
  type ConstituentDraft,
  type LegalAcknowledgments,
  type WhitelistRow,
} from "@/components/create/types";
import { sha256Hex } from "@/lib/create-basket";
import { apiFetch, apiQuery } from "@/lib/api-client";
import { fetchBasketDetail, type BasketDetail } from "@/components/basket/basket-api";

const STEPS = ["Select", "Weights", "Fees", "Seed", "Legal", "Deploy"] as const;

type WhitelistStatus = "loading" | "ready" | "error" | "empty";
type PriceStatus = "idle" | "loading" | "ready" | "unavailable";
type CloneStatus = "idle" | "loading" | "ready" | "unavailable";

interface CloneBanner {
  name: string | null;
  /** True when some source constituents were skipped (paused / not whitelisted). */
  partial: boolean;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

/** metadata_json may arrive as object or JSON text — parse defensively. */
function cloneSourceName(detail: BasketDetail): string | null {
  let obj: unknown = detail.metadata_json;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  const n = obj && typeof obj === "object" ? (obj as Record<string, unknown>).name : null;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/**
 * Create wizard — six steps, each blocking Next on its validation, with a
 * persistent summary rail. Mirrors basket_factory::create_basket validations
 * client-side; the program re-validates everything on-chain.
 *
 * `?clone=<pubkey>` (from the basket page's "Clone this basket") pre-fills
 * constituents/weights/fees from the indexed basket under a dismissible
 * banner — seed amounts and the legal acknowledgments are never cloned.
 */
export default function CreateClient() {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const { reportError } = useWalletFeedback();

  const searchParams = useSearchParams();
  const cloneParam = searchParams.get("clone");

  const [step, setStep] = useState(0);
  const [whitelistStatus, setWhitelistStatus] = useState<WhitelistStatus>("loading");
  const [whitelistRows, setWhitelistRows] = useState<WhitelistRow[]>([]);
  const [whitelistError, setWhitelistError] = useState<string | null>(null);
  const [whitelistSource, setWhitelistSource] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [constituents, setConstituents] = useState<ConstituentDraft[]>([]);
  const [entryFeeBps, setEntryFeeBps] = useState(100);
  const [exitFeeBps, setExitFeeBps] = useState(50);
  const [managementFeeBps, setManagementFeeBps] = useState(200);
  const [legal, setLegal] = useState<LegalAcknowledgments>({
    notAdvice: false,
    jurisdiction: false,
    structuredInstrument: false,
    creatorNotAdviser: false,
  });

  const [budgetUsd, setBudgetUsd] = useState("1000");
  const [priceStatus, setPriceStatus] = useState<PriceStatus>("idle");
  const [priceSource, setPriceSource] = useState<string | null>(null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);

  const [nonce, setNonce] = useState(() => Date.now());
  const [metadataHashHex, setMetadataHashHex] = useState<string | null>(null);

  // ---- clone state ----
  const [cloneStatus, setCloneStatus] = useState<CloneStatus>("idle");
  const [cloneDetail, setCloneDetail] = useState<BasketDetail | null>(null);
  const [cloneBanner, setCloneBanner] = useState<CloneBanner | null>(null);
  const cloneAppliedRef = useRef(false);

  const loadWhitelist = useCallback(async () => {
    setWhitelistStatus("loading");
    setWhitelistError(null);
    try {
      const res = await apiFetch("/api/v1/whitelist", { cache: "no-store" });
      if (!res.ok) {
        setWhitelistRows([]);
        setWhitelistStatus("error");
        setWhitelistError(`GET /api/v1/whitelist responded ${res.status}.`);
        return;
      }
      const payload = (await res.json()) as { data?: WhitelistRow[]; source?: string | null };
      const rows = Array.isArray(payload.data) ? payload.data : [];
      setWhitelistRows(rows);
      setWhitelistSource(payload.source ?? "whitelist-api");
      setWhitelistStatus(rows.length === 0 ? "empty" : "ready");
    } catch (error) {
      setWhitelistRows([]);
      setWhitelistStatus("error");
      setWhitelistError(
        error instanceof Error ? error.message : "The whitelist API did not respond.",
      );
    }
  }, []);

  useEffect(() => {
    void loadWhitelist();
  }, [loadWhitelist]);

  // Fetch the clone source once. An invalid pubkey is ignored silently —
  // the wizard simply behaves as a fresh create.
  useEffect(() => {
    if (!cloneParam) return;
    let valid = false;
    try {
      new PublicKey(cloneParam);
      valid = true;
    } catch {
      valid = false;
    }
    if (!valid) return;
    const controller = new AbortController();
    setCloneStatus("loading");
    fetchBasketDetail(cloneParam, controller.signal)
      .then((detail) => {
        setCloneDetail(detail);
        setCloneStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setCloneStatus("unavailable");
      });
    return () => controller.abort();
  }, [cloneParam]);

  // Prefill once the source detail AND the whitelist (decimals/tickers/status)
  // are both available. Seed amounts are deliberately left at zero — the seed
  // step still requires the user to choose amounts.
  useEffect(() => {
    if (cloneAppliedRef.current) return;
    if (!cloneDetail || whitelistStatus !== "ready") return;
    cloneAppliedRef.current = true;

    const sourceName = cloneSourceName(cloneDetail);
    const drafts: ConstituentDraft[] = [];
    cloneDetail.constituents.forEach((mint, i) => {
      const row = whitelistRows.find((r) => r.mint === mint);
      if (!row || row.status !== "Active") return;
      drafts.push({
        mint,
        ticker: tickerFromRow(row),
        decimals: row.decimals,
        weightBps: cloneDetail.weights_bps[i] ?? 0,
        seedRaw: 0n,
        priceRef: null,
      });
    });

    if (drafts.length >= 2) {
      setConstituents(drafts);
      setName(sourceName ? `${sourceName} (clone)` : "");
      setEntryFeeBps(Math.min(cloneDetail.entry_fee_bps, ENTRY_FEE_CAP_BPS));
      setExitFeeBps(Math.min(cloneDetail.exit_fee_bps, EXIT_FEE_CAP_BPS));
      setManagementFeeBps(Math.min(cloneDetail.management_fee_bps, MANAGEMENT_FEE_CAP_BPS));
      setStep(0);
    }
    setCloneBanner({
      name: sourceName,
      partial: drafts.length >= 2 && drafts.length < cloneDetail.constituents.length,
    });
  }, [cloneDetail, whitelistRows, whitelistStatus]);

  // Reference prices for the seed USD example. Best effort — the raw seed
  // inputs work without them, and the estimate is always labeled.
  const selectedMintsKey = constituents.map((c) => c.mint).join(",");
  useEffect(() => {
    if (!selectedMintsKey) {
      setPriceStatus("idle");
      return;
    }
    const mints = selectedMintsKey.split(",");
    const tickers = mints
      .map((mint) => {
        const row = whitelistRows.find((r) => r.mint === mint);
        if (!row) return null;
        const ticker = tickerFromRow(row);
        return ticker.includes("…") ? null : ticker;
      })
      .filter((t): t is string => t !== null);
    if (tickers.length === 0) {
      setPriceStatus("unavailable");
      return;
    }
    let cancelled = false;
    setPriceStatus("loading");
    void (async () => {
      try {
        const res = await apiQuery(
          "/api/v1/prices/compare",
          { tickers: tickers.join(",") },
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`prices/compare responded ${res.status}`);
        const payload = (await res.json()) as {
          data?: { ticker: string; mint: string; jupiter: number | null }[];
          ts?: string;
        };
        if (cancelled) return;
        const byMint = new Map((payload.data ?? []).map((row) => [row.mint, row.jupiter]));
        setConstituents((prev) =>
          prev.map((c) =>
            byMint.has(c.mint) ? { ...c, priceRef: byMint.get(c.mint) ?? null } : c,
          ),
        );
        setPriceSource("backend /prices/compare (jupiter reference)");
        setPriceAsOf(payload.ts ?? null);
        setPriceStatus("ready");
      } catch {
        if (!cancelled) setPriceStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMintsKey, whitelistRows]);

  const toggleMint = useCallback(
    (mint: string) => {
      setConstituents((prev) => {
        if (prev.some((c) => c.mint === mint)) {
          const next = prev.filter((c) => c.mint !== mint);
          const weights = equalWeights(next.length);
          return next.map((c, i) => ({ ...c, weightBps: weights[i] }));
        }
        if (prev.length >= 20) return prev;
        const row = whitelistRows.find((r) => r.mint === mint);
        if (!row || row.status !== "Active") return prev;
        const next: ConstituentDraft[] = [
          ...prev,
          {
            mint,
            ticker: tickerFromRow(row),
            decimals: row.decimals,
            weightBps: 0,
            seedRaw: 0n,
            priceRef: null,
          },
        ];
        const weights = equalWeights(next.length);
        return next.map((c, i) => ({ ...c, weightBps: weights[i] }));
      });
    },
    [whitelistRows],
  );

  const recomputeProportional = useCallback(() => {
    const budget = Number(budgetUsd);
    if (!Number.isFinite(budget) || budget <= 0) return;
    setConstituents((prev) =>
      prev.map((c) => {
        if (!c.priceRef || !Number.isFinite(c.priceRef)) return c;
        const usd = (budget * c.weightBps) / 10_000;
        const raw = Math.floor((usd / c.priceRef) * 10 ** c.decimals);
        return { ...c, seedRaw: raw > 0 ? BigInt(raw) : 0n };
      }),
    );
  }, [budgetUsd]);

  // Metadata JSON — hashed with sha256 (IPFS upload is out of scope for V0).
  const metadataJson = useMemo(() => {
    const blob = {
      name: name.trim() || "Untitled FolioX basket",
      description: description.trim(),
      version: "foliox-v0",
      genesisShares: 1_000_000,
      constituents: constituents.map((c) => ({
        ticker: c.ticker,
        mint: c.mint,
        weightBps: c.weightBps,
      })),
      feesBps: {
        entry: entryFeeBps,
        exit: exitFeeBps,
        management: managementFeeBps,
      },
    };
    return JSON.stringify(blob, null, 2);
  }, [name, description, constituents, entryFeeBps, exitFeeBps, managementFeeBps]);

  useEffect(() => {
    let cancelled = false;
    void sha256Hex(metadataJson).then((hex) => {
      if (!cancelled) setMetadataHashHex(hex);
    });
    return () => {
      cancelled = true;
    };
  }, [metadataJson]);

  // ---- per-step validation (mirrors the program's checks) ----
  const count = constituents.length;
  const weightSum = constituents.reduce((acc, c) => acc + c.weightBps, 0);
  const validity: StepValidity = {
    selection: count >= 2 && count <= 20,
    weights: count >= 2 && count <= 20 && weightSum === 10_000,
    fees:
      entryFeeBps <= ENTRY_FEE_CAP_BPS &&
      exitFeeBps <= EXIT_FEE_CAP_BPS &&
      managementFeeBps <= MANAGEMENT_FEE_CAP_BPS,
    seed: count > 0 && constituents.every((c) => c.seedRaw > 0n),
    legal:
      legal.notAdvice && legal.jurisdiction && legal.structuredInstrument && legal.creatorNotAdviser,
  };
  const stepValid = [validity.selection, validity.weights, validity.fees, validity.seed, validity.legal, true];

  let validThrough = 0;
  for (let i = 0; i < stepValid.length; i += 1) {
    if (stepValid[i]) validThrough = i;
    else break;
  }

  const nextBlockedReason =
    step === 0
      ? validity.selection
        ? null
        : "Select between 2 and 20 Active xStocks to continue."
      : step === 1
        ? validity.weights
          ? null
          : "Weights must sum to exactly 10,000 bps."
        : step === 2
          ? validity.fees
            ? null
            : "Fees must stay within the caps (300/100/300 bps)."
            : step === 3
              ? validity.seed
                ? null
                : "Every token needs a seed amount greater than zero."
            : step === 4
              ? validity.legal
                ? null
                : "All four acknowledgments are required before deploy."
              : null;

  const handleSendTransaction = useCallback(
    (transaction: VersionedTransaction, conn: Connection): Promise<TransactionSignature> =>
      sendTransaction(transaction, conn),
    [sendTransaction],
  );

  return (
    <div className="mx-auto w-full max-w-6xl pb-16">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Create a strategy basket</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Six steps, each gated. The deployed basket is immutable.
          </p>
        </div>
        <LegalReviewTag />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {!connected && <WalletGateBanner className="mb-4" />}

          {cloneStatus === "loading" ? (
            <div role="status" className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <span className="sr-only">Loading basket to clone</span>
              <p className="text-sm text-muted-foreground">Loading the basket to clone…</p>
            </div>
          ) : cloneStatus === "unavailable" ? (
            <div role="status" className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                The basket to clone ({truncateAddress(cloneParam ?? "", 6, 6)}) could not be loaded —
                starting from a blank wizard.
              </p>
            </div>
          ) : cloneBanner ? (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Cloning {cloneBanner.name ?? "basket"} — everything below is editable
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  Constituents, weights and fees are pre-filled. Seed amounts and the legal
                  acknowledgments are yours to set.
                  {cloneBanner.partial
                    ? " Some source constituents are not Active in the whitelist — reselect them manually."
                    : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss clone notice"
                onClick={() => setCloneBanner(null)}
              >
                ×
              </Button>
            </div>
          ) : null}

          <Stepper
            steps={STEPS.map((label, i) => ({ key: `${i}-${label}`, label }))}
            current={step}
            validThrough={validThrough}
            onSelect={setStep}
          />

          <section className="mt-5 rounded-lg border border-border bg-card p-5" aria-label={`Step ${step + 1}: ${STEPS[step]}`}>
            <h2 className="mb-4 text-lg font-medium">
              {step + 1}. {STEPS[step]}
            </h2>

            {step === 0 && (
              <MintPicker
                status={whitelistStatus}
                rows={whitelistRows}
                error={whitelistError ?? undefined}
                selectedMints={constituents.map((c) => c.mint)}
                maxSelected={20}
                basketName={name}
                description={description}
                onToggle={toggleMint}
                onNameChange={setName}
                onDescriptionChange={setDescription}
                onRetry={() => void loadWhitelist()}
              />
            )}

            {step === 1 && (
              <WeightsEditor
                constituents={constituents}
                onChange={setConstituents}
              />
            )}

            {step === 2 && (
              <FeesEditor
                entryFeeBps={entryFeeBps}
                exitFeeBps={exitFeeBps}
                managementFeeBps={managementFeeBps}
                onChange={(key, value) => {
                  if (key === "entry") setEntryFeeBps(value);
                  else if (key === "exit") setExitFeeBps(value);
                  else setManagementFeeBps(value);
                }}
              />
            )}

            {step === 3 && (
              <SeedPreview
                constituents={constituents}
                budgetUsd={budgetUsd}
                priceStatus={priceStatus}
                priceSource={priceSource}
                priceAsOf={priceAsOf}
                onBudgetChange={setBudgetUsd}
                onRawChange={(mint, raw) =>
                  setConstituents((prev) =>
                    prev.map((c) => (c.mint === mint ? { ...c, seedRaw: raw } : c)),
                  )
                }
                onRecomputeProportional={recomputeProportional}
              />
            )}

            {step === 4 && (
              <LegalCheckboxes
                legal={legal}
                onChange={(key, value) => setLegal((prev) => ({ ...prev, [key]: value }))}
              />
            )}

            {step === 5 && (
              <DeployPanel
                constituents={constituents}
                entryFeeBps={entryFeeBps}
                exitFeeBps={exitFeeBps}
                managementFeeBps={managementFeeBps}
                nonce={nonce}
                metadataJson={metadataJson}
                metadataHash={metadataHashHex ? hexToBytes(metadataHashHex) : new Uint8Array(32)}
                connected={connected}
                publicKey={publicKey}
                connection={connection}
                sendTransaction={handleSendTransaction}
                onNonceRegenerate={() => setNonce(Date.now())}
              />
            )}
          </section>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            {step < 5 && (
              <div className="flex flex-col items-end gap-1">
                {nextBlockedReason && (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {nextBlockedReason}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() => setStep((s) => Math.min(5, s + 1))}
                  disabled={!stepValid[step] || !connected}
                >
                  Next
                </Button>
                {!connected && (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    Connect your wallet to continue
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Shown on mobile too: the grid collapses to one column below lg, so
            the rail simply stacks under the wizard instead of disappearing. */}
        <SummaryRail
          summary={{
            step,
            stepCount: STEPS.length,
            basketName: name,
            constituentCount: count,
            weightSum,
            entryFeeBps,
            exitFeeBps,
            managementFeeBps,
            seedTotalUsd: validity.seed
              ? Number.isFinite(Number(budgetUsd)) && Number(budgetUsd) > 0
                ? Number(budgetUsd)
                : null
              : null,
            seedRawTotal:
              count > 0
                ? constituents
                    .map(
                      (c) =>
                        `${c.ticker} ${formatRawAsTokenUnits(c.seedRaw, c.decimals)}`,
                    )
                    .join(" + ")
                : null,
            legalAccepted: validity.legal,
            walletAddress: publicKey?.toBase58() ?? null,
            nonce: String(nonce),
            metadataHashShort: metadataHashHex
              ? truncateAddress(metadataHashHex, 8, 6)
              : null,
          }}
          validity={validity}
        />
      </div>
      <div className="mt-4 lg:hidden">
        <p className="text-xs text-muted-foreground">
          {whitelistSource ? `whitelist source: ${whitelistSource}` : ""}
        </p>
      </div>

    </div>
  );
}
