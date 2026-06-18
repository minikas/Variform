import { useState, useEffect } from "react";
import { OutputFormats } from "../types.d";
import { useSelection } from "../contexts/SelectionContext";
import { hasAnySelection } from "../utils/selectionState";
import { anyStyleSelected } from "../utils/styleSelection";

interface UseExportDataProps {
    format: OutputFormats;
}

/** Debounce before re-running the export, so rapid selection toggles coalesce. */
const EXPORT_DEBOUNCE_MS = 150;

interface UseExportDataReturn {
    filename: string;
    setFilename: (filename: string) => void;
    useRowColumnPos: boolean;
    setUseRowColumnPos: (useRowColumnPos: boolean) => void;
    useTailwindFormat: boolean;
    setUseTailwindFormat: (useTailwindFormat: boolean) => void;
    useDSCGFormat: boolean;
    setUseDSCGFormat: (useDSCGFormat: boolean) => void;
    exportedData: string;
    setExportedData: (data: string) => void;
    canExport: boolean;
    /** True while an export is in flight (used to show a loading skeleton). */
    isExporting: boolean;
    handleSelectToCopy: () => void;
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
    } = useSelection();

    // Send the selection only once it has been initialised (collections loaded);
    // before that, omit it so the plugin exports everything (full preview on
    // first paint) rather than treating an empty map as "nothing selected".
    const isInitialised = Object.keys(selection).length > 0;
    const exportSelection = isInitialised ? selection : undefined;

    // There is something worth exporting when the selection is still loading,
    // when at least one collection/mode is picked, or when a style kind is on.
    const canExport = !!exportedData && (!isInitialised || hasAnySelection(selection) || anyStyleSelected(styleSelection));

    const handleExport = () => {
        parent.postMessage({
            pluginMessage: {
                type: "EXPORT.SUCCESS" as any,
                format,
                useLinkedVarRowAndColPos: format === OutputFormats.CSV ? useRowColumnPos : false,
                useTailwindFormat: format === OutputFormats.CSS ? useTailwindFormat : false,
                useDSCGFormat: format === OutputFormats.JSON ? useDSCGFormat : false,
                selection: exportSelection,
                styleSelection,
                parserId
            }
        }, "*");
    };

    const handleSelectToCopy = () => {
        if (exportedData) {
            const textArea = document.querySelector('#varvar-exported-output');
            const selection = document.getSelection();
            if (textArea && selection) {
                selection.selectAllChildren(textArea);
            } else {
                console.warn('Unable to select all code.');
            }
        }
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

    const handleDownload = () => {
        if (exportedData) {
            downloadFile(exportedData, format, filename);
        }
    };

    useEffect(() => {
        window.onmessage = ({ data: { pluginMessage } }) => {
            if (pluginMessage.type === "INFO.BASIC_INFO") {
                setVariablesCount(pluginMessage.count);
            } else if (pluginMessage.type === "EXPORT.SUCCESS.RESULT") {
                setExportedData(pluginMessage.data);
                setIsExporting(false);
            } else if (pluginMessage.type === "EXPORT.ERROR") {
                setIsExporting(false);
            }
        };
    }, [filename, format, useDSCGFormat]);

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
    }, [format, useRowColumnPos, useTailwindFormat, useDSCGFormat, selection, styleSelection, parserId]);

    // Request basic info on mount (only if not already received)
    useEffect(() => {
        if (variablesCount === 0) {
            parent.postMessage({ pluginMessage: { type: "INFO.GET_BASIC_INFO" as any } }, "*");
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
        exportedData,
        setExportedData,
        canExport,
        isExporting,
        handleSelectToCopy,
        handleDownload
    };
};
