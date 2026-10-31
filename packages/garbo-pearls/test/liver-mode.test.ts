/**
 * chooseLiverConfiguration: the mode chooser must score each candidate mode by the
 * zones it would actually farm — never by summing the modelled losses of zones it
 * skips (charter 17).
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

describe("chooseLiverConfiguration (charter 17)", () => {
  it("with one drink of overage and no rescue gear, only wineglass is on the table", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 10 });
      t.state.inebriety = 17; // limit 15 + 1 extender + 0 stooper < 17: beyond rescue
      t.item("Drunkula's wineglass", { count: 1 });
    });
    expect(g.economics.chooseLiverConfiguration([spec(g, "spooky")])).toBe(
      "wineglass",
    );
    expect(g.organs.liverMode()).toBe("wineglass");
  });

  it("does not let the modelled loss of a zone it will skip talk it out of the better mode", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { fishyTurns: 10 });
      // One drink over, rescuable by the angelbone dice → candidates: items, wineglass.
      t.state.inebriety = 16;
      t.item("angelbone dice", { count: 1 });
      t.item("Drunkula's wineglass", { count: 1 });
      // The maximizer answers differently per mode (the wineglass expression carries
      // weapon-damage weights) and per zone:
      //   spooky: items res 18 → +40,000 | wineglass res 9 → +30,000
      //   cold:   items res 3 → −68,000 SKIP | wineglass res 9 → +... no: −...
      //   cold:   items res 3 (59 fights, −68,000, SKIP) | wineglass res 9 (20 fights,
      //           pool spent by spooky → 40 turns, +10,000, farmed)
      // Honest scores: items 40,000 vs wineglass 40,000 − 10,000... see asserts below.
      t.state.maximizeImpl = (modifier: string) => {
        const wineglass = modifier.includes("weapon damage");
        if (modifier.includes("spooky res")) {
          t.state.specMods["Spooky Resistance"] = wineglass ? 9 : 18;
        }
        if (modifier.includes("cold res")) {
          t.state.specMods["Cold Resistance"] = wineglass ? 9 : 3;
        }
        t.state.specMods["Adventure Underwater"] = true;
        return true;
      };
    });
    const spooky = spec(g, "spooky");
    const cold = spec(g, "cold");
    // Honest accounting:
    //   items:     spooky 10 fights, all 10 Fishy → 10 turns → +40,000;
    //              cold res 3 → 59 fights, no pool left → 118 turns → −68,000, SKIPPED.
    //              score 40,000.
    //   wineglass: spooky res 9 → 20 fights, 10 Fishy → 30 turns → +20,000;
    //              cold res 9 → 20 fights, no pool → 40 turns → +10,000, farmed.
    //              score 30,000.
    // Summing skipped losses instead would score items at −28,000 and flip the choice.
    expect(g.economics.chooseLiverConfiguration([spooky, cold])).toBe("items");
    expect(g.organs.liverMode()).toBe("items");
  });

  it("still picks wineglass when wineglass honestly farms better", async () => {
    // Complement of the test above: proves the chooser discriminates rather than
    // defaulting to the first viable candidate.
    const g = await loadGame((t) => {
      standardScenario(t, { fishyTurns: 10 });
      t.state.inebriety = 16;
      t.item("angelbone dice", { count: 1 });
      t.item("Drunkula's wineglass", { count: 1 });
      t.state.maximizeImpl = (modifier: string) => {
        const wineglass = modifier.includes("weapon damage");
        if (modifier.includes("spooky res")) {
          t.state.specMods["Spooky Resistance"] = wineglass ? 18 : 9;
        }
        if (modifier.includes("cold res")) {
          t.state.specMods["Cold Resistance"] = wineglass ? 18 : 3;
        }
        t.state.specMods["Adventure Underwater"] = true;
        return true;
      };
    });
    const spooky = spec(g, "spooky");
    const cold = spec(g, "cold");
    expect(g.economics.chooseLiverConfiguration([spooky, cold])).toBe(
      "wineglass",
    );
    expect(g.organs.liverMode()).toBe("wineglass");
  });
});
