import { collectThemedTokens } from "./collectionToTailwindPreset";
import type { FlatToken } from "./collectionToTailwindPreset";
import { rgbaToArgbHex } from "./color";
import { toCamelCase, toAsciiIdentifier } from "./stringTransformation";
import type { ExportSelection } from "../types.d";

/** Maps a token's resolved type to its Dart field type. */
function dartType(token: FlatToken): string {
    switch (token.resolvedType) {
        case "COLOR": return "Color";
        case "FLOAT": return "double";
        case "BOOLEAN": return "bool";
        default: return "String";
    }
}

/**
 * Builds the Dart field name for a token: camelCase of the category plus
 * the path segments (["colors"]+["blue","500"] → colorsBlue500). ASCII-only
 * because Dart identifiers are ASCII-only: accented or punctuation-heavy
 * Figma names ("Cores/Ação", "4 (compact)") would not compile otherwise.
 */
function tokenName(token: FlatToken): string {
    return toAsciiIdentifier([token.category, ...token.path].join("-"));
}

/**
 * Derives a unique field name per token: collisions (e.g. "Colors/Blue 500"
 * and "Colors/Blue-500" both camelCase to colorsBlue500) get a numeric suffix
 * so the generated class never declares the same field twice.
 */
function uniqueTokenNames(tokens: FlatToken[]): string[] {
    const used = new Set<string>();
    return tokens.map((token) => {
        const base = tokenName(token);
        let unique = base;
        let suffix = 2;
        while (used.has(unique)) unique = `${base}${suffix++}`;
        if (unique !== base) {
            console.warn(`Flutter export: duplicate token name "${base}" (${token.terminalName}) emitted as "${unique}"`);
        }
        used.add(unique);
        return unique;
    });
}

/**
 * Formats a number as a Dart double literal, always with a decimal (16.0,
 * 0.5). Very large/small magnitudes stringify in exponential notation
 * ("1e+21"), which is already a valid Dart literal and must not get a ".0".
 */
function dartDouble(n: number): string {
    const s = `${n}`;
    return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** Formats a concrete token value as a Dart expression. */
function dartValue(token: FlatToken): string {
    switch (token.resolvedType) {
        case "COLOR":
            return `Color(0x${rgbaToArgbHex(token.value as RGBA).slice(1)})`;
        case "FLOAT":
            return dartDouble(Number(token.value));
        case "BOOLEAN":
            return Boolean(token.value) ? "true" : "false";
        default:
            // Dart single-quoted strings still interpolate `$`, an unescaped
            // backslash can form invalid escape sequences, and a literal line
            // break terminates the string literal.
            return `'${String(token.value)
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/\$/g, "\\$")
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")}'`;
    }
}

/**
 * Dart expression that interpolates a field between two theme instances, as
 * required by ThemeExtension.lerp. Colors and doubles interpolate; booleans
 * and strings cannot, so they snap to the nearest theme like the Flutter
 * framework's own non-lerpable theme properties.
 */
function lerpExpression(token: FlatToken, name: string): string {
    switch (token.resolvedType) {
        case "COLOR": return `Color.lerp(${name}, other.${name}, t)!`;
        case "FLOAT": return `lerpDouble(${name}, other.${name}, t)!`;
        default: return `t < 0.5 ? ${name} : other.${name}`;
    }
}

/**
 * Derives unique camelCase instance names for the mode themes ("Light" →
 * light, "Dark Mode" → darkMode). Later names that collide get a numeric
 * suffix so every static instance stays addressable.
 */
function instanceNames(modes: (string | undefined)[]): string[] {
    const used = new Set<string>();
    return modes.map((raw) => {
        const base = toCamelCase((raw ?? "").trim()) || "theme";
        let name = base;
        let suffix = 2;
        while (used.has(name)) name = `${base}${suffix++}`;
        used.add(name);
        return name;
    });
}

/**
 * Exports all local variable collections as a Flutter Dart file following the
 * official theming docs: custom tokens live in a `ThemeExtension<Tokens>`
 * subclass (https://api.flutter.dev/flutter/material/ThemeExtension-class.html)
 * with one static const instance per selected mode, wired light/dark through
 * `ThemeData(extensions: ...)` as shown in
 * https://docs.flutter.dev/cookbook/design/themes. The first selected mode of
 * each collection becomes the default instance; every additional selected mode
 * (e.g. "Dark") becomes another instance. Aliases are resolved to concrete
 * values.
 * @param selection - Optional export selection (omit to export everything)
 * @param prefix - Optional prefix prepended to each token family segment
 * @returns Dart source string with a ThemeExtension class and one instance per theme
 */
export const exportToFlutter = async (
    selection?: ExportSelection,
    prefix: string = ""
): Promise<string> => {
    try {
        const { defaultTokens, usedModes, extraThemes } = await collectThemedTokens(selection, prefix);

        const themes = [
            { mode: usedModes[0]?.split("→").pop()?.trim(), tokens: defaultTokens },
            ...extraThemes.map((theme) => ({ mode: theme.mode, tokens: theme.tokens })),
        ];
        const names = instanceNames(themes.map((theme) => theme.mode));
        const hasDoubles = defaultTokens.some((token) => token.resolvedType === "FLOAT");

        const fieldNames = uniqueTokenNames(defaultTokens);
        const lines: string[] = [`class Tokens extends ThemeExtension<Tokens> {`];
        if (defaultTokens.length > 0) {
            lines.push(`    const Tokens({`);
            lines.push(...fieldNames.map((name) => `        required this.${name},`));
            lines.push(`    });`, ``);
            lines.push(...defaultTokens.map((token, index) => `    final ${dartType(token)} ${fieldNames[index]};`));
        } else {
            lines.push(`    const Tokens();`);
        }

        themes.forEach((theme, index) => {
            // Same variables as the default theme in the same order, so this
            // yields the field names declared above, suffixes included.
            const themeFields = uniqueTokenNames(theme.tokens);
            lines.push(``, `    static const Tokens ${names[index]} = Tokens(`);
            lines.push(...theme.tokens.map((token, tokenIndex) => `        ${themeFields[tokenIndex]}: ${dartValue(token)},`));
            lines.push(`    );`);
        });

        lines.push(``, `    @override`);
        if (defaultTokens.length > 0) {
            lines.push(`    Tokens copyWith({`);
            lines.push(...defaultTokens.map((token, index) => `        ${dartType(token)}? ${fieldNames[index]},`));
            lines.push(`    }) {`, `        return Tokens(`);
            lines.push(...fieldNames.map((name) => `            ${name}: ${name} ?? this.${name},`));
            lines.push(`        );`, `    }`);
        } else {
            lines.push(`    Tokens copyWith() => this;`);
        }

        lines.push(``, `    @override`, `    Tokens lerp(ThemeExtension<Tokens>? other, double t) {`);
        lines.push(`        if (other is! Tokens) return this;`);
        if (defaultTokens.length > 0) {
            lines.push(`        return Tokens(`);
            lines.push(...defaultTokens.map((token, index) => `            ${fieldNames[index]}: ${lerpExpression(token, fieldNames[index])},`));
            lines.push(`        );`);
        } else {
            lines.push(`        return this;`);
        }
        lines.push(`    }`, `}`);

        const [firstName, ...restNames] = names;
        const usage = [
            `//   MaterialApp(`,
            `//     theme: ThemeData(brightness: Brightness.light, extensions: [Tokens.${firstName}]),`,
            ...restNames.map((name) => `//     darkTheme: ThemeData(brightness: Brightness.dark, extensions: [Tokens.${name}]),`),
            `//   );`,
        ];

        return [
            "// Flutter tokens generated by Variform.",
            ...(usedModes.length > 0 ? [`// Modes: ${usedModes.join("; ")}`] : []),
            "// Custom tokens follow Flutter's documented theming mechanism: a",
            "// ThemeExtension subclass attached to ThemeData",
            "// (https://api.flutter.dev/flutter/material/ThemeExtension-class.html),",
            "// with one static const instance per selected mode (aliases resolved).",
            "// Wire the modes per https://docs.flutter.dev/cookbook/design/themes:",
            ...usage,
            `// Access a token: Theme.of(context).extension<Tokens>()!.${defaultTokens.length > 0 ? fieldNames[0] : "<token>"}`,
            `import 'package:flutter/material.dart';`,
            ...(hasDoubles ? [`import 'dart:ui' show lerpDouble;`] : []),
            "",
            lines.join("\n"),
            "",
        ].join("\n");
    } catch (err) {
        console.error(err);
        return `// Something went wrong while converting to Flutter:
            ${err}`;
    }
};
