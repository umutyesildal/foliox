import type { ReactNode } from "react";

/**
 * Human-language summary card for transaction review modals — the answer to
 * "bu görsel çok kötü neden bu kadar detay var". Plain rows with pretty
 * tickers and whole-token amounts; ALL raw detail (accounts, args, logs)
 * stays in the collapsed "Advanced details" disclosure.
 */

/** bps → percent string ("100" → "1%", "50" → "0.5%", "250" → "2.5%"). */
export function bpsToPct(bps: number): string {
  const text = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${text === "" ? "0" : text}%`;
}

/** Thousands separators for a plain decimal string ("2475.5" → "2,475.5"). */
export function grouped(value: string): string {
  const [int, frac] = value.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = (sign ? int.slice(1) : int).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${digits}${frac ? `.${frac}` : ""}`;
}

/** The "Fees: …" line shared by the buy and create review cards. */
export function feesLine(entryBps: number, exitBps: number, mgmtBps: number): string {
  return `${bpsToPct(entryBps)} entry · ${bpsToPct(exitBps)} exit · ${bpsToPct(mgmtBps)}/yr management`;
}

export function TxSummaryCard({ children }: { children: ReactNode }) {
  return (
    <dl data-testid="tx-summary" className="space-y-1.5">
      {children}
    </dl>
  );
}

export function SummaryRow({
  label,
  value,
  emphasis = false,
  muted = false,
}: {
  label: string;
  value: ReactNode;
  /** Key outcome row ("You receive ≈2,475 shares") — slightly bolder. */
  emphasis?: boolean;
  /** Quiet footnote row (the fees line). */
  muted?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <dt
        className={
          emphasis
            ? "text-sm font-medium"
            : muted
              ? "text-xs text-muted-foreground"
              : "text-sm text-muted-foreground"
        }
      >
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "text-sm font-semibold"
            : muted
              ? "text-xs leading-5 text-muted-foreground"
              : "font-mono text-xs tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}
