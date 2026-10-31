/**
 * The surface garbo drives: selection and option parsing, the injected economy, the
 * plan task that gates breathing and the zones, SKIP verdicts re-priced after progress
 * made elsewhere, and progress attributed to this script's own fights only.
 */
import { describe, expect, it } from "vitest";

import type { PearlTask } from "../src/pearls";
import type { PearlSpec } from "../src/zones";

import { Game, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

function task(tasks: PearlTask[], name: string): PearlTask {
  const found = tasks.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name} task`);
  return found;
}

describe("parsePearlSelection", () => {
  it("selects nothing when empty or off, everything for all", async () => {
    const g = await loadGame();
    expect(g.config.parsePearlSelection("")).toEqual([]);
    expect(g.config.parsePearlSelection("off")).toEqual([]);
    expect(g.config.parsePearlSelection("all").map((p) => p.key)).toEqual([
      "spooky",
      "sleaze",
      "hot",
      "stench",
      "cold",
    ]);
  });

  it("keeps the given order and rejects unknown or repeated pearls", async () => {
    const g = await loadGame();
    expect(
      g.config.parsePearlSelection(" Cold, hot ").map((p) => p.key),
    ).toEqual(["cold", "hot"]);
    expect(() => g.config.parsePearlSelection("cold,cold")).toThrow(
      /duplicate/,
    );
    expect(() => g.config.parsePearlSelection("cold,fire")).toThrow(/unknown/);
  });
});

describe("configurePearls", () => {
  it("maps host settings onto the option groups", async () => {
    const g = await loadGame();
    g.config.configurePearls({
      requireCap: true,
      force: true,
      airMode: "gear",
      potionPrice: 3000,
      luckyFishy: true,
      cloverPrice: 20_000,
      momBuff: "cold",
      codpiece: true,
      leeroyJenkins: true,
      overcapped: true,
      fishMaxxing: true,
    });
    expect(g.args.major).toMatchObject({
      requirecap: true,
      force: true,
      leeroyjenkins: true,
      overcapped: true,
    });
    expect(g.args.resources).toMatchObject({
      airmode: "gear",
      potionprice: 3000,
      luckyfishy: true,
      cloverprice: 20_000,
      mombuff: "cold",
      codpiece: true,
      fishMaxxing: true,
    });
  });

  it("parses mombuff and rejects anything else", async () => {
    const g = await loadGame();
    expect(g.config.parseMomBuff("")).toBeUndefined();
    expect(g.config.parseMomBuff("true")).toBe("auto");
    expect(g.config.parseMomBuff("auto")).toBe("auto");
    expect(g.config.parseMomBuff("Stench")).toBe("stench");
    expect(() => g.config.parseMomBuff("fire")).toThrow(/mombuff/);
  });

  it("prices turns at the injected value of an adventure", async () => {
    // res 18, no Fishy: 10 fights at 2 turns each.
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 0 }),
    );
    const cold = spec(g, "cold");
    g.config.configurePearls({ valueOfAdventure: () => 2000 });
    g.economics.primeZoneVerdicts([cold]);
    expect(g.economics.zoneVerdict(cold).turnCost).toBe(40_000);
  });
});

describe("plan task", () => {
  it("prices every zone once, then reports itself done", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 40 }),
    );
    const cold = spec(g, "cold");
    const tasks = g.pearls.pearlTasks([cold]);
    const plan = task(tasks, "Plan");
    expect(plan.completed()).toBe(false);
    if (typeof plan.do !== "function")
      throw new Error("expected a function do()");
    plan.do();
    expect(plan.completed()).toBe(true);
    expect(
      g.state.log.prints.some((p) => p.includes("cold") && p.includes("GO")),
    ).toBe(true);
  });

  it("does not plan a day whose selected pearls are all obtained", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.prop("_unblemishedPearlTheBriniestDeepests", true);
    });
    const plan = task(g.pearls.pearlTasks([spec(g, "cold")]), "Plan");
    expect(plan.completed()).toBe(true);
  });

  it("blocks every zone when an organ is overcapped beyond the owned extenders", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 40 });
      t.state.fullness = 16;
    });
    const cold = spec(g, "cold");
    const tasks = g.pearls.pearlTasks([cold]);
    const zone = task(tasks, `${cold.loc}`);
    expect(zone.ready?.()).toBe(true);
    const plan = task(tasks, "Plan");
    if (typeof plan.do !== "function")
      throw new Error("expected a function do()");
    plan.do();
    expect(zone.ready?.()).toBe(false);
    expect(task(tasks, "Breathe Underwater").ready?.()).toBe(false);
  });
});

describe("breathing waits for a zone that will farm", () => {
  it("stays unready while every zone skips", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 0, fishyTurns: 0 }),
    );
    const tasks = g.pearls.pearlTasks([spec(g, "cold")]);
    expect(task(tasks, "Breathe Underwater").ready?.()).toBe(false);
    expect(task(tasks, "Lutz Fishy").ready?.()).toBe(false);
  });

  it("readies once a zone is profitable and affordable", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 40 }),
    );
    const tasks = g.pearls.pearlTasks([spec(g, "cold")]);
    expect(task(tasks, "Breathe Underwater").ready?.()).toBe(true);
  });

  it("every task waits for the plan", async () => {
    const g = await loadGame();
    const cold = spec(g, "cold");
    for (const t of g.pearls.pearlTasks([cold])) {
      if (["Plan", "Prep Codpiece"].includes(t.name)) continue;
      expect(t.after ?? []).toContain("Plan");
    }
  });
});

describe("progress made outside the script", () => {
  it("re-prices a SKIP zone once wanderers have moved it", async () => {
    // res 18, no Fishy: a full pearl is 10 fights, 20 turns, 20,000 meat against a
    // 15,000 pearl. Half done, it is 10 turns and pays.
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 0, pearlValue: 15_000 }),
    );
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([cold]);
    expect(g.economics.zoneVerdict(cold).go).toBe(false);
    g.prop(cold.progress, 50);
    expect(g.economics.zoneVerdict(cold).go).toBe(true);
  });

  it("keeps a GO verdict cached as progress moves", async () => {
    const g = await loadGame((t) =>
      standardScenario(t, { res: 18, fishyTurns: 40 }),
    );
    const cold = spec(g, "cold");
    g.economics.primeZoneVerdicts([cold]);
    const first = g.economics.zoneVerdict(cold);
    g.prop(cold.progress, 30);
    expect(g.economics.zoneVerdict(cold)).toBe(first);
  });

  it("measures the progress rate from this script's own fights only", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 0 });
      t.playerRes("cold", 18);
    });
    const cold = spec(g, "cold");
    const zone = task(g.pearls.pearlTasks([cold]), `${cold.loc}`);
    if (!zone.prepare || !zone.post)
      throw new Error("expected prepare and post");
    const fight = (after: number) => {
      zone.prepare?.();
      g.prop(cold.progress, after);
      zone.post?.();
    };
    fight(5);
    // A wanderer takes the zone from 5 to 25 between this script's fights.
    g.prop(cold.progress, 25);
    fight(30);
    // Observed rate 5%: 70% left is 14 fights, 28 turns without Fishy. Crediting the
    // wanderer's 20 to the second fight would read 15% and ready the zone at 10.
    g.state.adventures = 27;
    expect(zone.ready?.()).toBe(false);
    g.state.adventures = 28;
    expect(zone.ready?.()).toBe(true);
  });
});
