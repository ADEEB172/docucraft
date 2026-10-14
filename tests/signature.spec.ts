import { readFile } from "node:fs/promises";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { degrees, PDFDocument } from "pdf-lib";
import { expect, test, type Page } from "./coverageTest";

async function createSamplePdf(pageCount = 1): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let pageNumber = 0; pageNumber < pageCount; pageNumber += 1) {
    document.addPage([612, 792]);
  }
  return Buffer.from(await document.save());
}

async function createSignaturePng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create the signature image fixture.");
    }

    context.fillStyle = "#17212b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  });

  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function createSignatureJpeg(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create the signature image fixture.");
    }

    context.fillStyle = "#17212b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg");
  });

  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function openSignatureMode(page: Page, pageCount = 1) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "signature-test.pdf",
    mimeType: "application/pdf",
    buffer: await createSamplePdf(pageCount),
  });
  await expect(page.getByLabel(`PDF page 1 of ${pageCount}`)).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "E-Sign" }).click();
}

async function addTextSignature(page: Page, text: string) {
  await page.getByLabel("New text signature").fill(text);
  await page.getByRole("button", { name: "Add text signature" }).click();
  return page.getByRole("group", { name: `Text signature: ${text}` });
}

async function addUploadedSignature(page: Page) {
  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "signature.png",
    mimeType: "image/png",
    buffer: await createSignaturePng(page),
  });
  await expect(page.getByAltText("Preview of uploaded signature")).toBeVisible();
  await page.getByRole("button", { name: "Use Uploaded Signature" }).click();
  return page.getByRole("group", { name: "Image signature" });
}

async function addDrawnSignature(page: Page) {
  const canvas = page.getByLabel("Signature drawing area");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("The signature drawing canvas is not visible.");
  }

  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, bounds.y + 65, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Use Signature" }).click();

  return page.getByRole("group", { name: "Image signature" });
}

async function exportSignedPdf(page: Page) {
  await openSignatureMode(page);
  await addTextSignature(page, "EXPORTSIGN");
  await addUploadedSignature(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  return downloadPromise;
}

async function downloadCurrentPdf(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("The signed PDF download could not be read.");
  }

  return readFile(downloadPath);
}

async function getPageText(pdfBytes: Buffer, pageNumber: number) {
  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  const pdfPage = await document.getPage(pageNumber);
  const content = await pdfPage.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");

  await loadingTask.destroy();
  return text;
}

test("1. Add text signature", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addTextSignature(page, "Signed by Alex");
  await expect(signature).toBeVisible();
  await expect(
    page.locator('[aria-label="Page signatures"] button'),
  ).toContainText("Signed by Alex");
});

test("does not add an empty or whitespace-only text signature", async ({
  page,
}) => {
  await openSignatureMode(page);

  const textInput = page.getByLabel("New text signature");
  const addButton = page.getByRole("button", { name: "Add text signature" });
  const signatureList = page.locator('[aria-label="Page signatures"] button');

  await textInput.fill("");
  await expect(addButton).toBeDisabled();
  await expect(signatureList).toHaveCount(0);

  await textInput.fill("   ");
  await expect(addButton).toBeDisabled();
  await expect(signatureList).toHaveCount(0);
});

test("2. Draw signature", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addDrawnSignature(page);
  await expect(signature).toBeVisible();
  await expect(signature.getByAltText("Signature")).toBeVisible();
});

test("requires drawing before applying a signature", async ({ page }) => {
  await openSignatureMode(page);

  await expect(
    page.getByRole("button", { name: "Use Signature" }),
  ).toBeDisabled();
  await expect(page.locator("p[role='status']")).toContainText(
    "Draw a signature to enable Use Signature.",
  );
  await expect(
    page.getByRole("group", { name: "Image signature" }),
  ).toHaveCount(0);
});

test("clears a drawn signature before applying it", async ({ page }) => {
  await openSignatureMode(page);

  const canvas = page.getByLabel("Signature drawing area");
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("The signature drawing canvas is not visible.");
  }

  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, bounds.y + 65, { steps: 5 });
  await page.mouse.up();

  const useButton = page.getByRole("button", { name: "Use Signature" });
  await expect(useButton).toBeEnabled();
  await page.getByRole("button", { name: "Clear" }).click();

  await expect(useButton).toBeDisabled();
  const hasInk = await canvas.evaluate((element) => {
    const drawingCanvas = element as HTMLCanvasElement;
    const context = drawingCanvas.getContext("2d");
    if (!context) {
      throw new Error("The signature drawing context is unavailable.");
    }

    return context
      .getImageData(0, 0, drawingCanvas.width, drawingCanvas.height)
      .data.some((value, index) => index % 4 === 3 && value > 0);
  });
  expect(hasInk).toBe(false);
});

test("reports an error if the signature canvas cannot be started", async ({
  page,
}) => {
  await openSignatureMode(page);

  const canvas = page.getByLabel("Signature drawing area");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate((element) => {
    Object.defineProperty(element, "getContext", { value: () => null });
  });
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("The signature drawing canvas is not visible.");
  }

  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.up();

  await expect(page.locator("p[role='alert']")).toContainText(
    "The signature canvas is unavailable.",
  );
});

test("reports an error if the signature canvas stops drawing", async ({
  page,
}) => {
  await openSignatureMode(page);

  const canvas = page.getByLabel("Signature drawing area");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("The signature drawing canvas is not visible.");
  }

  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await canvas.evaluate((element) => {
    Object.defineProperty(element, "getContext", { value: () => null });
  });
  await page.mouse.move(bounds.x + 150, bounds.y + 65);
  await page.mouse.up();

  await expect(page.locator("p[role='alert']")).toContainText(
    "The signature canvas is unavailable.",
  );
});

test("reports an error if the signature canvas cannot be cleared", async ({
  page,
}) => {
  await openSignatureMode(page);

  const canvas = page.getByLabel("Signature drawing area");
  await canvas.evaluate((element) => {
    Object.defineProperty(element, "getContext", { value: () => null });
  });
  await page.getByRole("button", { name: "Clear" }).click();

  await expect(page.locator("p[role='alert']")).toContainText(
    "The signature canvas could not be cleared.",
  );
});

test("reports an error if a drawn signature cannot be prepared", async ({
  page,
}) => {
  await openSignatureMode(page);

  const canvas = page.getByLabel("Signature drawing area");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("The signature drawing canvas is not visible.");
  }

  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, bounds.y + 65, { steps: 5 });
  await page.mouse.up();
  await canvas.evaluate((element) => {
    Object.defineProperty(element, "toDataURL", {
      value: () => {
        throw new Error("The signature could not be encoded.");
      },
    });
  });
  await page.getByRole("button", { name: "Use Signature" }).click();

  await expect(page.locator("p[role='alert']")).toContainText(
    "Could not use this signature.",
  );
  await expect(
    page.getByRole("group", { name: "Image signature" }),
  ).toHaveCount(0);
});

test("reports an error if an uploaded signature cannot be prepared", async ({
  page,
}) => {
  await openSignatureMode(page);
  const image = await createSignaturePng(page);

  await page.evaluate(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement) {
        if (this.width === 40 && this.height === 20) {
          return null;
        }
        return originalGetContext.call(this, "2d");
      },
    });
  });
  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "signature.png",
    mimeType: "image/png",
    buffer: image,
  });

  await expect(page.locator("p[role='alert']")).toContainText(
    "This image could not be opened.",
  );
  await expect(page.getByAltText("Preview of uploaded signature")).toHaveCount(
    0,
  );
});

test("reports an error if an uploaded signature cannot be applied", async ({
  page,
}) => {
  await openSignatureMode(page);
  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "signature.png",
    mimeType: "image/png",
    buffer: await createSignaturePng(page),
  });
  await expect(page.getByAltText("Preview of uploaded signature")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        throw new Error("The signature could not be created.");
      },
    });
  });
  await page.getByRole("button", { name: "Use Uploaded Signature" }).click();

  await expect(page.locator("p[role='alert']")).toContainText(
    "Could not use this signature.",
  );
  await expect(
    page.getByRole("group", { name: "Image signature" }),
  ).toHaveCount(0);
});

test("3. Upload signature image", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  await expect(signature).toBeVisible();
  await expect(signature.getByAltText("Signature")).toBeVisible();
});

test("uploads and applies a valid JPEG signature", async ({ page }) => {
  await openSignatureMode(page);

  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "signature.jpg",
    mimeType: "image/jpeg",
    buffer: await createSignatureJpeg(page),
  });

  await expect(page.getByAltText("Preview of uploaded signature")).toBeVisible();
  await page.getByRole("button", { name: "Use Uploaded Signature" }).click();

  const signature = page.getByRole("group", { name: "Image signature" });
  await expect(signature).toBeVisible();
  await expect(signature.getByAltText("Signature")).toBeVisible();
});

test("shows an accessible error for a malformed signature image", async ({
  page,
}) => {
  await openSignatureMode(page);

  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This image could not be opened.",
  );
  await expect(page.getByAltText("Preview of uploaded signature")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Use Uploaded Signature" }),
  ).toHaveCount(0);
});

test("shows an error when an empty signature image is uploaded", async ({
  page,
}) => {
  await openSignatureMode(page);

  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "empty.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(0),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This image file is empty.",
  );
});

test("rejects a signature upload with an unsupported file type", async ({
  page,
}) => {
  await openSignatureMode(page);

  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is not an image."),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "Choose a PNG or JPEG image file.",
  );
});

test("rejects an image upload with an invalid PNG header", async ({ page }) => {
  await openSignatureMode(page);

  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a PNG"),
  });

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This file is not a valid PNG or JPEG image.",
  );
});

test("resizes a large uploaded signature to fit the preview limit", async ({
  page,
}) => {
  await openSignatureMode(page);

  const largePng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 100;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create the large signature fixture.");
    }

    context.fillStyle = "#17212b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });

  await page.getByLabel("Upload a PNG or JPEG signature image").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.from(largePng, "base64"),
  });

  const preview = page.getByAltText("Preview of uploaded signature");
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(2400);
});

test("4. Move signature", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addTextSignature(page, "MOVE THIS SIGNATURE");
  const originalPosition = await signature.getAttribute("style");
  await signature.focus();
  await page.keyboard.press("ArrowRight");

  await expect(signature).not.toHaveAttribute("style", originalPosition ?? "");
});

test("moves a signature left, up, and down with the keyboard", async ({
  page,
}) => {
  await openSignatureMode(page);

  const signature = await addTextSignature(page, "KEYBOARD DIRECTIONS");
  await signature.focus();

  for (const key of ["ArrowLeft", "ArrowUp", "ArrowDown"]) {
    const previousPosition = await signature.getAttribute("style");
    await page.keyboard.press(key);
    await expect(signature).not.toHaveAttribute(
      "style",
      previousPosition ?? "",
    );
  }
});

test("5. Resize signature", async ({ page }) => {
  await openSignatureMode(page);

  await addTextSignature(page, "RESIZE THIS SIGNATURE");
  const sizeControl = page.getByRole("slider", { name: /Text size/ });
  const originalSize = Number(await sizeControl.inputValue());
  await sizeControl.fill(String(originalSize + 2));

  await expect(sizeControl).toHaveValue(String(originalSize + 2));
  await expect(
    page.getByRole("group", { name: "Text signature: RESIZE THIS SIGNATURE" }),
  ).toHaveCSS("font-size", `${originalSize + 2}px`);
});

test("resizes a text signature with its pointer handle", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addTextSignature(page, "POINTER RESIZE");
  const sizeControl = page.getByRole("slider", { name: /Text size/ });
  const originalSize = Number(await sizeControl.inputValue());
  const resizeHandle = page.getByRole("button", {
    name: "Resize text signature",
  });
  await resizeHandle.scrollIntoViewIfNeeded();

  const bounds = await resizeHandle.boundingBox();
  if (!bounds) {
    throw new Error("The text signature resize handle is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + 20, { steps: 4 });
  await page.mouse.up();

  await expect(sizeControl).toHaveValue(String(originalSize + 20));
  await expect(signature).toHaveCSS("font-size", `${originalSize + 20}px`);
});

test("edits a text signature's text, color, and opacity", async ({ page }) => {
  await openSignatureMode(page);

  await addTextSignature(page, "ORIGINAL SIGNATURE");
  await page.getByLabel("Signature text").fill("UPDATED SIGNATURE");
  const signature = page.getByRole("group", {
    name: "Text signature: UPDATED SIGNATURE",
  });
  await page.getByLabel("Text color").fill("#008000");
  await page.getByLabel(/Opacity/).fill("0.45");
  await page.getByLabel(/Rotation/).fill("35");

  await expect(signature).toBeVisible();
  await expect(signature).toHaveCSS("color", "rgb(0, 128, 0)");
  await expect(signature).toHaveCSS("opacity", "0.45");
  await expect(signature).toHaveAttribute("style", /rotate\(35deg\)/);
});

test("edits a text signature without changing an image signature", async ({
  page,
}) => {
  await openSignatureMode(page);

  await addTextSignature(page, "TEXT TO EDIT");
  await addUploadedSignature(page);
  await page.getByRole("button", { name: "Text 1: TEXT TO EDIT" }).click();
  await page.getByLabel("Signature text").fill("TEXT EDITED");
  await page.getByLabel(/Text size/).fill("42");
  await page.getByLabel("Text color").fill("#008000");
  await page.getByLabel(/Opacity/).fill("0.45");
  await page.getByLabel(/Rotation/).fill("35");

  await expect(
    page.getByRole("group", { name: "Text signature: TEXT EDITED" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Image signature" })).toBeVisible();

  await page.getByRole("button", { name: "Image signature 2" }).click();
  await expect(page.getByLabel(/Image size/)).toHaveValue("0.3");
  await expect(page.getByLabel(/Opacity/)).toHaveValue("1");
  await expect(page.getByLabel(/Rotation/)).toHaveValue("0");
});

test("updates only the selected text signature", async ({ page }) => {
  await openSignatureMode(page);

  await addTextSignature(page, "FIRST TEXT SIGNATURE");
  await addTextSignature(page, "SECOND TEXT SIGNATURE");
  await page
    .getByRole("button", { name: "Text 2: SECOND TEXT SIGNATURE" })
    .click();
  await page.getByLabel("Signature text").fill("UPDATED SIGNATURE");
  await page.getByLabel(/Text size/).fill("42");
  await page.getByLabel("Text color").fill("#008000");
  await page.getByLabel(/Opacity/).fill("0.45");
  await page.getByLabel(/Rotation/).fill("35");

  const firstSignature = page.getByRole("group", {
    name: "Text signature: FIRST TEXT SIGNATURE",
  });
  const secondSignature = page.getByRole("group", {
    name: "Text signature: UPDATED SIGNATURE",
  });
  await expect(firstSignature).toBeVisible();
  await expect(firstSignature).toHaveCSS("opacity", "1");
  await expect(firstSignature).toHaveAttribute("style", /rotate\(0deg\)/);
  await expect(secondSignature).toBeVisible();
  await expect(secondSignature).toHaveCSS("font-size", "42px");
  await expect(secondSignature).toHaveCSS("color", "rgb(0, 128, 0)");
  await expect(secondSignature).toHaveCSS("opacity", "0.45");
  await expect(secondSignature).toHaveAttribute("style", /rotate\(35deg\)/);
});

test("changes the opacity of an uploaded signature", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  await page.getByLabel(/Opacity/).fill("0.4");

  await expect(signature).toHaveCSS("opacity", "0.4");
});

test("selects a signature from the page list", async ({ page }) => {
  await openSignatureMode(page);

  await addTextSignature(page, "FIRST IN LIST");
  await addTextSignature(page, "SECOND IN LIST");
  const firstSignature = page.getByRole("button", {
    name: "Text 1: FIRST IN LIST",
  });

  await firstSignature.click();

  await expect(firstSignature).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Signature text")).toHaveValue("FIRST IN LIST");
});

test("selects a signature after switching to Watermark mode", async ({
  page,
}) => {
  await openSignatureMode(page);
  const signature = await addTextSignature(page, "SWITCH MODE");

  await page.getByRole("button", { name: "Watermark" }).click();
  await signature.scrollIntoViewIfNeeded();
  await signature.click();

  await expect(page.getByRole("button", { name: "E-Sign" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Signature text")).toHaveValue("SWITCH MODE");
});

test("shows a helpful message when signature text cannot be exported", async ({
  page,
}) => {
  await openSignatureMode(page);
  await addTextSignature(page, "SIGNATURE 🖋");

  await page.getByRole("button", { name: "Export PDF" }).click();

  await expect(page.locator("span[role='alert']")).toContainText(
    "A text signature contains characters the built-in Helvetica font cannot export.",
  );
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeEnabled();
});

test("6. Rotate signature", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addTextSignature(page, "ROTATE THIS SIGNATURE");
  const rotationHandle = page.getByRole("slider", { name: /Rotate signature/ });
  await rotationHandle.press("ArrowRight");

  await expect(rotationHandle).toHaveAttribute("aria-valuenow", "5");
  await expect(signature).toHaveAttribute("style", /rotate\(5deg\)/);
});

test("7. Delete signature", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addTextSignature(page, "DELETE THIS SIGNATURE");
  await page
    .getByRole("button", { name: "Delete selected signature" })
    .click();

  await expect(signature).toHaveCount(0);
  await expect(
    page.locator('[aria-label="Page signatures"] button'),
  ).toHaveCount(0);
});

test("8. Add multiple signatures", async ({ page }) => {
  await openSignatureMode(page);

  await addTextSignature(page, "FIRST SIGNATURE");
  await addTextSignature(page, "SECOND SIGNATURE");
  await addUploadedSignature(page);

  await expect(
    page.locator('[aria-label="Page signatures"] button'),
  ).toHaveCount(3);
  await expect(
    page.getByRole("group", { name: "Text signature: FIRST SIGNATURE" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text signature: SECOND SIGNATURE" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Image signature" })).toBeVisible();
});

test("9. Export signed document", async ({ page }) => {
  const download = await exportSignedPdf(page);
  const downloadPath = await download.path();

  expect(download.suggestedFilename()).toBe("signature-test-edited.pdf");
  expect(downloadPath).not.toBeNull();
  if (!downloadPath) {
    throw new Error("The signed PDF download could not be read.");
  }

  const pdfBytes = await readFile(downloadPath);
  const exportedPdf = await PDFDocument.load(pdfBytes);
  expect(exportedPdf.getPageCount()).toBe(1);

  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const pdfJsDocument = await loadingTask.promise;
  const exportedPage = await pdfJsDocument.getPage(1);
  const textContent = await exportedPage.getTextContent();
  const exportedText = textContent.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  expect(exportedText).toContain("EXPORTSIGN");

  const operators = await exportedPage.getOperatorList();
  expect(operators.fnArray).toContain(OPS.paintImageXObject);
  await loadingTask.destroy();
});

test("moves an uploaded image signature with the keyboard", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  const originalPosition = await signature.getAttribute("style");
  await signature.focus();
  await page.keyboard.press("ArrowRight");

  await expect(signature).not.toHaveAttribute("style", originalPosition ?? "");
  await expect(signature.getByAltText("Signature")).toBeVisible();
});

test("moves an uploaded image signature with pointer dragging", async ({
  page,
}) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  await signature.scrollIntoViewIfNeeded();

  const bounds = await signature.boundingBox();
  if (!bounds) {
    throw new Error("The uploaded signature is not visible.");
  }

  const originalPosition = await signature.getAttribute("style");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 80, centerY + 40, { steps: 5 });
  await page.mouse.up();

  await expect(signature).not.toHaveAttribute("style", originalPosition ?? "");
  await expect(signature.getByAltText("Signature")).toBeVisible();
});

test("resizes an uploaded image signature with its resize handle", async ({
  page,
}) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  const sizeControl = page.getByRole("slider", { name: /Image size/ });
  await sizeControl.fill("0.4");

  await expect(sizeControl).toHaveValue("0.4");
  await expect(signature).toHaveAttribute("style", /width:\s*40%/);
});

test("resizes an uploaded image signature by dragging its pointer handle", async ({
  page,
}) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  const resizeHandle = page.getByRole("button", {
    name: "Resize image signature",
  });
  await resizeHandle.scrollIntoViewIfNeeded();
  const originalWidth = await signature.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const bounds = await resizeHandle.boundingBox();
  if (!bounds) {
    throw new Error("The image signature resize handle is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 40, centerY, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(() =>
      signature.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(originalWidth);
});

test("rotates an uploaded image signature with the rotation handle", async ({
  page,
}) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  const rotationHandle = page.getByRole("slider", {
    name: /Rotate signature/,
  });
  await rotationHandle.press("ArrowRight");

  await expect(rotationHandle).toHaveAttribute("aria-valuenow", "5");
  await expect(signature).toHaveAttribute("style", /rotate\(5deg\)/);
});

test("rotates an uploaded image signature by dragging its pointer handle", async ({
  page,
}) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  const rotationHandle = page.getByRole("slider", {
    name: /Rotate signature/,
  });
  await rotationHandle.scrollIntoViewIfNeeded();
  const bounds = await rotationHandle.boundingBox();
  if (!bounds) {
    throw new Error("The image signature rotation handle is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 20, centerY + 20, { steps: 4 });
  await page.mouse.up();

  await expect(rotationHandle).not.toHaveAttribute("aria-valuenow", "0");
  await expect(signature).not.toHaveAttribute("style", /rotate\(0deg\)/);
});

test("deletes an uploaded image signature", async ({ page }) => {
  await openSignatureMode(page);

  const signature = await addUploadedSignature(page);
  await expect(
    page.locator('[aria-label="Page signatures"] button'),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Delete selected signature" })
    .click();

  await expect(signature).toHaveCount(0);
  await expect(
    page.locator('[aria-label="Page signatures"] button'),
  ).toHaveCount(0);
});

test("exports a drawn signature as an image in the PDF", async ({ page }) => {
  await openSignatureMode(page);
  const signature = await addDrawnSignature(page);
  await expect(signature.getByAltText("Signature")).toBeVisible();

  const pdfBytes = await downloadCurrentPdf(page);
  const exportedPdf = await PDFDocument.load(pdfBytes);
  expect(exportedPdf.getPageCount()).toBe(1);

  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  const exportedPage = await document.getPage(1);
  const operators = await exportedPage.getOperatorList();
  expect(operators.fnArray).toContain(OPS.paintImageXObject);
  await loadingTask.destroy();
});

test("exports signatures on their assigned PDF pages", async ({ page }) => {
  await openSignatureMode(page, 2);
  await addTextSignature(page, "FIRST PAGE SIGNATURE");

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await addTextSignature(page, "SECOND PAGE SIGNATURE");

  const pdfBytes = await downloadCurrentPdf(page);
  const exportedPdf = await PDFDocument.load(pdfBytes);
  expect(exportedPdf.getPageCount()).toBe(2);

  const firstPageText = await getPageText(pdfBytes, 1);
  const secondPageText = await getPageText(pdfBytes, 2);
  expect(firstPageText).toContain("FIRST PAGE SIGNATURE");
  expect(firstPageText).not.toContain("SECOND PAGE SIGNATURE");
  expect(secondPageText).toContain("SECOND PAGE SIGNATURE");
  expect(secondPageText).not.toContain("FIRST PAGE SIGNATURE");
});

test("exports image and text signatures on rotated PDF pages", async ({
  page,
}) => {
  const rotations = [0, 90, 180, 270];
  const sourcePdf = await PDFDocument.create();
  for (const rotation of rotations) {
    sourcePdf.addPage([612, 792]).setRotation(degrees(rotation));
  }

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "rotated-signatures.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await sourcePdf.save()),
  });
  await expect(page.getByLabel("PDF page 1 of 4")).toBeVisible();
  await page.getByRole("button", { name: "E-Sign" }).click();

  await addTextSignature(page, "TEXT ROTATION ZERO");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 4")).toBeVisible();
  await addUploadedSignature(page);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 3 of 4")).toBeVisible();
  await addTextSignature(page, "TEXT ROTATION 180");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 4 of 4")).toBeVisible();
  await addUploadedSignature(page);

  const pdfBytes = await downloadCurrentPdf(page);
  const exportedPdf = await PDFDocument.load(pdfBytes);
  expect(exportedPdf.getPageCount()).toBe(4);
  expect(exportedPdf.getPages().map((pdfPage) => pdfPage.getRotation().angle)).toEqual(
    rotations,
  );

  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes) });
  const document = await loadingTask.promise;
  for (const [index, expectedText] of [
    [0, "TEXT ROTATION ZERO"],
    [2, "TEXT ROTATION 180"],
  ] as const) {
    const exportedPage = await document.getPage(index + 1);
    const content = await exportedPage.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    expect(text).toContain(expectedText);
  }

  for (const pageNumber of [2, 4]) {
    const exportedPage = await document.getPage(pageNumber);
    const operators = await exportedPage.getOperatorList();
    expect(operators.fnArray).toContain(OPS.paintImageXObject);
  }
  await loadingTask.destroy();
});
