"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import Image from "next/image";
import PdfUploader from "../components/pdf/PdfUploader";
import SignaturePad from "../components/signature/SignaturePad";
import PdfViewer, {
  type ImageWatermark,
  type SignatureImage,
  type Signature,
  type TextSignature,
  type TextWatermark,
  type Watermark,
} from "../components/pdf/PdfViewer";
import {
  deleteEditorStateFromIndexedDb,
  loadEditorStateFromIndexedDb,
  saveEditorStateToIndexedDb,
} from "../lib/editorStorage";
import { createWatermarkedPdf, downloadPdf } from "../lib/pdfExport";
import styles from "./page.module.css";

type EditorSnapshot = {
  watermarks: Watermark[];
  signatures: Signature[];
};

type Theme = "light" | "dark";

type SavedEditorState = EditorSnapshot & {
  version: 1;
  pageNumber: number;
  snapToGrid: boolean;
  zoom: number;
  theme: Theme;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStorageQuotaError(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function isSavedEditorObject(
  value: unknown,
  pageCount: number,
): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isInteger(value.pageNumber) ||
    Number(value.pageNumber) < 1 ||
    Number(value.pageNumber) > pageCount ||
    typeof value.x !== "number" ||
    !Number.isFinite(value.x) ||
    value.x < 0 ||
    value.x > 1 ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.y) ||
    value.y < 0 ||
    value.y > 1 ||
    typeof value.opacity !== "number" ||
    !Number.isFinite(value.opacity) ||
    value.opacity < 0 ||
    value.opacity > 1 ||
    typeof value.rotation !== "number" ||
    !Number.isFinite(value.rotation) ||
    value.rotation < -180 ||
    value.rotation > 180
  ) {
    return false;
  }

  if (value.type === "text") {
    return (
      typeof value.text === "string" &&
      value.text.length > 0 &&
      typeof value.fontSize === "number" &&
      Number.isFinite(value.fontSize) &&
      value.fontSize >= 12 &&
      value.fontSize <= 120 &&
      typeof value.color === "string" &&
      /^#[0-9a-f]{6}$/i.test(value.color) &&
      typeof value.displayScale === "number" &&
      Number.isFinite(value.displayScale) &&
      value.displayScale >= 0
    );
  }

  return (
    value.type === "image" &&
    typeof value.imageData === "string" &&
    value.imageData.startsWith("data:image/") &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width >= 0.05 &&
    value.width <= 0.8 &&
    (typeof value.aspectRatio === "undefined" ||
      (typeof value.aspectRatio === "number" &&
        Number.isFinite(value.aspectRatio) &&
        value.aspectRatio > 0)) &&
    (value.mimeType === "image/png" ||
      value.mimeType === "image/jpeg" ||
      typeof value.mimeType === "undefined")
  );
}

function isSavedWatermark(value: unknown, pageCount: number): boolean {
  if (!isSavedEditorObject(value, pageCount)) {
    return false;
  }

  return (
    value.type === "text" ||
    (typeof value.aspectRatio === "number" &&
      Number.isFinite(value.aspectRatio) &&
      value.aspectRatio > 0 &&
      (value.mimeType === "image/png" || value.mimeType === "image/jpeg"))
  );
}

function isSavedSignature(value: unknown, pageCount: number): boolean {
  if (!isSavedEditorObject(value, pageCount)) {
    return false;
  }

  return (
    value.type === "text" ||
    (typeof value.width === "number" &&
      value.width >= 0.08 &&
      typeof value.imageData === "string")
  );
}

function isSavedEditorState(
  value: unknown,
  pageCount: number,
): value is SavedEditorState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Number.isInteger(value.pageNumber) &&
    Number(value.pageNumber) >= 1 &&
    Number(value.pageNumber) <= pageCount &&
    typeof value.snapToGrid === "boolean" &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.zoom) &&
    value.zoom >= 0.6 &&
    value.zoom <= 1.5 &&
    (value.theme === "light" || value.theme === "dark") &&
    Array.isArray(value.watermarks) &&
    value.watermarks.every((item) => isSavedWatermark(item, pageCount)) &&
    Array.isArray(value.signatures) &&
    value.signatures.every((item) => isSavedSignature(item, pageCount))
  );
}

function getSavedStateKey(file: File, fingerprint: string): string {
  return `docucraft-editor-v1:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}:${fingerprint}`;
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M9 4.75h9.2L25 11.5v15.75H9a2 2 0 0 1-2-2v-18.5a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M18 5v7h6M12 17h8M12 21h8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function WatermarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 18.5h14M7.5 15l8-8 3.5 3.5-8 8H7.5V15Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m14 8.5 3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SignatureIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 17.5c2.3 0 3.1-8 5.1-8 2.5 0-1.7 8 .6 8 1.2 0 2.5-3.5 3.5-3.5.9 0 .2 3.5 1.5 3.5 1.1 0 1.5-2 2.8-2 1 0 1.4 1 2.5 1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [documentFingerprint, setDocumentFingerprint] = useState<string | null>(
    null,
  );
  const [pageCount, setPageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isWatermarkMode, setIsWatermarkMode] = useState(false);
  const [selectedWatermarkId, setSelectedWatermarkId] = useState<string | null>(
    null,
  );
  const [isSignatureMode, setIsSignatureMode] = useState(false);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(
    null,
  );
  const [newSignatureText, setNewSignatureText] = useState("");
  const [watermarkText, setWatermarkText] = useState("");
  const [watermarks, setWatermarks] = useState<Watermark[]>([]);
  const [pendingImage, setPendingImage] = useState<{
    imageData: string;
    mimeType: "image/png" | "image/jpeg";
    aspectRatio: number;
  } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [pageScales, setPageScales] = useState<Record<number, number>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [theme, setTheme] = useState<Theme>("light");
  const [autosaveMessage, setAutosaveMessage] = useState("");
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const undoStack = useRef<EditorSnapshot[]>([]);
  const redoStack = useRef<EditorSnapshot[]>([]);
  const restoredDocumentKey = useRef<string | null>(null);
  const indexedDbKeys = useRef(new Set<string>());

  const updateHistoryAvailability = useCallback(() => {
    setHistoryAvailability({
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    });
  }, []);

  const recordHistory = useCallback(() => {
    undoStack.current = [
      ...undoStack.current,
      { watermarks, signatures },
    ].slice(-50);
    redoStack.current = [];
    updateHistoryAvailability();
  }, [signatures, updateHistoryAvailability, watermarks]);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) {
      return;
    }

    redoStack.current = [...redoStack.current, { watermarks, signatures }];
    setWatermarks(previous.watermarks);
    setSignatures(previous.signatures);
    updateHistoryAvailability();
  }, [signatures, updateHistoryAvailability, watermarks]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) {
      return;
    }

    undoStack.current = [...undoStack.current, { watermarks, signatures }];
    setWatermarks(next.watermarks);
    setSignatures(next.signatures);
    updateHistoryAvailability();
  }, [signatures, updateHistoryAvailability, watermarks]);

  const changeZoom = useCallback((change: number) => {
    setZoom((currentZoom) =>
      Math.min(1.5, Math.max(0.6, Math.round((currentZoom + change) * 10) / 10)),
    );
  }, []);

  const handleFileSelected = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setDocumentFingerprint(null);
    setPageCount(0);
    setIsLoading(true);
    setCurrentPage(1);
    setIsWatermarkMode(false);
    setSelectedWatermarkId(null);
    setIsSignatureMode(false);
    setSelectedSignatureId(null);
    setNewSignatureText("");
    setWatermarkText("");
    setWatermarks([]);
    setPendingImage(null);
    setImageError(null);
    setSignatures([]);
    setPageScales({});
    setExportError(null);
    restoredDocumentKey.current = null;
    undoStack.current = [];
    redoStack.current = [];
    setHistoryAvailability({ canUndo: false, canRedo: false });
    setAutosaveMessage("");
    setDocumentVersion((version) => version + 1);
  }, []);

  const handleDocumentLoaded = useCallback(
    async (loadedPageCount: number, fingerprint: string) => {
      setPageCount(loadedPageCount);
      if (!file || !fingerprint) {
        setAutosaveMessage("Autosave is unavailable for this PDF.");
        return;
      }

      setDocumentFingerprint(fingerprint);
      const storageKey = getSavedStateKey(file, fingerprint);

      try {
        let savedState: unknown | null = null;
        let loadedFromIndexedDb = false;

        try {
          savedState = await loadEditorStateFromIndexedDb(storageKey);
          loadedFromIndexedDb = savedState !== null;
        } catch (error) {
          console.warn(
            "Could not read editor state from browser database storage; trying localStorage.",
            error,
          );
        }

        if (loadedFromIndexedDb) {
          indexedDbKeys.current.add(storageKey);
        } else {
          let legacyState: string | null = null;
          try {
            legacyState = window.localStorage.getItem(storageKey);
          } catch (error) {
            console.warn("Could not read editor state from localStorage.", error);
          }

          if (legacyState) {
            savedState = JSON.parse(legacyState);
          }
        }
        if (savedState === null) {
          restoredDocumentKey.current = storageKey;
          return;
        }

        if (!isSavedEditorState(savedState, loadedPageCount)) {
          if (loadedFromIndexedDb) {
            await deleteEditorStateFromIndexedDb(storageKey);
            indexedDbKeys.current.delete(storageKey);
          } else {
            window.localStorage.removeItem(storageKey);
          }
          restoredDocumentKey.current = storageKey;
          setAutosaveMessage("Invalid saved changes were ignored.");
          return;
        }

        setWatermarks(savedState.watermarks);
        setSignatures(savedState.signatures);
        setCurrentPage(savedState.pageNumber);
        setSnapToGrid(savedState.snapToGrid);
        setZoom(savedState.zoom);
        setTheme(savedState.theme);
        undoStack.current = [];
        redoStack.current = [];
        setHistoryAvailability({ canUndo: false, canRedo: false });
        restoredDocumentKey.current = storageKey;
        setAutosaveMessage("Recovered saved changes.");
      } catch (error) {
        console.error("Could not restore saved editor changes:", error);
        setAutosaveMessage("Saved changes could not be read.");
      }
    },
    [file],
  );

  const handleLoadStateChange = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  const handlePageChange = useCallback((pageNumber: number) => {
    setCurrentPage(pageNumber);
    setSelectedWatermarkId(null);
    setSelectedSignatureId(null);
  }, []);

  const handlePageScaleChange = useCallback(
    (pageNumber: number, scale: number) => {
      setPageScales((scales) => {
        if (scales[pageNumber] === scale) {
          return scales;
        }

        return { ...scales, [pageNumber]: scale };
      });

      setWatermarks((items) => {
        let scaleChanged = false;
        const updatedItems = items.map((watermark) => {
          if (
            watermark.type !== "text" ||
            watermark.pageNumber !== pageNumber ||
            Math.abs(watermark.displayScale - scale) < 0.0001
          ) {
            return watermark;
          }

          scaleChanged = true;
          return { ...watermark, displayScale: scale };
        });

        return scaleChanged ? updatedItems : items;
      });

      setSignatures((items) =>
        items.map((signature) =>
          signature.type === "text" &&
          signature.pageNumber === pageNumber &&
          Math.abs(signature.displayScale - scale) >= 0.0001
            ? { ...signature, displayScale: scale }
            : signature,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    if (!file || !documentFingerprint || !pageCount || isLoading) {
      return;
    }

    const storageKey = getSavedStateKey(file, documentFingerprint);
    if (restoredDocumentKey.current !== storageKey) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      const savedState = {
        version: 1,
        pageNumber: currentPage,
        watermarks,
        signatures,
        snapToGrid,
        zoom,
        theme,
      } satisfies SavedEditorState;

      void (async () => {
        try {
          if (indexedDbKeys.current.has(storageKey)) {
            await saveEditorStateToIndexedDb(storageKey, savedState);
            setAutosaveMessage(
              "Changes saved in this browser using expanded storage.",
            );
            return;
          }

          try {
            window.localStorage.setItem(storageKey, JSON.stringify(savedState));
            setAutosaveMessage("Changes saved in this browser.");
          } catch (error) {
            console.warn(
              "Could not save editor changes in localStorage; trying browser database storage.",
              error,
            );
            await saveEditorStateToIndexedDb(storageKey, savedState);
            indexedDbKeys.current.add(storageKey);
            setAutosaveMessage(
              "Changes saved in this browser using expanded storage.",
            );
          }
        } catch (error) {
          console.error("Could not save editor changes:", error);
          setAutosaveMessage(
            isStorageQuotaError(error)
              ? "Browser storage is full. Export your edits and clear saved browser data."
              : "Changes could not be saved in this browser. Browser storage may be unavailable.",
          );
        }
      })();
    }, 400);

    return () => window.clearTimeout(saveTimer);
  }, [
    currentPage,
    documentFingerprint,
    file,
    isLoading,
    pageCount,
    signatures,
    snapToGrid,
    theme,
    watermarks,
    zoom,
  ]);

  const currentWatermarks = watermarks.filter(
    (watermark) => watermark.pageNumber === currentPage,
  );
  const selectedWatermark =
    currentWatermarks.find((watermark) => watermark.id === selectedWatermarkId) ??
    null;
  const currentSignatures = signatures.filter(
    (signature) => signature.pageNumber === currentPage,
  );
  const selectedSignature =
    currentSignatures.find((signature) => signature.id === selectedSignatureId) ??
    null;

  function toggleWatermarkMode() {
    setSelectedWatermarkId(null);
    setSelectedSignatureId(null);
    setIsSignatureMode(false);
    setIsWatermarkMode((active) => !active);
  }

  function toggleSignatureMode() {
    setSelectedWatermarkId(null);
    setSelectedSignatureId(null);
    setIsWatermarkMode(false);
    setIsSignatureMode((active) => !active);
  }

  function applySignature(imageData: string) {
    recordHistory();
    const signature: SignatureImage = {
      id: crypto.randomUUID(),
      type: "image",
      pageNumber: currentPage,
      imageData,
      x: 0.5,
      y: 0.75,
      width: 0.3,
      rotation: 0,
      opacity: 1,
    };

    setSignatures((items) => [...items, signature]);
    setSelectedSignatureId(signature.id);
  }

  function addTextSignature() {
    const text = newSignatureText.trim();

    if (!text || pageScales[currentPage] === undefined) {
      return;
    }

    recordHistory();
    const signature: TextSignature = {
      id: crypto.randomUUID(),
      type: "text",
      text,
      pageNumber: currentPage,
      x: 0.5,
      y: 0.75,
      fontSize: 30,
      color: "#17212b",
      displayScale: pageScales[currentPage] ?? 0,
      rotation: 0,
      opacity: 1,
    };

    setSignatures((items) => [...items, signature]);
    setSelectedSignatureId(signature.id);
    setNewSignatureText("");
  }

  function changeSignaturePosition(id: string, x: number, y: number) {
    const snap = (value: number) => {
      const bounded = Math.min(1, Math.max(0, value));
      return snapToGrid
        ? Math.min(1, Math.max(0, Math.round(bounded / 0.05) * 0.05))
        : bounded;
    };
    setSignatures((items) =>
      items.map((signature) =>
        signature.id === id
          ? { ...signature, x: snap(x), y: snap(y) }
          : signature,
      ),
    );
  }

  function changeSignatureSize(id: string, size: number) {
    setSignatures((items) =>
      items.map((signature) => {
        if (signature.id !== id) {
          return signature;
        }

        return signature.type === "text"
          ? { ...signature, fontSize: Math.min(120, Math.max(12, size)) }
          : { ...signature, width: Math.min(0.8, Math.max(0.08, size)) };
      }),
    );
  }

  function changeSignatureRotation(id: string, rotation: number) {
    const boundedRotation = Math.min(180, Math.max(-180, rotation));
    setSignatures((items) =>
      items.map((signature) =>
        signature.id === id
          ? { ...signature, rotation: boundedRotation }
          : signature,
      ),
    );
  }

  function changeSignatureOpacity(id: string, opacity: number) {
    recordHistory();
    setSignatures((items) =>
      items.map((signature) =>
        signature.id === id ? { ...signature, opacity } : signature,
      ),
    );
  }

  function changeSignatureText(id: string, text: string) {
    recordHistory();
    setSignatures((items) =>
      items.map((signature) =>
        signature.id === id && signature.type === "text"
          ? { ...signature, text }
          : signature,
      ),
    );
  }

  function changeSignatureColor(id: string, color: string) {
    recordHistory();
    setSignatures((items) =>
      items.map((signature) =>
        signature.id === id && signature.type === "text"
          ? { ...signature, color }
          : signature,
      ),
    );
  }

  function selectSignature(id: string) {
    setIsWatermarkMode(false);
    setSelectedWatermarkId(null);
    setIsSignatureMode(true);
    setSelectedSignatureId(id);
  }

  const deleteSelectedSignature = useCallback(() => {
    if (!selectedSignature) {
      return;
    }

    recordHistory();
    setSignatures((items) =>
      items.filter((signature) => signature.id !== selectedSignature.id),
    );
    setSelectedSignatureId(null);
  }, [recordHistory, selectedSignature]);

  function addWatermark() {
    const text = watermarkText.trim();

    if (!text) {
      return;
    }

    recordHistory();
    const newWatermark: TextWatermark = {
      id: crypto.randomUUID(),
      type: "text",
      text,
      pageNumber: currentPage,
      x: 0.5,
      y: 0.5,
      fontSize: 36,
      color: "#344054",
      opacity: 0.4,
      rotation: 0,
      displayScale: pageScales[currentPage] ?? 0,
    };

    setWatermarks((items) => [...items, newWatermark]);
    setSelectedWatermarkId(newWatermark.id);
  }

  function changeWatermarkPosition(id: string, x: number, y: number) {
    const snap = (value: number) => {
      const bounded = Math.min(1, Math.max(0, value));
      return snapToGrid
        ? Math.min(1, Math.max(0, Math.round(bounded / 0.05) * 0.05))
        : bounded;
    };
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === id
          ? { ...watermark, x: snap(x), y: snap(y) }
          : watermark,
      ),
    );
  }

  function changeWatermarkOpacity(id: string, opacity: number) {
    recordHistory();
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === id ? { ...watermark, opacity } : watermark,
      ),
    );
  }

  function changeWatermarkRotation(id: string, rotation: number) {
    const boundedRotation = Math.min(180, Math.max(-180, rotation));
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === id
          ? { ...watermark, rotation: boundedRotation }
          : watermark,
      ),
    );
  }

  function changeWatermarkFontSize(id: string, fontSize: number) {
    const boundedSize = Math.min(120, Math.max(12, fontSize));
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === id && watermark.type === "text"
          ? { ...watermark, fontSize: boundedSize }
          : watermark,
      ),
    );
  }

  function changeWatermarkImageSize(id: string, width: number) {
    const boundedWidth = Math.min(0.8, Math.max(0.05, width));
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === id && watermark.type === "image"
          ? { ...watermark, width: boundedWidth }
          : watermark,
      ),
    );
  }

  function changeWatermarkText(id: string, text: string) {
    recordHistory();
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === id && watermark.type === "text"
          ? { ...watermark, text }
          : watermark,
      ),
    );
  }

  function changeWatermarkColor(id: string, color: string) {
    recordHistory();
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === id && watermark.type === "text"
          ? { ...watermark, color }
          : watermark,
      ),
    );
  }

  function selectWatermark(id: string) {
    setIsWatermarkMode(true);
    setIsSignatureMode(false);
    setSelectedSignatureId(null);
    setSelectedWatermarkId(id);
  }

  function deselectWatermark() {
    setSelectedWatermarkId(null);
  }

  function deselectSignature() {
    setSelectedSignatureId(null);
  }

  async function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    setPendingImage(null);
    setImageError(null);

    if (!file.size) {
      setImageError("This image file is empty. Choose a PNG or JPEG image.");
      return;
    }

    try {
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const isPng =
        header.length >= 8 &&
        header[0] === 137 &&
        header[1] === 80 &&
        header[2] === 78 &&
        header[3] === 71 &&
        header[4] === 13 &&
        header[5] === 10 &&
        header[6] === 26 &&
        header[7] === 10;
      const isJpeg =
        header.length >= 3 &&
        header[0] === 255 &&
        header[1] === 216 &&
        header[2] === 255;

      if (!isPng && !isJpeg) {
        setImageError("Choose a valid PNG, JPG, or JPEG image.");
        return;
      }

      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("The selected image could not be read."));
          }
        };
        reader.onerror = () =>
          reject(new Error("The selected image could not be read."));
        reader.readAsDataURL(file);
      });

      const image = new window.Image();
      image.src = imageData;
      try {
        await image.decode();
      } catch {
        throw new Error(
          "This file is not a readable PNG or JPEG image. Choose another file.",
        );
      }

      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error("The selected file does not contain a readable image.");
      }

      setPendingImage({
        imageData,
        mimeType: isPng ? "image/png" : "image/jpeg",
        aspectRatio: image.naturalWidth / image.naturalHeight,
      });
    } catch (error) {
      console.error("Watermark image validation failed:", error);
      setImageError(
        error instanceof Error
          ? error.message
          : "Could not read this image. Choose another file.",
      );
    }
  }

  function addImageWatermark() {
    if (!pendingImage) {
      return;
    }

    recordHistory();
    const newWatermark: ImageWatermark = {
      id: crypto.randomUUID(),
      type: "image",
      pageNumber: currentPage,
      x: 0.5,
      y: 0.5,
      width: 0.3,
      aspectRatio: pendingImage.aspectRatio,
      imageData: pendingImage.imageData,
      mimeType: pendingImage.mimeType,
      opacity: 0.6,
      rotation: 0,
    };

    setWatermarks((items) => [...items, newWatermark]);
    setSelectedWatermarkId(newWatermark.id);
    setPendingImage(null);
  }

  function replaceSelectedImage() {
    if (!pendingImage || selectedWatermark?.type !== "image") {
      return;
    }

    recordHistory();
    setWatermarks((items) =>
      items.map((watermark) =>
        watermark.id === selectedWatermark.id
          ? {
              ...watermark,
              imageData: pendingImage.imageData,
              mimeType: pendingImage.mimeType,
              aspectRatio: pendingImage.aspectRatio,
            }
          : watermark,
      ),
    );
    setPendingImage(null);
  }

  const deleteSelectedWatermark = useCallback(() => {
    if (!selectedWatermark) {
      return;
    }

    recordHistory();
    setWatermarks((items) =>
      items.filter((watermark) => watermark.id !== selectedWatermark.id),
    );
    setSelectedWatermarkId(null);
  }, [recordHistory, selectedWatermark]);

  async function handleExportPdf() {
    if (!file || pageCount === 0 || isLoading || isExporting) {
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const pdfBytes = await createWatermarkedPdf(
        file,
        watermarks,
        signatures,
      );
      const originalName = file.name.replace(/\.pdf$/i, "") || "document";
      downloadPdf(pdfBytes, `${originalName}-edited.pdf`);
    } catch (error) {
      console.error("PDF export failed:", error);

      setExportError(
        error instanceof Error
          ? error.message
          : "Could not export this PDF. Please try again.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    function handleEditorShortcuts(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }

      const modifierPressed = event.ctrlKey || event.metaKey;
      if (modifierPressed && event.key.toLowerCase() === "z") {
        if (event.shiftKey && historyAvailability.canRedo) {
          event.preventDefault();
          redo();
        } else if (!event.shiftKey && historyAvailability.canUndo) {
          event.preventDefault();
          undo();
        }
        return;
      }

      if (
        modifierPressed &&
        event.key.toLowerCase() === "y" &&
        historyAvailability.canRedo
      ) {
        event.preventDefault();
        redo();
        return;
      }

      if (file && event.altKey && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        changeZoom(0.1);
      } else if (file && event.altKey && event.key === "-") {
        event.preventDefault();
        changeZoom(-0.1);
      } else if (
        event.key === "Delete" &&
        (selectedWatermark || selectedSignature)
      ) {
        event.preventDefault();
        if (selectedWatermark) {
          deleteSelectedWatermark();
        } else {
          deleteSelectedSignature();
        }
      }
    }

    window.addEventListener("keydown", handleEditorShortcuts);
    return () => window.removeEventListener("keydown", handleEditorShortcuts);
  }, [
    changeZoom,
    deleteSelectedSignature,
    deleteSelectedWatermark,
    file,
    historyAvailability,
    redo,
    selectedSignature,
    selectedWatermark,
    signatures,
    undo,
    watermarks,
  ]);

  const documentStatus = !file
    ? "No document open"
    : isLoading
      ? "Loading PDF…"
      : pageCount > 0
        ? `${pageCount} ${pageCount === 1 ? "page" : "pages"} loaded`
        : "PDF could not be opened";

  const pageLabel = pageCount
    ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
    : isLoading
      ? "Loading…"
      : file
        ? "PDF error"
        : "No pages";

  return (
    <div className={styles.editor} data-theme={theme}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="DocuCraft home">
          <BrandMark />
          <span>DocuCraft</span>
        </Link>

        <div className={styles.topbarActions}>
          <span className={styles.saveStatus} role="status" aria-live="polite">
            {documentStatus}
          </span>
          <span className={styles.autosaveStatus} aria-live="polite">
            {autosaveMessage}
          </span>
          {exportError && (
            <span className={styles.exportError} role="alert">
              {exportError}
            </span>
          )}
          <button
            className={`${styles.utilityButton} ${styles.undoButton}`}
            type="button"
            onClick={undo}
            disabled={!historyAvailability.canUndo}
            aria-label="Undo last edit"
            title="Undo (Ctrl/Cmd+Z)"
          >
            <span className={styles.utilityLabel}>Undo</span>
            <span className={styles.compactShortcut} aria-hidden="true">
              ↶
            </span>
          </button>
          <button
            className={`${styles.utilityButton} ${styles.redoButton}`}
            type="button"
            onClick={redo}
            disabled={!historyAvailability.canRedo}
            aria-label="Redo last edit"
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            <span className={styles.utilityLabel}>Redo</span>
            <span className={styles.compactShortcut} aria-hidden="true">
              ↷
            </span>
          </button>
          <button
            className={`${styles.utilityButton} ${styles.themeButton}`}
            type="button"
            aria-pressed={theme === "dark"}
            aria-label={theme === "light" ? "Dark mode" : "Light mode"}
            onClick={() =>
              setTheme((currentTheme) =>
                currentTheme === "light" ? "dark" : "light",
              )
            }
          >
            <span className={styles.utilityLabel}>
              {theme === "light" ? "Dark mode" : "Light mode"}
            </span>
            <span className={styles.compactShortcut} aria-hidden="true">
              ◐
            </span>
          </button>
          <button
            className={styles.exportButton}
            type="button"
            onClick={handleExportPdf}
            disabled={
              !file ||
              pageCount === 0 ||
              isLoading ||
              isExporting ||
              watermarks.some(
                (watermark) =>
                  watermark.type === "text" && watermark.displayScale <= 0,
              )
            }
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 3.5v8m0 0 3-3m-3 3-3-3M4.5 13.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {isExporting ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      </header>

      <main className={styles.editorLayout}>
        <aside className={styles.toolbar} aria-label="Editing tools">
          <div className={styles.toolbarLabel}>TOOLS</div>
          <button
            className={`${styles.toolButton} ${isWatermarkMode ? styles.activeToolButton : ""
              }`}
            type="button"
            disabled={!file || pageCount === 0 || isLoading}
            aria-pressed={isWatermarkMode}
            onClick={toggleWatermarkMode}
          >
            <WatermarkIcon />
            <span>Watermark</span>
          </button>
          <button
            className={`${styles.toolButton} ${isSignatureMode ? styles.activeToolButton : ""
              }`}
            type="button"
            disabled={!file || pageCount === 0 || isLoading}
            aria-pressed={isSignatureMode}
            onClick={toggleSignatureMode}
          >
            <SignatureIcon />
            <span>E-Sign</span>
          </button>
          <p className={styles.toolsHint}>
            {isSignatureMode
              ? "Draw a signature, then add it to the current page."
              : "Select a tool to edit the current PDF page."}
          </p>
          <label className={styles.snapOption}>
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(event) => setSnapToGrid(event.target.checked)}
            />
            <span>Snap to 5% grid</span>
          </label>
          <p className={styles.shortcutHint}>
            Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z redo · Delete removes selection
            · Alt + / − zoom
          </p>
        </aside>

        <section className={styles.workspace} aria-labelledby="workspace-title">
          <div className={styles.workspaceHeader}>
            <div>
              <h1 id="workspace-title">Document editor</h1>
              <p>Preview PDF pages in your workspace.</p>
            </div>
            <span className={styles.pageBadge}>{pageLabel}</span>
          </div>

          <div className={styles.canvasArea}>
            <PdfUploader
              fileName={file?.name ?? null}
              onFileSelected={handleFileSelected}
            />
            <PdfViewer
              key={documentVersion}
              file={file}
              requestedPage={currentPage}
              zoom={zoom}
              snapToGrid={snapToGrid}
              onZoomChange={setZoom}
              onInteractionStart={recordHistory}
              onDocumentLoaded={handleDocumentLoaded}
              onLoadStateChange={handleLoadStateChange}
              onPageChange={handlePageChange}
              onPageScaleChange={handlePageScaleChange}
              watermarks={currentWatermarks}
              selectedWatermarkId={selectedWatermarkId}
              signatures={currentSignatures}
              selectedSignatureId={selectedSignatureId}
              isWatermarkMode={isWatermarkMode}
              isSignatureMode={isSignatureMode}
              onWatermarkPositionChange={changeWatermarkPosition}
              onWatermarkSelect={selectWatermark}
              onWatermarkDeselect={deselectWatermark}
              onWatermarkFontSizeChange={changeWatermarkFontSize}
              onWatermarkImageSizeChange={changeWatermarkImageSize}
              onWatermarkRotationChange={changeWatermarkRotation}
              onSignaturePositionChange={changeSignaturePosition}
              onSignatureSizeChange={changeSignatureSize}
              onSignatureRotationChange={changeSignatureRotation}
              onSignatureSelect={selectSignature}
              onSignatureDeselect={deselectSignature}
            />
          </div>
        </section>

        <aside className={styles.properties} aria-labelledby="properties-title">
          <div className={styles.panelHeader}>
            <h2 id="properties-title">Properties</h2>
            <span>—</span>
          </div>
          {isSignatureMode && file && pageCount > 0 ? (
            <div className={styles.signatureProperties}>
              <p className={styles.propertiesDescription}>
                E-Sign · page {currentPage}
              </p>
              <div className={styles.watermarkList} aria-label="Page signatures">
                {currentSignatures.map((signature, index) => (
                  <button
                    key={signature.id}
                    className={`${styles.watermarkListItem} ${
                      signature.id === selectedSignatureId
                        ? styles.selectedWatermarkListItem
                        : ""
                    }`}
                    type="button"
                    aria-pressed={signature.id === selectedSignatureId}
                    onClick={() => selectSignature(signature.id)}
                  >
                    {signature.type === "text"
                      ? `Text ${index + 1}: ${signature.text}`
                      : `Image signature ${index + 1}`}
                  </button>
                ))}
              </div>
              <label className={styles.propertyField}>
                <span>New text signature</span>
                <input
                  type="text"
                  value={newSignatureText}
                  onChange={(event) => setNewSignatureText(event.target.value)}
                  placeholder="Signed by Vishal Ranjan"
                />
              </label>
              <button
                className={styles.addWatermarkButton}
                type="button"
                onClick={addTextSignature}
                disabled={
                  !newSignatureText.trim() ||
                  pageScales[currentPage] === undefined
                }
              >
                Add text signature
              </button>
              <SignaturePad onUseSignature={applySignature} />
              {selectedSignature && (
                <>
                  <p className={styles.signatureHint}>
                    Selected {selectedSignature.type} signature. Drag to move;
                    use the corner and top handles to resize and rotate.
                  </p>
                  {selectedSignature.type === "text" && (
                    <>
                      <label className={styles.propertyField}>
                        <span>Signature text</span>
                        <input
                          type="text"
                          value={selectedSignature.text}
                          onChange={(event) =>
                            changeSignatureText(
                              selectedSignature.id,
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className={styles.propertyField}>
                        <span>
                          Text size <strong>{selectedSignature.fontSize}px</strong>
                        </span>
                        <input
                          type="range"
                          min="12"
                          max="120"
                          value={selectedSignature.fontSize}
                          onChange={(event) => {
                            recordHistory();
                            changeSignatureSize(
                              selectedSignature.id,
                              Number(event.target.value),
                            );
                          }}
                        />
                      </label>
                      <label className={styles.propertyField}>
                        <span>Text color</span>
                        <input
                          className={styles.colorInput}
                          type="color"
                          value={selectedSignature.color}
                          onChange={(event) =>
                            changeSignatureColor(
                              selectedSignature.id,
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                  {selectedSignature.type === "image" && (
                    <label className={styles.propertyField}>
                      <span>
                        Image size{" "}
                        <strong>{Math.round(selectedSignature.width * 100)}%</strong>
                      </span>
                      <input
                        type="range"
                        min="0.08"
                        max="0.8"
                        step="0.01"
                        value={selectedSignature.width}
                        onChange={(event) => {
                          recordHistory();
                          changeSignatureSize(
                            selectedSignature.id,
                            Number(event.target.value),
                          );
                        }}
                      />
                    </label>
                  )}
                  <label className={styles.propertyField}>
                    <span>
                      Opacity{" "}
                      <strong>
                        {Math.round(selectedSignature.opacity * 100)}%
                      </strong>
                    </span>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={selectedSignature.opacity}
                      onChange={(event) =>
                        changeSignatureOpacity(
                          selectedSignature.id,
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label className={styles.propertyField}>
                    <span>
                      Rotation{" "}
                      <strong>{Math.round(selectedSignature.rotation)}°</strong>
                    </span>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      value={selectedSignature.rotation}
                      onChange={(event) => {
                        recordHistory();
                        changeSignatureRotation(
                          selectedSignature.id,
                          Number(event.target.value),
                        );
                      }}
                    />
                  </label>
                  <button
                    className={styles.deleteWatermarkButton}
                    type="button"
                    onClick={deleteSelectedSignature}
                  >
                    Delete selected signature
                  </button>
                </>
              )}
              {currentSignatures.length > 0 && (
                <p className={styles.signatureHint}>
                  Each signature on this page can be selected and edited separately.
                </p>
              )}
            </div>
          ) : isWatermarkMode && file && pageCount > 0 ? (
            <div className={styles.watermarkProperties}>
              <p className={styles.propertiesDescription}>
                Watermarks · page {currentPage}
              </p>
              <div className={styles.watermarkList} aria-label="Page watermarks">
                {currentWatermarks.map((watermark, index) => (
                  <button
                    key={watermark.id}
                    className={`${styles.watermarkListItem} ${
                      watermark.id === selectedWatermarkId
                        ? styles.selectedWatermarkListItem
                        : ""
                    }`}
                    type="button"
                    aria-pressed={watermark.id === selectedWatermarkId}
                    onClick={() => selectWatermark(watermark.id)}
                  >
                    {watermark.type === "text"
                      ? `Text ${index + 1}: ${watermark.text || "Empty"}`
                      : `Image ${index + 1}`}
                  </button>
                ))}
              </div>

              <label className={styles.propertyField}>
                <span>New watermark text</span>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(event) => setWatermarkText(event.target.value)}
                  placeholder="Type your watermark"
                />
              </label>
              <button
                className={styles.addWatermarkButton}
                type="button"
                onClick={addWatermark}
                disabled={!watermarkText.trim() || pageScales[currentPage] === undefined}
              >
                Add text watermark
              </button>

              <label className={`${styles.addWatermarkButton} ${styles.imageUploadButton}`}>
                Upload PNG or JPEG watermark
                <input
                  ref={imageInputRef}
                  className={styles.hiddenImageInput}
                  type="file"
                  accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                  aria-label="Upload a PNG or JPEG watermark image"
                  onChange={handleImageSelected}
                />
              </label>

              {imageError && (
                <p className={styles.watermarkImageError} role="alert">
                  {imageError}
                </p>
              )}
              {pendingImage && (
                <div className={styles.pendingImagePreview}>
                  <Image
                    src={pendingImage.imageData}
                    alt="Preview of the watermark image to add"
                    width={240}
                    height={Math.max(
                      1,
                      Math.round(240 / pendingImage.aspectRatio),
                    )}
                    unoptimized
                  />
                  <button
                    className={styles.addWatermarkButton}
                    type="button"
                    onClick={addImageWatermark}
                  >
                    Add image watermark
                  </button>
                  {selectedWatermark?.type === "image" && (
                    <button
                      className={styles.secondaryWatermarkButton}
                      type="button"
                      onClick={replaceSelectedImage}
                    >
                      Replace selected image
                    </button>
                  )}
                </div>
              )}

              {selectedWatermark && (
                <>
                  <p className={styles.propertiesDescription}>
                    Selected {selectedWatermark.type} watermark
                  </p>
                  {selectedWatermark.type === "text" && (
                    <>
                      <label className={styles.propertyField}>
                        <span>Watermark text</span>
                        <input
                          type="text"
                          value={selectedWatermark.text}
                          onChange={(event) =>
                            changeWatermarkText(
                              selectedWatermark.id,
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className={styles.propertyField}>
                        <span>
                          Font size{" "}
                          <strong>{selectedWatermark.fontSize}px</strong>
                        </span>
                        <input
                          type="range"
                          min="12"
                          max="120"
                          value={selectedWatermark.fontSize}
                          onChange={(event) => {
                            recordHistory();
                            changeWatermarkFontSize(
                              selectedWatermark.id,
                              Number(event.target.value),
                            );
                          }}
                        />
                      </label>
                      <label className={styles.propertyField}>
                        <span>Text color</span>
                        <input
                          className={styles.colorInput}
                          type="color"
                          value={selectedWatermark.color}
                          onChange={(event) =>
                            changeWatermarkColor(
                              selectedWatermark.id,
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                  <label className={styles.propertyField}>
                    <span>
                      Opacity{" "}
                      <strong>
                        {Math.round(selectedWatermark.opacity * 100)}%
                      </strong>
                    </span>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={selectedWatermark.opacity}
                      onChange={(event) =>
                        changeWatermarkOpacity(
                          selectedWatermark.id,
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label className={styles.propertyField}>
                    <span>
                      Rotation{" "}
                      <strong>{Math.round(selectedWatermark.rotation)}°</strong>
                    </span>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      value={selectedWatermark.rotation}
                      onChange={(event) => {
                        recordHistory();
                        changeWatermarkRotation(
                          selectedWatermark.id,
                          Number(event.target.value),
                        );
                      }}
                    />
                  </label>
                  {selectedWatermark.type === "image" && (
                    <label className={styles.propertyField}>
                      <span>
                        Image size{" "}
                        <strong>
                          {Math.round(selectedWatermark.width * 100)}% page width
                        </strong>
                      </span>
                      <input
                        type="range"
                        min="0.05"
                        max="0.8"
                        step="0.01"
                        value={selectedWatermark.width}
                        onChange={(event) => {
                          recordHistory();
                          changeWatermarkImageSize(
                            selectedWatermark.id,
                            Number(event.target.value),
                          );
                        }}
                      />
                    </label>
                  )}
                  <p className={styles.propertyHint}>
                    Drag the watermark to move it. Use the corner handle to
                    resize, or the top handle and rotation control to rotate.
                  </p>
                  <button
                    className={styles.deleteWatermarkButton}
                    type="button"
                    onClick={deleteSelectedWatermark}
                  >
                    Delete selected watermark
                  </button>
                </>
              )}
              <p className={styles.exportLimitNote}>
                Export uses Helvetica Bold for text. Some Unicode characters
                and preview-font details may not match exactly.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.emptyProperties}>
                <span className={styles.selectionIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 5v13l4-3 2.5 5 2.2-1.1-2.5-5H17L5 5Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h3>Nothing selected</h3>
                <p>Document and element settings will show up here when you start editing.</p>
              </div>
              <p className={styles.panelNote}>
                Select a watermark or signature to view its settings.
              </p>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

export default Home;
