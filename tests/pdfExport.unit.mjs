import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWatermarkedPdf ,getPdfPosition } from "./.pdfExport.instrumented.mjs";

const sourcePath = resolve("src/lib/pdfExport.ts");
const coveragePath = resolve(".nyc_output/pdfExport-unit.json");
const samplePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1p8AAAAASUVORK5CYII=";

async function createPdfFile(contents) {
  let bytes = contents;

  if (!bytes) {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    bytes = await document.save();
  }

  return new File([bytes], "unit-test.pdf", { type: "application/pdf" });
}

function textWatermark(changes = {}) {
  return {
    id: "watermark",
    type: "text",
    text: "UNIT TEST",
    pageNumber: 1,
    x: 0.5,
    y: 0.5,
    fontSize: 36,
    color: "#344054",
    displayScale: 1,
    opacity: 1,
    rotation: 0,
    ...changes,
  };
}

function imageWatermark(changes = {}) {
  return {
    id: "watermark-image",
    type: "image",
    imageData: samplePng,
    mimeType: "image/png",
    aspectRatio: 1,
    width: 0.3,
    pageNumber: 1,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    rotation: 0,
    ...changes,
  };
}

function textSignature(changes = {}) {
  return {
    id: "signature",
    type: "text",
    text: "SIGNED",
    pageNumber: 1,
    x: 0.5,
    y: 0.5,
    fontSize: 30,
    color: "#17212b",
    displayScale: 1,
    opacity: 1,
    rotation: 0,
    ...changes,
  };
}

test("exports a PDF when the optional signatures argument is omitted", async () => {
  const bytes = await createWatermarkedPdf(await createPdfFile(), []);
  const exportedPdf = await PDFDocument.load(bytes);

  assert.equal(exportedPdf.getPageCount(), 1);
});

test("exports text watermarks and signatures into the PDF page", async () => {
  const bytes = await createWatermarkedPdf(
    await createPdfFile(),
    [textWatermark()],
    [textSignature()],
  );
  const loadingTask = getDocument({ data: Uint8Array.from(bytes) });

  try {
    const document = await loadingTask.promise;
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const exportedText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    assert.match(exportedText, /UNIT TEST/);
    assert.match(exportedText, /SIGNED/);
  } finally {
    await loadingTask.destroy();
  }
});

test("rejects a watermark that refers to a missing page", async () => {
  await assert.rejects(
    createWatermarkedPdf(
      await createPdfFile(),
      [{ ...textWatermark(), pageNumber: 5 }],
      [],
    ),
    /A watermark refers to missing page 5\./,
  );
});

test("rejects a watermark with page number 0", async () => {
  await assert.rejects(
    createWatermarkedPdf(
      await createPdfFile(),
      [{ ...textWatermark(), pageNumber: 0 }],
      [],
    ),
    /A watermark refers to missing page 0\./,
  );
});

test("rejects a signature that refers to a missing page", async () => {
  await assert.rejects(
    createWatermarkedPdf(
      await createPdfFile(),
      [],
      [{ ...textSignature(), pageNumber: 5 }],
    ),
    /A signature refers to missing page 5\./,
  );
});

test("rejects an unsupported page rotation", () => {
  assert.throws(
    () => getPdfPosition(0.5, 0.5, { x: 0, y: 0, width: 200, height: 400 }, 45),
    /This PDF page has an unsupported rotation\./,
  );
});

test("reports an error when the source PDF cannot be loaded", async (context) => {
  context.mock.method(console, "error", () => {});
  const invalidPdf = await createPdfFile(Buffer.from("not a PDF"));

  await assert.rejects(
    createWatermarkedPdf(invalidPdf, []),
    /Could not export this PDF/,
  );
});

test("rejects an invalid watermark text color", async () => {
  await assert.rejects(
    createWatermarkedPdf(await createPdfFile(), [
      textWatermark({ color: "blue" }),
    ]),
    /invalid text color/,
  );
});

test("rejects watermark image data with the wrong type prefix", async (context) => {
  context.mock.method(console, "error", () => {});
  await assert.rejects(
    createWatermarkedPdf(await createPdfFile(), [
      imageWatermark({ imageData: "data:text/plain;base64,AAAA" }),
    ]),
    /Could not add a watermark image/,
  );
});

test("rejects watermark image data with an empty or invalid base64 value", async (context) => {
  context.mock.method(console, "error", () => {});

  for (const imageData of [
    "data:image/png;base64,",
    "data:image/png;base64,%%% ",
  ]) {
    await assert.rejects(
      createWatermarkedPdf(await createPdfFile(), [
        imageWatermark({ imageData }),
      ]),
      /Could not add a watermark image/,
    );
  }
});

test("rejects image data that cannot be embedded as a PNG", async (context) => {
  context.mock.method(console, "error", () => {});
  await assert.rejects(
    createWatermarkedPdf(await createPdfFile(), [
      imageWatermark({ imageData: "data:image/png;base64,bm90cG5n" }),
    ]),
    /Could not add a watermark image/,
  );
});

test("rejects an image watermark with invalid dimensions", async () => {
  await assert.rejects(
    createWatermarkedPdf(await createPdfFile(), [
      imageWatermark({ aspectRatio: 0 }),
    ]),
    /invalid dimensions/,
  );
});

test("rejects a text watermark without a valid preview scale", async () => {
  await assert.rejects(
    createWatermarkedPdf(await createPdfFile(), [
      textWatermark({ displayScale: 0 }),
    ]),
    /preview scale/,
  );
});

test("rejects a signature image with invalid PNG data", async () => {
  const signature = {
    id: "image-signature",
    type: "image",
    imageData: "not a PNG data URL",
    width: 0.3,
    pageNumber: 1,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    rotation: 0,
  };

  await assert.rejects(
    createWatermarkedPdf(await createPdfFile(), [], [signature]),
    /signature image is invalid/,
  );
});

test("rejects a text signature without a valid preview scale", async () => {
  await assert.rejects(
    createWatermarkedPdf(
      await createPdfFile(),
      [],
      [textSignature({ displayScale: 0 })],
    ),
    /preview scale for a signature/,
  );
});

after(async () => {
  const coverage = globalThis.__coverage__?.[sourcePath];
  assert.ok(coverage, "Istanbul did not collect pdfExport.ts coverage");
  await mkdir(resolve(".nyc_output"), { recursive: true });
  await writeFile(coveragePath, JSON.stringify(globalThis.__coverage__));
});
