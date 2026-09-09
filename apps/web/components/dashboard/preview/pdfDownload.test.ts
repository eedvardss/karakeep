import { expect, it, vi } from "vitest";

import { finishPdfDownload } from "../../../../mobile/components/bookmarks/pdfDownload";

it.each([401, 403, 404, 500])(
  "rejects HTTP %s and removes its downloaded error body",
  async (status) => {
    const remove = vi.fn(async () => undefined);
    await expect(
      finishPdfDownload(
        Promise.resolve({
          info: () => ({ status }),
          path: () => "/temporary.pdf",
        }),
        remove,
        () => false,
      ),
    ).rejects.toThrow();
    expect(remove).toHaveBeenCalledOnce();
  },
);

it("removes a successful download that finishes after the viewer is cancelled", async () => {
  const remove = vi.fn(async () => undefined);
  await expect(
    finishPdfDownload(
      Promise.resolve({
        info: () => ({ status: 200 }),
        path: () => "/temporary.pdf",
      }),
      remove,
      () => true,
    ),
  ).rejects.toThrow("cancelled");
  expect(remove).toHaveBeenCalledOnce();
});

it("keeps a successful PDF available until its owner cleans it up", async () => {
  const remove = vi.fn(async () => undefined);
  await expect(
    finishPdfDownload(
      Promise.resolve({
        info: () => ({ status: 200 }),
        path: () => "/temporary.pdf",
      }),
      remove,
      () => false,
    ),
  ).resolves.toBe("/temporary.pdf");
  expect(remove).not.toHaveBeenCalled();
});
