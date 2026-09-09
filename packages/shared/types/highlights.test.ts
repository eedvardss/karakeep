import { describe, expect, test } from "vitest";

import {
  zHighlightSchema,
  zNewHighlightSchema,
  zPdfHighlightAnchorSchema,
} from "./highlights";

const rect = {
  pageNumber: 1,
  left: 0.1,
  top: 0.2,
  width: 0.3,
  height: 0.04,
};
const anchor = { assetId: "pdf-asset", rects: [rect] };
const legacyHighlight = {
  bookmarkId: "bookmark",
  startOffset: 10,
  endOffset: 25,
  text: "Selected text",
  note: null,
};

describe("PDF highlight anchors", () => {
  test("accepts normalized rectangles on multiple pages", () => {
    const input = {
      ...anchor,
      rects: [rect, { ...rect, pageNumber: 2, top: 0.1 }],
    };
    expect(zPdfHighlightAnchorSchema.parse(input)).toEqual(input);
    expect(
      zNewHighlightSchema.parse({ ...legacyHighlight, pdfAnchor: input }),
    ).toMatchObject({ pdfAnchor: input });
  });

  test("accepts page edges and floating-point rounding at the page boundary", () => {
    for (const edge of [
      { ...rect, left: 0, top: 0, width: 1, height: 1 },
      { ...rect, left: 0.8, width: 0.2000005 },
    ]) {
      expect(
        zPdfHighlightAnchorSchema.safeParse({ ...anchor, rects: [edge] })
          .success,
      ).toBe(true);
    }
  });

  test.each<[string, Partial<typeof rect>]>([
    ["zero page", { pageNumber: 0 }],
    ["fractional page", { pageNumber: 1.5 }],
    ["negative left", { left: -0.01 }],
    ["left beyond page", { left: 1.01 }],
    ["negative top", { top: -0.01 }],
    ["top beyond page", { top: 1.01 }],
    ["zero width", { width: 0 }],
    ["width beyond page", { width: 1.01 }],
    ["zero height", { height: 0 }],
    ["height beyond page", { height: 1.01 }],
    ["right edge beyond page", { left: 0.9, width: 0.2 }],
    ["bottom edge beyond page", { top: 0.9, height: 0.2 }],
    ["nonfinite coordinate", { left: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_name, invalid) => {
    expect(
      zPdfHighlightAnchorSchema.safeParse({
        ...anchor,
        rects: [{ ...rect, ...invalid }],
      }).success,
    ).toBe(false);
  });

  test("requires an asset and at least one rectangle", () => {
    expect(
      zPdfHighlightAnchorSchema.safeParse({ ...anchor, assetId: "" }).success,
    ).toBe(false);
    expect(
      zPdfHighlightAnchorSchema.safeParse({ ...anchor, rects: [] }).success,
    ).toBe(false);
  });

  test("keeps legacy input and output valid with an omitted or null anchor", () => {
    for (const input of [
      legacyHighlight,
      { ...legacyHighlight, pdfAnchor: null },
    ]) {
      expect(zNewHighlightSchema.parse(input)).toEqual({
        ...input,
        color: "yellow",
      });
      const output = {
        ...input,
        id: "highlight",
        userId: "user",
        createdAt: new Date(0),
      };
      expect(zHighlightSchema.parse(output)).toEqual({
        ...output,
        color: "yellow",
      });
    }
  });
});
