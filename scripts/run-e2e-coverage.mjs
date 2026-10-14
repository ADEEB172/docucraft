import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
rmSync(join(process.cwd(), ".nyc_output"), { recursive: true, force: true });
rmSync(join(process.cwd(), "coverage", "e2e"), {
  recursive: true,
  force: true,
});

const result = spawnSync(process.execPath, [playwrightCli, "test"], {
  env: {
    ...process.env,
    DOCUCRAFT_COVERAGE: "1",
  },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  const unitTests = spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "run-pdf-export-unit-tests.mjs")],
    { stdio: "inherit" },
  );

  if (unitTests.error) {
    throw unitTests.error;
  }

  process.exitCode = unitTests.status ?? 1;
}
