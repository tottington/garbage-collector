import { GarboTask } from "../engine";
import { globalOptions } from "../../config";
import { meatMood } from "../../mood";
import { estimatedGarboTurns } from "../../turns";
import {
  cowoChooseBanish,
  getCowoMonstersToBanish,
  redTaffyWorth,
} from "../../resources/cowoResources";
import {
  Familiar,
  Item,
  myAdventures,
  print,
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
import { barfOutfit } from "../../outfit";
import { GarboStrategy } from "../../combatStrategy";
import { Macro } from "../../combat";
import { trackMarginalMpa } from "../../session";
import postCombatActions from "../../post";
import { Outfit, Quest } from "grimoire-kolmafia";

/**
 * Equip a banish method's gear without creating an illegal dual-wield.
 *
 * KoL refuses an off-hand weapon of a different WeaponType and Outfit.equip()
 * does not check that, so dress() would fail. When dual-wielding is not legal
 * the banish item takes the weapon slot, restoring the weapon if it will not go
 * on.
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

export const CowoQuest: Quest<GarboTask> = {
   name: "Sea Cow Turn",
  tasks: [
    {
      name: "Coral Corral",
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
        const outfit =
          have($effect`Driving Waterproofly`)
            ? barfOutfit({})
            :
          barfOutfit({
            pants: $item`really, really nice swimming trunks`,
          });
        const banishMethod = cowoChooseBanish();

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
        if(banishMethod) {
          print(`Planning to banish using ${banishMethod?.name}`);
        }

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
        ];
        if (
          BARF_PLANTS.some((flower) =>
            flower.available($location`The Coral Corral`),
          )
        ) {
          BARF_PLANTS.filter((flower) =>
            flower.available($location`The Coral Corral`),
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
  ],
}
