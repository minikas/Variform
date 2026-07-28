import {
  MessageTypes,
  OutputFormats,
  type ExportSelection,
  type PluginMessage,
  type StyleSelection,
  type TailwindColorMode,
  type TailwindOutput,
  type TailwindUnit,
} from "../types.d";

/** Counter for tagging export requests (same pattern as utils/pluginBridge). */
let nextExportRequestId = 0;

const DEFAULT_EXPORT_TIMEOUT_MS = 10_000;

/**
 * Options accepted by the plugin sandbox export handler. Format-specific
 * options are gated per format (mirroring the legacy useExportData payload):
 * an option only travels with the formats it applies to.
 */
export interface ExportRequestOptions {
  useRowColumnPos?: boolean;
  useDSCGFormat?: boolean;
  tailwindOutput?: TailwindOutput;
  tailwindPrefix?: string;
  tailwindUnit?: TailwindUnit;
  tailwindColorMode?: TailwindColorMode;
  /** Omit to export everything (selection not initialised yet). */
  selection?: ExportSelection;
  styleSelection?: StyleSelection;
  parserId?: string;
}

/**
 * Request one export from the plugin sandbox and resolve with its contents.
 *
 * Promise bridge over the fire-and-forget postMessage channel: the request is
 * tagged with a unique requestId, and only the EXPORT_SUCCESS_RESULT /
 * EXPORT_ERROR reply echoing that requestId settles the promise — responses
 * to superseded requests are never delivered to the caller (stale guard).
 * Uses addEventListener so it coexists with other message listeners.
 */
export function requestExport(
  format: OutputFormats,
  options: ExportRequestOptions = {},
  timeoutMs: number = DEFAULT_EXPORT_TIMEOUT_MS,
): Promise<string> {
  const requestId = `export:${nextExportRequestId++}`;

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error(`Export request for format "${format}" timed out.`));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      const message = (event.data as { pluginMessage?: PluginMessage } | undefined)
        ?.pluginMessage;
      if (!message || message.requestId !== requestId) {
        return;
      }
      if (message.type === MessageTypes.EXPORT_SUCCESS_RESULT) {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        resolve(message.data ?? "");
      } else if (message.type === MessageTypes.EXPORT_ERROR) {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        reject(new Error(message.error || `Export failed for format "${format}".`));
      }
    }

    window.addEventListener("message", handler);
    parent.postMessage(
      {
        pluginMessage: {
          type: MessageTypes.EXPORT_SUCCESS,
          requestId,
          format,
          useLinkedVarRowAndColPos:
            format === OutputFormats.CSV ? (options.useRowColumnPos ?? false) : false,
          useDSCGFormat:
            format === OutputFormats.JSON ? (options.useDSCGFormat ?? false) : false,
          tailwindOutput:
            format === OutputFormats.TAILWIND ? options.tailwindOutput : undefined,
          tailwindPrefix:
            format === OutputFormats.TAILWIND ? options.tailwindPrefix : undefined,
          tailwindUnit:
            format === OutputFormats.TAILWIND ? options.tailwindUnit : undefined,
          tailwindColorMode:
            format === OutputFormats.TAILWIND ? options.tailwindColorMode : undefined,
          selection: options.selection,
          styleSelection: options.styleSelection,
          parserId: options.parserId,
        },
      },
      "*",
    );
  });
}
