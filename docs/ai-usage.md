# AI Usage Documentation — DocuCraft

## 1. Introduction

I used AI-assisted development tools during the development of DocuCraft to understand unfamiliar concepts, explore implementation approaches, write tests, and debug issues.

My goal was to build a working PDF editor while keeping the code readable and understandable. I reviewed AI suggestions and used testing to check important behaviours instead of assuming that every generated solution was correct.

The prompts below are representative summaries of the tasks for which AI assistance was used.

## 2. PDF Upload and Rendering

### Prompt

"Help me implement PDF upload and PDF page rendering in Next.js using React, TypeScript, and PDF.js. Keep the implementation simple and explain how it works."

### AI Result

The suggested approach used PDF.js to load and render PDF pages in the browser. It also highlighted the need to handle invalid files and PDF loading errors.

### Implementation

I used separate components for uploading and displaying the PDF:

- `src/components/pdf/PdfUploader.tsx`
- `src/components/pdf/PdfViewer.tsx`
- `src/components/pdf/Pdf.module.css`

### My Understanding

I learned that PDF.js is responsible for rendering PDF pages for preview. Upload validation and page rendering are separate responsibilities, which makes the application easier to maintain.

I also understood that rendering a PDF on a canvas does not itself modify the original PDF file.

## 3. Watermark Module

### Prompt

"Help me implement text and image watermarks on PDF pages, with support for moving, resizing, rotating, editing, deleting, and adding multiple watermarks."

### AI Result

The suggested approach involved maintaining watermark properties in the editor and displaying the elements over the PDF preview. It also highlighted the need to preserve their properties during export.

### Implementation

I implemented the watermark editing workflow within the main editor and connected it to the PDF viewer and export logic.

Relevant files:

- `src/app/page.tsx`
- `src/components/pdf/PdfViewer.tsx`
- `src/lib/pdfExport.ts`

### My Understanding

A watermark is an editable element with properties such as its content, position, size, and rotation. The editor must maintain these properties so that the exported PDF reflects the final changes.

I also learned that preview positioning and PDF drawing coordinates may differ, which makes coordinate conversion important.

## 4. E-Sign Module

### Prompt

"Help me build a signature interface that supports text signatures, drawing signatures on a canvas, and uploading signature images. Allow users to edit and position signatures on PDF pages."

### AI Result

The approach used separate signature input handling and an editor workflow for displaying and manipulating signature elements.

### Implementation

The signature input interface is implemented in:

- `src/components/signature/SignaturePad.tsx`
- `src/components/signature/Signature.module.css`

The main editor and PDF export module connect signature elements to the document editing and export workflows.

### My Understanding

A signature can originate from text, a drawing, or an uploaded image. The application needs to retain the relevant signature data and placement properties so that the element can be displayed and exported correctly.

This is a visual e-signing feature. It does not provide cryptographic or certificate-based digital signatures.

## 5. PDF Export

### Prompt

"Explain how to use pdf-lib to embed text and image elements into an existing PDF and preserve their positions, sizes, and rotations."

### AI Result

The suggested approach used `pdf-lib` to load the original PDF and draw supported text and images onto the appropriate pages.

It also highlighted the importance of page dimensions, coordinate conversion, and rotation.

### Implementation

The export logic is maintained in `src/lib/pdfExport.ts`. I also added unit tests in `tests/pdfExport.unit.mjs` to check selected export behaviours.

### My Understanding

PDF.js is used for the document preview, while `pdf-lib` is used to generate the final PDF. These libraries have different responsibilities.

I learned that the exported PDF must use the final element properties and appropriate PDF coordinates rather than simply capturing the visual preview.

## 6. Automated Testing

### Prompt

"Help me write Playwright tests for PDF uploads, watermark interactions, signature operations, PDF export, and edge cases."

### AI Result

The approach involved testing normal user workflows as well as invalid inputs, error conditions, and boundary cases.

### Implementation

The test suite includes:

- `tests/homepage.spec.ts`
- `tests/pdf-upload.spec.ts`
- `tests/watermark.spec.ts`
- `tests/signature.spec.ts`
- `tests/edge-cases.spec.ts`
- `tests/editor-bonus.spec.ts`
- `tests/pdfExport.unit.mjs`

### My Understanding

Playwright checks how the application behaves through browser interactions. Unit tests check selected PDF export functions separately.

I also learned that tests should verify meaningful behaviour rather than only checking whether the application renders without crashing.

## 7. Debugging a Failing Test

### Prompt

"Investigate why the test for malformed saved editor data is failing. Check whether the issue is in the application or in the test setup before changing production code."

### AI Result

The investigation identified a timing issue in the test setup. The test could corrupt a storage record before confirming that it contained the intended test watermark.

### Implementation

The test in `tests/editor-bonus.spec.ts` was updated to wait for the correct saved record before corrupting it. An unnecessary production-code change was reverted.

### My Understanding

A failing test does not automatically mean the application has a bug. The test setup, timing, selectors, and assumptions must also be investigated.

This helped me understand why it is important to identify the root cause before changing working application code.

## 8. Code Quality and Maintainability

### Prompt

"Review the implementation for readability and suggest ways to keep the code beginner-friendly without adding unnecessary complexity."

### AI Result

The review focused on separating responsibilities, handling errors, and keeping the implementation understandable.

### Implementation

The project uses separate files for the main editor, PDF upload and rendering, signature input, and PDF export. Automated tests are also organised by feature.

### My Understanding

Separating responsibilities makes code easier to navigate, test, and explain. I also learned that adding more abstractions or dependencies is not always the best solution; the implementation should remain as simple as the requirements allow.

## 9. Testing Results

The reported verification run completed 112 Playwright tests and 11 PDF export unit tests successfully. TypeScript checking and the production build also completed successfully.

The reported code coverage for the configured coverage scope was:

| Metric | Coverage |
|---|---:|
| Statements | 92.94% |
| Branches | 86.40% |
| Functions | 96.58% |
| Lines | 93.00% |

These results do not represent 100% coverage. Coverage measures which configured parts of the code were exercised by tests; it does not guarantee that every possible behaviour is correct.

## 10. Conclusion

AI-assisted development helped me explore implementation approaches, understand PDF processing concepts, write tests, and debug issues during DocuCraft development.

The most important lesson was that using AI does not remove the need to understand the code. I need to be able to explain how the editor works, why PDF rendering and export are separate, how element positioning is handled, and how automated tests help verify the implementation.

I remain responsible for reviewing the implementation, checking the test results, and ensuring that the documentation accurately reflects the project.