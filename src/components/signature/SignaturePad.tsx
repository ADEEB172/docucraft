"use client";

import { useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import Image from "next/image";
import styles from "./Signature.module.css";

type SignaturePadProps = {
  onUseSignature: (signatureImage: string) => void;
};

type UploadedSignature = {
  imageData: string;
  width: number;
  height: number;
};

export default function SignaturePad({ onUseSignature }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);
  const [uploadedSignature, setUploadedSignature] =
    useState<UploadedSignature | null>(null);
  const [message, setMessage] = useState("");

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();

    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");

    if (!context) {
      setMessage("The signature canvas is unavailable. Please reload the page.");
      return;
    }

    const point = getCanvasPoint(event);
    canvas.setPointerCapture(event.pointerId);

    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 5;
    context.strokeStyle = "#17212b";
    context.lineTo(point.x + 0.1, point.y + 0.1);
    context.stroke();

    setHasInk(true);
    setMessage("");
  }

  function continueDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;

    if (!canvas.hasPointerCapture(event.pointerId)) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      setMessage("The signature canvas is unavailable. Please reload the page.");
      return;
    }

    const point = getCanvasPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      setMessage("The signature canvas could not be cleared. Please reload the page.");
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setMessage("");
  }

  function useDrawing() {
    const canvas = canvasRef.current;

    if (!canvas || !hasInk) {
      setMessage("Draw your signature before applying it to the page.");
      return;
    }

    try {
      onUseSignature(canvas.toDataURL("image/png"));
      setMessage("");
    } catch (error) {
      console.error("Could not prepare the drawn signature:", error);
      setMessage("Could not use this signature. Please draw it again.");
    }
  }

  async function uploadSignature(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    if (file.size === 0) {
      setMessage("This image file is empty. Choose a PNG or JPEG image.");
      return;
    }

    if (
      file.type &&
      file.type !== "image/png" &&
      file.type !== "image/jpeg"
    ) {
      setMessage("Choose a PNG or JPEG image file.");
      return;
    }

    try {
      const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const isPng =
        header.length === 8 &&
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47 &&
        header[4] === 0x0d &&
        header[5] === 0x0a &&
        header[6] === 0x1a &&
        header[7] === 0x0a;
      const isJpeg =
        header.length >= 3 &&
        header[0] === 0xff &&
        header[1] === 0xd8 &&
        header[2] === 0xff;

      if (!isPng && !isJpeg) {
        setMessage("This file is not a valid PNG or JPEG image.");
        return;
      }

      // Decoding checks that the file is a complete, readable image.
      const image = await createImageBitmap(file);
      const maximumDimension = 2400;
      const resizeRatio = Math.min(
        1,
        maximumDimension / Math.max(image.width, image.height),
      );
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = Math.max(1, Math.round(image.width * resizeRatio));
      previewCanvas.height = Math.max(1, Math.round(image.height * resizeRatio));

      const context = previewCanvas.getContext("2d");
      if (!context) {
        image.close();
        throw new Error("Could not prepare this image.");
      }

      let imageData: string;
      try {
        // Drawing onto a transparent canvas keeps PNG transparency intact.
        context.drawImage(image, 0, 0, previewCanvas.width, previewCanvas.height);
        imageData = previewCanvas.toDataURL("image/png");
      } finally {
        image.close();
      }
      setUploadedSignature({
        imageData,
        width: previewCanvas.width,
        height: previewCanvas.height,
      });
      setMessage("");
    } catch (error) {
      console.error("Could not read the uploaded signature image:", error);
      setMessage("This image could not be opened. Choose another PNG or JPEG.");
    }
  }

  function useUploadedSignature() {
    if (!uploadedSignature) {
      setMessage("Upload a PNG or JPEG signature image first.");
      return;
    }

    try {
      onUseSignature(uploadedSignature.imageData);
      setMessage("");
    } catch (error) {
      console.error("Could not apply the uploaded signature:", error);
      setMessage("Could not use this signature. Please try again.");
    }
  }

  return (
    <div className={styles.signaturePad}>
      <div className={styles.uploadSection}>
        <label className={styles.uploadButton}>
          {uploadedSignature ? "Replace Signature Image" : "Upload Signature Image"}
          <input
            className={styles.uploadInput}
            type="file"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            aria-label="Upload a PNG or JPEG signature image"
            onChange={uploadSignature}
          />
        </label>
        {uploadedSignature && (
          <>
            <div className={styles.uploadPreview}>
              <Image
                src={uploadedSignature.imageData}
                alt="Preview of uploaded signature"
                width={uploadedSignature.width}
                height={uploadedSignature.height}
                unoptimized
              />
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={useUploadedSignature}
            >
              Use Uploaded Signature
            </button>
          </>
        )}
      </div>
      <p className={styles.instructions}>
        PNG or JPEG. PNG transparency is preserved.
      </p>
      <div className={styles.separator} aria-hidden="true">
        Or draw a signature
      </div>
      <p className={styles.instructions}>
        Draw your signature with a mouse or touchscreen.
      </p>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={600}
        height={200}
        aria-label="Signature drawing area"
        onPointerDown={startDrawing}
        onPointerMove={continueDrawing}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={clearDrawing}
        >
          Clear
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={useDrawing}
          disabled={!hasInk}
        >
          Use Signature
        </button>
      </div>
      <p
        className={styles.message}
        role={message ? "alert" : "status"}
        aria-live={message ? "assertive" : "polite"}
      >
        {message || (!hasInk ? "Draw a signature to enable Use Signature." : "")}
      </p>
    </div>
  );
}
