/**
 * The Lucky!-refresh cost queue the economics model plans with, and the fight counter
 * that gates it. (KoL free fights and NC turns mean adventure counts can't measure
 * progress — these stay pure functions of tracked preferences.)
 */
import { describe, expect, it } from "vitest";

import { loadGame } from "./support/harness";

describe("luckyRefreshCosts", () => {
  it("is empty while the luckyfishy resource flag is off", async () => {
    const g = await loadGame((t) => {
      t.item("11-leaf clover", { count: 3 });
    });
    expect(g.fishyModule.luckyRefreshCosts(6)).toEqual([]);
  });

  it("queues free sources first, then hermit clovers at the gum price", async () => {
    const g = await loadGame((t) => {
      t.item("11-leaf clover", { count: 2 });
      t.item("chewing gum on a string", { npc: 50 });
    });
    g.args.resources.luckyfishy = true;
    expect(g.fishyModule.luckyRefreshCosts(6)).toEqual([0, 0, 50, 50, 50]);
  });

  it("fills the tail with mall clovers only when cloverprice allows the historical price", async () => {
    const g = await loadGame((t) => {
      t.item("11-leaf clover", { count: 2, historical: 300 });
      t.item("chewing gum on a string", { npc: 50 });
    });
    g.args.resources.luckyfishy = true;
    g.args.resources.cloverprice = 500;
    expect(g.fishyModule.luckyRefreshCosts(6)).toEqual([0, 0, 50, 50, 50, 300]);
    g.args.resources.cloverprice = 200; // below the 300 historical: no mall fills
    expect(g.fishyModule.luckyRefreshCosts(6)).toEqual([0, 0, 50, 50, 50]);
  });
});

describe("mall clover worth-gate", () => {
  it("offers the mall clover only when the covered fights out-earn its price", async () => {
    // All other cascade sources exhausted; VOA 100, clover 300: a refresh covering
    // `covered` fights nets (covered − 1) turns, so it needs 4+ remaining fights.
    const g = await loadGame((t) => {
      t.prop("valueOfAdventure", 100);
      t.prop("_cloversPurchased", 3);
      t.item("11-leaf clover", { historical: 300 });
    });
    g.args.resources.luckyfishy = true;
    g.args.resources.cloverprice = 400;
    expect(g.fishyModule.luckySourceAvailable(3)).toBe(false);
    expect(g.fishyModule.luckySourceAvailable(4)).toBe(true);
    // Priced out entirely: historical above the ceiling, or mall buying disabled.
    g.args.resources.cloverprice = 200;
    expect(g.fishyModule.luckySourceAvailable(100)).toBe(false);
    g.args.resources.cloverprice = 0;
    expect(g.fishyModule.luckySourceAvailable(100)).toBe(false);
  });
});

describe("remainingPearlFights", () => {
  it("counts only unfinished pearls, at the optimistic capped rate", async () => {
    const g = await loadGame((t) => {
      t.prop("_unblemishedPearlAnemoneMine", true); // spooky done: contributes 0
      t.prop("_unblemishedPearlTheBriniestDeepestsProgress", 40);
    });
    const spooky = g.zones.PEARLS.find((p) => p.key === "spooky");
    const cold = g.zones.PEARLS.find((p) => p.key === "cold");
    if (!spooky || !cold) throw new Error("missing specs");
    expect(g.fishyModule.remainingPearlFights([spooky, cold])).toBe(6);
  });
});
