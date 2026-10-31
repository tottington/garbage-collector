import { Monster, myAscensions, toMonster } from "kolmafia";
import { $location, $monsters, get, set } from "libram";

export const TREASURY = $location`Cobb's Knob Treasury`;
export const TREASURY_GOBLINS = $monsters`Knob Goblin Accountant, Knob Goblin Bean Counter, Knob Goblin MBA`;
export const MAX_PLANTING_FIGHTS = 6;
const STATE_PREF = "garboTreasuryAcorns";
const PLAN_PREF = "garbo_treasuryAcornPlan";
// A zone takes one acorn of each kind
const DEFAULT_PLAN = "seacow,zydeco,banish";

export type AcornPlan = { banishes: number; zydecos: number };

export type AcornState = {
  ascension: number;
  fights: number;
  seaCows: boolean;
  zydecos: number;
  banished: Monster[];
};

/**
 * The acorns to plant besides the sea cow acorn, from garbo_treasuryAcornPlan: a comma-separated list of seacow, zydeco and banish, three at most.
 */
export function treasuryAcornPlan(): AcornPlan {
  const acorns = get(PLAN_PREF, DEFAULT_PLAN)
    .split(",")
    .map((acorn) => acorn.trim().toLowerCase())
    .filter((acorn) => acorn !== "seacow")
    .slice(0, 2);
  return {
    banishes: acorns.filter((acorn) => acorn === "banish").length,
    zydecos: acorns.filter((acorn) => acorn === "zydeco").length,
  };
}

/**
 * @returns Whether the Treasury is flooded by Summon a Wave
 */
export function treasuryFlooded(): boolean {
  return get("_seadentWaveZone") === TREASURY;
}

/**
 * Acorns planted in the Treasury this ascension, from garbo's own record.
 */
export function treasuryAcorns(): AcornState {
  const empty = {
    ascension: myAscensions(),
    fights: 0,
    seaCows: false,
    zydecos: 0,
    banished: [],
  };
  const [ascension, fights, seaCows, banished, zydecos] = get(
    STATE_PREF,
    "",
  ).split("|");
  if (Number(ascension) !== myAscensions()) return empty;
  return {
    ascension: myAscensions(),
    fights: Number(fights) || 0,
    seaCows: seaCows === "true",
    zydecos: Number(zydecos) || 0,
    banished: banished ? banished.split(",").map((m) => toMonster(m)) : [],
  };
}

export function saveTreasuryAcorns(state: AcornState): void {
  set(
    STATE_PREF,
    [
      state.ascension,
      state.fights,
      state.seaCows,
      state.banished.map((m) => m.name).join(","),
      state.zydecos,
    ].join("|"),
  );
}

/**
 * @returns The goblins still to be banished by an acorn
 */
export function goblinsToAcornBanish(state: AcornState): Monster[] {
  return state.banished.length < treasuryAcornPlan().banishes
    ? TREASURY_GOBLINS.filter((m) => !state.banished.includes(m))
    : [];
}

/**
 * @returns Whether the Treasury has every planned acorn, or garbo has stopped trying
 */
export function treasuryPlantingDone(): boolean {
  const state = treasuryAcorns();
  return (
    (state.seaCows &&
      state.zydecos >= treasuryAcornPlan().zydecos &&
      goblinsToAcornBanish(state).length === 0) ||
    state.fights >= MAX_PLANTING_FIGHTS
  );
}
