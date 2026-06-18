import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageTypes, PluginMessage } from "../types.d";
import { sendRequest } from "../utils/pluginBridge";

interface UseClientStorageReturn {
  /** Stored value, or null when unset. `undefined` until the first load. */
  value: string | null | undefined;
  /** True once the initial value has been received from the plugin. */
  loaded: boolean;
  /** Persist a value (or pass null to delete the key). */
  save: (next: string | null) => void;
}

/**
 * Read and write a single key in the plugin's per-user `figma.clientStorage`.
 *
 * The UI iframe cannot touch clientStorage directly, so the read round-trips
 * through the plugin via the {@link sendRequest} promise bridge wrapped in a
 * useQuery (cached forever for the session). Writes are fire-and-forget
 * (STORAGE_SET has no reply) with an optimistic cache update.
 */
export function useClientStorage(key: string): UseClientStorageReturn {
  const queryClient = useQueryClient();
  const queryKey = ["clientStorage", key];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await sendRequest<PluginMessage>(
        MessageTypes.STORAGE_GET,
        { storageKey: key },
        MessageTypes.STORAGE_VALUE,
      );
      return typeof response.storageValue === "string" ? response.storageValue : null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const save = useCallback(
    (next: string | null) => {
      // Optimistic local update, then fire-and-forget the write to the plugin.
      queryClient.setQueryData(["clientStorage", key], next);
      parent.postMessage(
        {
          pluginMessage: {
            type: MessageTypes.STORAGE_SET,
            storageKey: key,
            storageValue: next,
          },
        },
        "*",
      );
    },
    [queryClient, key],
  );

  return { value: query.data, loaded: query.isSuccess, save };
}
