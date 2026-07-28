import { Effect, getFuel, haveEffect, print, visitUrl } from "kolmafia";
import { AsdonMartin } from "libram";

let fuelGaugeSynced = false;
let fuelingFailed = false;

/**
 * Mafia only learns the Asdon's fuel level when it parses the workshed
 * interface, so a session that has never opened it (e.g. the first session
 * after an ascension) reads 0 fuel for a tank that may be full. Visit the
 * workshed once before trusting getFuel(), so we never try to fuel a tank
 * that doesn't need it. The synced flag is only set once the response
 * actually contains the fuel gauge, so a redirected or failed visit retries
 * on the next call.
 */
export function syncAsdonFuelGauge(): void {
  if (fuelGaugeSynced || !AsdonMartin.installed()) return;
  if (visitUrl("campground.php?action=workshed").includes("fuel gauge reads")) {
    fuelGaugeSynced = true;
  }
}

/**
 * @returns Whether a fueling attempt genuinely failed this session; callers
 * whose tasks would otherwise retry forever should treat this as done.
 */
export function asdonFuelingFailed(): boolean {
  return fuelingFailed;
}

/**
 * AsdonMartin.fillTo with two extra guards: the fuel gauge is synced first
 * (see syncAsdonFuelGauge), and a fueling failure — e.g. the price-capped
 * mall buy coming back empty, which makes libram convert zero items and
 * throw — prints a warning and returns false instead of aborting the run.
 * Callers must handle false; see asdonFuelingFailed for retry loops.
 *
 * @param target Fuel level to attempt to reach.
 * @returns Whether the tank now holds at least the target fuel level.
 */
export function asdonFillTo(target: number): boolean {
  if (!AsdonMartin.installed()) return false;
  syncAsdonFuelGauge();
  try {
    return AsdonMartin.fillTo(target);
  } catch (e) {
    fuelingFailed = true;
    print(`Failed to fuel the Asdon Martin to ${target}: ${e}`, "red");
    return getFuel() >= target;
  }
}

/**
 * AsdonMartin.drive with the same guards as asdonFillTo.
 *
 * @param style The driving style to use.
 * @param turns The number of turns of the style to attempt to get.
 * @returns Whether we have at least as many turns of the style as requested.
 */
export function asdonDrive(style: Effect, turns = 1): boolean {
  if (!AsdonMartin.installed()) return false;
  if (!Object.values(AsdonMartin.Driving).includes(style)) return false;
  if (haveEffect(style) >= turns) return true;
  syncAsdonFuelGauge();
  try {
    return AsdonMartin.drive(style, turns);
  } catch (e) {
    fuelingFailed = true;
    print(`Failed to fuel the Asdon Martin for ${style}: ${e}`, "red");
    return haveEffect(style) >= turns;
  }
}
