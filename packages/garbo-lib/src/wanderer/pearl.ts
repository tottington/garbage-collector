import { Element, Location } from "kolmafia";
import {
  DraggableFight,
  WandererFactoryOptions,
  WandererTarget,
  wandererTurnsAvailableToday,
} from "./lib";
import {
  $effect,
  $element,
  $item,
  $location,
  BooleanProperty,
  clamp,
  get,
  have,
  NumericProperty,
} from "libram";

export type PearlTarget = {
  location: Location;
  completionPref: BooleanProperty;
  progressPref: NumericProperty;
  estimatedProgress: number;
  maximizeElement: Element;
};
export const PearlTargets: PearlTarget[] = [
  // estimating progress at some lower rates, 3.3 is with just passives.
  // TODO value resistances when targeting these, maybe make a pref or something that records our expected amount?
  {
    location: $location`The Briniest Deepests`,
    completionPref: "_unblemishedPearlTheBriniestDeepests",
    progressPref: "_unblemishedPearlTheBriniestDeepestsProgress",
    estimatedProgress: 3.3,
    maximizeElement: $element`Cold`,
  },
  {
    location: $location`Madness Reef`,
    completionPref: "_unblemishedPearlMadnessReef",
    progressPref: "_unblemishedPearlMadnessReefProgress",
    estimatedProgress: 3.3,
    maximizeElement: $element`Stench`,
  },
  {
    location: $location`Anemone Mine`,
    completionPref: "_unblemishedPearlAnemoneMine",
    progressPref: "_unblemishedPearlAnemoneMineProgress",
    estimatedProgress: 3.3,
    maximizeElement: $element`Spooky`,
  },
  {
    location: $location`The Dive Bar`,
    completionPref: "_unblemishedPearlDiveBar",
    progressPref: "_unblemishedPearlDiveBarProgress",
    estimatedProgress: 3.3,
    maximizeElement: $element`Sleaze`,
  },
  {
    location: $location`The Marinara Trench`,
    completionPref: "_unblemishedPearlMarinaraTrench",
    progressPref: "_unblemishedPearlMarinaraTrenchProgress",
    estimatedProgress: 3.3,
    maximizeElement: $element`Hot`,
  },
];

// We need to throw this to the maximizer somehow so that we properly value elemental bonuses
/* function elementalBonus(element: Element): number {
  const resistance = numericModifier(
    $modifier`${element.toString()} Resistance`
  );

  const progress = (resistance: number) =>
    Math.min(0.1, Math.max(0.017, 0.017 * Math.floor(resistance / 3)));

  const turns = (resistance: number) =>
    Math.ceil(1 / progress(resistance));

  return get("valueOfAdventure", 4000) * (turns(resistance) - turns(resistance + 1));
} */

/**
 * @param resistance The zone element's resistance worn in the fight
 * @returns The pearl progress a won fight makes: 1.7% per 3 points of resistance, from 1.7% up to 10% at 18
 */
export const pearlProgress = (resistance: number) =>
  clamp(1.7 * Math.floor(resistance / 3), 1.7, 10);

/**
 * @param progress The pearl progress each fight makes
 * @returns The fights left to finish the zone's pearl
 */
export const pearlFightsLeft = (
  target: PearlTarget,
  progress = target.estimatedProgress,
) => Math.ceil((100 - get(target.progressPref)) / progress);

export function pearlFactory(
  type: DraggableFight,
  _locationSkiplist: Location[],
  options: WandererFactoryOptions,
): WandererTarget[] {
  if (have($effect`Fishy`) && type !== "freerun") {
    return PearlTargets.filter(
      (t) =>
        !get(t.completionPref) &&
        wandererTurnsAvailableToday(options, t.location, true) >=
          pearlFightsLeft(t),
    ).map(
      (t) =>
        new WandererTarget({
          name: `${t.location} Pearl`,
          location: t.location,
          zoneValue:
            options.itemValue($item`unblemished pearl`) *
            (t.estimatedProgress / 100),
        }),
    );
  }
  return [];
}
