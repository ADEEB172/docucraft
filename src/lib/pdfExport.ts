import {
  degrees,
  PDFDocument,
  rgb,
  StandardFonts,
} from "pdf-lib";
import type {
  ImageWatermark,
  Signature,
  Watermark,
} from "../components/pdf/PdfViewer";

function getPdfPosition(
  x: number,
  y: number,
  cropBox: { x: number; y: number; width: number; height: number },
  pageRotation: number,
) {
  let pdfX: number;
  let pdfY: number;

  // The editor stores the center as fractions of the visible page, measured
  // from its top-left. PDF pages use a bottom-left origin and can be rotated.
  switch (pageRotation) {
    case 0:
      pdfX = x * cropBox.width;
      pdfY = (1 - y) * cropBox.height;
      break;
    case 90:
      pdfX = y * cropBox.width;
      pdfY = x * cropBox.height;
      break;
    case 180:
      pdfX = (1 - x) * cropBox.width;
      pdfY = y * cropBox.height;
      break;
    case 270:
      pdfX = (1 - y) * cropBox.width;
      pdfY = (1 - x) * cropBox.height;
      break;
    default:
      throw new Error("This PDF page has an unsupported rotation.");
  }

  return {
    x: cropBox.x + pdfX,
    y: cropBox.y + pdfY,
  };
}

function getPdfColor(hexColor: string) {
  const colorMatch = /^#([0-9a-f]{6})$/i.exec(hexColor);

  if (!colorMatch) {
    throw new Error("A watermark has an invalid text color.");
  }

  const colorValue = colorMatch[1];
  const red = Number.parseInt(colorValue.slice(0, 2), 16) / 255;
  const green = Number.parseInt(colorValue.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(colorValue.slice(4, 6), 16) / 255;

  return rgb(red, green, blue);
}

function getPngBytes(imageData: string) {
  const imageParts = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(imageData);

  if (!imageParts) {
    throw new Error("A signature image is invalid. Please draw it again.");
  }

  const binaryData = atob(imageParts[1]);
  const imageBytes = new Uint8Array(binaryData.length);

  for (let index = 0; index < binaryData.length; index += 1) {
    imageBytes[index] = binaryData.charCodeAt(index);
  }

  return imageBytes;
}

function getWatermarkImageBytes(watermark: ImageWatermark) {
  const expectedPrefix = `data:${watermark.mimeType};base64,`;

  if (!watermark.imageData.startsWith(expectedPrefix)) {
    throw new Error("A watermark image is invalid. Upload it again.");
  }

  const base64Data = watermark.imageData.slice(expectedPrefix.length);

  if (!base64Data || !/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
    throw new Error("A watermark image is invalid. Upload it again.");
  }

  const binaryData = atob(base64Data);
  const imageBytes = new Uint8Array(binaryData.length);

  for (let index = 0; index < binaryData.length; index += 1) {
    imageBytes[index] = binaryData.charCodeAt(index);
  }

  return imageBytes;
}

export async function createWatermarkedPdf(
  file: File,
  watermarks: Watermark[],
  signatures: Signature[] = [],
): Promise<Uint8Array> {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  let pdfDocument: PDFDocument;

  try {
    pdfDocument = await PDFDocument.load(fileBytes);
  } catch (error) {
    console.error("Could not load the PDF for export:", error);
    throw new Error(
      "Could not export this PDF. It may be encrypted, malformed, or use unsupported PDF features.",
    );
  }

  const font = await pdfDocument.embedFont(StandardFonts.HelveticaBold);

  for (const watermark of watermarks) {
    const page = pdfDocument.getPage(watermark.pageNumber - 1);

    if (!page) {
      throw new Error(
        `A watermark refers to missing page ${watermark.pageNumber}.`,
      );
    }

    const cropBox = page.getCropBox();
    const pageRotation = ((page.getRotation().angle % 360) + 360) % 360;
    const center = getPdfPosition(
      watermark.x,
      watermark.y,
      cropBox,
      pageRotation,
    );

    if (watermark.type === "image") {
      let watermarkImage;

      try {
        const imageBytes = getWatermarkImageBytes(watermark);
        watermarkImage =
          watermark.mimeType === "image/png"
            ? await pdfDocument.embedPng(imageBytes)
            : await pdfDocument.embedJpg(imageBytes);
      } catch (error) {
        console.error("Could not embed watermark image:", error);
        throw new Error(
          "Could not add a watermark image to the exported PDF. Try another PNG or JPEG image.",
        );
      }

      if (!Number.isFinite(watermark.aspectRatio) || watermark.aspectRatio <= 0) {
        throw new Error("A watermark image has invalid dimensions.");
      }

      const visiblePageWidth =
        pageRotation === 90 || pageRotation === 270
          ? cropBox.height
          : cropBox.width;
      const visibleWidth = watermark.width * visiblePageWidth;
      const visibleHeight = visibleWidth / watermark.aspectRatio;
      const imageWidth =
        pageRotation === 90 || pageRotation === 270
          ? visibleHeight
          : visibleWidth;
      const imageHeight =
        pageRotation === 90 || pageRotation === 270
          ? visibleWidth
          : visibleHeight;
      // Match the text conversion: compensate for the page's rotation and
      // convert the user's clockwise screen angle to PDF drawing coordinates.
      const imageRotation = pageRotation - watermark.rotation;
      const radians = (imageRotation * Math.PI) / 180;
      const centerOffsetX =
        (imageWidth / 2) * Math.cos(radians) -
        (imageHeight / 2) * Math.sin(radians);
      const centerOffsetY =
        (imageWidth / 2) * Math.sin(radians) +
        (imageHeight / 2) * Math.cos(radians);

      page.drawImage(watermarkImage, {
        x: center.x - centerOffsetX,
        y: center.y - centerOffsetY,
        width: imageWidth,
        height: imageHeight,
        opacity: watermark.opacity,
        rotate: degrees(imageRotation),
      });
      continue;
    }

    try {
      font.encodeText(watermark.text);
    } catch {
      throw new Error(
        "A watermark contains characters the built-in Helvetica font cannot export. Use basic Latin characters and try again.",
      );
    }

    const displayScale = watermark.displayScale;

    if (!Number.isFinite(displayScale) || displayScale <= 0) {
      throw new Error("Could not determine the PDF preview scale.");
    }

    // The preview font size is measured in screen pixels. Divide by the
    // rendered page scale to get PDF page units.
    const fontSize = watermark.fontSize / displayScale;
    const textWidth = font.widthOfTextAtSize(watermark.text, fontSize);
    const textHeight = font.heightAtSize(fontSize);

    // CSS angles turn clockwise on screen; PDF angles turn counter-clockwise.
    // Subtracting the page rotation keeps the watermark aligned on rotated pages.
    const textRotation = pageRotation - watermark.rotation;
    const radians = (textRotation * Math.PI) / 180;
    const halfWidth = textWidth / 2;
    const halfHeight = textHeight / 2;
    const offsetX =
      halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians);
    const offsetY =
      halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians);

    page.drawText(watermark.text, {
      x: center.x - offsetX,
      y: center.y - offsetY,
      font,
      size: fontSize,
      color: getPdfColor(watermark.color),
      opacity: watermark.opacity,
      rotate: degrees(textRotation),
    });
  }

  for (const signature of signatures) {
    const page = pdfDocument.getPage(signature.pageNumber - 1);

    if (!page) {
      throw new Error(
        `A signature refers to missing page ${signature.pageNumber}.`,
      );
    }

    const cropBox = page.getCropBox();
    const pageRotation = ((page.getRotation().angle % 360) + 360) % 360;
    const center = getPdfPosition(
      signature.x,
      signature.y,
      cropBox,
      pageRotation,
    );
    if (signature.type === "text") {
      try {
        font.encodeText(signature.text);
      } catch {
        throw new Error(
          "A text signature contains characters the built-in Helvetica font cannot export. Use basic Latin characters and try again.",
        );
      }

      if (!Number.isFinite(signature.displayScale) || signature.displayScale <= 0) {
        throw new Error("Could not determine the PDF preview scale for a signature.");
      }

      const fontSize = signature.fontSize / signature.displayScale;
      const textWidth = font.widthOfTextAtSize(signature.text, fontSize);
      const textHeight = font.heightAtSize(fontSize);
      const textRotation = pageRotation - signature.rotation;
      const radians = (textRotation * Math.PI) / 180;
      const halfWidth = textWidth / 2;
      const halfHeight = textHeight / 2;
      const offsetX =
        halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians);
      const offsetY =
        halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians);

      page.drawText(signature.text, {
        x: center.x - offsetX,
        y: center.y - offsetY,
        font,
        size: fontSize,
        color: getPdfColor(signature.color),
        opacity: signature.opacity,
        rotate: degrees(textRotation),
      });
      continue;
    }

    const signatureImage = await pdfDocument.embedPng(
      getPngBytes(signature.imageData),
    );
    const visiblePageWidth =
      pageRotation === 90 || pageRotation === 270
        ? cropBox.height
        : cropBox.width;
    const visibleWidth = signature.width * visiblePageWidth;
    const visibleHeight =
      visibleWidth * (signatureImage.height / signatureImage.width);
    const imageWidth =
      pageRotation === 90 || pageRotation === 270
        ? visibleHeight
        : visibleWidth;
    const imageHeight =
      pageRotation === 90 || pageRotation === 270
        ? visibleWidth
        : visibleHeight;
    const imageRotation = pageRotation - signature.rotation;
    const radians = (imageRotation * Math.PI) / 180;
    const centerOffsetX =
      (imageWidth / 2) * Math.cos(radians) -
      (imageHeight / 2) * Math.sin(radians);
    const centerOffsetY =
      (imageWidth / 2) * Math.sin(radians) +
      (imageHeight / 2) * Math.cos(radians);

    page.drawImage(signatureImage, {
      x: center.x - centerOffsetX,
      y: center.y - centerOffsetY,
      width: imageWidth,
      height: imageHeight,
      opacity: signature.opacity,
      rotate: degrees(imageRotation),
    });
  }

  return pdfDocument.save();
}

export function downloadPdf(pdfBytes: Uint8Array, filename: string) {
  const pdfBlob = new Blob([Uint8Array.from(pdfBytes)]);
  const downloadUrl = URL.createObjectURL(pdfBlob);
  const downloadLink = document.createElement("a");

  downloadLink.href = downloadUrl;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);

  try {
    downloadLink.click();
  } finally {
    downloadLink.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 1000);
  }
}
