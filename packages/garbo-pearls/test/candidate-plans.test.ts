/**
 * candidateResPlans: which potion combinations get offered to the cost model, and at
 * what price. Encodes charter defects 2 (sale value used as purchase price), 3
 * (unpriceable items reaching buy), 5 (prefix-only search shutting out cheap later
 * items), 12 (0×Infinity NaN voiding plans), and 18 (paying for step-free gains).
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, loadGame, standardScenario } from "./support/harness";

function coldSpec(g: Game): PearlSpec {
  const spec = g.zones.PEARLS.find((p) => p.key === "cold");
  if (!spec) throw new Error("no cold spec");
  return spec;
}

function plansFor(
  g: Game,
  startRes: number,
  remainingPct = 100,
  reserved = new Map(),
) {
  // turnsNeeded is left to its default: the executor's live-pool arithmetic, which in
  // these scenarios (no Fishy) is the plain 2-turns-per-fight figure.
  return g.economics.candidateResPlans(
    coldSpec(g),
    startRes,
    remainingPct,
    reserved,
  );
}

describe("candidateResPlans purchase pricing (charter 2, 3, 12)", () => {
  it("prices purchases at the mall ask, not the sale value", async () => {
    // The mall-floor shape of the original defect: ask 100, sale value ~10.
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        sale: 10,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 150;
    const plans = plansFor(g, 15);
    expect(plans).toHaveLength(1);
    const [plan] = plans;
    // 10 fights at the capped rate, 2 turns each with no Fishy, +2 slack → 22 turns
    // → 2 copies of a 20-turn potion, at 100 meat each — the ask, not the sale value.
    expect(plan.res).toBe(18);
    expect(plan.use[0].buyPrice).toBe(100);
    expect(plan.use[0].saleValue).toBe(10);
    expect(plan.use[0].count).toBe(2);
    expect(plan.cost).toBe(200);
  });

  it("excludes a purchase whose mall ask exceeds the ceiling even when its sale value fits", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        sale: 10,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 90; // above the 10-meat sale value, below the 100-meat ask
    expect(plansFor(g, 15)).toHaveLength(0);
  });

  it("buys at the NPC store when that undercuts the mall", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        npc: 40,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 90;
    const plans = plansFor(g, 15);
    expect(plans).toHaveLength(1);
    expect(plans[0].use[0].buyPrice).toBe(40);
    expect(plans[0].cost).toBe(80);
  });

  it("never plans a purchase of an unpriceable item (charter 3)", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      // No mall listing, no NPC store: purchase cost is Infinity, must drop out.
      t.item("cyan seashell", {
        sale: 30,
        effect: "Cyan Seas",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 1_000_000;
    expect(plansFor(g, 15)).toHaveLength(0);
  });

  it("still spends OWNED copies of an unpriceable item at a finite cost (charter 12)", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cyan seashell", {
        sale: 30,
        count: 2,
        effect: "Cyan Seas",
        duration: 20,
        res: { cold: 3 },
      });
    });
    const plans = plansFor(g, 15);
    // buying = 0, so 0 × Infinity must never happen: the plan survives with cost 2×30.
    expect(plans).toHaveLength(1);
    expect(Number.isFinite(plans[0].cost)).toBe(true);
    expect(plans[0].cost).toBe(60);
  });

  it("treats copies claimed by earlier zones as not owned", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        sale: 30,
        count: 2,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 150;
    const powder = g.item("cold powder");
    const unreserved = plansFor(g, 15);
    expect(unreserved[0].cost).toBe(60); // both copies owned: 2 × sale value
    const reserved = plansFor(g, 15, 100, new Map([[powder, 2]]));
    expect(reserved[0].cost).toBe(200); // both claimed: 2 × mall ask
  });
});

describe("candidateResPlans stack sizing (charter 15)", () => {
  it("sizes the stack at the CANDIDATE's rate, not the gear-only rate", async () => {
    // From res 0 with no Fishy the two rates diverge hard: at the candidate's 3.4%
    // the zone is 30 fights = 62 turns → two 40-turn copies; sized at the gear-only
    // 1.7% it would be 59 fights = 120 turns → three copies, overpricing the step.
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 40,
        res: { cold: 6 },
      });
    });
    g.args.resources.potionprice = 1000;
    const plans = plansFor(g, 0);
    expect(plans).toHaveLength(1);
    expect(plans[0].res).toBe(6);
    expect(plans[0].use[0].count).toBe(2);
    expect(plans[0].cost).toBe(200);
  });
});

describe("candidateResPlans subsets (charter 5)", () => {
  it("offers a cheap later item even when an earlier list item is unaffordable", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      // List order in coldresitems: the scroll comes first, cold powder later.
      t.item("scroll of minor invulnerability", {
        mall: 50_000,
        effect: "Minorly Invulnerable",
        duration: 20,
        res: { cold: 3 },
      });
      t.item("cold powder", {
        mall: 200,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 1000;
    const powder = g.item("cold powder");
    const scroll = g.item("scroll of minor invulnerability");
    const plans = plansFor(g, 15);
    // A prefix-only search would return [] (every prefix contains the scroll).
    expect(plans).toHaveLength(1);
    expect(plans[0].use.map((u) => u.item)).toEqual([powder]);
    expect(plans[0].use.map((u) => u.item)).not.toContain(scroll);
  });

  it("combines potions that cross no step alone but cross one together (charter 5+18)", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cyan seashell", {
        mall: 100,
        effect: "Cyan Seas",
        duration: 20,
        res: { cold: 2 },
      });
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 2 },
      });
    });
    g.args.resources.potionprice = 1000;
    // From 15: +2 → 17 crosses nothing; +2+2 → 19 (capped 18) crosses to the 10% tier.
    const plans = plansFor(g, 15);
    expect(plans).toHaveLength(1);
    expect(plans[0].use).toHaveLength(2);
    expect(plans[0].res).toBe(18);
  });
});

describe("candidateResPlans step function (charter 18)", () => {
  it("offers nothing when the only combination crosses no 3-res step", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 1 },
      });
    });
    g.args.resources.potionprice = 1000;
    // 16 → 17: same tier. Never worth paying for.
    expect(plansFor(g, 16)).toHaveLength(0);
  });

  it("offers the same potion when it does cross a step", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 1 },
      });
    });
    g.args.resources.potionprice = 1000;
    // 17 → 18 crosses into the capped tier.
    const plans = plansFor(g, 17);
    expect(plans).toHaveLength(1);
    expect(plans[0].res).toBe(18);
  });

  it("offers nothing at the cap or with no progress remaining", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 1000;
    expect(plansFor(g, 18)).toHaveLength(0);
    expect(plansFor(g, 15, 0)).toHaveLength(0);
  });

  it("skips potions whose effect is covered for the whole zone", async () => {
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 1000;
    const insulated = g.effect("Insulated");
    expect(
      g.economics.candidateResPlans(coldSpec(g), 15, 100, new Map(), [
        insulated,
      ]),
    ).toHaveLength(0);
  });

  it("offers a re-up for an effect that is running now but expires mid-zone", async () => {
    // The old behaviour skipped anything merely active, so a stack lapsing part-way
    // through left the plan with nothing to restore the tier.
    const g = await loadGame((t) => {
      standardScenario(t);
      t.item("cold powder", {
        mall: 100,
        effect: "Insulated",
        duration: 20,
        res: { cold: 3 },
      });
    });
    g.args.resources.potionprice = 1000;
    g.state.effects.set(g.mocks.Effect.get("Insulated"), 5);
    const plans = plansFor(g, 15);
    expect(plans).toHaveLength(1);
    expect(plans[0].use.map((u) => String(u.item))).toEqual(["cold powder"]);
  });
});
