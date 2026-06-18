import React, { useEffect } from "react";
import { RadioGroup } from "figma-kit";
import { OutputFormats } from "../types.d";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { ExportHeader } from "../components/ExportHeader";
import { SectionAccordion } from "../components/SectionAccordion";
import { ExportOptions } from "../components/ExportOptions";
import { CollectionAccordion } from "../components/CollectionAccordion";
import { ExportActions } from "../components/ExportActions";
import { OutputPreview } from "../components/OutputPreview";
import { PreviewSkeleton } from "../components/PreviewSkeleton";
import { ExportLayout } from "../components/ExportLayout";
import { useExportData } from "../hooks/useExportData";
import { useSelection } from "../contexts/SelectionContext";

interface ExportViewProps {
    editorType?: string;
}

/** Human-readable label for the currently selected export format. */
const formatLabel = (format: OutputFormats): string => {
    switch (format) {
        case OutputFormats.JSON:
            return "JSON";
        case OutputFormats.JS:
            return "JavaScript";
        case OutputFormats.CSV:
            return "CSV";
        case OutputFormats.CSS:
            return "CSS";
        case OutputFormats.TS:
            return "TypeScript";
        default:
            return format;
    }
};

/**
 * Generic export view with format selector (default command)
 */
export const ExportView: React.FC<ExportViewProps> = ({ editorType = "" }) => {
    // Format is persisted (per document) in the SelectionContext.
    const { format, setFormat } = useSelection();
    const {
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
    } = useExportData({ format });

    // Reset useRowColumnPos when format changes to non-CSV
    useEffect(() => {
        if (format !== OutputFormats.CSV) {
            setUseRowColumnPos(false);
        }
    }, [format]);

    // Reset useTailwindFormat when format changes to non-CSS
    useEffect(() => {
        if (format !== OutputFormats.CSS) {
            setUseTailwindFormat(false);
        }
    }, [format]);

    // Reset useDSCGFormat when format changes to non-JSON
    useEffect(() => {
        if (format !== OutputFormats.JSON) {
            setUseDSCGFormat(false);
        }
    }, [format]);

    // Clear exported data when format changes to refresh preview
    useEffect(() => {
        setExportedData("");
    }, [format]);

    const formControls = (
        <>
            <ExportHeader format={format} title="Export" />

            <SectionAccordion label="Format" summary={formatLabel(format)}>
                <RadioGroup.Root orientation="vertical" value={format} onValueChange={(value) => setFormat(value as OutputFormats)}>
                    <RadioGroup.Label>
                        <RadioGroup.Item value={OutputFormats.JSON} />
                        JSON
                    </RadioGroup.Label>
                    <RadioGroup.Label>
                        <RadioGroup.Item value={OutputFormats.JS} />
                        JavaScript
                    </RadioGroup.Label>
                    <RadioGroup.Label>
                        <RadioGroup.Item value={OutputFormats.CSV} />
                        CSV
                    </RadioGroup.Label>
                    <RadioGroup.Label>
                        <RadioGroup.Item value={OutputFormats.CSS} />
                        CSS
                    </RadioGroup.Label>
                </RadioGroup.Root>
            </SectionAccordion>

            <ExportOptions
                format={format}
                useRowColumnPos={useRowColumnPos}
                useTailwindFormat={useTailwindFormat}
                useDSCGFormat={useDSCGFormat}
                filename={filename}
                onUseRowColumnPosChange={setUseRowColumnPos}
                onUseTailwindFormatChange={setUseTailwindFormat}
                onUseDSCGFormatChange={setUseDSCGFormat}
                onFilenameChange={setFilename}
            />

            <CollectionAccordion />

            <ExportActions
                canExport={canExport}
                exportedData={exportedData}
                filename={filename}
                fileFormat={format}
                onDownload={handleDownload}
            />
        </>
    );

    const preview = isExporting ? (
        <PreviewSkeleton editorType={editorType} />
    ) : exportedData ? (
        <OutputPreview
            exportedData={exportedData}
            editorType={editorType}
            onSelectToCopy={handleSelectToCopy}
        />
    ) : null;

    return (
        <PluginDialogShell>
            <ExportLayout 
                editorType={editorType}
                children={formControls}
                preview={preview}
            />
        </PluginDialogShell>
    );
};
