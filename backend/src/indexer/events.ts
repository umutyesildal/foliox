/**
 * indexer/events.ts — Anchor event decoding for the Basalt programs.
 *
 * Anchor emits CPI events as `Program data: <base64>` log lines. The first 8
 * bytes are the event discriminator = sha256("event:<EventName>")[0..8]; the
 * rest is the Borsh serialization of the event struct in declaration order.
 *
 * INTEGER-SAFETY CONVENTION (crosses module boundaries — read before use):
 *   * On-chain u64/i64 values (share amounts, fees, elapsed) are decoded to
 *     DECIMAL STRINGS, never JS numbers, because u64 can exceed
 *     Number.MAX_SAFE_INTEGER (2^53-1). Everything downstream (events.data
 *     JSONB, baskets.nonce, seed amounts) must keep them as strings.
 *   * Unix timestamps (i64 seconds) fit a Number safely and are exposed as
 *     numbers for Date math.
 *
 * Event layouts are mirrored from the Rust sources (authoritative):
 *   programs/basket_factory/src/lib.rs   BasketCreated
 *   programs/basket/src/lib.rs           Minted / Redeemed / FeeAccrued
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export type FolioxEventType = "BasketCreated" | "Minted" | "Redeemed" | "FeeAccrued";

export const BASALT_EVENT_TYPES: readonly FolioxEventType[] = [
  "BasketCreated",
  "Minted",
  "Redeemed",
  "FeeAccrued",
] as const;

/** sha256("event:<name>")[0..8] — Anchor CPI event discriminator. */
export function anchorEventDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
}

export const ANCHOR_EVENT_DISCRIMINATORS: Record<FolioxEventType, Buffer> = {
  BasketCreated: anchorEventDiscriminator("BasketCreated"),
  Minted: anchorEventDiscriminator("Minted"),
  Redeemed: anchorEventDiscriminator("Redeemed"),
  FeeAccrued: anchorEventDiscriminator("FeeAccrued"),
};

/** sha256("global:<snake_case_ix_name>")[0..8] — Anchor instruction discriminator. */
export function anchorIxDiscriminator(ixName: string): Buffer {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

export const CREATE_BASKET_IX_DISCRIMINATOR = anchorIxDiscriminator("create_basket");

// --- decoded event shapes (u64 fields are decimal STRINGS — see header) ----

export interface BasketCreatedEvent {
  type: "BasketCreated";
  basket: string;
  creator: string;
  numConstituents: number; // u8
  shareMint: string;
  ts: number; // i64 unix seconds
}

export interface MintedEvent {
  type: "Minted";
  basket: string;
  user: string;
  grossShares: string; // u64
  netShares: string; // u64
  entryFeeShares: string; // u64
}

export interface RedeemedEvent {
  type: "Redeemed";
  basket: string;
  user: string;
  sharesBurned: string; // u64
  exitFeeShares: string; // u64
}

export interface FeeAccruedEvent {
  type: "FeeAccrued";
  basket: string;
  sharesMinted: string; // u64
  elapsedSec: string; // u64
}

export type DecodedFolioxEvent =
  | BasketCreatedEvent
  | MintedEvent
  | RedeemedEvent
  | FeeAccruedEvent;

/** Minimum Borsh payload length (after the 8-byte discriminator) per event. */
const EVENT_PAYLOAD_LENGTHS: Record<FolioxEventType, number> = {
  // basket(32) + creator(32) + u8 + share_mint(32) + i64
  BasketCreated: 32 + 32 + 1 + 32 + 8,
  // basket(32) + user(32) + u64 + u64 + u64
  Minted: 32 + 32 + 8 + 8 + 8,
  // basket(32) + user(32) + u64 + u64
  Redeemed: 32 + 32 + 8 + 8,
  // basket(32) + u64 + u64
  FeeAccrued: 32 + 8 + 8,
};

// --- tiny borsh reader ------------------------------------------------------

interface Reader {
  buf: Buffer;
  offset: number;
}

function readFixed(r: Reader, n: number): Buffer {
  if (r.offset + n > r.buf.length) throw new Error(`borsh: need ${n} bytes at ${r.offset}`);
  const out = r.buf.subarray(r.offset, r.offset + n);
  r.offset += n;
  return out;
}

function readU8(r: Reader): number {
  return readFixed(r, 1).readUInt8(0);
}

function readU16(r: Reader): number {
  return readFixed(r, 2).readUInt16LE(0);
}

function readU32(r: Reader): number {
  return readFixed(r, 4).readUInt32LE(0);
}

/** u64 → BigInt (callers convert to string; never to Number). */
function readU64(r: Reader): bigint {
  return readFixed(r, 8).readBigUInt64LE(0);
}

/** i64 → BigInt via two's complement. */
function readI64(r: Reader): bigint {
  return readFixed(r, 8).readBigInt64LE(0);
}

function readPubkey(r: Reader): string {
  return new PublicKey(readFixed(r, 32)).toBase58();
}

function readVecLen(r: Reader): number {
  const len = readU32(r);
  if (len > 1024 * 1024) throw new Error("borsh: unreasonable vec length");
  return len;
}

// --- log extraction ---------------------------------------------------------

/**
 * Extract and base64-decode every `Program data: ...` log line.
 * Works on both top-level logs and inner-instruction log arrays.
 */
export function extractProgramDataLogs(logMessages: string[]): Buffer[] {
  const out: Buffer[] = [];
  for (const line of logMessages) {
    const marker = "Program data: ";
    const idx = line.indexOf(marker);
    if (idx === -1) continue;
    const b64 = line.slice(idx + marker.length).trim();
    if (b64.length === 0) continue;
    try {
      out.push(Buffer.from(b64, "base64"));
    } catch {
      // malformed base64 — skip this log line
    }
  }
  return out;
}

/** Match an event payload's 8-byte discriminator, or null when unknown. */
export function matchAnchorEvent(payload: Buffer): FolioxEventType | null {
  if (payload.length < 8) return null;
  for (const type of BASALT_EVENT_TYPES) {
    if (payload.subarray(0, 8).equals(ANCHOR_EVENT_DISCRIMINATORS[type])) return type;
  }
  return null;
}

/**
 * Decode a full event payload (discriminator + Borsh body) for a known type.
 * Returns null when the discriminator or length does not match the layout.
 */
export function decodeAnchorEvent(type: FolioxEventType, payload: Buffer): DecodedFolioxEvent | null {
  const disc = ANCHOR_EVENT_DISCRIMINATORS[type];
  if (payload.length < disc.length + EVENT_PAYLOAD_LENGTHS[type]) return null;
  if (!payload.subarray(0, 8).equals(disc)) return null;
  const r: Reader = { buf: payload, offset: 8 };
  try {
    switch (type) {
      case "BasketCreated": {
        const event: BasketCreatedEvent = {
          type: "BasketCreated",
          basket: readPubkey(r),
          creator: readPubkey(r),
          numConstituents: readU8(r),
          shareMint: readPubkey(r),
          ts: Number(readI64(r)),
        };
        return event;
      }
      case "Minted": {
        const event: MintedEvent = {
          type: "Minted",
          basket: readPubkey(r),
          user: readPubkey(r),
          grossShares: readU64(r).toString(),
          netShares: readU64(r).toString(),
          entryFeeShares: readU64(r).toString(),
        };
        return event;
      }
      case "Redeemed": {
        const event: RedeemedEvent = {
          type: "Redeemed",
          basket: readPubkey(r),
          user: readPubkey(r),
          sharesBurned: readU64(r).toString(),
          exitFeeShares: readU64(r).toString(),
        };
        return event;
      }
      case "FeeAccrued": {
        const event: FeeAccruedEvent = {
          type: "FeeAccrued",
          basket: readPubkey(r),
          sharesMinted: readU64(r).toString(),
          elapsedSec: readU64(r).toString(),
        };
        return event;
      }
    }
  } catch {
    return null; // truncated / malformed body
  }
}

/** Decode a raw `Program data: ...` log line into a typed event, or null. */
export function decodeEventLog(line: string): DecodedFolioxEvent | null {
  const [payload] = extractProgramDataLogs([line]);
  if (!payload) return null;
  const type = matchAnchorEvent(payload);
  if (!type) return null;
  return decodeAnchorEvent(type, payload);
}

// --- create_basket instruction args ----------------------------------------

export interface CreateBasketArgs {
  nonce: string; // u64 — decimal string (BIGINT-safe)
  constituents: string[];
  weightsBps: number[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  metadataHashHex: string; // hex of [u8;32]
  seedAmounts: string[]; // u64 each — decimal strings (BIGINT-safe)
}

/**
 * Decode `create_basket` instruction data:
 *   disc(8) | nonce:u64 | constituents:Vec<Pubkey> | weights:Vec<u16> |
 *   entry:u16 | exit:u16 | mgmt:u16 | metadata:[u8;32] | seeds:Vec<u64>
 * Accepts raw bytes or the base58 string used by Solana JSON RPC responses.
 */
export function decodeCreateBasketIx(data: Buffer | string): CreateBasketArgs | null {
  const buf = typeof data === "string" ? safeBs58Decode(data) : data;
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(CREATE_BASKET_IX_DISCRIMINATOR)) {
    return null;
  }
  const r: Reader = { buf, offset: 8 };
  try {
    const nonce = readU64(r).toString();
    const nLen = readVecLen(r);
    const constituents: string[] = [];
    for (let i = 0; i < nLen; i++) constituents.push(readPubkey(r));
    const wLen = readVecLen(r);
    const weightsBps: number[] = [];
    for (let i = 0; i < wLen; i++) weightsBps.push(readU16(r));
    const entryFeeBps = readU16(r);
    const exitFeeBps = readU16(r);
    const managementFeeBps = readU16(r);
    const metadataHashHex = readFixed(r, 32).toString("hex");
    const sLen = readVecLen(r);
    const seedAmounts: string[] = [];
    for (let i = 0; i < sLen; i++) seedAmounts.push(readU64(r).toString());
    return {
      nonce,
      constituents,
      weightsBps,
      entryFeeBps,
      exitFeeBps,
      managementFeeBps,
      metadataHashHex,
      seedAmounts,
    };
  } catch {
    return null;
  }
}

function safeBs58Decode(data: string): Buffer | null {
  try {
    return Buffer.from(bs58.decode(data));
  } catch {
    return null;
  }
}

// --- account decoding -------------------------------------------------------

/**
 * Decode the treasury pubkey from a FactoryConfig account
 * (disc 8 | authority 32 | treasury 32 | ...) — programs/basket_factory/src/lib.rs:145.
 */
export function decodeFactoryTreasury(accountData: Buffer | null | undefined): string | null {
  if (!accountData || accountData.length < 8 + 32 + 32) return null;
  return new PublicKey(accountData.subarray(40, 72)).toBase58();
}
