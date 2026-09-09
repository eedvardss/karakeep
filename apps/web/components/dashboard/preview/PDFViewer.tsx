"use client";

import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useQueryState } from "nuqs";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";

import HighlightForm from "@karakeep/shared-react/components/HighlightForm";
import {
  useCreateHighlight,
  useDeleteHighlight,
  useUpdateHighlight,
} from "@karakeep/shared-react/hooks/highlights";
import { useTRPC } from "@karakeep/shared-react/trpc";
import type {
  ZHighlight,
  ZHighlightColor,
} from "@karakeep/shared/types/highlights";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

import PDFPage from "./PDFPage";
import type { PdfLibrary } from "./PDFPage";
import { containsPdfPoint, getPdfSelection } from "./pdfHighlights";
import type { PdfSelection } from "./pdfHighlights";

import "./PDFViewer.css";

interface PDFViewerProps {
  bookmarkId: string;
  assetId: string;
  readOnly: boolean;
}

export default function PDFViewer(props: PDFViewerProps) {
  // A replacement PDF starts a fresh loading/selection lifecycle.
  return (
    <PDFViewerContent key={`${props.bookmarkId}:${props.assetId}`} {...props} />
  );
}

function PDFViewerContent({ bookmarkId, assetId, readOnly }: PDFViewerProps) {
  const api = useTRPC();
  const [highlightId] = useQueryState("highlight");
  const highlightScroll = useRef({ id: highlightId, handled: false });
  const url = getAssetUrl(assetId);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{
    pdf: PDFDocumentProxy;
    library: PdfLibrary;
    aspectRatio: number;
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [pending, setPending] = useState<
    | (PdfSelection & {
        color: ZHighlightColor;
        note: string | null;
      })
    | null
  >(null);
  const [selected, setSelected] = useState<ZHighlight | null>(null);
  const [isMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches,
  );
  const { data, isError: highlightsError } = useQuery(
    api.highlights.getForBookmark.queryOptions({ bookmarkId }),
  );
  const highlights = (data?.highlights ?? []).filter(
    (highlight) => highlight.pdfAnchor?.assetId === assetId,
  );

  useEffect(() => {
    if (highlightScroll.current.id !== highlightId) {
      highlightScroll.current = { id: highlightId, handled: false };
    }
    if (!highlightId || !loaded || highlightScroll.current.handled) return;
    const target = scrollContainer.current?.querySelector(
      `[data-pdf-highlight-id="${CSS.escape(highlightId)}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    highlightScroll.current.handled = true;
  }, [highlightId, loaded, data]);

  function closeForm() {
    setPosition(null);
    setPending(null);
    setSelected(null);
    window.getSelection()?.removeAllRanges();
  }

  const mutationOptions = {
    onSuccess: closeForm,
    onError: () =>
      toast({
        variant: "destructive",
        description: "Could not save the highlight. Please try again.",
      }),
  };
  const createHighlight = useCreateHighlight(mutationOptions);
  const updateHighlight = useUpdateHighlight(mutationOptions);
  const deleteHighlight = useDeleteHighlight(mutationOptions);
  const isSaving =
    createHighlight.isPending ||
    updateHighlight.isPending ||
    deleteHighlight.isPending;

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    async function load() {
      // PDF.js uses browser APIs; load it only after mounting on the client.
      const library = await import("pdfjs-dist");
      if (cancelled) return;
      library.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      loadingTask = library.getDocument({ url });
      const pdf = await loadingTask.promise;
      const firstPage = await pdf.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      if (!cancelled) {
        setLoaded({
          pdf,
          library,
          aspectRatio: viewport.width / viewport.height,
        });
      }
    }
    load().catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const container = scrollContainer.current;
    if (!container) return;
    const resize = () => setWidth(Math.max(240, container.clientWidth - 32));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function editHighlight(highlight: ZHighlight, bounds: DOMRect) {
    if (readOnly || isSaving) return;
    window.getSelection()?.removeAllRanges();
    setPending(null);
    setSelected(highlight);
    setPosition({
      x: bounds.left + bounds.width / 2,
      y: isMobile ? bounds.bottom : bounds.top,
    });
  }

  function captureSelection(pointer?: { x: number; y: number }) {
    if (readOnly || isSaving || !scrollContainer.current) return false;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount)
      return false;
    const range = selection.getRangeAt(0);
    const captured = getPdfSelection(scrollContainer.current, range, assetId);
    if (!captured) return false;
    let bounds = range.getBoundingClientRect();
    if (selection.focusNode) {
      const caret = document.createRange();
      caret.setStart(selection.focusNode, selection.focusOffset);
      caret.collapse(true);
      const caretBounds = caret.getBoundingClientRect();
      if (caretBounds.height) bounds = caretBounds;
    }
    setSelected(null);
    setPending({ ...captured, color: "yellow", note: null });
    setPosition({
      // A range spanning pages can include offscreen page boxes. Anchor the
      // form at the pointer or focused caret so it stays within reach.
      x: pointer?.x ?? Math.max(0, Math.min(window.innerWidth, bounds.left)),
      y:
        pointer?.y ??
        Math.max(
          0,
          Math.min(window.innerHeight, isMobile ? bounds.bottom : bounds.top),
        ),
    });
    return true;
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (
      readOnly ||
      isSaving ||
      captureSelection({ x: event.clientX, y: event.clientY })
    )
      return;
    const page = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-pdf-page]",
    );
    if (!page) return;
    const bounds = page.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    // Leave overlays transparent to pointers so text can still be selected.
    const highlight = [...highlights]
      .reverse()
      .find((item) =>
        item.pdfAnchor?.rects.some(
          (rect) =>
            rect.pageNumber === Number(page.dataset.pdfPage) &&
            containsPdfPoint(rect, x, y),
        ),
      );
    if (highlight) {
      editHighlight(highlight, new DOMRect(event.clientX, event.clientY, 0, 0));
    }
  }

  function saveHighlight(color: ZHighlightColor, note: string | null) {
    if (readOnly || isSaving) return;
    if (selected) {
      updateHighlight.mutate({ highlightId: selected.id, color, note });
    } else if (pending) {
      createHighlight.mutate({
        bookmarkId,
        text: pending.text,
        // The PDF anchor locates the selection; these offsets refer to its saved text.
        startOffset: 0,
        endOffset: pending.text.length,
        pdfAnchor: pending.pdfAnchor,
        color,
        note,
      });
    }
  }

  return (
    <section
      aria-label="PDF viewer"
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 select-none items-center justify-center gap-2 border-b p-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => {
            closeForm();
            setZoom((value) => Math.max(0.5, value - 0.25));
          }}
        >
          <ZoomOut className="size-4" />
        </Button>
        <span className="min-w-12 text-center text-sm" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          disabled={zoom >= 3}
          onClick={() => {
            closeForm();
            setZoom((value) => Math.min(3, value + 0.25));
          }}
        >
          <ZoomIn className="size-4" />
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Open PDF <ExternalLink className="ml-2 size-4" />
        </a>
      </div>
      {highlightsError && (
        <p role="alert" className="p-2 text-center text-sm text-destructive">
          Could not load saved highlights.
        </p>
      )}
      <div
        ref={scrollContainer}
        role="presentation"
        className="min-h-0 flex-1 overflow-auto bg-muted/50"
        onPointerUp={handlePointerUp}
        onKeyUp={(event) => {
          if (event.key === "Shift") captureSelection();
        }}
        onScroll={() => {
          if (position) closeForm();
        }}
      >
        {loadError ? (
          <p role="alert" className="p-8 text-center">
            Could not load this PDF. Use “Open PDF” to view the original.
          </p>
        ) : !loaded ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 p-8"
          >
            <Loader2 className="size-5 animate-spin" /> Loading PDF…
          </div>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-4 p-4">
            {Array.from({ length: loaded.pdf.numPages }, (_, index) => (
              <PDFPage
                key={index + 1}
                pdf={loaded.pdf}
                library={loaded.library}
                pageNumber={index + 1}
                width={width * zoom}
                initialAspectRatio={loaded.aspectRatio}
                highlights={highlights}
                readOnly={readOnly}
                onEditHighlight={editHighlight}
              />
            ))}
          </div>
        )}
      </div>
      <HighlightForm
        position={position}
        selectedHighlight={selected ?? pending}
        isMobile={isMobile}
        isPending={isSaving}
        onClose={closeForm}
        onSave={saveHighlight}
        onDelete={
          selected
            ? () => {
                if (!readOnly && !isSaving)
                  deleteHighlight.mutate({ highlightId: selected.id });
              }
            : undefined
        }
      />
    </section>
  );
}
