import React from "react";
import { Flex, Switch, Label, Select, Input } from "figma-kit";
import { OutputFormats, TailwindColorMode, TailwindOutput, TailwindUnit } from "../types.d";

interface FormatOptionsControlsProps {
    format: OutputFormats;
    /** Unique id prefix (several instances can coexist on the main page). */
    idPrefix: string;
    useRowColumnPos: boolean;
    useDSCGFormat: boolean;
    tailwindOutput: TailwindOutput;
    tailwindPrefix: string;
    tailwindUnit: TailwindUnit;
    tailwindColorMode: TailwindColorMode;
    onUseRowColumnPosChange: (useRowColumnPos: boolean) => void;
    onUseDSCGFormatChange: (useDSCGFormat: boolean) => void;
    /** When omitted, the Tailwind output select is not rendered (the single-format views switch it in the preview header instead). */
    onTailwindOutputChange?: (tailwindOutput: TailwindOutput) => void;
    onTailwindPrefixChange: (tailwindPrefix: string) => void;
    onTailwindUnitChange: (tailwindUnit: TailwindUnit) => void;
    onTailwindColorModeChange: (tailwindColorMode: TailwindColorMode) => void;
}

/**
 * The FORMAT-SPECIFIC export option controls (CSV row/col, JSON DSCG, Tailwind
 * output/prefix/unit/colors), extracted from ExportOptions so they can render
 * inline under each checked format on the main page. The option FIELDS are
 * disjoint per format, so all instances edit the same global option object
 * without cross-contamination. Renders nothing for formats without options.
 */
export const FormatOptionsControls: React.FC<FormatOptionsControlsProps> = ({
    format,
    idPrefix,
    useRowColumnPos,
    useDSCGFormat,
    tailwindOutput,
    tailwindPrefix,
    tailwindUnit,
    tailwindColorMode,
    onUseRowColumnPosChange,
    onUseDSCGFormatChange,
    onTailwindOutputChange,
    onTailwindPrefixChange,
    onTailwindUnitChange,
    onTailwindColorModeChange
}) => {
    switch (format) {
        case OutputFormats.CSV:
            return (
                <Flex gap="2">
                    <Switch
                        id={`${idPrefix}-row-column-pos`}
                        onCheckedChange={onUseRowColumnPosChange}
                        checked={useRowColumnPos}
                        style={{ flexShrink: 0 }}
                    />
                    <Label htmlFor={`${idPrefix}-row-column-pos`}>
                        Use row &amp; column positions (i.e.: <code>=E7</code>) for linked vars
                    </Label>
                </Flex>
            );
        case OutputFormats.JSON:
            return (
                <Flex gap="2" justify="between" align="center">
                    <Label htmlFor={`${idPrefix}-dscg-format`}>
                        Normalize to DSCG (Design Tokens W3C Community Group)
                    </Label>
                    <Switch
                        id={`${idPrefix}-dscg-format`}
                        onCheckedChange={onUseDSCGFormatChange}
                        checked={useDSCGFormat}
                        style={{ flexShrink: 0 }}
                    />
                </Flex>
            );
        case OutputFormats.TAILWIND:
            return (
                <>
                    {onTailwindOutputChange ? (
                        <Flex direction="column" gap="1">
                            <Label
                                htmlFor={`${idPrefix}-tailwind-output`}
                                style={{ color: "var(--figma-color-text-secondary)" }}
                            >
                                Output
                            </Label>
                            <Select.Root
                                value={tailwindOutput}
                                onValueChange={(value) => onTailwindOutputChange(value as TailwindOutput)}
                            >
                                <Select.Trigger id={`${idPrefix}-tailwind-output`} placeholder="CSS (v4)" />
                                <Select.Content portal>
                                    <Select.Item value="css">CSS (Tailwind v4)</Select.Item>
                                    <Select.Item value="preset">Preset (Tailwind v3)</Select.Item>
                                </Select.Content>
                            </Select.Root>
                        </Flex>
                    ) : null}
                    <Flex direction="column" gap="1">
                        <Label
                            htmlFor={`${idPrefix}-tailwind-prefix`}
                            style={{ color: "var(--figma-color-text-secondary)" }}
                        >
                            Prefix (optional)
                        </Label>
                        <Input
                            id={`${idPrefix}-tailwind-prefix`}
                            placeholder="Ex.: acme"
                            value={tailwindPrefix}
                            onChange={(e) => onTailwindPrefixChange(e.target.value.trim())}
                        />
                    </Flex>
                    <Flex direction="column" gap="1">
                        <Label
                            htmlFor={`${idPrefix}-tailwind-unit`}
                            style={{ color: "var(--figma-color-text-secondary)" }}
                        >
                            Unit
                        </Label>
                        <Select.Root
                            value={tailwindUnit}
                            onValueChange={(value) => onTailwindUnitChange(value as TailwindUnit)}
                        >
                            <Select.Trigger id={`${idPrefix}-tailwind-unit`} placeholder="px" />
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
                                htmlFor={`${idPrefix}-tailwind-color-mode`}
                                style={{ color: "var(--figma-color-text-secondary)" }}
                            >
                                Colors
                            </Label>
                            <Select.Root
                                value={tailwindColorMode}
                                onValueChange={(value) => onTailwindColorModeChange(value as TailwindColorMode)}
                            >
                                <Select.Trigger id={`${idPrefix}-tailwind-color-mode`} placeholder="var() + fallback" />
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
            );
        default:
            return null;
    }
};
