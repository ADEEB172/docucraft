"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import styles from "./Pdf.module.css";

type PdfUploaderProps = {
  fileName: string | null;
  onFileSelected: (file: File) => void;
};

function containsPdfHeader(bytes: Uint8Array): boolean {
  const header = [37, 80, 68, 70, 45]; // %PDF-

  for (let start = 0; start <= bytes.length - header.length; start += 1) {
    const matchesHeader = header.every(
      (byte, index) => bytes[start + index] === byte,
    );

    if (matchesHeader) {
      return true;
    }
  }

  return false;
}

export default function PdfUploader({
  fileName,
  onFileSelected,
}: PdfUploaderProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const validationNumber = useRef(0);

  async function validateAndSelectFile(file: File | undefined) {
    if (!file) {
      return;
    }

    const currentValidation = validationNumber.current + 1;
    validationNumber.current = currentValidation;

    if (file.size === 0) {
      setErrorMessage("This file is empty. Choose a PDF that contains data.");
      return;
    }

    try {
      // A PDF header can appear after a short prefix, so inspect the first 1 KB.
      const headerBytes = new Uint8Array(
        await file.slice(0, 1024).arrayBuffer(),
      );

      if (validationNumber.current !== currentValidation) {
        return;
      }

      if (!containsPdfHeader(headerBytes)) {
        setErrorMessage("This file does not appear to be a PDF. Choose a PDF file.");
        return;
      }

      setErrorMessage(null);
      onFileSelected(file);
    } catch (error) {
      if (validationNumber.current === currentValidation) {
        console.error("Could not read the selected PDF file.", error);
        setErrorMessage("The selected file could not be read. Try another file.");
      }
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    await validateAndSelectFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void validateAndSelectFile(event.dataTransfer.files[0]);
  }

  return (
    <div
      className={fileName ? styles.replaceControl : styles.uploadCard}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {!fileName && (
        <>
          <span className={styles.uploadIllustration} aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path
                d="M13 7.75h14l9 9v22.5H13a3 3 0 0 1-3-3v-25.5a3 3 0 0 1 3-3Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M27 8v9h9M24 32V22m0 0-4 4m4-4 4 4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h2>Bring your document to life</h2>
          <p>
            Choose or drop a PDF to preview its pages and add watermarks or
            signatures. The PDF itself is not saved, so choose the same PDF
            again after refreshing to restore saved editor changes.
          </p>
        </>
      )}

      {fileName && (
        <span className={styles.selectedFileName} title={fileName}>
          {fileName}
        </span>
      )}

      <label className={styles.fileButton}>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 3.5v8m0 0 3-3m-3 3-3-3M4.5 13.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {fileName ? "Replace PDF" : "Choose PDF"}
        <input
          className={styles.fileInput}
          type="file"
          accept=".pdf,application/pdf"
          aria-label={fileName ? "Replace the current PDF" : "Choose a PDF"}
          onChange={handleFileChange}
        />
      </label>

      {!fileName && (
        <p className={styles.fileHint}>PDF files only. Your file stays in this browser.</p>
      )}
      {errorMessage && (
        <p className={styles.errorMessage} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
