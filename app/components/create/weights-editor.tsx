"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { bpsToPercent, formatBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  equalWeights,
  normalizeWeights,
  WEIGHTS_DENOMINATOR,
  type ConstituentDraft,
} from "./types";

/**
 * Step 2 — weight sliders that target exactly 10,000 bps. Moving one slider
 * redistributes the delta across the others (proportional to their current
 * weights, largest-remainder rounded) so the sum normally stays exact; when
 * redistribution clamps, the live sum indicator turns amber and the Normalize
 * preset restores exactness.
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

  const applySlider = (index: number, nextWeight: number) => {
    const delta = nextWeight - constituents[index].weightBps;
    if (delta === 0) return;
    const next = constituents.map((c) => ({ ...c }));
    next[index].weightBps = nextWeight;

    const others = constituents
      .map((c, i) => ({ i, weight: c.weightBps }))
      .filter((entry) => entry.i !== index);
    const otherTotal = others.reduce((acc, e) => acc + e.weight, 0);

    if (otherTotal > 0) {
      const share = (weight: number) => (weight / otherTotal) * Math.abs(delta);
      const wholeParts = others.map((e) => Math.min(e.weight, Math.floor(share(e.weight))));
      let applied = wholeParts.reduce((a, b) => a + b, 0);
      const order = others
        .map((e, k) => ({ k, frac: share(e.weight) - Math.floor(share(e.weight)) }))
        .sort((a, b) => b.frac - a.frac || a.k - b.k);
      let guard = 0;
      while (applied < Math.abs(delta) && guard < 400) {
        const before = applied;
        for (const { k } of order) {
          if (applied >= Math.abs(delta)) break;
          const target = next[others[k].i];
          if (delta > 0 && target.weightBps > 0) {
            target.weightBps -= 1;
            applied += 1;
          } else if (delta < 0 && target.weightBps < WEIGHTS_DENOMINATOR) {
            target.weightBps += 1;
            applied += 1;
          }
        }
        if (applied === before) break; // everything clamped — leave the rest to Normalize
        guard += 1;
      }
      others.forEach((e, k) => {
        const target = next[e.i];
        if (delta > 0) target.weightBps -= wholeParts[k];
        else target.weightBps = Math.min(WEIGHTS_DENOMINATOR, target.weightBps + wholeParts[k]);
      });
    } else if (others.length > 0) {
      // All other weights are zero: push |delta| onto the first one (clamped).
      const target = next[others[0].i];
      target.weightBps = Math.min(
        WEIGHTS_DENOMINATOR,
        Math.max(0, target.weightBps - delta),
      );
    }
    onChange(next);
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
    <div className="flex flex-col gap-4">
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
          title="Weights proportional to reference price — float-adjusted market caps are not indexed in V0"
        >
          MarketCap-ish
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset(normalizeWeights(constituents.map((c) => c.weightBps)))}
        >
          Normalize to 10,000
        </Button>
        <span
          aria-live="polite"
          className={cn(
            "ml-auto rounded-full border px-2.5 py-1 font-mono text-xs tabular-nums",
            valid
              ? "border-[hsl(var(--status-positive))]/40 bg-[hsl(var(--status-positive))]/10 text-[hsl(var(--status-positive))]"
              : "border-[hsl(var(--status-caution))]/40 bg-[hsl(var(--status-caution))]/10 text-[hsl(var(--status-caution))]",
          )}
        >
          {sum.toLocaleString()} / 10,000 bps
          {valid ? "" : " — must be exact"}
        </span>
      </div>

      <ul className="flex flex-col gap-4">
        {constituents.map((constituent, index) => (
          <li key={constituent.mint} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-mono font-medium">{constituent.ticker}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatBps(constituent.weightBps)} ·{" "}
                {bpsToPercent(constituent.weightBps).toFixed(2)}%
              </span>
            </div>
            <Slider
              aria-label={`Weight for ${constituent.ticker}`}
              value={[constituent.weightBps]}
              min={0}
              max={WEIGHTS_DENOMINATOR}
              step={50}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                applySlider(index, next);
              }}
            />
          </li>
        ))}
      </ul>

      {!valid && (
        <p className="flex items-start gap-2 rounded-md border border-[hsl(var(--status-caution))]/40 bg-[hsl(var(--status-caution))]/10 p-2.5 text-xs leading-5 text-[hsl(var(--status-caution))]">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          The program reverts unless weights sum to exactly 10,000 bps
          (WeightsNot10000). Drag a slider or run Normalize.
        </p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Weights are immutable after deploy — they define minting proportionality
        (gross = min over constituents of D·S/V) and the drift benchmark. Slider
        step is 50 bps.
      </p>
    </div>
  );
}
