import { PublicKey } from "@solana/web3.js";
export const PROGRAMS = {
  whitelist: new PublicKey("bdEDPr9KGtkSABS8Sg3gWeJKyQEaTQVaBRvCu38YMNz"),
  factory: new PublicKey("sXShikYX7G5n3S3qp78RWQBxh2YJARLvufiCoaxjAyq"),
  basket: new PublicKey("37VPGtd57kXJ1HvH1xvdZr1y3s4KXj9pP2o6GdYLgbb1"),
};
export const FACTORY_SEED = "factory";
export const BASKET_SEED = "basket";
export function scaledAmount(raw: bigint, multiplier: number, decimals: number) {
  return Number(raw) * multiplier / 10 ** decimals;
}
