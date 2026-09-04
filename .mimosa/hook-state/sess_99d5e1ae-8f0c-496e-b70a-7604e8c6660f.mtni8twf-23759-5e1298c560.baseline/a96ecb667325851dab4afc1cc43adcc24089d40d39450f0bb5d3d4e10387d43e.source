/**
 * indexer/positions.ts — event-driven `user_positions` sync (devnet prep).
 *
 * The listener already persists events/baskets/holdings; this module folds
 * Minted / Redeemed / FeeAccrued events into per-(user, basket) share
 * balances so the holders count and /users/:pubkey/portfolio route read real
 * data instead of zeros.
 *
 * IDEMPOTENCY: every apply* first INSERTs into the `position_events` ledger
 * (PRIMARY KEY (sig, kind)) with ON CONFLICT DO NOTHING. A replayed signature
 * loses the race and is skipped, so balances can never double-count — even if
 * the events row insert and the position write land on different polls
 * (crash between them is recoverable by re-processing the signature).
 *
 * INTEGER-SAFETY (AGENTS.md §2 #7 — see events.ts header): all u64 share
 * amounts arrive as decimal STRINGS and are converted to BigInt before any
 * arithmetic. Balances are bound back to Postgres as decimal strings. The
 * only non-integer value, cost_basis (NUMERIC, USD), is handled in BigInt
 * fixed-point at COST_BASIS_SCALE digits — never a JS number.
 *
 * COST BASIS PROVENANCE: cost_basis is nullable. On mint it is set/blended
 * from the basket's LATEST nav_snapshots.share_price and the row is marked
 * cost_basis_source = 'reference' (an estimate, not a fill price). On redeem
 * it scales down proportionally (BigInt floor). Fee income (entry/exit/mgmt
 * fee shares credited to creator/treasury) carries NO cost basis.
 *
 * FEE SPLIT: programs/basket CREATOR_FEE_SPLIT_BPS = 9000 — fees split 90%
 * creator / 10% treasury with dust to treasury (mirrors fee_split_amounts).
 *
 * DEGRADATION: db === null (or non-PgLike) skips every write with a warn and
 * returns false — the indexer stays runnable without Postgres.
 */
import { isPgLike, type PgLike } from "../db/client.js";
import type { DecodedFolioxEvent, FeeAccruedEvent, MintedEvent, RedeemedEvent } from "./events.js";

/** Fixed-point scale (digits after the dot) for cost_basis math. */
export const COST_BASIS_SCALE = 12n;

/** Creator share of protocol fees, in bps (program constant, 90%). */
export const CREATOR_FEE_SPLIT_BPS = 9000n;

const BPS_DENOM = 10_000n;

// --- decimal-string fixed-point helpers (BigInt only, never Number) ---------

/**
 * Parse a decimal string ("0.155", "-2.5", "191000") into a BigInt scaled by
 * `scale` digits. Extra fractional digits are truncated. Returns null for
 * null/empty/malformed input — callers treat that as "no value".
 */
export function decimalToFixed(value: string | null | undefined, scale: bigint = COST_BASIS_SCALE): bigint | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const negative = s.startsWith("-");
  const unsigned = s.replace(/^[+-]/, "");
  const [intPart, fracPart = ""] = unsigned.split(".");
  const frac = (fracPart + "0".repeat(Number(scale))).slice(0, Number(scale));
  const mag = BigInt(intPart + frac);
  return negative ? -mag : mag;
}

/** Format a `scale`-digit fixed-point BigInt back to a plain decimal string. */
export function fixedToDecimalString(fixed: bigint, scale: bigint = COST_BASIS_SCALE): string {
  const negative = fixed < 0n;
  const abs = negative ? -fixed : fixed;
  const unit = 10n ** scale;
  const intPart = abs / unit;
  let frac = (abs % unit).toString().padStart(Number(scale), "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${intPart.toString()}${frac ? `.${frac}` : ""}`;
}

// --- position_events idempotency guard ---------------------------------------

/**
 * Claim (sig, kind) for position writes. Returns true only when this call
 * newly inserted the ledger row — i.e. this event has not been applied before.
 */
async function claimPositionEvent(db: PgLike, sig: string, kind: "Minted" | "Redeemed" | "FeeAccrued", basket: string): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO position_events (sig, kind, basket) VALUES ($1, $2, $3)
     ON CONFLICT (sig, kind) DO NOTHING`,
    [sig, kind, basket],
  );
  return res.rowCount === 1;
}

interface PositionRow {
  share_balance: string;
  cost_basis: string | null;
  cost_basis_source: string | null;
}

/** Current (user, basket) position, or null when no row exists yet. */
async function readPosition(db: PgLike, user: string, basket: string): Promise<PositionRow | null> {
  const res = await db.query(
    `SELECT share_balance::text AS share_balance, cost_basis::text AS cost_basis,
            cost_basis_source
     FROM user_positions WHERE "user" = $1 AND basket = $2`,
    [user, basket],
  );
  const row = (res.rows as unknown as PositionRow[])[0];
  return row ?? null;
}

/** Latest nav_snapshots.share_price for a basket as a decimal string, or null. */
async function latestSharePrice(db: PgLike, basket: string): Promise<string | null> {
  const res = await db.query(
    `SELECT share_price::text AS share_price FROM nav_snapshots
     WHERE basket = $1 ORDER BY ts DESC LIMIT 1`,
    [basket],
  );
  const price = (res.rows as unknown as Array<{ share_price: string | null }>)[0]?.share_price;
  return typeof price === "string" && price.length > 0 ? price : null;
}

interface PositionDelta {
  user: string;
  basket: string;
  /** Raw share delta; positive for credits, negative for burns/fees paid. */
  delta: bigint;
  /**
   * Fixed-point cost_basis delta (scale COST_BASIS_SCALE) for purchases, or
   * null to leave cost_basis untouched (fee income / no price available).
   */
  costDeltaFixed: bigint | null;
}

/**
 * Read-modify-write one user_positions row with BigInt math. Balances are
 * clamped at zero (an indexer gap can never produce a negative balance).
 * Zero-balance rows are deleted so the holders COUNT stays honest.
 */
async function applyPositionDelta(db: PgLike, d: PositionDelta): Promise<void> {
  const existing = await readPosition(db, d.user, d.basket);
  const balanceBefore = existing ? BigInt(existing.share_balance) : 0n;
  const balanceAfter = balanceBefore + d.delta;
  if (balanceAfter < 0n) {
    console.warn(
      `[positions] clamping negative balance for ${d.user}/${d.basket}: ${balanceBefore.toString()} + ${d.delta.toString()}`,
    );
  }
  const clamped = balanceAfter < 0n ? 0n : balanceAfter;

  if (clamped === 0n) {
    if (existing) {
      await db.query(`DELETE FROM user_positions WHERE "user" = $1 AND basket = $2`, [d.user, d.basket]);
    }
    return;
  }

  let costFixed: bigint | null = existing ? decimalToFixed(existing.cost_basis) : null;
  let source: string | null = existing?.cost_basis_source ?? null;
  if (d.costDeltaFixed !== null) {
    costFixed = (costFixed ?? 0n) + d.costDeltaFixed;
    source = "reference"; // blended from nav_snapshots share_price — an estimate
  }

  const costString = costFixed === null ? null : fixedToDecimalString(costFixed);
  if (existing) {
    await db.query(
      `UPDATE user_positions
       SET share_balance = $3, cost_basis = $4, cost_basis_source = $5, updated_at = NOW()
       WHERE "user" = $1 AND basket = $2`,
      [d.user, d.basket, clamped.toString(), costString, source],
    );
  } else {
    await db.query(
      `INSERT INTO user_positions ("user", basket, share_balance, cost_basis, cost_basis_source, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT ("user", basket) DO UPDATE
         SET share_balance = EXCLUDED.share_balance,
             cost_basis = EXCLUDED.cost_basis,
             cost_basis_source = EXCLUDED.cost_basis_source,
             updated_at = NOW()`,
      [d.user, d.basket, clamped.toString(), costString, source],
    );
  }
}

/**
 * Credit a u64 fee amount 90/10 to the basket's creator and treasury
 * (programs/basket fee_split_amounts: floor to creator, dust to treasury).
 * No cost basis — fee income is not a purchase. Skips with a warn when the
 * baskets row (and therefore the recipients) is not indexed yet.
 */
async function creditFeeSplit(db: PgLike, basket: string, feeShares: bigint): Promise<void> {
  if (feeShares <= 0n) return;
  const res = await db.query(`SELECT creator, treasury FROM baskets WHERE pubkey = $1`, [basket]);
  const row = (res.rows as unknown as Array<{ creator?: string | null; treasury?: string | null }>)[0];
  if (!row?.creator || !row?.treasury) {
    console.warn(`[positions] fee split skipped (basket not indexed): ${basket}`);
    return;
  }
  const creatorAmt = (feeShares * CREATOR_FEE_SPLIT_BPS) / BPS_DENOM; // floor
  const treasuryAmt = feeShares - creatorAmt; // dust stays whole
  if (creatorAmt > 0n) {
    await applyPositionDelta(db, { user: row.creator, basket, delta: creatorAmt, costDeltaFixed: null });
  }
  if (treasuryAmt > 0n) {
    await applyPositionDelta(db, { user: row.treasury, basket, delta: treasuryAmt, costDeltaFixed: null });
  }
}

// --- public apply* API (all idempotent via the position_events ledger) -------

/**
 * Minted: user gains netShares; entryFeeShares is credited 90/10 to the
 * basket's creator/treasury. cost_basis is set/blended from the latest
 * nav_snapshots.share_price (marked 'reference') when one exists.
 * Returns true when the event was newly applied.
 */
export async function applyMinted(db: PgLike | null | undefined, sig: string, ev: MintedEvent): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[positions] applyMinted skipped (no DB):", sig);
    return false;
  }
  if (!(await claimPositionEvent(db, sig, "Minted", ev.basket))) return false;

  const netShares = BigInt(ev.netShares);
  const price = await latestSharePrice(db, ev.basket);
  const priceFixed = decimalToFixed(price);
  await applyPositionDelta(db, {
    user: ev.user,
    basket: ev.basket,
    delta: netShares,
    // shares (raw, scale 0) × price (fixed scale S) stays at scale S
    costDeltaFixed: priceFixed === null ? null : netShares * priceFixed,
  });
  await creditFeeSplit(db, ev.basket, BigInt(ev.entryFeeShares));
  return true;
}

/**
 * Redeemed: user loses sharesBurned + exitFeeShares (burn + fee); the exit
 * fee is credited 90/10 to creator/treasury. cost_basis scales down
 * proportionally (BigInt floor). A fully-redeemed row is deleted so the
 * holders count only counts live positions.
 * Returns true when the event was newly applied.
 */
export async function applyRedeemed(db: PgLike | null | undefined, sig: string, ev: RedeemedEvent): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[positions] applyRedeemed skipped (no DB):", sig);
    return false;
  }
  if (!(await claimPositionEvent(db, sig, "Redeemed", ev.basket))) return false;

  const existing = await readPosition(db, ev.user, ev.basket);
  if (!existing) {
    // Honest gap: the mint that created this position was never indexed.
    // Keep the claim (sig is consumed) but write nothing — never fabricate.
    console.warn(`[positions] redeem without indexed position — skipping: ${ev.user}/${ev.basket}`);
    await creditFeeSplit(db, ev.basket, BigInt(ev.exitFeeShares));
    return true;
  }

  const balanceBefore = BigInt(existing.share_balance);
  const removed = BigInt(ev.sharesBurned) + BigInt(ev.exitFeeShares);
  const clampedRemoved = removed > balanceBefore ? balanceBefore : removed;
  const balanceAfter = balanceBefore - clampedRemoved;

  if (balanceAfter === 0n) {
    await db.query(`DELETE FROM user_positions WHERE "user" = $1 AND basket = $2`, [ev.user, ev.basket]);
  } else {
    const costFixed = decimalToFixed(existing.cost_basis);
    const scaledCost =
      costFixed === null || balanceBefore === 0n
        ? costFixed
        : (costFixed * balanceAfter) / balanceBefore; // proportional, floor
    await db.query(
      `UPDATE user_positions
       SET share_balance = $3, cost_basis = $4, updated_at = NOW()
       WHERE "user" = $1 AND basket = $2`,
      [
        ev.user,
        ev.basket,
        balanceAfter.toString(),
        scaledCost === null ? null : fixedToDecimalString(scaledCost),
      ],
    );
  }
  await creditFeeSplit(db, ev.basket, BigInt(ev.exitFeeShares));
  return true;
}

/**
 * FeeAccrued: management-fee sharesMinted is credited 90/10 to the basket's
 * creator/treasury (the event itself carries no recipients — they are
 * resolved from the indexed baskets row). No cost basis for fee income.
 * Returns true when the event was newly applied.
 */
export async function applyFeeAccrued(db: PgLike | null | undefined, sig: string, ev: FeeAccruedEvent): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[positions] applyFeeAccrued skipped (no DB):", sig);
    return false;
  }
  if (!(await claimPositionEvent(db, sig, "FeeAccrued", ev.basket))) return false;

  await creditFeeSplit(db, ev.basket, BigInt(ev.sharesMinted));
  return true;
}

/** Dispatch one decoded event to the right position writer (listener wiring). */
export async function applyPositionEvent(
  db: PgLike | null | undefined,
  sig: string,
  ev: DecodedFolioxEvent,
): Promise<boolean> {
  switch (ev.type) {
    case "Minted":
      return applyMinted(db, sig, ev);
    case "Redeemed":
      return applyRedeemed(db, sig, ev);
    case "FeeAccrued":
      return applyFeeAccrued(db, sig, ev);
    default:
      return false; // BasketCreated carries no balance change
  }
}
