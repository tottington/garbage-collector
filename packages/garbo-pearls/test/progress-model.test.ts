import { describe, expect, it } from "vitest";

import { loadGame, standardScenario } from "./support/harness";

describe("progressRatePct", () => {
  it("holds the documented step boundaries: 0, 2, 3, 17, 18, 21 res", async () => {
    const g = await loadGame();
    const rate = g.zones.progressRatePct;
    expect(rate(0)).toBeCloseTo(1.7); // floored at the base rate
    expect(rate(2)).toBeCloseTo(1.7); // below the first step
    expect(rate(3)).toBeCloseTo(1.7); // first step IS the floor
    expect(rate(5)).toBeCloseTo(1.7);
    expect(rate(6)).toBeCloseTo(3.4); // second step
    expect(rate(17)).toBeCloseTo(8.5); // one short of the cap
    expect(rate(18)).toBeCloseTo(10); // cap: 1.7*6 = 10.2 clamped to 10
    expect(rate(21)).toBeCloseTo(10); // beyond the cap buys nothing
  });
});

describe("turnsForFights", () => {
  it("prices Fishy-covered fights at 1 turn and the rest at 2", async () => {
    const g = await loadGame((t) => t.fishy(5));
    expect(g.economics.turnsForFights(3)).toBe(3);
    expect(g.economics.turnsForFights(5)).toBe(5);
    expect(g.economics.turnsForFights(8)).toBe(5 + 3 * 2);
  });

  it("counts an unused fishy pipe toward the pool", async () => {
    const g = await loadGame((t) => {
      t.fishy(5);
      t.item("fishy pipe", { count: 1 });
    });
    expect(g.economics.turnsForFights(20)).toBe(15 + 5 * 2);
  });

  it("does not count a pipe already smoked today", async () => {
    const g = await loadGame((t) => {
      t.fishy(5);
      t.item("fishy pipe", { count: 1 });
      t.prop("_fishyPipeUsed", true);
    });
    expect(g.economics.turnsForFights(20)).toBe(5 + 15 * 2);
  });
});

describe("zone pricing baseline", () => {
  it("prices the standard scenario exactly (fights, turns, profit)", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 40 }),
    );
    const cold = g.zones.PEARLS.find((p) => p.key === "cold")!;
    const v = g.economics.zoneVerdict(cold);
    expect(v.ratePct).toBeCloseTo(10);
    expect(v.fights).toBe(10);
    expect(v.fishyUsed).toBe(10);
    expect(v.turns).toBe(10);
    expect(v.profit).toBe(50_000 - 10_000);
    expect(v.go).toBe(true);
  });
});
