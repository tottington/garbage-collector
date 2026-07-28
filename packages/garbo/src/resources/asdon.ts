import { Effect, getFuel, haveEffect, print, visitUrl } from "kolmafia";
import { AsdonMartin } from "libram";

let fuelGaugeSynced = false;

/**
 * Mafia only learns the Asdon's fuel level when it parses the workshed
 * interface, so a session that has never opened it (e.g. the first session
 * after an ascension) reads 0 fuel for a tank that may be full. Visit the
 * workshed once before trusting getFuel(), so we never try to fuel a tank
 * that doesn't need it.
 */
export function syncAsdonFuelGauge(): void {
  if (fuelGaugeSynced || !AsdonMartin.installed()) return;
  fuelGaugeSynced = true;
  visitUrl("campground.php?action=workshed");
}

/**
 * AsdonMartin.fillTo with two extra guards: the fuel gauge is synced first
 * (see syncAsdonFuelGauge), and a fueling failure — e.g. the price-capped
 * mall buy coming back empty, which makes libram convert zero items and
 * throw — prints a warning and returns false instead of aborting the run.
 *
 * @param target Fuel level to attempt to reach.
 * @returns Whether the tank now holds at least the target fuel level.
 */
export function asdonFillTo(target: number): boolean {
  if (!AsdonMartin.installed()) return false;
  syncAsdonFuelGauge();
  if (getFuel() >= target) return true;
  try {
    return AsdonMartin.fillTo(target);
  } catch (e) {
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
  if (haveEffect(style) >= turns) return true;
  syncAsdonFuelGauge();
  try {
    return AsdonMartin.drive(style, turns);
  } catch (e) {
    print(`Failed to fuel the Asdon Martin for ${style}: ${e}`, "red");
    return haveEffect(style) >= turns;
  }
}
