import React from "react";
import { Flex, Text } from "figma-kit";

interface PreviewSkeletonProps {
    editorType?: string;
}

// Varied widths so the placeholder reads like lines of code.
const LINE_WIDTHS = [
    "68%", "42%", "84%", "55%", "73%", "38%",
    "90%", "50%", "62%", "47%", "80%", "33%", "70%", "58%",
];

/**
 * Loading skeleton that mirrors {@link OutputPreview}'s footprint, shown while
 * an export is in flight (e.g. when switching between formats) so the layout
 * doesn't jump and the user sees progress.
 */
export const PreviewSkeleton: React.FC<PreviewSkeletonProps> = ({ editorType = "dev" }) => {
    const isDesign = editorType === "figma";

    return (
        <Flex
            direction="column"
            gap="2"
            style={{
                flex: "2 0 300px",
                minWidth: 0,
                maxWidth: isDesign ? "454px" : undefined,
                position: isDesign ? "sticky" : undefined,
                top: isDesign ? "1rem" : undefined,
                maxHeight: isDesign ? "calc(100vh - 2rem)" : undefined,
                minHeight: 0,
            }}
        >
            <Text>Code Preview</Text>
            <Flex
                direction="column"
                gap="2"
                style={{
                    border: "var(--figma-color-border)",
                    borderRadius: 4,
                    padding: 12,
                    backgroundColor: "rgba(0,0,0,.25)",
                    flex: isDesign ? 1 : undefined,
                    minHeight: isDesign ? 0 : undefined,
                    overflow: "hidden",
                }}
                aria-hidden
            >
                {LINE_WIDTHS.map((width, index) => (
                    <div key={index} className="varvar-skeleton-line" style={{ width }} />
                ))}
            </Flex>
        </Flex>
    );
};
