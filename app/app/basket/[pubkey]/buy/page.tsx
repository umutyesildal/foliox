"use client";
 // @ts-nocheck
import { useState } from "react";
export default function Buy({ params }: { params: { pubkey: string } }) {
  const [tab, setTab] = useState<"inkind"|"zap">("zap");
  return (
    <div>
      <h1 className="text-xl font-semibold">Buy Basket {params.pubkey.slice(0,8)}</h1>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setTab("zap")} className={`rounded px-3 py-1 text-sm ${tab==="zap"?"bg-white text-black":"border border-zinc-800"}`}>Zap USDC (Jupiter)</button>
        <button onClick={() => setTab("inkind")} className={`rounded px-3 py-1 text-sm ${tab==="inkind"?"bg-white text-black":"border border-zinc-800"}`}>In-Kind Mint</button>
      </div>
      {tab==="zap" ? (
        <div className="mt-4 rounded border border-zinc-800 p-4 text-sm text-zinc-400">Enter USDC amount → backend POST /quotes/zap-in builds Jupiter legs → client executes sequential swaps → then mint_in_kind. Atomicity tradeoff: partial fills leave intermediate tokens; no funds lost. Slippage per spec §8.</div>
      ) : (
        <div className="mt-4 rounded border border-zinc-800 p-4 text-sm text-zinc-400">Enter raw amounts per xStock (must match target weights within 1% or tx reverts WeightMismatch). Program uses raw Token-2022 transfers; UI shows scaled = raw×multiplier.</div>
      )}
    </div>
  );
}
