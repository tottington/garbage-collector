/**
 * evaluateZone through its exported faces (zoneVerdict / primeZoneVerdicts): how a
 * zone's verdict is priced, how the potion decision is made inside the cost model, and
 * how the shared Fishy/potion/carried budget threads across zones. Encodes charter
 * defects 1 (maximize boolean misread), 11 (carried stacks aged twice), 15 (gate
 * sizing at 2 turns/fight), 16 (SKIP/obtained zones consuming the shared budget), and
 * the design invariants (never worse than gear-only, one pricing function).
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, Tools, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

describe("active res effects that expire mid-zone", () => {
  it("does not credit an effect that will lapse before the zone finishes", async () => {
    // The measured resistance includes it now, but it is not there for the whole run —
    // crediting it prices the zone a tier high with no way to hold that tier.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 60 });
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
      t.effect("Insulated", { "Cold Resistance": 3 });
      t.state.effects.set(t.mocks.Effect.get("Insulated"), 2);
    });
    g.args.resources.potionprice = 0; // inventory only: no plan can restore it
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.res).toBe(15);
    expect(v.ratePct).toBeCloseTo(8.5);
  });

  it("credits one that outlasts the zone", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 15, fishyTurns: 60 });
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
      t.effect("Insulated", { "Cold Resistance": 3 });
      t.state.effects.set(t.mocks.Effect.get("Insulated"), 500);
    });
    g.args.resources.potionprice = 0;
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    // Gear 15 plus a +3 effect that outlasts the zone: the measured 18 stands, and
    // there is nothing left to buy.
    expect(v.res).toBe(18);
    expect(v.ratePct).toBeCloseTo(10);
    expect(v.potionPlan.use).toHaveLength(0);
  });
});

describe("speculative resistance reading (charter 1)", () => {
  it("trusts the generated outfit's numbers even when maximize() returns false", async () => {
    // maximize(str, true) returns false whenever nothing beats the CURRENT outfit —
    // that is not infeasibility. 41 of 41 logged reads were misreported this way.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.state.maximizeReturn = false;
    });
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.res).toBe(18);
    expect(v.ratePct).toBeCloseTo(10);
    expect(v.go).toBe(true);
  });

  it("treats an unmet breathing requirement as unreachable even when maximize() returns true", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.specRes(18, { "Adventure Underwater": false });
      t.state.maximizeReturn = true;
    });
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.res).toBe(0);
    expect(v.ratePct).toBeCloseTo(1.7);
  });
});

describe("potion stack sizing inside the verdict (charter 15, 6)", () => {
  it("sizes the stack at the model's own turn count, not 2 turns per fight", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 15, fishyTurns: 40 });
      t.item("cold powder", {
        mall: 200,
        sale: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 1000;
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    // At res 18: 10 fights, all Fishy-covered → 10 turns + 2 slack = 12 → ONE 20-turn
    // copy. The old 2-turns-per-fight gate wanted 22 turns → two copies — a 2x charge.
    expect(v.res).toBe(18);
    expect(v.potionPlan.use).toHaveLength(1);
    expect(v.potionPlan.use[0].count).toBe(1);
    expect(v.potionCost).toBe(200);
    // Same-function invariant: the winning verdict is priced by exactly the arithmetic
    // costZone uses — hand-computed: 50,000 − 10×1,000 − 200.
    expect(v.fights).toBe(10);
    expect(v.turns).toBe(10);
    expect(v.profit).toBe(50_000 - 10_000 - 200);
  });

  it("never prices a zone worse than with no potions at all", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 15, fishyTurns: 40 });
      // The only potion is a big loser: crossing the step saves 2,000 meat of turns
      // but costs 40,000.
      t.item("cold powder", {
        mall: 40_000,
        sale: 30_000,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 50_000;
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.potionCost).toBe(0);
    expect(v.potionPlan.use).toHaveLength(0);
    expect(v.res).toBe(15);
    expect(v.ratePct).toBeCloseTo(8.5);
    // gear-only: 12 fights, Fishy-covered → 12 turns.
    expect(v.profit).toBe(50_000 - 12_000);
  });
});

describe("budget threading across zones (charter 16)", () => {
  it("lets a profitable later zone keep the Fishy a SKIP zone would have burned", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { fishyTurns: 12 });
      t.specRes({ spooky: 0, cold: 18 });
    });
    const spooky = spec(g, "spooky");
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([spooky, cold]);
    const spookyVerdict = g.economics.zoneVerdict(spooky);
    const coldVerdict = g.economics.zoneVerdict(cold);
    // spooky at res 0: 59 fights, hopeless — priced SKIP, must not spend the pool.
    expect(spookyVerdict.go).toBe(false);
    expect(spookyVerdict.willFarm).toBe(false);
    expect(coldVerdict.fishyUsed).toBe(10);
    expect(coldVerdict.turns).toBe(10);
    expect(coldVerdict.profit).toBe(50_000 - 10_000);
  });

  it("lets a later zone keep Fishy and potions a zone already won today would have reserved", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 15, fishyTurns: 100 });
      // One owned copy of an unpriceable all-element potion that sits in EVERY
      // zone's default list (pec oil): whoever reserves it first gets the only
      // usable copy. spooky's own verdict genuinely wants it (15 → 18 pays), so an
      // obtained zone that wrongly committed its plan WOULD claim it.
      t.item("pec oil", {
        sale: 100,
        count: 1,
        effect: "Oiled-Up",
        duration: 20,
        res: { all: 3 },
      });
      t.prop("_unblemishedPearlAnemoneMine", true); // spooky pearl already obtained
    });
    const spooky = spec(g, "spooky");
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([spooky, cold]);
    const spookyVerdict = g.economics.zoneVerdict(spooky);
    const coldVerdict = g.economics.zoneVerdict(cold);
    expect(spookyVerdict.willFarm).toBe(false);
    // spooky's chosen plan wanted the copy — the reserve threat is real, and only
    // willFarm=false keeps it off the ledger.
    expect(spookyVerdict.potionPlan.use).toHaveLength(1);
    // cold still sees the owned copy as its own: spent at sale value, not bought.
    expect(coldVerdict.res).toBe(18);
    expect(coldVerdict.potionCost).toBe(100);
    expect(coldVerdict.profit).toBe(50_000 - 10_000 - 100);
  });

  it("charges each farmed zone's Fishy use to the zones after it — and only that", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { fishyTurns: 12 });
      t.specRes({ spooky: 15, cold: 18 });
      // spooky gets a potion candidate that is evaluated and REJECTED (it loses);
      // evaluating it must not corrupt the budget the later zone is priced with.
      t.item("spooky powder", {
        mall: 40_000,
        sale: 30_000,
        effect: "Sheet-Faced",
        duration: 20,
        res: { spooky: 3 },
      });
    });
    g.args.resources.potionprice = 50_000;
    const spooky = spec(g, "spooky");
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([spooky, cold]);
    const spookyVerdict = g.economics.zoneVerdict(spooky);
    const coldVerdict = g.economics.zoneVerdict(cold);
    // spooky at res 15: 12 fights, pool 12 → all covered, farmed.
    expect(spookyVerdict.willFarm).toBe(true);
    expect(spookyVerdict.fishyUsed).toBe(12);
    expect(spookyVerdict.potionCost).toBe(0);
    // cold gets exactly the remainder: nothing.
    expect(coldVerdict.fishyUsed).toBe(0);
    expect(coldVerdict.turns).toBe(20);
  });
});

describe("carried potion effects (charter 11)", () => {
  it("ages an earlier zone's stack by that zone's turns exactly once", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 15, fishyTurns: 100 });
      // 25-turn all-element stack: spooky farms 10 turns, leaving 15 — enough to
      // cover cold's 12 gear-turns ONCE, but a double-aged 5 would not be.
      t.item("spooky powder", {
        mall: 100,
        sale: 50,
        effect: "Sheet-Faced",
        duration: 25,
        res: { all: 3 },
      });
    });
    g.args.resources.potionprice = 1000;
    const spooky = spec(g, "spooky");
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([spooky, cold]);
    const spookyVerdict = g.economics.zoneVerdict(spooky);
    const coldVerdict = g.economics.zoneVerdict(cold);
    expect(spookyVerdict.res).toBe(18);
    expect(spookyVerdict.potionCost).toBe(100);
    // cold rides the carried stack: res 18 with NO potion spend of its own.
    expect(coldVerdict.res).toBe(18);
    expect(coldVerdict.ratePct).toBeCloseTo(10);
    expect(coldVerdict.potionCost).toBe(0);
    expect(coldVerdict.potionPlan.use).toHaveLength(0);
  });

  it("ages a stack through EVERY intervening zone before crediting a later one", async () => {
    // Discriminates aging from not-aging (deleting the aging block entirely must
    // flip this): the aged residual falls below the third zone's gearTurns while the
    // unaged one would clear it.
    //   spooky buys a 25-turn spooky+cold potion, farms 10 turns → 15 left.
    //   hot (its effect grants no hot res, and the potion sits in no hot list) just
    //     farms 10 turns through it → 5 left.
    //   cold at 40% done needs 9 gear-turns: 5 < 9 → NO credit. Unaged 15 ≥ 9 would
    //     wrongly price cold a tier high with no potion plan to sustain it.
    const g = await loadGame((t) => {
      standardScenario(t, { fishyTurns: 100 });
      t.specRes({ spooky: 15, hot: 18, cold: 12 });
      t.item("spooky powder", {
        mall: 100,
        sale: 50,
        effect: "Sheet-Faced",
        duration: 25,
        res: { spooky: 3, cold: 3 },
      });
      t.prop("_unblemishedPearlTheBriniestDeepestsProgress", 40);
    });
    g.args.resources.potionprice = 1000;
    const spooky = spec(g, "spooky");
    const hot = spec(g, "hot");
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([spooky, hot, cold]);
    const spookyVerdict = g.economics.zoneVerdict(spooky);
    const hotVerdict = g.economics.zoneVerdict(hot);
    const coldVerdict = g.economics.zoneVerdict(cold);
    expect(spookyVerdict.res).toBe(18);
    expect(spookyVerdict.potionCost).toBe(100);
    expect(hotVerdict.willFarm).toBe(true);
    expect(hotVerdict.turns).toBe(10);
    // The stack is spent: cold prices at its own gear res and rate, 9 fights of 60%.
    expect(coldVerdict.res).toBe(12);
    expect(coldVerdict.ratePct).toBeCloseTo(6.8);
    expect(coldVerdict.fights).toBe(9);
    expect(coldVerdict.potionCost).toBe(0);
  });

  it("keeps one carried entry per effect when a later zone re-ups the same stack", async () => {
    // The dedupe half of the carried-stack contract: KoL MERGES re-applied effect
    // turns into one stack, so when a middle zone re-plans an effect an earlier zone
    // already left running, the budget must extend the one entry — two entries for
    // one Effect would both pass a later zone's filter and its resistance would be
    // credited twice, pricing that zone a full tier high with no potion plan left to
    // recover (candidateResPlans skips carried effects).
    const g = await loadGame((t) => {
      standardScenario(t, { fishyTurns: 100 });
      t.specRes({ spooky: 15, hot: 15, cold: 12 });
      // pec oil sits in every zone's default list. 21-turn all-element stack:
      //   spooky: buys 1, farms 10 turns → 11 left — one turn SHORT of hot's 12
      //     gear-turns, so hot is not told about it and plans its own copy,
      //     hitting the merge branch (the residual, aged to 1, is still alive).
      //   hot: buys 1, farms 10 turns → one entry of 1 + 21 = 22 turns.
      //   cold: needs 1 gear-turn (94% done) → the entry passes its filter once.
      t.item("pec oil", {
        mall: 100,
        sale: 50,
        effect: "Oiled-Up",
        duration: 21,
        res: { all: 3 },
      });
      t.prop("_unblemishedPearlTheBriniestDeepestsProgress", 94);
    });
    g.args.resources.potionprice = 1000;
    const spooky = spec(g, "spooky");
    const hot = spec(g, "hot");
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([spooky, hot, cold]);
    const spookyVerdict = g.economics.zoneVerdict(spooky);
    const hotVerdict = g.economics.zoneVerdict(hot);
    const coldVerdict = g.economics.zoneVerdict(cold);
    // Both earlier zones bought their own copy and farmed.
    expect(spookyVerdict.res).toBe(18);
    expect(spookyVerdict.potionCost).toBe(100);
    expect(hotVerdict.res).toBe(18);
    expect(hotVerdict.potionCost).toBe(100);
    expect(hotVerdict.willFarm).toBe(true);
    // cold credits the carried +3 exactly ONCE: 12 + 3 = 15, the 8.5% tier.
    // A duplicated entry would price it at 12 + 3 + 3 = 18 and the 10% tier.
    expect(coldVerdict.res).toBe(15);
    expect(coldVerdict.ratePct).toBeCloseTo(8.5);
    expect(coldVerdict.potionCost).toBe(0);
    expect(coldVerdict.potionPlan.use).toHaveLength(0);
  });
});

describe("Lucky! refresh economics", () => {
  it("models a free refresh as +19 covered fights and +1 trip turn", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 0 });
      t.item("11-leaf clover", { count: 1 });
      t.prop("_cloversPurchased", 3); // no hermit refills muddying the cascade
    });
    g.args.resources.luckyfishy = true;
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.refreshesUsed).toBe(1);
    expect(v.refreshCost).toBe(0);
    expect(v.fishyUsed).toBe(10);
    // 10 fights ×2 − 10 covered + 1 trip turn.
    expect(v.turns).toBe(11);
    expect(v.profit).toBe(50_000 - 11_000);
  });

  it("prices both sides of a res step from the same untouched refresh queue", async () => {
    // resStepWorthIt costs the zone twice against ONE budget; if costZone consumed the
    // queue, the with-step side would price refresh-less and the step would be refused.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 0 });
      t.item("11-leaf clover", { count: 1 });
      t.prop("_cloversPurchased", 3);
    });
    g.args.resources.luckyfishy = true;
    // without: 12 fights → refresh → 13 turns → 37,000. with: 10 → 11 turns → 39,000.
    expect(g.economics.resStepWorthIt(spec(g, "cold"), 15, 3, 0)).toBe(true);
  });
});

describe("injected valuation", () => {
  it("prices items through the host's itemValue hook", async () => {
    const g = await loadGame();
    const pearl = g.item("unblemished pearl", { sale: 1234 });
    expect(g.economics.pearlItemValue(pearl)).toBe(1234);
    g.config.configurePearls({ itemValue: () => 777 });
    expect(g.economics.pearlItemValue(pearl)).toBe(777);
  });
});

describe("forced slots in the speculation", () => {
  // The dress always wears the retro cape in the back slot, so the model must not
  // speculate resistance gear there. A run priced at 18 that dressed to 14 was exactly
  // this: the pricing maximize had the back slot free, the real one had "-back".
  const capeScenario = (t: Parameters<typeof standardScenario>[0]) => {
    standardScenario(t, { res: 18, fishyTurns: 40 });
    t.item("unwrapped knock-off retro superhero cape", { count: 1 });
    // Air by effect, so the back slot is free for the cape rather than a breathing item.
    t.active("Really Deep Breath", 50);
  };

  it("forces the cape's back slot into every speculative maximize", async () => {
    const g = await loadGame(capeScenario);
    g.economics.zoneVerdict(spec(g, "stench"));

    const speculative = g.state.log.maximizes.filter((m) => m.speculate);
    expect(speculative.length).toBeGreaterThan(0);
    for (const { modifier } of speculative) {
      expect(modifier).toContain(
        "+equip unwrapped knock-off retro superhero cape",
      );
    }
  });

  it("forces exactly the committed list, not a superset", async () => {
    // The cape case above covers under-forcing. This covers over-forcing: the model
    // must not reserve a slot the dress leaves to the maximizer.
    const g = await loadGame(capeScenario);
    const stench = spec(g, "stench");
    const forced = g.outfit.pearlForcedEquipment(
      stench,
      g.organs.liverMode(),
    ).equip;

    g.economics.zoneVerdict(stench);
    const first = g.state.log.maximizes.filter((m) => m.speculate)[0];
    const equipTerms = first.modifier.match(/\+equip /g)?.length ?? 0;
    expect(equipTerms).toBe(forced.length);
    for (const item of forced) {
      expect(first.modifier).toContain(`+equip ${item}`);
    }
  });
});

/** Mean of the 12-15 HP/MP regen roll the maximizer scores a regen accessory on. */
const REGEN_MEAN = 13.5;
/** Peridot of Peril's score under the 0.05 regen weights: the bar resistance must clear. */
const REGEN_ACCESSORY_SCORE = 1.35;

/** The expression's weight terms. Equipment names are not weights, so they are dropped. */
function weightTerms(modifier: string): string {
  return modifier
    .split(",")
    .map((t) => t.trim())
    .filter((t) => !/equip/i.test(t))
    .join(", ");
}

/** No item-drop weight in any comma-separated term, whatever the casing. */
function expectNoItemWeight(modifier: string): void {
  expect(weightTerms(modifier)).not.toMatch(/\bitem\b/i);
}

/**
 * Pins the objective's shape: no item weight, and one resistance point weighted above the
 * regen score a single accessory carries. The floor is absolute as well as relative, so
 * deleting the tiebreakers cannot make the bound vacuous.
 */
function expectResistanceDominates(modifier: string, key = "cold"): void {
  expectNoItemWeight(modifier);
  const terms = weightTerms(modifier);
  const weight = Number(
    terms.match(new RegExp(`(?:^|,\\s*)([\\d.]+) ${key} res`))?.[1],
  );
  const tiebreakers = [
    ...terms.matchAll(
      new RegExp(`(?:^|,\\s*)([\\d.]+)\\s+(?!${key} res)`, "g"),
    ),
  ].map((m) => Number(m[1]));
  const carried = tiebreakers.reduce((a, b) => a + b, 0) * REGEN_MEAN;
  expect(weight).toBeGreaterThan(Math.max(REGEN_ACCESSORY_SCORE, carried));
}

describe("resistance outweighs the outfit's tiebreakers", () => {
  it("carries no item weight and keeps resistance above a regen accessory", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
    });
    g.economics.zoneVerdict(spec(g, "cold"));

    const speculative = g.state.log.maximizes.filter((m) => m.speculate);
    expect(speculative.length).toBeGreaterThan(0);
    for (const { modifier } of speculative) {
      expectResistanceDominates(modifier);
    }
  });

  it("keeps damage able to outbid resistance while overdrunk", async () => {
    // Attack-only combat aborts unless the weapon one-shots, so resistance must not
    // dominate the weapon-damage terms there.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.state.inebriety = 16;
      t.item("Drunkula's wineglass", { count: 1 });
    });
    const objective = g.outfit.pearlResObjective(spec(g, "cold"), true);
    expect(objective.startsWith("1 cold res")).toBe(true);
    // Neither overdrunk arm may carry an item weight either.
    expectNoItemWeight(objective + g.outfit.pearlOutfitWeights(true, false));
    expectNoItemWeight(objective + g.outfit.pearlOutfitWeights(true, true));
  });
});

describe("forced gear must be wearable and match the dress", () => {
  it("does not price a zone at zero because owned gear is restricted out", async () => {
    // The speculation drops a configuration whose forced gear cannot be equipped. An
    // owned-but-Standard-restricted cape would zero the zone and gate it out entirely.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.item("unwrapped knock-off retro superhero cape", {
        count: 1,
        canEquip: false,
      });
      t.active("Really Deep Breath", 50);
    });
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.res).toBe(18);
    expect(v.go).toBe(true);
  });

  it("prices on predicted air while the dress reads current air", async () => {
    // A ballast turtle grants air minutes later, so the model must free the back slot
    // for the cape while the dress, running before that, still owes it to breathing.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.item("unwrapped knock-off retro superhero cape", { count: 1 });
      t.item("ballast turtle", { count: 1 });
    });
    const cold = spec(g, "cold");
    g.economics.zoneVerdict(cold);
    const speculative = g.state.log.maximizes.filter((m) => m.speculate);
    const capeTerm = "+equip unwrapped knock-off retro superhero cape";

    // Predicted air is true, so the model commits the back slot to the cape.
    expect(speculative.some((m) => m.modifier.includes(capeTerm))).toBe(true);
    // Current air is false and no other breathing gear is owned, so the dress does not.
    const dressed = (g.outfit.buildPearlOutfit(cold).equip ?? []).map(
      (i) => `${i}`,
    );
    expect(dressed).not.toContain("unwrapped knock-off retro superhero cape");
  });
});

describe("outfit-override pieces still pass the avoid filter", () => {
  async function overrideGame() {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 40 }),
    );
    const bottle = g.item("broken champagne bottle", { count: 1 });
    const sweatpants = g.item("old sweatpants", { count: 1 });
    g.state.outfits.set("coldfit", [bottle, sweatpants]);
    g.args.overrides.coldoutfit = "coldfit";
    return g;
  }

  it("leaves override pieces to the caller, which filters the avoided ones", async () => {
    // The helper must not pre-load them: buildPearlOutfit owns the avoid filter, and a
    // forced avoided piece would be worn while the log claimed it was dropped.
    const g = await overrideGame();
    const forced = g.outfit.pearlForcedEquipment(
      spec(g, "cold"),
      g.organs.liverMode(),
    ).equip;
    const names = forced.map((i) => `${i}`);
    expect(names).not.toContain("broken champagne bottle");
    expect(names).not.toContain("old sweatpants");
  });

  it("keeps the avoided piece out of the dressed outfit", async () => {
    const g = await overrideGame();
    const built = g.outfit.buildPearlOutfit(spec(g, "cold"));
    const names = (built.equip ?? []).map((i) => `${i}`);
    expect(names).toContain("old sweatpants");
    expect(names).not.toContain("broken champagne bottle");
  });
});

describe("the dressed outfit carries the same objective as the model", () => {
  it("weights resistance in buildPearlOutfit's own modifier", async () => {
    // The model's expression is asserted elsewhere; this pins the one the run dresses
    // with, which is the string that actually decides the accessory slot.
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 40 }),
    );
    const built = g.outfit.buildPearlOutfit(spec(g, "cold"));
    const modifier = Array.isArray(built.modifier)
      ? built.modifier.join(", ")
      : (built.modifier ?? "");
    expectResistanceDominates(modifier);
  });

  it("does not force a cape it cannot equip, in the dress as in the model", async () => {
    // The model drops a configuration whose forced gear cannot be worn. If the dress
    // forced it anyway, grimoire would throw on a zone the model had just approved.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.item("unwrapped knock-off retro superhero cape", {
        count: 1,
        canEquip: false,
      });
      t.active("Really Deep Breath", 50);
    });
    const cold = spec(g, "cold");
    const forced = g.outfit.pearlForcedEquipment(
      cold,
      g.organs.liverMode(),
    ).equip;
    const built = g.outfit.buildPearlOutfit(cold);
    const dressed = (built.equip ?? []).map((i) => `${i}`);
    expect(forced.map((i) => `${i}`)).not.toContain(
      "unwrapped knock-off retro superhero cape",
    );
    expect(dressed).not.toContain("unwrapped knock-off retro superhero cape");
  });
});

describe("the fight is priced with the outfit the run will dress", () => {
  /**
   * Myst 600 puts raw Saucegeyser at 300 per cast — three casts on an 800 HP monster —
   * while the Medal's two lantern components lift it to 900 and one cast. The model
   * forces that Medal into the resistance speculation, so it has to collect the damage
   * it just paid an accessory slot for.
   */
  function lanternScenario(t: Tools): void {
    standardScenario(t, { res: 18, fishyTurns: 60 });
    t.state.buffedStats.Mysticality = 600;
    t.item("Congressional Medal of Insanity", { count: 1 });
    t.item("Doc Galaktik's Invigorating Tonic", { npc: 100 });
    t.skill("Saucegeyser", { mp: 20 });
  }

  it("counts the lantern gear it forces, instead of what happened to be worn", async () => {
    const g = await loadGame(lanternScenario);
    const cold = spec(g, "cold");
    const forced = g.outfit.pearlForcedEquipment(
      cold,
      g.organs.liverMode(),
    ).equip;
    expect(forced.map((i) => `${i}`)).toContain(
      "Congressional Medal of Insanity",
    );
    // 10 fights x 1 cast x 20 MP x 10 meat/MP. Pricing the pre-dress state instead
    // would bill three casts, and the zone would read 4,000 meat poorer than it runs.
    expect(g.economics.zoneVerdict(cold).mpCost).toBe(2000);
  });

  it("counts only the lanterns the outfit forces, not every lantern owned", async () => {
    // The one-shot needs two components and the Medal alone covers them, so the spare
    // off-hand gear is never equipped. Pricing the whole owned pile would overstate the
    // damage of an outfit the run does not dress.
    const g = await loadGame((t) => {
      lanternScenario(t);
      t.item("petrified wood water purifier", { count: 1 });
      t.item("meteorb", { count: 1 });
    });
    // perCast is the discriminating figure: the owned pile reads 1,800, which still
    // one-shots, so a cast count could not tell the two apart.
    expect(g.outfit.pearlDamagePlan(spec(g, "cold")).perCast).toBe(900);
  });

  it("does not credit a cape the current air state has not freed the back slot for", async () => {
    // Predicted air commits the back slot to the cape, but the dress runs on current
    // air and owes it to breathing. Charging the slot is right; buying a cast with it
    // is not, so the damage credit reads current air.
    const g = await loadGame((t) => {
      lanternScenario(t);
      t.item("unwrapped knock-off retro superhero cape", { count: 1 });
      t.item("ballast turtle", { count: 1 });
    });
    const cold = spec(g, "cold");
    g.economics.zoneVerdict(cold);
    const capeTerm = "+equip unwrapped knock-off retro superhero cape";
    expect(
      g.state.log.maximizes
        .filter((m) => m.speculate)
        .some((m) => m.modifier.includes(capeTerm)),
    ).toBe(true);
    expect(g.outfit.pearlDamagePlan(cold).perCast).toBe(900);
  });

  it("credits the cape once the air effect is actually up", async () => {
    const g = await loadGame((t) => {
      lanternScenario(t);
      t.item("unwrapped knock-off retro superhero cape", { count: 1 });
      t.active("Really Deep Breath", 50);
    });
    expect(g.outfit.pearlDamagePlan(spec(g, "cold")).perCast).toBe(1200);
  });

  it("counts an override outfit's own lantern gear", async () => {
    // pearlForcedEquipment returns early for an override and never selects lanterns, so
    // the pieces have to be folded in or every override zone prices at zero damage gear.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 60 });
      t.state.buffedStats.Mysticality = 600;
      const medal = t.item("Congressional Medal of Insanity", { count: 1 });
      t.state.outfits.set("coldfit", [medal]);
    });
    g.args.overrides.coldoutfit = "coldfit";
    const plan = g.outfit.pearlDamagePlan(spec(g, "cold"));
    expect(plan.perCast).toBe(900);
    expect(plan.casts).toBe(1);
  });

  it("does not credit an override outfit's cape, whose kill mode the dress never sets", async () => {
    // buildPearlOutfit's override branch sets only the parka mode, so the cape keeps
    // whatever the account left it on. Crediting a lantern there buys a cast for free.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 60 });
      t.state.buffedStats.Mysticality = 600;
      const medal = t.item("Congressional Medal of Insanity", { count: 1 });
      const cape = t.item("unwrapped knock-off retro superhero cape", {
        count: 1,
      });
      t.state.outfits.set("coldfit", [medal, cape]);
    });
    g.args.overrides.coldoutfit = "coldfit";
    expect(g.outfit.pearlDamagePlan(spec(g, "cold")).perCast).toBe(900);
  });

  it("drops override pieces the dress refuses before pricing them", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 60 });
      const medal = t.item("Congressional Medal of Insanity", { count: 1 });
      const bottle = t.item("broken champagne bottle", { count: 1 });
      t.state.outfits.set("coldfit", [medal, bottle]);
    });
    g.args.overrides.coldoutfit = "coldfit";
    const planned = g.outfit
      .pearlPlannedEquipment(spec(g, "cold"), g.organs.liverMode())
      .map((i) => `${i}`);
    expect(planned).toContain("Congressional Medal of Insanity");
    expect(planned).not.toContain("broken champagne bottle");
  });

  it("does not credit the cape when the plan puts it in hold mode", async () => {
    // Myst 100 leaves the cape's own build at four casts, so capeMode picks hold — the
    // stun, not the lantern. Only the kill mode duplicates the spell.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 60 });
      t.state.buffedStats.Mysticality = 100;
      t.item("unwrapped knock-off retro superhero cape", { count: 1 });
      t.active("Really Deep Breath", 50);
    });
    expect(g.outfit.pearlDamagePlan(spec(g, "cold")).perCast).toBe(100);
  });

  it("prices each zone against its own monster HP", async () => {
    // 380 a cast splits the 750 HP zones from the 800 HP ones: two casts against
    // Anemone Mine, three against The Briniest Deepests.
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 60 });
      t.state.buffedStats.Mysticality = 800;
    });
    expect(g.outfit.pearlDamagePlan(spec(g, "spooky")).casts).toBe(2);
    expect(g.outfit.pearlDamagePlan(spec(g, "cold")).casts).toBe(3);
  });

  it("does not credit lantern gear the organ extenders crowd out", async () => {
    // Required extenders take their slots first, so a Medal with nowhere to sit is not
    // damage — and the resistance charge already assumes those slots are spoken for.
    const g = await loadGame((t) => {
      lanternScenario(t);
      t.state.fullness = 17; // limit 15, so both stomach extenders are required
      t.state.spleenUse = 16; // and one spleen extender
      for (const name of [
        "angelbone chopsticks",
        "devilbone corset",
        "angelbone totem",
      ]) {
        t.state.itemSlots.set(
          t.item(name, { count: 1 }),
          t.mocks.Slot.get("acc1"),
        );
      }
    });
    expect(g.outfit.pearlDamagePlan(spec(g, "cold")).perCast).toBe(300);
  });

  it("does not credit lantern gear it cannot equip", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 60 });
      t.state.buffedStats.Mysticality = 600;
      t.item("Congressional Medal of Insanity", { count: 1, canEquip: false });
    });
    expect(g.outfit.pearlDamagePlan(spec(g, "cold")).perCast).toBe(300);
  });

  it("prices the liver mode it is asked about", async () => {
    // Overdrunk skips lantern gear entirely: the wineglass kills spells.
    const g = await loadGame(lanternScenario);
    const cold = spec(g, "cold");
    expect(g.outfit.pearlDamagePlan(cold, "sober").perCast).toBe(900);
    expect(g.outfit.pearlDamagePlan(cold, "wineglass").perCast).toBe(300);
  });
});
