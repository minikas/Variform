import React from "react";
import { Flex, Switch, Label, Select, Input } from "figma-kit";
import { OutputFormats, TailwindColorMode, TailwindOutput, TailwindUnit } from "../types.d";
import { formatExtension } from "../utils/formatExtension";
import { SectionAccordion } from "./SectionAccordion";
import { ParserSelect } from "./ParserSelect";
import { FilenameInput } from "./FilenameInput";

interface ExportOptionsProps {
    format: OutputFormats;
    useRowColumnPos: boolean;
    useTailwindFormat?: boolean;
    useDSCGFormat?: boolean;
    tailwindOutput?: TailwindOutput;
    tailwindPrefix?: string;
    tailwindUnit?: TailwindUnit;
    tailwindColorMode?: TailwindColorMode;
    filename: string;
    onUseRowColumnPosChange: (useRowColumnPos: boolean) => void;
    onUseTailwindFormatChange?: (useTailwindFormat: boolean) => void;
    onUseDSCGFormatChange?: (useDSCGFormat: boolean) => void;
    onTailwindPrefixChange?: (tailwindPrefix: string) => void;
    onTailwindUnitChange?: (tailwindUnit: TailwindUnit) => void;
    onTailwindColorModeChange?: (tailwindColorMode: TailwindColorMode) => void;
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
    tailwindOutput = "css",
    tailwindPrefix = "",
    tailwindUnit = "px",
    tailwindColorMode = "var-fallback",
    filename,
    onUseRowColumnPosChange,
    onUseTailwindFormatChange,
    onUseDSCGFormatChange,
    onTailwindPrefixChange,
    onTailwindUnitChange,
    onTailwindColorModeChange,
    onFilenameChange
}) => {
    const showCsvOption = format === OutputFormats.CSV;
    const showTailwindOption = format === OutputFormats.CSS && !!onUseTailwindFormatChange;
    const showDSCGOption = format === OutputFormats.JSON && !!onUseDSCGFormatChange;
    const showTailwindFormatOptions = format === OutputFormats.TAILWIND;

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

                {/* Tailwind-format options. The output kind (CSS v4 vs preset
                    v3) is switched in the preview header. */}
                {showTailwindFormatOptions && (
                    <>
                        <Flex direction="column" gap="1">
                            <Label
                                htmlFor="varvar-tailwind-prefix"
                                style={{ color: "var(--figma-color-text-secondary)" }}
                            >
                                Prefix (optional)
                            </Label>
                            <Input
                                id="varvar-tailwind-prefix"
                                placeholder="Ex.: acme"
                                value={tailwindPrefix}
                                onChange={(e) => onTailwindPrefixChange?.(e.target.value.trim())}
                            />
                        </Flex>
                        <Flex direction="column" gap="1">
                            <Label
                                htmlFor="varvar-tailwind-unit"
                                style={{ color: "var(--figma-color-text-secondary)" }}
                            >
                                Unit
                            </Label>
                            <Select.Root
                                value={tailwindUnit}
                                onValueChange={(value) => onTailwindUnitChange?.(value as TailwindUnit)}
                            >
                                <Select.Trigger id="varvar-tailwind-unit" placeholder="px" />
                                <Select.Content portal>
                                    <Select.Item value="px">px</Select.Item>
                                    <Select.Item value="rem">rem (16px base)</Select.Item>
                                    <Select.Item value="em">em (16px base)</Select.Item>
                                </Select.Content>
                            </Select.Root>
                        </Flex>
                        {tailwindOutput === "preset" && (
                            <Flex direction="column" gap="1">
                                <Label
                                    htmlFor="varvar-tailwind-color-mode"
                                    style={{ color: "var(--figma-color-text-secondary)" }}
                                >
                                    Colors
                                </Label>
                                <Select.Root
                                    value={tailwindColorMode}
                                    onValueChange={(value) => onTailwindColorModeChange?.(value as TailwindColorMode)}
                                >
                                    <Select.Trigger id="varvar-tailwind-color-mode" placeholder="var() + fallback" />
                                    <Select.Content portal>
                                        <Select.Item value="var-fallback">var() + hex fallback</Select.Item>
                                        <Select.Item value="var">var() only</Select.Item>
                                        <Select.Item value="concrete">Concrete rgb()</Select.Item>
                                        <Select.Item value="hex">Hex (#rrggbb)</Select.Item>
                                    </Select.Content>
                                </Select.Root>
                            </Flex>
                        )}
                    </>
                )}

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
