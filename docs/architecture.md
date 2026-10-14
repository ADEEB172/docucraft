# DocuCraft — Application Architecture

## 1. Component Structure

DocuCraft uses a component-based architecture built with Next.js, React, and TypeScript. The application is divided into smaller components to keep the code organized, reusable, and easier to maintain.

- **`src/app/page.tsx`** – Main editor page that brings together the application's interface and editing features.
- **`src/app/layout.tsx`** – Defines the root layout of the Next.js application.
- **`src/components/pdf/PdfUploader.tsx`** – Handles PDF file selection and upload-related functionality.
- **`src/components/pdf/PdfViewer.tsx`** – Displays PDF pages and supports the document editing interface.
- **`src/components/signature/SignaturePad.tsx`** – Provides a canvas for drawing a signature and controls for clearing or using it.
- **`src/lib/pdfExport.ts`** – Contains the PDF export functionality.
- **CSS Modules and global styles** – Manage component-specific styling and the overall appearance of the application.

This structure separates the main application interface, PDF functionality, signature functionality, and export logic.

## 2. State Management

DocuCraft uses React state to manage interactive editor data and UI changes.

The state is used to coordinate information such as the selected PDF, current editing mode, watermarks, signatures, selected objects, and relevant editor settings.

React state updates allow the interface to respond when users add, select, move, resize, rotate, modify, or delete editing elements.

Components communicate through props and callback functions where required. This approach keeps related functionality organized and allows the interface to reflect editing changes without manually updating the page.

## 3. Rendering Approach

The application uses Next.js App Router and React components to render the editor interface.

PDF documents are rendered using PDF.js through the `pdfjs-dist` library. PDF pages are displayed using canvas-based rendering, while editing controls provide the interface for working with watermarks and signatures.

CSS Modules are used for component-specific styles, while global CSS provides application-wide styling.

The rendering approach separates the document preview from the editor controls and allows users to interact with the document through the application interface.

## 4. PDF Processing

DocuCraft uses `pdfjs-dist` to load, process, and render PDF documents in the browser.

The PDF upload workflow includes the following steps:

1. The user selects a PDF file.
2. The application checks the selected file and attempts to load it as a PDF.
3. PDF.js processes the document and makes its pages available for rendering.
4. The viewer displays the document pages for editing.
5. The user can navigate between pages and work with the available editing features.

Loading and rendering errors are handled so that invalid or problematic documents do not silently appear as successfully loaded PDFs.

## 5. Watermark Implementation

DocuCraft supports text and image watermarks on PDF pages.

Users can add multiple watermarks and interact with them through the editor. Supported operations include moving, resizing, rotating, repositioning, modifying, and deleting watermark elements.

Watermark-related information is managed by the editor and used to display the elements in the appropriate positions over the PDF preview.

The watermark implementation keeps editing interactions separate from the final PDF export process. During export, the watermark elements are incorporated into the downloadable PDF.

## 6. E-Sign Implementation

DocuCraft provides an E-Sign mode alongside the Watermark mode.

The `SignaturePad.tsx` component provides a canvas-based interface for drawing a signature. Users can draw a signature, clear the canvas, and use the completed signature in the editor. The implementation also supports signature image input.

After adding a signature, users can position and resize it over the PDF page. Signatures can be placed on different pages and included in the exported document.

The signature feature provides visual signature placement. It does not, by itself, create a cryptographic digital signature or independently verify the signer's identity.

## 7. PDF Export Implementation

The PDF export functionality is implemented in `src/lib/pdfExport.ts` using the `pdf-lib` library.

The export process takes the original PDF and incorporates the applicable watermark and signature elements into the document.

The implementation accounts for the relationship between the PDF preview coordinates and the PDF page coordinates so that editing elements can be placed correctly in the exported document.

After processing, the application generates a downloadable PDF file containing the original document and the applied editing elements.

The export logic is kept separate from the main UI components to make the PDF processing functionality easier to maintain and test.

## 8. File Handling

DocuCraft handles PDF files and the image files used for watermarks or signatures through the browser-based editor.

The application validates supported input where applicable and attempts to process files before using them in the editor.

PDF files are loaded for preview, while image inputs are used by the relevant watermark or signature functionality.

File loading and processing errors are handled to provide feedback when an input cannot be used. The final edited PDF is generated for the user to download locally.

## 9. Error Handling

DocuCraft includes error handling for common document and editing problems.

Examples include invalid or malformed PDF files, PDF loading or rendering failures, unavailable canvas functionality, invalid image inputs, and problems preparing editing elements for export.

Error handling helps prevent failed operations from being treated as successful and allows the application to respond to unexpected input or browser limitations.

Automated tests cover important editor workflows and edge cases to help identify regressions and improve reliability.

