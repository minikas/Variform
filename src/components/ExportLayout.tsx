import React from "react";
import { Flex } from "figma-kit";

interface ExportLayoutProps {
    editorType?: string;
    children: React.ReactNode;
    preview: React.ReactNode;
}

/**
 * Responsive layout component that adapts based on editor type
 * - Design mode ("figma"): Horizontal layout with form on left, preview on right
 * - Dev mode ("dev"): Vertical layout with form on top, preview below
 */
export const ExportLayout: React.FC<ExportLayoutProps> = ({ 
    editorType, 
    children, 
    preview 
}) => {
    const isDesignMode = editorType === "figma";

    if (isDesignMode) {
        // Horizontal layout for Design mode
        return (
            <Flex 
                direction="row" 
                gap="4"
                style={{
                    position: "relative",
                }}
            >
                {/* Form controls on the left — scrolls independently when its
                    content (e.g. the collections accordion) is taller than the
                    plugin window. */}
                <Flex
                    className="varvar-scroll-thin"
                    direction="column"
                    gap="3"
                    style={{
                        flex: "1 1 200px",
                        position: "sticky",
                        margin: "0 auto",
                        top: '1rem',
                        minWidth: "250px",
                        alignSelf: "flex-start",
                        maxHeight: "calc(100vh - 2rem)",
                        overflowY: "auto",
                        // Reserve the scrollbar's space so opening an accordion (which
                        // makes the column overflow) doesn't shift/narrow the content.
                        scrollbarGutter: "stable",
                        paddingRight: "12px",
                    }}
                >
                    {children}
                </Flex>
                
                {/* Preview on the right. The slot keeps its flex space even when
                    the preview is momentarily empty (e.g. while switching
                    formats), so the form column doesn't reflow to full width. */}
                {preview ?? <div style={{ flex: "2 0 300px", minWidth: 0 }} aria-hidden />}
            </Flex>
        );
    }

    // Vertical layout for Dev mode (default)
    return (
        <Flex direction="column" gap="4">
            {children}
            {preview}
        </Flex>
    );
};
