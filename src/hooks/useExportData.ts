import { useState, useEffect, useRef } from "react";
import { MessageTypes, OutputFormats, TailwindOutput, TailwindUnit, TailwindColorMode } from "../types.d";
import { formatExtension } from "../utils/formatExtension";
import { defaultFilename, filenameKey } from "../utils/filename";
import { requestExport } from "../utils/exportRequest";
import { useSelection } from "../contexts/SelectionContext";
import { hasAnySelection } from "../utils/selectionState";
import { anyStyleSelected } from "../utils/styleSelection";

interface UseExportDataProps {
    format: OutputFormats;
}

/** Debounce before re-running the export, so rapid selection toggles coalesce. */
const EXPORT_DEBOUNCE_MS = 150;

/**
 * Legacy stale-response check, kept for compatibility (unit-tested). The hook
 * now relies on the requestId correlation inside {@link requestExport} plus a
 * sequence guard, so superseded requests never resolve into the preview.
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
        filenameByFormat,
        setFilenameFor,
    } = useSelection();

    // The download filename is per FILE (persisted in SelectionContext):
    // single-file formats key on the format, Tailwind splits stylesheet and
    // preset — the hook reads/writes the slice of the file it would download.
    const fileKey = filenameKey(format, tailwindOutput);
    const filename = filenameByFormat[fileKey] ?? defaultFilename(fileKey);
    const setFilename = (name: string) => setFilenameFor(fileKey, name);

    // Send the selection only once it has been initialised (collections loaded);
    // before that, omit it so the plugin exports everything (full preview on
    // first paint) rather than treating an empty map as "nothing selected".
    const isInitialised = Object.keys(selection).length > 0;
    const exportSelection = isInitialised ? selection : undefined;

    // There is something worth exporting when the selection is still loading,
    // when at least one collection/mode is picked, or when a style kind is on.
    const canExport = !!exportedData && (!isInitialised || hasAnySelection(selection) || anyStyleSelected(styleSelection));

    // Sequence number of the latest export request, so only the most recent
    // one may write the preview (late responses to superseded requests are
    // already filtered out by requestExport's requestId correlation).
    const exportSeqRef = useRef(0);

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
        const seq = ++exportSeqRef.current;
        const handle = setTimeout(() => {
            requestExport(format, {
                useRowColumnPos,
                useDSCGFormat,
                tailwindOutput,
                tailwindPrefix,
                tailwindUnit,
                tailwindColorMode,
                selection: exportSelection,
                styleSelection,
                parserId,
            })
                .then((data) => {
                    if (exportSeqRef.current === seq) {
                        setExportedData(data);
                        setIsExporting(false);
                    }
                })
                .catch(() => {
                    // Export failed in the sandbox (EXPORT_ERROR) or timed out —
                    // leave the loading state so the skeleton does not spin forever.
                    if (exportSeqRef.current === seq) {
                        setIsExporting(false);
                    }
                });
        }, EXPORT_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [format, useRowColumnPos, useDSCGFormat, tailwindOutput, tailwindPrefix, tailwindUnit, tailwindColorMode, selection, styleSelection, parserId]);

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
