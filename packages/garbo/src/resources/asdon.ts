import { getFuel, Item, itemAmount, print } from "kolmafia";
import { AsdonMartin } from "libram";

/**
 * Run an Asdon Martin fueling call, reporting the state we were in if it
 * throws.
 *
 * libram's fueling aborts the run when it can't fuel, and its message only
 * ever reaches the CLI -- mafia does not put it in the session log -- so a
 * failure currently leaves behind no record of what went wrong. print does
 * reach the session log, so this leaves a trace. The error is rethrown
 * untouched, so behaviour is otherwise unchanged.
 *
 * @param description What we were trying to do, for the log message.
 * @param action The fueling call to run.
 * @returns Whatever the call returned.
 */
export function reportingAsdonFailure<T>(
  description: string,
  action: () => T,
): T {
  try {
    return action();
  } catch (e) {
    // Which fuel we were holding narrows down what the picker had chosen, and
    // the fuel level says whether we were failing to buy or failing to convert.
    const held = Item.all()
      .filter((item) => AsdonMartin.isFuelItem(item) && itemAmount(item) > 0)
      .map((item) => `${itemAmount(item)}x ${item}`);
    print(`Asdon Martin ${description} failed: ${e}`, "red");
    print(`  fuel in tank: ${getFuel()}`, "red");
    print(`  fuel items held: ${held.join(", ") || "none"}`, "red");
    throw e;
  }
}
