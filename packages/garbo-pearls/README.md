# garbo-pearls

Unblemished pearl farming for garbo: the five underwater pearl zones (Anemone Mine,
The Dive Bar, The Marinara Trench, Madness Reef, The Briniest Deepests), each farmed
only when its expected profit beats the turns it costs.

Ported from pearlo (https://github.com/xn/pearlo). The original MIT license is kept in
`LICENSE`.

## What it does

For each selected zone the profit model prices one pearl against what it costs to
finish: turns at the host's value of an adventure, MP and HP restores, debuff cures,
resistance potions and Lucky! refreshes. A zone is farmed only when that profit is
positive (GO); otherwise it is skipped (SKIP). The model picks the liver mode (sober,
liver extenders, Stooper, or overdrunk with Drunkula's wineglass), the outfit, the
familiar, the resistance potions worth buying, and the Fishy sources to spend.

## API

The package is a library; it has no `main()`.

- `configurePearls(options)` points the models at the host's economy and settings:
  `valueOfAdventure`, `itemValue` and `adventuresAvailable` hooks, plus the farming
  options (`requireCap`, `force`, `airMode`, `potionPrice`, `luckyFishy`,
  `cloverPrice`, `momBuff`, `codpiece`, `drunkWeapon`, `leeroyJenkins`, `overcapped`,
  `fishMaxxing`).
- `parsePearlSelection(value)` turns `"cold,hot"`, `"all"` or `""` into zone specs.
- `pearlTasks(selected)` returns grimoire-shaped tasks in priority order: Plan,
  Breathe Underwater, Lutz Fishy, Get Fishy, one task per zone, Prep Codpiece. Fights
  carry a `macro` builder instead of a combat strategy, and every task says whether it
  spends a turn and which sobriety it needs, so the host wraps them in its own engine.
- `printPearlSimReport`, `printPearlProfitReport` and `printPearlReport` print the
  requirements check and the per-zone cost breakdown without spending anything.

## Development

```sh
yarn workspace garbo-pearls build   # tsc to dist/, which garbo bundles
yarn workspace garbo-pearls check   # typecheck src and tests
yarn workspace garbo-pearls test    # vitest suite against a fake game, see test/README.md
```
