import { PDFDocument } from "pdf-lib";
import { expect, test, type Page } from "./coverageTest";

async function createPdf(pageCount: number): Promise<Buffer> {
  const document = await PDFDocument.create();

  for (let pageNumber = 0; pageNumber < pageCount; pageNumber += 1) {
    document.addPage();
  }

  return Buffer.from(await document.save());
}

async function uploadPdf(page: Page, name: string, contents: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: contents,
  });
}

test("loads a valid PDF", async ({ page }) => {
  await page.goto("/");
  await uploadPdf(page, "one-page.pdf", await createPdf(1));

  await expect(
    page.getByRole("banner").getByRole("status"),
  ).toContainText("1 page loaded");
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("shows an error for a corrupted PDF", async ({ page }) => {
  await page.goto("/");
  await uploadPdf(
    page,
    "corrupted.pdf",
    Buffer.from("%PDF-1.7\nThis is not a complete PDF file."),
  );

  await expect(page.locator('p[role="alert"]')).toContainText(
    "Could not open this PDF.",
  );
  await expect(page.getByRole("heading", { name: "Document editor" })).toBeVisible();
});

test("shows an error when the selected PDF cannot be read", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(File.prototype, "slice", {
      configurable: true,
      value: function () {
        throw new Error("The file could not be read.");
      },
    });
  });

  await page.goto("/");
  await uploadPdf(page, "unreadable.pdf", await createPdf(1));

  await expect(page.locator("p[role='alert']")).toContainText(
    "The selected file could not be read.",
  );
  await expect(
    page.getByRole("banner").getByRole("status"),
  ).toContainText("No document open");
});

test("shows an accessible error when a PDF page cannot be rendered", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement) {
        if (this.getAttribute("aria-label")?.startsWith("PDF page ")) {
          return null;
        }

        return originalGetContext.call(this, "2d");
      },
    });
  });

  await page.goto("/");
  await uploadPdf(page, "cannot-render.pdf", await createPdf(1));

  await expect(page.locator("p[role='alert']")).toContainText(
    "Could not display this page.",
  );
  await expect(page.getByLabel("PDF page 1 of 1")).toBeHidden();
});

test("rejects an unsupported file type", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is not a PDF."),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This file does not appear to be a PDF.",
  );
  await expect(
    page.getByRole("banner").getByRole("status"),
  ).toContainText("No document open");
});

test("handles an empty file safely", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This file is empty.",
  );
  await expect(page.getByRole("heading", { name: "Document editor" })).toBeVisible();
});

test("loads a larger multi-page PDF", async ({ page }) => {
  await page.goto("/");
  await uploadPdf(page, "many-pages.pdf", await createPdf(40));

  await expect(
    page.getByRole("banner").getByRole("status"),
  ).toContainText("40 pages loaded");
  await expect(page.getByLabel("PDF page 1 of 40")).toBeVisible();
  await expect(page.locator('canvas[aria-label^="PDF page "]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 40")).toBeVisible();
  await expect(page.locator('canvas[aria-label^="PDF page "]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Previous page" })).toBeEnabled();
});

test("canceling file selection keeps the loaded PDF", async ({ page }) => {
  await page.goto("/");
  await uploadPdf(page, "keep-this.pdf", await createPdf(1));

  await expect(
    page.getByRole("banner").getByRole("status"),
  ).toContainText("1 page loaded");
  await page.locator('input[type="file"]').setInputFiles([]);

  await expect(
    page.getByRole("banner").getByRole("status"),
  ).toContainText("1 page loaded");
  await expect(page.getByText("keep-this.pdf")).toBeVisible();
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});
