import { useState, useEffect, useRef } from "react";
import { MessageTypes, OutputFormats, TailwindOutput, TailwindUnit, TailwindColorMode } from "../types.d";
import { formatExtension } from "../utils/formatExtension";
import { useSelection } from "../contexts/SelectionContext";
import { hasAnySelection } from "../utils/selectionState";
import { anyStyleSelected } from "../utils/styleSelection";

interface UseExportDataProps {
    format: OutputFormats;
}

/** Debounce before re-running the export, so rapid selection toggles coalesce. */
const EXPORT_DEBOUNCE_MS = 150;

/** Counter for tagging export requests (same pattern as utils/pluginBridge). */
let nextExportRequestId = 0;

/**
 * Decides whether an export result/error arriving from the plugin answers a
 * superseded request and must be discarded. Prefers the echoed requestId
 * (unique per request, so even same-format races are caught); falls back to
 * comparing the echoed format with the current one for messages without a
 * requestId — a slow JSON export resolving after switching to CSS must not
 * write JSON into the CSS preview.
 */
export const isStaleExportResult = (
    messageRequestId: string | undefined,
    messageFormat: OutputFormats | undefined,
    pendingRequestId: string | null,
    currentFormat: OutputFormats
): boolean => {
    if (pendingRequestId && messageRequestId) {
        return messageRequestId !== pendingRequestId;
    }
    return messageFormat !== currentFormat;
};

interface UseExportDataReturn {
    filename: string;
    setFilename: (filename: string) => void;
    useRowColumnPos: boolean;
    setUseRowColumnPos: (useRowColumnPos: boolean) => void;
    useTailwindFormat: boolean;
    setUseTailwindFormat: (useTailwindFormat: boolean) => void;
    useDSCGFormat: boolean;
    setUseDSCGFormat: (useDSCGFormat: boolean) => void;
    tailwindOutput: TailwindOutput;
    setTailwindOutput: (tailwindOutput: TailwindOutput) => void;
    tailwindPrefix: string;
    setTailwindPrefix: (tailwindPrefix: string) => void;
    tailwindUnit: TailwindUnit;
    setTailwindUnit: (tailwindUnit: TailwindUnit) => void;
    tailwindColorMode: TailwindColorMode;
    setTailwindColorMode: (tailwindColorMode: TailwindColorMode) => void;
    /** Extension used when downloading/pushing (e.g. "css", "xml", "dart"). */
    fileExtension: string;
    exportedData: string;
    setExportedData: (data: string) => void;
    canExport: boolean;
    /** True while an export is in flight (used to show a loading skeleton). */
    isExporting: boolean;
    handleDownload: () => void;
}

/**
 * Custom hook that consolidates shared export logic across all export views.
 * The export runs automatically from the current selection, so views only need
 * the resulting data plus copy/download handlers.
 * @param format - The format of the exported data
 * @param useRowColumnPos - Whether to use row and column positions for linked variables
 * @returns An object containing the filename, options, exportedData, and the copy/download handlers
 */
export const useExportData = ({ format }: UseExportDataProps): UseExportDataReturn => {
    // Default the output name to "tokens" (e.g. tokens.json). The user can edit it.
    const [filename, setFilename] = useState<string>("tokens");
    const [exportedData, setExportedData] = useState<string>("");
    const [isExporting, setIsExporting] = useState<boolean>(true);
    const [variablesCount, setVariablesCount] = useState<number>(0);
    // Format-specific option toggles live in SelectionContext so they persist
    // (per document) alongside the selection and chosen format.
    const {
        selection,
        styleSelection,
        parserId,
        useRowColumnPos,
        setUseRowColumnPos,
        useTailwindFormat,
        setUseTailwindFormat,
        useDSCGFormat,
        setUseDSCGFormat,
        tailwindOutput,
        setTailwindOutput,
        tailwindPrefix,
        setTailwindPrefix,
        tailwindUnit,
        setTailwindUnit,
        tailwindColorMode,
        setTailwindColorMode,
    } = useSelection();

    // Send the selection only once it has been initialised (collections loaded);
    // before that, omit it so the plugin exports everything (full preview on
    // first paint) rather than treating an empty map as "nothing selected".
    const isInitialised = Object.keys(selection).length > 0;
    const exportSelection = isInitialised ? selection : undefined;

    // There is something worth exporting when the selection is still loading,
    // when at least one collection/mode is picked, or when a style kind is on.
    const canExport = !!exportedData && (!isInitialised || hasAnySelection(selection) || anyStyleSelected(styleSelection));

    // Refs so the message handler always sees the latest values regardless of
    // when its effect last ran.
    const formatRef = useRef(format);
    formatRef.current = format;
    /** RequestId of the export currently in flight (null before the first one). */
    const pendingExportRequestIdRef = useRef<string | null>(null);

    const handleExport = () => {
        // Tag each request so late responses to superseded exports (e.g. a
        // slow JSON export resolving after switching to CSS) can be discarded
        // instead of overwriting the preview with the wrong format's data.
        const requestId = `export:${nextExportRequestId++}`;
        pendingExportRequestIdRef.current = requestId;
        parent.postMessage({
            pluginMessage: {
                type: MessageTypes.EXPORT_SUCCESS,
                requestId,
                format,
                useLinkedVarRowAndColPos: format === OutputFormats.CSV ? useRowColumnPos : false,
                useTailwindFormat: format === OutputFormats.CSS ? useTailwindFormat : false,
                useDSCGFormat: format === OutputFormats.JSON ? useDSCGFormat : false,
                tailwindOutput: format === OutputFormats.TAILWIND ? tailwindOutput : undefined,
                tailwindPrefix: format === OutputFormats.TAILWIND ? tailwindPrefix : undefined,
                tailwindUnit: format === OutputFormats.TAILWIND ? tailwindUnit : undefined,
                tailwindColorMode: format === OutputFormats.TAILWIND ? tailwindColorMode : undefined,
                selection: exportSelection,
                styleSelection,
                parserId
            }
        }, "*");
    };

    const downloadFile = (data: string, fileFormat: string, fileName: string) => {
        const blob = new Blob([data], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${fileName}.${fileFormat}`;
        link.click();
        URL.revokeObjectURL(url);
    };

    // Download/push extension (Tailwind resolves to css/js per output; some
    // formats like Android/Flutter have extensions different from the enum).
    const fileExtension = formatExtension(format, tailwindOutput);

    const handleDownload = () => {
        if (exportedData) {
            downloadFile(exportedData, fileExtension, filename);
        }
    };

    useEffect(() => {
        window.onmessage = ({ data: { pluginMessage } }) => {
            if (pluginMessage.type === MessageTypes.BASIC_INFO) {
                setVariablesCount(pluginMessage.count);
            } else if (pluginMessage.type === MessageTypes.EXPORT_SUCCESS_RESULT) {
                // Drop late responses to superseded requests (see handleExport).
                if (isStaleExportResult(pluginMessage.requestId, pluginMessage.format, pendingExportRequestIdRef.current, formatRef.current)) {
                    return;
                }
                setExportedData(pluginMessage.data);
                setIsExporting(false);
            } else if (pluginMessage.type === MessageTypes.EXPORT_ERROR) {
                if (isStaleExportResult(pluginMessage.requestId, pluginMessage.format, pendingExportRequestIdRef.current, formatRef.current)) {
                    return;
                }
                setIsExporting(false);
            }
        };
    }, []);

    // Auto-export from the current selection: runs on mount and whenever the
    // format, a format-specific option, or the collection/mode/styles selection
    // changes, so the preview always reflects the selection without a manual
    // trigger. Debounced so rapid selection toggles coalesce into one export.
    useEffect(() => {
        // Enter the loading state immediately (covers the debounce window too) so
        // the preview shows a skeleton while transitioning between formats.
        setIsExporting(true);
        const handle = setTimeout(() => handleExport(), EXPORT_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [format, useRowColumnPos, useTailwindFormat, useDSCGFormat, tailwindOutput, tailwindPrefix, tailwindUnit, tailwindColorMode, selection, styleSelection, parserId]);

    // Request basic info on mount (only if not already received)
    useEffect(() => {
        if (variablesCount === 0) {
            parent.postMessage({ pluginMessage: { type: MessageTypes.GET_BASIC_INFO } }, "*");
        }
    }, [variablesCount]);

    return {
        filename,
        setFilename,
        useRowColumnPos,
        setUseRowColumnPos,
        useTailwindFormat,
        setUseTailwindFormat,
        useDSCGFormat,
        setUseDSCGFormat,
        tailwindOutput,
        setTailwindOutput,
        tailwindPrefix,
        setTailwindPrefix,
        tailwindUnit,
        setTailwindUnit,
        tailwindColorMode,
        setTailwindColorMode,
        fileExtension,
        exportedData,
        setExportedData,
        canExport,
        isExporting,
        handleDownload
    };
};
