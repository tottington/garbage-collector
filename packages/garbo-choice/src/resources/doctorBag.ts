import { mallPrice, npcPrice } from "kolmafia";
import { get } from "libram";

// A cure pays 500 meat times the cures made this ascension. Mafia doesn't count them, so this is the first cure's pay.
const MIN_CURE_REWARD = 500;

/**
 * Accept a Lil' Doctor™ bag quest only when its cure item costs less than the cure pays.
 * @returns 1 to accept the quest, 2 to refuse it
 */
export function getDoctorBagQuestOption(): number {
  const item = get("doctorBagQuestItem");
  if (!item) return 1;
  const prices = [mallPrice(item), npcPrice(item)].filter((price) => price > 0);
  if (!prices.length) return 2;
  return Math.min(...prices) < MIN_CURE_REWARD ? 1 : 2;
}
