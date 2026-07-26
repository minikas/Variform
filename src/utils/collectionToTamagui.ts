import { rgbToHex8 } from "./color";
import { toCssVar, toCamelCase } from "./stringTransformation";
import { collectThemedTokens } from "./collectionToTailwindPreset";
import { toJsObjectLiteral } from "./jsSerialize";
import type { FlatToken } from "./collectionToTailwindPreset";
import type { ExportSelection } from "../types.d";

type TokenGroups = Record<string, Record<string, string | number | boolean>>;

/** Theme name → theme key → JS expression (a reference into `tokens`). */
type ThemeExpressions = Record<string, Record<string, string>>;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Maps a FlatToken category to its Tamagui token group. Tamagui's core groups
 * (color, space, size, radius, zIndex) are flat maps; any other category
 * keeps its own name as a custom group.
 */
const TAMAGUI_GROUPS: Record<string, string> = {
    colors: "color",
    spacing: "space",
    fontSize: "size",
    borderRadius: "radius",
};

/**
 * Formats an object key for serialized output: bare when it is a valid
 * identifier, quoted otherwise (numeric and kebab-case keys stay quoted).
 */
function propertyKey(key: string): string {
    return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/**
 * Builds a member-access expression (`tokens.color.blue500`, falling back to
 * bracket notation for non-identifier keys like `tokens.space["4"]`).
 */
function member(object: string, key: string): string {
    return IDENTIFIER.test(key) ? `${object}.${key}` : `${object}[${JSON.stringify(key)}]`;
}

/**
 * Builds the flat camelCase token key inside a Tamagui group from the token
 * path segments (["blue","500"] → "blue500"). Keys starting with a digit
 * stay quoted in the serialized output.
 * @param path - Token path segments below the category (kebab-case)
 * @returns The flat camelCase group key
 */
function tamaguiKey(path: string[]): string {
    return toCamelCase(path.join(" "), false);
}

/**
 * Resolves the Tamagui group for a token (colors→color, spacing→space, ...).
 */
function tokenGroup(token: FlatToken): string {
    return TAMAGUI_GROUPS[token.category] ?? token.category;
}

/**
 * Formats a concrete token value: colors as hex strings (hex8 when
 * translucent), FLOATs as raw numbers rounded to 3 decimals, booleans and
 * strings as-is.
 * @param resolvedType - Type of the (resolved) value
 * @param value - The concrete value (aliases already resolved)
 * @returns The value as it should appear in the token group
 */
function tokenValue(resolvedType: string, value: VariableValue): string | number | boolean {
    if (resolvedType === "COLOR") return rgbToHex8(value as RGBA);
    if (resolvedType === "FLOAT") return Math.round(Number(value) * 1000) / 1000;
    if (resolvedType === "BOOLEAN") return Boolean(value);
    return String(value);
}

/**
 * Serializes the token groups as a JS object literal, unquoting keys that
 * are valid identifiers (numeric and kebab-case keys stay quoted).
 */
function serializeGroups(groups: TokenGroups): string {
    return toJsObjectLiteral(groups);
}

/**
 * Serializes themes as a JS object literal whose values are JS expressions
 * (references into `tokens`), so they cannot go through JSON.stringify.
 */
function serializeThemes(themes: ThemeExpressions): string {
    const lines: string[] = ["{"];
    const themeEntries = Object.entries(themes);
    themeEntries.forEach(([name, entries], i) => {
        lines.push(`  ${propertyKey(name)}: {`);
        const pairs = Object.entries(entries);
        pairs.forEach(([key, expression], j) => {
            lines.push(`    ${propertyKey(key)}: ${expression}${j < pairs.length - 1 ? "," : ""}`);
        });
        lines.push(`  }${i < themeEntries.length - 1 ? "," : ""}`);
    });
    lines.push("}");
    return lines.join("\n");
}

/**
 * Builds the flat Tamagui token groups (color, space, size, radius, ...)
 * from a flat token list. Homonymous tokens (same group + key, e.g. from
 * different collections) keep the first value and warn, instead of silently
 * overwriting each other.
 * @param tokens - The flat tokens of one theme variant
 * @returns The grouped token dictionary
 */
function buildTokenGroups(tokens: FlatToken[]): TokenGroups {
    const groups: TokenGroups = {};
    const seen = new Set<string>();
    for (const token of tokens) {
        const group = tokenGroup(token);
        const key = tamaguiKey(token.path);
        const id = `${group}/${key}`;
        if (seen.has(id)) {
            console.warn(`[Variform] Duplicate token "${id}" — keeping the first value.`);
            continue;
        }
        seen.add(id);
        groups[group] = groups[group] || {};
        groups[group][key] = tokenValue(token.resolvedType, token.value);
    }
    return groups;
}

/**
 * Normalizes a mode name into a theme key. toCamelCase keeps all-caps names
 * ("DARK") untouched, but Tamagui theme names are conventionally lowercase
 * ("dark") — normalize all-caps keys so <Theme name="dark" /> resolves.
 */
function themeKey(mode: string): string {
    const key = toCamelCase(mode);
    return /^[A-Z0-9_]+$/.test(key) ? key.toLowerCase() : key;
}

/**
 * Computes the theme entry key for each token of a theme: the flat camelCase
 * key, qualified with the group ("colorBackground") when the same key exists
 * in more than one group — otherwise the later token would silently
 * overwrite the earlier one in the flat theme map.
 * @param tokens - The flat tokens of one theme variant
 * @returns One theme entry key per token, aligned by index
 */
function themeEntryKeys(tokens: FlatToken[]): string[] {
    const keyGroups = new Map<string, Set<string>>();
    for (const token of tokens) {
        const key = tamaguiKey(token.path);
        const groups = keyGroups.get(key) ?? new Set<string>();
        groups.add(tokenGroup(token));
        keyGroups.set(key, groups);
    }
    return tokens.map((token) => {
        const key = tamaguiKey(token.path);
        if ((keyGroups.get(key)?.size ?? 0) > 1) {
            return tokenGroup(token) + key.charAt(0).toUpperCase() + key.slice(1);
        }
        return key;
    });
}

/**
 * Derives the default theme's name from the first used mode label
 * ("Collection → Mode" → camelCase of "Mode"), falling back to "default".
 * The LAST "→" segment is the mode name — collection names may themselves
 * contain " → ".
 * @param usedModes - The "Collection → Mode" labels used for the defaults
 * @returns The default theme key
 */
function defaultThemeName(usedModes: string[]): string {
    const [label] = usedModes;
    const modeName = label?.split("→").pop()?.trim();
    return modeName ? themeKey(modeName) : "default";
}

/**
 * Exports all local variable collections as a Tamagui `createTokens` config
 * plus a `themes` object, following https://tamagui.dev/docs/intro/themes:
 * one theme for the default mode (named after it, e.g. `light`) and one per
 * additional selected mode (e.g. `dark`). Theme entries reference the
 * generated tokens (`tokens.color.blue500`) instead of repeating raw values;
 * values that change per mode are added to the token groups as mode-suffixed
 * tokens (e.g. `blue500Dark`) — the docs' `gray2Dark` / `darkRed` pattern.
 * The default theme is never overwritten: an extra mode whose normalized
 * key collides with it (or with another extra) gets a numeric suffix, and
 * theme entry keys are qualified with their group when two groups share a
 * key. Ready for `createTamagui({ tokens, themes })`.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @returns TypeScript module string exporting the Tamagui tokens and themes
 */
export const exportToTamagui = async (
    selection?: ExportSelection,
    prefix: string = ""
): Promise<string> => {
    try {
        const { defaultTokens, usedModes, extraThemes } = await collectThemedTokens(selection, prefix);

        const groups = buildTokenGroups(defaultTokens);

        // Theme entries are references into `tokens` (the docs recommend
        // sharing token values down to themes over duplicating raw values).
        const themes: ThemeExpressions = {};
        const defaultTheme: Record<string, string> = {};
        const defaultValues = new Map<string, { group: string; key: string; value: string | number | boolean }>();
        const defaultEntryKeys = themeEntryKeys(defaultTokens);
        defaultTokens.forEach((token, index) => {
            const group = tokenGroup(token);
            const key = tamaguiKey(token.path);
            const entryKey = defaultEntryKeys[index];
            if (Object.prototype.hasOwnProperty.call(defaultTheme, entryKey)) {
                console.warn(`[Variform] Duplicate theme key "${entryKey}" in the default theme — keeping the first entry.`);
                return;
            }
            defaultTheme[entryKey] = member(member("tokens", group), key);
            defaultValues.set(`${token.category}/${token.path.join("/")}`, {
                group,
                key,
                value: tokenValue(token.resolvedType, token.value),
            });
        });
        themes[defaultThemeName(usedModes)] = defaultTheme;

        for (const { mode, tokens: modeTokens } of extraThemes) {
            // Never overwrite an existing theme — collections with swapped
            // mode orders can produce an extra mode named like the default,
            // and camelCase normalization can collide two extras. The extra
            // gets a numeric suffix instead, so no combination disappears.
            const base = themeKey(mode);
            let modeKey = base;
            let i = 2;
            while (Object.prototype.hasOwnProperty.call(themes, modeKey)) {
                modeKey = `${base}${i++}`;
            }
            if (modeKey !== base) {
                console.warn(`[Variform] Theme mode "${mode}" collides with another theme after normalization; exported as "${modeKey}".`);
            }
            const suffix = modeKey.charAt(0).toUpperCase() + modeKey.slice(1);
            const theme: Record<string, string> = {};
            const entryKeys = themeEntryKeys(modeTokens);
            modeTokens.forEach((token, index) => {
                const group = tokenGroup(token);
                const key = tamaguiKey(token.path);
                const value = tokenValue(token.resolvedType, token.value);
                const baseToken = defaultValues.get(`${token.category}/${token.path.join("/")}`);
                // Same value as the default mode: reference the base token.
                // Different (or new) value: add a mode-suffixed variant token.
                const refKey = baseToken && baseToken.value === value ? key : key + suffix;
                if (refKey !== key || !baseToken) {
                    groups[group] = groups[group] || {};
                    if (Object.prototype.hasOwnProperty.call(groups[group], refKey) && groups[group][refKey] !== value) {
                        console.warn(`[Variform] Token "${group}/${refKey}" already exists with a different value — overwriting it for theme "${modeKey}".`);
                    }
                    groups[group][refKey] = value;
                }
                const entryKey = entryKeys[index];
                if (Object.prototype.hasOwnProperty.call(theme, entryKey)) {
                    console.warn(`[Variform] Duplicate theme key "${entryKey}" in theme "${modeKey}" — keeping the first entry.`);
                    return;
                }
                theme[entryKey] = member(member("tokens", group), refKey);
            });
            themes[modeKey] = theme;
        }

        const header = [
            "/**",
            " * Tamagui tokens + themes generated by Variform.",
            " * Follows https://tamagui.dev/docs/intro/themes: tokens are static",
            " * values from the first selected mode of each collection (aliases",
            " * resolved), and themes reference them (tokens.color.x) instead of",
            " * repeating raw values. Values that change per mode are emitted as",
            " * mode-suffixed tokens (e.g. blue500Dark) — the docs' gray2Dark /",
            " * darkRed pattern.",
            ...(usedModes.length > 0 ? [` * Modes: ${usedModes.join("; ")}`] : []),
            ...(prefix ? [` * Prefix: "${toCssVar(prefix)}"`] : []),
            ` * Themes: ${Object.keys(themes).join(", ")} — ready for`,
            " * createTamagui({ tokens, themes }); switch with",
            ' * <Theme name="dark" /> or TamaguiProvider defaultTheme.',
            " */",
        ].join("\n");

        const modules = [
            `import { createTokens } from "tamagui";\n\nexport const tokens = createTokens(${serializeGroups(groups)});`,
            `export const themes = ${serializeThemes(themes)} as const;`,
        ];

        return `${header}\n${modules.join("\n\n")}\n`;
    } catch (err) {
        console.error(err);
        return `/* Something went wrong while converting to Tamagui tokens:
            ${err}*/`;
    }
};
