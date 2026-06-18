import React, { useState } from "react";
import { Flex, Text, Button } from "figma-kit";
import { copyToClipboard } from "../utils/clipboard";

interface OutputPreviewProps {
    exportedData: string;
    editorType?: string;
    onSelectToCopy: () => void;
}

/**
 * Code preview component with select-to-copy functionality
 */
export const OutputPreview: React.FC<OutputPreviewProps> = ({ 
    exportedData, 
    editorType = 'dev',
    onSelectToCopy 
}) => {
    const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');

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
    // copy/select buttons stay put.
    const isDesign = editorType === 'figma';

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
            <Text>Code Preview</Text>
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
                <Flex direction="column" style={{ flex: isDesign ? 1 : undefined, minHeight: isDesign ? 0 : undefined }}>
                    <Flex
                        direction="row"
                        gap="2"
                        style={{
                            alignSelf: 'end',
                            position: 'sticky',
                            top: 4,
                            right: 4,
                            zIndex: 1,
                            backdropFilter: 'blur(4px)'
                        }}
                    >
                        <Button
                            variant="secondary"
                            onClick={handleCopy}
                            disabled={copyStatus !== 'idle'}
                        >
                            {copyStatus === 'success' ? '✓ Copied!' :
                             copyStatus === 'error' ? '✗ Failed' : 'Copy'}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={onSelectToCopy}
                        >
                            Select Result
                        </Button>
                    </Flex>
                    <div
                        className="varvar-scroll-thin"
                        style={{
                            marginTop: '-2rem',
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
                            {exportedData.toString()}
                        </pre>
                    </div>
                </Flex>
            </Flex>
        </Flex>
    );
};
