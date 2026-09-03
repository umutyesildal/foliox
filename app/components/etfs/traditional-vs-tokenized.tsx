"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Traditional vs tokenized — the five wrapper differences that matter, one
 * slim line per dimension: Traditional half (left, muted), dimension label
 * (center, xs mono), Tokenized half (right, highlighted so the eye reads
 * "tokenized wins here" without prose). Clicking a column header focuses
 * that side (the other dims); clicking again clears. Single accent: the
 * Tokenized header carries a 2px imperial underline (--imperial, Tyrian
 * purple — roman-empire experiment; replaces the old chart-1 accent).
 *
 * Lives on the HOME landing (moved from /etfs, 2026-09-02). No card header:
 * the page owns the section label and the one factual description line, so
 * they are not duplicated inside the card.
 */

const DIMENSIONS: { dimension: string; traditional: string; tokenized: string }[] = [
  { dimension: "Settlement", traditional: "T+1 or T+2, via broker rails", tokenized: "Seconds, settled on-chain" },
  { dimension: "Access", traditional: "Broker account, market hours", tokenized: "Any wallet, 24/7" },
  { dimension: "Ownership", traditional: "Custodied by the broker", tokenized: "Self-custodied Token-2022 mint" },
  { dimension: "Transferability", traditional: "Broker-mediated transfers only", tokenized: "Permissionless wallet-to-wallet" },
  { dimension: "Transparency", traditional: "NAV published daily", tokenized: "Holdings verifiable on-chain" },
];

type Focus = "traditional" | "tokenized" | null;

/** Fixed 3-column template shared by the header and every row so halves align.
 *  The center label column narrows to 3rem on phones so each half keeps a
 *  readable line length at 390px; ≥sm restores the 6rem rhythm. */
const GRID =
  "grid grid-cols-[1fr_3rem_1fr] items-center gap-x-2 sm:grid-cols-[1fr_6rem_1fr] sm:gap-x-3";

export function TraditionalVsTokenized() {
  const [focus, setFocus] = useState<Focus>(null);
  const toggle = (side: Exclude<Focus, null>) => setFocus((cur) => (cur === side ? null : side));

  return (
    <Card>
      <CardContent className="space-y-2">
        {/* Column headers — clickable to focus one side. */}
        <div className={GRID}>
          <button
            type="button"
            onClick={() => toggle("traditional")}
            aria-pressed={focus === "traditional"}
            className={cn(
              "flex h-9 items-center justify-end border-b-2 pb-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors",
              focus === "traditional"
                ? "border-foreground/40 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Traditional
          </button>
          <span aria-hidden="true" />
          <button
            type="button"
            onClick={() => toggle("tokenized")}
            aria-pressed={focus === "tokenized"}
            className={cn(
              "flex h-9 items-center justify-start border-b-2 pb-1.5 text-left font-mono text-[11px] uppercase tracking-wide text-foreground transition-colors",
              focus === "tokenized"
                ? "border-[hsl(var(--imperial))]"
                : "border-[hsl(var(--imperial)/0.7)] hover:border-[hsl(var(--imperial))]",
            )}
          >
            Tokenized
          </button>
        </div>

        <ul>
          {DIMENSIONS.map((row) => (
            <li key={row.dimension} className={cn(GRID, "min-h-10")}>
              <span
                className={cn(
                  "flex min-h-10 items-center justify-end px-1 text-right text-xs leading-5 text-muted-foreground transition-opacity",
                  focus === "traditional" && "text-foreground opacity-100",
                  focus === "tokenized" && "opacity-40",
                )}
              >
                {row.traditional}
              </span>
              <span className="text-center font-mono text-[10px] uppercase leading-4 tracking-wide text-muted-foreground">
                {row.dimension}
              </span>
              <span
                className={cn(
                  "flex min-h-10 items-center rounded-md border border-foreground/25 bg-foreground/5 px-2.5 text-xs leading-5 text-foreground transition-opacity",
                  focus === "tokenized" && "border-foreground/40",
                  focus === "traditional" && "opacity-40",
                )}
              >
                {row.tokenized}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
