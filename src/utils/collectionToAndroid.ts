import { collectThemedTokens } from "./collectionToTailwindPreset";
import type { FlatToken } from "./collectionToTailwindPreset";
import { rgbaToArgbHex } from "./color";
import type { ExportSelection } from "../types.d";

/** Categories whose FLOAT values are lengths (emitted as `<dimen>`). */
const LENGTH_CATEGORIES = new Set(["spacing", "borderRadius", "fontSize", "letterSpacing"]);

/**
 * Builds the Android resource name for a token: snake_case of the category
 * plus the path segments (colors + ["blue","500"] → colors_blue_500).
 */
function resourceName(token: FlatToken): string {
    return `${token.category}_${token.path.join("_")}`
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_");
}

/**
 * Derives a unique resource name per token: collisions (e.g. "Colors/Blue 500"
 * and "Colors/Blue-500" both sanitize to colors_blue_500) get a numeric suffix
 * so aapt never sees the same resource declared twice in one file.
 */
function uniqueResourceNames(tokens: FlatToken[]): string[] {
    const used = new Set<string>();
    return tokens.map((token) => {
        const base = resourceName(token);
        let unique = base;
        let suffix = 2;
        while (used.has(unique)) unique = `${base}_${suffix++}`;
        if (unique !== base) {
            console.warn(`Android export: duplicate resource name "${base}" (${token.terminalName}) emitted as "${unique}"`);
        }
        used.add(unique);
        return unique;
    });
}

/** Rounds to 3 decimals and strips trailing zeros (16 → "16", 0.5 → "0.5"). */
function formatNumber(n: number): string {
    return String(parseFloat(n.toFixed(3)));
}

/**
 * Escapes a value for an Android `<string>` resource. XML entities alone are
 * not enough: aapt resolves `&apos;`/`&quot;` before its own escape check and
 * then fails with "Apostrophe not preceded by \", so quotes must use the
 * Android backslash escapes (`\'`, `\"`). Backslashes are escaped first so a
 * raw `\` cannot fuse with those escapes, and a leading `@` is escaped to `\@`
 * because aapt would otherwise read the value as a resource reference and fail
 * to resolve it.
 */
function escapeStringResource(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/^@/, "\\@");
}

/** Serializes a token as one Android resource element. */
function resourceElement(token: FlatToken, name: string): string {
    switch (token.resolvedType) {
        case "COLOR":
            return `<color name="${name}">${rgbaToArgbHex(token.value as RGBA)}</color>`;
        case "FLOAT": {
            const num = Number(token.value);
            if (LENGTH_CATEGORIES.has(token.category)) {
                const unit = token.category === "fontSize" ? "sp" : "dp";
                return `<dimen name="${name}">${formatNumber(num)}${unit}</dimen>`;
            }
            if (token.category === "transitionDuration") {
                return `<integer name="${name}">${Math.round(num)}</integer>`;
            }
            return `<item format="float" type="dimen" name="${name}">${formatNumber(num)}</item>`;
        }
        case "BOOLEAN":
            return `<bool name="${name}">${Boolean(token.value)}</bool>`;
        default:
            return `<string name="${name}">${escapeStringResource(String(token.value))}</string>`;
    }
}

/**
 * Exports all local variable collections as Android resources. The default
 * `<resources>` document holds the first selected mode of each collection and
 * belongs in `res/values/` (the default resources Android always requires).
 * A mode named "Dark" becomes an extra `<resources>` block for
 * `res/values-night/`, matching the documented night-qualifier mechanism
 * (https://developer.android.com/develop/ui/views/theming/darktheme); other
 * mode names have no Android qualifier and are flagged for manual mapping.
 * Qualifiers require one file per directory, so the output intentionally
 * contains multiple root elements to split into separate files. Aliases are
 * resolved to concrete values.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @returns XML string with one `<resources>` document per theme
 */
export const exportToAndroid = async (
    selection?: ExportSelection,
    prefix: string = ""
): Promise<string> => {
    try {
        const { defaultTokens, usedModes, extraThemes } = await collectThemedTokens(selection, prefix);

        const renderResources = (tokens: FlatToken[]): string => {
            const names = uniqueResourceNames(tokens);
            const lines = tokens.map((token, index) => `    ${resourceElement(token, names[index])}`);
            return ["<resources>", ...lines, "</resources>"].join("\n");
        };

        const header = [
            '<?xml version="1.0" encoding="utf-8"?>',
            "<!-- Android resources generated by Variform. Static export: first selected mode per collection, aliases resolved. -->",
            ...(usedModes.length > 0 ? [`<!-- Modes: ${usedModes.join("; ")} -->`] : []),
            ...(extraThemes.length > 0 ? [
                "<!-- Android dark theme (https://developer.android.com/develop/ui/views/theming/darktheme):",
                "     - First block: default resources. Move to res/values/<file>.xml; an unqualified",
                "       default is always required or the app crashes on non-matching configurations.",
                "     - \"Dark\" block: move to res/values-night/<file>.xml with the SAME file name as the",
                "       default file; Android selects it at runtime via the night qualifier. The app theme",
                "       must inherit a DayNight theme (e.g. Theme.MaterialComponents.DayNight) to follow",
                "       the system night-mode flag; that wiring is app code, not generated here.",
                "     - Android has no qualifier for other named modes; those blocks need manual mapping.",
                "     One file per qualifier, so this output intentionally has multiple root elements. -->",
            ] : []),
        ].join("\n");

        const blocks = [renderResources(defaultTokens)];
        for (const theme of extraThemes) {
            const comment = theme.mode.trim().toLowerCase() === "dark"
                ? "<!-- Move this block to res/values-night/<file>.xml (same file name as the default res/values/ file) -->"
                : `<!-- No Android resource qualifier exists for mode "${theme.mode}": map it manually (e.g. into res/values-night/ or a custom theme) -->`;
            blocks.push(`${comment}\n${renderResources(theme.tokens)}`);
        }

        return `${header}\n${blocks.join("\n")}\n`;
    } catch (err) {
        console.error(err);
        return `<!-- Something went wrong while converting to Android resources:
            ${err} -->`;
    }
};
