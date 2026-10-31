import { Familiar, Item, myAdventures } from "kolmafia";
import { $familiar, $item, get, getSaleValue } from "libram";

import { PearlKey, PEARLS, PearlSpec } from "./zones";

/** mombuff option: "auto" assigns it to the first under-capped zone, an element reserves it. */
export type MomBuffMode = PearlKey | "auto";

/** How the player gets underwater breathing when no air effect is active. */
export type AirMode = "effects" | "gear" | "auto";

/**
 * The farming options, grouped the way the models read them. The host fills these in
 * through configurePearls; the defaults are pearlo's own.
 */
const pearlOptions = {
  major: {
    /** Halt instead of adventuring when the zone's resistance is below the 18 cap. */
    requirecap: false,
    /** Weapon to wield while farming overdrunk (wineglass attack-only mode). */
    drunkweapon: $item`June cleaver`,
    /** Force every owned organ extender on while running turns. */
    overcapped: false,
    /** Farm zones even when the profit model expects them to lose meat. */
    force: false,
    /** Overdrunk only: fight on when the weapon cannot guarantee a one-shot. */
    leeroyjenkins: false,
    /** Farm selected zones down to the turn floor even mid-pearl. */
    strand: false,
  },
  overrides: {
    spookyfamiliar: undefined as Familiar | undefined,
    sleazefamiliar: undefined as Familiar | undefined,
    hotfamiliar: undefined as Familiar | undefined,
    stenchfamiliar: undefined as Familiar | undefined,
    coldfamiliar: undefined as Familiar | undefined,
    spookyoutfit: undefined as string | undefined,
    sleazeoutfit: undefined as string | undefined,
    hotoutfit: undefined as string | undefined,
    stenchoutfit: undefined as string | undefined,
    coldoutfit: undefined as string | undefined,
    // Candidate res potions per zone. Which of them are actually used or bought is
    // decided against the turns they save, not by list order.
    spookyresitems:
      "scroll of minor invulnerability, pec oil, gray seashell, marzipan skull, spooky powder",
    sleazeresitems:
      "scroll of minor invulnerability, pec oil, yellow seashell, sleaze powder",
    hotresitems:
      "scroll of minor invulnerability, pec oil, magenta seashell, hot powder",
    stenchresitems:
      "scroll of minor invulnerability, pec oil, green seashell, stench powder, Polysniff Perfume",
    // Cold dresses worst (res 10), needing +8, so its list is the longest. Sticky lava
    // globs are left out because their mall stock is too thin.
    coldresitems:
      "scroll of minor invulnerability, pec oil, programmable turtle, cyan seashell, Ancient Protector Soda, cold powder",
  },
  resources: {
    /** Refresh Fishy via Lucky! and The Haggling when it runs out. */
    luckyfishy: false,
    /** Max meat per mall 11-leaf clover for the Fishy refresh. 0 never buys. */
    cloverprice: 0,
    /** Turn every pearl-zone monster into some fish with the Monodent of the Sea. */
    fishMaxxing: false,
    /** Max meat per resistance potion. 0 never buys. */
    potionprice: 0,
    airmode: "effects" as AirMode,
    /** Socket unblemished pearls into The Eternity Codpiece at the end of the run. */
    codpiece: false,
    /** Spend Mom Sea Monkee's free daily food on an under-capped zone. */
    mombuff: undefined as MomBuffMode | undefined,
  },
};

/**
 * The economy the models price against. The host injects its own; the defaults let the
 * package run on mafia's preferences and libram's sale values alone.
 */
export type PearlHooks = {
  /** Meat value of one adventure, used for every profit decision. */
  valueOfAdventure: () => number;
  /** What an item is worth when sold, or forgone when spent. */
  itemValue: (item: Item) => number;
  /** Adventures the host lets pearl farming spend, after its own reserve. */
  adventuresAvailable: () => number;
};

const pearlHooks: PearlHooks = {
  valueOfAdventure: () => get("valueOfAdventure"),
  itemValue: (item) => getSaleValue(item),
  adventuresAvailable: () => myAdventures(),
};

export { pearlOptions as args, pearlHooks as hooks };

/** Adventures pearl farming may spend right now. */
export function turnsAvailable(): number {
  return pearlHooks.adventuresAvailable();
}

export type PearlOptions = Partial<PearlHooks> & {
  requireCap?: boolean;
  force?: boolean;
  airMode?: AirMode;
  potionPrice?: number;
  luckyFishy?: boolean;
  cloverPrice?: number;
  /** "", "true", "auto" or a pearl element. Empty never visits Mom. */
  momBuff?: string;
  codpiece?: boolean;
  drunkWeapon?: Item;
  leeroyJenkins?: boolean;
  overcapped?: boolean;
  fishMaxxing?: boolean;
};

const PEARL_KEYS: PearlKey[] = ["spooky", "sleaze", "hot", "stench", "cold"];
const AIR_MODES: AirMode[] = ["effects", "gear", "auto"];

/** Parses the mombuff option: empty is off, "true"/"auto" auto-assigns, else an element. */
export function parseMomBuff(value: string): MomBuffMode | undefined {
  const v = value.trim().toLowerCase();
  if (v === "" || v === "false") return undefined;
  if (v === "true" || v === "auto") return "auto";
  if ((PEARL_KEYS as string[]).includes(v)) return v as PearlKey;
  throw new Error(
    `pearls: mombuff "${value}" is not true, auto or one of ${PEARL_KEYS.join(",")}`,
  );
}

/** Applies host options on top of the current configuration. */
export function configurePearls(options: PearlOptions): void {
  if (options.valueOfAdventure) {
    pearlHooks.valueOfAdventure = options.valueOfAdventure;
  }
  if (options.itemValue) pearlHooks.itemValue = options.itemValue;
  if (options.adventuresAvailable) {
    pearlHooks.adventuresAvailable = options.adventuresAvailable;
  }
  if (options.requireCap !== undefined) {
    pearlOptions.major.requirecap = options.requireCap;
  }
  if (options.force !== undefined) pearlOptions.major.force = options.force;
  if (options.drunkWeapon !== undefined && options.drunkWeapon !== $item.none) {
    pearlOptions.major.drunkweapon = options.drunkWeapon;
  }
  if (options.overcapped !== undefined) {
    pearlOptions.major.overcapped = options.overcapped;
  }
  if (options.leeroyJenkins !== undefined) {
    pearlOptions.major.leeroyjenkins = options.leeroyJenkins;
  }
  if (options.airMode !== undefined) {
    if (!AIR_MODES.includes(options.airMode)) {
      throw new Error(
        `pearls: airmode "${options.airMode}" is not one of ${AIR_MODES.join(",")}`,
      );
    }
    pearlOptions.resources.airmode = options.airMode;
  }
  if (options.potionPrice !== undefined) {
    pearlOptions.resources.potionprice = options.potionPrice;
  }
  if (options.luckyFishy !== undefined) {
    pearlOptions.resources.luckyfishy = options.luckyFishy;
  }
  if (options.cloverPrice !== undefined) {
    pearlOptions.resources.cloverprice = options.cloverPrice;
  }
  if (options.momBuff !== undefined) {
    pearlOptions.resources.mombuff = parseMomBuff(options.momBuff);
  }
  if (options.codpiece !== undefined) {
    pearlOptions.resources.codpiece = options.codpiece;
  }
  if (options.fishMaxxing !== undefined) {
    pearlOptions.resources.fishMaxxing = options.fishMaxxing;
  }
}

/**
 * The pearls named by a selection string, in farming order. Empty, "none" and "off"
 * select nothing; "all" selects every zone in the default order.
 */
export function parsePearlSelection(value: string): PearlSpec[] {
  const trimmed = value.trim().toLowerCase();
  if (["", "none", "off", "false"].includes(trimmed)) return [];
  if (trimmed === "all" || trimmed === "true") return [...PEARLS];
  const seen = new Set<string>();
  const result: PearlSpec[] = [];
  for (const key of trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    if (!PEARL_KEYS.includes(key as PearlKey)) {
      throw new Error(
        `pearls=${value}: unknown pearl "${key}" (valid: ${PEARL_KEYS.join(",")} or all)`,
      );
    }
    if (seen.has(key)) {
      throw new Error(`pearls=${value}: duplicate pearl "${key}"`);
    }
    seen.add(key);
    const spec = PEARLS.find((p) => p.key === key);
    if (spec) result.push(spec);
  }
  return result;
}

/**
 * The forced familiar for this zone, if any. A "none" familiar counts as unset.
 */
export function familiarOverride(key: PearlKey): Familiar | undefined {
  const value = (() => {
    switch (key) {
      case "spooky":
        return pearlOptions.overrides.spookyfamiliar;
      case "sleaze":
        return pearlOptions.overrides.sleazefamiliar;
      case "hot":
        return pearlOptions.overrides.hotfamiliar;
      case "stench":
        return pearlOptions.overrides.stenchfamiliar;
      case "cold":
        return pearlOptions.overrides.coldfamiliar;
    }
  })();
  return value === undefined || value === $familiar.none ? undefined : value;
}

/** The user's saved-outfit name for this zone, if any. Empty prefs count as unset. */
export function outfitOverride(key: PearlKey): string | undefined {
  const value = (() => {
    switch (key) {
      case "spooky":
        return pearlOptions.overrides.spookyoutfit;
      case "sleaze":
        return pearlOptions.overrides.sleazeoutfit;
      case "hot":
        return pearlOptions.overrides.hotoutfit;
      case "stench":
        return pearlOptions.overrides.stenchoutfit;
      case "cold":
        return pearlOptions.overrides.coldoutfit;
    }
  })();
  return value !== undefined && value.length > 0 ? value : undefined;
}
