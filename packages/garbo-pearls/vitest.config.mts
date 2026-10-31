import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The kolmafia package and the libraries built on it only work inside the KoLmafia
// JVM. Tests substitute fakes backed by a settable game state, see test/README.md.
const mock = (name: string) =>
  fileURLToPath(new URL(`./test/mocks/${name}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      kolmafia: mock("kolmafia"),
      libram: mock("libram"),
      "grimoire-kolmafia": mock("grimoire-kolmafia"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
