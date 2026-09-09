import type { PDFDocumentLoadingTask } from "pdfjs-dist";

import type {
  ZHighlight,
  ZHighlightColor,
} from "@karakeep/shared/types/highlights";

import type { PdfSelection } from "./pdfHighlights";

// Only serializable fields cross the Expo DOM bridge (createdAt is a Date).
export type PdfHighlight = Pick<
  ZHighlight,
  "id" | "text" | "color" | "note" | "pdfAnchor"
>;

export type NewPdfHighlight = PdfSelection & {
  color: ZHighlightColor;
  note: string | null;
};

export type PdfLibrary = typeof import("pdfjs-dist");

export type LoadPdfDocument = () => Promise<{
  library: PdfLibrary;
  task: PDFDocumentLoadingTask;
}>;
