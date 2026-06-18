import React from "react";
import { Flex } from "figma-kit";
import { OutputFormats } from "../types.d";
import { ExportButton } from "./ExportButton";
import { GitHubButton } from "./github/GitHubButton";

interface ExportActionsProps {
    canExport: boolean;
    exportedData: string;
    filename: string;
    fileFormat: OutputFormats;
    onDownload: () => void;
}

/**
 * Export actions row: a compact square download icon button next to the primary
 * GitHub connect/push button, which takes the remaining width and is the main
 * action. `align="stretch"` keeps the download button the same height as the
 * GitHub button (and `aspectRatio: 1` on it keeps it square).
 */
export const ExportActions: React.FC<ExportActionsProps> = ({
    canExport,
    exportedData,
    filename,
    fileFormat,
    onDownload
}) => (
    <Flex gap="2" align="stretch">
        <ExportButton hasExportedData={canExport} onDownload={onDownload} />
        <div style={{ flex: 1, minWidth: 0 }}>
            <GitHubButton data={exportedData} filename={filename} fileFormat={fileFormat} />
        </div>
    </Flex>
);
