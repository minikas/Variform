import React from "react";
import { Button } from "figma-kit";

interface ExportButtonProps {
    hasExportedData: boolean;
    onDownload: () => void;
}

/**
 * Compact download button (icon only). It's square — `aspectRatio: 1` makes its
 * width track its height, which (in a stretch flex row) matches the GitHub
 * button beside it. The export runs automatically, so this just saves the file.
 */
export const ExportButton: React.FC<ExportButtonProps> = ({
    hasExportedData,
    onDownload
}) => {
    return (
        <Button
            variant="secondary"
            size="medium"
            disabled={!hasExportedData}
            onClick={onDownload}
            aria-label="Download file"
            title="Download file"
            style={{ aspectRatio: "1", padding: 0, flexShrink: 0 }}
        >
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
            </svg>
        </Button>
    );
};
