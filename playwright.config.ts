import { defineConfig, devices } from "@playwright/test";

const isCoverageRun = process.env.DOCUCRAFT_COVERAGE === "1";
const port = isCoverageRun ? 3001 : 3000;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
  },
  webServer: {
    command: `npm run dev -- --hostname localhost --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !isCoverageRun,
    timeout: 120_000,
  },
});
