/**
 * Description parsers transform a Figma variable's `description` string into the
 * value emitted by the exporters. They let users author structured data in the
 * description field (e.g. JSON) and have it exported as such.
 *
 * Adding a parser is intentionally trivial: append an entry to
 * {@link descriptionParsers} with a unique `id`, a display `name` and a `parse`
 * function. Everything else (the UI select, the message plumbing and the
 * exporters) picks it up automatically.
 */
export interface DescriptionParser {
  /** Stable identifier sent across the UI ↔ plugin boundary. */
  id: string;
  /** Label shown in the parser select. */
  name: string;
  /** Transforms the raw description string into the value to emit. */
  parse: (raw: string) => unknown;
}

/** Sentinel id for "no parsing" — the description is emitted as-is (a string). */
export const NO_PARSER_ID = "none";

/** Human label for the "no parser" option. */
export const NO_PARSER_LABEL = "None (plain string)";

export const descriptionParsers: DescriptionParser[] = [
  {
    id: "description-to-json",
    name: "Description to JSON",
    parse: (raw) => {
      const trimmed = (raw ?? "").trim();
      if (!trimmed) return "";
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON — fall back to the original string so the export
        // never loses the author's content.
        return raw;
      }
    },
  },
];

/**
 * Applies the selected parser to a raw description.
 * @param raw - The variable's raw description string
 * @param parserId - The selected parser id (or {@link NO_PARSER_ID}/undefined)
 * @returns The parsed value, or the raw string when no parser applies
 */
export const applyDescriptionParser = (raw: string, parserId?: string): unknown => {
  if (!parserId || parserId === NO_PARSER_ID) return raw;
  const parser = descriptionParsers.find((p) => p.id === parserId);
  return parser ? parser.parse(raw) : raw;
};

/**
 * Coerces a parsed description to a string for line-based formats (CSV cells,
 * CSS comments): objects/arrays become compact JSON, everything else is stringified.
 * @param value - The value returned by {@link applyDescriptionParser}
 * @returns A string representation suitable for a single cell/line
 */
export const descriptionToString = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);
