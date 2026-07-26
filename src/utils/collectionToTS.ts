import { buildJsModuleExports } from "./collectionToJS";
import { ALL_STYLES } from "./styleSelection";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * Exports all local variable collections to TypeScript format. Shares the
 * JavaScript exporter's shape (one `export const` per collection, nested by
 * mode and `/`-delimited groups, aliases as direct references) and appends
 * `as const` so consumers get literal types and autocomplete for free.
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to append (default all)
 * @param parserId - Optional description parser id
 * @returns TypeScript string with exported variable objects
 */
export const exportToTS = async (
  selection?: ExportSelection,
  styleSelection: StyleSelection = ALL_STYLES,
  parserId?: string
): Promise<string | undefined> => buildJsModuleExports(selection, styleSelection, parserId, true);
