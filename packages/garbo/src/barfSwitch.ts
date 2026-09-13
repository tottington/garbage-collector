import {
  itemDropsArray,
  Location,
  mallPrice,
  numericModifier,
  print,
  totalTurnsPlayed,
} from "kolmafia";
import {
  $effect,
  $item,
  $monster,
  adventureTargetToWeightedMap,
  getModifier,
  have,
  sum,
  undelay,
} from "libram";
import { FarmingMethod, globalOptions } from "./config";
import {
  farmingStrategyOptions,
  redTaffyExpectedValue,
  redTaffyWorth,
} from "./farmingStrategy";
import { garboValue } from "./garboValue";
import { HIGHLIGHT, songboomMeat, withLocation } from "./lib";
import {
  ensureBarfAccess,
  hasBarfAccess,
  TICKET_MAX_PRICE,
} from "./resources/realm";
import { estimatedGarboTurns } from "./turns";

const CHECK_INTERVAL = 25;
let nextCheck = 0;

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
 * Expected item value of one fight at a location.
 * @param location Where the fight happens
 * @param itemBonus Item drop bonus in percent
 * @returns Meat value of the monster's drops, weighted by appearance rate
 */
function itemValuePerFight(location: Location, itemBonus: number): number {
  const weights = [...adventureTargetToWeightedMap(location).entries()].filter(
    ([monster]) => monster !== $monster.none,
  );
  const total = sum(weights, ([, weight]) => weight);
  if (total <= 0) return 0;
  return sum(
    weights,
    ([monster, weight]) =>
      (weight / total) *
      sum(itemDropsArray(monster), ({ drop, rate, type }) => {
        if (type === "f") return (rate / 100) * garboValue(drop);
        if (!["", "n", "m"].includes(type)) return 0;
        return (
          Math.min(1, (rate / 100) * (1 + itemBonus / 100)) * garboValue(drop)
        );
      }),
  );
}

/**
 * Expected value of one turn farming with a method, in the current outfit.
 * @param method The farming method to value
 * @returns Meat per turn from meat and item drops, red taffy and noncombat turns, less effect upkeep
 */
function valuePerTurn(method: FarmingMethod): number {
  const strategy = farmingStrategyOptions(method);
  const turnsToNC = undelay(strategy.ncTurns ?? Infinity);
  const fightShare = turnsToNC === Infinity ? 1 : turnsToNC / (1 + turnsToNC);
  const baseMeat = strategy.baseMeat + songboomMeat();
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
      if (price > 0 && price <= 3 * baseMeat * duration) {
        meatBonus += scamBonus;
        upkeep = price / duration;
      }
    }
    const meat = baseMeat * (1 + meatBonus / 100);
    let items = itemValuePerFight(strategy.location, dropBonus("Item"));
    if (strategy.location.environment === "underwater" && redTaffyWorth()) {
      items += redTaffyExpectedValue() - mallPrice($item`pulled red taffy`);
    }
    return fightShare * (meat + items) - upkeep;
  });
}

export function barfSwitchReady(): boolean {
  return (
    globalOptions.prefs.switchToBarf &&
    globalOptions.prefs.farmingMethod === FarmingMethod.THE_CORAL_CORRAL &&
    totalTurnsPlayed() >= nextCheck
  );
}

/**
 * Move a Coral Corral run to Barf Mountain when Barf pays more for the turns left.
 * Without Barf access, the gain has to cover a one-day ticket.
 */
export function checkBarfSwitch(): void {
  nextCheck = totalTurnsPlayed() + CHECK_INTERVAL;

  try {
    const barf = valuePerTurn(FarmingMethod.BARF_MOUNTAIN);
    const cowo = valuePerTurn(FarmingMethod.THE_CORAL_CORRAL);
    const turns = estimatedGarboTurns();
    const listed = mallPrice($item`one-day ticket to Dinseylandfill`);
    const ticket = hasBarfAccess()
      ? 0
      : listed > 0 && listed <= TICKET_MAX_PRICE
        ? listed
        : Infinity;
    const ticketNote =
      ticket === 0
        ? ""
        : ticket === Infinity
          ? ", no one-day ticket within the price cap"
          : `, one-day ticket ${ticket}`;
    print(
      `Barf Mountain ${barf.toFixed(0)}/turn, The Coral Corral ${cowo.toFixed(0)}/turn, ${turns.toFixed(0)} turns left${ticketNote}.`,
    );
    if ((barf - cowo) * turns <= ticket) return;
  } catch (error) {
    print(
      `Could not compare Barf Mountain to The Coral Corral: ${String(error)}`,
    );
    return;
  }

  try {
    if (!ensureBarfAccess()) {
      print(
        "Could not get into Dinseylandfill, staying at The Coral Corral.",
        HIGHLIGHT,
      );
      return;
    }
  } catch (error) {
    print(`Could not get into Dinseylandfill: ${String(error)}`, HIGHLIGHT);
    return;
  }

  print("Switching to Barf Mountain.", HIGHLIGHT);
  globalOptions.prefs.farmingMethod = FarmingMethod.BARF_MOUNTAIN;
}
