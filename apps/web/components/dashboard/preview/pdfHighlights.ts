import type { ZPdfHighlightAnchor } from "@karakeep/shared/types/highlights";

type PdfRect = ZPdfHighlightAnchor["rects"][number];

export interface PdfSelection {
  text: string;
  pdfAnchor: ZPdfHighlightAnchor;
}

export function normalizePdfRect(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  page: Pick<DOMRect, "left" | "top" | "width" | "height">,
  pageNumber: number,
): PdfRect | null {
  if (page.width <= 0 || page.height <= 0) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const left = clamp((rect.left - page.left) / page.width);
  const top = clamp((rect.top - page.top) / page.height);
  const right = clamp((rect.right - page.left) / page.width);
  const bottom = clamp((rect.bottom - page.top) / page.height);
  if (right <= left || bottom <= top) return null;
  return { pageNumber, left, top, width: right - left, height: bottom - top };
}

/** Capture text fragments rather than a whole Range's block-level rectangles. */
export function getPdfSelection(
  container: HTMLElement,
  range: Range,
  assetId: string,
): PdfSelection | null {
  if (
    range.collapsed ||
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return null;
  }

  const rects: PdfRect[] = [];
  const pageTexts: string[] = [];
  for (const page of container.querySelectorAll<HTMLElement>(
    "[data-pdf-page]",
  )) {
    const layer = page.querySelector("[data-pdf-text-layer]");
    if (!layer || !range.intersectsNode(layer)) continue;
    const pageBounds = page.getBoundingClientRect();
    const pageNumber = Number(page.dataset.pdfPage);
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let pageText = "";
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue;
      const fragment = document.createRange();
      fragment.selectNodeContents(node);
      if (range.compareBoundaryPoints(Range.START_TO_START, fragment) > 0) {
        fragment.setStart(range.startContainer, range.startOffset);
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, fragment) < 0) {
        fragment.setEnd(range.endContainer, range.endOffset);
      }
      if (fragment.collapsed) continue;
      pageText += fragment.toString();
      if (node.parentElement?.nextElementSibling?.tagName === "BR") {
        pageText += "\n";
      }
      for (const rect of fragment.getClientRects()) {
        const normalized = normalizePdfRect(rect, pageBounds, pageNumber);
        if (normalized) rects.push(normalized);
      }
    }
    if (pageText.trim()) pageTexts.push(pageText.trim());
  }
  const text = pageTexts.join("\n\n");
  return text && rects.length ? { text, pdfAnchor: { assetId, rects } } : null;
}

export function containsPdfPoint(rect: PdfRect, x: number, y: number) {
  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
}
