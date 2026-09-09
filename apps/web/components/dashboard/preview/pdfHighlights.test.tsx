// @vitest-environment jsdom

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BookmarkHTMLHighlighter from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";

import {
  containsPdfPoint,
  getPdfSelection,
  normalizePdfRect,
} from "./pdfHighlights";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("PDF highlight geometry", () => {
  it("keeps a selection at the same page coordinates after zooming and scrolling", () => {
    const rect = normalizePdfRect(
      new DOMRect(80, 180, 100, 20),
      new DOMRect(20, 100, 200, 300),
      2,
    );
    const zoomed = normalizePdfRect(
      new DOMRect(170, 360, 200, 40),
      new DOMRect(50, 200, 400, 600),
      2,
    );
    expect(rect).toEqual(zoomed);
    expect(rect?.pageNumber).toBe(2);
    expect(rect?.left).toBeCloseTo(0.3);
    expect(rect?.width).toBeCloseTo(0.5);
    expect(rect && containsPdfPoint(rect, 0.5, 0.3)).toBe(true);
    expect(rect && containsPdfPoint(rect, 0.9, 0.3)).toBe(false);
  });

  it("clips text rectangles to the page and omits empty or unmeasured rectangles", () => {
    expect(
      normalizePdfRect(
        new DOMRect(0, 90, 80, 30),
        new DOMRect(20, 100, 200, 300),
        1,
      ),
    ).toMatchObject({
      left: 0,
      top: 0,
      width: 0.3,
    });
    expect(
      normalizePdfRect(
        new DOMRect(0, 0, 5, 5),
        new DOMRect(20, 100, 200, 300),
        1,
      ),
    ).toBeNull();
    expect(
      normalizePdfRect(new DOMRect(0, 0, 5, 5), new DOMRect(0, 0, 0, 0), 1),
    ).toBeNull();
  });
});

describe("PDF text selection", () => {
  let container: HTMLElement;
  let first: Text;
  let second: Text;
  const fragments: { text: string; start: number; end: number }[] = [];
  const originalRects = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getClientRects",
  );

  beforeEach(() => {
    document.body.innerHTML = `<div id="viewer">
      <div data-pdf-page="1"><div data-pdf-text-layer><span>A partial line</span><br></div><button>Unrelated page action</button></div>
      <div data-pdf-page="2"><div data-pdf-text-layer><span>Second page text</span></div></div>
    </div><p id="outside">Outside the PDF</p>`;
    container = document.getElementById("viewer")!;
    const pages = container.querySelectorAll<HTMLElement>("[data-pdf-page]");
    first = pages[0].querySelector("span")!.firstChild as Text;
    second = pages[1].querySelector("span")!.firstChild as Text;
    fragments.length = 0;
    pages.forEach((page, index) =>
      vi
        .spyOn(page, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(20, 100 + index * 320, 200, 300)),
    );
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: function (this: Range) {
        fragments.push({
          text: this.toString(),
          start: this.startOffset,
          end: this.endOffset,
        });
        return [
          new DOMRect(40, this.startContainer === first ? 120 : 440, 100, 20),
        ];
      },
    });
  });

  afterEach(() => {
    if (originalRects)
      Object.defineProperty(Range.prototype, "getClientRects", originalRects);
    else Reflect.deleteProperty(Range.prototype, "getClientRects");
  });

  it("saves clipped text fragments across pages without selecting page controls", () => {
    const range = document.createRange();
    range.setStart(first, 2);
    range.setEnd(second, 6);
    const selection = getPdfSelection(container, range, "pdf-asset");
    expect(selection?.text).toBe("partial line\n\nSecond");
    expect(selection?.pdfAnchor.assetId).toBe("pdf-asset");
    expect(selection?.pdfAnchor.rects.map((rect) => rect.pageNumber)).toEqual([
      1, 2,
    ]);
    expect(fragments).toEqual([
      { text: "partial line", start: 2, end: first.length },
      { text: "Second", start: 0, end: 6 },
    ]);
  });

  it("ignores a collapsed selection and a selection extending outside the viewer", () => {
    const range = document.createRange();
    range.setStart(first, 2);
    range.collapse(true);
    expect(getPdfSelection(container, range, "pdf-asset")).toBeNull();
    range.setEnd(document.getElementById("outside")!.firstChild!, 3);
    expect(getPdfSelection(container, range, "pdf-asset")).toBeNull();
  });
});

it("does not apply a PDF highlight's saved-text offsets to the HTML reader", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const { container } = render(
    <BookmarkHTMLHighlighter
      htmlContent="<p>Article text</p>"
      highlights={[
        {
          id: "pdf",
          startOffset: 0,
          endOffset: 7,
          color: "yellow",
          text: "PDF text",
          pdfAnchor: {
            assetId: "asset",
            rects: [
              { pageNumber: 1, left: 0, top: 0, width: 0.1, height: 0.1 },
            ],
          },
        },
        {
          id: "html",
          startOffset: 8,
          endOffset: 12,
          color: "blue",
          text: "text",
        },
      ]}
    />,
  );
  expect(container.querySelector('[data-highlight-id="pdf"]')).toBeNull();
  expect(
    container.querySelector('[data-highlight-id="html"]')?.textContent,
  ).toBe("text");
  vi.unstubAllGlobals();
});
