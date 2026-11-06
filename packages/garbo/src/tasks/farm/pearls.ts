import { OutfitSpec, Quest } from "grimoire-kolmafia";
import { PearlTarget, PearlTargets } from "garbo-lib";
import {
  adv1,
  canAdventure,
  canEquip,
  Item,
  Location,
  mpCost,
  myAdventures,
  myAscensions,
  myBuffedstat,
  myHp,
  myMaxhp,
  myMaxmp,
  numericModifier,
  print,
  restoreHp,
  restoreMp,
  toMonster,
  toSlot,
  totalTurnsPlayed,
} from "kolmafia";
import {
  $effect,
  $items,
  $location,
  $skill,
  $slot,
  $stat,
  get,
  getModifier,
  have,
  PeridotOfPeril,
  set,
  sum,
  undelay,
} from "libram";
import { Macro } from "../../combat";
import { GarboStrategy } from "../../combatStrategy";
import { globalOptions } from "../../config";
import { FarmingStrategy } from "../../farmingStrategy";
import { findFreeKill } from "../../fights";
import { underwaterMeatFamiliar } from "../../familiar/meatFamiliar";
import { wanderer } from "../../garboWanderer";
import {
  freeFishyTurns,
  getBestLuckyAdventure,
  getFreeFishy,
  HIGHLIGHT,
  sober,
} from "../../lib";
import { meatMood } from "../../mood";
import { barfOutfit } from "../../outfit/barf";
import { freeFightOutfit } from "../../outfit/free";
import { waterBreathingEquipment } from "../../outfit/lib";
import {
  acorndion,
  acornsGeneratedToday,
  acornSite,
  acornSkill,
  acornsLeftToday,
  equipAcorndion,
  haveAcorndion,
  observeAcornFight,
  recordPlanting,
} from "../../resources/acorns";
import { luckySourceTasks } from "../../resources/lucky";
import {
  avoidedPearlGear,
  chiassoTarget,
  luckyHazard,
  moxieMargin,
  noteCow,
  openPearlZones,
  parkaMode,
  pearlFightsLeft,
  pearlMonsters,
  planPearls,
  resistanceBuffs,
  setPearlTurnsReserved,
  worstPearlAdventures,
  zoneChoices,
  ZonePlan,
} from "../../resources/pearls";
import { trackMarginalMpa } from "../../session";
import { estimatedGarboTurns } from "../../turns";
import { FarmingContext } from "../context";
import { GarboTask } from "../engine";
import { canContinue } from "./lib";
import { nonBarfTurns } from "./nonBarfTurn";

type PearlTask = GarboTask<FarmingContext>;

// Holds the ascension whose pearl block has started, so the block keeps going as its reserve shrinks
const BLOCK_PREF = "_garboPearlBlock";
const PLANT_FAILED_PREF = "_garboPearlPlantFailed";
const PLANT_ATTEMPTS = 3;

let plan: ZonePlan[] | null = null;
let decided = false;
let checkedAt: number | null = null;
let acornsLeft: number | null = null;
let reported = false;
let hagglingFailed = false;
const started = new Set<Location>();
const plantAttempts = new Map<Location, number>();
// Resistance worn in a zone's last pearl fight, when it fell short of the plan
const wornResistance = new Map<Location, number>();

const budget = () => myAdventures() - globalOptions.saveTurns;
// The budget left after the non-barf turns garbo will still take ahead of the pearl tasks
const blockBudget = () => budget() - nonBarfTurns();
// An underwater adventure costs 2 without Fishy
const fightCost = () => (freeFishyTurns() > 0 ? 1 : 2);
const plantingAllowed = () => haveAcorndion() && !get(PLANT_FAILED_PREF, false);
const canBreatheUnderwater = () =>
  getModifier("Adventure Underwater") ||
  waterBreathingEquipment.some((item) => have(item) && canEquip(item));

const reserve = (zones: ZonePlan[]) =>
  sum(
    zones.filter((zone) => zone.farm),
    (zone) => Math.ceil(1.15 * zone.adventures) + (zone.plant ? 1 : 0),
  ) + 3;

/**
 * Start the pearl block once the adventures left fall to what the farmed zones need.
 * Adventures above saveTurns never count more turns than garbo has left, so an error starts the block early.
 * @returns The block's zones once it has started
 */
function blockPlan(): ZonePlan[] | null {
  if (plan) return plan;
  const latched = get(BLOCK_PREF, 0) === myAscensions();
  if (decided || !sober() || checkedAt === myAdventures()) return null;
  if (!openPearlZones().length) {
    decided = true;
    return null;
  }
  if (!latched && blockBudget() > worstPearlAdventures()) return null;
  checkedAt = myAdventures();
  // Acorns are lost on ascension, so a run that ends by ascending plants none
  const acorns = (acornsLeft ??=
    plantingAllowed() && !globalOptions.ascend ? acornsLeftToday() : 0);
  const zones = planPearls(acorns, freeFishyTurns());
  const farmed = zones.some((zone) => zone.farm);
  if (!latched && farmed && blockBudget() > reserve(zones)) return null;
  decided = true;
  for (const zone of zones) print(zone.summary, HIGHLIGHT);
  print(
    `Pearl block: ${blockBudget()} adventures against a reserve of ${reserve(zones)}, ${acorns} acorns left today.`,
    HIGHLIGHT,
  );
  if (!farmed) return null;
  set(BLOCK_PREF, myAscensions());
  trackMarginalMpa(0);
  plan = zones;
  return plan;
}

setPearlTurnsReserved(() =>
  plan
    ? reserve(plan)
    : decided || !sober() || !canBreatheUnderwater()
      ? 0
      : worstPearlAdventures(),
);

const fightResistance = (zone: ZonePlan) =>
  wornResistance.get(zone.target.location) ?? zone.resistance;

const zoneAdventures = (fights: number) =>
  fights + Math.max(0, fights - freeFishyTurns());

/**
 * @param ignoreLucky Whether to allow the zones where Lucky! is a hazard while it is active
 * @returns The zone to fight in now: zones already started first, then fewest fights left, and a new zone only if the budget can finish it
 */
function currentZone(ignoreLucky = false): ZonePlan | undefined {
  const zones = (blockPlan() ?? [])
    .filter(
      ({ farm, target }) =>
        farm &&
        !get(target.completionPref) &&
        !(
          !ignoreLucky &&
          luckyHazard(target.location) &&
          have($effect`Lucky!`)
        ),
    )
    .map((zone) => ({
      zone,
      fights: pearlFightsLeft(zone.target, fightResistance(zone)),
      started: started.has(zone.target.location),
    }))
    .sort(
      (a, b) => Number(b.started) - Number(a.started) || a.fights - b.fights,
    );
  if (!zones.length || budget() < fightCost()) return undefined;
  let room: number | undefined;
  return zones.find(
    ({ fights, started }) =>
      started ||
      (room ??= blockBudget()) >= Math.ceil(1.1 * zoneAdventures(fights)) + 1,
  )?.zone;
}

const resistanceModifier = (zone: ZonePlan) =>
  `1000 ${zone.target.maximizeElement} Resistance ${zone.resistance} max`;

const acornMp = (kinds: string) =>
  sum([...kinds], (kind) => mpCost(acornSkill(kind)));

/**
 * Pick a kill for the planting fight that never attacks: a free kill that leaves the weapon slot to the acorndion, or a damage spell whose three casts cover the zone's toughest monster.
 * @returns The kill, its MP and the gear it needs, or null when there is none
 */
function plantingKill(
  location: Location,
  kinds: string,
): { macro: Macro; mp: number; spec?: OutfitSpec } | null {
  const mp = acornMp(kinds);
  const freeKill = findFreeKill(
    ({ spec, macro }) =>
      !spec?.equip?.some((item) => toSlot(item) === $slot`weapon`) &&
      myMaxmp() >= mp + (macro instanceof Item ? 0 : mpCost(macro)),
  );
  if (freeKill) {
    const { macro, spec } = freeKill;
    return macro instanceof Item
      ? { macro: Macro.tryItem(macro), mp: 0, spec }
      : { macro: Macro.trySkill(macro), mp: mpCost(macro), spec };
  }
  const hp = Math.max(...pearlMonsters(location).map((m) => m.baseHp));
  const myst = myBuffedstat($stat`Mysticality`);
  const spell = (
    [
      [$skill`Saucegeyser`, 65, 0.4],
      [$skill`Weapon of the Pastalord`, 48, 0.5],
    ] as const
  ).find(
    ([skill, base, scale]) =>
      have(skill) &&
      myMaxmp() >= mp + 3 * mpCost(skill) &&
      3 *
        ((base + scale * myst) *
          (1 + numericModifier("Spell Damage Percent") / 100) +
          numericModifier("Spell Damage")) >=
        hp,
  )?.[0];
  if (!spell) return null;
  return {
    macro: Macro.while_(
      `${Macro.makeBALLSPredicate(spell)} && !pastround 20 && !hppercentbelow 30`,
      Macro.skill(spell),
    ),
    mp: 3 * mpCost(spell),
  };
}

/**
 * Plant the acorns on a zone monster while HP holds, kill it, and run if the kill falls short. Any other monster, or a failed run, gets garbo's usual kill.
 */
function plantingMacro(location: Location, kinds: string): Macro {
  const cast = (kind: string) =>
    Macro.if_("!hppercentbelow 50", Macro.trySkill(acornSkill(kind)));
  return Macro.if_(
    pearlMonsters(location, "R"),
    Macro.externalIf(
      kinds.includes("B"),
      Macro.if_(chiassoTarget(location), cast("B")),
    )
      .externalIf(kinds.includes("R"), cast("R"))
      .externalIf(kinds.includes("Z"), cast("Z"))
      .step(plantingKill(location, kinds)?.macro ?? new Macro())
      .runaway(),
  ).meatKill();
}

const pearlStrategy = (macro: () => Macro) =>
  new GarboStrategy(macro, macro, () => true, {
    innateWanderer: () => Macro.basicCombat(),
  });

function zoneTasks(target: PearlTarget): PearlTask[] {
  const location = target.location;
  const zone = () => plan?.find((z) => z.target === target);
  const isCurrent = () => currentZone()?.target === target;
  const toPlant = () =>
    [...(zone()?.plant ?? "")]
      .filter((kind) => !acornSite(location).kinds.includes(kind))
      .join("");
  let planting = "";
  let acornsBefore: number | null = null;
  let progressBefore = 0;

  const plant: PearlTask = {
    name: `Plant Acorns in ${location}`,
    ready: () =>
      isCurrent() &&
      plantingAllowed() &&
      (plantAttempts.get(location) ?? 0) < PLANT_ATTEMPTS &&
      plantingKill(location, toPlant()) !== null,
    completed: () => get(target.completionPref) || !toPlant(),
    effects: resistanceBuffs,
    outfit: () =>
      freeFightOutfit(
        {
          modifier: [resistanceModifier(zone() as ZonePlan)],
          equip: [
            ...(toPlant().includes("B") && PeridotOfPeril.canImperil(location)
              ? $items`Peridot of Peril`
              : []),
            ...(plantingKill(location, toPlant())?.spec?.equip ?? []),
          ],
          ...(canEquip(acorndion()) ? { weapon: acorndion() } : {}),
          modes: { parka: parkaMode(target.maximizeElement) },
          avoid: $items`Mer-kin digpick, broken champagne bottle`,
        },
        location,
      ),
    prepare: () => {
      started.add(location);
      plantAttempts.set(location, (plantAttempts.get(location) ?? 0) + 1);
      getFreeFishy();
      planting = toPlant();
      restoreHp(0.9 * myMaxhp());
      restoreMp(
        Math.min(
          myMaxmp(),
          acornMp(planting) + (plantingKill(location, planting)?.mp ?? 0),
        ),
      );
      if (!equipAcorndion()) {
        print(
          "Couldn't wield the legendary acorndion; no acorn planting today.",
          "red",
        );
        set(PLANT_FAILED_PREF, true);
        planting = "";
      }
      acornsBefore = acornsGeneratedToday();
      progressBefore = get(target.progressPref, 0);
    },
    do: () => {
      if (!planting) return;
      if (myHp() < 0.9 * myMaxhp()) {
        print(`Can't plant acorns in ${location} safely now.`, HIGHLIGHT);
      } else if (moxieMargin(location) < 10) {
        print(
          `Moxie is too low to plant acorns in ${location} safely.`,
          HIGHLIGHT,
        );
      } else {
        adv1(location, -1, "");
        return;
      }
      plantAttempts.set(location, PLANT_ATTEMPTS);
      planting = "";
    },
    choices: () => ({
      ...wanderer().getChoices(location),
      ...zoneChoices(location),
      1557: `1&bandersnatch=${chiassoTarget(location).id}`,
    }),
    combat: pearlStrategy(() => plantingMacro(location, toPlant())),
    post: () => {
      if (!planting) return;
      // A noncombat or a wanderer in place of the zone fight leaves the planting for another try
      if (
        !pearlMonsters(location, "R").includes(toMonster(get("lastEncounter")))
      ) {
        plantAttempts.set(location, (plantAttempts.get(location) ?? 1) - 1);
        return;
      }
      recordPlanting(location, planting, acornsBefore);
      noteCow(location, observeAcornFight(location));
      const won =
        get(target.completionPref) ||
        get(target.progressPref, 0) > progressBefore;
      if (!won || have($effect`Beaten Up`)) {
        set(PLANT_FAILED_PREF, true);
        print(`Lost the acorn planting fight in ${location}.`, "red");
      }
    },
    spendsTurn: true,
    sobriety: "sober",
  };

  const fight: PearlTask = {
    name: `Pearl in ${location}`,
    ready: isCurrent,
    completed: () => get(target.completionPref),
    prepare: () => {
      started.add(location);
      getFreeFishy();
      if (!(totalTurnsPlayed() % 11)) meatMood().execute(estimatedGarboTurns());
      if (myHp() < 0.8 * myMaxhp()) restoreHp(0.9 * myMaxhp());
      const planned = zone()?.resistance ?? 0;
      const worn = numericModifier(`${target.maximizeElement} Resistance`);
      if (worn >= planned) {
        wornResistance.delete(location);
      } else if (wornResistance.get(location) !== worn) {
        wornResistance.set(location, worn);
        print(
          `Wearing ${worn} ${target.maximizeElement} resistance in ${location}, below the planned ${planned}.`,
          HIGHLIGHT,
        );
      }
    },
    effects: resistanceBuffs,
    outfit: () => {
      const modifier = [resistanceModifier(zone() as ZonePlan)];
      const modes = { parka: parkaMode(target.maximizeElement) };
      if (FarmingStrategy.isUnderwater()) {
        return barfOutfit({ modifier, modes, avoid: avoidedPearlGear() });
      }
      return barfOutfit({
        modifier: [...modifier, "+sea"],
        modes,
        avoid: avoidedPearlGear(),
        familiar: underwaterMeatFamiliar(),
      });
    },
    do: location,
    choices: () => ({
      ...wanderer().getChoices(location),
      ...zoneChoices(location),
    }),
    combat: pearlStrategy(() =>
      Macro.externalIf(moxieMargin(location) < 10, Macro.delevel()).meatKill(),
    ),
    post: () => noteCow(location, observeAcornFight(location)),
    spendsTurn: true,
    sobriety: "sober",
  };

  return [plant, fight];
}

const luckySource = () =>
  luckySourceTasks.find((task) => !task.completed() && undelay(task.turns));

/**
 * @returns Whether a Lucky! trip to The Haggling's 20 Fishy saves more adventures than its two adventures and the Lucky! are worth
 */
function hagglingWorth(): boolean {
  const uncovered =
    sum(
      plan?.filter((zone) => zone.farm && !get(zone.target.completionPref)) ??
        [],
      (zone) => pearlFightsLeft(zone.target, fightResistance(zone)),
    ) - freeFishyTurns();
  return (
    uncovered > 2 &&
    (Math.min(20, uncovered) - 2) * get("valueOfAdventure") >
      getBestLuckyAdventure().value()
  );
}

/**
 * @returns Whether an active Lucky! is all that keeps the block from a zone
 */
const luckyBlocked = () =>
  have($effect`Lucky!`) && !currentZone() && !!currentZone(true);

const haggling: PearlTask = {
  name: "Pearl Lucky Fishy",
  ready: () =>
    !hagglingFailed &&
    canAdventure($location`The Brinier Deepers`) &&
    (luckyBlocked() ||
      (freeFishyTurns() === 0 &&
        budget() >= 3 &&
        !!currentZone() &&
        hagglingWorth())),
  completed: () => !have($effect`Lucky!`) && !luckySource(),
  outfit: () =>
    freeFightOutfit(
      { avoid: $items`Peridot of Peril` },
      $location`The Brinier Deepers`,
    ),
  do: () => {
    if (!have($effect`Lucky!`)) luckySource()?.do();
    if (have($effect`Lucky!`)) adv1($location`The Brinier Deepers`, -1, "");
    else hagglingFailed = true;
  },
  combat: new GarboStrategy(() => Macro.basicCombat()),
  spendsTurn: true,
  sobriety: "sober",
};

const report: PearlTask = {
  name: "Pearl Block Report",
  ready: () => !!plan && !currentZone() && !have($effect`Lucky!`),
  completed: () => reported,
  do: () => {
    reported = true;
    print(
      `Pearl block done with ${budget()} adventures above saveTurns.`,
      HIGHLIGHT,
    );
  },
  spendsTurn: false,
};

/**
 * Farms unblemished pearls in a block at the end of garbo's farming, while its meat buffs are still active, fighting acorn sea cows where the acorndion can plant them.
 */
export const PearlQuest = (): Quest<PearlTask, FarmingContext> => ({
  name: "Pearls",
  ready: canBreatheUnderwater,
  completed: () => !canContinue(),
  tasks: [haggling, ...PearlTargets.flatMap(zoneTasks), report],
});
