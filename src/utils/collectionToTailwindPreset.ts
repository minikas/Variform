import { rgbToTailwindColor, rgbToHex8 } from "./color";
import { toCssVar } from "./stringTransformation";
import { getMatchingModeName } from "./variableUtils";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { detectTailwindCategory, transformToTailwindName, formatTailwindLength } from "./collectionToTailwind";
import type { ExportSelection, TailwindColorMode, TailwindUnit } from "../types.d";

type PresetDictionary = Record<string, any>;

/** v3 theme keys whose FLOAT values are lengths (emitted as "Npx"). */
const PX_KEYS = new Set(["spacing", "borderRadius", "fontSize", "letterSpacing"]);
/** v3 theme keys whose FLOAT values are unitless (emitted as numbers). */
const NUMBER_KEYS = new Set(["fontWeight", "lineHeight", "opacity"]);

/**
 * Maps a variable to its Tailwind v3 theme key, reusing the v4 category
 * heuristic and translating it to the classic `theme.extend` dictionary keys.
 * @param name - Original variable name
 * @param resolvedType - Type of the variable
 * @returns v3 theme key (colors, spacing, fontSize, ...)
 */
export function tailwindPresetKey(name: string, resolvedType: string): string {
    const category = detectTailwindCategory(name, resolvedType);
    switch (category) {
        case "color": return "colors";
        case "spacing": return "spacing";
        case "size": return name.toLowerCase().includes("radius") ? "borderRadius" : "spacing";
        case "font-family":
        case "font": return "fontFamily";
        case "font-size": return "fontSize";
        case "font-weight": return "fontWeight";
        case "line-height": return "lineHeight";
        case "letter-spacing": return "letterSpacing";
        case "duration": return "transitionDuration";
        case "shadow": return "boxShadow";
        case "opacity": return "opacity";
        default:
            if (resolvedType === "COLOR") return "colors";
            if (resolvedType === "FLOAT") return "spacing";
            return "other";
    }
}

/**
 * Builds the token path inside a theme category from the variable's Figma
 * groups. A leading segment that just repeats the category is dropped
 * (e.g. "Colors/Blue/500" inside `colors` becomes "blue/500"), and the
 * optional prefix is prepended to the first remaining segment.
 * @param name - Original variable name
 * @param category - The v4 category segment used for the redundant-prefix check
 * @param prefix - Optional prefix for the token family segment
 * @returns Path segments (kebab-case) below the theme key
 */
export function tokenPath(name: string, category: string, prefix: string = ""): string[] {
    const parts = name.split("/").map((part) => toCssVar(part.trim()));
    if (parts.length > 1 && category && (parts[0] === category || parts[0] === `${category}s`)) {
        parts.shift();
    }
    if (prefix) {
        parts[0] = `${toCssVar(prefix)}-${parts[0]}`;
    }
    return parts;
}

/**
 * Formats a concrete non-color value for the v3 dictionary (colors are handled
 * by {@link colorValue}).
 * @param resolvedType - Type of the (resolved) value
 * @param value - The concrete value (aliases already resolved)
 * @param presetKey - The v3 theme key the value belongs to
 * @returns The value as it should appear in the preset
 */
function presetValue(resolvedType: string, value: VariableValue, presetKey: string, unit: TailwindUnit): string | number {
    if (resolvedType === "FLOAT") {
        const num = parseFloat(value as string);
        if (PX_KEYS.has(presetKey)) return formatTailwindLength(num, unit);
        if (presetKey === "transitionDuration") return `${num}ms`;
        if (NUMBER_KEYS.has(presetKey)) return num;
        return String(value);
    }
    if (resolvedType === "BOOLEAN") return Boolean(value) ? "true" : "false";
    return String(value);
}

/**
 * Formats a color token for the v3 dictionary. In "var-fallback" mode (the
 * default) opaque colors reference the same CSS variable the Tailwind CSS v4
 * export emits (with a hex fallback), using the relative-color `<alpha-value>`
 * placeholder so opacity modifiers (e.g. `bg-primary/20`) inject the alpha
 * channel; "var" emits the bare variable; "concrete" emits the rgb() value;
 * "hex" emits plain hex (hex8 when the color has alpha). Translucent colors
 * stay concrete in the var modes — their own alpha would be overridden by the
 * modifier anyway.
 * @param name - Name of the variable holding the (terminal) color value
 * @param value - The concrete RGBA value (used as the var() fallback)
 * @param prefix - Optional prefix, matching the CSS v4 export
 * @param colorMode - How the color references the CSS variable, if at all
 * @returns The color expression for the preset
 */
function colorValue(name: string, value: RGBA, prefix: string, colorMode: TailwindColorMode): string {
    if (colorMode === "hex") {
        return rgbToHex8(value);
    }
    if (value.a !== undefined && value.a !== 1) {
        return rgbToTailwindColor(value);
    }
    const varName = transformToTailwindName(name, "COLOR", prefix);
    switch (colorMode) {
        case "var":
            return `var(${varName})`;
        case "concrete":
            return rgbToTailwindColor(value);
        default:
            return `rgb(from var(${varName}, ${rgbToHex8(value)}) r g b / <alpha-value>)`;
    }
}

/**
 * Resolves a VARIABLE_ALIAS chain to a concrete value, following the linked
 * variable's matching mode (by mode name, like the other exporters).
 * @param variableId - Id of the linked variable
 * @param modeName - Name of the mode being exported
 * @param depth - Guard against alias cycles
 * @returns The terminal variable's name, concrete value and type, or null
 */
async function resolveAlias(
    variableId: string,
    modeName: string,
    depth: number
): Promise<{ name: string; value: VariableValue; resolvedType: VariableResolvedDataType } | null> {
    if (depth > 5) return null;
    const linkedVar = await figma.variables.getVariableByIdAsync(variableId);
    if (!linkedVar) return null;

    const linkedCollection = await figma.variables.getVariableCollectionByIdAsync(linkedVar.variableCollectionId);
    const matchedModeName = linkedCollection ? getMatchingModeName(modeName, linkedCollection) : modeName;
    const matchedMode =
        linkedCollection?.modes.find((mode) => mode.name === matchedModeName) ?? linkedCollection?.modes[0];
    const value = matchedMode ? linkedVar.valuesByMode[matchedMode.modeId] : undefined;

    if (value === undefined) return null;
    if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
        return resolveAlias(value.id, modeName, depth + 1);
    }
    return { name: linkedVar.name, value, resolvedType: linkedVar.resolvedType };
}

/**
 * Sets a value at a nested path inside a dictionary, creating intermediate
 * objects as needed. Shared by the dictionary-style serializers (Tailwind
 * preset, React Native, Tamagui, Style Dictionary).
 */
export function setNestedPath(root: Record<string, any>, path: string[], value: unknown): void {
    let current = root;
    for (let i = 0; i < path.length - 1; i++) {
        current[path[i]] = current[path[i]] || {};
        current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
}

/**
 * A variable flattened to a concrete, category-tagged token: the shared input
 * for all dictionary-style serializers (Tailwind preset, React Native,
 * Tamagui, SCSS, Style Dictionary, Swift, Android, Flutter).
 */
export interface FlatToken {
    /** Category key (colors, spacing, fontSize, borderRadius, ...). */
    category: string;
    /** Token path segments below the category (kebab-case, prefix applied). */
    path: string[];
    /** Terminal variable name (after alias resolution). */
    terminalName: string;
    /** Terminal resolved type (after alias resolution). */
    resolvedType: VariableResolvedDataType;
    /** Concrete value (aliases resolved). */
    value: VariableValue;
}

/**
 * A full theme of concrete tokens for one mode name. Collections that do not
 * have a mode with that name contribute their default (first selected) mode
 * values, so every theme is complete.
 */
export interface ThemeTokens {
    /** The mode name this theme represents (e.g. "Dark"). */
    mode: string;
    tokens: FlatToken[];
}

/**
 * Flattens a collection's variables to concrete tokens for one effective mode,
 * resolving aliases to the terminal token.
 */
async function flattenCollection(
    collection: VariableCollection,
    mode: { name: string; modeId: string },
    prefix: string,
    validTypes: Set<VariableResolvedDataType>
): Promise<FlatToken[]> {
    const tokens: FlatToken[] = [];

    for (const variableId of collection.variableIds) {
        const figVar = await figma.variables.getVariableByIdAsync(variableId);
        if (!figVar || !validTypes.has(figVar.resolvedType)) continue;

        const { name, resolvedType, valuesByMode } = figVar;
        let value: VariableValue | undefined = valuesByMode[mode.modeId];
        let valueType = resolvedType;
        let terminalName = name;

        if (value !== undefined && typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
            const resolved = await resolveAlias(value.id, mode.name, 0);
            if (!resolved) continue;  // broken alias: skip the token
            value = resolved.value;
            valueType = resolved.resolvedType;
            terminalName = resolved.name;
        }
        if (value === undefined) continue;

        tokens.push({
            category: tailwindPresetKey(name, resolvedType),
            path: tokenPath(name, detectTailwindCategory(name, resolvedType), prefix),
            terminalName,
            resolvedType: valueType,
            value,
        });
    }

    return tokens;
}

/**
 * Flattens all selected variable collections to concrete tokens with theme
 * variants: the default theme uses the first selected mode of each collection
 * (a static export's single value per token), and every other selected mode
 * name (e.g. "Dark") becomes an extra complete theme — collections lacking
 * that mode contribute their default values, and aliases resolve through
 * mode-name matching.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @returns Default tokens, the default mode labels, and extra theme variants
 */
export async function collectThemedTokens(
    selection?: ExportSelection,
    prefix: string = ""
): Promise<{ defaultTokens: FlatToken[]; usedModes: string[]; extraThemes: ThemeTokens[] }> {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const validTypes = new Set<VariableResolvedDataType>(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);

    interface EffectiveCollection {
        collection: VariableCollection;
        defaultMode: { name: string; modeId: string };
        modes: { name: string; modeId: string }[];
    }
    const effective: EffectiveCollection[] = [];
    const usedModes: string[] = [];
    const extraModeNames: string[] = [];

    for (const collection of collections) {
        if (!isCollectionSelected(collection.id, selection)) continue;
        const modes = selectedModes(collection.id, collection.modes, selection);
        const [defaultMode] = modes;
        if (!defaultMode) continue;
        effective.push({ collection, defaultMode, modes });
        usedModes.push(`${collection.name} → ${defaultMode.name}`);

        // Mode names beyond each collection's default become theme variants.
        for (const mode of modes.slice(1)) {
            if (!extraModeNames.some((name) => name.toLowerCase() === mode.name.trim().toLowerCase())) {
                extraModeNames.push(mode.name);
            }
        }
    }

    const defaultTokens: FlatToken[] = [];
    for (const { collection, defaultMode } of effective) {
        defaultTokens.push(...await flattenCollection(collection, defaultMode, prefix, validTypes));
    }

    const extraThemes: ThemeTokens[] = [];
    for (const modeName of extraModeNames) {
        const tokens: FlatToken[] = [];
        for (const { collection, defaultMode, modes } of effective) {
            // Collections without this mode fall back to their default values,
            // so every theme variant is complete.
            const match = modes.find((mode) => mode.name.trim().toLowerCase() === modeName.trim().toLowerCase());
            tokens.push(...await flattenCollection(collection, match ?? defaultMode, prefix, validTypes));
        }
        extraThemes.push({ mode: modeName, tokens });
    }

    return { defaultTokens, usedModes, extraThemes };
}

/**
 * Flattens all selected variable collections to concrete tokens: uses the
 * first selected mode of each collection (static exports hold a single value
 * per token) and resolves aliases to the terminal token.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @returns The flat tokens plus the "Collection → Mode" labels used
 */
export async function collectTokens(
    selection?: ExportSelection,
    prefix: string = ""
): Promise<{ tokens: FlatToken[]; usedModes: string[] }> {
    const { defaultTokens, usedModes } = await collectThemedTokens(selection, prefix);
    return { tokens: defaultTokens, usedModes };
}

/**
 * Serializes the dictionary as a JS object literal, unquoting keys that are
 * valid identifiers (kebab-case and numeric keys stay quoted).
 */
function serializeDictionary(dictionary: PresetDictionary): string {
    return JSON.stringify(dictionary, null, 2)
        .replace(/"([A-Za-z_$][A-Za-z0-9_$]*)":/g, "$1:");
}

/**
 * Exports all local variable collections as a Tailwind v3 preset (dictionary
 * with `theme.extend`). A preset is static, so values come from the first
 * selected mode of each collection and aliases are resolved to concrete values.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @param unit - Length unit for px-valued tokens (rem/em use a 16px base)
 * @param colorMode - How colors reference the CSS variables, if at all
 * @returns JavaScript module string exporting the preset
 */
export const exportToTailwindPreset = async (
    selection?: ExportSelection,
    prefix: string = "",
    unit: TailwindUnit = "px",
    colorMode: TailwindColorMode = "var-fallback"
): Promise<string> => {
    try {
        const { tokens, usedModes } = await collectTokens(selection, prefix);
        const extend: PresetDictionary = {};

        for (const token of tokens) {
            const formatted = token.resolvedType === "COLOR"
                ? colorValue(token.terminalName, token.value as RGBA, prefix, colorMode)
                : presetValue(token.resolvedType, token.value, token.category, unit);
            setNestedPath(extend, [token.category, ...token.path], formatted);
        }

        const header = [
            "/**",
            " * Tailwind CSS v3 preset generated by Variform.",
            " * Static preset: values come from the first selected mode of each",
            " * collection and aliases are resolved to concrete values.",
            ...(colorMode === "var-fallback" ? [
                " * Colors reference the CSS variables emitted by the Tailwind CSS",
                " * (v4) export, with a hex fallback and <alpha-value> support.",
            ] : []),
            ...(usedModes.length > 0 ? [` * Modes: ${usedModes.join("; ")}`] : []),
            ...(prefix ? [` * Prefix: "${toCssVar(prefix)}"`] : []),
            ...(unit !== "px" ? [` * Unit: ${unit} (converted from a 16px base)`] : []),
            ...(colorMode !== "var-fallback" ? [` * Colors: ${colorMode}`] : []),
            " */",
        ].join("\n");

        // Note: no `@type` JSDoc with a dynamic import expression here — the
        // Figma plugin runtime statically rejects anything resembling one,
        // even inside a string, which would break the whole plugin bundle.
        const config = `module.exports = ${serializeDictionary({ theme: { extend } })};\n`;

        return `${header}\n\n${config}`;
    } catch (err) {
        console.error(err);
        return `/* Something went wrong while converting to a Tailwind preset:
            ${err}*/`;
    }
};
