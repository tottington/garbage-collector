import {
  pearlFightsLeft,
  pearlProgress,
  PearlTarget,
  PearlTargets,
} from "garbo-lib";
import { Modes } from "grimoire-kolmafia";
import {
  canAdventure,
  Element,
  getMonsters,
  itemDropsArray,
  Location,
  maximize,
  Monster,
  myBuffedstat,
  numericModifier,
  toSkill,
} from "kolmafia";
import {
  $effects,
  $item,
  $items,
  $location,
  $monster,
  $stat,
  clamp,
  get,
  getActiveEffects,
  have,
  sum,
} from "libram";
import { globalOptions } from "../config";
import { garboValue } from "../garboValue";
import { sober, withLocation } from "../lib";
import { canBreatheUnderwater } from "../outfit/lib";
import { acornCowsGone, AcornKind, acornNames, acornSite } from "./acorns";

type ZoneInfo = {
  chiasso: Monster;
  pressure: number;
  luckyHazard?: boolean;
  zydeco?: boolean;
};

// In acorn priority order. Chiasso targets the native whose loss costs least or whose fights hurt most.
const ZONES = new Map<Location, ZoneInfo>([
  [
    $location`Madness Reef`,
    {
      chiasso: $monster`magic dragonfish`,
      pressure: -100,
      luckyHazard: true,
    },
  ],
  [
    $location`The Dive Bar`,
    {
      chiasso: $monster`Mer-kin tippler`,
      pressure: -200,
      luckyHazard: true,
      zydeco: true,
    },
  ],
  [
    $location`Anemone Mine`,
    { chiasso: $monster`Anemone combatant`, pressure: -200, zydeco: true },
  ],
  [
    $location`The Marinara Trench`,
    { chiasso: $monster`diving belle`, pressure: -200, zydeco: true },
  ],
  [
    $location`The Briniest Deepests`,
    { chiasso: $monster`acoustic electric eel`, pressure: -75 },
  ],
]);

const info = (location: Location) => ZONES.get(location) as ZoneInfo;
export const chiassoTarget = (location: Location) => info(location).chiasso;
export const luckyHazard = (location: Location) =>
  info(location).luckyHazard ?? false;
export const avoidedPearlGear = () =>
  $items`Mer-kin digpick, broken champagne bottle, Peridot of Peril`;

/**
 * @returns The maximizer term that holds the zone's resistance at the tier
 */
export const resistanceModifier = (target: PearlTarget, resistance: number) =>
  `1000 ${target.maximizeElement} Resistance ${resistance} max`;

const PARKA_MODES: Record<string, Modes["parka"]> = {
  cold: "kachungasaur",
  hot: "pterodactyl",
  sleaze: "spikolodon",
  spooky: "ghostasaurus",
  stench: "dilophosaur",
};
/**
 * @returns The Jurassic Parka mode that resists the element
 */
export const parkaMode = (element: Element) =>
  PARKA_MODES[element.toString().toLowerCase()];

/**
 * @returns The monsters a fight in the zone can meet, with sea cows when Juvenile Refrain is planted
 */
export const pearlMonsters = (
  location: Location,
  kinds = acornSite(location).kinds,
) => [
  ...getMonsters(location),
  ...(kinds.includes("R") ? [$monster`sea cow`] : []),
];

/**
 * @returns Moxie above the attack of the zone's toughest monster, counting Monster Level
 */
export const moxieMargin = (
  location: Location,
  kinds = acornSite(location).kinds,
) =>
  myBuffedstat($stat`Moxie`) -
  Math.max(...pearlMonsters(location, kinds).map((m) => m.baseAttack)) -
  numericModifier("Monster Level");

const TIERS = [12, 15, 18];
// A whole pearl at the lowest tier with no Fishy: 15 fights at 2 adventures each
const WORST_ADVENTURES = 30;

export const resistanceBuffs = () =>
  $effects`Elemental Saucesphere, Astral Shell`.filter(
    (effect) => have(effect) || have(toSkill(effect)),
  );

/**
 * @returns The fights left for the zone's pearl at the resistance
 */
export const fightsLeftAt = (target: PearlTarget, resistance: number) =>
  pearlFightsLeft(target, pearlProgress(resistance));

/**
 * @returns The zones whose pearl is still to get this ascension, in acorn priority order
 */
export function openPearlZones(): PearlTarget[] {
  return [...ZONES.keys()]
    .map((location) => PearlTargets.find((t) => t.location === location))
    .filter(
      (target): target is PearlTarget =>
        !!target &&
        !get(target.completionPref) &&
        canAdventure(target.location),
    );
}

/**
 * @returns The most adventures the open zones' pearls can cost, before probing any outfit
 */
export function worstPearlAdventures(): number {
  const zones = openPearlZones();
  return zones.length
    ? sum(zones, () => Math.ceil(1.15 * WORST_ADVENTURES) + 1) + 3
    : 0;
}

export type ZonePlan = {
  target: PearlTarget;
  resistance: number;
  fights: number;
  adventures: number;
  net: number;
  plant: AcornKind[];
  farm: boolean;
  summary: string;
};

/**
 * @returns The adventures the farmed zones need, with room for adventures lost to noncombats and wanderers
 */
export function pearlReserve(zones: ZonePlan[]): number {
  const farmed = zones.filter((zone) => zone.farm);
  return farmed.length
    ? sum(
        farmed,
        (zone) =>
          Math.ceil(1.15 * zone.adventures) + (zone.plant.length ? 1 : 0),
      ) + 3
    : 0;
}

let block: ZonePlan[] | null = null;
/**
 * @returns The pearl block's plan once garbo has decided it, empty when there was nothing to plan
 */
export const pearlBlock = () => block;
export function setPearlBlock(zones: ZonePlan[]): void {
  block = zones;
}

/**
 * @returns The adventures held back at the end of garbo's farming for the pearl block
 */
export const pearlTurnsReserved = () =>
  block
    ? pearlReserve(block)
    : !globalOptions.pearlo || !sober() || !canBreatheUnderwater()
      ? 0
      : worstPearlAdventures();

type Tier = { resistance: number; meat: number; item: number };
const probes = new Map<Location, Tier[]>();
/**
 * Simulate the maximizer at each resistance tier, counting the free resistance buffs not yet active.
 * @returns The tiers the outfit reaches, each with its Meat Drop
 */
function tierProbe(target: PearlTarget): Tier[] {
  const cached = probes.get(target.location);
  if (cached) return cached;
  const modifier = `${target.maximizeElement} Resistance`;
  const pending = sum(
    resistanceBuffs().filter((effect) => !have(effect)),
    (effect) => numericModifier(effect, modifier),
  );
  const tiers = withLocation(target.location, () =>
    TIERS.flatMap((resistance) => {
      const spec = [
        "Meat Drop",
        resistanceModifier(target, resistance - pending),
        "+sea",
        "-tie",
        ...avoidedPearlGear().map((item) => `-equip ${item}`),
      ];
      const reached =
        maximize(spec.join(", "), 0, 0, true, false) &&
        numericModifier("Generated:_spec", modifier) + pending >= resistance;
      const meat = numericModifier("Generated:_spec", "Meat Drop");
      const item = numericModifier("Generated:_spec", "Item Drop");
      return reached ? [{ resistance, meat, item }] : [];
    }),
  );
  probes.set(target.location, tiers);
  return tiers;
}

const cowlessFights = new Map<Location, number>();
/**
 * Count fights in a zone with Juvenile Refrain planted. Eight in a row without a sea cow mean the acorn isn't bringing any.
 */
export function noteCow(location: Location, cow: boolean): void {
  if (!acornSite(location).kinds.includes("R")) return;
  cowlessFights.set(location, cow ? 0 : (cowlessFights.get(location) ?? 0) + 1);
}

const mean = (monsters: Monster[], f: (m: Monster) => number) =>
  monsters.length ? sum(monsters, f) / monsters.length : 0;

const pearlDropValue = (monster: Monster, multiplier: number) =>
  sum(
    itemDropsArray(monster),
    ({ drop, rate, type }) =>
      clamp((rate / 100) * (type === "0" ? 1 : multiplier), 0, 1) *
      garboValue(drop),
  );

/**
 * Price each open zone's pearl: P - adventures * VOA + fights * E(t) - plant risk, where E(t) is the meat and drops of an average fight in the tier's outfit, with acorn sea cows mixed in.
 * Zones go fewest fights first, sharing the free Fishy; a fight without Fishy costs two adventures.
 * A zone is farmed only when Moxie matches its toughest monster, and acorns go only to zones that end up farmed.
 * @param acorns The acorns left to plant today
 * @param fishy The Fishy turns available
 * @param noPlant Zones that get no acorns
 */
export function planPearls(
  acorns: number,
  fishy: number,
  noPlant = new Set<Location>(),
): ZonePlan[] {
  const startAcorns = acorns;
  const startFishy = fishy;
  const voa = get("valueOfAdventure");
  const pearl = garboValue($item`unblemished pearl`);
  const cow = $monster`sea cow`;
  const reduction = (penalty: string) =>
    sum(getActiveEffects(), (effect) =>
      Math.max(0, numericModifier(effect, penalty)),
    );
  const meatReduction = reduction("Meat Drop Penalty");
  const itemReduction = reduction("Item Drop Penalty");

  const zones = openPearlZones().map((target) => {
    const tiers = tierProbe(target);
    const site = acornSite(target.location);
    let plant: AcornKind[] =
      site.kinds.length || noPlant.has(target.location)
        ? []
        : acorns >= 2
          ? ["B", "R"]
          : acorns === 1
            ? ["R"]
            : [];
    if (moxieMargin(target.location, [...site.kinds, ...plant]) < 10) {
      plant = plant.filter((kind) => kind !== "R");
    }
    const fightValue = (t: Tier, kinds: AcornKind[]) => {
      const zydeco = kinds.includes("Z") ? 30 : 0;
      const pressure = info(target.location).pressure + zydeco;
      const multiplier =
        Math.max(0, 100 + t.meat + Math.min(0, pressure + meatReduction)) / 100;
      const itemMultiplier =
        Math.max(0, 100 + t.item + Math.min(0, pressure + itemReduction)) / 100;
      const banished = kinds.includes("B")
        ? chiassoTarget(target.location)
        : site.banished;
      const natives = getMonsters(target.location).filter(
        (monster) => monster !== cow && monster !== banished,
      );
      const share =
        kinds.includes("R") &&
        !acornCowsGone() &&
        (cowlessFights.get(target.location) ?? 0) < 8
          ? 2 / (2 + natives.length)
          : 0;
      const nativeValue = mean(
        natives,
        (m) =>
          ((m.minMeat + m.maxMeat) / 2) * multiplier +
          pearlDropValue(m, itemMultiplier),
      );
      return (
        share * (300 * multiplier + pearlDropValue(cow, itemMultiplier)) +
        (1 - share) * nativeValue
      );
    };
    const top = tiers[tiers.length - 1];
    if (
      plant.length &&
      (!top || fightValue(top, plant) <= fightValue(top, site.kinds))
    ) {
      plant = [];
    }
    acorns -= plant.length;
    return { target, tiers, site, plant, fightValue };
  });

  for (const zone of zones) {
    if (zone.plant.length && info(zone.target.location).zydeco && acorns > 0) {
      zone.plant.push("Z");
      acorns--;
    }
  }

  const fightsAtTop = (z: (typeof zones)[number]) =>
    z.tiers.length
      ? fightsLeftAt(z.target, z.tiers[z.tiers.length - 1].resistance)
      : Infinity;
  const unused: Location[] = [];
  const plans = zones
    .sort((a, b) => fightsAtTop(a) - fightsAtTop(b))
    .map(({ target, tiers, site, plant, fightValue }) => {
      const kinds = [...site.kinds, ...plant];
      const options = tiers.map((t) => {
        const fights = fightsLeftAt(target, t.resistance);
        const adventures = fights + Math.max(0, fights - fishy);
        const net =
          pearl -
          adventures * voa +
          fights * fightValue(t, kinds) -
          (plant.length ? 0.1 * voa : 0);
        return { resistance: t.resistance, fights, adventures, net };
      });
      const best = options.reduce((a, b) => (b.net > a.net ? b : a), {
        resistance: 0,
        fights: 0,
        adventures: 0,
        net: -Infinity,
      });
      const farm = best.net > 0 && moxieMargin(target.location, kinds) >= 0;
      if (farm) fishy = Math.max(0, fishy - best.fights);
      else if (plant.length) unused.push(target.location);
      const summary = `Pearl plan for ${target.location}: ${options.map((o) => `${o.resistance} res, ${o.fights} fights, net ${Math.round(o.net)}`).join("; ") || "no tier reaches 12 resistance"}. ${farm ? `Farming at ${best.resistance} res over ${best.adventures} adventures` : "Skipping"}; acorns ${acornNames(site.kinds)}${farm && plant.length ? `, planting ${acornNames(plant)}` : ""}.`;
      return { target, ...best, plant: farm ? plant : [], farm, summary };
    });

  return unused.length
    ? planPearls(startAcorns, startFishy, new Set([...noPlant, ...unused]))
    : plans;
}
