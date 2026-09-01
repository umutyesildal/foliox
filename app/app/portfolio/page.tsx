export default function Portfolio() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Portfolio</h1>
      <p className="text-sm text-zinc-500">Connect wallet to see positions: shares, scaled value (raw×multiplier), drift vs target, cost basis.</p>
      <div className="mt-4 rounded border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-600">Wallet adapter placeholder — integrate @solana/wallet-adapter-react. Data from GET /users/:pubkey/portfolio.</div>
    </div>
  );
}
