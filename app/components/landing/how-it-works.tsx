/**
 * A5 — replaces the text-only Create → Mint → Redeem explainer: three columns,
 * each a title plus a 2-3 line mono snippet of the real mechanics.
 */
const STEPS: { title: string; lines: string[]; summary: string }[] = [
  {
    title: "Create — weights immutable",
    lines: [
      "weights: 2-20 assets, Σ = 10,000 bps",
      "fees ≤ 300/100/300 bps · 90/10 split",
      "seed + create → 1 atomic tx",
    ],
    summary:
      "Nothing changes after deploy: no rebalancing, no fee edits, no admin upgrade path.",
  },
  {
    title: "Mint — in-kind or USDC zap",
    lines: [
      "in-kind: deposit xStocks, pro-rata",
      "or zap USDC via Jupiter",
      "convenience path · 1-3% slippage",
    ],
    summary:
      "In-kind is the core program path; the USDC zap is a sequential-swap convenience, not protocol logic.",
  },
  {
    title: "Redeem — pro-rata, oracle-free",
    lines: [
      "burn shares → vault holdings",
      "pro-rata, floored to raw unit",
      "permissionless · no pause",
    ],
    summary:
      "The program cannot pause redemption and no backend needs to be online for it.",
  },
];

export function HowItWorks() {
  return (
    <ol className="grid gap-8 md:grid-cols-3">
      {STEPS.map((step, i) => (
        <li key={step.title} className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            0{i + 1}
          </p>
          <h3 className="mt-2 text-base font-medium">{step.title}</h3>
          <pre className="mt-3 overflow-x-auto whitespace-pre rounded-md border border-border/60 bg-background px-3 py-2.5 font-mono text-xs leading-6 text-muted-foreground">
            {step.lines.join("\n")}
          </pre>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {step.summary}
          </p>
        </li>
      ))}
    </ol>
  );
}
