/**
 * Event Listener — indexes BasketCreated / Minted / Redeemed / FeeAccrued
 * Polls Helius DAS or RPC logsSubscribe; writes to events table.
 * Backend is convenience only; Basket redeem remains permissionless even if this dies.
 */
import { Connection, PublicKey } from "@solana/web3.js";

export interface ListenerConfig {
  rpcUrl: string;
  programIds: PublicKey[];
  pollIntervalMs: number;
}

export class EventListener {
  constructor(private conn: Connection, private cfg: ListenerConfig) {}

  async start(onEvent: (sig: string, slot: number, data: any) => Promise<void>) {
    // V0: poll getSignaturesForAddress; V1: Geyser / Helius webhook
    for (const pid of this.cfg.programIds) {
      const sigs = await this.conn.getSignaturesForAddress(pid, { limit: 20 });
      for (const s of sigs) {
        if (s.err) continue;
        const tx = await this.conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx?.meta?.logMessages) continue;
        // Anchor events are base64 in logs: Program data: <base64>
        const eventLogs = tx.meta.logMessages.filter(l => l.includes("Program data:"));
        for (const log of eventLogs) {
          // Decode with Anchor coder in production; here emit raw
          await onEvent(s.signature, s.slot, { log, program: pid.toBase58() });
        }
      }
    }
    // schedule poll
    setTimeout(() => this.start(onEvent), this.cfg.pollIntervalMs);
  }
}

// Usage:
// const conn = new Connection(process.env.RPC_URL!);
// const listener = new EventListener(conn, { rpcUrl, programIds: [whitelist, basketFactory, basket], pollIntervalMs: 15000 });
// listener.start(async (sig, slot, data) => { await db.query("INSERT INTO events(sig,slot,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [sig, slot, data]); });
