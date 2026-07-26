/**
 * Serializes a plain value as a JavaScript object literal.
 *
 * Replaces the old `JSON.stringify(x).replace(/"([A-Za-z_$]...)":/g, "$1:")`
 * idiom, whose regex also rewrote key-like patterns inside string VALUES
 * (e.g. a token containing `Note: test` was corrupted to `Note: test` with an
 * unquoted key). Here keys are decided structurally: an object key is emitted
 * bare only when it is a valid JS identifier AND not a reserved word;
 * everything else (and every string value) goes through JSON.stringify.
 */

/**
 * Reserved words that must stay quoted when used as object literal keys.
 * Exported so identifier producers (e.g. exported const names) can reject
 * them too — `export const default` is a SyntaxError.
 */
export const RESERVED_WORDS = new Set([
    "default", "class", "new", "function", "let", "const", "var", "import",
    "export", "return", "if", "else", "for", "while", "do", "switch", "case",
    "break", "continue", "typeof", "instanceof", "in", "of", "delete", "void",
    "this", "null", "true", "false", "undefined", "yield", "async", "await",
    "static", "get", "set",
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Formats an object key: bare identifier when safe, JSON-quoted otherwise. */
function formatKey(key: string): string {
    return IDENTIFIER.test(key) && !RESERVED_WORDS.has(key)
        ? key
        : JSON.stringify(key);
}

function serialize(value: unknown, level: number, indent: number): string {
    if (value === null) return "null";

    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const pad = " ".repeat(indent * (level + 1));
        const items = value.map((item) => {
            const serialized = typeof item === "undefined" ? "null" : serialize(item, level + 1, indent);
            return pad + serialized;
        });
        return `[\n${items.join(",\n")}\n${" ".repeat(indent * level)}]`;
    }

    switch (typeof value) {
        case "string":
            return JSON.stringify(value);
        case "number":
            return Number.isFinite(value) ? String(value) : "null";
        case "boolean":
            return String(value);
        case "object": {
            const entries = Object.entries(value as Record<string, unknown>)
                .filter(([, entryValue]) => typeof entryValue !== "undefined");
            if (entries.length === 0) return "{}";
            const pad = " ".repeat(indent * (level + 1));
            const lines = entries.map(
                ([key, entryValue]) =>
                    `${pad}${formatKey(key)}: ${serialize(entryValue, level + 1, indent)}`
            );
            return `{\n${lines.join(",\n")}\n${" ".repeat(indent * level)}}`;
        }
        default:
            // Functions/symbols/etc. are not representable; mirror JSON's null.
            return "null";
    }
}

/**
 * Serializes a value as a JavaScript object/array literal with JSON-like
 * indentation, leaving identifier-safe, non-reserved object keys unquoted.
 * @param value - The value to serialize (objects, arrays, strings, numbers, booleans, null)
 * @param indent - Number of spaces per indentation level (default 2)
 * @returns A string that evaluates back to an equal value
 */
export function toJsObjectLiteral(value: unknown, indent: number = 2): string {
    return serialize(value, 0, indent);
}
