# DocuCraft

DocuCraft is a browser-based PDF watermarking and e-sign editor built with Next.js, React, and TypeScript. It uses PDF.js to display PDF documents and `pdf-lib` to generate the edited PDF for download.

PDF processing takes place in the browser. The application does not upload the PDF to a server as part of its described editing workflow.

## Features

- Add text and image watermarks.
- Create text signatures, draw signatures, or upload signature images.
- Edit watermarks and signatures on different PDF pages.
- Move, resize, and rotate editing elements using supported pointer, touch, and keyboard interactions.
- Undo and redo supported editing operations.
- Use a 5% snap grid, page-center alignment guides, and zoom controls.
- Upload a PDF using the file picker or the supported drag-and-drop area.
- Switch between light and dark themes.
- Render the current PDF page rather than mounting every page at once.
- Cancel PDF.js rendering when the page changes or the viewer closes.
- Export the edited document as a downloadable PDF.

### Browser-Based Editor Recovery

DocuCraft can restore supported editor marks and settings in the same browser when the same PDF is uploaded again.

- The PDF file itself is not saved as part of the editor-state recovery feature.
- The saved editing state is matched using PDF metadata and the PDF.js fingerprint.
- Image marks are stored as image data in browser storage.
- Clearing this site's browser data removes the saved edits.

Browser-based editor recovery is not permanent server-side storage.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` | Redo |
| `Delete` | Delete the selected mark |
| `Alt + =` | Zoom in |
| `Alt + -` | Zoom out |

Shortcuts are ignored while a text field or another editable control has focus.

## Technology Stack

- **Next.js** — Application framework.
- **React** — Interactive user interface.
- **TypeScript** — Type checking.
- **PDF.js (`pdfjs-dist`)** — PDF loading and page rendering.
- **`pdf-lib`** — PDF processing and export.
- **Playwright** — Browser-based end-to-end testing.
- **NYC** — Code coverage collection and reporting.

## Run Locally

### Prerequisites

Install a compatible Node.js and npm version.

### Install Dependencies

```bash
npm ci
```

### Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tests and Coverage

### Run PDF Export Unit Tests

```bash
npm run test:unit
```

### Run Playwright Browser Tests

```bash
npm run test:e2e
```

### Run Tests with Coverage

```bash
npm run test:e2e:coverage
```

This command runs the configured Playwright and PDF export unit tests, collects coverage, and generates the HTML coverage report.

Open `coverage/e2e/index.html` in a browser to view the report.

### Understanding Coverage

- **Statement coverage:** Measures executable statements that ran during testing.
- **Branch coverage:** Measures which outcomes of conditional logic ran.
- **Function coverage:** Measures functions that ran.
- **Line coverage:** Measures executable source lines that ran.

Coverage is limited to the application files configured in `.nycrc.json`:

- `src/app/page.tsx`
- `src/components/pdf/PdfViewer.tsx`
- `src/components/pdf/PdfUploader.tsx`
- `src/components/signature/SignaturePad.tsx`
- `src/lib/pdfExport.ts`

Coverage does not measure the entire project or third-party dependencies. Even 100% coverage does not prove that an application is bug-free or that every possible input produces the correct result.

## Production Build

### Create a Production Build

```bash
npm run build
```

This command compiles the application and checks it for production-build errors.

After a successful build, run the production server with:

```bash
npm run start
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

## Continuous Integration

The project includes a GitHub Actions workflow at `.github/workflows/ci.yml`.

The configured workflow is intended to automate checks such as PDF export unit tests, Playwright browser tests, and the production build for pushes and pull requests. It also installs Chromium for Playwright testing.

Successful local tests do not automatically mean that the remote GitHub Actions workflow has been verified. Check the workflow's run status in GitHub Actions after pushing the project.

## Project Documentation

Additional documentation is available in the `docs/` directory:

- `docs/architecture.md` — Application architecture and component responsibilities.
- `docs/data-flow.md` — Data flow from PDF upload through editing and export.
- `docs/ai-usage.md` — AI-assisted development and implementation notes.