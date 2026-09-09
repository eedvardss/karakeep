// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import PDFHighlighter from "@karakeep/shared-react/components/pdf/PDFHighlighter";
import type {
  LoadPdfDocument,
  NewPdfHighlight,
  PdfLibrary,
} from "@karakeep/shared-react/components/pdf/types";

vi.mock("@karakeep/shared-react/components/pdf/PDFPage", () => ({
  default: ({ pageNumber }: { pageNumber: number }) => (
    <div data-pdf-page={pageNumber}>
      <div data-pdf-text-layer>
        <span>
          {pageNumber === 1
            ? "Amber foxes cross the meadow."
            : "Second page text."}
        </span>
      </div>
    </div>
  ),
}));

let coarse = true;
let destroy: ReturnType<typeof vi.fn>;
let loader: LoadPdfDocument;

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: coarse }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(0, this.dataset.pdfPage === "2" ? 600 : 100, 400, 500);
    },
  );
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(20, 120, 160, 20),
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      const page =
        this.startContainer.parentElement?.closest<HTMLElement>(
          "[data-pdf-page]",
        );
      return [
        new DOMRect(20, page?.dataset.pdfPage === "2" ? 620 : 120, 160, 20),
      ];
    },
  });
  destroy = vi.fn(async () => undefined);
  loader = async () => ({
    library: {} as PdfLibrary,
    task: {
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({
          getViewport: () => ({ width: 400, height: 500 }),
        }),
      } as unknown as PDFDocumentProxy),
      destroy,
    } as unknown as PDFDocumentLoadingTask,
  });
});

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  coarse = true;
});

async function mount(readOnly = false) {
  const onCreate = vi.fn(async (_highlight: NewPdfHighlight) => undefined);
  const view = render(
    <PDFHighlighter
      assetId="asset"
      highlights={[]}
      readOnly={readOnly}
      loadDocument={loader}
      originalUrl="/asset.pdf"
      onCreate={onCreate}
      onUpdate={async () => undefined}
      onDelete={async () => undefined}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll("[data-pdf-page]")).toHaveLength(2),
  );
  return { ...view, onCreate };
}

function select(start: number, end: number, lastPage = 1) {
  const first = document.querySelector('[data-pdf-page="1"] span')!.firstChild!;
  const last = document.querySelector(
    `[data-pdf-page="${lastPage}"] span`,
  )!.firstChild!;
  const range = document.createRange();
  range.setStart(first, start);
  range.setEnd(last, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(document, new Event("selectionchange"));
}

it("waits for the touch action and captures the final adjusted cross-page range", async () => {
  const { onCreate } = await mount();
  select(0, 5);
  fireEvent.pointerUp(document.querySelector('[data-pdf-page="1"] span')!, {
    pointerType: "touch",
  });
  const action = await screen.findByRole("button", {
    name: "Highlight selection",
  });
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  // Native handles change the selection after pointerup. Do not wait for the
  // queued animation frame: the action must read the final live range itself.
  select(6, 6, 2);
  fireEvent.pointerDown(action, { pointerType: "touch" });
  window.getSelection()?.removeAllRanges();
  fireEvent.click(action);
  fireEvent.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  expect(onCreate.mock.calls[0][0]).toMatchObject({
    text: "foxes cross the meadow.\n\nSecond",
    pdfAnchor: {
      assetId: "asset",
      rects: [
        expect.objectContaining({ pageNumber: 1 }),
        expect.objectContaining({ pageNumber: 2 }),
      ],
    },
  });
});

it("removes the action when selection collapses and respects read-only mode", async () => {
  const view = await mount();
  select(0, 5);
  await screen.findByRole("button", { name: "Highlight selection" });
  window.getSelection()?.removeAllRanges();
  fireEvent(document, new Event("selectionchange"));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Highlight selection" }),
    ).toBeNull(),
  );
  view.unmount();
  await mount(true);
  select(0, 5);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(
    screen.queryByRole("button", { name: "Highlight selection" }),
  ).toBeNull();
});

it("keeps a failed native/API save editable and retries the same selection", async () => {
  const { onCreate } = await mount();
  onCreate.mockRejectedValueOnce(new Error("offline"));
  select(0, 11);
  fireEvent.click(
    await screen.findByRole("button", { name: "Highlight selection" }),
  );
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Highlight note" }),
    { target: { value: "Keep this note" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Could not save the highlight. Please try again.");
  expect(
    (
      screen.getByRole("textbox", {
        name: "Highlight note",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Keep this note");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  expect(onCreate.mock.calls[0]).toEqual(onCreate.mock.calls[1]);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull(),
  );
});

it("preserves immediate desktop selection and releases the PDF on unmount", async () => {
  coarse = false;
  const { unmount } = await mount();
  select(0, 11);
  fireEvent.pointerUp(document.querySelector('[data-pdf-page="1"] span')!, {
    pointerType: "mouse",
    clientX: 100,
    clientY: 150,
  });
  await screen.findByRole("button", { name: "Save" });
  expect(
    screen.queryByRole("button", { name: "Highlight selection" }),
  ).toBeNull();
  unmount();
  expect(destroy).toHaveBeenCalledOnce();
});

it("destroys a loading task that arrives after its viewer was unmounted", async () => {
  let resolve!: (value: Awaited<ReturnType<LoadPdfDocument>>) => void;
  const delayed = new Promise<Awaited<ReturnType<LoadPdfDocument>>>((done) => {
    resolve = done;
  });
  const task = await loader();
  loader = () => delayed;
  const view = render(
    <PDFHighlighter
      assetId="old"
      highlights={[]}
      loadDocument={loader}
      onCreate={async () => undefined}
      onUpdate={async () => undefined}
      onDelete={async () => undefined}
    />,
  );
  view.unmount();
  await act(async () => {
    resolve(task);
  });
  expect(destroy).toHaveBeenCalledOnce();
});
