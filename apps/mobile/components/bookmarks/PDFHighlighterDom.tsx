"use dom";

import "@/globals.css";

import { useEffect } from "react";
import * as library from "pdfjs-dist";
import * as worker from "pdfjs-dist/build/pdf.worker.mjs";

import PDFHighlighter from "@karakeep/shared-react/components/pdf/PDFHighlighter";
import type {
  NewPdfHighlight,
  PdfHighlight,
} from "@karakeep/shared-react/components/pdf/types";
import type { ZHighlightColor } from "@karakeep/shared/types/highlights";

export default function PDFHighlighterDom({
  assetId,
  highlightId,
  isDark,
  highlights,
  highlightsError,
  onLoadDocument,
  onCreate,
  onUpdate,
  onDelete,
  onOpenOriginal,
}: {
  assetId: string;
  highlightId?: string;
  isDark: boolean;
  highlights: PdfHighlight[];
  highlightsError: boolean;
  onLoadDocument: () => Promise<string>;
  onCreate: (highlight: NewPdfHighlight) => Promise<void>;
  onUpdate: (
    id: string,
    color: ZHighlightColor,
    note: string | null,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenOriginal: () => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}) {
  useEffect(() => {
    // The highlight editor is portalled to body, outside the reader element.
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return (
    <div
      className="bg-background text-foreground"
      style={{ width: "100%", height: "100dvh", overflow: "hidden" }}
    >
      <PDFHighlighter
        key={assetId}
        assetId={assetId}
        highlightId={highlightId}
        highlights={highlights}
        highlightsError={highlightsError}
        loadDocument={async () => {
          // Bundle the supported main-thread worker with the offline DOM view;
          // it does not need a remotely hosted worker or native API credentials.
          Object.assign(globalThis, { pdfjsWorker: worker });
          const encoded = await onLoadDocument();
          const decoded = atob(encoded);
          const data = Uint8Array.from(decoded, (character) =>
            character.charCodeAt(0),
          );
          return { library, task: library.getDocument({ data }) };
        }}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onOpenOriginal={() => {
          void onOpenOriginal();
        }}
      />
    </div>
  );
}
