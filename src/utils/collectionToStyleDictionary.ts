import { rgbToHex8 } from "./color";
import { collectTokens, setNestedPath, type FlatToken } from "./collectionToTailwindPreset";
import type { ExportSelection } from "../types.d";

type StyleDictionaryLeaf = { value: string | number | boolean; type: StyleDictionaryLeafType };

/** The legacy Style Dictionary token types this exporter can emit. */
type StyleDictionaryLeafType = "color" | "number" | "string" | "boolean" | "other";

/** Maps a resolved Figma type to a legacy Style Dictionary token type. */
const TYPE_MAP: Record<string, StyleDictionaryLeafType> = {
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
 * Whether a node of the token tree is a `{ value, type }` leaf (as opposed to
 * a group of children). A group only gains a "value" key if a leaf was placed
 * under that name, so an own `value` property marks the node as a leaf.
 */
function isTokenLeaf(node: unknown): node is StyleDictionaryLeaf {
    return typeof node === "object" && node !== null && !Array.isArray(node) && "value" in node;
}

/**
 * Whether placing a leaf at `path` would collide with what is already in the
 * tree: a duplicate token at the same path, a leaf over an existing group, or
 * a group over an existing leaf (e.g. "Colors/Blue" next to "Colors/Blue/500").
 */
function pathCollides(root: Record<string, any>, path: string[]): boolean {
    let current = root;
    for (let i = 0; i < path.length; i++) {
        const existing = Object.prototype.hasOwnProperty.call(current, path[i]) ? current[path[i]] : undefined;
        if (existing === undefined) return false;
        // Any existing node at the final segment collides with the new leaf
        // (duplicate token name, or a group where the leaf would land).
        if (i === path.length - 1) return true;
        // Nesting children under an existing token would mix leaf and group.
        if (isTokenLeaf(existing)) return true;
        current = existing;
    }
    return false;
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
            const path = [token.category, ...token.path];
            // Never mix tokens and groups and never overwrite silently: on a
            // collision (homonymous tokens or leaf/group conflicts) the first
            // token wins and the collider is skipped with a warning.
            if (pathCollides(root, path)) {
                console.warn(`Variform Style Dictionary export: token "${path.join("/")}" skipped — its path collides with an existing token or group (the first one wins).`);
                continue;
            }
            setNestedPath(root, path, styleDictionaryLeaf(token));
        }

        return `${JSON.stringify(root, null, 2)}\n`;
    } catch (err) {
        console.error(err);
        return `/* Something went wrong while converting to a Style Dictionary:
            ${err}*/`;
    }
};
