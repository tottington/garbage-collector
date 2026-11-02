import { isBanished, Monster, myAscensions, toMonster } from "kolmafia";
import { $location, $monsters, get, set } from "libram";

export const TREASURY = $location`Cobb's Knob Treasury`;
export const TREASURY_GOBLINS = $monsters`Knob Goblin Accountant, Knob Goblin Bean Counter, Knob Goblin MBA`;
export const MAX_PLANTING_FIGHTS = 6;
const STATE_PREF = "garboTreasuryAcorns";
// A zone takes one acorn of each kind: sea cows, a Zydeco and a banish
export const ZYDECO_ACORNS = 1;
export const BANISH_ACORNS = 1;
// Acorns stop bringing sea cows after 33 fights an ascension, counting every zone
const MAX_ACORN_SEA_COWS = 33;
const SEA_COWS_PREF = "_garboAcornSeaCows";

export type AcornState = {
  ascension: number;
  fights: number;
  seaCows: boolean;
  zydecos: number;
  banished: Monster[];
};

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
  return state.banished.length < BANISH_ACORNS
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
      state.zydecos >= ZYDECO_ACORNS &&
      goblinsToAcornBanish(state).length === 0) ||
    state.fights >= MAX_PLANTING_FIGHTS
  );
}

function acornSeaCowsFought(): number {
  const [ascension, fought] = get(SEA_COWS_PREF, "").split("|");
  return Number(ascension) === myAscensions() ? Number(fought) || 0 : 0;
}

function setAcornSeaCowsFought(fought: number): void {
  set(SEA_COWS_PREF, `${myAscensions()}|${fought}`);
}

/**
 * @returns Whether acorns can still bring sea cows this ascension
 */
export function acornSeaCowsLeft(): boolean {
  return acornSeaCowsFought() < MAX_ACORN_SEA_COWS;
}

let goblinsBanishedBeforeFight: Monster[] = [];
/**
 * Remember which goblins are banished before a Treasury fight, since the fight may banish another.
 */
export function noteBanishedGoblins(): void {
  const { banished } = treasuryAcorns();
  goblinsBanishedBeforeFight = TREASURY_GOBLINS.filter(
    (goblin) => isBanished(goblin) || banished.includes(goblin),
  );
}

/**
 * Count a Treasury fight toward the acorn sea cow limit. A banished goblin only appears when the zone has nothing else left, which also catches sea cows fought elsewhere.
 */
export function recordTreasuryFight(): void {
  const encounter = get("lastEncounter");
  if (encounter === "sea cow") {
    setAcornSeaCowsFought(acornSeaCowsFought() + 1);
  } else if (goblinsBanishedBeforeFight.includes(toMonster(encounter))) {
    setAcornSeaCowsFought(MAX_ACORN_SEA_COWS);
  }
}
