export default function Legal() {
  return (
    <div className="prose prose-invert max-w-none">
      <h1>Risk & Legal Disclosures</h1>
      <p className="text-sm text-amber-300">Placeholder copy — <span className="font-semibold">LEGAL_REVIEW_REQUIRED</span> before mainnet.</p>
      <ul className="text-sm text-zinc-400">
        <li>Not investment advice; creators are not licensed advisers unless verified. Past performance ≠ future.</li>
        <li>Use only: strategy basket / index basket / xStocks-backed strategy token. Never “registered ETF”.</li>
        <li>xStocks are structured instruments issued by Backed, not direct equity ownership. Redemption is in-kind to xStock tokens, not off-chain shares.</li>
        <li>Jurisdiction restrictions apply (US persons etc.). Frontend geo-block is off-chain; redeem remains permissionless on-chain.</li>
        <li>Smart-contract risk, Token-2022 multiplier changes, Jupiter slippage 1–3% typical, drift expected (no rebalance in V0), upgrade authority multisig disclosed.</li>
        <li>No leverage, lending, derivatives, rebasing, or pooled off-chain custody in V0. Indexer never custodies.</li>
      </ul>
    </div>
  );
}
