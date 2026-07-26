import { rgbToHex8 } from "./color";
import { collectTokens, setNestedPath, type FlatToken } from "./collectionToTailwindPreset";
import type { ExportSelection } from "../types.d";

type StyleDictionaryLeaf = { value: string | number | boolean; type: string };

/** Maps a resolved Figma type to a legacy Style Dictionary token type. */
const TYPE_MAP: Record<string, string> = {
    COLOR: "color",
    FLOAT: "number",
    STRING: "string",
    BOOLEAN: "boolean",
};

/**
 * Formats a concrete token as a legacy Style Dictionary (CTI) leaf: colors as
 * hex strings, floats as numbers rounded to 3 decimals, strings and booleans
 * as-is.
 * @param token - The flat token to format
 * @returns The `{ value, type }` leaf object
 */
function styleDictionaryLeaf(token: FlatToken): StyleDictionaryLeaf {
    let value: string | number | boolean;
    switch (token.resolvedType) {
        case "COLOR":
            value = rgbToHex8(token.value as RGBA);
            break;
        case "FLOAT": {
            const num = typeof token.value === "number" ? token.value : parseFloat(token.value as string);
            value = Math.round(num * 1000) / 1000;
            break;
        }
        case "BOOLEAN":
            value = Boolean(token.value);
            break;
        default:
            value = String(token.value);
    }
    return { value, type: TYPE_MAP[token.resolvedType] ?? "other" };
}

/**
 * Exports all local variable collections as a legacy Amazon Style Dictionary
 * (CTI) JSON file: nested groups with `{ value, type }` leaves. A static
 * export holds a single value per token, so values come from the first
 * selected mode of each collection and aliases are resolved to concrete values.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @returns JSON string of the Style Dictionary token tree
 */
export const exportToStyleDictionary = async (
    selection?: ExportSelection,
    prefix: string = ""
): Promise<string> => {
    try {
        const { tokens } = await collectTokens(selection, prefix);
        const root: Record<string, any> = {};

        for (const token of tokens) {
            setNestedPath(root, [token.category, ...token.path], styleDictionaryLeaf(token));
        }

        return `${JSON.stringify(root, null, 2)}\n`;
    } catch (err) {
        console.error(err);
        return `/* Something went wrong while converting to a Style Dictionary:
            ${err}*/`;
    }
};
