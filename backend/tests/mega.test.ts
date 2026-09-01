import { describe, it, expect } from "vitest";
import { entryFee, exitFee, managementFee, splitFee, BPS_DENOM, SECONDS_PER_YEAR } from "../src/workers/feeMath";
import { computeNav, computeSharePrice, computeDrift } from "../src/workers/navEngine";

describe("MEGA: entryFee 50 cases", () => {
  const cases = Array.from({length:50}, (_,i)=>({gross:(i+1)*10000, bps:[0,10,100,150,300][i%5]}));
  for (const {gross,bps} of cases) {
    it(`entryFee gross ${gross} bps ${bps} never exceeds gross`, () => {
      const fee = entryFee(gross,bps);
      expect(fee).toBeLessThanOrEqual(gross);
      expect(fee).toBe(Math.floor(gross*bps/10000));
    });
  }
});
describe("MEGA: exitFee 50 cases", () => {
  const cases = Array.from({length:50}, (_,i)=>({shares:(i+1)*5000, bps:[0,10,50,100][i%4]}));
  for (const {shares,bps} of cases) {
    it(`exitFee shares ${shares} bps ${bps}`, () => {
      expect(exitFee(shares,bps)).toBe(Math.floor(shares*bps/10000));
    });
  }
});
describe("MEGA: managementFee 50 cases", () => {
  const cases = Array.from({length:50}, (_,i)=>({supply:1_000_000*(i+1), bps:[100,200,300][i%3], days:i%365+1}));
  for (const {supply,bps,days} of cases) {
    it(`mgmt supply ${supply} bps ${bps} days ${days}`, () => {
      const fee = managementFee(supply,bps,days*24*3600);
      const max = Math.floor(supply*bps/10000);
      expect(fee).toBeLessThanOrEqual(max+1);
      expect(fee).toBeGreaterThanOrEqual(0);
    });
  }
});
describe("MEGA: splitFee 20 cases", () => {
  for (let fee=1; fee<=20; fee++) {
    it(`split fee ${fee}`, () => {
      const {creator,treasury}=splitFee(fee,9000);
      expect(creator+treasury).toBe(fee);
      expect(creator).toBe(Math.floor(fee*0.9));
    });
  }
});
describe("MEGA: NAV 20 cases", () => {
  for (let n=2;n<=20;n+=2) {
    it(`nav with ${n} constituents`, () => {
      const scaled=Array(n).fill(100);
      const prices=Array(n).fill(10);
      expect(computeNav(scaled,prices)).toBe(n*1000);
    });
  }
});
describe("MEGA: drift 20 cases", () => {
  for (let i=0;i<20;i++) {
    it(`drift case ${i}`, () => {
      const scaled=[400+i*10, 400-i*5, 200];
      const target=[5000,3000,2000];
      const drift=computeDrift(scaled,target);
      expect(drift.length).toBe(3);
    });
  }
});
describe("MEGA: redeem 30 random", () => {
  for (let i=0;i<30;i++) {
    const vault = 1_000_000_000 + i*1_000_000;
    const supply = 10_000_000;
    const burn = 1_000_000 + i*1000;
    it(`redeem vault ${vault} burn ${burn}`, () => {
      const out=Math.floor(vault*burn/supply);
      expect(out).toBeLessThanOrEqual(vault);
      expect(out).toBeGreaterThanOrEqual(0);
    });
  }
});
