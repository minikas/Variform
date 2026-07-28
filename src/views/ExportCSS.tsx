import React from "react";
import { OutputFormats } from "../types.d";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { ExportHeader } from "../components/ExportHeader";
import { ExportOptions } from "../components/ExportOptions";
import { CollectionAccordion } from "../components/CollectionAccordion";
import { ExportActions } from "../components/ExportActions";
import { OutputPreview } from "../components/OutputPreview";
import { ExportLayout } from "../components/ExportLayout";
import { useExportData } from "../hooks/useExportData";

interface ExportCSSProps {
    editorType?: string;
}

/**
 * CSS-specific export view
 */
export const ExportCSS: React.FC<ExportCSSProps> = ({ editorType = "" }) => {
    const format = OutputFormats.CSS;
    const {
        filename,
        setFilename,
        exportedData,
        canExport,
        handleDownload
    } = useExportData({ format });

    const formControls = (
        <>
            <ExportHeader format={format} />

            <ExportOptions
                format={format}
                useRowColumnPos={false}
                filename={filename}
                onUseRowColumnPosChange={() => {}}
                onFilenameChange={setFilename}
            />

            <CollectionAccordion />

            <ExportActions
                canExport={canExport}
                onDownload={handleDownload}
            />
        </>
    );

    const preview = exportedData ? (
        <OutputPreview 
            exportedData={exportedData}
            editorType={editorType}
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
