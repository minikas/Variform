import { OutputFormats, TailwindOutput } from "../types.d";

/**
 * File extension used when downloading or pushing an export. Most formats use
 * their own enum value; the exceptions are the multi-output Tailwind format
 * (css/js per output) and formats whose extension differs from the enum key.
 * @param format - The selected output format
 * @param tailwindOutput - Which Tailwind output is active (css or preset)
 * @returns The file extension without a leading dot
 */
export function formatExtension(format: OutputFormats, tailwindOutput?: TailwindOutput): string {
    switch (format) {
        case OutputFormats.TAILWIND:
            return tailwindOutput === "preset" ? "js" : "css";
        case OutputFormats.REACT_NATIVE:
        case OutputFormats.TAMAGUI:
            return "ts";
        case OutputFormats.STYLE_DICTIONARY:
            return "json";
        case OutputFormats.ANDROID:
            return "xml";
        case OutputFormats.FLUTTER:
            return "dart";
        default:
            return format;
    }
}
