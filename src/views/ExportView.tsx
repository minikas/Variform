import React, { useEffect } from "react";
import { Checkbox, Select } from "figma-kit";
import { OutputFormats, TailwindOutput } from "../types.d";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { ExportHeader } from "../components/ExportHeader";
import { SectionAccordion } from "../components/SectionAccordion";
import { FormatOptionsControls } from "../components/FormatOptionsControls";
import { ParserSelect } from "../components/ParserSelect";
import { FilenameInput } from "../components/FilenameInput";
import { CollectionAccordion } from "../components/CollectionAccordion";
import { ExportActions } from "../components/ExportActions";
import { OutputPreview } from "../components/OutputPreview";
import { PreviewSkeleton } from "../components/PreviewSkeleton";
import { ExportLayout } from "../components/ExportLayout";
import { useExportData } from "../hooks/useExportData";
import { useSelection } from "../contexts/SelectionContext";
import { formatExtension } from "../utils/formatExtension";
import { defaultFilename } from "../utils/filename";
import { formatLabel } from "../utils/formatLabel";

interface ExportViewProps {
    editorType?: string;
}

/** Formats offered on the main page, in display order. */
const ALL_FORMATS = Object.values(OutputFormats);

/**
 * Generic export view with a MULTI-FORMAT selector (default command).
 * Each checked format shows its format-specific options inline; the preview
 * and download follow the active format (the last checked one). The checked
 * set is what the GitHub push dialog derives its targets from.
 */
export const ExportView: React.FC<ExportViewProps> = ({ editorType = "" }) => {
    // Formats + active format are persisted (per document) in SelectionContext.
    const { format, formats, setFormat, toggleFormat, filenameByFormat, setFilenameFor } = useSelection();
    const {
        useRowColumnPos,
        setUseRowColumnPos,
        useDSCGFormat,
        setUseDSCGFormat,
        tailwindOutput,
        setTailwindOutput,
        tailwindPrefix,
        setTailwindPrefix,
        tailwindUnit,
        setTailwindUnit,
        tailwindColorMode,
        setTailwindColorMode,
        exportedData,
        setExportedData,
        canExport,
        isExporting,
        handleDownload
    } = useExportData({ format });

    // Clear exported data when the ACTIVE format changes to refresh preview
    useEffect(() => {
        setExportedData("");
    }, [format]);

    // The description parser applies to the formats that emit the description
    // as data: JSON (non-DSCG), JavaScript, TypeScript and CSV.
    const showParserFor = (item: OutputFormats) =>
        (item === OutputFormats.JSON && !useDSCGFormat) ||
        item === OutputFormats.JS ||
        item === OutputFormats.TS ||
        item === OutputFormats.CSV;

    // Shared option values/handlers for every per-format control block (the
    // fields are disjoint per format, so one global object serves them all).
    const optionControls = (item: OutputFormats) => (
        <FormatOptionsControls
            format={item}
            idPrefix={`varvar-fmt-${item}`}
            useRowColumnPos={useRowColumnPos}
            useDSCGFormat={useDSCGFormat}
            tailwindOutput={tailwindOutput}
            tailwindPrefix={tailwindPrefix}
            tailwindUnit={tailwindUnit}
            tailwindColorMode={tailwindColorMode}
            onUseRowColumnPosChange={setUseRowColumnPos}
            onUseDSCGFormatChange={setUseDSCGFormat}
            onTailwindOutputChange={setTailwindOutput}
            onTailwindPrefixChange={setTailwindPrefix}
            onTailwindUnitChange={setTailwindUnit}
            onTailwindColorModeChange={setTailwindColorMode}
        />
    );

    const formControls = (
        <>
            <ExportHeader format={format} title="Export" />

            <SectionAccordion
                label="Formats"
                summary={
                    formats.length > 1
                        ? `${formats.length} selected`
                        : formats.length === 1
                          ? formatLabel(format)
                          : "None"
                }
            >
                {ALL_FORMATS.map((item) => {
                    const checked = formats.includes(item);
                    return (
                        <div key={item}>
                            <Checkbox.Root>
                                <Checkbox.Input
                                    id={`varvar-format-${item}`}
                                    checked={checked}
                                    onChange={() => toggleFormat(item)}
                                />
                                <Checkbox.Label htmlFor={`varvar-format-${item}`}>
                                    {formatLabel(item)}
                                </Checkbox.Label>
                            </Checkbox.Root>
                            {checked ? (
                                <div style={{ paddingLeft: "var(--space-5)", paddingTop: "2px", paddingBottom: "4px", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                                    {optionControls(item)}
                                    <ParserSelect
                                        id={`varvar-parser-${item}`}
                                        show={showParserFor(item)}
                                    />
                                    {item === OutputFormats.TAILWIND ? (
                                        // Multi-file format: one filename per
                                        // produced file (stylesheet + preset).
                                        <>
                                            <FilenameInput
                                                id={`varvar-filename-${item}-css`}
                                                label="Stylesheet filename"
                                                extension="css"
                                                filename={filenameByFormat["tailwind"] ?? defaultFilename("tailwind")}
                                                emptyFallback={defaultFilename("tailwind")}
                                                onFilenameChange={(name) => setFilenameFor("tailwind", name)}
                                            />
                                            <FilenameInput
                                                id={`varvar-filename-${item}-preset`}
                                                label="Preset filename"
                                                extension="js"
                                                filename={filenameByFormat["tailwind:preset"] ?? defaultFilename("tailwind:preset")}
                                                emptyFallback={defaultFilename("tailwind:preset")}
                                                onFilenameChange={(name) => setFilenameFor("tailwind:preset", name)}
                                            />
                                        </>
                                    ) : (
                                        <FilenameInput
                                            id={`varvar-filename-${item}`}
                                            extension={formatExtension(item, tailwindOutput)}
                                            filename={filenameByFormat[item] ?? defaultFilename(item)}
                                            emptyFallback={defaultFilename(item)}
                                            onFilenameChange={(name) => setFilenameFor(item, name)}
                                        />
                                    )}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </SectionAccordion>

            <CollectionAccordion />

            <ExportActions
                canExport={canExport && formats.length > 0}
                onDownload={handleDownload}
            />
        </>
    );

    // With several formats checked, the preview gets a picker to switch the
    // previewed format without leaving the preview pane.
    const formatPicker = formats.length > 1 ? (
        <Select.Root
            value={format}
            onValueChange={(value) => setFormat(value as OutputFormats)}
        >
            <Select.Trigger id="varvar-preview-format" aria-label="Preview format" />
            <Select.Content portal>
                {formats.map((item) => (
                    <Select.Item key={item} value={item}>
                        {formatLabel(item)}
                    </Select.Item>
                ))}
            </Select.Content>
        </Select.Root>
    ) : undefined;

    // With no format checked there is nothing to preview: hide the pane and
    // keep the actions disabled (canExport above).
    const preview = formats.length === 0 ? null : isExporting ? (
        <PreviewSkeleton editorType={editorType} />
    ) : exportedData ? (
        <OutputPreview
            exportedData={exportedData}
            editorType={editorType}
            toolbarStart={formatPicker}
            previewOptions={format === OutputFormats.TAILWIND ? [
                { value: "css", label: `${filenameByFormat["tailwind"] ?? defaultFilename("tailwind")}.css` },
                { value: "preset", label: `${filenameByFormat["tailwind:preset"] ?? defaultFilename("tailwind:preset")}.js` },
            ] : undefined}
            previewOptionValue={format === OutputFormats.TAILWIND ? tailwindOutput : undefined}
            onPreviewOptionChange={format === OutputFormats.TAILWIND
                ? (value) => setTailwindOutput(value as TailwindOutput)
                : undefined}
        />
    ) : null;

    return (
        <PluginDialogShell>
            <ExportLayout 
                editorType={editorType}
                children={formControls}
                preview={preview}
            />
        </PluginDialogShell>
    );
};
