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
