import {
  Effect,
  effectModifier,
  getMonsters,
  haveEffect,
  Item,
  itemAmount,
  itemDropsArray,
  Location,
  mallPrice,
  myEffects,
  numericModifier,
  print,
  toEffect,
  totalTurnsPlayed,
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
  averageRedTaffyValue,
  FarmingStrategy,
  farmingStrategyOptions,
  redTaffyWorth,
} from "./farmingStrategy";
import { garboValue } from "./garboValue";
import {
  baseMeat,
  HIGHLIGHT,
  marginalFamWeightValue,
  sober,
  withLocation,
} from "./lib";
import { acquire } from "./acquire";
import { meatMood } from "./mood";
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

type DropBonuses = {
  meat: number;
  item: number;
  meatPenalty: number;
  itemPenalty: number;
};

type ZoneProjection = {
  start: DropBonuses;
  expiries: [turn: number, lost: DropBonuses][];
};

type SwitchPlan = {
  best: number;
  first: number;
  last: number;
  barf: number;
  corral: number;
};

let nextCheck = 0;
let plannedSober: boolean | null = null;

function addBonuses(
  a: DropBonuses,
  b: DropBonuses,
  sign: 1 | -1 = 1,
): DropBonuses {
  return {
    meat: a.meat + sign * b.meat,
    item: a.item + sign * b.item,
    meatPenalty: a.meatPenalty + sign * b.meatPenalty,
    itemPenalty: a.itemPenalty + sign * b.itemPenalty,
  };
}

/**
 * Drop bonuses at the current location and outfit.
 * Meat Drop excludes How to Scam Tourists, which is valued separately.
 */
function currentBonuses(): DropBonuses {
  const scamTourists = $effect`How to Scam Tourists`;
  return {
    meat:
      numericModifier("Meat Drop") -
      (have(scamTourists) ? getModifier("Meat Drop", scamTourists) : 0),
    item: numericModifier("Item Drop"),
    meatPenalty: numericModifier("Meat Drop Penalty"),
    itemPenalty: numericModifier("Item Drop Penalty"),
  };
}

/**
 * Drop bonuses an effect provides at the current location.
 * Familiar weight is converted to Meat Drop at garbo's marginal familiar weight value.
 */
function effectBonuses(effect: Effect, underwater: boolean): DropBonuses {
  const weight =
    getModifier("Familiar Weight", effect) +
    (underwater ? getModifier("Hidden Familiar Weight", effect) : 0);
  return {
    meat: getModifier("Meat Drop", effect) + weight * marginalFamWeightValue(),
    item: getModifier("Item Drop", effect),
    meatPenalty: getModifier("Meat Drop Penalty", effect),
    itemPenalty: getModifier("Item Drop Penalty", effect),
  };
}

function withFarmingMethod<T>(method: FarmingMethod, action: () => T): T {
  const current = globalOptions.prefs.farmingMethod;
  globalOptions.prefs.farmingMethod = method;
  try {
    return action();
  } finally {
    globalOptions.prefs.farmingMethod = current;
  }
}

function moodEffects(): Effect[] {
  return meatMood().elements.map((element) => {
    const { effect, potion } = element as { effect?: Effect; potion?: Item };
    return potion ? effectModifier(potion, "Effect") : (effect ?? $effect.none);
  });
}

/**
 * How a zone's drop bonuses fall over the rest of the day as effects run out.
 * @param method The farming method to project
 * @param dress Whether to dress that method's farm outfit first, rather than reading the current outfit
 * @param turns Turns left to farm
 * @returns Current bonuses, and the bonuses lost at each turn an effect the meat mood does not maintain runs out
 */
function projectZone(
  method: FarmingMethod,
  dress: boolean,
  turns: number,
): ZoneProjection {
  const location = farmingStrategyOptions(method).location;
  return withFarmingMethod(method, () =>
    withLocation(location, () => {
      if (dress) barfOutfit(FarmingStrategy.outfit(EMPTY_CONTEXT)).dress();
      const maintained = new Set([
        ...moodEffects(),
        $effect`How to Scam Tourists`,
      ]);
      const underwater = location.environment === "underwater";
      const expiries = Object.entries(myEffects())
        .map(([name, duration]) => [toEffect(name), duration] as const)
        .filter(
          ([effect, duration]) => duration < turns && !maintained.has(effect),
        )
        .map(([effect, duration]): [number, DropBonuses] => [
          duration,
          effectBonuses(effect, underwater),
        ]);
      return { start: currentBonuses(), expiries };
    }),
  );
}

function bonusesAt(projection: ZoneProjection, turn: number): DropBonuses {
  return projection.expiries
    .filter(([expiry]) => expiry <= turn)
    .reduce((bonuses, [, lost]) => addBonuses(bonuses, lost, -1), {
      ...projection.start,
    });
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
 * @param bonuses Drop bonuses in that method's zone and outfit
 * @param turn Turns from now, for upkeep that only starts later in the day
 * @returns Meat per turn from meat and item drops, facts, red taffy and noncombat turns, less effect upkeep
 */
function valuePerTurn(
  method: FarmingMethod,
  bonuses: DropBonuses,
  turn: number,
): number {
  const strategy = farmingStrategyOptions(method);
  const turnsToNC = undelay(strategy.ncTurns ?? Infinity);
  const fightShare = turnsToNC === Infinity ? 1 : turnsToNC / (1 + turnsToNC);
  const meatPerFight = baseMeat(method);
  let meatBonus = bonuses.meat + Math.min(bonuses.meatPenalty, 0);
  const itemBonus = bonuses.item + Math.min(bonuses.itemPenalty, 0);

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

  const underwater = strategy.location.environment === "underwater";
  if (underwater && turn >= donhoTurnsLeft()) {
    upkeep += donhoRecordingUpkeep(meatPerFight);
  }

  let drops = dropValuePerFight(strategy.location, itemBonus);
  if (underwater && redTaffyWorth()) {
    const taffy = $item`pulled red taffy`;
    // Taffy already owned costs its resale value.
    drops +=
      averageRedTaffyValue() -
      (have(taffy) ? garboValue(taffy) : mallPrice(taffy));
  }
  return fightShare * (meatPerFight * (1 + meatBonus / 100) + drops) - upkeep;
}

/**
 * Turns of Donho's Bubbly Ballad left from the current effect and the skill's remaining casts.
 */
function donhoTurnsLeft(): number {
  const ballad = $skill`Donho's Bubbly Ballad`;
  return (
    haveEffect($effect`Donho's Bubbly Ballad`) +
    (have(ballad) ? 10 * Math.max(50 - get("_donhosCasts"), 0) : 0)
  );
}

/**
 * Per-turn cost of keeping Donho's Bubbly Ballad up with recordings, once the skill's casts run out.
 * @param meatPerFight Base meat of the zone
 * @returns The recording's price over its duration, or 0 when meatMood would not buy it
 */
function donhoRecordingUpkeep(meatPerFight: number): number {
  const recording = $item`recording of Donho's Bubbly Ballad`;
  const price = mallPrice(recording);
  const duration = getModifier("Effect Duration", recording);
  if (price <= 0 || duration <= 0) return 0;
  // Same price cap as the recording entry in meatMood.
  return price / duration <= 0.2 * meatPerFight ? price / duration : 0;
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
 * Plan when to move from The Coral Corral to Barf Mountain.
 * The rest of the day is split wherever an unmaintained effect runs out. Within a stretch both zones earn a constant amount, so the best switch is at the start of a stretch.
 * @param accessPrice Ticket price, or 0 with Dinseylandfill access
 * @returns Turns from now to the best switch and to the first and last switch that beats staying, or null if none does
 */
function planSwitch(accessPrice: number): SwitchPlan | null {
  const turns = Math.floor(estimatedGarboTurns());
  if (turns <= 0) return null;
  const corralProjection = projectZone(
    FarmingMethod.THE_CORAL_CORRAL,
    false,
    turns,
  );
  const barfProjection = projectZone(FarmingMethod.BARF_MOUNTAIN, true, turns);

  const starts = [
    ...new Set([
      0,
      ...corralProjection.expiries.map(([turn]) => turn),
      ...barfProjection.expiries.map(([turn]) => turn),
      ...(donhoTurnsLeft() < turns ? [donhoTurnsLeft()] : []),
    ]),
  ].sort((a, b) => a - b);
  const stretches = starts.map((start, index) => {
    const end = starts[index + 1] ?? turns;
    const barf = valuePerTurn(
      FarmingMethod.BARF_MOUNTAIN,
      bonusesAt(barfProjection, start),
      start,
    );
    const corral = valuePerTurn(
      FarmingMethod.THE_CORAL_CORRAL,
      bonusesAt(corralProjection, start),
      start,
    );
    return { start, end, barf, corral };
  });

  let remainingGain = 0;
  const gains = [...stretches]
    .reverse()
    .map(({ start, end, barf, corral }) => {
      remainingGain += (barf - corral) * (end - start);
      const cost = accessPrice && accessCost(turns - start, accessPrice);
      return { start, gain: remainingGain - cost };
    })
    .reverse();

  const worthwhile = gains.filter(({ gain }) => gain > 0);
  if (!worthwhile.length) return null;
  const best = worthwhile.reduce(
    (a, b) => (b.gain > a.gain ? b : a),
    worthwhile[0],
  );
  return {
    best: best.start,
    first: worthwhile[0].start,
    last: worthwhile[worthwhile.length - 1].start,
    barf: stretches[0].barf,
    corral: stretches[0].corral,
  };
}

/**
 * Use a one-day ticket to Dinseylandfill, buying one for at most `maxPrice`.
 * @param maxPrice Most to pay for a ticket
 * @returns Whether Dinseylandfill is open afterwards
 */
function getBarfAccess(maxPrice: number): boolean {
  const ticket = $item`one-day ticket to Dinseylandfill`;
  acquire(1, ticket, maxPrice, false);
  if (have(ticket)) use(ticket);
  return realmAvailable("stench");
}

export function barfSwitchReady(): boolean {
  return (
    globalOptions.prefs.switchToBarf &&
    globalOptions.prefs.farmingMethod === FarmingMethod.THE_CORAL_CORRAL &&
    (totalTurnsPlayed() >= nextCheck ||
      (plannedSober !== null && sober() !== plannedSober))
  );
}

/**
 * Plan the move from The Coral Corral to Barf Mountain, and make it once the planned turn arrives.
 * Runs on the first Coral Corral farm turn, at each planned turn and when sobriety changes, re-planning with the buffs at that point.
 */
export function checkBarfSwitch(): void {
  nextCheck = Infinity;
  plannedSober = sober();

  const hasAccess = realmAvailable("stench");
  const ticket = $item`one-day ticket to Dinseylandfill`;
  const price = have(ticket) ? garboValue(ticket) : mallPrice(ticket);
  if (!hasAccess && !have(ticket) && (price <= 0 || price > TICKET_MAX_PRICE)) {
    print(
      "No one-day ticket to Dinseylandfill within the price cap, farming The Coral Corral all day.",
    );
    return;
  }

  try {
    const plan = planSwitch(hasAccess ? 0 : price);
    if (!plan) {
      print("Barf Mountain does not pay more than The Coral Corral today.");
      return;
    }
    const now = totalTurnsPlayed();
    print(
      `Barf Mountain ${plan.barf.toFixed(0)}/turn, The Coral Corral ${plan.corral.toFixed(0)}/turn now. Switching pays from turn ${now + plan.first} to ${now + plan.last}, best at turn ${now + plan.best}.`,
    );
    if (plan.best > 0) {
      nextCheck = now + plan.best;
      return;
    }
    if (!hasAccess && !getBarfAccess(price)) {
      print(
        "Could not get into Dinseylandfill, staying at The Coral Corral.",
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

  print("Switching to Barf Mountain.", HIGHLIGHT);
  globalOptions.prefs.farmingMethod = FarmingMethod.BARF_MOUNTAIN;
  if (!hasAccess && attemptCompletingBarfQuest()) checkBarfQuest();
}
