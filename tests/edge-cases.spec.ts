import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test, type Locator, type Page } from "./coverageTest";

async function createSamplePdf(pageCount = 1): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let pageNumber = 0; pageNumber < pageCount; pageNumber += 1) {
    document.addPage([612, 792]);
  }
  return Buffer.from(await document.save());
}

async function createPdfWithPageSizes(
  pageSizes: Array<[number, number]>,
): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const [width, height] of pageSizes) {
    document.addPage([width, height]);
  }
  return Buffer.from(await document.save());
}

async function createPng(
  page: Page,
  width: number,
  height: number,
  transparent = false,
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ width, height, transparent }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not create the watermark image fixture.");
      }

      context.fillStyle = "#286b63";
      if (transparent) {
        context.fillRect(0, 0, Math.floor(width / 2), height);
      } else {
        context.fillRect(0, 0, width, height);
      }

      return canvas.toDataURL("image/png");
    },
    { width, height, transparent },
  );

  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function openWatermarkMode(page: Page, pageCount = 1) {
  await openWatermarkModeWithPdf(
    page,
    await createSamplePdf(pageCount),
    pageCount,
  );
}

async function openWatermarkModeWithPdf(
  page: Page,
  pdfBytes: Buffer,
  pageCount: number,
) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "edge-case-test.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes,
  });
  await expect(page.getByLabel(`PDF page 1 of ${pageCount}`)).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();
}

async function addTextWatermark(page: Page, text: string) {
  await page.getByLabel("New watermark text").fill(text);
  await page.getByRole("button", { name: "Add text watermark" }).click();
  return page.locator('[role="group"][aria-label^="Text watermark:"]');
}

async function addImageWatermark(page: Page, image: Buffer) {
  await page.getByLabel("Upload a PNG or JPEG watermark image").setInputFiles({
    name: "watermark.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.getByAltText("Preview of the watermark image to add")).toBeVisible();
  await page.getByRole("button", { name: "Add image watermark" }).click();
  return page.getByRole("group", { name: "Image watermark" });
}

async function drag(
  page: Page,
  target: Locator,
  xChange: number,
  yChange: number,
  steps = 5,
) {
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("The watermark interaction target is not visible.");
  }

  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + xChange, startY + yChange, { steps });
  await page.mouse.up();
}

async function getPageBounds(page: Page) {
  return page.getByLabel(/PDF page \d+ of \d+/).evaluate((canvas) => {
    const bounds = canvas.parentElement?.getBoundingClientRect();
    if (!bounds) {
      throw new Error("The PDF page bounds are unavailable.");
    }

    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
    };
  });
}

async function downloadCurrentPdf(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The exported PDF download could not be read.");
  }

  return readFile(downloadPath);
}

async function getPdfPageText(pdfBytes: Buffer, pageNumber: number) {
  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  const textItems = content.items.filter(
    (item): item is typeof item & { str: string; transform: number[] } =>
      "str" in item,
  );
  const text = textItems.map((item) => item.str).join(" ");
  const positions = textItems.map((item) => ({
    x: item.transform[4],
    y: item.transform[5],
  }));

  await loadingTask.destroy();
  return { text, positions };
}

test("handles a reasonably large image watermark", async ({ page }) => {
  await openWatermarkMode(page);

  const largeImage = await createPng(page, 2048, 1536);
  const watermark = await addImageWatermark(page, largeImage);
  const image = watermark.getByAltText("Image watermark");

  await expect(watermark).toBeVisible();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(2048);
});

test("accepts very long watermark text without crashing", async ({ page }) => {
  await openWatermarkMode(page);

  const longText = "LONG-WATERMARK-".repeat(200);
  const watermark = await addTextWatermark(page, longText);

  await expect(watermark).toBeVisible();
  await expect(watermark).toContainText(longText);
  await expect(page.getByRole("heading", { name: "Document editor" })).toBeVisible();
});

test("does not add empty or whitespace-only watermark text", async ({ page }) => {
  await openWatermarkMode(page);
  const textInput = page.getByLabel("New watermark text");
  const addButton = page.getByRole("button", { name: "Add text watermark" });
  const watermarkList = page.locator('[aria-label="Page watermarks"] button');

  await textInput.fill("");
  await expect(addButton).toBeDisabled();
  await expect(watermarkList).toHaveCount(0);

  await textInput.fill("   ");
  await expect(addButton).toBeDisabled();
  await expect(watermarkList).toHaveCount(0);
});

test("keeps transparent pixels when using a transparent PNG watermark", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const transparentPng = await createPng(page, 40, 20, true);
  const watermark = await addImageWatermark(page, transparentPng);
  const alphaAtTransparentPixel = await watermark
    .getByAltText("Image watermark")
    .evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 20;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not inspect the transparent PNG.");
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return context.getImageData(30, 10, 1, 1).data[3];
    });

  await expect(watermark).toBeVisible();
  expect(alphaAtTransparentPixel).toBe(0);
});

test("limits watermark rotation to the supported 180-degree maximum", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "ROTATION LIMIT");
  const rotationHandle = page.getByRole("slider", { name: /Rotate watermark/ });

  for (let count = 0; count < 40; count += 1) {
    await rotationHandle.press("ArrowRight");
  }

  await expect(rotationHandle).toHaveAttribute("aria-valuenow", "180");
  await expect(watermark).toHaveAttribute("style", /rotate\(180deg\)/);
});

test("keeps a dragged watermark within the page instead of using negative coordinates", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "STAY ON PAGE");
  const targetBounds = await watermark.boundingBox();
  const pageBounds = await page.getByLabel("PDF page 1 of 1").evaluate((canvas) => {
    const bounds = canvas.parentElement?.getBoundingClientRect();
    if (!bounds) {
      throw new Error("The PDF page bounds are unavailable.");
    }

    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
    };
  });

  if (!targetBounds) {
    throw new Error("The watermark is not visible.");
  }

  const centerX = targetBounds.x + targetBounds.width / 2;
  const centerY = targetBounds.y + targetBounds.height / 2;
  await drag(
    page,
    watermark,
    pageBounds.left - centerX - 40,
    pageBounds.top - centerY - 40,
  );

  const movedBounds = await watermark.boundingBox();
  expect(movedBounds).not.toBeNull();
  if (movedBounds) {
    expect(movedBounds.x).toBeGreaterThanOrEqual(pageBounds.left - 1);
    expect(movedBounds.y).toBeGreaterThanOrEqual(pageBounds.top - 1);
    expect(movedBounds.x + movedBounds.width).toBeLessThanOrEqual(
      pageBounds.right + 1,
    );
    expect(movedBounds.y + movedBounds.height).toBeLessThanOrEqual(
      pageBounds.bottom + 1,
    );
  }
});

test("prevents an image watermark from shrinking below minimum size", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addImageWatermark(page, await createPng(page, 40, 20));
  const sizeControl = page.getByRole("slider", { name: /Image size/ });

  for (let count = 0; count < 40; count += 1) {
    await sizeControl.press("ArrowLeft");
  }

  await expect(sizeControl).toHaveValue("0.05");
  await expect(watermark).toHaveAttribute("style", /width:\s*5%/);
});

test("scales watermarks to their maximum supported sizes", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const textWatermark = await addTextWatermark(page, "MAXIMUM TEXT SIZE");
  const textSizeControl = page.getByRole("slider", { name: /Font size/ });
  await textSizeControl.fill("120");

  await expect(textSizeControl).toHaveValue("120");
  await expect(textWatermark).toHaveCSS("font-size", "120px");

  const imageWatermark = await addImageWatermark(
    page,
    await createPng(page, 40, 20),
  );
  const imageSizeControl = page.getByRole("slider", { name: /Image size/ });
  await imageSizeControl.fill("0.8");

  await expect(imageSizeControl).toHaveValue("0.8");
  await expect(imageWatermark).toHaveAttribute("style", /width:\s*80%/);
});

test("keeps two overlapping watermarks and lets the user select each one", async ({
  page,
}) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "OVERLAP FIRST");
  await addTextWatermark(page, "OVERLAP SECOND");
  const watermarkList = page.locator('[aria-label="Page watermarks"] button');

  await expect(watermarkList).toHaveCount(2);
  await expect(
    page.getByRole("group", { name: "Text watermark: OVERLAP FIRST" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: OVERLAP SECOND" }),
  ).toBeVisible();

  await watermarkList.filter({ hasText: "OVERLAP FIRST" }).click();
  await expect(
    watermarkList.filter({ hasText: "OVERLAP FIRST" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Watermark text", exact: true }).fill(
    "OVERLAP FIRST EDITED",
  );
  await expect(
    page.getByRole("group", { name: "Text watermark: OVERLAP FIRST EDITED" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: OVERLAP SECOND" }),
  ).toBeVisible();
});

test("keeps a dragged watermark inside the document boundary", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "BOUNDARY TEST");
  const boundsBeforeDrag = await watermark.boundingBox();
  const pageBounds = await getPageBounds(page);
  if (!boundsBeforeDrag) {
    throw new Error("The watermark is not visible.");
  }

  const centerX = boundsBeforeDrag.x + boundsBeforeDrag.width / 2;
  const centerY = boundsBeforeDrag.y + boundsBeforeDrag.height / 2;
  await drag(
    page,
    watermark,
    pageBounds.left - centerX - 50,
    pageBounds.top - centerY - 50,
  );

  const movedBounds = await watermark.boundingBox();
  expect(movedBounds).not.toBeNull();
  if (movedBounds) {
    expect(movedBounds.x).toBeGreaterThanOrEqual(pageBounds.left - 1);
    expect(movedBounds.y).toBeGreaterThanOrEqual(pageBounds.top - 1);
    expect(movedBounds.x + movedBounds.width).toBeLessThanOrEqual(
      pageBounds.right + 1,
    );
    expect(movedBounds.y + movedBounds.height).toBeLessThanOrEqual(
      pageBounds.bottom + 1,
    );
  }
});

test("keeps a watermark usable during rapid mouse dragging", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "RAPID DRAG");
  const originalPosition = await watermark.getAttribute("style");
  await drag(page, watermark, 90, 55, 40);
  const movedPosition = await watermark.getAttribute("style");

  await expect(watermark).toBeVisible();
  expect(movedPosition).not.toBe(originalPosition);
  await expect(
    page.getByRole("button", { name: "Delete selected watermark" }),
  ).toBeVisible();
});

test("refreshing during editing clears the unsaved PDF and watermark", async ({
  page,
}) => {
  await openWatermarkMode(page);
  const watermark = await addTextWatermark(page, "UNSAVED WATERMARK");
  await expect(watermark).toBeVisible();

  await page.reload();

  await expect(page.getByLabel("Choose a PDF")).toBeVisible();
  await expect(page.getByLabel("PDF page 1 of 1")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Watermark:/ })).toHaveCount(0);
});

test("keeps watermarks on their selected pages in a multi-page PDF", async ({
  page,
}) => {
  await openWatermarkMode(page, 2);

  const firstPageWatermark = await addTextWatermark(page, "PAGE ONE MARK");
  await expect(firstPageWatermark).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: PAGE ONE MARK" }),
  ).toHaveCount(0);

  const secondPageWatermark = await addTextWatermark(page, "PAGE TWO MARK");
  await expect(secondPageWatermark).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.getByLabel("PDF page 1 of 2")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: PAGE ONE MARK" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: PAGE TWO MARK" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: PAGE TWO MARK" }),
  ).toBeVisible();
});

test("exports a valid PDF when no watermark or signature was added", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const exportedBytes = await downloadCurrentPdf(page);
  const exportedPdf = await PDFDocument.load(exportedBytes);
  expect(exportedPdf.getPageCount()).toBe(1);
  expect(exportedPdf.getPage(0).getWidth()).toBe(612);
  expect(exportedPdf.getPage(0).getHeight()).toBe(792);

  const exportedPage = await getPdfPageText(exportedBytes, 1);
  expect(exportedPage.text).toBe("");
});

test("exports immediately after the PDF is ready", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "immediate-export.pdf",
    mimeType: "application/pdf",
    buffer: await createSamplePdf(),
  });
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeEnabled();

  const exportedBytes = await downloadCurrentPdf(page);
  const exportedPdf = await PDFDocument.load(exportedBytes);
  expect(exportedPdf.getPageCount()).toBe(1);
  expect(exportedPdf.getPage(0).getWidth()).toBe(612);
  expect(exportedPdf.getPage(0).getHeight()).toBe(792);
});

test("uses a fallback filename when the uploaded PDF has no basename", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: ".pdf",
    mimeType: "application/pdf",
    buffer: await createSamplePdf(),
  });
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("document-edited.pdf");

  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The fallback-named PDF download could not be read.");
  }
  const exportedPdf = await PDFDocument.load(await readFile(downloadPath));
  expect(exportedPdf.getPageCount()).toBe(1);
});

test("exports watermarks on their assigned pages", async ({ page }) => {
  await openWatermarkMode(page, 2);
  await addTextWatermark(page, "FIRST PAGE EXPORT");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await addTextWatermark(page, "SECOND PAGE EXPORT");

  const exportedBytes = await downloadCurrentPdf(page);
  const pageOne = await getPdfPageText(exportedBytes, 1);
  const pageTwo = await getPdfPageText(exportedBytes, 2);

  expect(pageOne.text).toContain("FIRST PAGE EXPORT");
  expect(pageOne.text).not.toContain("SECOND PAGE EXPORT");
  expect(pageTwo.text).toContain("SECOND PAGE EXPORT");
  expect(pageTwo.text).not.toContain("FIRST PAGE EXPORT");
  expect(pageOne.positions[0].x).toBeGreaterThan(0);
  expect(pageOne.positions[0].y).toBeGreaterThan(0);
  expect(pageTwo.positions[0].x).toBeGreaterThan(0);
  expect(pageTwo.positions[0].y).toBeGreaterThan(0);
});

test("exports a PDF whose pages have different dimensions", async ({ page }) => {
  await openWatermarkModeWithPdf(
    page,
    await createPdfWithPageSizes([
      [612, 792],
      [1000, 500],
    ]),
    2,
  );
  await addTextWatermark(page, "STANDARD PAGE");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await addTextWatermark(page, "WIDE PAGE");

  const exportedBytes = await downloadCurrentPdf(page);
  const exportedPdf = await PDFDocument.load(exportedBytes);
  expect(exportedPdf.getPageCount()).toBe(2);
  expect(exportedPdf.getPage(0).getWidth()).toBe(612);
  expect(exportedPdf.getPage(0).getHeight()).toBe(792);
  expect(exportedPdf.getPage(1).getWidth()).toBe(1000);
  expect(exportedPdf.getPage(1).getHeight()).toBe(500);

  const firstPage = await getPdfPageText(exportedBytes, 1);
  const secondPage = await getPdfPageText(exportedBytes, 2);
  expect(firstPage.text).toContain("STANDARD PAGE");
  expect(secondPage.text).toContain("WIDE PAGE");
  expect(secondPage.positions[0].x).toBeGreaterThan(0);
  expect(secondPage.positions[0].x).toBeLessThan(1000);
  expect(secondPage.positions[0].y).toBeGreaterThan(0);
  expect(secondPage.positions[0].y).toBeLessThan(500);
});

test("exports watermarks on portrait and landscape pages", async ({ page }) => {
  await openWatermarkModeWithPdf(
    page,
    await createPdfWithPageSizes([
      [612, 792],
      [792, 612],
    ]),
    2,
  );
  await addTextWatermark(page, "PORTRAIT MARK");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await addTextWatermark(page, "LANDSCAPE MARK");

  const exportedBytes = await downloadCurrentPdf(page);
  const exportedPdf = await PDFDocument.load(exportedBytes);
  expect(exportedPdf.getPageCount()).toBe(2);
  expect(exportedPdf.getPage(0).getWidth()).toBeLessThan(
    exportedPdf.getPage(0).getHeight(),
  );
  expect(exportedPdf.getPage(1).getWidth()).toBeGreaterThan(
    exportedPdf.getPage(1).getHeight(),
  );

  const portraitPage = await getPdfPageText(exportedBytes, 1);
  const landscapePage = await getPdfPageText(exportedBytes, 2);
  expect(portraitPage.text).toContain("PORTRAIT MARK");
  expect(landscapePage.text).toContain("LANDSCAPE MARK");
  expect(landscapePage.positions[0].x).toBeGreaterThan(0);
  expect(landscapePage.positions[0].x).toBeLessThan(792);
  expect(landscapePage.positions[0].y).toBeGreaterThan(0);
  expect(landscapePage.positions[0].y).toBeLessThan(612);
});
