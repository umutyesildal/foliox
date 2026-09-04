"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { bpsToPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RangeField } from "./field";
import {
  equalWeights,
  normalizeWeights,
  WEIGHTS_DENOMINATOR,
  type ConstituentDraft,
} from "./types";

/**
 * Step 2 — weight sliders. Rows adjust freely: the sum may go above or below
 * 10,000 bps while you drag (no forced re-balancing). The live sum indicator
 * turns warning when the total is off, Next stays blocked until it is exactly
 * 10,000, and "Normalize to 10,000" scales the current mix proportionally as
 * a convenience.
 */
export function WeightsEditor({
  constituents,
  onChange,
}: {
  constituents: ConstituentDraft[];
  onChange: (constituents: ConstituentDraft[]) => void;
}) {
  const sum = constituents.reduce((acc, c) => acc + c.weightBps, 0);
  const valid = sum === WEIGHTS_DENOMINATOR;
  const diff = sum - WEIGHTS_DENOMINATOR;

  const setWeight = (index: number, next: number) => {
    const clamped = Math.max(0, Math.min(WEIGHTS_DENOMINATOR, Math.round(next)));
    onChange(
      constituents.map((c, i) => (i === index ? { ...c, weightBps: clamped } : c)),
    );
  };

  const applyPreset = (weights: number[]) => {
    onChange(constituents.map((c, i) => ({ ...c, weightBps: weights[i] })));
  };

  const marketCapIsh = () => {
    // Price-proportional proxy — float-adjusted market caps are not indexed in
    // V0, so this preset is an approximation and is labeled as one.
    const weights = constituents.map((c) => Math.max(1, c.priceRef ?? 1));
    applyPreset(normalizeWeights(weights));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset(equalWeights(constituents.length))}
        >
          Equal
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={marketCapIsh}
          title="Weights proportional to reference price — an approximation; float-adjusted market caps are not indexed in V0"
        >
          MarketCap-ish
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset(normalizeWeights(constituents.map((c) => c.weightBps)))}
          title="Scale the current weights proportionally so they sum to exactly 10,000 bps"
        >
          Normalize to 10,000
        </Button>
        <span
          aria-live="polite"
          className={cn(
            "ml-auto flex items-center gap-1.5 font-mono text-xs tabular-nums",
            valid ? "text-foreground" : "text-destructive",
          )}
        >
          {sum.toLocaleString()} / 10,000 bps
          {!valid && (
            <span className="font-sans">
              — {diff > 0 ? "over" : "under"} by {Math.abs(diff).toLocaleString()}, adjust the
              sliders or Normalize
            </span>
          )}
        </span>
      </div>

      <ul className="flex flex-col gap-5">
        {constituents.map((constituent, index) => (
          <li key={constituent.mint}>
            <RangeField
              label={constituent.ticker}
              value={constituent.weightBps}
              min={0}
              max={WEIGHTS_DENOMINATOR}
              step={10}
              onChange={(value) => setWeight(index, value)}
            >
              <span className="flex items-baseline gap-2">
                <span className="font-mono tabular-nums text-muted-foreground">
                  {bpsToPercent(constituent.weightBps).toFixed(2)}%
                </span>
                <WeightInput ticker={constituent.ticker} weight={constituent.weightBps} onCommit={(value) => setWeight(index, value)} />
              </span>
            </RangeField>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-5 text-muted-foreground">
        Weights are immutable after deploy — they define minting proportionality
        and the drift benchmark. The program only accepts a total of exactly
        10,000 bps.
      </p>
    </div>
  );
}

/**
 * Accessible number input for a single weight (bps). Editing commits live so
 * the sum indicator updates as you type; empty or partial input waits, and a
 * blur re-syncs the draft to the committed value.
 */
function WeightInput({
  ticker,
  weight,
  onCommit,
}: {
  ticker: string;
  weight: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(weight));

  useEffect(() => {
    setDraft(String(weight));
  }, [weight]);

  return (
    <span className="flex items-baseline gap-1">
      <input
        type="text"
        inputMode="numeric"
        aria-label={`Weight for ${ticker} in basis points`}
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          if (!/^\d*$/.test(value)) return;
          setDraft(value);
          if (value !== "") onCommit(Number(value));
        }}
        onBlur={() => setDraft(String(weight))}
        className="h-6 w-16 rounded-md border border-input bg-background px-1.5 text-right font-mono text-xs tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <span className="text-muted-foreground">bps</span>
    </span>
  );
}
