/**
 * Converts a string to a CSS variable name
 * @param {string} string - The string to convert
 * @param {boolean} prependDoubleDash - Whether to prepend a double dash
 * @returns {string} The CSS variable name
 */
export const toCssVar = (string: string, prependDoubleDash: boolean = false) => {
    string = (prependDoubleDash ? `--${string}` : string)
                .replace(/\//g, "--")
                .replace(/\s/g, '-')
                .replace(/\./g, '_')
                .toLowerCase();
    return string;
}

/**
 * Converts a string to camel case
 * @param {string} string - The string to convert
 * @param {boolean} detectAllCaps - Whether to detect all caps
 * @returns {string} The camel case string
 */
export const toCamelCase = (string: string, detectAllCaps = true) => {

    if (detectAllCaps && /^[A-Z][A-Z0-9_\s]*$/.test(string)) {
        return string.replace(/\s+/g, '');
    }

    // Unicode-aware "word char": \w and \b only cover ASCII, which would
    // uppercase letters after accented characters ("Ação" → "açãO"). \p{L}
    // with the /u flag treats accented letters as word characters instead.
    const letter = "[\\p{L}\\p{N}_]";
    return string
        .trim()
        .replace(
            new RegExp(`(?:^${letter}|[A-Z]|(?<!${letter})${letter}|\\s+${letter}|\\s*\\d+)`, "gu"),
            (match, index) => {
                if (index === 0) return match.toLowerCase();
                if (new RegExp(`^\\s+${letter}`, "u").test(match)) return match.trim().toUpperCase();
                if (/\s*\d+/.test(match)) return match.trim();
                return match.toUpperCase();
            })
        .replace(/-/g, '')
        .replace(/\./g, '_');
}

/**
 * Converts a string to an ASCII-only camelCase identifier, for languages whose
 * identifiers must stay ASCII (Dart; used for Swift too so both exports name
 * tokens identically). Diacritics are stripped via NFD decomposition, every
 * run of non-alphanumeric characters acts as a word separator, and the words
 * are camelCased. Existing inner capitalization is kept, so already-camelCase
 * segments survive ("fontFamily-sans" → "fontFamilySans"). Returns "token"
 * when nothing usable remains, so the identifier is never empty.
 * @param {string} string - The string to convert
 * @returns {string} The ASCII camelCase identifier
 */
export const toAsciiIdentifier = (string: string): string => {
    const words = string
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);
    if (words.length === 0) return "token";
    return words
        .map((word, index) =>
            index === 0
                ? word.charAt(0).toLowerCase() + word.slice(1)
                : word.charAt(0).toUpperCase() + word.slice(1)
        )
        .join("");
}