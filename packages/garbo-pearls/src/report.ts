import { canAdventure, maximize, myAdventures, print } from "kolmafia";
import { $item, get, have } from "libram";

import {
  requiredAttackFor,
  weaponAttackPlan,
  wineglassAccessible,
} from "./combat";
import { args, outfitOverride } from "./config";
import {
  chooseLiverConfiguration,
  overrideReportLines,
  primeZoneVerdicts,
  printProfitReport,
  zoneVerdict,
} from "./economics";
import { predictedPlayerAirByEffect } from "./familiar";
import { fishFactReport, freeFishyReport, luckySourceReport } from "./fishy";
import { uncastResBuffBonus } from "./mood";
import {
  allOrganEquipment,
  canFixOvercap,
  liverMode,
  organStatusReport,
  requiredOrganEquipment,
  setLiverMode,
  wineglassMode,
} from "./organs";
import {
  pearlAvoidTerms,
  pearlDamagePlan,
  pearlForcedEquipment,
  pearlOutfitWeights,
  pearlResObjective,
} from "./outfit";
import { canBreathUnderwater, PearlSpec } from "./zones";

export type PearlReportOptions = {
  /** Price as if falling-down drunk (wineglass, attack-only), whatever the real state. */
  overdrunk?: boolean;
  /**
   * Pick the liver mode and price every zone first. Off reuses the pricing a previous
   * report in the same call already did.
   */
  reprice?: boolean;
};

/** Report-only pricing: never casts buffs or spends anything. */
function priceForReport(selected: PearlSpec[], overdrunk: boolean): void {
  if (overdrunk) {
    setLiverMode("wineglass");
  } else {
    setLiverMode(undefined);
    chooseLiverConfiguration(selected);
  }
  primeZoneVerdicts(selected);
}

/**
 * Per-zone cost breakdown and GO/SKIP verdict under the chosen liver mode. Spends
 * nothing: buffs that a real run would cast first are reported, not cast.
 */
export function printPearlProfitReport(
  selected: PearlSpec[],
  { overdrunk = false, reprice = true }: PearlReportOptions = {},
): void {
  if (reprice) priceForReport(selected, overdrunk);
  if (!canFixOvercap()) {
    print(
      "pearls: stomach/spleen overcapped beyond owned extenders, so the run would not farm.",
      "red",
    );
  }
  printProfitReport(selected);
}

/**
 * Requirements check: breathing, Fishy sources, organs, and per zone the damage plan and
 * the equipment the run would dress. Spends nothing.
 */
export function printPearlSimReport(
  selected: PearlSpec[],
  { overdrunk = false, reprice = true }: PearlReportOptions = {},
): void {
  if (reprice) priceForReport(selected, overdrunk);
  const simDrunk = wineglassMode();
  print(`pearls sim${simDrunk ? " (overdrunk mode)" : ""}:`, "blue");
  print(` pearls selected: ${selected.map((p) => p.key).join(", ")}`);
  print(` can breathe underwater: ${canBreathUnderwater()}`);
  print(freeFishyReport());
  print(fishFactReport());
  for (const line of luckySourceReport()) print(line);
  print(` adventures available: ${myAdventures()}`);
  for (const line of organStatusReport()) print(line);
  {
    const forced = args.major.overcapped
      ? allOrganEquipment()
      : requiredOrganEquipment();
    print(
      ` forced organ equipment${args.major.overcapped ? " (overcapped flag: full set)" : ""}: ${forced.length > 0 ? forced.join(", ") : "none"}`,
    );
  }
  for (const spec of selected) {
    const v = zoneVerdict(spec);
    const obtained = get(spec.obtained)
      ? " (already obtained today — will not farm)"
      : "";
    print(
      `  ${spec.key}: res ${v.res}${v.potionCost > 0 ? ` (incl. ${Math.round(v.potionCost)} meat of potions)` : ""} → ${v.ratePct.toFixed(1)}%/fight — expected profit ${Math.round(v.profit)} meat — ${v.go ? "GO" : "SKIP"}${obtained}`,
      v.go ? "blue" : "red",
    );
    const uncast = uncastResBuffBonus(spec);
    if (uncast > 0) {
      print(
        `   note: +${uncast} res of castable free buffs is not active — a real run casts them before pricing, so this estimate is conservative.`,
      );
    }
    for (const line of overrideReportLines(spec)) print(line);
  }
  if (!canFixOvercap()) {
    print(
      " stomach/spleen overcapped beyond owned extenders — the run would halt (mojo filter / organ cleaners / rollover).",
      "red",
    );
  }
  if (simDrunk && !have($item`Drunkula's wineglass`)) {
    print(
      " no Drunkula's wineglass — overdrunk farming would not run at all",
      "red",
    );
  } else if (simDrunk && !wineglassAccessible()) {
    print(
      " Drunkula's wineglass is owned but NOT in inventory (closet/storage?) — neither the maximizer nor the dress can reach it there. Take it out first.",
      "red",
    );
  }
  // Per-element blocks (speculative — nothing is equipped; current familiar counts).
  // Air is the run's *predicted* state: the Breathe Underwater cascade hasn't run
  // yet at sim time, but the real dress will happen after it has.
  const breathing = predictedPlayerAirByEffect()
    ? ""
    : ", adventure underwater";
  // Only force the wineglass into the speculation when it is actually reachable —
  // otherwise every combination FAILs on the +equip and the res verdict is garbage.
  const glassReachable = !simDrunk || wineglassAccessible();
  for (const p of selected) {
    print(` --- ${p.key} (${p.loc}) ---`, "blue");
    print(`  canAdventure: ${canAdventure(p.loc)}`);
    const mode = simDrunk ? "wineglass" : liverMode();
    if (simDrunk) {
      const simWeapon = have(args.major.drunkweapon)
        ? args.major.drunkweapon
        : undefined;
      const attack = weaponAttackPlan(p.maxDef, p.maxHp, simWeapon);
      const oneShotNote = attack.canOneShot
        ? ""
        : args.major.leeroyjenkins
          ? " (leeroyjenkins: would fight anyway)"
          : " (would skip the zone; leeroyjenkins overrides)";
      print(
        `  attack floor (${simWeapon ?? "equipped weapon"}, ${attack.ranged ? "ranged" : "melee"}) vs ${p.maxHp} HP: ${attack.damage} — ` +
          `hit ${attack.hitGuaranteed ? "guaranteed" : `NOT guaranteed (need ${requiredAttackFor(p.maxDef)} ${attack.ranged ? "Moxie" : "Muscle"} vs Def ${p.maxDef})`} — ` +
          `one-shot: ${attack.canOneShot}${oneShotNote}`,
        attack.canOneShot ? "blue" : "red",
      );
    } else {
      const plan = pearlDamagePlan(p, mode);
      print(
        `  saucegeyser floor (planned outfit) vs ${p.maxHp} HP: ${plan.perCast} → ${plan.casts} cast(s)/fight, ${plan.mpPerFight} MP/fight`,
      );
    }
    // Recommended equips mirror buildPearlOutfit's overdrunk weapon logic: the
    // drunkweapon is forced when owned and not displaced by a required totem, and
    // 'effective' only applies when no weapon is forced. No `18 min` here — with
    // damage weights in the expression the maximizer optimizes total score, so a
    // min flag reports FAIL on outfits that trade res for damage even when a
    // pure-res 18 exists. Reachability is the verdict lines' res floor above.
    // The same forced slots, weights and refusals buildPearlOutfit and the profit
    // model use, so the outfit this prints is the one the run would dress.
    // A closeted wineglass would make every combination fail the +equip, so leave it
    // out of the expression rather than print garbage.
    const forced = pearlForcedEquipment(
      p,
      mode,
      predictedPlayerAirByEffect,
    ).equip.filter((i) => glassReachable || i !== $item`Drunkula's wineglass`);
    const weaponForced =
      simDrunk &&
      (forced.includes($item`angelbone totem`) || have(args.major.drunkweapon));
    const forcedTerms = forced.map((i) => `, +equip ${i}`).join("");
    const expr =
      `${pearlResObjective(p, simDrunk)}${breathing}` +
      `${forcedTerms}${pearlOutfitWeights(simDrunk, weaponForced)}${pearlAvoidTerms(p)}`;
    const overrideNote =
      outfitOverride(p.key) !== undefined ? " (ignores zone overrides)" : "";
    print(
      `  recommended equips (as the run would dress)${simDrunk && glassReachable ? " (wineglass in off-hand)" : ""}:${overrideNote}`,
      "blue",
    );
    for (const boost of maximize(expr, 0, 0, true, true)) {
      if (boost.command.startsWith("equip")) print(`   ${boost.display}`);
    }
  }
}

/** The sim report followed by the profit breakdown, pricing once for both. */
export function printPearlReport(
  selected: PearlSpec[],
  options: PearlReportOptions = {},
): void {
  printPearlSimReport(selected, { ...options, reprice: true });
  printPearlProfitReport(selected, { ...options, reprice: false });
}
