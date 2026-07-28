import React from "react";
import { Flex } from "figma-kit";
import { OutputFormats, TailwindColorMode, TailwindOutput, TailwindUnit } from "../types.d";
import { formatExtension } from "../utils/formatExtension";
import { SectionAccordion } from "./SectionAccordion";
import { FormatOptionsControls } from "./FormatOptionsControls";
import { ParserSelect } from "./ParserSelect";
import { FilenameInput } from "./FilenameInput";

interface ExportOptionsProps {
    format: OutputFormats;
    useRowColumnPos: boolean;
    useDSCGFormat?: boolean;
    tailwindOutput?: TailwindOutput;
    tailwindPrefix?: string;
    tailwindUnit?: TailwindUnit;
    tailwindColorMode?: TailwindColorMode;
    filename: string;
    onUseRowColumnPosChange: (useRowColumnPos: boolean) => void;
    onUseDSCGFormatChange?: (useDSCGFormat: boolean) => void;
    onTailwindPrefixChange?: (tailwindPrefix: string) => void;
    onTailwindUnitChange?: (tailwindUnit: TailwindUnit) => void;
    onTailwindColorModeChange?: (tailwindColorMode: TailwindColorMode) => void;
    onFilenameChange: (filename: string) => void;
}

/**
 * "Options" accordion holding the format-specific toggles (when any), the
 * description parser, and the output filename. Always rendered, since every
 * format has at least a filename.
 */
export const ExportOptions: React.FC<ExportOptionsProps> = ({
    format,
    useRowColumnPos,
    useDSCGFormat = false,
    tailwindOutput = "css",
    tailwindPrefix = "",
    tailwindUnit = "px",
    tailwindColorMode = "var-fallback",
    filename,
    onUseRowColumnPosChange,
    onUseDSCGFormatChange,
    onTailwindPrefixChange,
    onTailwindUnitChange,
    onTailwindColorModeChange,
    onFilenameChange
}) => {
    // The description parser applies to the formats that emit the description as
    // data: JSON (non-DSCG), JavaScript, TypeScript and CSV.
    const showParser =
        (format === OutputFormats.JSON && !useDSCGFormat) ||
        format === OutputFormats.JS ||
        format === OutputFormats.TS ||
        format === OutputFormats.CSV;

    // Download/push extension (Tailwind resolves to css/js per output; some
    // formats like Android/Flutter have extensions different from the enum).
    const fileExtension = formatExtension(format, tailwindOutput);

    // The collapsed header shows the resulting output filename.
    const optionsSummary = `${filename}.${fileExtension}`;

    return (
        <SectionAccordion label="Options" summary={optionsSummary}>
            <Flex gap="2" direction="column">
                <FormatOptionsControls
                    format={format}
                    idPrefix="varvar-export"
                    useRowColumnPos={useRowColumnPos}
                    useDSCGFormat={useDSCGFormat}
                    tailwindOutput={tailwindOutput}
                    tailwindPrefix={tailwindPrefix}
                    tailwindUnit={tailwindUnit}
                    tailwindColorMode={tailwindColorMode}
                    onUseRowColumnPosChange={onUseRowColumnPosChange}
                    onUseDSCGFormatChange={onUseDSCGFormatChange ?? (() => {})}
                    onTailwindPrefixChange={onTailwindPrefixChange ?? (() => {})}
                    onTailwindUnitChange={onTailwindUnitChange ?? (() => {})}
                    onTailwindColorModeChange={onTailwindColorModeChange ?? (() => {})}
                />

                {/* Description parser (JSON non-DSCG, JavaScript, CSV) */}
                <ParserSelect show={showParser} />

                {/* Output filename */}
                <FilenameInput
                    extension={fileExtension}
                    filename={filename}
                    onFilenameChange={onFilenameChange}
                />
            </Flex>
        </SectionAccordion>
    );
};
