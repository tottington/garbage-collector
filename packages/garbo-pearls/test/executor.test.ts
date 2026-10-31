/**
 * topUpRes / executeResPlan: how an approved potion plan is actually spent. Encodes
 * charter defects 3 (unpriceable items reaching buy / buy with no price cap), 4
 * (per-copy limits derived from whole-plan cost), 7 (all-or-nothing must cover buying,
 * not just drinking), 8 (re-issuing a doomed purchase every fight), 9 (a shortfall
 * stranding the cheap members), 10 (a spend ledger blocking legitimate mid-zone
 * re-ups), 12 (0×Infinity NaN), and 14 (the pays-then-declines-to-drink cost-base
 * split around the buy loop).
 *
 * Wiring mirrors pearls.ts exactly: worthIt is resStepWorthIt through the real model,
 * turnsFor is turnsForFights.
 */
import { describe, expect, it, vi } from "vitest";

import type { ResPotionPlan } from "../src/economics";
import type { PearlSpec } from "../src/zones";

import { Game, Tools, loadGame, standardScenario } from "./support/harness";

function coldSpec(g: Game): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === "cold");
  if (!found) throw new Error("no cold spec");
  return found;
}

/**
 * Baseline executor scenario: the player is dressed to 15 cold res, Fishy covers
 * everything, so crossing to 18 saves exactly 2 fights = 2,000 meat of turns.
 */
function executorScenario(t: Tools): void {
  standardScenario(t, { res: 15, fishyTurns: 100 });
  t.playerRes("cold", 15);
}

type Wired = {
  g: Game;
  spec: PearlSpec;
  worthIt: ReturnType<
    typeof vi.fn<(from: number, gain: number, cost: number) => boolean>
  >;
  run: (plan: ResPotionPlan) => void;
};

function wire(g: Game): Wired {
  const spec = coldSpec(g);
  const worthIt = vi.fn((from: number, gain: number, cost: number) =>
    g.economics.resStepWorthIt(spec, from, gain, cost),
  );
  return {
    g,
    spec,
    worthIt,
    run: (plan) =>
      g.mood.topUpRes(spec, plan, worthIt, g.economics.turnsForFights),
  };
}

const planWith = (
  res: number,
  use: {
    item: ResPotionPlan["use"][number]["item"];
    count: number;
    buyPrice: number;
    saleValue: number;
  }[],
): ResPotionPlan => ({
  res,
  cost: use.reduce((acc, u) => acc + u.count * u.buyPrice, 0),
  use,
});

describe("unbuyable items (charter 3)", () => {
  it("never sends an unpriceable item to buy()", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 100_000;
    const potion = g.item("cold powder", {
      sale: 50,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    const { run } = wire(g);
    run(
      planWith(18, [
        { item: potion, count: 1, buyPrice: Infinity, saleValue: 50 },
      ]),
    );
    expect(g.state.log.buys).toHaveLength(0);
    expect(g.state.log.uses).toHaveLength(0);
  });

  it("every purchase carries a positive finite price cap — never mafia's 0 = uncapped", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 1000;
    const potion = g.item("cold powder", {
      mall: 500,
      sale: 100,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    const { run } = wire(g);
    run(
      planWith(18, [{ item: potion, count: 1, buyPrice: 500, saleValue: 100 }]),
    );
    expect(g.state.log.buys.length).toBeGreaterThan(0);
    for (const call of g.state.log.buys) {
      expect(Number.isFinite(call.limit)).toBe(true);
      expect(call.limit ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("per-copy buy limits (charter 4)", () => {
  it("caps each purchase at that item's own price, not a whole-plan derived figure", async () => {
    const g = await loadGame((t) => {
      executorScenario(t);
      t.playerRes("cold", 12);
    });
    g.args.resources.potionprice = 5000;
    const pricey = g.item("cyan seashell", {
      mall: 1500,
      sale: 100,
      effect: "Cyan Seas",
      duration: 20,
      res: { cold: 3 },
    });
    const cheap = g.item("cold powder", {
      mall: 100,
      sale: 10,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    const { run } = wire(g);
    run(
      planWith(18, [
        { item: pricey, count: 1, buyPrice: 1500, saleValue: 100 },
        { item: cheap, count: 1, buyPrice: 100, saleValue: 10 },
      ]),
    );
    const priceyBuy = g.state.log.buys.find((b) => b.item === pricey);
    const cheapBuy = g.state.log.buys.find((b) => b.item === cheap);
    expect(priceyBuy?.limit).toBe(1500);
    expect(cheapBuy?.limit).toBe(100);
    // Both landed, both drunk.
    expect(g.state.log.uses.map((u) => u.item)).toEqual(
      expect.arrayContaining([pricey, cheap]),
    );
  });
});

describe("all-or-nothing spans buying (charter 7)", () => {
  it("spends nothing when the affordable remainder no longer crosses a step", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 1000;
    // Both +2 potions are needed to cross 15 → 18; only one is obtainable.
    const gettable = g.item("cold powder", {
      mall: 100,
      sale: 10,
      effect: "Insulated",
      duration: 20,
      res: { cold: 2 },
    });
    const unbuyable = g.item("cyan seashell", {
      sale: 10,
      effect: "Cyan Seas",
      duration: 20,
      res: { cold: 2 },
    });
    const { run } = wire(g);
    run(
      planWith(18, [
        { item: unbuyable, count: 1, buyPrice: Infinity, saleValue: 10 },
        { item: gettable, count: 1, buyPrice: 100, saleValue: 10 },
      ]),
    );
    // Meat spent with nothing drunk — or a lone +2 drunk for no tier — both forbidden.
    expect(g.state.log.buys).toHaveLength(0);
    expect(g.state.log.uses).toHaveLength(0);
  });
});

describe("shortfalls (charter 8, 9)", () => {
  it("remembers an empty mall instead of re-issuing the doomed purchase every fight", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 1000;
    const potion = g.item("cold powder", {
      mall: 500,
      sale: 100,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    g.state.buyImpl = () => 0; // listed price, but the mall never delivers
    const { run } = wire(g);
    const plan = planWith(18, [
      { item: potion, count: 1, buyPrice: 500, saleValue: 100 },
    ]);
    run(plan);
    expect(g.state.log.buys).toHaveLength(1);
    run(plan); // next fight's pass
    expect(g.state.log.buys).toHaveLength(1); // not re-issued
    expect(g.state.log.uses).toHaveLength(0);
  });

  it("a failed pricey member does not strand a cheap member that still pays alone", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 5000;
    const pricey = g.item("cyan seashell", {
      mall: 1500,
      sale: 100,
      effect: "Cyan Seas",
      duration: 20,
      res: { cold: 3 },
    });
    const cheap = g.item("cold powder", {
      mall: 100,
      sale: 10,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    // The pricey mall row is empty; the cheap one fills.
    const defaultBuy = g.state.buyImpl;
    g.state.buyImpl = (item, count, limit) =>
      item === pricey ? 0 : defaultBuy(item, count, limit);
    const { run } = wire(g);
    run(
      planWith(18, [
        { item: pricey, count: 1, buyPrice: 1500, saleValue: 100 },
        { item: cheap, count: 1, buyPrice: 100, saleValue: 10 },
      ]),
    );
    // The loop went on past the failure and the cheap member (which crosses 15 → 18
    // alone) was still bought and drunk.
    expect(g.state.log.buys.map((b) => b.item)).toEqual([pricey, cheap]);
    expect(g.state.log.uses.map((u) => u.item)).toEqual([cheap]);
  });
});

describe("cost bases around the buy loop (charter 14, 12)", () => {
  it("does not re-charge sunk purchases when deciding whether to drink", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 5000;
    // Step saves 2,000; ask 1,900. Any double-charge after the buy (the ask again, or
    // the 1,200 sale value) flips the drink decision to a refusal — meat paid, nothing
    // drunk, which is the shipped defect.
    const potion = g.item("cold powder", {
      mall: 1900,
      sale: 1200,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    const { worthIt, run } = wire(g);
    run(
      planWith(18, [
        { item: potion, count: 1, buyPrice: 1900, saleValue: 1200 },
      ]),
    );
    expect(g.state.log.buys).toHaveLength(1);
    expect(g.state.log.uses.map((u) => u.item)).toEqual([potion]);
    expect(worthIt).toHaveBeenCalledTimes(2);
    // First gate: the purchase at its ask. Second gate: only what is still forgone —
    // nothing was owned, so nothing.
    expect(worthIt.mock.calls[0][2]).toBe(1900);
    expect(worthIt.mock.calls[1][2]).toBe(0);
  });

  it("charges owned copies at sale value on both sides, with no NaN from unpriceables", async () => {
    const g = await loadGame(executorScenario);
    // Owned copy of an unpriceable potion: spendable, charged at its sale value.
    const potion = g.item("cold powder", {
      sale: 300,
      count: 1,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    const { worthIt, run } = wire(g);
    run(
      planWith(18, [
        { item: potion, count: 1, buyPrice: Infinity, saleValue: 300 },
      ]),
    );
    expect(g.state.log.buys).toHaveLength(0);
    expect(g.state.log.uses.map((u) => u.item)).toEqual([potion]);
    for (const call of worthIt.mock.calls) {
      expect(Number.isNaN(call[2])).toBe(false);
    }
    expect(worthIt.mock.calls[0][2]).toBe(300);
    expect(worthIt.mock.calls[1][2]).toBe(300);
  });
});

describe("topUpFamiliarWeight worthIt gate", () => {
  async function famWeightGame(potionSale: number) {
    const g = await loadGame((t) => {
      executorScenario(t);
      // Weight-scaled res familiar out, one owned underwater weight potion. The
      // familiar's step function: +3 cold res at 30 lbs, nothing below.
      t.state.currentFamiliar = t.mocks.Familiar.get("Exotic Parrot");
      t.state.familiarModImpl = (_fam, _mod, weight) => (weight >= 30 ? 3 : 0);
      t.item("temporary teardrop tattoo", {
        sale: potionSale,
        count: 1,
        effect: "Crocodile Tear",
        duration: 15,
      });
      t.effect("Crocodile Tear", { "Familiar Weight": 10 });
    });
    return g;
  }

  it("spends the potion when the res it buys beats its sale value", async () => {
    const g = await famWeightGame(500); // step saves 2,000 meat of turns
    const spec = coldSpec(g);
    g.mood.topUpFamiliarWeight(
      spec,
      (from, gain, cost) => g.economics.resStepWorthIt(spec, from, gain, cost),
      g.economics.turnsForFights,
    );
    expect(g.state.log.uses.map((u) => String(u.item))).toEqual([
      "temporary teardrop tattoo",
    ]);
  });

  it("keeps the potion when its sale value exceeds the turns saved", async () => {
    const g = await famWeightGame(3000); // step saves only 2,000
    const spec = coldSpec(g);
    g.mood.topUpFamiliarWeight(
      spec,
      (from, gain, cost) => g.economics.resStepWorthIt(spec, from, gain, cost),
      g.economics.turnsForFights,
    );
    expect(g.state.log.uses).toHaveLength(0);
  });

  it("takes the cheap potion alone when the expensive one cannot pay its own way", async () => {
    // Teardrop alone (+10 lbs) reaches the 30 lb step; sea grease (+5) adds nothing more
    // but would drag the combined sale value past what the step is worth.
    const g = await loadGame((t) => {
      executorScenario(t);
      t.state.currentFamiliar = t.mocks.Familiar.get("Exotic Parrot");
      t.state.familiarModImpl = (_fam, _mod, weight) => (weight >= 30 ? 3 : 0);
      t.item("temporary teardrop tattoo", {
        sale: 500,
        count: 1,
        effect: "Crocodile Tear",
        duration: 15,
      });
      t.effect("Crocodile Tear", { "Familiar Weight": 10 });
      t.item("sea grease", {
        sale: 3000,
        count: 1,
        effect: "Greased-Up Familiar",
        duration: 15,
      });
      t.effect("Greased-Up Familiar", { "Familiar Weight": 5 });
    });
    const spec = coldSpec(g);
    g.mood.topUpFamiliarWeight(
      spec,
      (from, gain, cost) => g.economics.resStepWorthIt(spec, from, gain, cost),
      g.economics.turnsForFights,
    );
    // All-or-nothing would spend nothing here: 3,500 of sale value against 2,000 saved.
    expect(g.state.log.uses.map((u) => String(u.item))).toEqual([
      "temporary teardrop tattoo",
    ]);
  });

  it("never spends when the extra pounds buy no resistance step", async () => {
    const g = await famWeightGame(1);
    g.state.familiarModImpl = () => 0; // flat: weight buys nothing
    const spec = coldSpec(g);
    g.mood.topUpFamiliarWeight(
      spec,
      () => true, // even a permissive gate must not be consulted for zero gain
      g.economics.turnsForFights,
    );
    expect(g.state.log.uses).toHaveLength(0);
  });
});

describe("stack sizing and re-ups (charter 6, 10, 15)", () => {
  it("buys only what the pearl's remaining turns need, even when the plan carries more", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 1000;
    const potion = g.item("cold powder", {
      mall: 200,
      sale: 100,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    const { run } = wire(g);
    // The gate approved 5 copies; with Fishy covering all 10 fights the executor needs
    // 12 turns of coverage → a single 20-turn copy.
    run(
      planWith(18, [{ item: potion, count: 5, buyPrice: 200, saleValue: 100 }]),
    );
    expect(g.state.log.buys).toHaveLength(1);
    expect(g.state.log.buys[0].count).toBe(1);
    expect(g.state.log.uses).toEqual([{ item: potion, count: 1 }]);
  });

  it("permits a legitimate mid-zone re-up after the stack expires (charter 10)", async () => {
    const g = await loadGame(executorScenario);
    g.args.resources.potionprice = 1000;
    const potion = g.item("cold powder", {
      mall: 200,
      sale: 100,
      effect: "Insulated",
      duration: 20,
      res: { cold: 3 },
    });
    const { g: game, run } = wire(g);
    const plan = planWith(18, [
      { item: potion, count: 1, buyPrice: 200, saleValue: 100 },
    ]);
    run(plan);
    expect(game.state.log.uses).toHaveLength(1);
    // Mid-zone, later: the stack ran out with 40% of the pearl still to farm.
    game.state.effects.delete(game.mocks.Effect.get("Insulated"));
    game.prop("_unblemishedPearlTheBriniestDeepestsProgress", 60);
    run(plan);
    // No cumulative ledger stops the second spend: it still pays on its own terms.
    expect(game.state.log.uses).toHaveLength(2);
  });
});
