import { rgbToCssColor } from "./color";
import { getMatchingModeName } from "./variableUtils";
import { getLocalStyles, stylesToCsvRows, filterStyles, csvCell } from "./styleSerializers";
import { isCollectionSelected, isModeSelected, selectedModes } from "./selectionUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import { applyDescriptionParser, descriptionToString } from "./descriptionParsers";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * Header of the variables CSV. The `=<column><row>` cell references derive
 * their column letter from this header, so keep the two in sync.
 */
const CSV_HEADER = ["Collection", "Mode", "Variable", "Type", "Value", "Scopes", "Description"];

/** Index of the Value column within {@link CSV_HEADER}. */
const VALUE_COLUMN_INDEX = CSV_HEADER.indexOf("Value");

/** Spreadsheet column letter of the Value column (e.g. "E"). */
const VALUE_COLUMN_LETTER = String.fromCharCode("A".charCodeAt(0) + VALUE_COLUMN_INDEX);

/**
 * One CSV record kept as raw (unescaped) cells until final serialization, so
 * escaping and the linked-variable rewrite never need to parse a joined line
 * (which would break on multi-line cells or names containing `=` or commas).
 */
type CSVRecord = {
    cells: string[];
    /** Variable id, present on variable rows only */
    variableId?: string;
    /** Name of the mode this row belongs to */
    modeName?: string;
    /**
     * Alias target awaiting a `=<column><row>` rewrite: the target variable id,
     * its resolved mode name and the readable textual reference to fall back to
     * when the target row is not part of the export.
     */
    alias?: { id: string; modeName: string; fallback: string };
}

/**
 * Escapes a CSV cell via csvCell, quoting only when the content requires it
 * (comma, quote or line break) so plain values stay unquoted and readable.
 */
const escapeCSVCell = (value: string | number): string =>
  /[",\n\r]/.test(String(value)) ? csvCell(value) : String(value);

/** Collision-free map key for a (variable id, mode name) pair. */
const positionKey = (variableId: string, modeName: string): string =>
  JSON.stringify([variableId, modeName]);

/**
 * Processes a variable collection into CSV records (one per variable/mode value)
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @param parserId - Optional description parser id
 * @param useRowColRefs - Whether linked variables should get `=<column><row>` cell references
 * @returns Array of CSV records
 */
const processCollectionToCSV = async (
    collection: VariableCollection,
    selection: ExportSelection | undefined,
    parserId: string | undefined,
    useRowColRefs: boolean
): Promise<CSVRecord[]> => {
  const { name, variableIds } = collection;
  const records: CSVRecord[] = [];
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);

  for (const mode of selectedModes(collection.id, collection.modes, selection)) {

    for (const variableId of variableIds) {
      const figVar = await figma.variables.getVariableByIdAsync(variableId);

      if (figVar !== null) {
        const { id, name:varName, resolvedType, valuesByMode, scopes, description }: Variable = figVar;
        const varValue: VariableValue = valuesByMode[mode.modeId];
        const parsedDescription = descriptionToString(applyDescriptionParser(description, parserId));

        if (varValue !== undefined && validTypes.has(resolvedType)) {
          let value: string | number | boolean;
          let alias: CSVRecord["alias"];
          if (typeof varValue === "object" && "id" in varValue) {
            //Linked variable
            const linkedVar = await figma.variables.getVariableByIdAsync(varValue.id);
            const linkedVarCollection = linkedVar
              ? await figma.variables.getVariableCollectionByIdAsync(linkedVar.variableCollectionId)
              : null;

            if (linkedVar === null || linkedVarCollection === null) {
              // The target variable (or its collection) no longer exists.
              value = "_unlinked";
            }
            else {
              const matchedModeName = getMatchingModeName(mode.name, linkedVarCollection, selection);
              const matchedMode = linkedVarCollection.modes.find(m => m.name === matchedModeName)
                ?? linkedVarCollection.modes[0];
              const fallback = `=${linkedVarCollection.name}/${matchedModeName}/${linkedVar.name}`;

              // In row/column mode the value becomes a `=<column><row>` cell
              // reference (rewritten later) when the linked target's mode is
              // part of the export; otherwise the readable textual reference
              // is used, because the referenced cell would not exist.
              const targetSelected = isModeSelected(linkedVarCollection.id, matchedMode.modeId, selection);
              if (useRowColRefs && targetSelected) {
                value = fallback;
                alias = { id: linkedVar.id, modeName: matchedModeName, fallback };
              }
              else {
                value = fallback;
              }
            }
          }
          else {
            value = resolvedType === "COLOR"
              ? rgbToCssColor(varValue as RGBA)
              : resolvedType === "FLOAT"
                ? parseFloat(varValue as string)
                  : resolvedType === "BOOLEAN"
                    ? Boolean(varValue)
                    : String(varValue);
          }
          records.push({
            cells: [name, mode.name, varName, resolvedType, String(value), scopes.toString(), parsedDescription],
            variableId: id,
            modeName: mode.name,
            alias,
          });
        }
      }
    }
  }

  return records;
}

/**
 * Exports all local variable collections to CSV format
 * @param useLinkedVarRowAndColPos - Whether to use row/column positioning for linked variables
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to append (default all)
 * @param parserId - Optional description parser id
 * @returns CSV string with all variables
 */
export const exportToCSV = async (
  useLinkedVarRowAndColPos: boolean = false,
  selection?: ExportSelection,
  styleSelection: StyleSelection = ALL_STYLES,
  parserId?: string
): Promise<string | undefined> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  try {
    const records: CSVRecord[] = [];
    for (const collection of collections) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      records.push(...(await processCollectionToCSV(collection, selection, parserId, useLinkedVarRowAndColPos)));
    }

    if (useLinkedVarRowAndColPos) {
      // Map each (variable, mode) pair to its spreadsheet row, built from the
      // rows actually emitted (a variable may lack a value in some modes).
      // +2: the header occupies row 1 and spreadsheet rows are one-based.
      const rowByVariableAndMode = new Map<string, number>();
      records.forEach((record, index) => {
        if (record.variableId !== undefined && record.modeName !== undefined) {
          rowByVariableAndMode.set(positionKey(record.variableId, record.modeName), index + 2);
        }
      });
      // Rewrite alias values to `=<column><row>` references pointing at the row
      // of the RESOLVED mode; when that row was never emitted (target has no
      // value in it), keep the readable textual fallback instead of a dangling
      // reference.
      for (const record of records) {
        if (record.alias) {
          const targetRow = rowByVariableAndMode.get(positionKey(record.alias.id, record.alias.modeName));
          record.cells[VALUE_COLUMN_INDEX] = targetRow !== undefined
            ? `=${VALUE_COLUMN_LETTER}${targetRow}`
            : record.alias.fallback;
        }
      }
    }

    const csvData = [CSV_HEADER.join(",")];
    csvData.push(...records.map((record) => record.cells.map(escapeCSVCell).join(",")));

    // Merge the selected local style kinds as additional rows (after the
    // linked-var post-processing, so their values are never rewritten).
    if (anyStyleSelected(styleSelection)) {
      const styles = filterStyles(await getLocalStyles(), styleSelection);
      csvData.push(...stylesToCsvRows(styles));
    }

    return csvData.join("\n");
  }
  catch (err) {
    console.error(err);
  }
};
