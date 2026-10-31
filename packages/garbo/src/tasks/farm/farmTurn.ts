import { $item, $location, $monster, get, have } from "libram";
import {
  Item,
  mallPrice,
  myAdventures,
  myLocation,
  toMonster,
  totalTurnsPlayed,
  use,
} from "kolmafia";
import { $effect, CrepeParachute } from "libram";
import { Quest } from "grimoire-kolmafia";

import { GarboTask } from "../engine";
import {
  canContinue,
  shouldCheckParachute,
  updateParachuteFailure,
} from "./lib";
import {
  averageRedTaffyValue,
  FarmingStrategy,
  redTaffyWorth,
} from "../../farmingStrategy";
import { trackMarginalMpa } from "../../session";
import { meatMood } from "../../mood";
import { estimatedGarboTurns } from "../../turns";
import { barfOutfit } from "../../outfit/barf";
import { FarmingContext } from "../context";
import { acquire } from "../../acquire";
import { Macro } from "../../combat";
import { GarboStrategy } from "../../combatStrategy";
import {
  canFarmTreasury,
  equipAcorndion,
  floodTreasury,
  leaveTreasury,
  prepareTreasuryPlanting,
  recordTreasuryPlanting,
  treasuryPlantingMacro,
} from "../../resources/acorndion";
import {
  TREASURY,
  treasuryAcorns,
  treasuryFlooded,
  treasuryPlantingDone,
} from "../../resources/acornState";

const farmingTreasury = () => FarmingStrategy.location === TREASURY;

function ensureFishy(): void {
  if (
    !have($effect`Fishy`) &&
    have($item`fishy pipe`) &&
    !get("_fishyPipeUsed")
  ) {
    use($item`fishy pipe`);
  }
}

// Flood the Treasury with Summon a Wave and plant the acorndion's acorns before farming it
const TREASURY_SETUP_TASKS: GarboTask<FarmingContext>[] = [
  {
    name: "Leave the Treasury",
    ready: farmingTreasury,
    completed: () => !farmingTreasury() || canFarmTreasury(),
    do: () => leaveTreasury("The Treasury can't be flooded today."),
    spendsTurn: false,
  },
  {
    name: "Visit the Treasury",
    ready: () => farmingTreasury() && !get("_seadentWaveUsed"),
    completed: () => treasuryFlooded() || get("lastAdventure") === TREASURY,
    outfit: (context) => barfOutfit(FarmingStrategy.outfit(context)),
    do: TREASURY,
    combat: new GarboStrategy(() => Macro.meatKill()),
    post: floodTreasury,
    spendsTurn: true,
  },
  {
    name: "Flood the Treasury",
    ready: () => farmingTreasury() && get("lastAdventure") === TREASURY,
    completed: () => treasuryFlooded() || get("_seadentWaveUsed"),
    do: floodTreasury,
    spendsTurn: false,
  },
  {
    name: "Plant Treasury acorns",
    ready: () => farmingTreasury() && treasuryFlooded(),
    completed: () => !farmingTreasury() || treasuryPlantingDone(),
    prepare: () => {
      ensureFishy();
      equipAcorndion();
      prepareTreasuryPlanting();
    },
    outfit: (context) => barfOutfit(FarmingStrategy.outfit(context)),
    do: TREASURY,
    combat: new GarboStrategy(() => treasuryPlantingMacro()),
    post: recordTreasuryPlanting,
    spendsTurn: true,
  },
  {
    name: "Leave the Treasury without sea cows",
    ready: () => farmingTreasury() && treasuryPlantingDone(),
    completed: () => !farmingTreasury() || treasuryAcorns().seaCows,
    do: () => leaveTreasury("The sea cow acorn didn't take in the Treasury."),
    spendsTurn: false,
  },
];

export const farmPrepare = (context: FarmingContext) => {
  if (redTaffyWorth() && FarmingStrategy.isUnderwater()) {
    acquire(
      estimatedGarboTurns(),
      $item`pulled red taffy`,
      averageRedTaffyValue(),
      false, // It's fine to continue running if there aren't appropriately priced taffies
    );
  }
  if (
    FarmingStrategy.location === $location`The Coral Corral` &&
    get("seahorseName") === "" &&
    get("lassoTrainingCount") >= 20
  ) {
    acquire(3, $item`sea cowbell`, 5000, true); // Arbitrary max price
    acquire(1, $item`sea lasso`, 5000, true);
  }

  // Only re-run mood every so often
  if (!(totalTurnsPlayed() % 11)) {
    if (
      (FarmingStrategy.location === $location`Barf Mountain` &&
        !get("dinseyRollercoasterNext")) ||
      FarmingStrategy.location !== $location`Barf Mountain`
    ) {
      meatMood().execute(estimatedGarboTurns());
    }
  }

  if (context.banish?.retrieve && context.banish.source instanceof Item) {
    acquire(1, context.banish.source, mallPrice(context.banish.source) * 1.2); // Sanity check on price, 20%
  }
};

export function FarmTurnQuest(): Quest<
  GarboTask<FarmingContext>,
  FarmingContext
> {
  const location = FarmingStrategy.location;
  return {
    name: `${location}`,
    tasks: [
      ...(location === TREASURY ? TREASURY_SETUP_TASKS : []),
      {
        name: "Parachute",
        ready: () =>
          CrepeParachute.have() &&
          shouldCheckParachute() &&
          myLocation() === FarmingStrategy.location &&
          FarmingStrategy.shouldOlfact,
        completed: () =>
          have($effect`Everything looks Beige`) || myAdventures() === 0,
        outfit: (context) => barfOutfit(FarmingStrategy.outfit(context)),
        do: () => CrepeParachute.fight(FarmingStrategy.primaryMonster()),
        combat: FarmingStrategy.strategy(),
        post: () => {
          FarmingStrategy.post?.();
          if (!have($effect`Everything looks Beige`)) updateParachuteFailure();
          trackMarginalMpa();
        },
        spendsTurn: true,
      },
      {
        name: "Farm",
        ready: () => location !== TREASURY || treasuryAcorns().seaCows,
        completed: () =>
          myAdventures() === 0 || FarmingStrategy.location !== location,
        prepare: farmPrepare,
        outfit: (context) => barfOutfit(FarmingStrategy.outfit(context)),
        do: FarmingStrategy.location,
        combat: FarmingStrategy.strategy(),
        post: () => {
          FarmingStrategy.post?.();
          trackMarginalMpa();

          if (toMonster(get("lastEncounter")) === $monster`tumbleweed`) {
            throw new Error(
              "You encountered a tumbleweed and should not have, resolve your banishes",
            );
          }

          if (
            FarmingStrategy.monstersToBanish().includes(
              toMonster(get("lastEncounter")),
            )
          ) {
            throw new Error(
              "You encountered a banishable monster and didn't banish it, sort your life out!",
            );
          }
        },
        spendsTurn: true,
      },
    ],
    completed: () => !canContinue() || FarmingStrategy.location !== location,
  };
}
