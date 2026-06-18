import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageTypes } from "../types.d";
import type { InspectTable, PluginMessage } from "../types.d";
import { sendRequest } from "../utils/pluginBridge";

interface InspectContextValue {
  /** Whether the inspect modal is open. */
  open: boolean;
  /** Whether the table is still being fetched from the plugin. */
  loading: boolean;
  /** The table to display, once received. */
  table: InspectTable | null;
  /** Open the modal and request a collection's variables table. */
  inspectCollection: (collectionId: string) => void;
  /** Open the modal and request the local styles table. */
  inspectStyles: () => void;
  /** Close the modal. */
  close: () => void;
}

type InspectTarget =
  | { kind: "collection"; collectionId: string }
  | { kind: "styles" };

const InspectContext = createContext<InspectContextValue | null>(null);

/**
 * Drives the inspect modal: requests a side item's contents from the plugin and
 * exposes the resulting table. The data lives in the plugin sandbox, so it is
 * fetched on demand (via the {@link sendRequest} bridge + useQuery) whenever the
 * user opens the modal. The bridge's timeout guarantees the loading state clears
 * even if the plugin never replies.
 */
export const InspectProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<InspectTarget | null>(null);

  const query = useQuery({
    queryKey: [
      "inspect",
      target?.kind ?? "none",
      target?.kind === "collection" ? target.collectionId : "",
    ],
    enabled: open && target !== null,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      if (target?.kind === "collection") {
        const response = await sendRequest<PluginMessage>(
          MessageTypes.INSPECT_COLLECTION,
          { inspectCollectionId: target.collectionId },
          MessageTypes.INSPECT_RESULT,
        );
        return response.inspect ?? null;
      }
      const response = await sendRequest<PluginMessage>(
        MessageTypes.INSPECT_STYLES,
        {},
        MessageTypes.INSPECT_RESULT,
      );
      return response.inspect ?? null;
    },
  });

  const inspectCollection = useCallback((collectionId: string) => {
    setTarget({ kind: "collection", collectionId });
    setOpen(true);
  }, []);

  const inspectStyles = useCallback(() => {
    setTarget({ kind: "styles" });
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Treat "open with a target but no data/error yet" as loading too, so there's
  // no flicker between opening and react-query starting the fetch.
  const loading =
    open &&
    target !== null &&
    (query.isFetching || (query.data === undefined && !query.isError));

  const value = useMemo<InspectContextValue>(
    () => ({
      open,
      loading,
      table: query.data ?? null,
      inspectCollection,
      inspectStyles,
      close,
    }),
    [open, loading, query.data, inspectCollection, inspectStyles, close],
  );

  return <InspectContext.Provider value={value}>{children}</InspectContext.Provider>;
};

/**
 * Accesses the inspect modal controls. Must be used within an {@link InspectProvider}.
 */
export const useInspect = (): InspectContextValue => {
  const ctx = useContext(InspectContext);
  if (!ctx) {
    throw new Error("useInspect must be used within an InspectProvider");
  }
  return ctx;
};
