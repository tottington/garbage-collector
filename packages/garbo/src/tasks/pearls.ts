import { Quest } from "grimoire-kolmafia";
import {
  canAdventure,
  canEquip,
  Effect,
  Element,
  haveEffect,
  hermit,
  itemAmount,
  mallPrice,
  maximize,
  mpCost,
  myAdventures,
  npcPrice,
  numericModifier,
  print,
  Skill,
  toSkill,
  turnsPerCast,
  use,
} from "kolmafia";
import {
  $effect,
  $effects,
  $item,
  $items,
  $location,
  $skill,
  clamp,
  get,
  getModifier,
  have,
  sum,
  undelay,
} from "libram";
import { PearlTarget, PearlTargets } from "garbo-lib";
import { acquire } from "../acquire";
import { Macro } from "../combat";
import { GarboStrategy } from "../combatStrategy";
import { globalOptions } from "../config";
import { garboValue } from "../garboValue";
import { wanderer } from "../garboWanderer";
import {
  getBestLuckyAdventure,
  getFreeFishy,
  HIGHLIGHT,
  meatPerMp,
  sober,
} from "../lib";
import { freeFightOutfit } from "../outfit/free";
import { waterBreathingEquipment } from "../outfit/lib";
import { luckySourceTasks } from "../resources/lucky";
import { GarboTask } from "./engine";

const PEARL = $item`unblemished pearl`;
const CLOVER = $item`11-leaf clover`;
const RESISTANCE_BUFFS = $effects`Elemental Saucesphere, Astral Shell`;
const FISHY_PIPE_TURNS = 10;
const SKATE_LUTZ_TURNS = 30;
// The Haggling, The Brinier Deepers' Lucky! adventure, grants 20 turns of Fishy
const HAGGLING = $location`The Brinier Deepers`;
const HAGGLING_FISHY_TURNS = 20;
const HERMIT_CLOVERS_PER_DAY = 3;
// Pearl zone monsters have 600 to 800 HP
const KILL_CASTS_PER_FIGHT = 2;

// 1.7% progress per 3 points of the zone's resistance, from 1.7% up to 10% at 18
const progressPerFight = (resistance: number): number =>
  clamp(1.7 * Math.floor(resistance / 3), 1.7, 10);

function resistanceBuffs(): Effect[] {
  return RESISTANCE_BUFFS.filter(
    (effect) => have(effect) || have(toSkill(effect)),
  );
}

const resistanceEstimates = new Map<Element, number>();
/**
 * The zone resistance the maximizer can reach, plus free resistance buffs not yet active.
 */
function expectedResistance(element: Element): number {
  const estimate = resistanceEstimates.get(element);
  if (estimate !== undefined) return estimate;
  const modifier = `${element} Resistance`;
  maximize(`${modifier} 18 max, +sea`, 0, 0, true, false);
  const resistance =
    numericModifier("Generated:_spec", modifier) +
    sum(
      resistanceBuffs().filter((effect) => !have(effect)),
      (effect) => numericModifier(effect, modifier),
    );
  resistanceEstimates.set(element, resistance);
  return resistance;
}

// The pearl outfit adds +sea, which needs a breathing effect or breathing gear to choose from
function canBreatheUnderwater(): boolean {
  return (
    getModifier("Adventure Underwater") ||
    waterBreathingEquipment.some((item) => have(item) && canEquip(item))
  );
}

const pipeAvailable = () => have($item`fishy pipe`) && !get("_fishyPipeUsed");
const lutzAvailable = () =>
  get("skateParkStatus") === "ice" && !get("_skateBuff1");

function freeFishyTurns(): number {
  return (
    haveEffect($effect`Fishy`) +
    (pipeAvailable() ? FISHY_PIPE_TURNS : 0) +
    (lutzAvailable() ? SKATE_LUTZ_TURNS : 0)
  );
}

type LuckySource = { name: string; cost: number; acquire: () => boolean };

/**
 * Ways to get Lucky! for The Haggling, cheapest first. A Lucky! source garbo would otherwise use costs garbo's best Lucky! adventure; a clover costs its value.
 */
function luckySources(): LuckySource[] {
  if (!canAdventure(HAGGLING)) return [];
  const garboLuckyValue = Math.max(0, getBestLuckyAdventure().value());
  const daily = luckySourceTasks
    .filter((task) => !task.completed())
    .flatMap((task) =>
      new Array<LuckySource>(undelay(task.turns)).fill({
        name: task.name,
        cost: garboLuckyValue,
        acquire: () => {
          task.do();
          return have($effect`Lucky!`);
        },
      }),
    );
  const owned = new Array<LuckySource>(itemAmount(CLOVER)).fill({
    name: "11-leaf clover",
    cost: garboValue(CLOVER),
    acquire: () => use(CLOVER),
  });
  const hermitClovers = new Array<LuckySource>(
    Math.max(0, HERMIT_CLOVERS_PER_DAY - get("_cloversPurchased")),
  ).fill({
    name: "hermit 11-leaf clover",
    cost: garboValue(CLOVER) + npcPrice($item`chewing gum on a string`),
    acquire: () => hermit(CLOVER, 1) && use(CLOVER),
  });
  const mallPriceOfClover = mallPrice(CLOVER);
  const mall: LuckySource = {
    name: "mall 11-leaf clover",
    cost: mallPriceOfClover,
    acquire: () =>
      acquire(1, CLOVER, mallPriceOfClover, false) > 0 && use(CLOVER),
  };
  return [
    ...[...daily, ...owned, ...hermitClovers].sort((a, b) => a.cost - b.cost),
    ...(mallPriceOfClover > 0 ? new Array<LuckySource>(5).fill(mall) : []),
  ];
}

type ZonePlan = {
  target: PearlTarget;
  resistance: number;
  fights: number;
  turns: number;
  cost: number;
  farm: boolean;
};

type DayPlan = { zones: ZonePlan[]; luckyTrips: number };

/**
 * Prices finishing the zones' pearls in order of fewest fights, sharing the day's Fishy between them. A fight costs a turn at the user's value of adventure while Fishy lasts and two after. Free Fishy goes first, then a Lucky! trip to The Haggling whenever the turns it saves beat its trip turn and Lucky! cost. Kill spells and resistance buffs cost MP at garbo's meat-per-MP rate. Garbo farms the number of zones that earns the most in total, so zones share the cost of a trip.
 */
function planDay(): DayPlan {
  const valueOfAdventure = get("valueOfAdventure");
  const pearlValue = garboValue(PEARL);
  const sources = luckySources();
  let fishy = freeFishyTurns();
  let luckyTrips = 0;
  const zones: ZonePlan[] = [];
  const tripsAfter: number[] = [];

  const candidates = PearlTargets.filter(
    (target) => !get(target.completionPref) && canAdventure(target.location),
  )
    .map((target) => {
      const resistance = expectedResistance(target.maximizeElement);
      const fights = Math.ceil(
        (100 - get(target.progressPref, 0)) / progressPerFight(resistance),
      );
      return { target, resistance, fights };
    })
    .sort((a, b) => a.fights - b.fights);

  for (const { target, resistance, fights } of candidates) {
    let turns = 0;
    let luckyCost = 0;
    let left = fights;

    const covered = Math.min(fishy, left);
    fishy -= covered;
    left -= covered;
    turns += covered;
    while (left > 0 && luckyTrips < sources.length) {
      const covers = Math.min(HAGGLING_FISHY_TURNS - 1, left);
      if ((covers - 1) * valueOfAdventure <= sources[luckyTrips].cost) break;
      luckyCost += sources[luckyTrips].cost;
      turns += 1 + covers;
      fishy += HAGGLING_FISHY_TURNS - 1 - covers;
      left -= covers;
      luckyTrips++;
    }
    turns += 2 * left;

    const killMp = have($skill`Saucegeyser`)
      ? fights * KILL_CASTS_PER_FIGHT * mpCost($skill`Saucegeyser`)
      : 0;
    const buffMp = sum(resistanceBuffs(), (effect) =>
      buffMpFor(toSkill(effect), turns),
    );
    const cost =
      turns * valueOfAdventure + luckyCost + (killMp + buffMp) * meatPerMp();
    zones.push({ target, resistance, fights, turns, cost, farm: false });
    tripsAfter.push(luckyTrips);
  }

  const adventures = myAdventures() - globalOptions.saveTurns;
  let best = 0;
  let bestProfit = 0;
  let profit = 0;
  let turnsUsed = 0;
  zones.forEach((zone, index) => {
    profit += pearlValue - zone.cost;
    turnsUsed += zone.turns;
    if (turnsUsed <= adventures && profit > bestProfit) {
      best = index + 1;
      bestProfit = profit;
    }
  });
  zones.slice(0, best).forEach((zone) => (zone.farm = true));
  return { zones, luckyTrips: best > 0 ? tripsAfter[best - 1] : 0 };
}

// MP to keep a buff up for the turns
function buffMpFor(skill: Skill, turns: number): number {
  return Math.ceil(turns / Math.max(turnsPerCast(skill), 1)) * mpCost(skill);
}

let dayPlan: DayPlan | undefined;
function plan(): DayPlan {
  if (!dayPlan) {
    dayPlan = planDay();
    const pearlValue = Math.round(garboValue(PEARL));
    for (const zone of dayPlan.zones) {
      print(
        `Pearl in ${zone.target.location}: ${zone.resistance} ${zone.target.maximizeElement} resistance, ${zone.fights} fights over ${zone.turns} turns costing ${Math.round(zone.cost)} against a ${pearlValue} pearl. ${zone.farm ? "Farming it." : "Skipping it."}`,
        HIGHLIGHT,
      );
    }
    if (dayPlan.luckyTrips > 0) {
      print(
        `Planning ${dayPlan.luckyTrips} Lucky! trips to ${HAGGLING} for Fishy.`,
        HIGHLIGHT,
      );
    }
  }
  return dayPlan;
}

const farming = (target: PearlTarget) =>
  plan().zones.some((zone) => zone.target === target && zone.farm);
const pearlsLeft = () =>
  plan().zones.some((zone) => zone.farm && !get(zone.target.completionPref));

let luckyTripsTaken = 0;
function getLucky(): boolean {
  if (have($effect`Lucky!`)) return true;
  for (const source of luckySources()) {
    if (source.acquire() && have($effect`Lucky!`)) return true;
  }
  return false;
}

const luckyFishyTask: GarboTask = {
  name: "Lucky Fishy",
  ready: () =>
    sober() &&
    pearlsLeft() &&
    haveEffect($effect`Fishy`) <= 1 &&
    !pipeAvailable() &&
    !lutzAvailable() &&
    canAdventure(HAGGLING),
  completed: () => luckyTripsTaken >= plan().luckyTrips,
  prepare: () => {
    if (!getLucky()) {
      print("Couldn't get Lucky! for Fishy.", HIGHLIGHT);
      luckyTripsTaken = plan().luckyTrips;
    }
  },
  outfit: () => freeFightOutfit({ avoid: $items`Peridot of Peril` }, HAGGLING),
  do: HAGGLING,
  post: () => luckyTripsTaken++,
  combat: new GarboStrategy(() =>
    Macro.abortWithMsg(`Expected The Haggling in ${HAGGLING}`),
  ),
  spendsTurn: true,
  sobriety: "sober",
};

// Meat per point of the zone's resistance in each fight
function resistanceWeight(): number {
  return (garboValue(PEARL) * 0.017) / 3;
}

function pearlTask(target: PearlTarget): GarboTask {
  return {
    name: `${target.location}`,
    ready: () => sober() && canAdventure(target.location) && farming(target),
    completed: () => get(target.completionPref),
    prepare: () => getFreeFishy(),
    effects: resistanceBuffs,
    outfit: () =>
      freeFightOutfit(
        {
          modifier: [
            `${resistanceWeight()} ${target.maximizeElement} Resistance 18 max`,
          ],
        },
        target.location,
      ),
    do: target.location,
    choices: () => wanderer().getChoices(target.location),
    combat: new GarboStrategy(() => Macro.basicCombat()),
    spendsTurn: true,
    sobriety: "sober",
  };
}

/**
 * Farms each day's unblemished pearls where the pearl is worth more than the turns, Lucky! and MP it costs.
 * Runs before meat buffs and potions, so pearl turns don't burn them.
 */
export const PearlsQuest: Quest<GarboTask> = {
  name: "Pearls",
  ready: () => !globalOptions.nobarf && canBreatheUnderwater(),
  tasks: [luckyFishyTask, ...PearlTargets.map(pearlTask)],
};
