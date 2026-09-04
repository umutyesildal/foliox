"use client";

import { formatBpsAsPercent } from "@/lib/format";
import { RangeField } from "./field";
import {
  ENTRY_FEE_CAP_BPS,
  EXIT_FEE_CAP_BPS,
  MANAGEMENT_FEE_CAP_BPS,
} from "@/lib/create-basket";

interface FeeSpec {
  key: "entry" | "exit" | "management";
  label: string;
  cap: number;
}

const FEE_SPECS: FeeSpec[] = [
  { key: "entry", label: "Entry fee", cap: ENTRY_FEE_CAP_BPS },
  { key: "exit", label: "Exit fee", cap: EXIT_FEE_CAP_BPS },
  { key: "management", label: "Management fee", cap: MANAGEMENT_FEE_CAP_BPS },
];

/**
 * Step 3 — three fee sliders within the factory caps (300/100/300 bps) and a
 * single 90/10 split line. Fees are charged in basket shares, never in
 * underlying, and are fixed for the life of the basket.
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
  // Locale-independent ("." decimal separator) — toLocaleString rendered
  // 1.5 as "1,5"/"1.500" depending on the browser locale.
  const pct = (bps: number) => formatBpsAsPercent(bps);

  return (
    <div className="flex flex-col gap-5">
      {FEE_SPECS.map((spec) => (
        <RangeField
          key={spec.key}
          label={spec.label}
          value={values[spec.key]}
          min={0}
          max={spec.cap}
          step={5}
          onChange={(value) => onChange(spec.key, value)}
        >
          <span className="font-mono tabular-nums">
            {values[spec.key]} bps{" "}
            <span className="text-muted-foreground">of {spec.cap}</span>
          </span>
        </RangeField>
      ))}

      <p className="text-xs leading-5 text-muted-foreground">
        Example: 1,000 USDC in → the {entryFeeBps} bps entry fee takes {pct(entryFeeBps)} in
        shares; the {exitFeeBps} bps exit fee takes {pct(exitFeeBps)} on redemption; the{" "}
        {managementFeeBps} bps management fee accrues {pct(managementFeeBps)} per year.
      </p>

      <p className="text-xs leading-5 text-muted-foreground">
        Fees are charged in basket shares and split 90% to you (creator) / 10%
        to the treasury — fixed for the life of the basket.
      </p>
    </div>
  );
}
