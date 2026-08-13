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
 * not legal the banish item takes the weapon slot instead. Losing the outfit's
 * weapon for the turn is cheaper than aborting or than failing to banish, but
 * only if the banish item actually goes on, so the weapon is put back if it
 * does not.
 * @param outfit The outfit to add the banish gear to
 * @param thing The gear the chosen banish method needs equipped
 * @returns Whether the gear was equipped
 */
function equipBanishGear(outfit: Outfit, thing: Item | Familiar): boolean {
  if (!(thing instanceof Item) || toSlot(thing) !== $slot`weapon`) {
    return outfit.equip(thing);
  }

  const weapon = outfit.equips.get($slot`weapon`);
  if (!weapon) return outfit.equip(thing, $slot`weapon`);

  const canDualWield =
    !outfit.equips.has($slot`off-hand`) &&
    have($skill`Double-Fisted Skull Smashing`) &&
    weaponHands(weapon) === 1 &&
    weaponHands(thing) === 1 &&
    weaponType(weapon) === weaponType(thing);
  if (canDualWield && outfit.equip(thing, $slot`off-hand`)) return true;

  outfit.equips.delete($slot`weapon`);
  if (outfit.equip(thing, $slot`weapon`)) return true;
  outfit.equips.set($slot`weapon`, weapon);
  return false;
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
        // Only dress for a banish we still need. Once both monsters are
        // banished the gear buys nothing, and taking the weapon slot for it
        // costs us the outfit's weapon every turn for the rest of the day.
        const banishMethod =
          getCowoMonstersToBanish().length > 0 ? cowoChooseBanish() : null;

        if (
          banishMethod?.equip &&
          !equipBanishGear(outfit, banishMethod.equip)
        ) {
          throw new Error(
            `Could not equip ${banishMethod.equip} to banish with ${banishMethod.name}.`,
          );
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
