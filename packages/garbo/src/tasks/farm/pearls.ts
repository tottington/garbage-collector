import { Quest } from "grimoire-kolmafia";
import {
  inebrietyLimit,
  myAdventures,
  myInebriety,
  myTurncount,
  print,
} from "kolmafia";
import { get } from "libram";
import {
  configurePearls,
  parsePearlSelection,
  PEARLS,
  PearlSpec,
  PearlTask,
  pearlTasks,
  printPearlProfitReport,
  printPearlReport,
  wineglassAccessible,
} from "garbo-pearls";

import { Macro } from "../../combat";
import { GarboStrategy } from "../../combatStrategy";
import { globalOptions } from "../../config";
import { garboValue } from "../../garboValue";
import { HIGHLIGHT } from "../../lib";
import { GarboTask } from "../engine";
import { FarmingContext } from "../context";
import { canContinue } from "./lib";

/** Adventures garbo lets pearl farming spend: its turn limit and saved turns come off. */
function pearlTurnBudget(): number {
  const untilStop =
    globalOptions.stopTurncount === null
      ? Infinity
      : globalOptions.stopTurncount - myTurncount();
  return Math.min(myAdventures() - globalOptions.saveTurns, untilStop);
}

/** Points the pearl models at garbo's economy and settings. */
function configureGarboPearls(): void {
  const prefs = globalOptions.prefs;
  configurePearls({
    valueOfAdventure: () => get("valueOfAdventure"),
    itemValue: garboValue,
    adventuresAvailable: pearlTurnBudget,
    requireCap: prefs.pearlRequireCap,
    force: prefs.pearlForce,
    airMode: prefs.pearlAirMode as "effects" | "gear" | "auto",
    potionPrice: prefs.pearlPotionPrice,
    luckyFishy: prefs.pearlLuckyFishy,
    cloverPrice: prefs.pearlCloverPrice,
    momBuff: prefs.pearlMomBuff,
    codpiece: prefs.pearlCodpiece,
    drunkWeapon: prefs.pearlDrunkWeapon,
    leeroyJenkins: prefs.pearlLeeroyJenkins,
    overcapped: prefs.pearlOvercapped,
    fishMaxxing: prefs.pearlFishMaxxing,
  });
}

/** The pearls the `pearls` option selects, validated. */
export function selectedPearls(): PearlSpec[] {
  return parsePearlSelection(globalOptions.pearls);
}

function toGarboTask(task: PearlTask): GarboTask<FarmingContext> {
  const { macro, ...rest } = task;
  if (macro === undefined) return { ...rest, do: rest.do as () => void };
  return {
    ...rest,
    outfit: rest.outfit ?? {},
    combat: new GarboStrategy(() => Macro.step(macro())),
  };
}

export function PearlsQuest(): Quest<
  GarboTask<FarmingContext>,
  FarmingContext
> {
  const selected = selectedPearls();
  if (selected.length > 0) configureGarboPearls();
  return {
    name: "Pearls",
    // A quest-level ready() short-circuits the tasks' own ready(), which price zones.
    ready: () => selected.length > 0 && canContinue(),
    tasks: selected.length > 0 ? pearlTasks(selected).map(toGarboTask) : [],
  };
}

/**
 * The `pearlreport` mode: requirements and profit for the selected pearls, or all five.
 * While sober with a reachable wineglass it also prices the overdrunk run.
 */
export function pearlReport(): void {
  configureGarboPearls();
  const chosen = selectedPearls();
  const selected = chosen.length > 0 ? chosen : [...PEARLS];
  print("Unblemished pearl report", HIGHLIGHT);
  printPearlReport(selected);
  if (myInebriety() <= inebrietyLimit() && wineglassAccessible()) {
    print("");
    print("Overdrunk (Drunkula's wineglass) what-if:", HIGHLIGHT);
    printPearlProfitReport(selected, { overdrunk: true });
  }
}
