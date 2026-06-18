/// <reference types="@figma/plugin-typings" />

import { exportToCSV } from "./utils/collectionToCSV";
import { exportToJSON } from "./utils/collectionToJSON";
import { exportToDSCG } from "./utils/collectionToDSCG";
import { exportToCSS } from "./utils/collectionToCSS";
import { exportToTailwind } from "./utils/collectionToTailwind";
import { exportToJS } from "./utils/collectionToJS";
import { OutputFormats, MessageTypes, PluginCommands, PluginMessage, CollectionMeta, ExportSelection, StyleSelection } from "./types.d";
import { ALL_STYLES } from "./utils/styleSelection";
import { rgbToCssColor } from "./utils/color";
import { getLocalStyles, stylesToInspectRows } from "./utils/styleSerializers";

figma.showUI(__html__, { width: 800, height: 500, themeColors: true });

/**
 * Handle plugin menu commands
 */
figma.on('run', ({ command }) => {
    // Send the command to UI immediately when plugin starts
    figma.ui.postMessage({
        type: MessageTypes.BASIC_INFO,
        command: command as PluginCommands,
        count: 0,
        filename: figma.root.name,
        editorType: figma.editorType || 'figma' // fallback to 'figma' if undefined
    } as PluginMessage);
});

/**
 * Handles the basic info request from UI.
 * Also sends the collection/mode tree so the UI can render the export-selection
 * accordion.
 */
async function handleBasicInfo(command?: PluginCommands) {
    const vars = await figma.variables.getLocalVariablesAsync();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const filename = figma.root.name;

    const collectionMetas: CollectionMeta[] = collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name }))
    }));

    figma.ui.postMessage({
        type: MessageTypes.BASIC_INFO,
        command,
        count: vars.length,
        filename,
        collections: collectionMetas,
        editorType: figma.editorType || 'figma' // fallback to 'figma' if undefined
    } as PluginMessage);
}

/**
 * Handles export requests with format-specific logic
 */
async function handleExport(
    format: OutputFormats,
    useLinkedVarRowAndColPos: boolean = false,
    useTailwindFormat: boolean = false,
    useDSCGFormat: boolean = false,
    selection?: ExportSelection,
    styleSelection: StyleSelection = ALL_STYLES,
    parserId?: string
) {
    try {
        let data: string;

        switch (format) {
            case OutputFormats.CSV:
                data = await exportToCSV(useLinkedVarRowAndColPos, selection, styleSelection, parserId) || '';
                break;
            case OutputFormats.JSON:
                data = useDSCGFormat ? await exportToDSCG(selection, styleSelection) || '' : await exportToJSON(selection, styleSelection, parserId) || '';
                break;
            case OutputFormats.JS:
                data = await exportToJS(selection, styleSelection, parserId) || '';
                break;
            case OutputFormats.CSS:
                data = useTailwindFormat ? await exportToTailwind(selection, styleSelection) : await exportToCSS(selection, styleSelection);
                break;
            default:
                throw new Error(`Unsupported format: ${format}`);
        }

        figma.ui.postMessage({
            type: MessageTypes.EXPORT_SUCCESS_RESULT,
            format,
            data,
        } as PluginMessage);
        // No success toast here: the export auto-runs on every format/option/
        // selection change to refresh the preview, so notifying would spam the
        // user. Errors are still surfaced below.
    } catch (error) {
        console.error(error);
        figma.notify('Something went wrong while attempting to export the variables. Check the console for more info.', {
            error: true
        });
        
        figma.ui.postMessage({
            type: MessageTypes.EXPORT_ERROR,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        } as PluginMessage);
    }
}

/**
 * Reads a value from the per-user client storage and returns it to the UI.
 * The UI cannot access figma.clientStorage directly, so it asks the plugin.
 */
async function handleStorageGet(storageKey?: string, requestId?: string) {
    if (!storageKey) {
        console.error('Storage read request missing key');
        return;
    }

    const stored = await figma.clientStorage.getAsync(storageKey);
    figma.ui.postMessage({
        type: MessageTypes.STORAGE_VALUE,
        storageKey,
        storageValue: typeof stored === 'string' ? stored : null,
        // Echoed so a promise bridge (utils/pluginBridge) can match the reply.
        requestId
    } as PluginMessage);
}

/**
 * Persists a value to the per-user client storage. Passing a null/undefined
 * value deletes the key (used when disconnecting a provider).
 */
async function handleStorageSet(storageKey?: string, storageValue?: string | null) {
    if (!storageKey) {
        console.error('Storage write request missing key');
        return;
    }

    if (storageValue === null || storageValue === undefined) {
        await figma.clientStorage.deleteAsync(storageKey);
    } else {
        await figma.clientStorage.setAsync(storageKey, storageValue);
    }
}

/**
 * Formats a single variable value for display in the inspect table.
 */
async function formatInspectValue(value: VariableValue | undefined): Promise<string> {
    if (value === undefined) return '';
    if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS') {
        const linked = await figma.variables.getVariableByIdAsync(value.id);
        return linked ? `→ ${linked.name}` : '→ (unlinked)';
    }
    if (typeof value === 'object' && value !== null && 'r' in value) {
        return rgbToCssColor(value as RGBA);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

/**
 * Builds a table of a collection's variables (one row per variable, one value
 * column per mode) and sends it to the UI for the inspect modal.
 */
async function handleInspectCollection(collectionId?: string, requestId?: string) {
    if (!collectionId) return;

    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
        figma.ui.postMessage({
            type: MessageTypes.INSPECT_RESULT,
            inspect: { title: 'Collection not found', columns: [], rows: [] },
            requestId
        } as PluginMessage);
        return;
    }

    // A single-mode collection shows a plain "Value" column (the mode name,
    // usually "Mode 1", carries no meaning); multi-mode collections keep one
    // column per mode name.
    const valueColumns = collection.modes.length === 1
        ? ['Value']
        : collection.modes.map((mode) => mode.name);
    const columns = ['Variable', 'Type', ...valueColumns, 'Description'];
    const rows: string[][] = [];

    for (const variableId of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (!variable) continue;

        const valueCells: string[] = [];
        for (const mode of collection.modes) {
            valueCells.push(await formatInspectValue(variable.valuesByMode[mode.modeId]));
        }
        rows.push([variable.name, variable.resolvedType, ...valueCells, variable.description || '']);
    }

    figma.ui.postMessage({
        type: MessageTypes.INSPECT_RESULT,
        inspect: { title: collection.name, columns, rows },
        requestId
    } as PluginMessage);
}

/**
 * Builds a table of all local styles and sends it to the UI for the inspect modal.
 */
async function handleInspectStyles(requestId?: string) {
    const styles = await getLocalStyles();
    figma.ui.postMessage({
        type: MessageTypes.INSPECT_RESULT,
        inspect: {
            title: 'Local styles',
            columns: ['Style', 'Kind', 'Value', 'Description'],
            rows: stylesToInspectRows(styles)
        },
        requestId
    } as PluginMessage);
}

/**
 * Main message handler for plugin communication
 */
figma.ui.onmessage = async (msg: PluginMessage) => {
    switch (msg.type) {
        case MessageTypes.GET_BASIC_INFO:
            await handleBasicInfo(msg.command);
            break;

        case MessageTypes.EXPORT_SUCCESS:
            if (msg.format) {
                await handleExport(
                    msg.format,
                    msg.useLinkedVarRowAndColPos || false,
                    msg.useTailwindFormat || false,
                    msg.useDSCGFormat || false,
                    msg.selection,
                    msg.styleSelection ?? ALL_STYLES,
                    msg.parserId
                );
            } else {
                console.error('Export request missing format');
            }
            break;

        case MessageTypes.STORAGE_GET:
            await handleStorageGet(msg.storageKey, msg.requestId);
            break;

        case MessageTypes.STORAGE_SET:
            await handleStorageSet(msg.storageKey, msg.storageValue);
            break;

        case MessageTypes.INSPECT_COLLECTION:
            await handleInspectCollection(msg.inspectCollectionId, msg.requestId);
            break;

        case MessageTypes.INSPECT_STYLES:
            await handleInspectStyles(msg.requestId);
            break;

        default:
            console.warn(`Unknown message type: ${msg.type}`);
    }
};
