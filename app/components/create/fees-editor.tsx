"use client";

import { Slider } from "@/components/ui/slider";
import { formatBps } from "@/lib/format";
import {
  ENTRY_FEE_CAP_BPS,
  EXIT_FEE_CAP_BPS,
  MANAGEMENT_FEE_CAP_BPS,
} from "@/lib/create-basket";

interface FeeSpec {
  key: "entry" | "exit" | "management";
  label: string;
  cap: number;
  description: string;
}

const FEE_SPECS: FeeSpec[] = [
  {
    key: "entry",
    label: "Entry fee",
    cap: ENTRY_FEE_CAP_BPS,
    description:
      "Withheld from gross shares on every mint_in_kind, before shares reach the depositor.",
  },
  {
    key: "exit",
    label: "Exit fee",
    cap: EXIT_FEE_CAP_BPS,
    description:
      "Portion of redeemed shares on redeem_in_kind — transferred, not burned, so it does not touch the vault.",
  },
  {
    key: "management",
    label: "Management fee",
    cap: MANAGEMENT_FEE_CAP_BPS,
    description:
      "Streams per year as share dilution (supply × bps × elapsed / (10,000 × 31,536,000)), accrued at the top of every mint/redeem and by a permissionless crank.",
  },
];

/**
 * Step 3 — fee schedule within the factory caps (300/100/300 bps) plus the
 * 90/10 split explainer. Fees are charged in shares, never in underlying.
 */
export function FeesEditor({
  entryFeeBps,
  exitFeeBps,
  managementFeeBps,
  onChange,
}: {
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  onChange: (key: FeeSpec["key"], value: number) => void;
}) {
  const values: Record<FeeSpec["key"], number> = {
    entry: entryFeeBps,
    exit: exitFeeBps,
    management: managementFeeBps,
  };

  // Worked example on a 1,000,000 share gross mint (genesis-size reference).
  const exampleGross = 1_000_000;
  const exampleEntry = Math.floor((exampleGross * entryFeeBps) / 10_000);
  const creatorShare = Math.floor((exampleEntry * 9_000) / 10_000);
  const treasuryShare = exampleEntry - creatorShare;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-6">
        {FEE_SPECS.map((spec) => (
          <div key={spec.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{spec.label}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatBps(values[spec.key])} · cap {formatBps(spec.cap)}
              </span>
            </div>
            <Slider
              aria-label={`${spec.label} in basis points`}
              value={[values[spec.key]]}
              min={0}
              max={spec.cap}
              step={5}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                onChange(spec.key, next);
              }}
            />
            <p className="text-xs leading-5 text-muted-foreground">{spec.description}</p>
          </div>
        ))}
        <p className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          Caps come from the factory config and are enforced on-chain
          (FeeOverCap). Fees are fixed for the life of the basket — no update
          instruction exists.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium">90/10 split — worked example</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-xs tabular-nums">
          <dt className="text-muted-foreground">Gross mint</dt>
          <dd className="text-right">{exampleGross.toLocaleString()} shares</dd>
          <dt className="text-muted-foreground">Entry fee</dt>
          <dd className="text-right">{exampleEntry.toLocaleString()} shares</dd>
          <dt className="text-muted-foreground">Creator (90%)</dt>
          <dd className="text-right">{creatorShare.toLocaleString()}</dd>
          <dt className="text-muted-foreground">Treasury (10%)</dt>
          <dd className="text-right">{treasuryShare.toLocaleString()}</dd>
          <dt className="text-muted-foreground">Net to depositor</dt>
          <dd className="text-right">
            {(exampleGross - exampleEntry).toLocaleString()} shares
          </dd>
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">
          split_fee(fee, 9000) floors the creator portion; the treasury receives
          the remainder, so creator + treasury always equals the fee exactly. All
          fees are paid in basket shares — the vault never pays out underlying
          for fees.
        </p>
        <p className="rounded-md border border-[hsl(var(--status-caution))]/40 bg-[hsl(var(--status-caution))]/10 p-2.5 text-[11px] leading-4 text-muted-foreground">
          The 90/10 split is creator compensation and is disclosed pre-mint.
          LEGAL_REVIEW_REQUIRED — placeholder copy pending counsel review.
        </p>
      </div>
    </div>
  );
}
