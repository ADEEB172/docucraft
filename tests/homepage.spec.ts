import { expect, test } from "./coverageTest";

test("homepage loads the DocuCraft editor", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Document editor" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeDisabled();
});
