import React, { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useInView } from "react-intersection-observer";

import { HIGHLIGHT_COLOR_MAP } from "../highlights";
import type { PdfHighlight } from "./types";

import styles from "./PDFViewer.module.css";

export type PdfLibrary = typeof import("pdfjs-dist");

function selectionIntersects(container: HTMLElement | null) {
  const selection = container?.ownerDocument.getSelection();
  if (!container || !selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(container)) return true;
  }
  return false;
}

export default function PDFPage({
  pdf,
  library,
  pageNumber,
  width,
  initialAspectRatio,
  highlights,
  readOnly,
  onEditHighlight,
}: {
  pdf: PDFDocumentProxy;
  library: PdfLibrary;
  pageNumber: number;
  width: number;
  initialAspectRatio: number;
  highlights: PdfHighlight[];
  readOnly: boolean;
  onEditHighlight: (highlight: PdfHighlight, bounds: DOMRect) => void;
}) {
  const { ref, inView } = useInView({ rootMargin: "800px" });
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [error, setError] = useState(false);
  const [textReady, setTextReady] = useState(false);
  const [, updateSelection] = useState(0);
  const canvasContainer = useRef<HTMLDivElement>(null);
  const textContainer = useRef<HTMLDivElement>(null);
  // Read the live range when visibility changes: selectionchange may still be queued.
  const retainText = inView || selectionIntersects(textContainer.current);
  const originalViewport = page?.getViewport({ scale: 1 });
  const scale = originalViewport ? width / originalViewport.width : 1;
  const height = originalViewport
    ? originalViewport.height * scale
    : width / initialAspectRatio;

  useEffect(() => {
    if (!inView || page) return;
    let cancelled = false;
    pdf.getPage(pageNumber).then(
      (loaded) => {
        if (!cancelled) setPage(loaded);
        else loaded.cleanup();
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [inView, page, pageNumber, pdf]);

  useEffect(() => {
    if (!page || !inView || !canvasContainer.current) return;
    const viewport = page.getViewport({ scale });
    // Bitmaps can always be released offscreen, even while text is selected.
    const canvas = document.createElement("canvas");
    const pixelScale = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
    );
    canvas.width = Math.floor(viewport.width * pixelScale);
    canvas.height = Math.floor(viewport.height * pixelScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvasContainer.current.replaceChildren(canvas);
    const context = canvas.getContext("2d");
    if (!context) {
      setError(true);
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      return;
    }
    const task = page.render({
      canvasContext: context,
      viewport,
      transform: [pixelScale, 0, 0, pixelScale, 0, 0],
    });
    let cancelled = false;
    task.promise.catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      task.cancel();
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    };
  }, [page, scale, inView]);

  useEffect(() => {
    if (inView || !retainText) return;
    const ownerDocument = textContainer.current?.ownerDocument;
    const onSelectionChange = () => updateSelection((version) => version + 1);
    ownerDocument?.addEventListener("selectionchange", onSelectionChange);
    return () =>
      ownerDocument?.removeEventListener("selectionchange", onSelectionChange);
  }, [inView, retainText]);

  useEffect(() => {
    const container = textContainer.current;
    setTextReady(false);
    if (!page || !container || !retainText) return;
    container.replaceChildren();
    const textLayer = new library.TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport: page.getViewport({ scale }),
    });
    let cancelled = false;
    textLayer.render().then(
      () => {
        if (!cancelled) setTextReady(true);
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
      textLayer.cancel();
      container.replaceChildren();
    };
  }, [page, scale, library, retainText]);

  useEffect(() => {
    // PDF.js caches the proxy; release its render data without losing page geometry.
    // cleanup() defers safely while a canceled render is still settling.
    if (!inView) page?.cleanup();
  }, [page, inView]);

  useEffect(
    () => () => {
      page?.cleanup();
    },
    [page],
  );

  return (
    <div
      ref={ref}
      data-pdf-page={pageNumber}
      role="group"
      aria-label={`Page ${pageNumber}`}
      className="relative shrink-0 bg-white shadow"
      style={{ width, height, "--scale-factor": scale } as CSSProperties}
    >
      <div ref={canvasContainer} aria-hidden="true" />
      <div
        ref={textContainer}
        data-pdf-text-layer
        data-ready={textReady}
        className={cn("textLayer", styles.textLayer)}
      />
      <div className="pointer-events-none absolute inset-0">
        {highlights.flatMap(
          (highlight) =>
            highlight.pdfAnchor?.rects.flatMap((rect, index) => {
              if (rect.pageNumber !== pageNumber) return [];
              const rectangleStyle = {
                left: `${rect.left * 100}%`,
                top: `${rect.top * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              };
              const className = cn(
                "absolute opacity-50 mix-blend-multiply",
                HIGHLIGHT_COLOR_MAP.bg[highlight.color],
              );
              return !readOnly && index === 0 ? (
                <button
                  key={`${highlight.id}-${index}`}
                  type="button"
                  data-pdf-highlight-id={highlight.id}
                  aria-label={`Edit highlight: ${highlight.text ?? ""}`}
                  className={cn(
                    className,
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700",
                  )}
                  style={rectangleStyle}
                  onClick={(event) =>
                    onEditHighlight(
                      highlight,
                      event.currentTarget.getBoundingClientRect(),
                    )
                  }
                />
              ) : (
                <span
                  key={`${highlight.id}-${index}`}
                  data-pdf-highlight-id={highlight.id}
                  aria-hidden="true"
                  className={className}
                  style={rectangleStyle}
                />
              );
            }) ?? [],
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="absolute inset-x-0 top-4 p-4 text-center text-red-700"
        >
          Could not render page {pageNumber}. Use “Open PDF” to view the
          original.
        </p>
      )}
    </div>
  );
}
