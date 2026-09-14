import {
  getMonsters,
  itemAmount,
  itemDropsArray,
  Location,
  mallPrice,
  numericModifier,
  print,
} from "kolmafia";
import {
  $effect,
  $item,
  $location,
  $monster,
  $skill,
  adventureTargetToWeightedMap,
  get,
  getModifier,
  have,
  realmAvailable,
  set,
  sum,
  undelay,
} from "libram";
import { bofaValue } from "garbo-lib";
import { FarmingMethod, globalOptions } from "./config";
import {
  FarmingStrategy,
  farmingStrategyOptions,
  redTaffyExpectedValue,
  redTaffyWorth,
} from "./farmingStrategy";
import { garboValue } from "./garboValue";
import { baseMeat, HIGHLIGHT, withLocation } from "./lib";
import { luckyGoldRingDropValues } from "./outfit/dropsgearAccessories";
import { effectValue } from "./potions";
import { TICKET_MAX_PRICE } from "./resources/realm";
import { estimatedGarboTurns } from "./turns";

type DropBonuses = {
  meat: number;
  item: number;
  meatPenalty: number;
  itemPenalty: number;
};

const MEAT_DROP = "garboFarmMeatDrop";
const ITEM_DROP = "garboFarmItemDrop";
const MEAT_DROP_PENALTY = "garboUnderwaterMeatDropPenalty";
const ITEM_DROP_PENALTY = "garboUnderwaterItemDropPenalty";

const samples = {
  turns: 0,
  underwaterTurns: 0,
  meat: 0,
  item: 0,
  meatPenalty: 0,
  itemPenalty: 0,
};

/**
 * Keep a running average of this run's farming drop bonuses in preferences.
 * Meat Drop excludes How to Scam Tourists, and underwater penalties are kept separately.
 */
export function recordFarmingDropBonuses(): void {
  if (!globalOptions.prefs.switchToBarf) return;
  const scamTourists = $effect`How to Scam Tourists`;
  samples.turns++;
  samples.meat +=
    numericModifier("Meat Drop") -
    (have(scamTourists) ? getModifier("Meat Drop", scamTourists) : 0);
  samples.item += numericModifier("Item Drop");
  set(MEAT_DROP, samples.meat / samples.turns);
  set(ITEM_DROP, samples.item / samples.turns);

  if (!FarmingStrategy.isUnderwater()) return;
  samples.underwaterTurns++;
  samples.meatPenalty += Math.min(numericModifier("Meat Drop Penalty"), 0);
  samples.itemPenalty += Math.min(numericModifier("Item Drop Penalty"), 0);
  set(MEAT_DROP_PENALTY, samples.meatPenalty / samples.underwaterTurns);
  set(ITEM_DROP_PENALTY, samples.itemPenalty / samples.underwaterTurns);
}

function recordedDropBonuses(): DropBonuses | null {
  const values = [MEAT_DROP, ITEM_DROP, MEAT_DROP_PENALTY, ITEM_DROP_PENALTY]
    .map((property) => get(property, ""))
    .map((value) => (value === "" ? NaN : Number(value)));
  if (values.some((value) => !isFinite(value))) return null;
  const [meat, item, meatPenalty, itemPenalty] = values;
  return { meat, item, meatPenalty, itemPenalty };
}

/**
 * Expected drop value of one fight at a location, excluding meat.
 * @param location Where the fight happens
 * @param itemBonus Item drop bonus in percent
 * @returns Meat value of item drops and Book of Facts rewards, weighted by appearance rate
 */
function dropValuePerFight(location: Location, itemBonus: number): number {
  const weights = [...adventureTargetToWeightedMap(location).entries()].filter(
    ([monster]) => monster !== $monster.none,
  );
  const total = sum(weights, ([, weight]) => weight);
  if (total <= 0) return 0;
  const factOptions = {
    plentifulMonsters: [
      globalOptions.target,
      ...getMonsters($location`Barf Mountain`),
      ...getMonsters($location`The Coral Corral`),
    ],
    itemValue: garboValue,
    effectValue,
  };
  const facts = have($skill`Just the Facts`);
  return sum(
    weights,
    ([monster, weight]) =>
      (weight / total) *
      (sum(itemDropsArray(monster), ({ drop, rate, type }) => {
        if (type === "f") return (rate / 100) * garboValue(drop);
        if (!["", "n", "m"].includes(type)) return 0;
        return (
          Math.min(1, (rate / 100) * (1 + itemBonus / 100)) * garboValue(drop)
        );
      }) +
        (facts ? bofaValue(factOptions, monster) : 0)),
  );
}

/**
 * Expected value of one turn farming with a method.
 * @param method The farming method to value
 * @param bonuses Drop bonuses to farm with
 * @returns Meat per turn from meat and item drops, facts, red taffy and noncombat turns, less effect upkeep
 */
function valuePerTurn(method: FarmingMethod, bonuses: DropBonuses): number {
  const strategy = farmingStrategyOptions(method);
  const turnsToNC = undelay(strategy.ncTurns ?? Infinity);
  const fightShare = turnsToNC === Infinity ? 1 : turnsToNC / (1 + turnsToNC);
  const meatPerFight = baseMeat(method);
  const underwater = strategy.location.environment === "underwater";
  let meatBonus = bonuses.meat + (underwater ? bonuses.meatPenalty : 0);
  const itemBonus = bonuses.item + (underwater ? bonuses.itemPenalty : 0);

  let upkeep = 0;
  const scamTourists = $effect`How to Scam Tourists`;
  if ((strategy.bonusEffects ?? []).includes(scamTourists)) {
    const scams = $item`How to Avoid Scams`;
    const price = mallPrice(scams);
    const duration = getModifier("Effect Duration", scams);
    // Same price cap as the How to Avoid Scams entry in meatMood.
    if (price > 0 && price <= 3 * meatPerFight * duration) {
      meatBonus += withLocation(strategy.location, () =>
        getModifier("Meat Drop", scamTourists),
      );
      upkeep = price / duration;
    }
  }

  let drops = dropValuePerFight(strategy.location, itemBonus);
  if (underwater && redTaffyWorth()) {
    drops += redTaffyExpectedValue() - mallPrice($item`pulled red taffy`);
  }
  return fightShare * (meatPerFight * (1 + meatBonus / 100) + drops) - upkeep;
}

/**
 * Cost of getting into Dinseylandfill for the day.
 * @param turns Turns left to farm
 * @returns The ticket price less the lucky gold ring's expected FunFunds, or Infinity with no ticket within the price cap
 */
function ticketCost(turns: number): number {
  if (realmAvailable("stench")) return 0;
  const ticket = $item`one-day ticket to Dinseylandfill`;
  const price = have(ticket) ? garboValue(ticket) : mallPrice(ticket);
  if (!have(ticket) && (price <= 0 || price > TICKET_MAX_PRICE)) {
    return Infinity;
  }
  if (!have($item`lucky gold ring`)) return price;
  // Each lucky gold ring drop picks evenly from its drop list, which gains FunFunds.
  const drops = luckyGoldRingDropValues(
    true,
    itemAmount($item`Freddy Kruegerand`) > 0,
  ).length;
  const funFunds = Math.min(
    15 - get("_luckyGoldRingFunFunds"),
    turns / 10 / (drops + 1),
  );
  return price - Math.max(funFunds, 0) * garboValue($item`FunFunds™`);
}

/**
 * Decide whether a Coral Corral run farms Barf Mountain instead, and switch the farming method if so.
 * @returns Whether the run needs Barf Mountain access
 */
export function switchToBarf(): boolean {
  if (!globalOptions.prefs.switchToBarf) return false;
  const bonuses = recordedDropBonuses();
  if (!bonuses) {
    print(
      "No farming drop bonuses recorded yet, farming The Coral Corral.",
      HIGHLIGHT,
    );
    return false;
  }

  try {
    const barf = valuePerTurn(FarmingMethod.BARF_MOUNTAIN, bonuses);
    const corral = valuePerTurn(FarmingMethod.THE_CORAL_CORRAL, bonuses);
    const turns = estimatedGarboTurns();
    const ticket = ticketCost(turns);
    print(
      `Barf Mountain ${barf.toFixed(0)}/turn, The Coral Corral ${corral.toFixed(0)}/turn, ${turns.toFixed(0)} turns, Dinseylandfill access ${ticket.toFixed(0)}.`,
    );
    if ((barf - corral) * turns <= ticket) return false;
  } catch (error) {
    print(
      `Could not compare Barf Mountain to The Coral Corral: ${String(error)}`,
    );
    return false;
  }

  print("Farming Barf Mountain instead of The Coral Corral.", HIGHLIGHT);
  globalOptions.prefs.farmingMethod = FarmingMethod.BARF_MOUNTAIN;
  return true;
}
