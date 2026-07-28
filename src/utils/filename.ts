import { OutputFormats, TailwindOutput } from "../types.d";

/**
 * Key of one downloadable file inside the per-document `filenameByFormat`
 * map. Most formats produce a single file (the key is the format itself); the
 * Tailwind format produces two — the v4 stylesheet (`"tailwind"`) and the v3
 * preset (`"tailwind:preset"`) — each with its own filename.
 */
export function filenameKey(
  format: OutputFormats,
  tailwindOutput?: TailwindOutput,
): string {
  return format === OutputFormats.TAILWIND && tailwindOutput === "preset"
    ? "tailwind:preset"
    : format;
}

/** Default download filename (no extension) for a file key. */
export function defaultFilename(key: string): string {
  switch (key) {
    case OutputFormats.TAILWIND:
      return "globals";
    case "tailwind:preset":
      return "presets.tailwind";
    default:
      return "tokens";
  }
}
