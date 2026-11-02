import {
  canAdventure,
  equip,
  equippedItem,
  haveEquipped,
  Item,
  Monster,
  print,
  toItem,
  toMonster,
  useSkill,
  visitUrl,
} from "kolmafia";
import { $effect, $item, $skill, $slot, get, have, uneffect } from "libram";
import { Macro } from "../combat";
import { FarmingMethod, globalOptions } from "../config";
import { FarmingStrategy } from "../farmingStrategy";
import { HIGHLIGHT, setChoice } from "../lib";
import {
  acornSeaCowsLeft,
  AcornState,
  goblinsToAcornBanish,
  noteBanishedGoblins,
  recordTreasuryFight,
  saveTreasuryAcorns,
  TREASURY,
  treasuryAcorns,
  treasuryFlooded,
  ZYDECO_ACORNS,
} from "./acornState";

// mafia registers the legendary acorndion at runtime but knows none of its skills, so they are cast by id.
const ACORNDION_ID = 12392;
const ACORNDION_DESCID = "860192473";
const CHIASSO_DE_LOS_MUERTOS = 7603; // Underwater acorn: banishes the monster from the zone
const JUVENILE_REFRAIN = 7604; // Underwater acorn: sea cows appear in the zone
const LINE_OF_ZYDECO = 7605; // Underwater acorn: pressure -30% in the zone
const DAILY_ACORNS = 12;

export function acorndion(): Item {
  return toItem(ACORNDION_ID);
}

export function haveAcorndion(): boolean {
  const item = acorndion();
  return item !== $item.none && have(item);
}

/**
 * @returns Whether the Treasury is flooded, or can be flooded today
 */
export function treasuryFloodable(): boolean {
  return (
    treasuryFlooded() ||
    (have($item`Monodent of the Sea`) && !get("_seadentWaveUsed"))
  );
}

/**
 * @returns The number of acorns the acorndion generated today, read from its description, or null if the page didn't say
 */
export function acornsGeneratedToday(): number | null {
  const page = visitUrl(`desc_item.php?whichitem=${ACORNDION_DESCID}`);
  const match = page.match(/(\d+) of 12 acorns generated today/);
  return match ? Number(match[1]) : null;
}

type Acorn = "banish" | "seacow" | "zydeco";

const ACORN_SKILLS: Record<Acorn, number> = {
  banish: CHIASSO_DE_LOS_MUERTOS,
  seacow: JUVENILE_REFRAIN,
  zydeco: LINE_OF_ZYDECO,
};

// The sea cow acorn comes first, then the planned Zydecos
function nextOtherAcorn(state: AcornState): Acorn | null {
  if (!state.seaCows) return "seacow";
  if (state.zydecos < ZYDECO_ACORNS) return "zydeco";
  return null;
}

function intendedAcorn(state: AcornState, monster: Monster): Acorn | null {
  return goblinsToAcornBanish(state).includes(monster)
    ? "banish"
    : nextOtherAcorn(state);
}

function castAcornSkill(acorn: Acorn): Macro {
  const skill = ACORN_SKILLS[acorn];
  return Macro.if_(`hasskill ${skill}`, Macro.step(`skill ${skill}`));
}

/**
 * Plant one acorn per fight: a banish acorn on a goblin still to be banished, otherwise the sea cow acorn, then the Zydecos.
 */
export function treasuryPlantingMacro(): Macro {
  const state = treasuryAcorns();
  const goblins = goblinsToAcornBanish(state);
  const other = nextOtherAcorn(state);
  if (!goblins.length) {
    return (other ? castAcornSkill(other) : new Macro()).meatKill();
  }
  const goblinPredicate = Macro.makeBALLSPredicate(goblins);
  return Macro.if_(goblinPredicate, castAcornSkill("banish"))
    .externalIf(
      other !== null,
      Macro.if_(`!${goblinPredicate}`, castAcornSkill(other ?? "seacow")),
    )
    .meatKill();
}

let acornsBeforeFight: number | null = null;

export function prepareTreasuryPlanting(): void {
  noteBanishedGoblins();
  acornsBeforeFight = acornsGeneratedToday();
  if (acornsBeforeFight === null) {
    print(
      "Couldn't read the acorndion's acorn count. Planting anyway, and garbo will count it as no acorn.",
      HIGHLIGHT,
    );
  } else if (acornsBeforeFight >= DAILY_ACORNS) {
    print("The acorndion has no acorns left today.", HIGHLIGHT);
  }
}

/**
 * Record what the last planting fight planted, judged by the acorndion's daily count.
 */
export function recordTreasuryPlanting(): void {
  recordTreasuryFight();
  const state = treasuryAcorns();
  const monster = toMonster(get("lastEncounter"));
  const acorn = intendedAcorn(state, monster);
  state.fights++;
  const after = acornsGeneratedToday();
  if (
    acorn !== null &&
    acornsBeforeFight !== null &&
    after !== null &&
    after > acornsBeforeFight
  ) {
    if (acorn === "banish") state.banished.push(monster);
    if (acorn === "seacow") state.seaCows = true;
    if (acorn === "zydeco") state.zydecos++;
    print(
      `Planted a ${acorn} acorn fighting ${monster} in ${TREASURY}.`,
      HIGHLIGHT,
    );
  } else {
    print(
      `No acorn planted fighting ${monster} (acorns ${acornsBeforeFight} before, ${after} after).`,
      HIGHLIGHT,
    );
  }
  saveTreasuryAcorns(state);
}

/**
 * @returns Whether the Treasury can be farmed: acorns can still bring sea cows, the acorndion is owned and the Treasury is or can be flooded
 */
export function canFarmTreasury(): boolean {
  return (
    acornSeaCowsLeft() &&
    canAdventure(TREASURY) &&
    haveAcorndion() &&
    treasuryFloodable()
  );
}

/**
 * Move farming off the Treasury when it can't be flooded, its sea cows have run out or the sea cow acorn didn't take.
 */
export function leaveTreasury(reason: string): void {
  uneffect($effect`Carlweather's Cantata of Confrontation`);
  globalOptions.prefs.farmingMethod = FarmingMethod.THE_CORAL_CORRAL;
  if (!FarmingStrategy.available) {
    globalOptions.prefs.farmingMethod = FarmingMethod.BARF_MOUNTAIN;
  }
  print(
    `${reason} Farming ${globalOptions.prefs.farmingMethod} instead.`,
    HIGHLIGHT,
  );
}

/**
 * Flood the Treasury with Summon a Wave if it was the last zone adventured in.
 */
export function floodTreasury(): void {
  if (treasuryFlooded() || get("_seadentWaveUsed")) return;
  if (get("lastAdventure") !== TREASURY) return;
  const monodent = $item`Monodent of the Sea`;
  if (!have(monodent)) return;
  if (!haveEquipped(monodent)) equip($slot`weapon`, monodent);
  setChoice(1566, 1);
  useSkill($skill`Sea *dent: Summon a Wave`);
  if (!treasuryFlooded()) {
    print(
      `Summon a Wave didn't flood ${TREASURY} (flooded: "${get("_seadentWaveZone")}").`,
      HIGHLIGHT,
    );
  }
}

/**
 * Wield the acorndion through KoL's equip page. Garbo's outfits can't validate it while mafia only half knows it.
 */
export function equipAcorndion(): void {
  if (equippedItem($slot`weapon`).id === ACORNDION_ID) return;
  visitUrl(`inv_equip.php?pwd&which=2&action=equip&whichitem=${ACORNDION_ID}`);
  if (equippedItem($slot`weapon`).id !== ACORNDION_ID) {
    print("Couldn't equip the legendary acorndion.", HIGHLIGHT);
  }
}
