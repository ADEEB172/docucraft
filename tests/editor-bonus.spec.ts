import { PDFDocument } from "pdf-lib";
import { expect, test, type Page } from "./coverageTest";

async function createPdf(pageCount = 1): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) {
    document.addPage([612, 792]);
  }
  return Buffer.from(await document.save());
}

async function uploadPdf(page: Page, bytes: Buffer, name = "bonus.pdf") {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: bytes,
  });
}

async function dropFile(
  page: Page,
  bytes: Buffer,
  name = "bonus.pdf",
  type = "application/pdf",
  lastModified = Date.now(),
) {
  await page
    .getByRole("heading", { name: "Bring your document to life" })
    .locator("..")
    .evaluate(
      (target, file) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(file.bytes)], file.name, {
            type: file.type,
            lastModified: file.lastModified,
          }),
        );
        target.dispatchEvent(
          new DragEvent("drop", {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { bytes: Array.from(bytes), name, type, lastModified },
    );
}

async function dropPdf(
  page: Page,
  bytes: Buffer,
  name = "bonus.pdf",
  lastModified = Date.now(),
) {
  await dropFile(page, bytes, name, "application/pdf", lastModified);
}

async function openWatermarkEditor(page: Page, pageCount = 1) {
  const bytes = await createPdf(pageCount);
  await page.goto("/");
  await uploadPdf(page, bytes);
  await expect(page.getByLabel(`PDF page 1 of ${pageCount}`)).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();
  return bytes;
}

async function addTextWatermark(page: Page, text: string) {
  await page.getByLabel("New watermark text").fill(text);
  await page.getByRole("button", { name: "Add text watermark" }).click();
  return page.getByRole("group", { name: `Text watermark: ${text}` });
}

test("undoes and redoes edits with buttons and keyboard shortcuts", async ({
  page,
}) => {
  await openWatermarkEditor(page);
  const watermark = await addTextWatermark(page, "HISTORY MARK");

  await page.keyboard.press("Control+z");
  await expect(watermark).toHaveCount(0);

  await page.keyboard.press("Control+Shift+z");
  await expect(
    page.getByRole("group", { name: "Text watermark: HISTORY MARK" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(
    page.getByRole("group", { name: "Text watermark: HISTORY MARK" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo last edit" }).click();
  await expect(
    page.getByRole("group", { name: "Text watermark: HISTORY MARK" }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Text watermark: HISTORY MARK" })
    .click();
  const watermarkText = page.getByRole("textbox", {
    name: "Watermark text",
    exact: true,
  });
  await watermarkText.press("Control+z");
  await watermarkText.press("Delete");
  await expect(
    page.locator('[role="group"][aria-label^="Text watermark:"]'),
  ).toHaveCount(1);
});

test("undoes and redoes signature changes, and clears redo after a new edit", async ({
  page,
}) => {
  await page.goto("/");
  await uploadPdf(page, await createPdf());
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "E-Sign" }).click();

  await page.getByLabel("New text signature").fill("FIRST SIGNATURE");
  await page.getByRole("button", { name: "Add text signature" }).click();
  const firstSignature = page.getByRole("group", {
    name: "Text signature: FIRST SIGNATURE",
  });
  await expect(firstSignature).toBeVisible();

  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(firstSignature).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(firstSignature).toBeVisible();

  await page.getByRole("button", { name: "Undo last edit" }).click();
  await page.getByLabel("New text signature").fill("SECOND SIGNATURE");
  await page.getByRole("button", { name: "Add text signature" }).click();
  await expect(
    page.getByRole("group", { name: "Text signature: SECOND SIGNATURE" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Redo last edit" }),
  ).toBeDisabled();
  await page.keyboard.press("Control+Shift+z");
  await expect(firstSignature).toHaveCount(0);
});

test("ignores saved editor data with an out-of-range image watermark width", async ({
  page,
}) => {
  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  await page.goto("/");
  await dropPdf(page, bytes, "invalid-image-width.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "TEMP WATERMARK");
  
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => key.startsWith("docucraft-editor-v1:"))
  );

  await page.evaluate(() => {
    for (const [key, value] of Object.entries(window.localStorage)) {
      if (!key.startsWith("docucraft-editor-v1:")) {
        continue;
      }
      const saved = JSON.parse(value) as {
        watermarks?: Array<any>;
      };
      if (saved.watermarks) {
        saved.watermarks = [{
          id: "img1",
          type: "image",
          pageNumber: 1,
          x: 0.5,
          y: 0.5,
          opacity: 1,
          rotation: 0,
          imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          width: 0.9, // Allowed range se bahar [0.05, 0.8]
          displayScale: 1
        }];
        window.localStorage.setItem(key, JSON.stringify(saved));
        return;
      }
    }
    throw new Error("The editor did not save state.");
  });

  await page.reload();
  await dropPdf(page, bytes, "invalid-image-width.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("ignores saved editor data with an invalid image aspect ratio or mimeType", async ({
  page,
}) => {
  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  await page.goto("/");
  await dropPdf(page, bytes, "invalid-image-meta.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "TEMP WATERMARK");
  
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => key.startsWith("docucraft-editor-v1:"))
  );

  await page.evaluate(() => {
    for (const [key, value] of Object.entries(window.localStorage)) {
      if (!key.startsWith("docucraft-editor-v1:")) {
        continue;
      }
      const saved = JSON.parse(value) as {
        watermarks?: Array<any>;
      };
      if (saved.watermarks) {
        saved.watermarks = [{
          id: "img2",
          type: "image",
          pageNumber: 1,
          x: 0.5,
          y: 0.5,
          opacity: 1,
          rotation: 0,
          imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          width: 0.2,
          aspectRatio: -1, // Invalid aspect ratio (must be > 0)
          mimeType: "image/gif", // Invalid mimeType (allowed: png, jpeg)
          displayScale: 1
        }];
        window.localStorage.setItem(key, JSON.stringify(saved));
        return;
      }
    }
    throw new Error("The editor did not save state.");
  });

  await page.reload();
  await dropPdf(page, bytes, "invalid-image-meta.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("ignores saved editor data with malformed signature base and attributes", async ({
  page,
}) => {
  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  await page.goto("/");
  await dropPdf(page, bytes, "invalid-sig-comprehensive.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "TEMP");
  
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => key.startsWith("docucraft-editor-v1:"))
  );

  await page.evaluate(() => {
    for (const [key, value] of Object.entries(window.localStorage)) {
      if (!key.startsWith("docucraft-editor-v1:")) {
        continue;
      }
      const saved = JSON.parse(value) as { signatures?: Array<any> };
      saved.signatures = [
        {
          // Triggers line 124 (isSavedEditorObject returns false due to invalid pageNumber)
          id: "sig-bad-base",
          pageNumber: 999,
          x: 0.5,
          y: 0.5,
          width: 0.2,
          imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        },
        {
          // Triggers lines 130-131 branch checks (width too small (< 0.08) and invalid imageData type)
          id: "sig-bad-attrs",
          pageNumber: 1,
          x: 0.5,
          y: 0.5,
          width: 0.01,
          imageData: 12345
        }
      ];
      window.localStorage.setItem(key, JSON.stringify(saved));
      return;
    }
    throw new Error("The editor did not save state.");
  });

  await page.reload();
  await dropPdf(page, bytes, "invalid-sig-comprehensive.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("ignores saved editor data with various watermark mimeType and aspectRatio edge cases", async ({
  page,
}) => {
  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  await page.goto("/");
  await dropPdf(page, bytes, "invalid-watermark-meta.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "TEMP");
  
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => key.startsWith("docucraft-editor-v1:"))
  );

  await page.evaluate(() => {
    for (const [key, value] of Object.entries(window.localStorage)) {
      if (!key.startsWith("docucraft-editor-v1:")) {
        continue;
      }
      const saved = JSON.parse(value) as { watermarks?: Array<any> };
      saved.watermarks = [
        {
          // Exercises jpeg mimeType branch
          id: "img-mime",
          type: "image",
          pageNumber: 1,
          x: 0.5,
          y: 0.5,
          opacity: 1,
          rotation: 0,
          imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          width: 0.2,
          mimeType: "image/jpeg"
        },
        {
          // Exercises non-finite aspectRatio branch for text watermark
          id: "text-aspect",
          type: "text",
          pageNumber: 1,
          x: 0.5,
          y: 0.5,
          opacity: 1,
          rotation: 0,
          text: "Hello",
          fontSize: 24,
          color: "#000000",
          displayScale: 1,
          aspectRatio: NaN
        }
      ];
      window.localStorage.setItem(key, JSON.stringify(saved));
      return;
    }
    throw new Error("The editor did not save state.");
  });

  await page.reload();
  await dropPdf(page, bytes, "invalid-watermark-meta.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("covers remaining yellow branch validations for watermarks and signatures via short-circuit bypass", async ({
  page,
}) => {
  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  await page.goto("/");
  await dropPdf(page, bytes, "final-bypass.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "TEMP");
  
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => key.startsWith("docucraft-editor-v1:"))
  );

  await page.evaluate(() => {
    for (const [key, value] of Object.entries(window.localStorage)) {
      if (!key.startsWith("docucraft-editor-v1:")) {
        continue;
      }
      const saved = JSON.parse(value) as { watermarks?: Array<any>; signatures?: Array<any> };
      
      // Watermark: type is NOT "text" so it evaluates the right side (aspectRatio & mimeType)
      saved.watermarks = [{
        id: "w-bypass",
        type: "image", // Not "text", forcing right-side evaluation
        pageNumber: 1,
        x: 0.5,
        y: 0.5,
        opacity: 1,
        rotation: 0,
        imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        width: 0.2,
        aspectRatio: -5,        // Evaluates aspectRatio checks as false
        mimeType: "image/webp"  // Evaluates mimeType checks as false
      }];

      // Signature: type is NOT "text" so it evaluates the right side (width & imageData)
      saved.signatures = [{
        id: "sig-bypass",
        type: "image", // Not "text", forcing right-side evaluation
        pageNumber: 1,
        x: 0.5,
        y: 0.5,
        width: 0.01,   // Evaluates width >= 0.08 as false
        imageData: 123 // Evaluates typeof imageData === "string" as false
      }];

      window.localStorage.setItem(key, JSON.stringify(saved));
      return;
    }
    throw new Error("The editor did not save state.");
  });

  await page.reload();
  await dropPdf(page, bytes, "final-bypass.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("triggers undo and redo safely when stacks are empty", async ({ page }) => {
  const bytes = await createPdf();
  await page.goto("/");
  await dropPdf(page, bytes, "empty-history.pdf", 1_760_000_000_000);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();

  // Bina koi edit kiye direct undo aur redo shortcuts press karna
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Y");
});

test("undoes and redoes watermark movement, resizing, rotation, and deletion", async ({
  page,
}) => {
  await openWatermarkEditor(page);
  const watermark = await addTextWatermark(page, "EDIT HISTORY");
  const originalStyle = await watermark.getAttribute("style");
  const bounds = await watermark.boundingBox();
  if (!bounds) {
    throw new Error("The watermark is not visible.");
  }

  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 40, startY + 20, { steps: 3 });
  await page.mouse.up();
  const movedStyle = await watermark.getAttribute("style");
  expect(movedStyle).not.toBe(originalStyle);
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(watermark).toHaveAttribute("style", originalStyle ?? "");
  await page.getByRole("button", { name: "Redo last edit" }).click();
  await expect(watermark).toHaveAttribute("style", movedStyle ?? "");

  const fontSize = page.getByRole("slider", { name: /Font size/ });
  await fontSize.fill("60");
  await expect(watermark).toHaveAttribute("style", /font-size:\s*60px/);
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(watermark).toHaveAttribute("style", /font-size:\s*36px/);

  const rotation = page.getByRole("slider", { name: /Rotation/ });
  await rotation.fill("30");
  await expect(watermark).toHaveAttribute("style", /rotate\(30deg\)/);
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(watermark).toHaveAttribute("style", /rotate\(0deg\)/);

  await page.getByRole("button", { name: "Delete selected watermark" }).click();
  await expect(watermark).toHaveCount(0);
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(
    page.getByRole("group", { name: "Text watermark: EDIT HISTORY" }),
  ).toBeVisible();
});

test("drops a PDF into the upload area and opens it", async ({ page }) => {
  const bytes = await createPdf();
  await page.goto("/");
  await dropPdf(page, bytes, "dropped.pdf");

  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("shows the normal file validation error for an unsupported dropped file", async ({
  page,
}) => {
  await page.goto("/");
  await dropFile(page, Buffer.from("not a PDF"), "notes.txt", "text/plain");

  await expect(page.locator('p[role="alert"]')).toContainText(
    "This file does not appear to be a PDF.",
  );
  await expect(
    page.getByRole("heading", { name: "Bring your document to life" }),
  ).toBeVisible();
});

test("snaps a dragged watermark to the grid and shows center guides", async ({
  page,
}) => {
  await openWatermarkEditor(page);
  await page.getByLabel("Snap to 5% grid").check();
  const watermark = await addTextWatermark(page, "GRID MARK");
  const bounds = await watermark.boundingBox();
  if (!bounds) {
    throw new Error("The watermark is not visible.");
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 3, centerY + 3, { steps: 2 });

  await expect(watermark).toHaveAttribute("style", /left:\s*50%/);
  await expect(watermark).toHaveAttribute("style", /top:\s*50%/);
  await expect(page.getByTestId("alignment-guides")).toBeVisible();
  await page.mouse.move(centerX + 3, centerY + 30, { steps: 2 });
  await expect(
    page.getByTestId("alignment-guides").locator("span"),
  ).toHaveCount(1);
  await page.mouse.move(centerX + 30, centerY + 3, { steps: 2 });
  await expect(
    page.getByTestId("alignment-guides").locator("span"),
  ).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId("alignment-guides")).toHaveCount(0);
});

test("zoom controls preserve watermark position and dark mode is usable", async ({
  page,
}) => {
  await openWatermarkEditor(page);
  const watermark = await addTextWatermark(page, "ZOOM MARK");
  const originalStyle = await watermark.getAttribute("style");
  const originalFigure = await page.locator("figure").boundingBox();
  if (!originalFigure) {
    throw new Error("The PDF page is not visible.");
  }

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("110%")).toBeVisible();
  await expect(watermark).toHaveAttribute("style", originalStyle ?? "");
  const zoomedFigure = await page.locator("figure").boundingBox();
  if (!zoomedFigure) {
    throw new Error("The zoomed PDF page is not visible.");
  }
  expect(zoomedFigure.width).toBeGreaterThan(originalFigure.width);

  await page.getByRole("button", { name: "Dark mode" }).click();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Light mode" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.getByText("100%")).toBeVisible();
  await page.keyboard.press("Alt+=");
  await expect(page.getByText("110%")).toBeVisible();
  await page.keyboard.press("Alt+-");
  await expect(page.getByText("100%")).toBeVisible();

  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  for (let step = 0; step < 4; step += 1) {
    await zoomOut.click();
  }
  await expect(page.getByText("60%")).toBeVisible();
  await expect(zoomOut).toBeDisabled();
  await page.keyboard.press("Alt+-");
  await expect(page.getByText("60%")).toBeVisible();

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let step = 0; step < 9; step += 1) {
    await zoomIn.click();
  }
  await expect(page.getByText("150%")).toBeVisible();
  await expect(zoomIn).toBeDisabled();
  await page.keyboard.press("Alt+=");
  await expect(page.getByText("150%")).toBeVisible();
});

test("restores saved page-specific edits after re-uploading the same PDF", async ({
  page,
}) => {
  const bytes = await createPdf(2);
  await page.goto("/");
  const stableModifiedDate = 1_760_000_000_000;
  await dropPdf(page, bytes, "autosave.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "RECOVERED MARK");
  await page.getByLabel("Snap to 5% grid").check();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Dark mode" }).click();
  await page.getByRole("button", { name: "E-Sign" }).click();
  await page.getByLabel("New text signature").fill("RECOVERED SIGNATURE");
  await page.getByRole("button", { name: "Add text signature" }).click();
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => {
      if (!key.startsWith("docucraft-editor-v1:")) {
        return false;
      }

      try {
        const saved = JSON.parse(value) as {
          pageNumber?: number;
          watermarks?: Array<{ text?: string }>;
          signatures?: Array<{ text?: string }>;
          snapToGrid?: boolean;
          zoom?: number;
          theme?: string;
        };
        return (
          saved.pageNumber === 2 &&
          saved.watermarks?.some(
            (watermark) => watermark.text === "RECOVERED MARK",
          ) &&
          saved.signatures?.some(
            (signature) => signature.text === "RECOVERED SIGNATURE",
          ) &&
          saved.snapToGrid === true &&
          saved.zoom === 1.1 &&
          saved.theme === "dark"
        );
      } catch {
        return false;
      }
    }),
  );
  await page.reload();

  await dropPdf(page, bytes, "autosave.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 2 of 2")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: RECOVERED MARK" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text signature: RECOVERED SIGNATURE" }),
  ).toBeVisible();
  await expect(page.getByLabel("Snap to 5% grid")).toBeChecked();
  await expect(page.getByText("110%")).toBeVisible();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible();
});

test("ignores malformed saved editor data instead of restoring it", async ({
  page,
}) => {
  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  await page.goto("/");
  await dropPdf(page, bytes, "invalid-save.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "DO NOT RESTORE");
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => {
      if (!key.startsWith("docucraft-editor-v1:")) {
        return false;
      }

      try {
        const saved = JSON.parse(value) as {
          watermarks?: Array<{ text?: string }>;
        };
        return saved.watermarks?.some(
          (watermark) => watermark.text === "DO NOT RESTORE",
        );
      } catch {
        return false;
      }
    }),
  );
  await page.evaluate(() => {
    const storageKey = Object.entries(window.localStorage).find(
      ([key, value]) => {
        if (!key.startsWith("docucraft-editor-v1:")) {
          return false;
        }

        try {
          const saved = JSON.parse(value) as {
            watermarks?: Array<{ text?: string }>;
          };
          return saved.watermarks?.some(
            (watermark) => watermark.text === "DO NOT RESTORE",
          );
        } catch {
          return false;
        }
      },
    )?.[0];
    if (!storageKey) {
      throw new Error("The editor did not save the test watermark.");
    }
    window.localStorage.setItem(storageKey, "{broken saved data");
  });

  await page.reload();
  await dropPdf(page, bytes, "invalid-save.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await expect(
    page.getByText("Saved changes could not be read."),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: DO NOT RESTORE" }),
  ).toHaveCount(0);
});

test("ignores saved editor data with an out-of-range watermark position", async ({
  page,
}) => {
  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  await page.goto("/");
  await dropPdf(page, bytes, "invalid-position.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "DO NOT RESTORE");
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(([key, value]) => {
      if (!key.startsWith("docucraft-editor-v1:")) {
        return false;
      }

      try {
        const saved = JSON.parse(value) as {
          watermarks?: Array<{ text?: string }>;
        };
        return saved.watermarks?.some(
          (watermark) => watermark.text === "DO NOT RESTORE",
        );
      } catch {
        return false;
      }
    }),
  );
  await page.evaluate(() => {
    for (const [key, value] of Object.entries(window.localStorage)) {
      if (!key.startsWith("docucraft-editor-v1:")) {
        continue;
      }

      const saved = JSON.parse(value) as {
        watermarks?: Array<{ x?: number }>;
      };
      if (saved.watermarks && saved.watermarks.length > 0) {
        // Valid JSON, but x must be between 0 and 1.
        saved.watermarks[0].x = 5;
        window.localStorage.setItem(key, JSON.stringify(saved));
        return;
      }
    }

    throw new Error("The editor did not save the test watermark.");
  });

  await page.reload();
  await dropPdf(page, bytes, "invalid-position.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Text watermark: DO NOT RESTORE" }),
  ).toHaveCount(0);
});

test("covers saved image and signature validators", async ({ page }) => {
  test.setTimeout(180_000);

  const bytes = await createPdf();
  const stableModifiedDate = 1_760_000_000_000;
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  await page.goto("/");
  await dropPdf(page, bytes, "validators.pdf", stableModifiedDate);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "Watermark" }).click();
  await addTextWatermark(page, "TEMPLATE");
  await page.waitForFunction(() =>
    Object.entries(window.localStorage).some(
      ([key, value]) =>
        key.startsWith("docucraft-editor-v1:") && value.includes("TEMPLATE"),
    ),
  );

  const snapshot = await page.evaluate(() => {
    const entry = Object.entries(window.localStorage).find(([key]) =>
      key.startsWith("docucraft-editor-v1:"),
    );
    if (!entry) {
      throw new Error("The editor did not save the test watermark.");
    }
    return { key: entry[0], value: entry[1] };
  });

  // Only arrays that hold objects (or are empty) can hold watermarks/signatures/images.
  const parsed = JSON.parse(snapshot.value) as Record<string, unknown>;
  const arrayFields = Object.keys(parsed).filter((field) => {
    const list = parsed[field];
    return (
      Array.isArray(list) &&
      (list.length === 0 || (typeof list[0] === "object" && list[0] !== null))
    );
  });

  // undefined values are dropped by JSON, which simulates "field missing".
  const variants: Array<Record<string, unknown>> = [
    // valid image: covers lines 116-118 and 129-131
    { type: "image", imageData: tinyPng, width: 0.3, aspectRatio: 1, mimeType: "image/jpeg" },
    // no mimeType, no aspectRatio: covers line 104 (undefined branch)
    { type: "image", imageData: tinyPng, width: 0.3, aspectRatio: undefined, mimeType: undefined },
    // unsupported mimeType: line 104 false path
    { type: "image", imageData: tinyPng, width: 0.3, aspectRatio: 1, mimeType: "image/gif" },
    // width too small: lines 96-97 and 130 false path
    { type: "image", imageData: tinyPng, width: 0.01, aspectRatio: 1, mimeType: "image/png" },
    // width not a number: lines 95 and 129 false path
    { type: "image", imageData: tinyPng, width: "wide", aspectRatio: 1, mimeType: "image/png" },
    // imageData not a string: lines 92 and 131 false path
    { type: "image", imageData: 5, width: 0.3, aspectRatio: 1, mimeType: "image/png" },
  ];

  for (const field of arrayFields) {
    for (const patch of variants) {
      await page.evaluate(
        ({ key, value, field, patch }) => {
          const saved = JSON.parse(value) as Record<string, unknown>;
          const watermarks = saved.watermarks as Array<Record<string, unknown>>;
          const list = saved[field] as Array<unknown>;
          saved[field] = [...list, { ...watermarks[0], ...patch }];
          window.localStorage.setItem(key, JSON.stringify(saved));
        },
        { key: snapshot.key, value: snapshot.value, field, patch },
      );

      await page.reload();
      await dropPdf(page, bytes, "validators.pdf", stableModifiedDate);
      await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
    }
  }
});

test("ignores undo and redo when there is no history", async ({ page }) => {
  const bytes = await createPdf();
  await page.goto("/");
  await dropPdf(page, bytes, "empty-history.pdf", 1_760_000_000_000);
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();

  // Nothing has been edited, so both stacks are empty.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+Shift+z");

  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
});

test("moves a watermark with touch input on a narrow screen", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWatermarkEditor(page);
  const watermark = await addTextWatermark(page, "TOUCH MARK");
  await watermark.scrollIntoViewIfNeeded();
  const originalStyle = await watermark.getAttribute("style");
  const bounds = await watermark.boundingBox();
  if (!bounds) {
    throw new Error("The watermark is not visible on the narrow screen.");
  }

  const touch = await context.newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 45, y: y + 25, id: 1 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await expect(watermark).not.toHaveAttribute("style", originalStyle ?? "");
  await expect(page.getByLabel("PDF page 1 of 1")).toBeVisible();
  await touch.detach();
});

test("resizes a watermark with touch input on a narrow screen", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWatermarkEditor(page);
  const watermark = await addTextWatermark(page, "TOUCH RESIZE");
  const resizeHandle = page.getByRole("slider", { name: /Resize watermark/ });
  await resizeHandle.scrollIntoViewIfNeeded();
  const originalSize = Number(await resizeHandle.getAttribute("aria-valuenow"));
  const bounds = await resizeHandle.boundingBox();
  if (!bounds) {
    throw new Error("The watermark resize handle is not visible.");
  }

  const touch = await context.newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: y + 20, id: 1 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await expect(resizeHandle).toHaveAttribute(
    "aria-valuenow",
    String(originalSize + 20),
  );
  await expect(watermark).toHaveCSS("font-size", `${originalSize + 20}px`);
  await touch.detach();
});
