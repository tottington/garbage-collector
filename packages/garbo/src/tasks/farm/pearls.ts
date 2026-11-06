import { Quest } from "grimoire-kolmafia";
import { PearlTarget, PearlTargets } from "garbo-lib";
import {
  adv1,
  canAdventure,
  canEquip,
  getMonsters,
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
  totalTurnsPlayed,
} from "kolmafia";
import {
  $effect,
  $item,
  $items,
  $location,
  $monster,
  $skill,
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
  noteCow,
  pearlFightsLeft,
  planPearls,
  resistanceBuffs,
  worstPearlAdventures,
  ZonePlan,
} from "../../resources/pearls";
import { estimatedGarboTurns } from "../../turns";
import { FarmingContext } from "../context";
import { GarboTask } from "../engine";
import { canContinue } from "./lib";

type PearlTask = GarboTask<FarmingContext>;

// Holds the ascension whose pearl block has started, so the block keeps going as its reserve shrinks
const BLOCK_PREF = "_garboPearlBlock";
const PLANT_FAILED_PREF = "_garboPearlPlantFailed";
const PLANT_ATTEMPTS = 3;
// MP for Chiasso de los Muertos, Juvenile Refrain and Line of Zydeco
const ACORN_MP = 34;

let plan: ZonePlan[] | null = null;
let decided = false;
let checkedAt: number | null = null;
let acornsLeft: number | null = null;
let reported = false;
let hagglingFailed = false;
const started = new Set<Location>();
const plantAttempts = new Map<Location, number>();

const budget = () => myAdventures() - globalOptions.saveTurns;
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
 * Decide the pearl block once the sober adventures left fall to what the farmed zones need.
 * Adventures above saveTurns are a lower bound on the sober turns left, so errors start the block early.
 * @returns The block's zones once it has started
 */
function blockPlan(): ZonePlan[] | null {
  if (plan) return plan;
  const latched = get(BLOCK_PREF, 0) === myAscensions();
  if (decided || !sober() || checkedAt === myAdventures()) return null;
  if (!latched && budget() > worstPearlAdventures()) return null;
  checkedAt = myAdventures();
  const acorns = (acornsLeft ??= plantingAllowed() ? acornsLeftToday() : 0);
  const zones = planPearls(acorns, freeFishyTurns());
  const farmed = zones.some((zone) => zone.farm);
  if (!latched && farmed && budget() > reserve(zones)) return null;
  decided = true;
  for (const zone of zones) print(zone.summary, HIGHLIGHT);
  print(
    `Pearl block: ${budget()} adventures against a reserve of ${reserve(zones)}, ${acorns} acorns left today.`,
    HIGHLIGHT,
  );
  if (!farmed) return null;
  set(BLOCK_PREF, myAscensions());
  plan = zones;
  return plan;
}

const zoneAdventures = (fights: number) =>
  fights + Math.max(0, fights - freeFishyTurns());

/**
 * @returns The zone to fight in now: zones already started first, then fewest fights left, and a new zone only if the budget can finish it
 */
function currentZone(): ZonePlan | undefined {
  const zones = (blockPlan() ?? [])
    .filter(
      ({ farm, target }) =>
        farm &&
        !get(target.completionPref) &&
        !(luckyHazard(target.location) && have($effect`Lucky!`)),
    )
    .map((zone) => ({
      zone,
      fights: pearlFightsLeft(zone.target, zone.resistance),
      started: started.has(zone.target.location),
    }))
    .sort(
      (a, b) => Number(b.started) - Number(a.started) || a.fights - b.fights,
    );
  return zones.find(
    ({ fights, started }) =>
      started || budget() >= Math.ceil(1.1 * zoneAdventures(fights)) + 1,
  )?.zone;
}

const resistanceModifier = (zone: ZonePlan) =>
  `1000 ${zone.target.maximizeElement} Resistance ${zone.resistance} max`;

/**
 * Pick a kill for the planting fight that never attacks: a free kill, or a damage spell whose three casts cover the zone's toughest monster.
 * @returns The kill and its MP, or null when there is none
 */
function plantingKill(location: Location): { macro: Macro; mp: number } | null {
  if (have($skill`Shattering Punch`) && get("_shatteringPunchUsed") < 3) {
    return { macro: Macro.skill($skill`Shattering Punch`), mp: 0 };
  }
  if (have($skill`Gingerbread Mob Hit`) && !get("_gingerbreadMobHitUsed")) {
    return { macro: Macro.skill($skill`Gingerbread Mob Hit`), mp: 0 };
  }
  const batoomerang = $item`replica bat-oomerang`;
  if (have(batoomerang) && get("_usedReplicaBatoomerang") < 3) {
    return { macro: Macro.item(batoomerang), mp: 0 };
  }
  const monsters = getMonsters(location);
  if (acornSite(location).kinds.includes("R")) monsters.push($monster`sea cow`);
  const hp = Math.max(...monsters.map((m) => m.baseHp));
  const myst = myBuffedstat($stat`Mysticality`);
  const spell = (
    [
      [$skill`Saucegeyser`, 65, 0.4],
      [$skill`Weapon of the Pastalord`, 48, 0.5],
    ] as const
  ).find(
    ([skill, base, scale]) =>
      have(skill) &&
      myMaxmp() >= ACORN_MP + 3 * mpCost(skill) &&
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

function plantingMacro(location: Location, kinds: string): Macro {
  return Macro.externalIf(
    kinds.includes("B"),
    Macro.if_(chiassoTarget(location), Macro.trySkill(acornSkill("B"))),
  )
    .externalIf(kinds.includes("R"), Macro.trySkill(acornSkill("R")))
    .externalIf(kinds.includes("Z"), Macro.trySkill(acornSkill("Z")))
    .step(plantingKill(location)?.macro ?? new Macro())
    .runaway()
    .abortWithMsg(`The acorn planting fight in ${location} didn't end.`);
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
      plantingKill(location) !== null,
    completed: () => get(target.completionPref) || !toPlant(),
    effects: resistanceBuffs,
    outfit: () =>
      freeFightOutfit(
        {
          modifier: [resistanceModifier(zone() as ZonePlan)],
          equip:
            toPlant().includes("B") && PeridotOfPeril.canImperil(location)
              ? $items`Peridot of Peril`
              : [],
          avoid: $items`Mer-kin digpick, broken champagne bottle`,
        },
        location,
      ),
    prepare: () => {
      started.add(location);
      plantAttempts.set(location, (plantAttempts.get(location) ?? 0) + 1);
      getFreeFishy();
      restoreHp(0.9 * myMaxhp());
      restoreMp(
        Math.min(myMaxmp(), ACORN_MP + (plantingKill(location)?.mp ?? 0)),
      );
      planting = toPlant();
      if (!equipAcorndion()) {
        set(PLANT_FAILED_PREF, true);
        planting = "";
      }
      acornsBefore = acornsGeneratedToday();
      progressBefore = get(target.progressPref, 0);
    },
    do: () => {
      if (planting && myHp() >= 0.9 * myMaxhp()) {
        adv1(location, -1, "");
      } else {
        print(`Can't plant acorns in ${location} safely now.`, HIGHLIGHT);
        plantAttempts.set(location, PLANT_ATTEMPTS);
        planting = "";
      }
    },
    choices: () => ({
      ...wanderer().getChoices(location),
      1557: `1&bandersnatch=${chiassoTarget(location).id}`,
    }),
    combat: pearlStrategy(() => plantingMacro(location, toPlant())),
    post: () => {
      if (!planting) return;
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
    },
    effects: resistanceBuffs,
    outfit: () => {
      const modifier = [resistanceModifier(zone() as ZonePlan)];
      if (FarmingStrategy.isUnderwater()) {
        return barfOutfit({ modifier, avoid: avoidedPearlGear() });
      }
      return barfOutfit({
        modifier: [...modifier, "+sea"],
        avoid: avoidedPearlGear(),
        familiar: underwaterMeatFamiliar(),
      });
    },
    do: location,
    choices: () => wanderer().getChoices(location),
    combat: pearlStrategy(() =>
      Macro.externalIf(
        myBuffedstat($stat`Moxie`) <
          Math.max(...getMonsters(location).map((m) => m.baseAttack)) + 10,
        Macro.delevel(),
      ).meatKill(),
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
 * @returns Whether a Lucky! trip to The Haggling's 20 Fishy saves more adventures than its turn and the Lucky! are worth
 */
function hagglingWorth(): boolean {
  const uncovered =
    sum(
      plan?.filter((zone) => zone.farm && !get(zone.target.completionPref)) ??
        [],
      (zone) => pearlFightsLeft(zone.target, zone.resistance),
    ) - freeFishyTurns();
  return (
    uncovered > 1 &&
    (Math.min(19, uncovered) - 1) * get("valueOfAdventure") >
      getBestLuckyAdventure().value()
  );
}

const haggling: PearlTask = {
  name: "Pearl Lucky Fishy",
  ready: () =>
    !hagglingFailed &&
    freeFishyTurns() === 0 &&
    canAdventure($location`The Brinier Deepers`) &&
    !!currentZone() &&
    hagglingWorth(),
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
 * Farms unblemished pearls in a block at the end of each sober leg, inside garbo's buffed loop, with acorn sea cows where the acorndion can plant them.
 */
export const PearlQuest = (): Quest<PearlTask, FarmingContext> => ({
  name: "Pearls",
  ready: canBreatheUnderwater,
  completed: () => !canContinue(),
  tasks: [haggling, ...PearlTargets.flatMap(zoneTasks), report],
});
