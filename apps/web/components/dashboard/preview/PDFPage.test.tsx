// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  mockAllIsIntersecting,
  mockIsIntersecting,
  resetIntersectionMocking,
  setupIntersectionMocking,
} from "react-intersection-observer/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import PDFPage from "@karakeep/shared-react/components/pdf/PDFPage";
import type { PdfLibrary } from "@karakeep/shared-react/components/pdf/PDFPage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type TextJob = ReturnType<typeof deferred<void>> & {
  cancel: ReturnType<typeof vi.fn>;
  node: HTMLSpanElement;
};

let textJobs: TextJob[];
let holdText: boolean;

class TestTextLayer {
  job: TextJob;

  constructor({
    container,
    textContentSource,
  }: {
    container: HTMLElement;
    textContentSource: { pageNumber: number };
  }) {
    const node = document.createElement("span");
    node.textContent = `Page ${textContentSource.pageNumber} selectable text.`;
    container.append(node);
    this.job = { ...deferred<void>(), cancel: vi.fn(), node };
    textJobs.push(this.job);
  }

  render() {
    if (!holdText) this.job.resolve();
    return this.job.promise;
  }

  cancel() {
    this.job.cancel();
  }
}

const library = { TextLayer: TestTextLayer } as unknown as PdfLibrary;

function makePage(pageNumber: number, width = 400, height = 500) {
  const renderJob = deferred<void>();
  const cancel = vi.fn();
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    })),
    streamTextContent: vi.fn(() => ({ pageNumber })),
    render: vi.fn(() => ({ promise: renderJob.promise, cancel })),
    cleanup: vi.fn(() => true),
    renderJob,
    cancel,
  };
}

function fixture(pages = [makePage(1)]) {
  const getPage = vi.fn(async (pageNumber: number) => pages[pageNumber - 1]);
  const pdf = { getPage } as unknown as PDFDocumentProxy;
  const result = render(
    <>
      {pages.map((_, index) => (
        <PDFPage
          key={index}
          pdf={pdf}
          library={library}
          pageNumber={index + 1}
          width={400}
          initialAspectRatio={0.8}
          highlights={[]}
          readOnly={false}
          onEditHighlight={vi.fn()}
        />
      ))}
    </>,
  );
  const elements = [
    ...result.container.querySelectorAll<HTMLElement>("[data-pdf-page]"),
  ];
  const layers = elements.map(
    (element) => element.querySelector<HTMLElement>("[data-pdf-text-layer]")!,
  );
  return { ...result, getPage, elements, layers };
}

async function showAll(layers: HTMLElement[]) {
  act(() => mockAllIsIntersecting(true));
  await waitFor(() => {
    for (const layer of layers) expect(layer.dataset.ready).toBe("true");
  });
}

beforeEach(() => {
  setupIntersectionMocking(vi.fn);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  textJobs = [];
  holdText = false;
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  resetIntersectionMocking();
  vi.restoreAllMocks();
});

it("releases offscreen text and rendering resources without moving the page", async () => {
  const page = makePage(1, 800, 400);
  const { elements, layers } = fixture([page]);
  await showAll(layers);
  const canvas = elements[0].querySelector("canvas")!;
  const text = layers[0].firstChild;
  expect(elements[0].style.height).toBe("200px");

  act(() => mockAllIsIntersecting(false));

  expect(layers[0].childNodes).toHaveLength(0);
  expect(layers[0].dataset.ready).toBe("false");
  expect(text?.isConnected).toBe(false);
  expect(canvas.isConnected).toBe(false);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
  expect(page.cancel).toHaveBeenCalled();
  expect(textJobs[0].cancel).toHaveBeenCalled();
  expect(page.cleanup).toHaveBeenCalled();
  expect(elements[0].style.height).toBe("200px");
});

it("preserves the exact selected text nodes on every intersected page until selection clears", async () => {
  const pages = [makePage(1), makePage(2), makePage(3)];
  const { elements, layers } = fixture(pages);
  await showAll(layers);
  const nodes = layers.map((layer) => layer.firstChild!);
  const selection = document.getSelection()!;
  const range = document.createRange();
  range.setStart(nodes[0].firstChild!, 5);
  range.setEnd(nodes[2].firstChild!, 12);
  selection.addRange(range);
  const selected = selection.toString();

  // Scroll may arrive before the browser dispatches selectionchange.
  act(() => mockAllIsIntersecting(false));
  for (let index = 0; index < layers.length; index++) {
    expect(layers[index].firstChild).toBe(nodes[index]);
    expect(textJobs[index].cancel).not.toHaveBeenCalled();
    expect(pages[index].cleanup).toHaveBeenCalled();
  }
  expect(selection.toString()).toBe(selected);

  // Re-entering a selected page must not replace its live Range endpoints.
  act(() => mockIsIntersecting(elements[1], true));
  expect(layers[1].firstChild).toBe(nodes[1]);
  expect(selection.toString()).toBe(selected);
  act(() => mockIsIntersecting(elements[1], false));

  act(() => {
    selection.removeAllRanges();
    fireEvent(document, new Event("selectionchange"));
  });
  for (const layer of layers) {
    expect(layer.childNodes).toHaveLength(0);
    expect(layer.dataset.ready).toBe("false");
  }
});

it("releases pages that a still-active selection no longer intersects", async () => {
  const { layers } = fixture([makePage(1), makePage(2), makePage(3)]);
  await showAll(layers);
  const selection = document.getSelection()!;
  const range = document.createRange();
  range.setStart(layers[0].firstChild!.firstChild!, 0);
  range.setEnd(layers[2].firstChild!.firstChild!, 12);
  selection.addRange(range);
  act(() => mockAllIsIntersecting(false));
  const third = layers[2].firstChild;

  act(() => {
    range.setStart(third!.firstChild!, 0);
    fireEvent(document, new Event("selectionchange"));
  });

  expect(layers[0].childNodes).toHaveLength(0);
  expect(layers[1].childNodes).toHaveLength(0);
  expect(layers[2].firstChild).toBe(third);
  expect(selection.toString()).toBe("Page 3 selec");
});

it("recreates evicted text on re-entry using the same page dimensions", async () => {
  const page = makePage(1, 800, 400);
  const { getPage, elements, layers } = fixture([page]);
  await showAll(layers);
  const first = layers[0].firstChild;
  act(() => mockAllIsIntersecting(false));
  await showAll(layers);

  expect(layers[0].firstChild).not.toBe(first);
  expect(layers[0].textContent).toBe("Page 1 selectable text.");
  expect(elements[0].querySelector("canvas")).not.toBeNull();
  expect(elements[0].style.height).toBe("200px");
  expect(getPage).toHaveBeenCalledTimes(1);
});

it("cleans a page whose request resolves after it leaves the viewport", async () => {
  const page = makePage(1);
  const request = deferred<PDFPageProxy>();
  const pdf = {
    getPage: vi.fn(() => request.promise),
  } as unknown as PDFDocumentProxy;
  const { container, queryByRole } = render(
    <PDFPage
      pdf={pdf}
      library={library}
      pageNumber={1}
      width={400}
      initialAspectRatio={0.8}
      highlights={[]}
      readOnly={false}
      onEditHighlight={vi.fn()}
    />,
  );
  act(() => mockAllIsIntersecting(true));
  act(() => mockAllIsIntersecting(false));
  await act(async () => request.resolve(page as unknown as PDFPageProxy));

  expect(page.cleanup).toHaveBeenCalled();
  expect(page.render).not.toHaveBeenCalled();
  expect(textJobs).toHaveLength(0);
  expect(container.querySelector("canvas")).toBeNull();
  expect(queryByRole("alert")).toBeNull();
});

it("ignores canceled render failures and late text completion after eviction", async () => {
  holdText = true;
  const page = makePage(1);
  const { layers, queryByRole } = fixture([page]);
  act(() => mockAllIsIntersecting(true));
  await waitFor(() => expect(textJobs).toHaveLength(1));
  act(() => mockAllIsIntersecting(false));
  await act(async () => {
    page.renderJob.reject(new Error("Rendering cancelled"));
    textJobs[0].resolve();
  });

  expect(layers[0].childNodes).toHaveLength(0);
  expect(layers[0].dataset.ready).toBe("false");
  expect(queryByRole("alert")).toBeNull();
});

it("releases active tasks and page resources on unmount", async () => {
  const page = makePage(1);
  const { layers, unmount } = fixture([page]);
  await showAll(layers);
  const text = layers[0].firstChild!;
  unmount();

  expect(page.cancel).toHaveBeenCalled();
  expect(textJobs[0].cancel).toHaveBeenCalled();
  expect(text.isConnected).toBe(false);
  expect(page.cleanup).toHaveBeenCalled();
});
