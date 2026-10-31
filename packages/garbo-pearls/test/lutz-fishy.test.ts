/**
 * Lutz, the Ice Skate: 30 turns of Fishy, free and costing no turn, once a day while
 * the Skate Park is Ice Skate Territory. The budget counts the visit while it is still
 * only on offer, so the task that takes it has to re-price the zones priced against it.
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, Tools, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

/** The Skate Park cleared into Ice Skate Territory, Lutz undined. */
function iceTerritory(t: Tools): void {
  t.prop("skateParkStatus", "ice");
}

/** Water breathing already up, which the visit requires. */
function breathing(t: Tools): void {
  t.state.playerMods["Adventure Underwater"] = true;
}

/** A visit that lands, the way mafia does it: the effect AND the daily pref. */
function lutzWorks(t: Tools): void {
  t.state.cliHandlers.set("skate lutz", () => {
    t.active("Fishy", 30);
    t.prop("_skateBuff1", true);
  });
}

function lutzTask(g: Game, selected: PearlSpec[]) {
  const task = g.pearls
    .pearlTasks(selected)
    .find((x) => x.name === "Lutz Fishy");
  if (task === undefined) throw new Error("no Lutz task");
  return task;
}

function runTask(task: { do: unknown }): void {
  if (typeof task.do !== "function")
    throw new Error("expected a function do()");
  (task.do as () => void)();
}

function skated(g: Game): boolean {
  return g.state.log.cliExecutes.includes("skate lutz");
}

describe("the Fishy budget counts Lutz", () => {
  it("covers 30 fights at 1 turn each while Lutz is on offer", async () => {
    const g = await loadGame((t) => iceTerritory(t));
    // 30 Fishy fights, then 10 at the 2-turn rate.
    expect(g.economics.turnsForFights(40)).toBe(30 + 10 * 2);
  });

  it("counts nothing once Lutz has been dined today", async () => {
    const g = await loadGame((t) => {
      iceTerritory(t);
      t.prop("_skateBuff1", true);
    });
    expect(g.economics.turnsForFights(40)).toBe(80);
  });

  it("counts nothing while the park is not Ice Skate Territory", async () => {
    for (const status of ["war", "roller", "peace", ""]) {
      const g = await loadGame((t) => t.prop("skateParkStatus", status));
      expect(g.economics.turnsForFights(40)).toBe(80);
    }
  });

  it("does not count the visit twice once its turns are the active Fishy", async () => {
    const g = await loadGame((t) => {
      t.fishy(30);
      iceTerritory(t);
      t.prop("_skateBuff1", true);
    });
    expect(g.economics.turnsForFights(40)).toBe(30 + 10 * 2);
  });

  it("stacks with active Fishy and the pipe", async () => {
    const g = await loadGame((t) => {
      t.fishy(5);
      iceTerritory(t);
      t.item("fishy pipe", { count: 1 });
    });
    // 5 active + 30 from Lutz + 10 from the pipe = 45 covered.
    expect(g.economics.turnsForFights(50)).toBe(45 + 5 * 2);
  });
});

describe("the priced zone spends exactly Lutz's pool", () => {
  // res 3 is the 1.7%/fight floor: 59 fights, well past the 30-turn pool, so the
  // verdict's own arithmetic pins the pool's size instead of merely clearing it.
  it("covers 30 of a long zone's fights and prices the rest at 2 turns", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 3 });
      iceTerritory(t);
    });
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.fights).toBe(59);
    expect(v.fishyUsed).toBe(30);
    expect(v.turns).toBe(59 * 2 - 30);
  });

  it("covers none of them on the day Lutz has already been dined", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 3 });
      iceTerritory(t);
      t.prop("_skateBuff1", true);
    });
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.fights).toBe(59);
    expect(v.fishyUsed).toBe(0);
    expect(v.turns).toBe(59 * 2);
  });

  it("flips a zone from SKIP to GO when the turns it saves outvalue the pearl", async () => {
    // VOA 4,000 against a 50,000 pearl: 10 fights cost 80,000 at 2 turns each and
    // 40,000 at 1, so the zone is only worth farming with Lutz's turns in hand.
    const dry = await loadGame((t) =>
      standardScenario(t, { res: 18, voa: 4000 }),
    );
    const dryVerdict = dry.economics.zoneVerdict(spec(dry, "cold"));
    expect(dryVerdict.turns).toBe(20);
    expect(dryVerdict.go).toBe(false);

    const wet = await loadGame((t) => {
      standardScenario(t, { res: 18, voa: 4000 });
      iceTerritory(t);
    });
    const wetVerdict = wet.economics.zoneVerdict(spec(wet, "cold"));
    expect(wetVerdict.turns).toBe(10);
    expect(wetVerdict.go).toBe(true);
  });
});

describe("the Lutz task", () => {
  it("settles after one attempt, whether or not the visit lands", async () => {
    for (const land of [true, false]) {
      const g = await loadGame((t) => {
        standardScenario(t, { res: 18 });
        iceTerritory(t);
        breathing(t);
        if (land) lutzWorks(t);
      });
      const task = lutzTask(g, [spec(g, "cold")]);
      expect(task.completed()).toBe(false);
      runTask(task);
      expect(skated(g)).toBe(true);
      expect(task.completed()).toBe(true);
    }
  });

  it("re-prices the zones it was counted for when the visit lands nothing", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, voa: 4000 });
      iceTerritory(t);
      breathing(t);
    });
    const cold = spec(g, "cold");
    const task = lutzTask(g, [cold]);
    g.economics.primeZoneVerdicts([cold]);
    expect(g.economics.zoneVerdict(cold).go).toBe(true);

    runTask(task); // no Fishy granted
    expect(g.fishyModule.lutzFishyAvailable()).toBe(false);
    // The cached GO was bought with 30 turns the run does not have.
    expect(g.economics.zoneVerdict(cold).go).toBe(false);
    expect(g.economics.zoneVerdict(cold).turns).toBe(20);
  });

  it("leaves the zones approved when the visit lands", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, voa: 4000 });
      iceTerritory(t);
      breathing(t);
      lutzWorks(t);
    });
    const cold = spec(g, "cold");
    const task = lutzTask(g, [cold]);
    g.economics.primeZoneVerdicts([cold]);
    runTask(task);
    expect(g.economics.zoneVerdict(cold).go).toBe(true);
    expect(g.economics.zoneVerdict(cold).turns).toBe(10);
    // The 30 turns are active Fishy now, counted once.
    expect(g.economics.turnsForFights(40)).toBe(30 + 10 * 2);
  });

  it("stops counting Lutz even if the daily pref never settles", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18 });
      iceTerritory(t);
      breathing(t);
      // The effect lands but mafia does not write _skateBuff1.
      t.state.cliHandlers.set("skate lutz", () => t.active("Fishy", 30));
    });
    runTask(lutzTask(g, [spec(g, "cold")]));
    expect(g.fishyModule.lutzFishyAvailable()).toBe(false);
    // 30 active Fishy, not 30 active plus 30 still on offer.
    expect(g.economics.turnsForFights(40)).toBe(30 + 10 * 2);
  });

  it("spends the attempt without visiting when the dress still left breathing down", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18 });
      iceTerritory(t);
      lutzWorks(t);
    });
    runTask(lutzTask(g, [spec(g, "cold")]));
    expect(skated(g)).toBe(false);
    expect(g.fishyModule.lutzFishyAvailable()).toBe(false);
    expect(g.economics.turnsForFights(40)).toBe(80);
  });

  it("refuses the visit outright when Lutz is not on offer", async () => {
    const g = await loadGame((t) => {
      t.prop("skateParkStatus", "roller");
      breathing(t);
    });
    expect(g.fishyModule.visitLutz()).toBe(false);
    expect(skated(g)).toBe(false);
  });

  it("does not offer itself when the park is not Ice Skate Territory", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18 });
      t.prop("skateParkStatus", "roller");
      breathing(t);
    });
    expect(lutzTask(g, [spec(g, "cold")]).completed()).toBe(true);
  });
});

describe("the Lucky! refresh defers to Lutz", () => {
  async function refreshGame(configure: (t: Tools) => void): Promise<Game> {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18 });
      breathing(t);
      t.item("aerated diving helmet", { count: 1 });
      t.prop("_subAquaEquipBreathing", true);
      t.item("11-leaf clover", { count: 1 });
      configure(t);
    });
    g.args.resources.luckyfishy = true;
    return g;
  }

  function getFishy(g: Game) {
    return g.pearls
      .pearlTasks([spec(g, "cold")])
      .find((x) => x.name === "Get Fishy");
  }

  it("holds off while Lutz still owes the day's Fishy", async () => {
    const g = await refreshGame(iceTerritory);
    expect(getFishy(g)?.ready?.()).toBe(false);
  });

  it("readies once Lutz has been dined", async () => {
    const g = await refreshGame((t) => {
      iceTerritory(t);
      t.prop("_skateBuff1", true);
    });
    expect(getFishy(g)?.ready?.()).toBe(true);
  });

  it("readies once the Lutz task has spent its attempt", async () => {
    const g = await refreshGame(iceTerritory);
    expect(getFishy(g)?.ready?.()).toBe(false);
    runTask(lutzTask(g, [spec(g, "cold")]));
    expect(getFishy(g)?.ready?.()).toBe(true);
  });
});

describe("freeFishyReport", () => {
  it("names why each free source is or is not available", async () => {
    const available = await loadGame((t) => {
      iceTerritory(t);
      t.item("fishy pipe", { count: 1 });
    });
    expect(available.fishyModule.freeFishyReport()).toBe(
      " free fishy sources: Lutz, the Ice Skate: available (+30 turns) | fishy pipe: available (+10 turns)",
    );

    const spent = await loadGame((t) => {
      iceTerritory(t);
      t.prop("_skateBuff1", true);
      t.item("fishy pipe", { count: 1 });
      t.prop("_fishyPipeUsed", true);
    });
    expect(spent.fishyModule.freeFishyReport()).toBe(
      " free fishy sources: Lutz, the Ice Skate: already dined today | fishy pipe: smoked today",
    );

    const unopened = await loadGame((t) => t.prop("skateParkStatus", "war"));
    expect(unopened.fishyModule.freeFishyReport()).toBe(
      " free fishy sources: Lutz, the Ice Skate: Skate Park is not Ice Skate Territory | fishy pipe: not owned",
    );
  });

  it("does not blame the day's visit for a visit that granted nothing", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18 });
      iceTerritory(t);
      breathing(t);
    });
    runTask(lutzTask(g, [spec(g, "cold")]));
    expect(g.fishyModule.freeFishyReport()).toContain(
      "Lutz, the Ice Skate: visited this run without gaining Fishy",
    );
  });
});

describe("the Lutz task dresses for the visit (issue #11)", () => {
  /** The gear-air day from the issue's log: breathing gear owned, none of it worn yet. */
  function gearAirDay(t: Tools): void {
    standardScenario(t, { res: 18 });
    iceTerritory(t);
    t.item("aerated diving helmet", { count: 1 });
    t.prop("_subAquaEquipBreathing", true);
    lutzWorks(t);
  }

  function outfitOf(task: { outfit?: unknown }): Record<string, unknown> {
    if (typeof task.outfit !== "function")
      throw new Error("expected an outfit() function");
    return (task.outfit as () => Record<string, unknown>)();
  }

  it("asks the maximizer for water breathing when no air effect is up", async () => {
    const g = await loadGame(gearAirDay);
    const spec = outfitOf(lutzTask(g, [spec_(g)]));
    expect(spec.modifier).toBe("adventure underwater");
  });

  it("asks for no breathing gear when an air effect already covers it", async () => {
    const g = await loadGame((t) => {
      gearAirDay(t);
      t.active("Driving Waterproofly", 30);
    });
    const spec = outfitOf(lutzTask(g, [spec_(g)]));
    expect(spec.modifier).toBeUndefined();
  });

  it("takes the Fishy once the dress has put breathing up", async () => {
    const g = await loadGame(gearAirDay);
    const task = lutzTask(g, [spec_(g)]);
    expect(task.completed()).toBe(false);
    // The engine dresses the task's outfit before do(); the fake maximizer does not
    // model gear, so stand in for it: the requested breathing build is now worn.
    expect(outfitOf(task).modifier).toBe("adventure underwater");
    g.state.playerMods["Adventure Underwater"] = true;
    runTask(task);
    expect(skated(g)).toBe(true);
    expect(g.economics.turnsForFights(40)).toBe(30 + 10 * 2);
  });

  function spec_(g: Game): PearlSpec {
    return spec(g, "cold");
  }
});
