import { describe, it, expect } from "vitest";
import { entryFee, exitFee, managementFee, splitFee } from "../backend/src/workers/feeMath";
import { computeNav, computeSharePrice, computeDrift } from "../backend/src/workers/navEngine";

describe("legacy basalt_math", () => {
  it("placeholder still passes", () => {
    expect(entryFee(1_000_000,100)).toBe(10_000);
  });
});
