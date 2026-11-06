import { PearlTarget, PearlTargets } from "garbo-lib";
import {
  canAdventure,
  getMonsters,
  Location,
  maximize,
  Monster,
  numericModifier,
  setLocation,
  toMonster,
  toSkill,
} from "kolmafia";
import {
  $effects,
  $item,
  $items,
  $monster,
  clamp,
  get,
  getActiveEffects,
  have,
  sum,
} from "libram";
import { garboValue } from "../garboValue";
import { expectedDropValue } from "../lib";
import { acornCowsGone, acornSite } from "./acorns";

type ZoneInfo = {
  chiasso: string;
  pressure: number;
  luckyHazard?: boolean;
  zydeco?: boolean;
};

// In acorn priority order. Chiasso targets the native whose loss costs least or whose fights hurt most.
const ZONES: Record<string, ZoneInfo> = {
  "Madness Reef": {
    chiasso: "magic dragonfish",
    pressure: -100,
    luckyHazard: true,
  },
  "The Dive Bar": {
    chiasso: "Mer-kin tippler",
    pressure: -200,
    luckyHazard: true,
    zydeco: true,
  },
  "Anemone Mine": {
    chiasso: "Anemone combatant",
    pressure: -200,
    zydeco: true,
  },
  "The Marinara Trench": {
    chiasso: "diving belle",
    pressure: -200,
    zydeco: true,
  },
  "The Briniest Deepests": { chiasso: "acoustic electric eel", pressure: -75 },
};

const info = (location: Location): ZoneInfo => ZONES[location.toString()];
export const chiassoTarget = (location: Location) =>
  toMonster(info(location).chiasso);
export const luckyHazard = (location: Location) =>
  info(location).luckyHazard ?? false;
export const avoidedPearlGear = () =>
  $items`Mer-kin digpick, broken champagne bottle, Peridot of Peril`;

// 1.7% per 3 points of the zone's resistance, from 1.7% up to 10% at 18
export const progressRate = (resistance: number) =>
  clamp(1.7 * Math.floor(resistance / 3), 1.7, 10);
const TIERS = [12, 15, 18];
// A whole pearl at the lowest tier with no Fishy: 15 fights at 2 adventures each
const WORST_ADVENTURES = 30;

export const resistanceBuffs = () =>
  $effects`Elemental Saucesphere, Astral Shell`.filter(
    (effect) => have(effect) || have(toSkill(effect)),
  );

export const pearlFightsLeft = (target: PearlTarget, resistance: number) =>
  Math.ceil((100 - get(target.progressPref, 0)) / progressRate(resistance));

/**
 * @returns The zones whose pearl is still to get this ascension, in acorn priority order
 */
export function openPearlZones(): PearlTarget[] {
  return Object.keys(ZONES)
    .map((name) => PearlTargets.find((t) => t.location.toString() === name))
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
export const worstPearlAdventures = () =>
  sum(openPearlZones(), () => Math.ceil(1.15 * WORST_ADVENTURES) + 1) + 3;

type Tier = { resistance: number; meat: number };
const probes = new Map<Location, Tier[]>();
/**
 * Simulate the maximizer at each resistance tier, counting the free resistance buffs not yet active.
 * @returns The tiers the outfit reaches, each with its Meat Drop
 */
function tierProbe(target: PearlTarget): Tier[] {
  const cached = probes.get(target.location);
  if (cached) return cached;
  setLocation(target.location);
  const modifier = `${target.maximizeElement} Resistance`;
  const pending = sum(
    resistanceBuffs().filter((effect) => !have(effect)),
    (effect) => numericModifier(effect, modifier),
  );
  const tiers = TIERS.flatMap((resistance) => {
    const spec = [
      "Meat Drop",
      `1000 ${modifier} ${resistance - pending} max`,
      "+sea",
      "-tie",
      ...avoidedPearlGear().map((item) => `-equip ${item}`),
    ];
    const reached =
      maximize(spec.join(", "), 0, 0, true, false) &&
      numericModifier("Generated:_spec", modifier) + pending >= resistance;
    const meat = numericModifier("Generated:_spec", "Meat Drop");
    return reached ? [{ resistance, meat }] : [];
  });
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

export type ZonePlan = {
  target: PearlTarget;
  resistance: number;
  fights: number;
  adventures: number;
  net: number;
  plant: string;
  farm: boolean;
  summary: string;
};

const mean = (monsters: Monster[], f: (m: Monster) => number) =>
  monsters.length ? sum(monsters, f) / monsters.length : 0;

/**
 * Price each open zone's pearl: P - adventures * VOA + fights * E(t) - plant risk, where E(t) is the meat and drops of an average fight in the tier's outfit, with acorn sea cows mixed in.
 * Zones go fewest fights first, sharing the free Fishy; a fight without Fishy costs two adventures.
 * @param acorns The acorns left to plant today
 * @param fishy The Fishy turns available
 */
export function planPearls(acorns: number, fishy: number): ZonePlan[] {
  const voa = get("valueOfAdventure");
  const pearl = garboValue($item`unblemished pearl`);
  const cow = $monster`sea cow`;
  const reduction = sum(getActiveEffects(), (effect) =>
    Math.max(0, numericModifier(effect, "Meat Drop Penalty")),
  );

  const zones = openPearlZones().map((target) => {
    const tiers = tierProbe(target);
    const site = acornSite(target.location);
    let plant = site.kinds ? "" : acorns >= 2 ? "BR" : acorns === 1 ? "R" : "";
    const fightValue = (t: Tier, kinds: string) => {
      const zydeco = kinds.includes("Z") ? 30 : 0;
      const penalty = Math.min(
        0,
        info(target.location).pressure + reduction + zydeco,
      );
      const multiplier = Math.max(0, 100 + t.meat + penalty) / 100;
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
          ((m.minMeat + m.maxMeat) / 2) * multiplier + expectedDropValue(m),
      );
      return (
        share * (300 * multiplier + expectedDropValue(cow)) +
        (1 - share) * nativeValue
      );
    };
    const top = tiers[tiers.length - 1];
    if (plant && top && fightValue(top, plant) <= fightValue(top, site.kinds)) {
      plant = "";
    }
    acorns -= plant.length;
    return { target, tiers, site, plant, fightValue };
  });

  for (const zone of zones) {
    if (zone.plant && info(zone.target.location).zydeco && acorns > 0) {
      zone.plant += "Z";
      acorns--;
    }
  }

  const fightsAtTop = (z: (typeof zones)[number]) =>
    z.tiers.length
      ? pearlFightsLeft(z.target, z.tiers[z.tiers.length - 1].resistance)
      : Infinity;
  return zones
    .sort((a, b) => fightsAtTop(a) - fightsAtTop(b))
    .map(({ target, tiers, site, plant, fightValue }) => {
      const kinds = site.kinds + plant;
      const options = tiers.map((t) => {
        const fights = pearlFightsLeft(target, t.resistance);
        const adventures = fights + Math.max(0, fights - fishy);
        const net =
          pearl -
          adventures * voa +
          fights * fightValue(t, kinds) -
          (plant ? 0.1 * voa : 0);
        return { resistance: t.resistance, fights, adventures, net };
      });
      const best = options.reduce((a, b) => (b.net > a.net ? b : a), {
        resistance: 0,
        fights: 0,
        adventures: 0,
        net: -Infinity,
      });
      const farm = best.net > 0;
      if (farm) fishy = Math.max(0, fishy - best.fights);
      const summary = `Pearl plan for ${target.location}: ${options.map((o) => `${o.resistance} res, ${o.fights} fights, net ${Math.round(o.net)}`).join("; ") || "no tier reaches 12 resistance"}. ${farm ? `Farming at ${best.resistance} res over ${best.adventures} adventures` : "Skipping"}; acorns ${site.kinds || "none"}${farm && plant ? `, planting ${plant}` : ""}.`;
      return { target, ...best, plant: farm ? plant : "", farm, summary };
    });
}
