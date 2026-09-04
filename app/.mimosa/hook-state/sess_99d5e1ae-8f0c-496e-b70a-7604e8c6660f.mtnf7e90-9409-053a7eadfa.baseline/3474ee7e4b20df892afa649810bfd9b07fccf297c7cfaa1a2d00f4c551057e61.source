import { PublicKey } from "@solana/web3.js";
export const PROGRAMS = {
  whitelist: new PublicKey("FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS"),
  factory: new PublicKey("3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF"),
  basket: new PublicKey("6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k"),
};
export const FACTORY_SEED = "factory";
export const BASKET_SEED = "basket";
export function scaledAmount(raw: bigint, multiplier: number, decimals: number) {
  return Number(raw) * multiplier / 10 ** decimals;
}
