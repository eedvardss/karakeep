import { beforeEach, describe, expect, test } from "vitest";

import { assets, AssetTypes } from "@karakeep/db/schema";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach, getApiCaller } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));

const pdfAnchor = {
  assetId: "highlight-pdf",
  rects: [
    { pageNumber: 1, left: 0.1, top: 0.2, width: 0.3, height: 0.04 },
    { pageNumber: 1, left: 0.1, top: 0.25, width: 0.2, height: 0.04 },
    { pageNumber: 2, left: 0.15, top: 0.1, width: 0.4, height: 0.03 },
  ],
};

async function createPdfBookmark(
  { apiCallers, db }: Pick<CustomTestContext, "apiCallers" | "db">,
  type: "asset" | "link" = "asset",
  assetId = pdfAnchor.assetId,
) {
  const caller = apiCallers[0];
  const user = await caller.users.whoami();
  await db.insert(assets).values({
    id: assetId,
    assetType: AssetTypes.USER_UPLOADED,
    contentType: "application/pdf",
    userId: user.id,
  });
  if (type === "asset") {
    return caller.bookmarks.createBookmark({
      type: BookmarkTypes.ASSET,
      assetType: "pdf",
      assetId,
      fileName: "highlight-fixture.pdf",
    });
  }
  const bookmark = await caller.bookmarks.createBookmark({
    type: BookmarkTypes.LINK,
    url: "https://example.com/highlight-fixture.pdf",
  });
  await caller.assets.attachAsset({
    bookmarkId: bookmark.id,
    asset: { id: assetId, assetType: "pdf" },
  });
  return bookmark;
}

describe("Highlight Routes", () => {
  test<CustomTestContext>("create highlight", async ({ apiCallers }) => {
    const api = apiCallers[0].highlights;
    const bookmarksApi = apiCallers[0].bookmarks;

    // First, create a valid bookmark
    const bookmark = await bookmarksApi.createBookmark({
      url: "https://example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkId = bookmark.id;

    const highlight = await api.create({
      bookmarkId,
      startOffset: 10,
      endOffset: 20,
      color: "yellow",
      text: "Test highlight text",
      note: "Test note",
    });

    const res = await api.get({ highlightId: highlight.id });
    expect(res.bookmarkId).toEqual(bookmarkId);
    expect(res.startOffset).toEqual(10);
    expect(res.endOffset).toEqual(20);
    expect(res.color).toEqual("yellow");
    expect(res.text).toEqual("Test highlight text");
    expect(res.note).toEqual("Test note");
    expect(res.pdfAnchor).toBeNull();
  });

  test<CustomTestContext>("persists PDF rectangles through create and fresh API reads", async ({
    apiCallers,
    db,
  }) => {
    const bookmark = await createPdfBookmark({ apiCallers, db });
    const created = await apiCallers[0].highlights.create({
      bookmarkId: bookmark.id,
      startOffset: 0,
      endOffset: 24,
      color: "yellow",
      text: "Text spanning PDF pages",
      note: "Original note",
      pdfAnchor,
    });
    expect(created.pdfAnchor).toEqual(pdfAnchor);

    // A new caller reads the migrated SQLite row, rather than a client-side cached highlight.
    const user = await apiCallers[0].users.whoami();
    const reloaded = getApiCaller(
      db,
      user.id,
      user.email ?? undefined,
    ).highlights;
    expect((await reloaded.get({ highlightId: created.id })).pdfAnchor).toEqual(
      pdfAnchor,
    );
    const forBookmark = await reloaded.getForBookmark({
      bookmarkId: bookmark.id,
    });
    expect(forBookmark.highlights).toContainEqual(created);
    expect((await reloaded.getAll({})).highlights).toContainEqual(created);
    expect(
      (await reloaded.search({ text: "spanning" })).highlights,
    ).toContainEqual(created);
  });

  test<CustomTestContext>("preserves PDF anchors when editing color and notes, then deletes normally", async ({
    apiCallers,
    db,
  }) => {
    const bookmark = await createPdfBookmark({ apiCallers, db });
    const api = apiCallers[0].highlights;
    const created = await api.create({
      bookmarkId: bookmark.id,
      startOffset: 0,
      endOffset: 8,
      text: "PDF text",
      note: null,
      pdfAnchor,
    });
    expect(
      await api.update({ highlightId: created.id, color: "blue" }),
    ).toMatchObject({
      color: "blue",
      note: null,
      pdfAnchor,
    });
    await api.update({ highlightId: created.id, note: "Updated note" });
    expect(await api.get({ highlightId: created.id })).toMatchObject({
      color: "blue",
      note: "Updated note",
      pdfAnchor,
    });
    await api.update({ highlightId: created.id, note: null });
    expect(await api.get({ highlightId: created.id })).toMatchObject({
      color: "blue",
      note: null,
      pdfAnchor,
    });
    expect((await api.delete({ highlightId: created.id })).pdfAnchor).toEqual(
      pdfAnchor,
    );
    await expect(api.get({ highlightId: created.id })).rejects.toThrow(
      /Highlight not found/,
    );
    expect(
      (await api.getForBookmark({ bookmarkId: bookmark.id })).highlights,
    ).toEqual([]);
  });

  test<CustomTestContext>("supports a PDF attached to a bookmarked link", async ({
    apiCallers,
    db,
  }) => {
    const bookmark = await createPdfBookmark({ apiCallers, db }, "link");
    const api = apiCallers[0].highlights;
    const created = await api.create({
      bookmarkId: bookmark.id,
      startOffset: 0,
      endOffset: 8,
      text: "PDF text",
      note: null,
      pdfAnchor,
    });
    expect(
      (await api.getForBookmark({ bookmarkId: bookmark.id })).highlights,
    ).toContainEqual(created);
    expect((await api.get({ highlightId: created.id })).pdfAnchor).toEqual(
      pdfAnchor,
    );
  });

  for (const invalidAsset of [
    "missing",
    "unattached",
    "another bookmark",
    "screenshot",
    "image bookmark",
    "non-primary PDF",
    "text bookmark",
  ] as const) {
    test<CustomTestContext>(`rejects an anchor for ${invalidAsset} without storing a highlight`, async ({
      apiCallers,
      db,
    }) => {
      const caller = apiCallers[0];
      const user = await caller.users.whoami();
      let bookmarkId: string;
      let assetId = pdfAnchor.assetId;

      if (invalidAsset === "another bookmark") {
        await createPdfBookmark({ apiCallers, db });
        bookmarkId = (
          await createPdfBookmark({ apiCallers, db }, "asset", "other-pdf")
        ).id;
      } else if (invalidAsset === "non-primary PDF") {
        bookmarkId = (await createPdfBookmark({ apiCallers, db })).id;
        assetId = "secondary-pdf";
        await db.insert(assets).values({
          id: assetId,
          assetType: AssetTypes.USER_UPLOADED,
          contentType: "application/pdf",
          userId: user.id,
        });
        await caller.assets.attachAsset({
          bookmarkId,
          asset: { id: assetId, assetType: "pdf" },
        });
      } else {
        if (invalidAsset !== "missing") {
          await db.insert(assets).values({
            id: assetId,
            assetType: AssetTypes.USER_UPLOADED,
            contentType:
              invalidAsset === "screenshot" || invalidAsset === "image bookmark"
                ? "image/png"
                : "application/pdf",
            userId: user.id,
          });
        }
        const bookmark = await caller.bookmarks.createBookmark(
          invalidAsset === "image bookmark"
            ? { type: BookmarkTypes.ASSET, assetType: "image", assetId }
            : invalidAsset === "text bookmark"
              ? { type: BookmarkTypes.TEXT, text: "Plain text bookmark" }
              : { type: BookmarkTypes.LINK, url: "https://example.com/target" },
        );
        bookmarkId = bookmark.id;
        if (invalidAsset === "screenshot" || invalidAsset === "text bookmark") {
          await caller.assets.attachAsset({
            bookmarkId,
            asset: {
              id: assetId,
              assetType: invalidAsset === "screenshot" ? "screenshot" : "pdf",
            },
          });
        }
      }

      await expect(
        caller.highlights.create({
          bookmarkId,
          startOffset: 0,
          endOffset: 8,
          text: "PDF text",
          note: null,
          pdfAnchor: { ...pdfAnchor, assetId },
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "PDF anchor must reference a PDF attached to this bookmark",
      });
      expect(await db.query.highlights.findMany()).toEqual([]);
    });
  }

  test<CustomTestContext>("accepts a linked PDF classified by its attachment without MIME metadata", async ({
    apiCallers,
    db,
  }) => {
    const caller = apiCallers[0];
    const user = await caller.users.whoami();
    const bookmark = await caller.bookmarks.createBookmark({
      type: BookmarkTypes.LINK,
      url: "https://example.com/legacy-pdf",
    });
    await db.insert(assets).values({
      id: pdfAnchor.assetId,
      assetType: AssetTypes.LINK_PDF,
      bookmarkId: bookmark.id,
      userId: user.id,
      contentType: null,
    });
    const created = await caller.highlights.create({
      bookmarkId: bookmark.id,
      startOffset: 0,
      endOffset: 8,
      text: "PDF text",
      note: null,
      pdfAnchor,
    });
    expect(created.pdfAnchor).toEqual(pdfAnchor);
    expect(
      (await caller.highlights.get({ highlightId: created.id })).pdfAnchor,
    ).toEqual(pdfAnchor);
  });

  test<CustomTestContext>("accepts an explicit null anchor from a legacy client", async ({
    apiCallers,
  }) => {
    const bookmark = await apiCallers[0].bookmarks.createBookmark({
      type: BookmarkTypes.TEXT,
      text: "Legacy text",
    });
    const highlight = await apiCallers[0].highlights.create({
      bookmarkId: bookmark.id,
      startOffset: 0,
      endOffset: 6,
      text: "Legacy",
      note: null,
      pdfAnchor: null,
    });
    expect(highlight.pdfAnchor).toBeNull();
  });

  test<CustomTestContext>("delete highlight", async ({ apiCallers }) => {
    const api = apiCallers[0].highlights;
    const bookmarksApi = apiCallers[0].bookmarks;

    // First, create a valid bookmark
    const bookmark = await bookmarksApi.createBookmark({
      url: "https://example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkId = bookmark.id;

    // Create the highlight first
    const highlight = await api.create({
      bookmarkId,
      startOffset: 10,
      endOffset: 20,
      color: "yellow",
      text: "Test highlight text",
      note: "Test note",
    });

    // It should exist
    await api.get({ highlightId: highlight.id });

    // Delete it
    await api.delete({ highlightId: highlight.id });

    // It shouldn't be there anymore
    await expect(() => api.get({ highlightId: highlight.id })).rejects.toThrow(
      /Highlight not found/,
    );
  });

  test<CustomTestContext>("update highlight", async ({ apiCallers }) => {
    const api = apiCallers[0].highlights;
    const bookmarksApi = apiCallers[0].bookmarks;

    // First, create a valid bookmark
    const bookmark = await bookmarksApi.createBookmark({
      url: "https://example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkId = bookmark.id;

    // Create the highlight
    const highlight = await api.create({
      bookmarkId,
      startOffset: 10,
      endOffset: 20,
      color: "yellow",
      text: "Original text",
      note: "Original note",
    });

    await api.update({
      highlightId: highlight.id,
      color: "blue",
    });

    const res = await api.get({ highlightId: highlight.id });
    expect(res.color).toEqual("blue");
    expect(res.text).toEqual("Original text"); // Only color is updated in the router
  });

  test<CustomTestContext>("get highlight", async ({ apiCallers }) => {
    const api = apiCallers[0].highlights;
    const bookmarksApi = apiCallers[0].bookmarks;

    // First, create a valid bookmark
    const bookmark = await bookmarksApi.createBookmark({
      url: "https://example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkId = bookmark.id;

    // Create the highlight
    const createdHighlight = await api.create({
      bookmarkId,
      startOffset: 10,
      endOffset: 20,
      color: "yellow",
      text: "Test text",
      note: "Test note",
    });

    const res = await api.get({ highlightId: createdHighlight.id });
    expect(res.id).toEqual(createdHighlight.id);
    expect(res.bookmarkId).toEqual(bookmarkId);
  });

  test<CustomTestContext>("get highlights for bookmark", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0].highlights;
    const bookmarksApi = apiCallers[0].bookmarks;
    const bookmark = await bookmarksApi.createBookmark({
      url: "https://example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkId = bookmark.id;

    const highlight1 = await api.create({
      bookmarkId,
      startOffset: 10,
      endOffset: 20,
      color: "yellow",
      text: "Highlight 1",
      note: "",
    });

    const highlight2 = await api.create({
      bookmarkId,
      startOffset: 30,
      endOffset: 40,
      color: "blue",
      text: "Highlight 2",
      note: "",
    });

    const res = await api.getForBookmark({ bookmarkId });
    expect(res.highlights.length).toBeGreaterThanOrEqual(2);
    expect(res.highlights.some((h) => h.id === highlight1.id)).toBeTruthy();
    expect(res.highlights.some((h) => h.id === highlight2.id)).toBeTruthy();
  });

  test<CustomTestContext>("get all highlights with pagination", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0].highlights;
    const bookmarksApi = apiCallers[0].bookmarks;
    const bookmark = await bookmarksApi.createBookmark({
      url: "https://example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkId = bookmark.id;

    // Create multiple highlights
    await api.create({
      bookmarkId,
      startOffset: 10,
      endOffset: 20,
      color: "yellow",
      text: "Highlight 1",
      note: "",
    });
    await api.create({
      bookmarkId,
      startOffset: 30,
      endOffset: 40,
      color: "blue",
      text: "Highlight 2",
      note: "",
    });
    await api.create({
      bookmarkId,
      startOffset: 50,
      endOffset: 60,
      color: "green",
      text: "Highlight 3",
      note: "",
    });

    const res = await api.getAll({ limit: 2 });
    expect(res.highlights.length).toEqual(2);
    expect(res.nextCursor).toBeDefined(); // Should have a next cursor
  });

  test<CustomTestContext>("privacy for highlights", async ({ apiCallers }) => {
    const apiUser1 = apiCallers[0].highlights;
    const apiUser2 = apiCallers[1].highlights;
    const bookmarksApiUser1 = apiCallers[0].bookmarks;
    const bookmarksApiUser2 = apiCallers[1].bookmarks;

    const bookmarkUser1 = await bookmarksApiUser1.createBookmark({
      url: "https://user1-example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkIdUser1 = bookmarkUser1.id;

    const bookmarkUser2 = await bookmarksApiUser2.createBookmark({
      url: "https://user2-example.com",
      type: BookmarkTypes.LINK,
    });
    const bookmarkIdUser2 = bookmarkUser2.id;

    const highlightUser1 = await apiUser1.create({
      bookmarkId: bookmarkIdUser1,
      startOffset: 10,
      endOffset: 20,
      color: "yellow",
      text: "User1 highlight",
      note: "",
    });

    const highlightUser2 = await apiUser2.create({
      bookmarkId: bookmarkIdUser2,
      startOffset: 10,
      endOffset: 20,
      color: "blue",
      text: "User2 highlight",
      note: "",
    });

    // User1 should not access User2's highlight
    await expect(() =>
      apiUser1.get({ highlightId: highlightUser2.id }),
    ).rejects.toThrow(/User is not allowed to access resource/);

    // User2 should not access User1's highlight
    await expect(() =>
      apiUser2.get({ highlightId: highlightUser1.id }),
    ).rejects.toThrow(/User is not allowed to access resource/);
  });
});
