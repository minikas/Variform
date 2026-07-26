import { collectThemedTokens } from "./collectionToTailwindPreset";
import type { FlatToken } from "./collectionToTailwindPreset";
import { rgbaToArgbHex } from "./collectionToAndroid";
import { toCamelCase } from "./stringTransformation";
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
 * the path segments (["colors"]+["blue","500"] → colorsBlue500).
 */
function tokenName(token: FlatToken): string {
    return toCamelCase([token.category, ...token.path].join("-"));
}

/** Formats a number as a Dart double literal, always with a decimal (16.0, 0.5). */
function dartDouble(n: number): string {
    return Number.isInteger(n) ? `${n}.0` : `${n}`;
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
            // Dart single-quoted strings still interpolate `$`, and an
            // unescaped backslash can form invalid escape sequences.
            return `'${String(token.value)
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/\$/g, "\\$")}'`;
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

        const field = (token: FlatToken) => tokenName(token);
        const lines: string[] = [`class Tokens extends ThemeExtension<Tokens> {`];
        if (defaultTokens.length > 0) {
            lines.push(`    const Tokens({`);
            lines.push(...defaultTokens.map((token) => `        required this.${field(token)},`));
            lines.push(`    });`, ``);
            lines.push(...defaultTokens.map((token) => `    final ${dartType(token)} ${field(token)};`));
        } else {
            lines.push(`    const Tokens();`);
        }

        themes.forEach((theme, index) => {
            lines.push(``, `    static const Tokens ${names[index]} = Tokens(`);
            lines.push(...theme.tokens.map((token) => `        ${field(token)}: ${dartValue(token)},`));
            lines.push(`    );`);
        });

        lines.push(``, `    @override`);
        if (defaultTokens.length > 0) {
            lines.push(`    Tokens copyWith({`);
            lines.push(...defaultTokens.map((token) => `        ${dartType(token)}? ${field(token)},`));
            lines.push(`    }) {`, `        return Tokens(`);
            lines.push(...defaultTokens.map((token) => `            ${field(token)}: ${field(token)} ?? this.${field(token)},`));
            lines.push(`        );`, `    }`);
        } else {
            lines.push(`    Tokens copyWith() => this;`);
        }

        lines.push(``, `    @override`, `    Tokens lerp(ThemeExtension<Tokens>? other, double t) {`);
        lines.push(`        if (other is! Tokens) return this;`);
        if (defaultTokens.length > 0) {
            lines.push(`        return Tokens(`);
            lines.push(...defaultTokens.map((token) => `            ${field(token)}: ${lerpExpression(token, field(token))},`));
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
            "// Custom tokens follow Flutter's documented theming mechanism: a",
            "// ThemeExtension subclass attached to ThemeData",
            "// (https://api.flutter.dev/flutter/material/ThemeExtension-class.html),",
            "// with one static const instance per selected mode (aliases resolved).",
            "// Wire the modes per https://docs.flutter.dev/cookbook/design/themes:",
            ...usage,
            `// Access a token: Theme.of(context).extension<Tokens>()!.${defaultTokens.length > 0 ? field(defaultTokens[0]) : "<token>"}`,
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
