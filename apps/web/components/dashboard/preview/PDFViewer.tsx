"use client";

import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";

import PDFHighlighter from "@karakeep/shared-react/components/pdf/PDFHighlighter";
import {
  useCreateHighlight,
  useDeleteHighlight,
  useUpdateHighlight,
} from "@karakeep/shared-react/hooks/highlights";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";

export default function PDFViewer({
  bookmarkId,
  assetId,
  readOnly,
}: {
  bookmarkId: string;
  assetId: string;
  readOnly: boolean;
}) {
  const api = useTRPC();
  const [highlightId] = useQueryState("highlight");
  const { data, isError } = useQuery(
    api.highlights.getForBookmark.queryOptions({ bookmarkId }),
  );
  const create = useCreateHighlight();
  const update = useUpdateHighlight();
  const remove = useDeleteHighlight();
  const url = getAssetUrl(assetId);
  return (
    <PDFHighlighter
      key={`${bookmarkId}:${assetId}`}
      assetId={assetId}
      readOnly={readOnly}
      highlightId={highlightId}
      highlights={data?.highlights ?? []}
      highlightsError={isError}
      originalUrl={url}
      loadDocument={async () => {
        const library = await import("pdfjs-dist");
        library.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        return { library, task: library.getDocument({ url }) };
      }}
      onCreate={async (highlight) => {
        await create.mutateAsync({
          ...highlight,
          bookmarkId,
          startOffset: 0,
          endOffset: highlight.text.length,
        });
      }}
      onUpdate={async (highlightId, color, note) => {
        await update.mutateAsync({ highlightId, color, note });
      }}
      onDelete={async (highlightId) => {
        await remove.mutateAsync({ highlightId });
      }}
    />
  );
}
