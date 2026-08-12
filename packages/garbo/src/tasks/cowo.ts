import { GarboTask } from "./engine";
import { globalOptions } from "../config";
import { meatMood } from "../mood";
import { estimatedGarboTurns } from "../turns";
import {
  cowoChooseBanish,
  getCowoMonstersToBanish,
  redTaffyWorth,
} from "../resources/cowoResources";
import {
  Familiar,
  Item,
  myAdventures,
  retrieveItem,
  toMonster,
  toSlot,
  weaponHands,
  weaponType,
} from "kolmafia";
import {
  $effect,
  $item,
  $location,
  $monsters,
  $skill,
  $slot,
  AsdonMartin,
  FloristFriar,
  get,
  have,
} from "libram";
import { Outfit } from "grimoire-kolmafia";
import { barfOutfit } from "../outfit";
import { GarboStrategy } from "../combatStrategy";
import { Macro } from "../combat";
import { trackMarginalMpa } from "../session";
import postCombatActions from "../post";
import { garboFarmLocation } from "../lib";

/**
 * Equip the gear a banish method needs without creating an illegal dual-wield.
 *
 * KoL refuses an off-hand weapon whose WeaponType differs from the wielded one
 * ("You can't hold a <x> in your off-hand when wielding a <y>"), and
 * Outfit.equip() does not check that -- it pins the off-hand anyway, and
 * dress() then dies with "Failed to fully dress", taking the run with it. The
 * Monodent (one-handed spear, melee) next to a barf weapon like an ice nine
 * (one-handed pistol, ranged) hits this every time.
 *
 * The banish only works while its item is equipped, so when dual-wielding is
 * not legal we drop the outfit's weapon and take that slot instead. Losing the
 * maximizer's weapon for the turn is much cheaper than aborting, and cheaper
 * than silently failing to banish.
 */
function equipBanishGear(outfit: Outfit, thing: Item | Familiar): void {
  if (thing instanceof Item && toSlot(thing) === $slot`weapon`) {
    const weapon = outfit.equips.get($slot`weapon`);
    const canDualWield =
      weapon !== undefined &&
      have($skill`Double-Fisted Skull Smashing`) &&
      weaponHands(weapon) === 1 &&
      weaponHands(thing) === 1 &&
      weaponType(weapon) === weaponType(thing);
    if (weapon && !canDualWield) outfit.equips.delete($slot`weapon`);
  }
  outfit.equip(thing);
}

export function CowoTasks(): GarboTask[] {
  return [
    {
      name: "Cowo",
      ready: () => globalOptions.cowo,
      prepare: () => {
        if (redTaffyWorth()) {
          retrieveItem($item`pulled red taffy`);
        }
        meatMood().execute(estimatedGarboTurns());

        if (getCowoMonstersToBanish().length > 0) {
          retrieveItem($item`human musk`);
        }

        if (!have($effect`Driving Waterproofly`)) {
          AsdonMartin.drive(
            $effect`Driving Waterproofly`,
            estimatedGarboTurns(),
          );
        }
      },
      completed: () => myAdventures() === 0,
      outfit: () => {
        const outfit = barfOutfit({
          pants: have($effect`Driving Waterproofly`)
            ? undefined
            : $item`really, really nice swimming trunks`,
          famequip: have($effect`Driving Waterproofly`)
            ? undefined
            : $item`das boot`,
        });
        const banishMethod = cowoChooseBanish();

        if (banishMethod?.equip) {
          equipBanishGear(outfit, banishMethod.equip);
        }

        return outfit;
      },
      do: $location`The Coral Corral`,
      combat: new GarboStrategy(() => {
        const banishMethod = cowoChooseBanish();

        if (banishMethod === null && getCowoMonstersToBanish().length > 0) {
          throw new Error(
            "I have monsters to banish for cowo, but no banishes are available!",
          );
        }
        if (redTaffyWorth()) {
          return Macro.if_(
            $monsters`Mer-kin rustler, sea cowboy`,
            banishMethod?.macro() ?? Macro.abort(),
          )
            .tryItem($item`pulled red taffy`)
            .meatKill();
        } else {
          return Macro.if_(
            $monsters`Mer-kin rustler, sea cowboy`,
            banishMethod?.macro() ?? Macro.abort(),
          ).meatKill();
        }
      }),
      post: () => {
        trackMarginalMpa();
        postCombatActions();

        const BARF_PLANTS = [
          FloristFriar.Crookweed,
          FloristFriar.ElectricEelgrass,
          FloristFriar.Duckweed,
        ]
        if (BARF_PLANTS.some((flower) => flower.available($location`The Coral Corral`))) {
          BARF_PLANTS.filter((flower) =>
                  flower.available(garboFarmLocation()),
                ).forEach((flower) => flower.plant());
        }

        if (
          getCowoMonstersToBanish().includes(toMonster(get("lastEncounter")))
        ) {
          throw "You encountered a banishable monster and didn't banish it, sort your life out!";
        }
      },
      spendsTurn: true,
    },
  ];
}
