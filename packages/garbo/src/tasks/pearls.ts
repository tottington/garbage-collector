import { Quest } from "grimoire-kolmafia";
import {
  canAdventure,
  Effect,
  Element,
  haveEffect,
  maximize,
  mpCost,
  myAdventures,
  numericModifier,
  print,
  Skill,
  toSkill,
  turnsPerCast,
} from "kolmafia";
import {
  $effect,
  $effects,
  $item,
  $skill,
  clamp,
  get,
  have,
  sum,
} from "libram";
import { PearlTarget, PearlTargets } from "garbo-lib";
import { Macro } from "../combat";
import { GarboStrategy } from "../combatStrategy";
import { globalOptions } from "../config";
import { garboValue } from "../garboValue";
import { wanderer } from "../garboWanderer";
import { getFreeFishy, HIGHLIGHT, meatPerMp, sober } from "../lib";
import { freeFightOutfit } from "../outfit/free";
import { GarboTask } from "./engine";

const PEARL = $item`unblemished pearl`;
const RESISTANCE_BUFFS = $effects`Elemental Saucesphere, Astral Shell`;
const FISHY_PIPE_TURNS = 10;
const SKATE_LUTZ_TURNS = 30;
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

function fishyTurnsAvailable(): number {
  return (
    haveEffect($effect`Fishy`) +
    (have($item`fishy pipe`) && !get("_fishyPipeUsed") ? FISHY_PIPE_TURNS : 0) +
    (get("skateParkStatus") === "ice" && !get("_skateBuff1")
      ? SKATE_LUTZ_TURNS
      : 0)
  );
}

function castsNeeded(skill: Skill, turns: number): number {
  return Math.ceil(turns / Math.max(turnsPerCast(skill), 1));
}

type PearlPlan = {
  resistance: number;
  fights: number;
  turns: number;
  cost: number;
  value: number;
};

/**
 * Prices finishing a zone's pearl: each fight costs a turn at the user's value of adventure, or two without Fishy, plus the MP for kill spells and resistance buffs.
 */
function pearlPlan(target: PearlTarget): PearlPlan {
  const resistance = expectedResistance(target.maximizeElement);
  const fights = Math.ceil(
    (100 - get(target.progressPref, 0)) / progressPerFight(resistance),
  );
  const turns = fights + Math.max(0, fights - fishyTurnsAvailable());
  const killMp = have($skill`Saucegeyser`)
    ? fights * KILL_CASTS_PER_FIGHT * mpCost($skill`Saucegeyser`)
    : 0;
  const buffMp = sum(resistanceBuffs(), (effect) => {
    const skill = toSkill(effect);
    return castsNeeded(skill, turns) * mpCost(skill);
  });
  return {
    resistance,
    fights,
    turns,
    cost: turns * get("valueOfAdventure") + (killMp + buffMp) * meatPerMp(),
    value: garboValue(PEARL),
  };
}

const reported = new Set<PearlTarget>();
function worthFarming(target: PearlTarget): boolean {
  const plan = pearlPlan(target);
  const worth =
    plan.value > plan.cost &&
    myAdventures() - globalOptions.saveTurns >= plan.turns;
  if (!reported.has(target)) {
    reported.add(target);
    print(
      `Pearl in ${target.location}: ${plan.resistance} ${target.maximizeElement} resistance, ${plan.fights} fights over ${plan.turns} turns costing ${Math.round(plan.cost)} against a ${Math.round(plan.value)} pearl. ${worth ? "Farming it." : "Skipping it."}`,
      HIGHLIGHT,
    );
  }
  return worth;
}

// Meat per point of the zone's resistance in each fight
function resistanceWeight(): number {
  return (garboValue(PEARL) * 0.017) / 3;
}

function pearlTask(target: PearlTarget): GarboTask {
  return {
    name: `${target.location}`,
    ready: () =>
      sober() && canAdventure(target.location) && worthFarming(target),
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
 * Farms each day's unblemished pearls where the pearl is worth more than the turns and MP it costs.
 * Runs before meat buffs and potions, so pearl turns don't burn them.
 */
export const PearlsQuest: Quest<GarboTask> = {
  name: "Pearls",
  ready: () => !globalOptions.nobarf,
  tasks: PearlTargets.map(pearlTask),
};
