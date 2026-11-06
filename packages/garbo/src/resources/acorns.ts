import {
  canEquip,
  equip,
  equippedItem,
  Location,
  Monster,
  myAscensions,
  myClass,
  print,
  Skill,
  toLocation,
  toMonster,
  visitUrl,
} from "kolmafia";
import { $class, $item, $monster, $skill, $slot, get, have, set } from "libram";
import { HIGHLIGHT } from "../lib";

/**
 * Acorns planted by the legendary acorndion's underwater skills: Juvenile Refrain (R) brings sea cows, Chiasso de los Muertos (B) banishes the monster it hits and Line of Zydeco (Z) lowers the zone's pressure.
 * Acorns last past rollover, so planted sites are kept per ascension in `garboAcornSites` as `<ascension>|<location id>:<kinds>[=<banished monster id>],...`.
 */
type AcornKind = "R" | "B" | "Z";
type AcornSite = { kinds: string; banished: Monster | null };

const SITES_PREF = "garboAcornSites";
// Holds the ascension in which a banished native showed up again, which means acorn sea cows ran out
const COWS_GONE_PREF = "_garboAcornCowsGone";

export const acorndion = () => $item`legendary acorndion`;
export const haveAcorndion = () => have(acorndion());

/**
 * @returns The skill that plants the acorn: an Accordion Thief's own song, or the lesser one the acorndion grants other classes
 */
export const acornSkill = (kind: string): Skill =>
  myClass() === $class`Accordion Thief`
    ? {
        R: $skill`Bawdy Refrain`,
        B: $skill`Concerto de los Muertos`,
        Z: $skill`Cone of Zydeco`,
      }[kind as AcornKind]
    : {
        R: $skill`Juvenile Refrain`,
        B: $skill`Chiasso de los Muertos`,
        Z: $skill`Line of Zydeco`,
      }[kind as AcornKind];

/**
 * @returns The acorns' skill names, for printing
 */
export const acornNames = (kinds: string) =>
  [...kinds].map((kind) => acornSkill(kind).name).join(", ") || "none";

/**
 * @returns The acorns the acorndion generated today, read from its description, or null if the page didn't say
 */
export function acornsGeneratedToday(): number | null {
  const page = visitUrl(`desc_item.php?whichitem=${acorndion().descid}`);
  const match = page.match(/(\d+) of \d+ acorns generated today/);
  return match ? Number(match[1]) : null;
}

/**
 * @returns The acorns left today, or 0 when the count can't be read
 */
export function acornsLeftToday(): number {
  if (!haveAcorndion()) return 0;
  const generated = acornsGeneratedToday();
  return generated === null ? 0 : Math.max(0, 12 - generated);
}

function readSites(): Map<Location, AcornSite> {
  const sites = new Map<Location, AcornSite>();
  const [ascension, body] = get(SITES_PREF, "").split("|");
  if (Number(ascension) !== myAscensions() || !body) return sites;
  for (const entry of body.split(",")) {
    const [location, rest = ""] = entry.split(":");
    const [kinds, banished] = rest.split("=");
    sites.set(toLocation(Number(location)), {
      kinds,
      banished: banished ? toMonster(Number(banished)) : null,
    });
  }
  return sites;
}

/**
 * @returns The acorns planted in the location this ascension
 */
export function acornSite(location: Location): AcornSite {
  return readSites().get(location) ?? { kinds: "", banished: null };
}

function recordAcorns(
  location: Location,
  kinds: string,
  banished: Monster | null,
): void {
  const sites = readSites();
  const site = sites.get(location) ?? { kinds: "", banished: null };
  sites.set(location, {
    kinds: [...new Set(site.kinds + kinds)].join(""),
    banished: banished ?? site.banished,
  });
  const body = [...sites.entries()]
    .map(
      ([l, s]) => `${l.id}:${s.kinds}${s.banished ? `=${s.banished.id}` : ""}`,
    )
    .join(",");
  set(SITES_PREF, `${myAscensions()}|${body}`);
}

/**
 * Wield the acorndion, through KoL's equip page when mafia won't equip it for this class.
 * @returns Whether the acorndion is wielded
 */
export function equipAcorndion(): boolean {
  const item = acorndion();
  if (equippedItem($slot`weapon`) === item) return true;
  if (canEquip(item)) equip($slot`weapon`, item);
  else visitUrl(`inv_equip.php?pwd&which=2&action=equip&whichitem=${item.id}`);
  return equippedItem($slot`weapon`) === item;
}

/**
 * Compare the acorn count and the fight's skill list against what the fight was meant to plant, and record each acorn that took.
 * Casts take acorns in order, so a count that moved less than the casts records the earliest ones.
 * @param kinds The acorns the fight was meant to plant, in cast order
 * @param before The acorn count before the fight
 */
export function recordPlanting(
  location: Location,
  kinds: string,
  before: number | null,
): void {
  const after = acornsGeneratedToday();
  const actions = get("_lastCombatActions");
  const monster = toMonster(get("lastEncounter"));
  const cast = [...kinds].filter((kind) =>
    actions.includes(`sk${acornSkill(kind).id};`),
  );
  const planted =
    before === null || after === null
      ? ""
      : cast.slice(0, Math.max(0, after - before)).join("");
  if (planted) {
    recordAcorns(location, planted, planted.includes("B") ? monster : null);
  }
  print(
    `Acorns in ${location}: cast ${acornNames(cast.join(""))}, planted ${acornNames(planted)} (count ${before ?? "unknown"} to ${after ?? "unknown"}) fighting ${monster}.`,
    HIGHLIGHT,
  );
}

/**
 * @returns Whether acorn sea cows have run out for this ascension and day
 */
export const acornCowsGone = () => get(COWS_GONE_PREF, 0) === myAscensions();

/**
 * Note acorn sea cows running out: a native banished by an acorn appears only once the zone's sea cows are gone.
 * The fight that casts Chiasso de los Muertos on its target doesn't count.
 * @returns Whether the fight was an acorn sea cow
 */
export function observeAcornFight(location: Location): boolean {
  const monster = toMonster(get("lastEncounter"));
  const { banished } = acornSite(location);
  const chiassoCast = get("_lastCombatActions").includes(
    `sk${acornSkill("B").id};`,
  );
  if (banished && monster === banished && !chiassoCast && !acornCowsGone()) {
    set(COWS_GONE_PREF, myAscensions());
    print(
      `${monster} came back in ${location}, so acorn sea cows are gone.`,
      HIGHLIGHT,
    );
  }
  return monster === $monster`sea cow`;
}
