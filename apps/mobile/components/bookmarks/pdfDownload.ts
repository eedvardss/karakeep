// A conservative transfer budget for the base64 DOM bridge, not a guarantee
// about a PDF's decoded memory use or every device's available memory.
export const PDF_HIGHLIGHTING_MAX_BYTES = 10_000_000;

export type PdfHighlightingBlockReason = "size-limit" | "unknown-size";

/** Check the completed cache file before mounting a DOM reader that reads it. */
export async function getPdfHighlightingBlockReason(
  path: string,
  stat: (path: string) => Promise<{ size: number }>,
): Promise<PdfHighlightingBlockReason | null> {
  try {
    const { size } = await stat(path);
    if (!Number.isSafeInteger(size) || size < 0) return "unknown-size";
    return size > PDF_HIGHLIGHTING_MAX_BYTES ? "size-limit" : null;
  } catch {
    // The original native reader can still try the file without a JS copy.
    return "unknown-size";
  }
}

/** Validate the native HTTP response before exposing its temporary file. */
export async function finishPdfDownload(
  download: Promise<{ info: () => { status: number }; path: () => string }>,
  removeTemporaryFile: () => Promise<void>,
  isCancelled: () => boolean,
) {
  try {
    const response = await download;
    const status = response.info().status;
    if (status < 200 || status >= 300) {
      if (status === 401 || status === 403)
        throw new Error("Authentication failed. Please sign in again.");
      if (status === 404) throw new Error("PDF not found.");
      throw new Error(`Could not download PDF (${status}).`);
    }
    if (isCancelled()) throw new Error("PDF download cancelled.");
    return response.path();
  } catch (error) {
    // A rejected/late request can still leave a partial file after unmount.
    await removeTemporaryFile();
    throw error;
  }
}
