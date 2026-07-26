import { collectThemedTokens } from "./collectionToTailwindPreset";
import type { FlatToken } from "./collectionToTailwindPreset";
import { toCamelCase, toAsciiIdentifier } from "./stringTransformation";
import type { ExportSelection } from "../types.d";

/** PascalCases a mode name for use in a type name ("Dark Mode" → "DarkMode"). */
function toPascalCase(name: string): string {
    const camel = toCamelCase(name.trim());
    return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Builds the Swift constant name for a token: camelCase of the category plus
 * the path segments (["colors"]+["blue","500"] → colorsBlue500). ASCII-only so
 * accented or punctuation-heavy Figma names ("Cores/Ação", "4 (compact)")
 * still yield a valid identifier.
 */
function tokenName(token: FlatToken): string {
    return toAsciiIdentifier([token.category, ...token.path].join("-"));
}

/**
 * Derives a unique constant name per token: collisions (e.g. "Colors/Blue 500"
 * and "Colors/Blue-500" both camelCase to colorsBlue500) get a numeric suffix
 * so the generated enum never declares the same identifier twice.
 */
function uniqueTokenNames(tokens: FlatToken[]): string[] {
    const used = new Set<string>();
    return tokens.map((token) => {
        const base = tokenName(token);
        let unique = base;
        let suffix = 2;
        while (used.has(unique)) unique = `${base}${suffix++}`;
        if (unique !== base) {
            console.warn(`Swift export: duplicate token name "${base}" (${token.terminalName}) emitted as "${unique}"`);
        }
        used.add(unique);
        return unique;
    });
}

/**
 * Formats a number as a Swift floating-point literal, always with a decimal
 * (16.0, 0.5). Very large/small magnitudes stringify in exponential notation
 * ("1e+21"), which is already a valid Swift literal and must not get a ".0".
 */
function swiftDouble(n: number): string {
    const s = `${n}`;
    return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** Escapes a JS string for embedding in a single-line Swift string literal. */
function swiftString(value: unknown): string {
    const escaped = String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
    return `"${escaped}"`;
}

/** Formats a concrete token value as the right-hand side of a Swift constant. */
function swiftValue(token: FlatToken): { annotation: string; value: string } {
    switch (token.resolvedType) {
        case "COLOR": {
            const { r, g, b, a = 1 } = token.value as RGBA;
            return {
                annotation: "",
                value: `UIColor(red: ${r.toFixed(3)}, green: ${g.toFixed(3)}, blue: ${b.toFixed(3)}, alpha: ${a.toFixed(3)})`,
            };
        }
        case "FLOAT":
            return { annotation: ": CGFloat", value: swiftDouble(Number(token.value)) };
        case "BOOLEAN":
            return { annotation: "", value: Boolean(token.value) ? "true" : "false" };
        default:
            return { annotation: "", value: swiftString(token.value) };
    }
}

/**
 * Exports all local variable collections as iOS Swift enums (Style Dictionary
 * `ios-swift/enum.swift` style). The default `Tokens` enum holds the first
 * selected mode of each collection; every additional selected mode name
 * (e.g. "Dark") becomes an extra `Tokens<Mode>` enum after it. Aliases are
 * resolved to concrete values.
 *
 * Apple's documented Dark Mode mechanism is adaptive colors: `UIColor(named:)`
 * color assets with Any/Dark appearance variants, or `UIColor(dynamicProvider:)`
 * for colors created in code. A static generated file can ship neither, and
 * Figma modes are arbitrary (not limited to light/dark), so each mode is
 * emitted as a separate enum and the gap is documented in the output header.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @returns Swift source string with a `Tokens` enum per theme
 */
export const exportToSwift = async (
    selection?: ExportSelection,
    prefix: string = ""
): Promise<string> => {
    try {
        const { defaultTokens, usedModes, extraThemes } = await collectThemedTokens(selection, prefix);

        const renderEnum = (name: string, tokens: FlatToken[]): string => {
            const names = uniqueTokenNames(tokens);
            const lines = tokens.map((token, index) => {
                const { annotation, value } = swiftValue(token);
                return `    public static let ${names[index]}${annotation} = ${value}`;
            });
            return [`public enum ${name} {`, ...lines, "}"].join("\n");
        };

        // Mode names like "Dark Mode"/"Dark-Mode" (or a blank mode, which
        // yields a bare "Tokens") produce the same enum name; suffix the
        // duplicates so every mode keeps its own compilable enum.
        const usedEnumNames = new Set(["Tokens"]);
        const enums = [renderEnum("Tokens", defaultTokens)];
        for (const theme of extraThemes) {
            const base = `Tokens${toPascalCase(theme.mode)}`;
            let name = base;
            let suffix = 2;
            while (usedEnumNames.has(name)) name = `${base}${suffix++}`;
            if (name !== base) {
                console.warn(`Swift export: mode "${theme.mode}" collides on enum name "${base}", emitted as "${name}"`);
            }
            usedEnumNames.add(name);
            enums.push(renderEnum(name, theme.tokens));
        }

        return [
            "// Swift tokens generated by Variform.",
            ...(usedModes.length > 0 ? [`// Modes: ${usedModes.join("; ")}`] : []),
            "// Static export: values come from the first selected mode of each collection",
            "// and aliases are resolved to concrete values.",
            "//",
            "// Dark Mode: Apple prescribes adaptive colors — color assets with",
            "// Any/Dark appearance variants loaded via UIColor(named:), or",
            "// UIColor(dynamicProvider:) for colors created in code.",
            "// https://developer.apple.com/documentation/uikit/supporting-dark-mode-in-your-interface",
            "//",
            "// A static file can ship neither an asset catalog nor colors that",
            "// adapt by themselves, and Figma modes are arbitrary (not limited to",
            "// light/dark), so each selected mode is emitted as its own enum.",
            "// Colors below are fixed component values and will NOT adapt to the",
            "// current interface style. To adopt the documented mechanism, move",
            "// them into color sets in an asset catalog, or wrap a light/dark",
            "// pair in a dynamic provider, e.g.:",
            "//   let surface = UIColor { traits in",
            "//       traits.userInterfaceStyle == .dark ? darkValue : lightValue",
            "//   }",
            "import UIKit",
            "",
            enums.join("\n\n"),
            "",
        ].join("\n");
    } catch (err) {
        console.error(err);
        return `// Something went wrong while converting to Swift:
            ${err}`;
    }
};
