import type { KnipConfig } from "knip";

// Entries: the library barrel, the demo entry (bundled by build-demo.ts and loaded by index.html), and the
// build script itself. Test files are ignored so their imports don't count as "usage" — otherwise an export
// used only by a test would read as live. Tradeoff: dead code within test files isn't detected, which is fine.
// ignoreExportsUsedInFile silences exports that are only used inside their own file (e.g. num.ts `sum`), which
// is noisy rather than actionable. python3 is the demo's static file server, not an npm binary.
const config: KnipConfig = {
  entry: ["demo/main.ts"], // src/index.ts (package "module") and build-demo.ts are auto-detected
  ignore: ["**/*.test.ts"],
  ignoreBinaries: ["python3"],
  ignoreExportsUsedInFile: true,
};

export default config;
