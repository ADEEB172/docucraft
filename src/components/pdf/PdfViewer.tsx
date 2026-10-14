
"use client";

import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Image from "next/image";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";

import styles from "./Pdf.module.css";

// PDF.js worker setup
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Props received from the parent component
type PdfViewerProps = {
  file: File | null;
  requestedPage: number;
  zoom: number;
  snapToGrid: boolean;
  onZoomChange: (zoom: number) => void;
  onInteractionStart: () => void;
  onDocumentLoaded: (pageCount: number, fingerprint: string) => void;
  onLoadStateChange: (isLoading: boolean) => void;
  onPageChange: (pageNumber: number) => void;
  onPageScaleChange: (pageNumber: number, scale: number) => void;
  watermarks: Watermark[];
  selectedWatermarkId: string | null;
  signatures: Signature[];
  selectedSignatureId: string | null;
  isWatermarkMode: boolean;
  isSignatureMode: boolean;
  onWatermarkPositionChange: (id: string, x: number, y: number) => void;
  onWatermarkSelect: (id: string) => void;
  onWatermarkDeselect: () => void;
  onWatermarkFontSizeChange: (id: string, fontSize: number) => void;
  onWatermarkImageSizeChange: (id: string, width: number) => void;
  onWatermarkRotationChange: (id: string, rotation: number) => void;
  onSignaturePositionChange: (id: string, x: number, y: number) => void;
  onSignatureSizeChange: (id: string, size: number) => void;
  onSignatureRotationChange: (id: string, rotation: number) => void;
  onSignatureSelect: (id: string) => void;
  onSignatureDeselect: () => void;
};

type WatermarkBase = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  opacity: number;
  rotation: number;
};

export type TextWatermark = WatermarkBase & {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
  displayScale: number;
};

export type ImageWatermark = WatermarkBase & {
  type: "image";
  imageData: string;
  mimeType: "image/png" | "image/jpeg";
  aspectRatio: number;
  width: number;
};

export type Watermark = TextWatermark | ImageWatermark;

type SignatureBase = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
};

export type SignatureImage = SignatureBase & {
  type: "image";
  imageData: string;
  width: number;
};

export type TextSignature = SignatureBase & {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
  displayScale: number;
};

export type Signature = SignatureImage | TextSignature;

// Check whether PDF.js stopped a task because it was cancelled
function isCancellationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortException" ||
      error.name === "RenderingCancelledException")
  );
}

export default function PdfViewer({
  file,
  requestedPage,
  zoom,
  snapToGrid,
  onZoomChange,
  onInteractionStart,
  onDocumentLoaded,
  onLoadStateChange,
  onPageChange,
  onPageScaleChange,
  watermarks,
  selectedWatermarkId,
  signatures,
  selectedSignatureId,
  isWatermarkMode,
  isSignatureMode,
  onWatermarkPositionChange,
  onWatermarkSelect,
  onWatermarkDeselect,
  onWatermarkFontSizeChange,
  onWatermarkImageSizeChange,
  onWatermarkRotationChange,
  onSignaturePositionChange,
  onSignatureSizeChange,
  onSignatureRotationChange,
  onSignatureSelect,
  onSignatureDeselect,
}: PdfViewerProps) {
  // Store the opened PDF
  const [pdfDocument, setPdfDocument] =
    useState<PDFDocumentProxy | null>(null);

  // Store the current page number
  const currentPage = requestedPage;

  // Track loading and rendering
  const [isLoading, setIsLoading] = useState(Boolean(file));
  const [isRendering, setIsRendering] = useState(false);
  const [alignmentGuides, setAlignmentGuides] = useState({
    vertical: false,
    horizontal: false,
  });

  // Store any error message
  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  // Reference to the HTML canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const watermarkRef = useRef<HTMLDivElement>(null);
  const signatureDragOffset = useRef({ x: 0, y: 0 });
  const signatureResizeStart = useRef<{
    id: string;
    pointerX: number;
    pointerY: number;
    size: number;
    isText: boolean;
  } | null>(null);
  const signatureRotationStart = useRef<{
    id: string;
    pointerAngle: number;
    rotation: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef<{
    id: string;
    pointerY: number;
    fontSize: number;
    x: number;
    y: number;
    width: number;
    height: number;
    pageWidth: number;
    pageHeight: number;
  } | null>(null);
  const imageResizeStart = useRef<{
    id: string;
    pointerX: number;
    width: number;
  } | null>(null);
  const rotationStart = useRef<{
    id: string;
    pointerAngle: number;
    rotation: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const selectedWatermark =
    watermarks.find((item) => item.id === selectedWatermarkId) ?? null;
  const selectedTextWatermark =
    selectedWatermark?.type === "text" ? selectedWatermark : null;

  function normalizePosition(value: number) {
    const bounded = Math.min(1, Math.max(0, value));
    if (!snapToGrid) {
      return bounded;
    }

    return Math.min(1, Math.max(0, Math.round(bounded / 0.05) * 0.05));
  }

  function updateAlignmentGuides(x: number, y: number) {
    setAlignmentGuides({
      vertical: Math.abs(x - 0.5) <= 0.02,
      horizontal: Math.abs(y - 0.5) <= 0.02,
    });
  }

  function clearAlignmentGuides() {
    setAlignmentGuides({ vertical: false, horizontal: false });
  }

  useLayoutEffect(() => {
    if (!selectedTextWatermark) {
      return;
    }

    const pageSurface = pageSurfaceRef.current;
    const watermarkElement = watermarkRef.current;

    if (!pageSurface || !watermarkElement) {
      return;
    }

    const pageBounds = pageSurface.getBoundingClientRect();
    const watermarkBounds = watermarkElement.getBoundingClientRect();

    if (!pageBounds.width || !pageBounds.height) {
      return;
    }

    const halfWidth = watermarkBounds.width / 2;
    const halfHeight = watermarkBounds.height / 2;
    const minimumX = Math.min(0.5, halfWidth / pageBounds.width);
    const maximumX = Math.max(0.5, 1 - halfWidth / pageBounds.width);
    const minimumY = Math.min(0.5, halfHeight / pageBounds.height);
    const maximumY = Math.max(0.5, 1 - halfHeight / pageBounds.height);
    const x = Math.min(
      maximumX,
      Math.max(minimumX, selectedTextWatermark.x),
    );
    const y = Math.min(
      maximumY,
      Math.max(minimumY, selectedTextWatermark.y),
    );

    // Center text that is too large to fit, instead of wrapping or clipping it.
    if (
      Math.abs(x - selectedTextWatermark.x) > 0.0001 ||
      Math.abs(y - selectedTextWatermark.y) > 0.0001
    ) {
      onWatermarkPositionChange(selectedTextWatermark.id, x, y);
    }
  }, [selectedTextWatermark, onWatermarkPositionChange]);

  // STEP 1: Load the selected PDF
  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadPdf() {
      if (!file) {
        return;
      }

      try {
        // Read the selected file
        const fileData = await file.arrayBuffer();

        if (cancelled) return;

        // Convert file data into bytes
        const pdfBytes = new Uint8Array(fileData);

        // Open the PDF using PDF.js
        loadingTask = getDocument({ data: pdfBytes });

        const document = await loadingTask.promise;

        if (cancelled) return;

        // Save the opened PDF
        setPdfDocument(document);
        onPageChange(1);
        setErrorMessage(null);
        setIsLoading(false);
        setIsRendering(true);

        // Inform the parent component
        onDocumentLoaded(document.numPages, document.fingerprints[0] ?? "");
        onLoadStateChange(false);
      } catch (error) {
        if (cancelled || isCancellationError(error)) {
          return;
        }

        console.error("PDF loading failed:", error);

        setErrorMessage(
          "Could not open this PDF. Please choose another file."
        );

        setIsLoading(false);
        setIsRendering(false);
        onLoadStateChange(false);
      }
    }

    void loadPdf();

    // Stop old loading work when the file changes
    return () => {
      cancelled = true;

      if (loadingTask) {
        void loadingTask.destroy().catch((error: unknown) => {
          if (!isCancellationError(error)) {
            console.error("PDF cleanup failed:", error);
          }
        });
      }
    };
  }, [file, onDocumentLoaded, onLoadStateChange, onPageChange]);

  // STEP 2: Draw the current page on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!pdfDocument || !canvas) {
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderPdfPage(
      document: PDFDocumentProxy,
      pageCanvas: HTMLCanvasElement,
    ) {
      try {
        // Get the selected page
        const page = await document.getPage(currentPage);

        if (cancelled) return;

        // Get the page size
        const viewport = page.getViewport({ scale: 1 });

        // Get the canvas drawing context
        const context = pageCanvas.getContext("2d");

        if (!context) {
          throw new Error("Canvas is not available.");
        }

        // Set the canvas dimensions
        pageCanvas.width = viewport.width;
        pageCanvas.height = viewport.height;

        // Ask PDF.js to draw the page
        renderTask = page.render({
          canvas: pageCanvas,
          canvasContext: context,
          viewport,
        });

        await renderTask.promise;

        if (!cancelled) {
          setErrorMessage(null);
          setIsRendering(false);
        }
      } catch (error) {
        if (cancelled || isCancellationError(error)) {
          return;
        }

        console.error("PDF rendering failed:", error);

        setErrorMessage(
          "Could not display this page. Try another page."
        );

        setIsRendering(false);
      }
    }

    void renderPdfPage(pdfDocument, canvas);

    // Stop rendering if the page changes or the viewer closes
    return () => {
      cancelled = true;

      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDocument, currentPage]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!pdfDocument || !canvas || isRendering) {
      return;
    }

    function reportPageScale() {
      if (!canvas || canvas.width === 0 || canvas.clientWidth === 0) {
        return;
      }

      onPageScaleChange(currentPage, canvas.clientWidth / canvas.width);
    }

    reportPageScale();

    const resizeObserver = new ResizeObserver(reportPageScale);
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
    };
  }, [pdfDocument, currentPage, isRendering, onPageScaleChange]);

  // STEP 3: Go to the previous page
  function showPreviousPage() {
    if (currentPage <= 1 || isRendering) {
      return;
    }

    setErrorMessage(null);
    setIsRendering(true);
    const previousPage = currentPage - 1;
    onPageChange(previousPage);
  }

  // STEP 4: Go to the next page
  function showNextPage() {
    if (!pdfDocument || isRendering) {
      return;
    }

    if (currentPage >= pdfDocument.numPages) {
      return;
    }

    setErrorMessage(null);
    setIsRendering(true);
    const nextPage = currentPage + 1;
    onPageChange(nextPage);
  }

  function startWatermarkDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    watermark: Watermark,
  ) {
    event.preventDefault();

    if (!isWatermarkMode) {
      onWatermarkSelect(watermark.id);
      return;
    }

    onInteractionStart();
    const watermarkButton = event.currentTarget;
    const buttonBounds = watermarkButton.getBoundingClientRect();

    dragOffset.current = {
      x: event.clientX - (buttonBounds.left + buttonBounds.width / 2),
      y: event.clientY - (buttonBounds.top + buttonBounds.height / 2),
    };

    watermarkButton.setPointerCapture(event.pointerId);
    onWatermarkSelect(watermark.id);
  }

  function moveWatermark(
    event: ReactPointerEvent<HTMLDivElement>,
    watermark: Watermark,
  ) {
    const pageSurface = pageSurfaceRef.current;

    if (!pageSurface || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }

    const pageBounds = pageSurface.getBoundingClientRect();
    const watermarkBounds = event.currentTarget.getBoundingClientRect();

    if (pageBounds.width === 0 || pageBounds.height === 0) {
      return;
    }

    const pointerX =
      event.clientX - dragOffset.current.x - pageBounds.left;
    const pointerY =
      event.clientY - dragOffset.current.y - pageBounds.top;

    const halfWatermarkWidth = watermarkBounds.width / 2;
    const halfWatermarkHeight = watermarkBounds.height / 2;
    const minimumX = Math.min(0.5, halfWatermarkWidth / pageBounds.width);
    const maximumX = Math.max(0.5, 1 - halfWatermarkWidth / pageBounds.width);
    const minimumY = Math.min(0.5, halfWatermarkHeight / pageBounds.height);
    const maximumY = Math.max(0.5, 1 - halfWatermarkHeight / pageBounds.height);

    const x = normalizePosition(
      Math.min(maximumX, Math.max(minimumX, pointerX / pageBounds.width)),
    );
    const y = normalizePosition(
      Math.min(maximumY, Math.max(minimumY, pointerY / pageBounds.height)),
    );

    updateAlignmentGuides(x, y);
    onWatermarkPositionChange(watermark.id, x, y);
  }

  function moveWatermarkWithKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
    watermark: Watermark,
  ) {
    if (!isWatermarkMode) {
      onWatermarkSelect(watermark.id);
      return;
    }

    const movement = 0.02;
    let x = watermark.x;
    let y = watermark.y;

    if (event.key === "ArrowLeft") {
      x -= movement;
    } else if (event.key === "ArrowRight") {
      x += movement;
    } else if (event.key === "ArrowUp") {
      y -= movement;
    } else if (event.key === "ArrowDown") {
      y += movement;
    } else {
      return;
    }

    event.preventDefault();
    onWatermarkSelect(watermark.id);
    onInteractionStart();
    const nextX = normalizePosition(x);
    const nextY = normalizePosition(y);
    updateAlignmentGuides(nextX, nextY);
    onWatermarkPositionChange(watermark.id, nextX, nextY);
  }

  function startWatermarkResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    watermark: TextWatermark,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const watermarkBounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const pageBounds = pageSurfaceRef.current?.getBoundingClientRect();

    if (!watermarkBounds || !pageBounds || !pageBounds.width || !pageBounds.height) {
      return;
    }

    onInteractionStart();
    resizeStart.current = {
      id: watermark.id,
      pointerY: event.clientY,
      fontSize: watermark.fontSize,
      x: watermark.x,
      y: watermark.y,
      width: watermarkBounds.width,
      height: watermarkBounds.height,
      pageWidth: pageBounds.width,
      pageHeight: pageBounds.height,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    onWatermarkSelect(watermark.id);
  }

  function resizeWatermark(event: ReactPointerEvent<HTMLButtonElement>) {
    const startingSize = resizeStart.current;

    if (!startingSize) {
      return;
    }

    const sizeChange = event.clientY - startingSize.pointerY;
    const newFontSize = Math.min(
      120,
      Math.max(12, startingSize.fontSize + sizeChange),
    );
    const sizeRatio = newFontSize / startingSize.fontSize;

    // Keep the old top-left position approximately fixed as text grows.
    const horizontalChange =
      (startingSize.width * (sizeRatio - 1)) / 2 / startingSize.pageWidth;
    const verticalChange =
      (startingSize.height * (sizeRatio - 1)) / 2 / startingSize.pageHeight;

    onWatermarkFontSizeChange(startingSize.id, newFontSize);
    onWatermarkPositionChange(
      startingSize.id,
      Math.min(1, Math.max(0, startingSize.x + horizontalChange)),
      Math.min(1, Math.max(0, startingSize.y + verticalChange)),
    );
  }

  function stopWatermarkResize() {
    resizeStart.current = null;
  }

  function startWatermarkRotation(
    event: ReactPointerEvent<HTMLButtonElement>,
    watermark: Watermark,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const watermarkBounds =
      event.currentTarget.parentElement?.getBoundingClientRect();

    if (!watermarkBounds) {
      return;
    }

    onInteractionStart();
    const centerX = watermarkBounds.left + watermarkBounds.width / 2;
    const centerY = watermarkBounds.top + watermarkBounds.height / 2;

    rotationStart.current = {
      id: watermark.id,
      pointerAngle:
        (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
        Math.PI,
      rotation: watermark.rotation,
      centerX,
      centerY,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    onWatermarkSelect(watermark.id);
  }

  function rotateWatermark(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = rotationStart.current;

    if (!start) {
      return;
    }

    const pointerAngle =
      (Math.atan2(event.clientY - start.centerY, event.clientX - start.centerX) *
        180) /
      Math.PI;
    let angleChange = pointerAngle - start.pointerAngle;

    // Keep the angle change short when the pointer crosses -180°/180°.
    if (angleChange > 180) {
      angleChange -= 360;
    } else if (angleChange < -180) {
      angleChange += 360;
    }

    const rotation = Math.min(
      180,
      Math.max(-180, start.rotation + angleChange),
    );

    onWatermarkRotationChange(start.id, rotation);
  }

  function stopWatermarkRotation() {
    rotationStart.current = null;
  }

  function rotateWatermarkWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    watermark: Watermark,
  ) {
    let change = 0;

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      change = 5;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      change = -5;
    } else {
      return;
    }

    event.preventDefault();
    onInteractionStart();
    event.stopPropagation();
    onWatermarkRotationChange(watermark.id,
      Math.min(180, Math.max(-180, watermark.rotation + change)),
    );
  }

  function resizeWatermarkWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    watermark: TextWatermark,
  ) {
    let sizeChange = 0;

    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      sizeChange = 2;
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      sizeChange = -2;
    } else {
      return;
    }

    event.preventDefault();
    onInteractionStart();
    event.stopPropagation();
    onWatermarkSelect(watermark.id);
    onWatermarkFontSizeChange(watermark.id,
      Math.min(120, Math.max(12, watermark.fontSize + sizeChange)),
    );
  }

  function startImageWatermarkResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    watermark: ImageWatermark,
  ) {
    event.preventDefault();
    event.stopPropagation();

    onInteractionStart();
    imageResizeStart.current = {
      id: watermark.id,
      pointerX: event.clientX,
      width: watermark.width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onWatermarkSelect(watermark.id);
  }

  function resizeImageWatermark(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = imageResizeStart.current;
    const pageBounds = pageSurfaceRef.current?.getBoundingClientRect();

    if (!start || !pageBounds?.width) {
      return;
    }

    const widthChange = (event.clientX - start.pointerX) / pageBounds.width;
    const width = Math.min(0.8, Math.max(0.05, start.width + widthChange));
    onWatermarkImageSizeChange(start.id, width);
  }

  function stopImageWatermarkResize() {
    imageResizeStart.current = null;
  }

  function startSignatureDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    signature: Signature,
  ) {
    event.preventDefault();

    if (!isSignatureMode) {
      onSignatureSelect(signature.id);
      return;
    }

    onInteractionStart();
    const signatureElement = event.currentTarget;
    const bounds = signatureElement.getBoundingClientRect();
    signatureDragOffset.current = {
      x: event.clientX - (bounds.left + bounds.width / 2),
      y: event.clientY - (bounds.top + bounds.height / 2),
    };

    signatureElement.setPointerCapture(event.pointerId);
    onSignatureSelect(signature.id);
  }

  function moveSignature(
    event: ReactPointerEvent<HTMLDivElement>,
    signature: Signature,
  ) {
    const pageSurface = pageSurfaceRef.current;

    if (
      !pageSurface ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return;
    }

    const pageBounds = pageSurface.getBoundingClientRect();
    const signatureBounds = event.currentTarget.getBoundingClientRect();

    if (!pageBounds.width || !pageBounds.height) {
      return;
    }

    const pointerX =
      event.clientX - signatureDragOffset.current.x - pageBounds.left;
    const pointerY =
      event.clientY - signatureDragOffset.current.y - pageBounds.top;
    const halfWidth = signatureBounds.width / 2;
    const halfHeight = signatureBounds.height / 2;
    const minimumX = Math.min(0.5, halfWidth / pageBounds.width);
    const maximumX = Math.max(0.5, 1 - halfWidth / pageBounds.width);
    const minimumY = Math.min(0.5, halfHeight / pageBounds.height);
    const maximumY = Math.max(0.5, 1 - halfHeight / pageBounds.height);
    const x = normalizePosition(
      Math.min(maximumX, Math.max(minimumX, pointerX / pageBounds.width)),
    );
    const y = normalizePosition(
      Math.min(maximumY, Math.max(minimumY, pointerY / pageBounds.height)),
    );

    updateAlignmentGuides(x, y);
    onSignaturePositionChange(signature.id, x, y);
  }

  function startSignatureResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    signature: Signature,
  ) {
    event.preventDefault();
    event.stopPropagation();

    onInteractionStart();
    signatureResizeStart.current = {
      id: signature.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      size: signature.type === "text" ? signature.fontSize : signature.width,
      isText: signature.type === "text",
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSignatureSelect(signature.id);
  }

  function resizeSignature(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = signatureResizeStart.current;
    const pageBounds = pageSurfaceRef.current?.getBoundingClientRect();

    if (!start || !pageBounds?.width) {
      return;
    }

    const change = start.isText
      ? event.clientY - start.pointerY
      : (event.clientX - start.pointerX) / pageBounds.width;
    const size = start.isText
      ? Math.min(120, Math.max(12, start.size + change))
      : Math.min(0.8, Math.max(0.08, start.size + change));
    onSignatureSizeChange(start.id, size);
  }

  function stopSignatureResize() {
    signatureResizeStart.current = null;
  }

  function startSignatureRotation(
    event: ReactPointerEvent<HTMLButtonElement>,
    signature: Signature,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    onInteractionStart();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    signatureRotationStart.current = {
      id: signature.id,
      pointerAngle:
        (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
        Math.PI,
      rotation: signature.rotation,
      centerX,
      centerY,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    onSignatureSelect(signature.id);
  }

  function rotateSignature(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = signatureRotationStart.current;
    if (!start) {
      return;
    }

    const currentAngle =
      (Math.atan2(event.clientY - start.centerY, event.clientX - start.centerX) *
        180) /
      Math.PI;
    let change = currentAngle - start.pointerAngle;

    if (change > 180) {
      change -= 360;
    } else if (change < -180) {
      change += 360;
    }

    onSignatureRotationChange(
      start.id,
      Math.min(180, Math.max(-180, start.rotation + change)),
    );
  }

  function stopSignatureRotation() {
    signatureRotationStart.current = null;
  }

  function rotateSignatureWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    signature: Signature,
  ) {
    let change = 0;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      change = 5;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      change = -5;
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onInteractionStart();
    onSignatureSelect(signature.id);
    onSignatureRotationChange(
      signature.id,
      Math.min(180, Math.max(-180, signature.rotation + change)),
    );
  }

  function moveSignatureWithKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
    signature: Signature,
  ) {
    if (!isSignatureMode) {
      onSignatureSelect(signature.id);
      return;
    }

    const step = 0.02;
    let x = signature.x;
    let y = signature.y;

    if (event.key === "ArrowLeft") {
      x -= step;
    } else if (event.key === "ArrowRight") {
      x += step;
    } else if (event.key === "ArrowUp") {
      y -= step;
    } else if (event.key === "ArrowDown") {
      y += step;
    } else {
      return;
    }

    event.preventDefault();
    onInteractionStart();
    onSignatureSelect(signature.id);
    onSignaturePositionChange(
      signature.id,
      Math.min(1, Math.max(0, x)),
      Math.min(1, Math.max(0, y)),
    );
  }

  function deselectWatermarkOnPage(event: ReactPointerEvent<HTMLDivElement>) {
    const clickedElement = event.target;

    if (
      clickedElement === event.currentTarget ||
      clickedElement === canvasRef.current
    ) {
      onWatermarkDeselect();
      onSignatureDeselect();
    }
  }

  // Total number of pages
  const pageCount = pdfDocument
    ? pdfDocument.numPages
    : 0;

  // STEP 5: Display the PDF and controls
  return (
    <div className={styles.viewer}>
      <div className={styles.pageViewport}>
        {isLoading && (
          <p
            className={styles.viewerMessage}
            role="status"
          >
            Loading PDF...
          </p>
        )}

        {errorMessage && !isLoading && (
          <p
            className={styles.viewerError}
            role="alert"
          >
            {errorMessage}
          </p>
        )}

        {pdfDocument && (
          <figure
            className={styles.pageFigure}
            style={{ transform: `scale(${zoom})` }}
          >
            <div
              className={styles.pageSurface}
              ref={pageSurfaceRef}
              onPointerDown={deselectWatermarkOnPage}
            >
              <canvas
                key={currentPage}
                ref={canvasRef}
                className={styles.pdfCanvas}
                hidden={Boolean(errorMessage)}
                aria-label={`PDF page ${currentPage} of ${pageCount}`}
              />
              {snapToGrid && (
                <div className={styles.snapGrid} aria-hidden="true" />
              )}
              {(alignmentGuides.vertical || alignmentGuides.horizontal) && (
                <div
                  className={styles.alignmentGuides}
                  data-testid="alignment-guides"
                  aria-hidden="true"
                >
                  {alignmentGuides.vertical && (
                    <span className={styles.verticalGuide} />
                  )}
                  {alignmentGuides.horizontal && (
                    <span className={styles.horizontalGuide} />
                  )}
                </div>
              )}
              {watermarks.some((item) => item.pageNumber === currentPage) ||
              signatures.some((item) => item.pageNumber === currentPage) ? (
                <div className={styles.watermarkLayer}>
                  {watermarks
                    .filter((item) => item.pageNumber === currentPage)
                    .map((watermark) => {
                      const isSelected = watermark.id === selectedWatermarkId;
                      const watermarkStyle = {
                        left: `${watermark.x * 100}%`,
                        top: `${watermark.y * 100}%`,
                        opacity: watermark.opacity,
                        transform: `translate(-50%, -50%) rotate(${watermark.rotation}deg)`,
                      };

                      if (watermark.type === "text") {
                        return (
                          <div
                            key={watermark.id}
                            className={`${styles.textWatermark} ${isSelected ? styles.selectedWatermark : ""}`}
                            ref={isSelected ? watermarkRef : null}
                            role="group"
                            aria-label={`Text watermark: ${watermark.text}`}
                            tabIndex={0}
                            onPointerDown={(event) =>
                              startWatermarkDrag(event, watermark)
                            }
                            onPointerMove={(event) =>
                              moveWatermark(event, watermark)
                            }
                            onPointerUp={clearAlignmentGuides}
                            onPointerCancel={clearAlignmentGuides}
                            onKeyDown={(event) =>
                              moveWatermarkWithKeyboard(event, watermark)
                            }
                            onDragStart={(event) => event.preventDefault()}
                            style={{
                              ...watermarkStyle,
                              color: watermark.color,
                              fontSize: `${watermark.fontSize}px`,
                            }}
                          >
                            {watermark.text}
                            {isSelected && (
                              <>
                                <button
                                  className={styles.resizeHandle}
                                  type="button"
                                  role="slider"
                                  tabIndex={0}
                                  aria-label={`Resize watermark, current font size ${watermark.fontSize} pixels. Use arrow keys to adjust.`}
                                  aria-valuemin={12}
                                  aria-valuemax={120}
                                  aria-valuenow={watermark.fontSize}
                                  aria-valuetext={`${watermark.fontSize} pixels`}
                                  onPointerDown={(event) =>
                                    startWatermarkResize(event, watermark)
                                  }
                                  onPointerMove={resizeWatermark}
                                  onPointerUp={stopWatermarkResize}
                                  onPointerCancel={stopWatermarkResize}
                                  onKeyDown={(event) =>
                                    resizeWatermarkWithKeyboard(event, watermark)
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                />
                                <button
                                  className={styles.rotationHandle}
                                  type="button"
                                  role="slider"
                                  tabIndex={0}
                                  aria-label={`Rotate watermark, current angle ${Math.round(watermark.rotation)} degrees. Use arrow keys to adjust.`}
                                  aria-valuemin={-180}
                                  aria-valuemax={180}
                                  aria-valuenow={Math.round(watermark.rotation)}
                                  aria-valuetext={`${Math.round(watermark.rotation)} degrees`}
                                  onPointerDown={(event) =>
                                    startWatermarkRotation(event, watermark)
                                  }
                                  onPointerMove={rotateWatermark}
                                  onPointerUp={stopWatermarkRotation}
                                  onPointerCancel={stopWatermarkRotation}
                                  onKeyDown={(event) =>
                                    rotateWatermarkWithKeyboard(event, watermark)
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                  style={{
                                    transform: `translate(-50%, -50%) rotate(${-watermark.rotation}deg)`,
                                  }}
                                >
                                  <span aria-hidden="true">↻</span>
                                </button>
                              </>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={watermark.id}
                          className={`${styles.imageWatermarkFrame} ${isSelected ? styles.selectedWatermark : ""}`}
                          role="group"
                          aria-label="Image watermark"
                          tabIndex={0}
                          onPointerDown={(event) =>
                            startWatermarkDrag(event, watermark)
                          }
                          onPointerMove={(event) =>
                            moveWatermark(event, watermark)
                          }
                          onPointerUp={clearAlignmentGuides}
                          onPointerCancel={clearAlignmentGuides}
                          onKeyDown={(event) =>
                            moveWatermarkWithKeyboard(event, watermark)
                          }
                          onDragStart={(event) => event.preventDefault()}
                          style={{
                            ...watermarkStyle,
                            width: `${watermark.width * 100}%`,
                          }}
                        >
                          <Image
                            className={styles.imageWatermark}
                            src={watermark.imageData}
                            alt="Image watermark"
                            width={600}
                            height={Math.max(
                              1,
                              Math.round(600 / watermark.aspectRatio),
                            )}
                            unoptimized
                            draggable={false}
                          />
                          {isSelected && (
                            <>
                              <button
                                className={styles.resizeHandle}
                                type="button"
                                aria-label="Resize image watermark"
                                onPointerDown={(event) =>
                                  startImageWatermarkResize(event, watermark)
                                }
                                onPointerMove={resizeImageWatermark}
                                onPointerUp={stopImageWatermarkResize}
                                onPointerCancel={stopImageWatermarkResize}
                                onClick={(event) => event.stopPropagation()}
                              />
                              <button
                                className={styles.rotationHandle}
                                type="button"
                                role="slider"
                                tabIndex={0}
                                aria-label={`Rotate watermark, current angle ${Math.round(watermark.rotation)} degrees. Use arrow keys to adjust.`}
                                aria-valuemin={-180}
                                aria-valuemax={180}
                                aria-valuenow={Math.round(watermark.rotation)}
                                aria-valuetext={`${Math.round(watermark.rotation)} degrees`}
                                onPointerDown={(event) =>
                                  startWatermarkRotation(event, watermark)
                                }
                                onPointerMove={rotateWatermark}
                                onPointerUp={stopWatermarkRotation}
                                onPointerCancel={stopWatermarkRotation}
                                onKeyDown={(event) =>
                                  rotateWatermarkWithKeyboard(event, watermark)
                                }
                                onClick={(event) => event.stopPropagation()}
                                style={{
                                  transform: `translate(-50%, -50%) rotate(${-watermark.rotation}deg)`,
                                }}
                              >
                                <span aria-hidden="true">↻</span>
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  {signatures
                    .filter((item) => item.pageNumber === currentPage)
                    .map((signature) => {
                      const isSelected =
                        signature.id === selectedSignatureId;
                      const signatureStyle = {
                        left: `${signature.x * 100}%`,
                        top: `${signature.y * 100}%`,
                        opacity: signature.opacity,
                        transform: `translate(-50%, -50%) rotate(${signature.rotation}deg)`,
                      };

                      return (
                        <div
                          key={signature.id}
                          className={`${signature.type === "text" ? styles.signatureTextFrame : styles.signatureFrame} ${isSelected ? styles.selectedSignature : ""}`}
                          role="group"
                          aria-label={
                            signature.type === "text"
                              ? `Text signature: ${signature.text}`
                              : "Image signature"
                          }
                          tabIndex={0}
                          onPointerDown={(event) =>
                            startSignatureDrag(event, signature)
                          }
                          onPointerMove={(event) =>
                            moveSignature(event, signature)
                          }
                          onPointerUp={clearAlignmentGuides}
                          onPointerCancel={clearAlignmentGuides}
                          onKeyDown={(event) =>
                            moveSignatureWithKeyboard(event, signature)
                          }
                          onDragStart={(event) => event.preventDefault()}
                          style={{
                            ...signatureStyle,
                            ...(signature.type === "image"
                              ? { width: `${signature.width * 100}%` }
                              : {
                                  fontSize: `${signature.fontSize}px`,
                                  color: signature.color,
                                }),
                          }}
                        >
                          {signature.type === "text" ? (
                            signature.text
                          ) : (
                            <Image
                              className={styles.signatureImage}
                              src={signature.imageData}
                              alt="Signature"
                              width={600}
                              height={200}
                              unoptimized
                              draggable={false}
                            />
                          )}
                          {isSelected && (
                            <>
                              <button
                                className={styles.signatureResizeHandle}
                                type="button"
                                aria-label={
                                  signature.type === "text"
                                    ? "Resize text signature"
                                    : "Resize image signature"
                                }
                                onPointerDown={(event) =>
                                  startSignatureResize(event, signature)
                                }
                                onPointerMove={resizeSignature}
                                onPointerUp={stopSignatureResize}
                                onPointerCancel={stopSignatureResize}
                                onClick={(event) => event.stopPropagation()}
                              />
                              <button
                                className={styles.signatureRotationHandle}
                                type="button"
                                role="slider"
                                tabIndex={0}
                                aria-label={`Rotate signature, current angle ${Math.round(signature.rotation)} degrees`}
                                aria-valuemin={-180}
                                aria-valuemax={180}
                                aria-valuenow={Math.round(signature.rotation)}
                                onPointerDown={(event) =>
                                  startSignatureRotation(event, signature)
                                }
                                onPointerMove={rotateSignature}
                                onPointerUp={stopSignatureRotation}
                                onPointerCancel={stopSignatureRotation}
                                onKeyDown={(event) =>
                                  rotateSignatureWithKeyboard(event, signature)
                                }
                                onClick={(event) => event.stopPropagation()}
                                style={{
                                  transform: `translate(-50%, -50%) rotate(${-signature.rotation}deg)`,
                                }}
                              >
                                <span aria-hidden="true">↻</span>
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </div>

            {isRendering && !errorMessage && (
              <figcaption
                className={styles.renderingMessage}
                role="status"
              >
                Rendering page...
              </figcaption>
            )}
          </figure>
        )}
      </div>

      <nav
        className={styles.pageNavigation}
        aria-label="PDF page navigation"
      >
        <button
          type="button"
          onClick={showPreviousPage}
          disabled={
            !pdfDocument ||
            currentPage <= 1 ||
            isRendering
          }
          aria-label="Previous page"
        >
          Previous
        </button>

        <button
          type="button"
          onClick={() =>
            onZoomChange(
              Math.max(0.6, Math.round((zoom - 0.1) * 10) / 10),
            )
          }
          disabled={!pdfDocument || zoom <= 0.6}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className={styles.pageCounter} aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() =>
            onZoomChange(
              Math.min(1.5, Math.round((zoom + 0.1) * 10) / 10),
            )
          }
          disabled={!pdfDocument || zoom >= 1.5}
          aria-label="Zoom in"
        >
          +
        </button>

        <span className={styles.pageCounter}>
          Page {pdfDocument ? currentPage : "—"} of{" "}
          {pdfDocument ? pageCount : "—"}
        </span>

        <button
          type="button"
          onClick={showNextPage}
          disabled={
            !pdfDocument ||
            currentPage >= pageCount ||
            isRendering
          }
          aria-label="Next page"
        >
          Next
        </button>
      </nav>
    </div>
  );
}
