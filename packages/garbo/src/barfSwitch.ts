import {
  buy,
  getMonsters,
  itemAmount,
  itemDropsArray,
  Location,
  mallPrice,
  numericModifier,
  print,
  use,
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
import { barfOutfit } from "./outfit/barf";
import { luckyGoldRingDropValues } from "./outfit/dropsgearAccessories";
import { effectValue } from "./potions";
import {
  attemptCompletingBarfQuest,
  checkBarfQuest,
  TICKET_MAX_PRICE,
} from "./resources/realm";
import { EMPTY_CONTEXT } from "./tasks/context";
import { estimatedGarboTurns } from "./turns";

/**
 * Drop bonus at the current location.
 * @param type Which drop bonus to read
 * @returns The bonus in percent, with any remaining underwater penalty applied
 */
function dropBonus(type: "Meat" | "Item"): number {
  return (
    numericModifier(`${type} Drop`) +
    Math.min(numericModifier(`${type} Drop Penalty`), 0)
  );
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
 * Expected value of one turn farming with a method, with the current buffs and outfit.
 * @param method The farming method to value
 * @returns Meat per turn from meat and item drops, facts, red taffy and noncombat turns, less effect upkeep
 */
function valuePerTurn(method: FarmingMethod): number {
  const strategy = farmingStrategyOptions(method);
  const turnsToNC = undelay(strategy.ncTurns ?? Infinity);
  const fightShare = turnsToNC === Infinity ? 1 : turnsToNC / (1 + turnsToNC);
  const meatPerFight = baseMeat(method);
  return withLocation(strategy.location, () => {
    let meatBonus = dropBonus("Meat");
    let upkeep = 0;
    const scamTourists = $effect`How to Scam Tourists`;
    if ((strategy.bonusEffects ?? []).includes(scamTourists)) {
      const scams = $item`How to Avoid Scams`;
      const scamBonus = getModifier("Meat Drop", scamTourists);
      const price = mallPrice(scams);
      const duration = getModifier("Effect Duration", scams);
      if (have(scamTourists)) meatBonus -= scamBonus;
      // Same price cap as the How to Avoid Scams entry in meatMood.
      if (price > 0 && price <= 3 * meatPerFight * duration) {
        meatBonus += scamBonus;
        upkeep = price / duration;
      }
    }

    let drops = dropValuePerFight(strategy.location, dropBonus("Item"));
    if (strategy.location.environment === "underwater" && redTaffyWorth()) {
      drops += redTaffyExpectedValue() - mallPrice($item`pulled red taffy`);
    }
    return fightShare * (meatPerFight * (1 + meatBonus / 100) + drops) - upkeep;
  });
}

/**
 * Cost of getting into Dinseylandfill for the rest of the day.
 * @param turns Turns left to farm
 * @param price What a one-day ticket costs
 * @returns The ticket price less the lucky gold ring's expected FunFunds
 */
function accessCost(turns: number, price: number): number {
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
 * Use a one-day ticket to Dinseylandfill, buying one for at most `maxPrice`.
 * @param maxPrice Most to pay for a ticket
 * @returns Whether Dinseylandfill is open afterwards
 */
function getBarfAccess(maxPrice: number): boolean {
  const ticket = $item`one-day ticket to Dinseylandfill`;
  if (!have(ticket)) buy(1, ticket, maxPrice);
  if (have(ticket)) use(ticket);
  return realmAvailable("stench");
}

/**
 * Right before farming, move a Coral Corral run to Barf Mountain when Barf is worth more for the rest of the day.
 * Values both zones in the Coral Corral farm outfit with the day's buffs. Without Dinseylandfill access, the gain has to cover a one-day ticket.
 */
export function switchToBarf(): void {
  if (
    !globalOptions.prefs.switchToBarf ||
    globalOptions.prefs.farmingMethod !== FarmingMethod.THE_CORAL_CORRAL
  ) {
    return;
  }

  const hasAccess = realmAvailable("stench");
  const ticket = $item`one-day ticket to Dinseylandfill`;
  const price = have(ticket) ? garboValue(ticket) : mallPrice(ticket);
  if (!hasAccess && !have(ticket) && (price <= 0 || price > TICKET_MAX_PRICE)) {
    print(
      "No one-day ticket to Dinseylandfill within the price cap, farming The Coral Corral.",
    );
    return;
  }

  try {
    withLocation(FarmingStrategy.location, () =>
      barfOutfit(FarmingStrategy.outfit(EMPTY_CONTEXT)).dress(),
    );
    const barf = valuePerTurn(FarmingMethod.BARF_MOUNTAIN);
    const corral = valuePerTurn(FarmingMethod.THE_CORAL_CORRAL);
    const turns = estimatedGarboTurns();
    const cost = hasAccess ? 0 : accessCost(turns, price);
    print(
      `Barf Mountain ${barf.toFixed(0)}/turn, The Coral Corral ${corral.toFixed(0)}/turn, ${turns.toFixed(0)} turns, Dinseylandfill access ${cost.toFixed(0)}.`,
    );
    if ((barf - corral) * turns <= cost) return;
    if (!hasAccess && !getBarfAccess(price)) {
      print(
        "Could not get into Dinseylandfill, farming The Coral Corral.",
        HIGHLIGHT,
      );
      return;
    }
  } catch (error) {
    print(
      `Could not compare Barf Mountain to The Coral Corral: ${String(error)}`,
    );
    return;
  }

  print("Farming Barf Mountain instead of The Coral Corral.", HIGHLIGHT);
  globalOptions.prefs.farmingMethod = FarmingMethod.BARF_MOUNTAIN;
  if (!hasAccess && attemptCompletingBarfQuest()) checkBarfQuest();
}
