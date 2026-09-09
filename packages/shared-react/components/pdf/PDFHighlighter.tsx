"use client";

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";

import type { ZHighlightColor } from "@karakeep/shared/types/highlights";

import HighlightForm from "../HighlightForm";
import { Button, buttonVariants } from "../ui/button";
import PDFPage from "./PDFPage";
import { containsPdfPoint, getPdfSelection } from "./pdfHighlights";
import type { PdfSelection } from "./pdfHighlights";
import type {
  LoadPdfDocument,
  NewPdfHighlight,
  PdfHighlight,
  PdfLibrary,
} from "./types";

import "./PDFViewer.css";

export default function PDFHighlighter({
  assetId,
  highlights: allHighlights,
  readOnly = false,
  highlightId,
  highlightsError = false,
  loadDocument,
  originalUrl,
  onOpenOriginal,
  onCreate,
  onUpdate,
  onDelete,
}: {
  assetId: string;
  highlights: PdfHighlight[];
  readOnly?: boolean;
  highlightId?: string | null;
  highlightsError?: boolean;
  loadDocument: LoadPdfDocument;
  originalUrl?: string;
  onOpenOriginal?: () => void;
  onCreate: (highlight: NewPdfHighlight) => Promise<void>;
  onUpdate: (
    id: string,
    color: ZHighlightColor,
    note: string | null,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const highlightScroll = useRef({ id: highlightId, handled: false });
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
  const [selected, setSelected] = useState<PdfHighlight | null>(null);
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches,
  );
  const highlights = allHighlights.filter(
    (highlight) => highlight.pdfAnchor?.assetId === assetId,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [touchSelection, setTouchSelection] = useState<PdfSelection | null>(
    null,
  );
  const actionSelection = useRef<PdfSelection | null>(null);
  const loader = useRef(loadDocument);
  loader.current = loadDocument;

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
  }, [highlightId, loaded, allHighlights]);

  function closeForm() {
    setPosition(null);
    setPending(null);
    setSelected(null);
    setTouchSelection(null);
    actionSelection.current = null;
    setSaveError(false);
    window.getSelection()?.removeAllRanges();
  }

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    async function load() {
      // Adapters configure their bundled worker and supply URL or authenticated bytes.
      const { library, task } = await loader.current();
      loadingTask = task;
      if (cancelled) {
        void task.promise.catch(() => undefined);
        await task.destroy();
        return;
      }
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
  }, []);

  useEffect(() => {
    const container = scrollContainer.current;
    if (!container) return;
    const resize = () => setWidth(Math.max(240, container.clientWidth - 32));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function editHighlight(highlight: PdfHighlight, bounds: DOMRect) {
    if (readOnly || isSaving) return;
    window.getSelection()?.removeAllRanges();
    setPending(null);
    setTouchSelection(null);
    setSaveError(false);
    setSelected(highlight);
    setPosition({
      x: bounds.left + bounds.width / 2,
      y: isMobile ? bounds.bottom : bounds.top,
    });
  }

  useEffect(() => {
    if (!isMobile || readOnly || isSaving || position) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        const container = scrollContainer.current;
        setTouchSelection(
          container && selection?.rangeCount
            ? getPdfSelection(container, selection.getRangeAt(0), assetId)
            : null,
        );
      });
    };
    document.addEventListener("selectionchange", update);
    update();
    return () => {
      document.removeEventListener("selectionchange", update);
      cancelAnimationFrame(frame);
    };
  }, [isMobile, readOnly, isSaving, position, assetId]);

  function captureTouchAction() {
    // Read again at the action, including the last handle movement even if its
    // selectionchange animation frame has not run yet.
    const selection = window.getSelection();
    const container = scrollContainer.current;
    actionSelection.current =
      container && selection?.rangeCount
        ? getPdfSelection(container, selection.getRangeAt(0), assetId)
        : null;
  }

  function openTouchSelection() {
    if (!actionSelection.current) captureTouchAction();
    const captured = actionSelection.current;
    if (!captured || readOnly || isSaving) return;
    setSelected(null);
    setPending({ ...captured, color: "yellow", note: null });
    setSaveError(false);
    setPosition({ x: window.innerWidth / 2, y: 64 });
    setTouchSelection(null);
    actionSelection.current = null;
    window.getSelection()?.removeAllRanges();
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
    setSaveError(false);
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
      (!isMobile && captureSelection({ x: event.clientX, y: event.clientY })) ||
      (isMobile && !window.getSelection()?.isCollapsed)
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

  async function mutate(action: () => Promise<void>) {
    if (readOnly || isSaving) return;
    setIsSaving(true);
    setSaveError(false);
    try {
      await action();
      closeForm();
    } catch {
      // Keep the draft and editor open when the API or native bridge rejects.
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  }

  function saveHighlight(color: ZHighlightColor, note: string | null) {
    if (selected) {
      void mutate(() => onUpdate(selected.id, color, note));
    } else if (pending) {
      void mutate(() => onCreate({ ...pending, color, note }));
    }
  }

  return (
    <section
      aria-label="PDF viewer"
      className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
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
        {originalUrl ? (
          <a
            href={originalUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Open PDF <ExternalLink className="ml-2 size-4" />
          </a>
        ) : (
          <Button variant="ghost" size="sm" onClick={onOpenOriginal}>
            Open PDF <ExternalLink className="ml-2 size-4" />
          </Button>
        )}
      </div>
      {isMobile && touchSelection && !position && !readOnly && (
        <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 select-none">
          <Button
            disabled={isSaving}
            onPointerDown={(event) => {
              event.preventDefault();
              captureTouchAction();
            }}
            onClick={openTouchSelection}
          >
            Highlight selection
          </Button>
        </div>
      )}
      {saveError && (
        <p role="alert" className="p-2 text-center text-sm text-destructive">
          Could not save the highlight. Please try again.
        </p>
      )}
      {highlightsError && (
        <p role="alert" className="p-2 text-center text-sm text-destructive">
          Could not load saved highlights.
        </p>
      )}
      <div
        ref={scrollContainer}
        role="presentation"
        className="min-h-0 flex-1 overflow-auto bg-muted/50"
        onPointerDown={(event) =>
          setIsMobile(
            event.pointerType === "touch" || event.pointerType === "pen",
          )
        }
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
                void mutate(() => onDelete(selected.id));
              }
            : undefined
        }
      />
    </section>
  );
}
