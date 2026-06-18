import React from "react";
import { Flex, Switch, Label } from "figma-kit";
import { OutputFormats } from "../types.d";
import { SectionAccordion } from "./SectionAccordion";
import { ParserSelect } from "./ParserSelect";
import { FilenameInput } from "./FilenameInput";

interface ExportOptionsProps {
    format: OutputFormats;
    useRowColumnPos: boolean;
    useTailwindFormat?: boolean;
    useDSCGFormat?: boolean;
    filename: string;
    onUseRowColumnPosChange: (useRowColumnPos: boolean) => void;
    onUseTailwindFormatChange?: (useTailwindFormat: boolean) => void;
    onUseDSCGFormatChange?: (useDSCGFormat: boolean) => void;
    onFilenameChange: (filename: string) => void;
}

/**
 * "Options" accordion holding the format-specific toggle (when any), the
 * description parser, and the output filename. Always rendered, since every
 * format has at least a filename.
 */
export const ExportOptions: React.FC<ExportOptionsProps> = ({
    format,
    useRowColumnPos,
    useTailwindFormat = false,
    useDSCGFormat = false,
    filename,
    onUseRowColumnPosChange,
    onUseTailwindFormatChange,
    onUseDSCGFormatChange,
    onFilenameChange
}) => {
    const showCsvOption = format === OutputFormats.CSV;
    const showTailwindOption = format === OutputFormats.CSS && !!onUseTailwindFormatChange;
    const showDSCGOption = format === OutputFormats.JSON && !!onUseDSCGFormatChange;

    // The description parser applies to the formats that emit the description as
    // data: JSON (non-DSCG), JavaScript and CSV.
    const showParser =
        (format === OutputFormats.JSON && !useDSCGFormat) ||
        format === OutputFormats.JS ||
        format === OutputFormats.CSV;

    // The collapsed header shows the resulting output filename.
    const optionsSummary = `${filename}.${format}`;

    return (
        <SectionAccordion label="Options" summary={optionsSummary}>
            <Flex gap="2" direction="column">
                {/* CSV-specific option */}
                {showCsvOption && (
                    <Flex gap="2">
                        <Switch
                            id="varvar-export-row-column-pos"
                            onCheckedChange={onUseRowColumnPosChange}
                            checked={useRowColumnPos}
                            style={{ flexShrink: 0 }}
                        />
                        <Label htmlFor="varvar-export-row-column-pos">
                            Use row &amp; column positions (i.e.: <code>=E7</code>) for linked vars
                        </Label>
                    </Flex>
                )}

                {/* CSS-specific option */}
                {showTailwindOption && (
                    <Flex gap="2">
                        <Switch
                            id="varvar-export-tailwind-format"
                            onCheckedChange={onUseTailwindFormatChange}
                            checked={useTailwindFormat}
                            style={{ flexShrink: 0 }}
                        />
                        <Label htmlFor="varvar-export-tailwind-format">
                            Export as Tailwind CSS (v4)
                        </Label>
                        <span title="🧪 BETA: Exports the variables as Tailwind CSS (v4) format. It will also include the @theme directive and @custom-variant directives." style={{ backgroundColor: 'var(--figma-color-text-secondary)', fontFamily: 'sans-serif', cursor: 'help', userSelect: 'none', color: 'var(--figma-color-text-secondary-inverse)', borderRadius: '50%', padding: '1px', fontSize: '.6em', width: '1em', height: '1em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
                    </Flex>
                )}

                {/* JSON-specific option */}
                {showDSCGOption && (
                    <Flex gap="2" justify="between" align="center">
                        <Label htmlFor="varvar-export-dscg-format">
                            Normalize to DSCG (Design Tokens W3C Community Group)
                        </Label>
                        <Switch
                            id="varvar-export-dscg-format"
                            onCheckedChange={onUseDSCGFormatChange}
                            checked={useDSCGFormat}
                            style={{ flexShrink: 0 }}
                        />
                    </Flex>
                )}

                {/* Description parser (JSON non-DSCG, JavaScript, CSV) */}
                <ParserSelect show={showParser} />

                {/* Output filename */}
                <FilenameInput
                    format={format}
                    filename={filename}
                    onFilenameChange={onFilenameChange}
                />
            </Flex>
        </SectionAccordion>
    );
};
