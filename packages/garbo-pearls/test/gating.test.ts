/**
 * The gates: resStepWorthIt (the one profitability oracle, charter 18's step rule and
 * charter 6's single-model rule), pearlTask.ready (a zone priced unprofitable is NEVER
 * farmed), and the report paths' spend-nothing contract (charter 13).
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

describe("resStepWorthIt (charter 18, 6)", () => {
  it("refuses any gain that crosses no 3-res step, even free", async () => {
    const g = await loadGame((t) => standardScenario(t, { fishyTurns: 100 }));
    // 12 → 14 is the same tier: same rate, same profit — never pay, never bother.
    expect(g.economics.resStepWorthIt(spec(g, "cold"), 12, 2, 0)).toBe(false);
    // 15 → 17 likewise.
    expect(g.economics.resStepWorthIt(spec(g, "cold"), 15, 2, 500)).toBe(false);
  });

  it("accepts a step exactly while its cost undercuts the turns it saves", async () => {
    const g = await loadGame((t) => standardScenario(t, { fishyTurns: 100 }));
    const cold = spec(g, "cold");
    // 15 → 18 saves 2 fights = 2 Fishy turns = 2,000 meat.
    expect(g.economics.resStepWorthIt(cold, 15, 3, 1500)).toBe(true);
    expect(g.economics.resStepWorthIt(cold, 15, 3, 2000)).toBe(false); // break-even: no
    expect(g.economics.resStepWorthIt(cold, 15, 3, 2500)).toBe(false);
  });

  it("returns false once the pearl is already finished", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { fishyTurns: 100 });
      t.prop("_unblemishedPearlTheBriniestDeepestsProgress", 100);
    });
    expect(g.economics.resStepWorthIt(spec(g, "cold"), 15, 3, 0)).toBe(false);
  });
});

describe("pearlTask.ready profit gate", () => {
  it("never readies a zone priced at a loss", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 0, fishyTurns: 0 }),
    );
    const cold = spec(g, "cold");
    const task = g.pearls
      .pearlTasks([cold])
      .find((t) => t.name === `${cold.loc}`);
    expect(task).toBeDefined();
    expect(g.economics.zoneVerdict(cold).go).toBe(false);
    expect(task?.ready?.()).toBe(false);
  });

  it("readies a profitable zone", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 40 }),
    );
    const cold = spec(g, "cold");
    const task = g.pearls
      .pearlTasks([cold])
      .find((t) => t.name === `${cold.loc}`);
    expect(g.economics.zoneVerdict(cold).go).toBe(true);
    expect(task?.ready?.()).toBe(true);
  });

  it("refuses to start a pearl it cannot finish above the halt floor", async () => {
    // res 18, no Fishy: 10 fights price at 2 turns each. Starting with fewer than 20
    // adventures would strand mid-pearl progress at rollover — the documented
    // historical failure. Uncovered fights priced at 1 turn would ready at 10.
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 0 }),
    );
    const cold = spec(g, "cold");
    const task = g.pearls
      .pearlTasks([cold])
      .find((t) => t.name === `${cold.loc}`);
    expect(g.economics.zoneVerdict(cold).go).toBe(true);
    g.state.adventures = 19;
    expect(task?.ready?.()).toBe(false);
    g.state.adventures = 20;
    expect(task?.ready?.()).toBe(true);
    // The host's turn reserve comes off the top.
    g.config.configurePearls({
      adventuresAvailable: () => g.state.adventures - 5,
    });
    g.state.adventures = 24;
    expect(task?.ready?.()).toBe(false);
    g.state.adventures = 25;
    expect(task?.ready?.()).toBe(true);
  });

  it("strand mode lowers the floor to a single fight's turn cost", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 0 }),
    );
    const cold = spec(g, "cold");
    const task = g.pearls
      .pearlTasks([cold])
      .find((t) => t.name === `${cold.loc}`);
    g.args.major.strand = true;
    g.state.adventures = 2; // one non-Fishy fight
    expect(task?.ready?.()).toBe(true);
    g.state.adventures = 1;
    expect(task?.ready?.()).toBe(false);
    g.fishy(5); // with Fishy a fight costs 1
    expect(task?.ready?.()).toBe(true);
  });

  it("force overrides the profit gate but nothing else does", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 0, fishyTurns: 0 }),
    );
    const cold = spec(g, "cold");
    const task = g.pearls
      .pearlTasks([cold])
      .find((t) => t.name === `${cold.loc}`);
    expect(task?.ready?.()).toBe(false);
    g.args.major.force = true;
    expect(task?.ready?.()).toBe(true);
  });
});

describe("report paths spend nothing (charter 13)", () => {
  it("pricing and the profit report make no purchases, uses, casts, or restores", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 15, fishyTurns: 40 });
      // A potion the model WILL want — pricing must still not touch it.
      t.item("cold powder", {
        mall: 200,
        sale: 100,
        count: 3,
        effect: "Insulated",
        duration: 20,
        res: { all: 3 },
      });
    });
    g.args.resources.potionprice = 1000;
    const selected = [spec(g, "spooky"), spec(g, "cold")];
    g.economics.primeZoneVerdicts(selected);
    g.economics.printProfitReport(selected);
    for (const zone of selected) g.economics.zoneVerdict(zone);
    expect(g.state.log.buys).toHaveLength(0);
    expect(g.state.log.uses).toHaveLength(0);
    expect(g.state.log.skillsCast).toHaveLength(0);
    expect(g.state.log.cliExecutes).toHaveLength(0);
    expect(g.state.log.hpRestores).toHaveLength(0);
    expect(g.state.log.mpRestores).toHaveLength(0);
    expect(g.state.log.retrieves).toHaveLength(0);
  });
});

describe("familiar-mode escalation", () => {
  // The dress decides what the player measures: the switch build reaches 19, utility 16.
  async function zoneWhere(switchRes: number, utilityRes: number) {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.familiar("Exotic Parrot", { owned: true });
      t.playerRes("cold", utilityRes);
      t.onDress((modifier) => {
        t.playerRes(
          "cold",
          modifier.includes("switch") ? switchRes : utilityRes,
        );
      });
    });
    const cold = g.zones.PEARLS.find((p) => p.key === "cold");
    if (!cold) throw new Error("no cold spec");
    const task = g.pearls
      .pearlTasks([cold])
      .find((x) => x.name === `${cold.loc}`);
    if (!task?.prepare) throw new Error("no prepare");
    return { g, cold, prepare: task.prepare.bind(task) };
  }

  it("adopts the res familiar when it measures better", async () => {
    const { g, cold, prepare } = await zoneWhere(19, 16);
    prepare();
    expect(g.outfit.familiarModeFor(cold.key)).toBe("switch");
  });

  it("keeps the build it is in when the alternative is no better", async () => {
    const { g, cold, prepare } = await zoneWhere(16, 16);
    prepare();
    expect(g.outfit.familiarModeFor(cold.key)).toBe("utility");
  });

  it("tries each direction at most once, so a settled zone stops re-dressing", async () => {
    // Both builds stay under the cap, so the short-circuit at the top never fires and
    // the latch is what has to stop the re-dressing.
    const { g, prepare } = await zoneWhere(17, 16);
    prepare();
    const afterFirst = g.state.log.prints.filter((l) =>
      l.includes("— trying "),
    ).length;
    prepare();
    prepare();
    const total = g.state.log.prints.filter((l) =>
      l.includes("— trying "),
    ).length;
    // One attempt toward switch, then at most one back toward utility. Never per-fight.
    expect(afterFirst).toBe(1);
    expect(total).toBeLessThanOrEqual(2);
  });
});
