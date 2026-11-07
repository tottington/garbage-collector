import { OutfitSpec, Quest } from "grimoire-kolmafia";
import { PearlTarget, PearlTargets } from "garbo-lib";
import {
  adv1,
  canAdventure,
  Item,
  Location,
  mpCost,
  myAdventures,
  myAscensions,
  myBuffedstat,
  myHp,
  myMaxhp,
  myMaxmp,
  myTurncount,
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
  $item,
  $items,
  $location,
  $skill,
  $slot,
  $stat,
  get,
  have,
  PeridotOfPeril,
  set,
  sum,
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
  needsDelevel,
  sober,
} from "../../lib";
import { meatMood } from "../../mood";
import { barfOutfit, computeBarfOutfit } from "../../outfit/barf";
import { freeFightOutfit } from "../../outfit/free";
import { canBreatheUnderwater } from "../../outfit/lib";
import {
  ACORN_COW_LIMIT,
  acornCowsFought,
  acorndion,
  AcornKind,
  acornsGeneratedToday,
  acornSite,
  acornSkill,
  acornsLeftToday,
  haveAcorndion,
  observeAcornFight,
  recordPlanting,
} from "../../resources/acorns";
import { luckySourceTasks } from "../../resources/lucky";
import {
  avoidedPearlGear,
  chiassoTarget,
  fightsLeftAt,
  luckyHazard,
  moxieMargin,
  noteCow,
  openPearlZones,
  parkaMode,
  pearlBlock,
  pearlMonsters,
  pearlReserve,
  planPearls,
  resistanceBuffs,
  resistanceModifier,
  setPearlBlock,
  worstPearlAdventures,
  ZonePlan,
} from "../../resources/pearls";
import { trackMarginalMpa } from "../../session";
import {
  estimatedGarboTurns,
  wanderingCopytargetsRemaining,
} from "../../turns";
import { FarmingContext } from "../context";
import { GarboTask } from "../engine";
import { canContinue } from "./lib";
import { nonBarfTurns } from "./nonBarfTurn";

type PearlTask = GarboTask<FarmingContext>;

// Holds the ascension whose pearl block has started, so the block keeps going as its reserve shrinks
const BLOCK_PREF = "_garbo_pearlBlock";
const PLANT_FAILED_PREF = "_garbo_pearlPlantFailed";
const PLANT_ATTEMPTS = 3;

let checkedAt: number | null = null;
let acornsLeft: number | null = null;
// The open pearls when the current plan was made
let plannedOpen = 0;
let plans = 0;
let announcedPlans = 0;
const started = new Set<Location>();
const plantAttempts = new Map<Location, number>();
// Resistance worn in a zone's last pearl fight, when it fell short of the plan
const wornResistance = new Map<Location, number>();

// The adventures garbo will still spend, stopping at saveTurns or at the turn count it was given
const budget = () =>
  Math.min(
    myAdventures() - globalOptions.saveTurns,
    globalOptions.stopTurncount === null
      ? Infinity
      : globalOptions.stopTurncount - myTurncount(),
  );
// The budget left after the non-barf turns and copied wanderers garbo will still take ahead of the pearl tasks
const blockBudget = () =>
  budget() - nonBarfTurns() - wanderingCopytargetsRemaining();
// An underwater adventure costs 2 without Fishy
const fightCost = () => (freeFishyTurns() > 0 ? 1 : 2);
const plantingAllowed = () => haveAcorndion() && !get(PLANT_FAILED_PREF, false);

/**
 * Decide the pearl block once the adventures left fall to what the farmed zones need.
 * Adventures above saveTurns never count more turns than garbo has left, so an error starts the block early.
 */
function decidePearlBlock(): void {
  const latched = get(BLOCK_PREF, 0) === myAscensions();
  if (!sober() || checkedAt === myAdventures()) return;
  if (!openPearlZones().length) return setPearlBlock([]);
  if (!latched && blockBudget() > worstPearlAdventures()) return;
  checkedAt = myAdventures();
  // Acorns are lost on ascension, so a run that ends by ascending plants none
  const acorns = (acornsLeft ??=
    plantingAllowed() && !globalOptions.ascend ? acornsLeftToday() : 0);
  const zones = planPearls(acorns, freeFishyTurns());
  const farmed = zones.some((zone) => zone.farm);
  if (!latched && farmed && blockBudget() > pearlReserve(zones)) return;
  usePlan(zones);
}

function usePlan(zones: ZonePlan[]): void {
  plannedOpen = openPearlZones().length;
  plans++;
  setPearlBlock(zones);
}

/**
 * Plan again once a pearl is done and no zone the block started is part way through, so the next pearl is priced with the sea cows, Fishy and acorns left.
 * A zone part way through is always finished, since its progress is lost at rollover.
 */
function replanBetweenPearls(): void {
  const open = openPearlZones();
  if (open.length === plannedOpen) return;
  if (open.some((target) => started.has(target.location))) return;
  acornsLeft =
    plantingAllowed() && !globalOptions.ascend ? acornsLeftToday() : 0;
  usePlan(planPearls(acornsLeft, freeFishyTurns()));
}

/**
 * @returns Whether garbo has planned the pearl block, deciding it when the time comes and planning again between pearls
 */
function pearlBlockStarted(): boolean {
  if (!pearlBlock()) decidePearlBlock();
  else replanBetweenPearls();
  return !!pearlBlock()?.length;
}

const fightResistance = (zone: ZonePlan) =>
  wornResistance.get(zone.target.location) ?? zone.resistance;

const zoneAdventures = (fights: number) =>
  fights + Math.max(0, fights - freeFishyTurns());

/**
 * @param ignoreLucky Whether to allow the zones where Lucky! is a hazard while it is active
 * @returns The zone to fight in now: zones already started first, then fewest fights left, and a new zone only if the budget can finish it
 */
function currentZone(ignoreLucky = false): ZonePlan | undefined {
  const zones = (pearlBlock() ?? [])
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
      fights: fightsLeftAt(zone.target, fightResistance(zone)),
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

const acornMp = (kinds: AcornKind[]) =>
  sum(kinds, (kind) => mpCost(acornSkill(kind)));

/**
 * Pick a kill for the planting fight that never attacks: a free kill that leaves the weapon slot to the acorndion, or a damage spell whose three casts cover the zone's toughest monster.
 * @returns The kill, its MP and the gear it needs, or null when there is none
 */
function plantingKill(
  location: Location,
  kinds: AcornKind[],
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
 * @returns A delevel when Moxie is within 10 of the zone's toughest monster, counting Monster Level, or when `needsDelevel` says so for any of its monsters
 */
const zoneDelevel = (location: Location, kinds?: AcornKind[]) =>
  Macro.externalIf(
    moxieMargin(location, kinds) < 10 ||
      pearlMonsters(location, kinds).some(needsDelevel),
    Macro.delevel(),
  );

/**
 * Plant the acorns on a zone monster while HP holds, kill it, and run if the kill falls short. Any other monster, or a failed run, gets garbo's usual kill.
 */
function plantingMacro(location: Location, kinds: AcornKind[]): Macro {
  const cast = (kind: AcornKind) =>
    Macro.if_("!hppercentbelow 50", Macro.trySkill(acornSkill(kind)));
  return Macro.if_(
    pearlMonsters(location, ["R"]),
    zoneDelevel(location, ["R"])
      .externalIf(
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
  const zone = () => pearlBlock()?.find((z) => z.target === target);
  const isCurrent = () => currentZone()?.target === target;
  const toPlant = () =>
    (zone()?.plant ?? []).filter(
      (kind) => !acornSite(location).kinds.includes(kind),
    );
  let planting: AcornKind[] = [];
  let acornsBefore: number | null = null;
  let progressBefore = 0;

  const plant: PearlTask = {
    name: `Plant Acorns in ${location}`,
    ready: () =>
      isCurrent() &&
      plantingAllowed() &&
      (plantAttempts.get(location) ?? 0) < PLANT_ATTEMPTS &&
      plantingKill(location, toPlant()) !== null,
    completed: () => get(target.completionPref) || !toPlant().length,
    effects: resistanceBuffs,
    outfit: () =>
      freeFightOutfit(
        {
          modifier: [
            resistanceModifier(target, (zone() as ZonePlan).resistance),
          ],
          equip: [
            ...(toPlant().includes("B") && PeridotOfPeril.canImperil(location)
              ? $items`Peridot of Peril`
              : []),
            ...(plantingKill(location, toPlant())?.spec?.equip ?? []),
          ],
          weapon: acorndion(),
          modes: { parka: parkaMode(target.maximizeElement) },
          avoid: avoidedPearlGear().filter(
            (item) => item !== $item`Peridot of Peril`,
          ),
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
      acornsBefore = acornsGeneratedToday();
      progressBefore = get(target.progressPref);
    },
    do: () => {
      if (myHp() >= 0.9 * myMaxhp()) {
        adv1(location, -1, "");
        return;
      }
      print(`Can't plant acorns in ${location} safely now.`, HIGHLIGHT);
      plantAttempts.set(location, PLANT_ATTEMPTS);
      planting = [];
    },
    choices: () => ({
      ...wanderer().getChoices(location),
      ...PeridotOfPeril.getChoiceObject(chiassoTarget(location)),
    }),
    combat: pearlStrategy(() => plantingMacro(location, toPlant())),
    post: () => {
      if (!planting.length) return;
      // A noncombat or a wanderer in place of the zone fight leaves the planting for another try
      if (
        !pearlMonsters(location, ["R"]).includes(
          toMonster(get("lastEncounter")),
        )
      ) {
        plantAttempts.set(location, (plantAttempts.get(location) ?? 1) - 1);
        return;
      }
      recordPlanting(location, planting, acornsBefore);
      noteCow(location, observeAcornFight(location));
      const won =
        get(target.completionPref) || get(target.progressPref) > progressBefore;
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
      const worn = numericModifier(`${target.maximizeElement} Resistance`);
      if (worn >= (zone()?.resistance ?? 0)) wornResistance.delete(location);
      else wornResistance.set(location, worn);
    },
    effects: resistanceBuffs,
    outfit: () => {
      const modifier = [
        resistanceModifier(target, (zone() as ZonePlan).resistance),
      ];
      const modes = { parka: parkaMode(target.maximizeElement) };
      if (FarmingStrategy.isUnderwater()) {
        return barfOutfit({ modifier, modes, avoid: avoidedPearlGear() });
      }
      return computeBarfOutfit({
        modifier: [...modifier, "+sea"],
        modes,
        avoid: avoidedPearlGear(),
        familiar: underwaterMeatFamiliar(),
      });
    },
    do: location,
    choices: () => wanderer().getChoices(location),
    combat: pearlStrategy(() => zoneDelevel(location).meatKill()),
    post: () => noteCow(location, observeAcornFight(location)),
    spendsTurn: true,
    sobriety: "sober",
  };

  return [plant, fight];
}

/**
 * @returns Whether a Lucky! trip to The Haggling's 20 Fishy saves more adventures than its two adventures and the Lucky! are worth
 */
function hagglingWorth(): boolean {
  const uncovered =
    sum(
      pearlBlock()?.filter(
        (zone) => zone.farm && !get(zone.target.completionPref),
      ) ?? [],
      (zone) => fightsLeftAt(zone.target, fightResistance(zone)),
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

/**
 * @returns Whether to spend a Lucky! on The Haggling: to use up a Lucky! that blocks a zone, or for Fishy the zones are worth
 */
const hagglingWanted = () =>
  canAdventure($location`The Brinier Deepers`) &&
  (luckyBlocked() ||
    (freeFishyTurns() === 0 &&
      budget() >= 3 &&
      !!currentZone() &&
      hagglingWorth()));

const hagglingTasks: PearlTask[] = [
  ...luckySourceTasks.map((task) => ({
    ...task,
    name: `Pearl ${task.name}`,
    ready: () => hagglingWanted() && task.ready(),
  })),
  {
    name: "Pearl Lucky Fishy",
    ready: () => have($effect`Lucky!`) && hagglingWanted(),
    completed: () => !have($effect`Lucky!`),
    outfit: () =>
      freeFightOutfit(
        { avoid: $items`Peridot of Peril` },
        $location`The Brinier Deepers`,
      ),
    do: $location`The Brinier Deepers`,
    combat: new GarboStrategy(() => Macro.basicCombat()),
    spendsTurn: true,
    sobriety: "sober",
  },
];

const announcePlan: PearlTask = {
  name: "Announce Pearl Plan",
  completed: () => announcedPlans === plans,
  do: () => {
    announcedPlans = plans;
    const zones = pearlBlock() ?? [];
    for (const zone of zones) print(zone.summary, HIGHLIGHT);
    if (!zones.some((zone) => zone.farm)) {
      print("No pearl left is worth its adventures.", HIGHLIGHT);
      return;
    }
    print(
      `Pearl block: ${blockBudget()} adventures against a reserve of ${pearlReserve(zones)}, ${acornsLeft ?? 0} acorns left today, ${ACORN_COW_LIMIT - acornCowsFought()} acorn sea cows left.`,
      HIGHLIGHT,
    );
    set(BLOCK_PREF, myAscensions());
    trackMarginalMpa(0);
  },
  spendsTurn: false,
};

/**
 * Farms unblemished pearls in a block at the end of garbo's farming, while its meat buffs are still active, fighting acorn sea cows where the acorndion can plant them.
 * Runs only with the `pearlo` argument.
 */
export const PearlQuest = (): Quest<PearlTask, FarmingContext> => ({
  name: "Pearls",
  ready: () =>
    globalOptions.pearlo && canBreatheUnderwater() && pearlBlockStarted(),
  completed: () => !canContinue(),
  tasks: [announcePlan, ...hagglingTasks, ...PearlTargets.flatMap(zoneTasks)],
});
