import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";
import Pdf from "react-native-pdf";
import { Text } from "@/components/ui/Text";
import { useQuery } from "@tanstack/react-query";
import { useColorScheme } from "nativewind";

import {
  useCreateHighlight,
  useDeleteHighlight,
  useUpdateHighlight,
} from "@karakeep/shared-react/hooks/highlights";
import { useTRPC } from "@karakeep/shared-react/trpc";

import PDFHighlighterDom from "./PDFHighlighterDom";
import { finishPdfDownload } from "./pdfDownload";

interface PDFViewerProps {
  bookmarkId: string;
  assetId: string;
  highlightId?: string;
  source: string;
  headers?: Record<string, string>;
}

export function PDFViewer(props: PDFViewerProps) {
  // Replacing the asset/server starts a new download and selection lifecycle.
  return (
    <PDFViewerContent
      key={`${props.bookmarkId}:${props.assetId}:${props.source}`}
      {...props}
    />
  );
}

function PDFViewerContent({
  bookmarkId,
  assetId,
  highlightId,
  source,
  headers,
}: PDFViewerProps) {
  const api = useTRPC();
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originalReader, setOriginalReader] = useState(false);
  const [originalError, setOriginalError] = useState<string | null>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const foreground = isDark ? "#fff" : "#000";
  const requestHeaders = JSON.stringify(headers ?? {});
  const { data, isError } = useQuery(
    api.highlights.getForBookmark.queryOptions({ bookmarkId }),
  );
  const create = useCreateHighlight();
  const update = useUpdateHighlight();
  const remove = useDeleteHighlight();

  useEffect(() => {
    let cancelled = false;
    setLocalPath(null);
    setError(null);
    setOriginalReader(false);
    const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/karakeep-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    const unlink = () =>
      ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
    const task = ReactNativeBlobUtil.config({ fileCache: true, path }).fetch(
      "GET",
      source,
      JSON.parse(requestHeaders),
    );
    finishPdfDownload(task, unlink, () => cancelled).then(
      (downloaded) => {
        if (!cancelled) setLocalPath(downloaded);
      },
      (reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not download PDF.",
          );
      },
    );
    return () => {
      cancelled = true;
      void task.cancel();
      void unlink();
    };
  }, [source, requestHeaders]);

  const containerStyle = [
    styles.container,
    { backgroundColor: isDark ? "#000" : "#fff" },
  ];
  if (error)
    return (
      <View style={containerStyle}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  if (!localPath)
    return (
      <View style={containerStyle}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={foreground} />
          <Text style={styles.loadingText}>Downloading PDF...</Text>
        </View>
      </View>
    );

  return (
    <View style={containerStyle}>
      {originalReader ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOriginalReader(false)}
            className="items-center border-b border-border p-3"
          >
            <Text>Back to highlights</Text>
          </Pressable>
          {originalError ? (
            <Text style={styles.errorText}>{originalError}</Text>
          ) : (
            <Pdf
              style={{ flex: 1 }}
              source={{ uri: `file://${localPath}`, cache: true }}
              spacing={16}
              maxScale={3}
              onError={() => setOriginalError("Failed to render PDF")}
              trustAllCerts={false}
              renderActivityIndicator={() => (
                <ActivityIndicator size="large" color={foreground} />
              )}
            />
          )}
        </>
      ) : (
        <PDFHighlighterDom
          key={localPath}
          assetId={assetId}
          highlightId={highlightId}
          isDark={isDark}
          highlights={(data?.highlights ?? []).map(
            ({ id, text, color, note, pdfAnchor }) => ({
              id,
              text,
              color,
              note,
              pdfAnchor,
            }),
          )}
          highlightsError={isError}
          onLoadDocument={() =>
            ReactNativeBlobUtil.fs.readFile(localPath, "base64")
          }
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
          onOpenOriginal={async () => {
            setOriginalError(null);
            setOriginalReader(true);
          }}
          dom={{ scrollEnabled: false, style: { flex: 1 } }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { marginTop: 12, fontSize: 16 },
  errorText: { fontSize: 16, textAlign: "center", padding: 20 },
});
