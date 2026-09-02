"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

import { FreshnessBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsd } from "@/lib/format";
import { TextField } from "./field";
import {
  formatRawAsTokenUnits,
  parseTokenUnitsToRaw,
  type ConstituentDraft,
} from "./types";

/**
 * Step 4 — seed preview. The USD example is a UX estimate computed from
 * weights and reference prices (sourced, never a quote); the actual on-chain
 * values are the raw Token-2022 amounts, which stay editable. Every raw
 * amount must be > 0 — the factory reverts on ZeroSeedAmount.
 */
export function SeedPreview({
  constituents,
  budgetUsd,
  priceStatus,
  priceSource,
  priceAsOf,
  onBudgetChange,
  onRawChange,
  onRecomputeProportional,
}: {
  constituents: ConstituentDraft[];
  budgetUsd: string;
  priceStatus: "idle" | "loading" | "ready" | "unavailable";
  priceSource: string | null;
  priceAsOf: string | null;
  onBudgetChange: (budget: string) => void;
  onRawChange: (mint: string, raw: bigint) => void;
  onRecomputeProportional: () => void;
}) {
  const budget = Number(budgetUsd);
  const budgetUsable = Number.isFinite(budget) && budget > 0;
  const missingPrices = constituents.some(
    (c) => c.priceRef === null || c.priceRef === undefined || !Number.isFinite(c.priceRef ?? NaN),
  );
  const zeroSeeds = constituents.some((c) => c.seedRaw <= 0n);
  const totalUsd = budgetUsable && !missingPrices
    ? constituents.reduce(
        (acc, c) => acc + ((budget * c.weightBps) / 10_000),
        0,
      )
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">How much of each token to seed the basket with</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Amounts are entered in whole tokens (e.g. 2.5 shares of TSLAx).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Budget (USD, estimate — not a quote)"
          value={budgetUsd}
          onChange={onBudgetChange}
          inputMode="decimal"
          mono
          className="w-40"
          invalid={!budgetUsable}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRecomputeProportional}
          title="Recompute the token amounts proportional to your weights, using the budget and reference prices"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Recompute proportional
        </Button>
        <div className="ml-auto flex flex-col items-end">
          {priceSource ? (
            <FreshnessBadge
              source={priceSource}
              asOf={priceAsOf ?? undefined}
              demo={priceStatus === "unavailable"}
            />
          ) : (
            <span className="text-xs text-muted-foreground">no reference prices loaded</span>
          )}
        </div>
      </div>

      {missingPrices && (
        <p className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {priceStatus === "loading"
            ? "Loading reference prices…"
            : "Some tokens have no reference price yet — their USD column shows a dash, so type the amount directly."}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Ticker</TableHead>
              <TableHead className="text-right text-xs">Weight</TableHead>
              <TableHead className="text-right text-xs">USD (est.)</TableHead>
              <TableHead className="text-right text-xs">Ref. price</TableHead>
              <TableHead className="text-xs">Amount (tokens)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {constituents.map((constituent) => {
              const hasPrice =
                constituent.priceRef !== null &&
                constituent.priceRef !== undefined &&
                Number.isFinite(constituent.priceRef);
              const usd = hasPrice && budgetUsable
                ? (budget * constituent.weightBps) / 10_000
                : null;
              return (
                <TableRow key={constituent.mint}>
                  <TableCell className="font-mono text-xs font-medium">
                    {constituent.ticker}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {constituent.weightBps.toLocaleString()} bps
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {usd === null ? "—" : formatUsd(usd)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {hasPrice ? `$${constituent.priceRef?.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="w-44">
                    <TextField
                      label={`Amount of ${constituent.ticker} to seed`}
                      hideLabel
                      value={formatRawAsTokenUnits(constituent.seedRaw, constituent.decimals)}
                      onChange={(value) => {
                        const raw = parseTokenUnitsToRaw(value, constituent.decimals);
                        if (raw !== null) onRawChange(constituent.mint, raw);
                      }}
                      inputMode="decimal"
                      mono
                      invalid={constituent.seedRaw <= 0n}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {totalUsd !== null && (
              <TableRow className="hover:bg-transparent">
                <TableCell className="text-xs font-medium" colSpan={2}>
                  Total
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {formatUsd(totalUsd)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {zeroSeeds && (
        <p className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Every token needs a seed amount greater than zero — an empty basket
          cannot be created.
        </p>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        These amounts are transferred to the basket vault in the same
        transaction that creates the basket — there is no separate deposit
        step. You type whole tokens; the exact on-chain math is handled for you.
      </p>
    </div>
  );
}
