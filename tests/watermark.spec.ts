import { readFile } from "node:fs/promises";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { degrees, PDFDocument } from "pdf-lib";
import { expect, test, type Locator, type Page } from "./coverageTest";

async function createSamplePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return Buffer.from(await document.save());
}

async function createSamplePng(
  page: Page,
  color = "#286b63",
): Promise<Buffer> {
  const dataUrl = await page.evaluate((imageColor) => {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 16;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create the watermark image fixture.");
    }

    context.fillStyle = imageColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }, color);

  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function createSampleJpeg(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 16;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create the watermark JPEG fixture.");
    }

    context.fillStyle = "#286b63";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg");
  });

  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function openWatermarkMode(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "watermark-test.pdf",
    mimeType: "application/pdf",
    buffer: await createSamplePdf(),
  });
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();
}

async function addTextWatermark(page: Page, text: string) {
  await page.getByLabel("New watermark text").fill(text);
  await page.getByRole("button", { name: "Add text watermark" }).click();
  return page.getByRole("group", { name: `Text watermark: ${text}` });
}

async function addImageWatermark(page: Page) {
  await page.getByLabel("Upload a PNG or JPEG watermark image").setInputFiles({
    name: "watermark.png",
    mimeType: "image/png",
    buffer: await createSamplePng(page),
  });
  await page.getByRole("button", { name: "Add image watermark" }).click();
  return page.getByRole("group", { name: "Image watermark" });
}

async function drag(page: Page, target: Locator, xChange: number, yChange: number) {
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("The watermark interaction target is not visible.");
  }

  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + xChange, startY + yChange);
  await page.mouse.up();
}

async function exportSamplePdf(page: Page) {
  await openWatermarkMode(page);
  await addTextWatermark(page, "EXPORTSTAMP");
  await addImageWatermark(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  return downloadPromise;
}

test("1. Add text watermark", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "DRAFT COPY");
  await expect(watermark).toBeVisible();
  await expect(
    page.locator('[aria-label="Page watermarks"] button'),
  ).toContainText("DRAFT COPY");
});

test("2. Add image watermark", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addImageWatermark(page);
  await expect(watermark).toBeVisible();
  await expect(watermark.getByAltText("Image watermark")).toBeVisible();
});

test("adds a JPEG watermark and exports it as an image", async ({ page }) => {
  await openWatermarkMode(page);

  await page.getByLabel("Upload a PNG or JPEG watermark image").setInputFiles({
    name: "watermark.jpg",
    mimeType: "image/jpeg",
    buffer: await createSampleJpeg(page),
  });
  await page.getByRole("button", { name: "Add image watermark" }).click();
  await expect(page.getByRole("group", { name: "Image watermark" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The JPEG-watermarked PDF download could not be read.");
  }

  const pdfBytes = await readFile(downloadPath);
  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  const exportedPage = await document.getPage(1);
  const operators = await exportedPage.getOperatorList();
  expect(operators.fnArray).toContain(OPS.paintImageXObject);
  await loadingTask.destroy();
});

test("edits a text watermark's text, color, and opacity", async ({ page }) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "ORIGINAL TEXT");
  await page.getByLabel("Watermark text", { exact: true }).fill("UPDATED TEXT");
  const watermark = page.getByRole("group", {
    name: "Text watermark: UPDATED TEXT",
  });
  await page.getByLabel("Text color").fill("#ff0000");
  await page.getByLabel(/Opacity/).fill("0.7");

  await expect(watermark).toBeVisible();
  await expect(watermark).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(watermark).toHaveCSS("opacity", "0.7");
});

test("replaces an image watermark and updates its properties", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addImageWatermark(page);
  const image = watermark.getByAltText("Image watermark");
  const originalSource = await image.getAttribute("src");

  await page.getByLabel("Upload a PNG or JPEG watermark image").setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: await createSamplePng(page, "#a12b2b"),
  });
  await page.getByRole("button", { name: "Replace selected image" }).click();
  await page.getByLabel(/Image size/).fill("0.5");
  await page.getByLabel(/Opacity/).fill("0.35");
  await page.getByLabel(/Rotation/).fill("45");

  await expect(image).not.toHaveAttribute("src", originalSource ?? "");
  await expect(watermark).toHaveAttribute("style", /width:\s*50%/);
  await expect(watermark).toHaveCSS("opacity", "0.35");
  await expect(watermark).toHaveAttribute("style", /rotate\(45deg\)/);
});

test("edits a text watermark without changing an image watermark", async ({
  page,
}) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "TEXT TO EDIT");
  await addImageWatermark(page);
  await page.getByRole("button", { name: "Text 1: TEXT TO EDIT" }).click();
  await page.getByLabel("Watermark text", { exact: true }).fill("TEXT EDITED");
  await page.getByLabel(/Font size/).fill("48");
  await page.getByLabel(/Opacity/).fill("0.7");
  await page.getByLabel(/Rotation/).fill("30");

  await expect(
    page.getByRole("group", { name: "Text watermark: TEXT EDITED" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Image watermark" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Image 2" }).click();
  await expect(page.getByLabel(/Image size/)).toHaveValue("0.3");
  await expect(page.getByLabel(/Opacity/)).toHaveValue("0.6");
  await expect(page.getByLabel(/Rotation/)).toHaveValue("0");
});

test("updates only the selected text watermark", async ({ page }) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "FIRST TEXT");
  await addTextWatermark(page, "SECOND TEXT");
  await page.getByRole("button", { name: "Text 2: SECOND TEXT" }).click();
  await page.getByLabel("Watermark text", { exact: true }).fill("UPDATED TEXT");
  await page.getByLabel(/Font size/).fill("48");
  await page.getByLabel("Text color").fill("#ff0000");
  await page.getByLabel(/Opacity/).fill("0.7");
  await page.getByLabel(/Rotation/).fill("30");

  const firstWatermark = page.getByRole("group", {
    name: "Text watermark: FIRST TEXT",
  });
  const secondWatermark = page.getByRole("group", {
    name: "Text watermark: UPDATED TEXT",
  });
  await expect(firstWatermark).toBeVisible();
  await expect(firstWatermark).toHaveCSS("opacity", "0.4");
  await expect(firstWatermark).toHaveAttribute("style", /rotate\(0deg\)/);
  await expect(secondWatermark).toHaveCSS("font-size", "48px");
  await expect(secondWatermark).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(secondWatermark).toHaveCSS("opacity", "0.7");
  await expect(secondWatermark).toHaveAttribute("style", /rotate\(30deg\)/);
});

test("shows an error for an empty watermark image", async ({ page }) => {
  await openWatermarkMode(page);

  await page.getByLabel("Upload a PNG or JPEG watermark image").setInputFiles({
    name: "empty.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(0),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This image file is empty.",
  );
});

test("rejects a watermark image with an invalid header", async ({ page }) => {
  await openWatermarkMode(page);

  await page.getByLabel("Upload a PNG or JPEG watermark image").setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a PNG"),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "Choose a valid PNG, JPG, or JPEG image.",
  );
});

test("shows an error when a watermark image cannot be decoded", async ({
  page,
}) => {
  await openWatermarkMode(page);

  await page.getByLabel("Upload a PNG or JPEG watermark image").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This file is not a readable PNG or JPEG image.",
  );
});

test("selects a watermark from the page list", async ({ page }) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "FIRST IN LIST");
  await addTextWatermark(page, "SECOND IN LIST");
  const firstWatermark = page.getByRole("button", {
    name: "Text 1: FIRST IN LIST",
  });

  await firstWatermark.click();

  await expect(firstWatermark).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Watermark text", { exact: true })).toHaveValue(
    "FIRST IN LIST",
  );
});

test("selects a watermark after switching to E-Sign mode", async ({ page }) => {
  await openWatermarkMode(page);
  const watermark = await addTextWatermark(page, "SWITCH MODE");

  await page.getByRole("button", { name: "E-Sign" }).click();
  await watermark.click();

  await expect(
    page.getByRole("button", { name: "Watermark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Watermark text", { exact: true })).toHaveValue(
    "SWITCH MODE",
  );
});

test("shows a helpful message when watermark text cannot be exported", async ({
  page,
}) => {
  await openWatermarkMode(page);
  await addTextWatermark(page, "STAMP 🖋");

  await page.getByRole("button", { name: "Export PDF" }).click();

  await expect(page.locator("span[role='alert']")).toContainText(
    "A watermark contains characters the built-in Helvetica font cannot export.",
  );
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeEnabled();
});

test("exports watermarks on pages with each supported PDF rotation", async ({
  page,
}) => {
  const rotations = [0, 90, 180, 270];
  const sourcePdf = await PDFDocument.create();
  for (const rotation of rotations) {
    sourcePdf.addPage([612, 792]).setRotation(degrees(rotation));
  }

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "rotated-pages.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await sourcePdf.save()),
  });
  await expect(page.getByLabel("PDF page 1 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();

  for (const [index, rotation] of rotations.entries()) {
    await addTextWatermark(page, `ROTATED PAGE ${rotation}`);
    if (index < rotations.length - 1) {
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page.getByLabel(`PDF page ${index + 2} of 4`)).toBeVisible();
    }
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The rotated PDF download could not be read.");
  }

  const pdfBytes = await readFile(downloadPath);
  const exportedPdf = await PDFDocument.load(pdfBytes);
  expect(exportedPdf.getPageCount()).toBe(4);
  expect(exportedPdf.getPages().map((pdfPage) => pdfPage.getRotation().angle)).toEqual(
    rotations,
  );

  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  for (const [index, rotation] of rotations.entries()) {
    const exportedPage = await document.getPage(index + 1);
    const content = await exportedPage.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(text).toContain(`ROTATED PAGE ${rotation}`);

    const matchingItem = content.items.find(
      (item) => "str" in item && item.str.includes(`ROTATED PAGE ${rotation}`),
    );
    expect(matchingItem).toBeDefined();
    if (matchingItem && "transform" in matchingItem) {
      expect(Number.isFinite(matchingItem.transform[4])).toBe(true);
      expect(Number.isFinite(matchingItem.transform[5])).toBe(true);
    }
  }
  await loadingTask.destroy();
});

test("exports image watermarks on rotated PDF pages", async ({ page }) => {
  const rotations = [90, 270];
  const sourcePdf = await PDFDocument.create();
  for (const rotation of rotations) {
    sourcePdf.addPage([612, 792]).setRotation(degrees(rotation));
  }

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "rotated-image-watermarks.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await sourcePdf.save()),
  });
  await expect(page.getByLabel("PDF page 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();

  for (const [index, rotation] of rotations.entries()) {
    await addImageWatermark(page);
    if (index < rotations.length - 1) {
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page.getByLabel(`PDF page ${index + 2} of 2`)).toBeVisible();
    }
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The rotated image-watermarked PDF download could not be read.");
  }

  const pdfBytes = await readFile(downloadPath);
  const exportedPdf = await PDFDocument.load(pdfBytes);
  expect(exportedPdf.getPages().map((pdfPage) => pdfPage.getRotation().angle)).toEqual(
    rotations,
  );

  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  for (let pageNumber = 1; pageNumber <= rotations.length; pageNumber += 1) {
    const exportedPage = await document.getPage(pageNumber);
    const operators = await exportedPage.getOperatorList();
    expect(operators.fnArray).toContain(OPS.paintImageXObject);
  }
  await loadingTask.destroy();
});

test("3. Move watermark", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "MOVE THIS");
  const originalPosition = await watermark.getAttribute("style");
  await drag(page, watermark, 45, 30);
  await expect(watermark).not.toHaveAttribute("style", originalPosition ?? "");
});

test("moves a watermark with the keyboard arrows", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "KEYBOARD MOVE");
  await watermark.focus();

  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    const previousPosition = await watermark.getAttribute("style");
    await page.keyboard.press(key);
    await expect(watermark).not.toHaveAttribute(
      "style",
      previousPosition ?? "",
    );
  }

  const finalPosition = await watermark.getAttribute("style");
  await page.keyboard.press("Enter");
  await expect(watermark).toHaveAttribute("style", finalPosition ?? "");
});

test("4. Resize watermark", async ({ page }) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "RESIZE THIS");
  const resizeHandle = page.getByRole("slider", { name: /Resize watermark/ });
  const originalSize = Number(await resizeHandle.getAttribute("aria-valuenow"));

  await resizeHandle.press("ArrowRight");

  await expect(resizeHandle).toHaveAttribute(
    "aria-valuenow",
    String(originalSize + 2),
  );
});

test("reduces watermark size and rotation with the keyboard", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "KEYBOARD ADJUST");
  const resizeHandle = page.getByRole("slider", { name: /Resize watermark/ });
  const rotationHandle = page.getByRole("slider", {
    name: /Rotate watermark/,
  });
  const originalSize = Number(await resizeHandle.getAttribute("aria-valuenow"));

  await resizeHandle.press("ArrowLeft");
  await rotationHandle.press("ArrowDown");

  await expect(resizeHandle).toHaveAttribute(
    "aria-valuenow",
    String(originalSize - 2),
  );
  await expect(rotationHandle).toHaveAttribute("aria-valuenow", "-5");
  await expect(watermark).toHaveAttribute("style", /rotate\(-5deg\)/);
});

test("deselects a watermark when the PDF page is clicked", async ({ page }) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "DESELECT THIS");
  await expect(
    page.getByRole("slider", { name: /Resize watermark/ }),
  ).toBeVisible();

  await page.getByLabel("PDF page 1 of 1").click({ position: { x: 20, y: 20 } });

  await expect(
    page.getByRole("slider", { name: /Resize watermark/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete selected watermark" }),
  ).toHaveCount(0);
});

test("resizes an image watermark by dragging its pointer handle", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addImageWatermark(page);
  const originalWidth = await watermark.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const resizeHandle = page.getByRole("button", {
    name: "Resize image watermark",
  });
  const bounds = await resizeHandle.boundingBox();
  if (!bounds) {
    throw new Error("The image watermark resize handle is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 40, centerY, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(() =>
      watermark.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(originalWidth);
});

test("moves an image watermark by pointer dragging", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addImageWatermark(page);
  const originalPosition = await watermark.getAttribute("style");
  await drag(page, watermark, 45, 30);

  await expect(watermark).not.toHaveAttribute("style", originalPosition ?? "");
});

test("rotates an image watermark by dragging its pointer handle", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addImageWatermark(page);
  const rotationHandle = page.getByRole("slider", {
    name: /Rotate watermark/,
  });
  const bounds = await rotationHandle.boundingBox();
  if (!bounds) {
    throw new Error("The image watermark rotation handle is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 20, centerY + 20, { steps: 4 });
  await page.mouse.up();

  await expect(rotationHandle).not.toHaveAttribute("aria-valuenow", "0");
  await expect(watermark).not.toHaveAttribute("style", /rotate\(0deg\)/);
});

test("resizes a text watermark by dragging its pointer handle", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "POINTER RESIZE");
  const resizeHandle = page.getByRole("slider", { name: /Resize watermark/ });
  await resizeHandle.scrollIntoViewIfNeeded();

  const originalSize = Number(await resizeHandle.getAttribute("aria-valuenow"));
  const bounds = await resizeHandle.boundingBox();
  if (!bounds) {
    throw new Error("The watermark resize handle is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + 20, { steps: 4 });
  await page.mouse.up();

  await expect(resizeHandle).toHaveAttribute(
    "aria-valuenow",
    String(originalSize + 20),
  );
  await expect(watermark).toHaveCSS(
    "font-size",
    `${originalSize + 20}px`,
  );
});

test("rotates a text watermark by dragging its pointer handle", async ({
  page,
}) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "POINTER ROTATION");
  const rotationHandle = page.getByRole("slider", { name: /Rotate watermark/ });
  await rotationHandle.scrollIntoViewIfNeeded();

  const bounds = await rotationHandle.boundingBox();
  if (!bounds) {
    throw new Error("The watermark rotation handle is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 20, centerY + 20, { steps: 4 });
  await page.mouse.up();

  await expect(rotationHandle).not.toHaveAttribute("aria-valuenow", "0");
  await expect(watermark).not.toHaveAttribute("style", /rotate\(0deg\)/);
});

test("5. Rotate watermark", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "ROTATE THIS");
  const rotationHandle = page.getByRole("slider", { name: /Rotate watermark/ });
  await rotationHandle.press("ArrowRight");

  await expect(rotationHandle).toHaveAttribute("aria-valuenow", "5");
  await expect(watermark).toHaveAttribute("style", /rotate\(5deg\)/);
});

test("6. Delete watermark", async ({ page }) => {
  await openWatermarkMode(page);

  const watermark = await addTextWatermark(page, "DELETE THIS");
  await page.getByRole("button", { name: "Delete selected watermark" }).click();

  await expect(watermark).toHaveCount(0);
  await expect(page.locator('[aria-label="Page watermarks"] button')).toHaveCount(
    0,
  );
});

test("7. Add multiple text and image watermarks", async ({ page }) => {
  await openWatermarkMode(page);

  await addTextWatermark(page, "FIRST MARK");
  await addTextWatermark(page, "SECOND MARK");
  await addImageWatermark(page);

  await expect(page.locator('[aria-label="Page watermarks"] button')).toHaveCount(
    3,
  );
  await expect(
    page.getByRole("group", { name: "Text watermark: FIRST MARK" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: SECOND MARK" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Image watermark" })).toBeVisible();
});

test("8. Export document", async ({ page }) => {
  const download = await exportSamplePdf(page);
  const downloadPath = await download.path();

  expect(download.suggestedFilename()).toBe("watermark-test-edited.pdf");
  expect(downloadPath).not.toBeNull();
  if (downloadPath) {
    expect((await readFile(downloadPath)).length).toBeGreaterThan(0);
  }
});

test("9. Verify exported document contains watermarks", async ({ page }) => {
  const download = await exportSamplePdf(page);
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The exported PDF download could not be read.");
  }

  const pdfBytes = await readFile(downloadPath);
  const exportedPdf = await PDFDocument.load(pdfBytes);
  expect(exportedPdf.getPageCount()).toBe(1);

  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  const exportedPage = await document.getPage(1);
  const textContent = await exportedPage.getTextContent();
  const exportedText = textContent.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  expect(exportedText).toContain("EXPORTSTAMP");

  const operators = await exportedPage.getOperatorList();
  expect(operators.fnArray).toContain(OPS.paintImageXObject);
  await loadingTask.destroy();
});
