# DocuCraft

DocuCraft is a browser-based PDF Watermarking and E-Sign Editor built with Next.js, React, and TypeScript. It allows users to upload PDF documents, add and edit watermarks and signatures, and download the modified PDF.

PDF pages are displayed using PDF.js (`pdfjs-dist`), while `pdf-lib` is used to apply supported edits and generate the final downloadable PDF. Document editing and export take place in the browser.

## Live Demo

**Deployed Application:** https://docucraft-omega-three.vercel.app

## Features

### PDF Viewer and Upload
- Upload PDF documents using the file picker or supported drag-and-drop area.
- Display PDF pages in the editor.
- Render the current PDF page instead of mounting every page at once.
- Cancel unnecessary PDF rendering when the page changes or the viewer closes.
- Handle invalid, corrupted, or unsupported files with user-friendly errors.

### Watermark Editor
- Add text and image watermarks.
- Edit watermark text, color, and opacity.
- Move, resize, rotate, and delete watermarks.
- Add multiple watermarks to different PDF pages.
- Use keyboard, pointer, and touch interactions supported by the editor.
- Snap elements to a 5% grid and use page-center alignment guides.

### E-Signature Editor
- Create text signatures.
- Draw signatures using the signature canvas.
- Upload supported signature images.
- Move, resize, rotate, and delete signatures using supported editor controls.
- Place signatures on different PDF pages.

### Editing and Export
- Undo and redo supported editing operations.
- Switch between Watermark and E-Sign modes.
- Use zoom controls.
- Switch between light and dark themes.
- Export watermarks and signatures into a downloadable PDF.

## Browser-Based Editor Recovery

DocuCraft can save supported editor changes in the current browser and restore them when the same original PDF is uploaded again.

- The original PDF file itself is not saved as part of editor-state recovery.
- Saved editor changes are matched using PDF metadata and the PDF.js fingerprint.
- `localStorage` is used for editor-state persistence where possible.
- If saving to `localStorage` fails, DocuCraft attempts to use IndexedDB as a fallback.
- The application displays a warning if both storage methods fail.
- After refreshing the page, upload the same original PDF again to restore matching saved editor changes.
- Clearing the site's browser data may remove saved editor changes.

Browser-based recovery is not permanent server-side storage or cloud synchronization. Recovery also depends on the saved state remaining available and matching the uploaded PDF.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + Y` | Redo |
| `Delete` | Delete the selected mark |
| `Alt + =` | Zoom in |
| `Alt + -` | Zoom out |

Shortcuts are ignored while a text field or another editable control has focus.

## Technology Stack

- **Next.js** — Application framework.
- **React** — Interactive user interface.
- **TypeScript** — Type checking and safer development.
- **PDF.js (`pdfjs-dist`)** — PDF loading and page rendering.
- **`pdf-lib`** — PDF processing and export.
- **Browser `localStorage`** — Editor-state persistence where possible.
- **IndexedDB** — Fallback browser storage for editor state.
- **Playwright** — Browser-based end-to-end testing.
- **NYC** — Code coverage collection and reporting.
- **GitHub Actions** — Continuous integration workflow.
- **Vercel** — Application deployment.

## Prerequisites

Install a compatible version of Node.js and npm.

## Run Locally

### 1. Clone the Repository

```bash
git clone https://github.com/ADEEB172/docucraft.git
cd docucraft
```

### 2. Install Dependencies

```bash
npm ci
```

### 3. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tests and Coverage

### Run PDF Export Unit Tests

```bash
npm run test:unit
```

### Run Playwright End-to-End Tests

```bash
npm run test:e2e
```

### Run Tests with Coverage

```bash
npm run test:e2e:coverage
```

This command runs the configured Playwright tests and PDF export unit tests, then generates a code coverage report.

If generated at the configured location, open `coverage/e2e/index.html` in your browser to view the HTML coverage report.

### Latest Recorded Test Results

The latest shared test run reported:

- **Playwright:** 123 tests passed.
- **PDF export unit tests:** 15 passed, 0 failed.
- **Statement coverage:** 93.85%.
- **Branch coverage:** 90.37%.
- **Function coverage:** 96.61%.
- **Line coverage:** 93.92%.

These results represent that specific run. Results may change when source code, tests, or coverage configuration changes.

### Understanding Coverage

- **Statement coverage:** Measures executable statements that ran during testing.
- **Branch coverage:** Measures which outcomes of conditional logic ran.
- **Function coverage:** Measures functions that ran.
- **Line coverage:** Measures executable source lines that ran.

Coverage only applies to the source files included in `.nycrc.json`. It does not measure the entire project or third-party dependencies. High coverage does not guarantee that an application is bug-free.

## Production Build

Create an optimized production build:

```bash
npm run build
```

Start the production server locally:

```bash
npm run start
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

## Continuous Integration

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml`.

The workflow is configured to run the project's automated checks, including the relevant tests and production build, for its configured GitHub events.

To verify the remote checks, open the repository's **Actions** tab and confirm that the latest workflow run completed successfully.

## Project Documentation

Additional documentation is available in the `docs/` directory:

- [`docs/architecture.md`](docs/architecture.md) — Application architecture and component responsibilities.
- [`docs/data-flow.md`](docs/data-flow.md) — PDF upload, editor-state recovery, editing, persistence, and export flow.
- [`docs/ai-usage.md`](docs/ai-usage.md) — AI-assisted development, implementation notes, and verification.