import React, { useState } from "react";
import { Flex, Text, Button, Select, Input } from "figma-kit";
import { copyToClipboard } from "../utils/clipboard";

interface PreviewOption {
    value: string;
    label: string;
}

interface OutputPreviewProps {
    exportedData: string;
    editorType?: string;
    /**
     * Optional outputs the preview can switch between (e.g. the Tailwind
     * format's CSS and preset files). Rendered as a dropdown in the actions row.
     */
    previewOptions?: PreviewOption[];
    previewOptionValue?: string;
    onPreviewOptionChange?: (value: string) => void;
}

/**
 * Code preview component with copy-to-clipboard and search-to-filter
 * functionality
 */
export const OutputPreview: React.FC<OutputPreviewProps> = ({ 
    exportedData, 
    editorType = 'dev',
    previewOptions,
    previewOptionValue,
    onPreviewOptionChange
}) => {
    const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [search, setSearch] = useState<string>("");

    const handleCopy = async () => {
        try {
            const success = await copyToClipboard(exportedData);
            setCopyStatus(success ? 'success' : 'error');
            
            // Reset status after 2 seconds
            setTimeout(() => setCopyStatus('idle'), 2000);
        } catch (error) {
            console.error('Copy failed:', error);
            setCopyStatus('error');
            setTimeout(() => setCopyStatus('idle'), 2000);
        }
    };

    if (!exportedData) return null;

    // In design mode the preview sits beside the form, so we cap its height to
    // the viewport and let only the code area scroll — the title and the
    // copy/search actions stay put.
    const isDesign = editorType === 'figma';

    // The search filters the displayed lines only; Copy always copies the full
    // export.
    const query = search.trim().toLowerCase();
    const displayedData = query
        ? exportedData.split('\n').filter((line) => line.toLowerCase().includes(query)).join('\n')
        : exportedData;

    return (
        <Flex
            direction="column"
            gap="2"
            style={{
                flex: "2 0 300px",
                minWidth: 0,
                maxWidth: isDesign ? "454px" : undefined,
                position: isDesign ? 'sticky' : undefined,
                top: isDesign ? '1rem' : undefined,
                maxHeight: isDesign ? 'calc(100vh - 2rem)' : undefined,
                minHeight: 0,
            }}
        >
            <Flex justify="between" align="center" gap="2">
                <Text>Code Preview</Text>
                <Flex direction="row" gap="2" align="center">
                    {previewOptions && previewOptions.length > 0 && (
                        <Select.Root
                            value={previewOptionValue}
                            onValueChange={onPreviewOptionChange}
                        >
                            <Select.Trigger
                                id="varvar-preview-output"
                                aria-label="Preview output"
                            />
                            <Select.Content portal>
                                {previewOptions.map((option) => (
                                    <Select.Item key={option.value} value={option.value}>
                                        {option.label}
                                    </Select.Item>
                                ))}
                            </Select.Content>
                        </Select.Root>
                    )}
                    <Button
                        variant="secondary"
                        onClick={handleCopy}
                        disabled={copyStatus !== 'idle'}
                    >
                        {copyStatus === 'success' ? '✓ Copied!' :
                         copyStatus === 'error' ? '✗ Failed' : 'Copy'}
                    </Button>
                    <Input
                        id="varvar-preview-search"
                        aria-label="Search in the exported output"
                        placeholder="Search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ width: "140px" }}
                    />
                </Flex>
            </Flex>
            <Flex
                direction="column"
                gap="2"
                style={{
                    position: 'relative',
                    border: 'var(--figma-color-border)',
                    borderRadius: 4,
                    padding: 8,
                    backgroundColor: 'rgba(0,0,0,.25)',
                    flex: isDesign ? 1 : undefined,
                    minHeight: isDesign ? 0 : undefined,
                    overflow: isDesign ? 'hidden' : undefined,
                }}
            >
                <div
                    className="varvar-scroll-thin"
                    style={{
                        maxWidth: '100%',
                        flex: isDesign ? 1 : undefined,
                        minHeight: isDesign ? 0 : undefined,
                        overflow: 'auto',
                    }}
                >
                    <pre
                        id="varvar-exported-output"
                        style={{ margin: 0, whiteSpace: 'pre', color: 'var(--figma-color-text)' }}
                        contentEditable
                        spellCheck="false"
                    >
                        {displayedData.toString()}
                    </pre>
                </div>
            </Flex>
        </Flex>
    );
};
