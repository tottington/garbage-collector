/**
 * Fake `grimoire-kolmafia` module (see vitest.config.ts aliases). Args.create builds a
 * plain object of default values that tests mutate directly (e.g.
 * `game.args.resources.potionprice = 5000`); the task/combat/outfit classes are inert
 * containers so task definitions can be constructed and their ready()/completed()
 * predicates exercised.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { __state } from "./kolmafia";

const LEAF = Symbol("arg");
const GROUP = Symbol("group");

type Leaf = { [LEAF]: true; default: unknown };
type Group = { [GROUP]: true; spec: Record<string, unknown> };

function leaf(options: { default?: unknown }): Leaf {
  return { [LEAF]: true, default: options.default };
}

export class ParseError extends Error {}

function buildDefaults(spec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec)) {
    if (
      value !== null &&
      typeof value === "object" &&
      LEAF in (value as object)
    ) {
      out[key] = (value as Leaf).default;
    } else if (
      value !== null &&
      typeof value === "object" &&
      GROUP in (value as object)
    ) {
      out[key] = buildDefaults((value as Group).spec);
    }
  }
  return out;
}

const metadata = new WeakMap<object, { scriptName: string }>();

export const Args = {
  flag: (options: { default?: boolean; [k: string]: unknown }) =>
    leaf({ default: options.default ?? false }),
  string: (options: { default?: string; [k: string]: unknown }) =>
    leaf(options),
  number: (options: { default?: number; [k: string]: unknown }) =>
    leaf(options),
  item: (options: { default?: unknown; [k: string]: unknown }) => leaf(options),
  familiar: (options: { default?: unknown; [k: string]: unknown }) =>
    leaf(options),
  custom: (
    options: { default?: unknown; [k: string]: unknown },
    ...rest: unknown[]
  ) => {
    void rest;
    return leaf(options);
  },
  group: (name: string, spec: Record<string, unknown>): Group => {
    void name;
    return { [GROUP]: true, spec };
  },
  create: (
    scriptName: string,
    help: string,
    spec: Record<string, unknown>,
    options?: unknown,
  ): any => {
    void help;
    void options;
    const args = { help: false, ...buildDefaults(spec) };
    metadata.set(args, { scriptName });
    return args;
  },
  fill: (): void => {},
  showHelp: (): void => {},
  getMetadata: (args: object): { scriptName: string } =>
    metadata.get(args) ?? { scriptName: "unknown" },
};

export function step(questName: string): number {
  const value = __state.properties.get(questName);
  return typeof value === "number" ? value : -1;
}

export type OutfitSpec = Record<string, unknown>;
export type Modes = Record<string, unknown>;
export type Task = Record<string, unknown>;
export type Quest<T> = { name: string; tasks: T[] };

export class CombatStrategy {
  macros: unknown[] = [];
  macro(...args: unknown[]): this {
    this.macros.push(args);
    return this;
  }
}

export class Outfit {
  private spec: unknown;
  static from(spec: unknown, error?: Error): Outfit {
    void error;
    const outfit = new Outfit();
    outfit.spec = spec;
    return outfit;
  }
  /**
   * Dressing changes what the player measures. Tests register a handler to say what a
   * given outfit spec yields; without one this stays a no-op, so a test that needs the
   * dress to matter has to say so rather than silently measuring the same number.
   */
  dress(): void {
    __state.onDress?.(this.spec);
  }
  equip(): boolean {
    return true;
  }
}

export function getTasks(quests: { tasks: unknown[] }[]): unknown[] {
  return quests.flatMap((q) => q.tasks);
}

export class Engine {
  tasks: unknown[];
  constructor(tasks: unknown[] = []) {
    this.tasks = tasks;
  }
}
