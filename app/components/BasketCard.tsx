export function BasketCard({ pubkey, nav, sharePrice, aum }: { pubkey: string; nav?: number; sharePrice?: number; aum?: number }) {
  return (
    <div className="rounded border border-zinc-800 p-4">
      <div className="font-mono text-xs text-zinc-500">{pubkey.slice(0,8)}…</div>
      <div className="mt-1 text-sm">NAV {nav ?? "—"} · Price {sharePrice ?? "—"} · AUM {aum ?? "—"}</div>
    </div>
  );
}
