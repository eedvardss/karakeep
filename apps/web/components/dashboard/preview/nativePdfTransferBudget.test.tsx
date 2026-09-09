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
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  path: "",
  stat: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  cancel: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("react-native", () => ({
  ActivityIndicator: () => <span>Loading</span>,
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
  }: {
    children: React.ReactNode;
    onPress: () => void;
  }) => <button onClick={onPress}>{children}</button>,
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
}));
vi.mock("../../../../mobile/components/ui/Text", () => ({
  Text: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("react-native-blob-util", () => ({
  default: {
    fs: {
      dirs: { CacheDir: "/cache" },
      stat: native.stat,
      readFile: native.readFile,
      unlink: native.unlink,
    },
    config: ({ path }: { path: string }) => {
      native.path = path;
      return { fetch: native.fetch };
    },
  },
}));
vi.mock("react-native-pdf", () => ({
  default: ({
    source,
    onError,
  }: {
    source: { uri: string };
    onError: () => void;
  }) => (
    <div data-testid="native-pdf" data-source={source.uri}>
      <button onClick={onError}>Simulate native render error</button>
    </div>
  ),
}));
vi.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light" }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { highlights: [] }, isError: false }),
}));
vi.mock("@karakeep/shared-react/trpc", () => ({
  useTRPC: () => ({
    highlights: { getForBookmark: { queryOptions: () => ({}) } },
  }),
}));
vi.mock("@karakeep/shared-react/hooks/highlights", () => ({
  useCreateHighlight: () => ({ mutateAsync: vi.fn() }),
  useUpdateHighlight: () => ({ mutateAsync: vi.fn() }),
  useDeleteHighlight: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../../../mobile/components/bookmarks/PDFHighlighterDom", () => ({
  default: function DomFixture({
    onLoadDocument,
    onOpenOriginal,
  }: {
    onLoadDocument: () => Promise<string>;
    onOpenOriginal: () => Promise<void>;
  }) {
    React.useEffect(() => {
      void onLoadDocument();
    }, [onLoadDocument]);
    return (
      <div data-testid="dom-highlighter">
        <button onClick={() => void onOpenOriginal()}>Open PDF</button>
      </div>
    );
  },
}));

// The web test runner supplies the native mocks; the mobile typecheck validates
// the component with its own NativeWind, worker and path-alias declarations.
const { PDFViewer } = await vi.importActual<{
  PDFViewer: React.ComponentType<{
    bookmarkId: string;
    assetId: string;
    source: string;
  }>;
}>("../../../../mobile/components/bookmarks/PDFViewer");

beforeEach(() => {
  vi.clearAllMocks();
  native.stat.mockResolvedValue({ size: 4_096 });
  native.readFile.mockResolvedValue("JVBERi0=");
  native.unlink.mockResolvedValue(undefined);
  native.fetch.mockImplementation(() =>
    Object.assign(
      Promise.resolve({
        info: () => ({ status: 200 }),
        path: () => native.path,
      }),
      { cancel: native.cancel },
    ),
  );
});
afterEach(cleanup);

function mount() {
  return render(
    <PDFViewer
      bookmarkId="fixture-bookmark"
      assetId="fixture-asset"
      source="http://localhost/fixture.pdf"
    />,
  );
}

async function prepared() {
  await waitFor(() =>
    expect(screen.queryByText("Downloading PDF...")).toBeNull(),
  );
}

it.each([4_096, 10_000_000])(
  "keeps a %i-byte PDF highlightable after inspecting its file size",
  async (size) => {
    native.stat.mockResolvedValue({ size });
    mount();
    await prepared();
    expect(screen.getByTestId("dom-highlighter")).toBeTruthy();
    expect(native.stat).toHaveBeenCalledWith(native.path);
    expect(native.readFile).toHaveBeenCalledWith(native.path, "base64");
    expect(native.stat.mock.invocationCallOrder[0]).toBeLessThan(
      native.readFile.mock.invocationCallOrder[0],
    );
  },
);

it("opens an over-budget file in the native reader without mounting DOM or allocating base64", async () => {
  native.stat.mockResolvedValue({ size: 10_000_001 });
  mount();
  await prepared();
  expect(native.readFile).not.toHaveBeenCalled();
  expect(screen.queryByTestId("dom-highlighter")).toBeNull();
  expect(screen.getByTestId("native-pdf").getAttribute("data-source")).toBe(
    `file://${native.path}`,
  );
  expect(screen.getByText(/10 MB/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Back to highlights" }),
  ).toBeNull();
});

it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, "4096"])(
  "uses the native reader when file size metadata is invalid (%s)",
  async (size) => {
    native.stat.mockResolvedValue({ size });
    mount();
    await prepared();
    expect(native.readFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dom-highlighter")).toBeNull();
    expect(screen.getByTestId("native-pdf")).toBeTruthy();
    expect(screen.getByText(/size could not be checked/)).toBeTruthy();
  },
);

it("keeps the native reader usable when stat rejects", async () => {
  native.stat.mockRejectedValue(new Error("File metadata unavailable"));
  mount();
  await prepared();
  expect(native.readFile).not.toHaveBeenCalled();
  expect(screen.getByTestId("native-pdf")).toBeTruthy();
  expect(screen.getByText(/size could not be checked/)).toBeTruthy();
});

it("does not start a base64 read before stat settles or after the viewer unmounts", async () => {
  let finish!: (stat: { size: number }) => void;
  native.stat.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const viewer = mount();
  await waitFor(() => expect(native.stat).toHaveBeenCalledOnce());
  expect(native.readFile).not.toHaveBeenCalled();
  expect(screen.queryByTestId("dom-highlighter")).toBeNull();
  viewer.unmount();
  await act(async () => {
    finish({ size: 4_096 });
  });
  expect(native.readFile).not.toHaveBeenCalled();
  expect(native.cancel).toHaveBeenCalledOnce();
  expect(native.unlink).toHaveBeenCalledWith(native.path);
});

it("preserves Open PDF and Back to highlights for normal files", async () => {
  mount();
  await prepared();
  fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
  expect(await screen.findByTestId("native-pdf")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to highlights" }));
  expect(await screen.findByTestId("dom-highlighter")).toBeTruthy();
});

it("shows a native renderer error without allowing an over-budget base64 retry", async () => {
  native.stat.mockResolvedValue({ size: 10_000_001 });
  mount();
  await prepared();
  fireEvent.click(
    screen.getByRole("button", { name: "Simulate native render error" }),
  );
  expect(screen.getByText("Failed to render PDF")).toBeTruthy();
  expect(screen.getByText(/10 MB/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Back to highlights" }),
  ).toBeNull();
  expect(native.readFile).not.toHaveBeenCalled();
});
