import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test as base } from "@playwright/test";

type CoverageData = Record<string, unknown>;

declare global {
  interface Window {
    __coverage__?: CoverageData;
  }
}

const coverageEnabled = process.env.DOCUCRAFT_COVERAGE === "1";
const coverageStorageKey = "__docucraft_e2e_coverage__";

export { expect };
export type { Locator, Page } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (coverageEnabled) {
      await page.addInitScript((storageKey) => {
        if (window.location.origin === "null") {
          return;
        }

        const previousCoverage = window.sessionStorage.getItem(storageKey);
        if (previousCoverage) {
          window.__coverage__ = JSON.parse(previousCoverage);
        }

        window.addEventListener("pagehide", () => {
          if (window.__coverage__) {
            window.sessionStorage.setItem(
              storageKey,
              JSON.stringify(window.__coverage__),
            );
          }
        });
      }, coverageStorageKey);
    }

    // Playwright fixture callbacks use `use` to provide a fixture value.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);

    if (!coverageEnabled) {
      return;
    }

    const coverage = await page.evaluate((storageKey) => {
      const savedCoverage = window.sessionStorage.getItem(storageKey);
      return (
        window.__coverage__ ??
        (savedCoverage ? JSON.parse(savedCoverage) : null)
      );
    }, coverageStorageKey);

    if (!coverage || Object.keys(coverage).length === 0) {
      throw new Error(
        "No Istanbul coverage was collected. Check the coverage build configuration.",
      );
    }

    const outputDirectory = join(process.cwd(), ".nyc_output");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      join(outputDirectory, `${testInfo.testId}-${testInfo.retry}.json`),
      JSON.stringify(coverage),
    );
  },
});
