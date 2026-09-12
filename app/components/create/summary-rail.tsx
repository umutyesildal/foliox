import { ENTRY_FEE_CAP_BPS, EXIT_FEE_CAP_BPS, MANAGEMENT_FEE_CAP_BPS, estimateCreateBasketTxSize } from "@/lib/create-basket";
import { formatBps, formatUsd, truncateAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SummaryState {
  step: number;
  stepCount: number;
  basketName: string;
  constituentCount: number;
  weightSum: number;
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  seedTotalUsd: number | null;
  seedRawTotal: string | null;
  legalAccepted: boolean;
  walletAddress: string | null;
  nonce: string | null;
  metadataHashShort: string | null;
}

/** Per-step validity flags, mirrored live from wizard state. */
export interface StepValidity {
  selection: boolean;
  weights: boolean;
  fees: boolean;
  seed: boolean;
  legal: boolean;
}

const STEP_LABELS = ["Select", "Weights", "Fees", "Seed", "Legal", "Deploy"] as const;

/**
 * Persistent summary rail (plan.md §5 Create: "six-step stepper plus summary
 * rail"). Mirrors current state; every number updates in place in Geist Mono.
 */
export function SummaryRail({
  summary,
  validity,
  className,
}: {
  summary: SummaryState;
  validity: StepValidity;
  className?: string;
}) {
  const txSize = estimateCreateBasketTxSize(summary.constituentCount);
  const feeRows: [string, number, number][] = [
    ["Entry", summary.entryFeeBps, ENTRY_FEE_CAP_BPS],
    ["Exit", summary.exitFeeBps, EXIT_FEE_CAP_BPS],
    ["Management", summary.managementFeeBps, MANAGEMENT_FEE_CAP_BPS],
  ];

  return (
    <aside
      aria-label="Basket summary"
      className={cn(
        "flex h-fit flex-col gap-4 rounded-lg border border-border bg-card p-5 text-sm",
        className,
      )}
    >
      <div>
        <p className="section-label">Basket</p>
        <p className="mt-1 truncate font-medium">{summary.basketName || "Untitled basket"}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Constituents</dt>
        <dd className="text-right font-mono tabular-nums">
          {summary.constituentCount}{" "}
          <span className={validity.selection ? "text-foreground" : "text-muted-foreground"}>2-20</span>
        </dd>
        <dt className="text-muted-foreground">Weight sum</dt>
        <dd
          className={cn(
            "text-right font-mono tabular-nums",
            validity.weights
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {/* raw bps without locale grouping — grouping made 1666 read as "1.666" */}
          {String(summary.weightSum)} / 10,000 bps
        </dd>
        {feeRows.map(([label, value, cap]) => (
          <div key={label} className="col-span-2 grid grid-cols-[subgrid]">
            <dt className="text-muted-foreground">{label} fee</dt>
            <dd className="text-right font-mono tabular-nums">
              {formatBps(value)} <span className="text-muted-foreground">/ {cap}</span>
            </dd>
          </div>
        ))}
        {summary.seedTotalUsd !== null && (
          <>
            <dt className="text-muted-foreground">Seed (est.)</dt>
            <dd className="text-right font-mono tabular-nums">{formatUsd(summary.seedTotalUsd)}</dd>
          </>
        )}
        {summary.seedRawTotal !== null && (
          <>
            <dt className="text-muted-foreground">Seed amounts</dt>
            <dd className="max-w-[14rem] truncate text-right font-mono tabular-nums" title={summary.seedRawTotal}>
              {summary.seedRawTotal}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Legal</dt>
        <dd
          className={cn(
            "text-right",
            validity.legal ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {validity.legal ? "Acknowledged" : "4 checks required"}
        </dd>
        {summary.walletAddress && (
          <>
            <dt className="text-muted-foreground">Creator</dt>
            <dd className="text-right font-mono tabular-nums">{truncateAddress(summary.walletAddress)}</dd>
          </>
        )}
        {summary.nonce && (
          <>
            <dt className="text-muted-foreground">Nonce</dt>
            <dd className="text-right font-mono tabular-nums">{summary.nonce}</dd>
          </>
        )}
        {summary.metadataHashShort && (
          <>
            <dt className="text-muted-foreground">Metadata</dt>
            <dd className="max-w-[14rem] truncate text-right font-mono tabular-nums" title={summary.metadataHashShort}>
              sha256 {summary.metadataHashShort}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Est. tx size</dt>
        <dd
          className={cn(
            "text-right font-mono tabular-nums",
            txSize > 1232 && "text-muted-foreground",
          )}
          title="Legacy-shaped size estimate; above the 1232-byte packet limit the deploy step compiles through an address lookup table automatically"
        >
          ~{txSize.toLocaleString()} B
        </dd>
      </dl>

      <ol className="flex flex-col gap-1 border-t border-border/60 pt-3 text-xs" aria-label="Step status">
        {STEP_LABELS.map((label, index) => {
          const state = index < summary.step ? "done" : index === summary.step ? "current" : "upcoming";
          const valid = stepValidityAt(validity, index);
          return (
            <li key={label} className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  state === "current" && "font-medium text-primary-text",
                  state === "done" && "text-muted-foreground",
                  state === "upcoming" && "text-muted-foreground/70",
                )}
              >
                {index + 1}. {label}
              </span>
              {index < summary.stepCount - 1 && (
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    valid
                      ? "text-primary-text"
                      : "text-muted-foreground/60",
                  )}
                >
                  {valid ? "ok" : "pending"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function stepValidityAt(validity: StepValidity, index: number): boolean {
  switch (index) {
    case 0:
      return validity.selection;
    case 1:
      return validity.weights;
    case 2:
      return validity.fees;
    case 3:
      return validity.seed;
    case 4:
      return validity.legal;
    default:
      return true;
  }
}
