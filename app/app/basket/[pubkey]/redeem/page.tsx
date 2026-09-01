"use client";
 // @ts-nocheck
import { useState } from "react";
export default function Redeem({ params }: { params: { pubkey: string } }) {
  const [shares, setShares] = useState("1000000");
  return (
    <div>
      <h1 className="text-xl font-semibold">Redeem {params.pubkey.slice(0,8)}</h1>
      <p className="text-sm text-zinc-500">Burn basket shares → receive pro-rata underlying xStocks (raw floor, Token-2022). Exit fee paid in shares 90/10. Permissionless, oracle-free.</p>
      <div className="mt-4 flex gap-2">
        <input value={shares} onChange={e=>setShares(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm" placeholder="shares (raw 6 dec)"/>
        <button className="rounded bg-red-600 px-4 py-2 text-sm font-medium">Redeem</button>
      </div>
      <div className="mt-3 text-xs text-zinc-600">Preview: each xStock out = vault_raw × burn / total_supply (floor). No oracle, no pauser, no backend required.</div>
    </div>
  );
}
