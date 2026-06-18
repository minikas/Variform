import { rgbToCssColor } from "./color";
import { getMatchingModeName } from "./variableUtils";
import { getLocalStyles, stylesToCsvRows, filterStyles } from "./styleSerializers";
import { isCollectionSelected, isModeSelected, selectedModes } from "./selectionUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import { applyDescriptionParser, descriptionToString } from "./descriptionParsers";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * Represents the position and metadata of a variable in CSV format
 */
type VariablePosition = {
    row: number;
    column: string;
    collection: string;
    mode: string;
    var: VariableValue;
    description: string;
}

/**
 * Processes a variable collection into CSV rows
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @param parserId - Optional description parser id
 * @param lastCollectionRowIndex - Optional row index for positioning
 * @param collectionsVariablesMap - Optional map for tracking variable positions
 * @returns Array of CSV row strings
 */
const processCollectionToCSV = async (
    collection: VariableCollection,
    selection?: ExportSelection,
    parserId?: string,
    lastCollectionRowIndex?: number,
    collectionsVariablesMap?: Map<string, VariablePosition>
): Promise<string[]> => {
  const { name, variableIds } = collection;
  const csvRows: string[] = [];
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);
  let rowIndex = lastCollectionRowIndex;

  for (const mode of selectedModes(collection.id, collection.modes, selection)) {

    for (const variableId of variableIds) {
      const figVar = await figma.variables.getVariableByIdAsync(variableId);

      if (figVar !== null) {
        const { id, name:varName, resolvedType, valuesByMode, scopes, description }: Variable = figVar;
        const varValue: VariableValue = valuesByMode[mode.modeId];
        const parsedDescription = descriptionToString(applyDescriptionParser(description, parserId));
        const varDescription = `"${parsedDescription.replace(/"/g, '""')}"`;
        const isColor: boolean = resolvedType === "COLOR";
        const isNumber: boolean = resolvedType === "FLOAT";
        const isBool: boolean = resolvedType === "BOOLEAN";

        if (varValue !== undefined && validTypes.has(resolvedType)) {
          let value: string | boolean | number | RGB;
          if(collectionsVariablesMap && rowIndex && !collectionsVariablesMap.get(id)) {
            rowIndex++;
            collectionsVariablesMap.set(id, {
                collection: name,
                column: 'E',
                mode: mode.name,
                row: rowIndex,
                var: varValue,
                description: varDescription
              })
          }
          if (typeof varValue === "object" && "id" in varValue) {
            //Linked variable
            const linkedVar = await figma.variables.getVariableByIdAsync(varValue.id);
            const linkedVarCollection = linkedVar
              ? await figma.variables.getVariableCollectionByIdAsync(linkedVar.variableCollectionId)
              : {name:''};

            const matchedModeName = linkedVarCollection && 'modes' in linkedVarCollection
              ? getMatchingModeName(mode.name, linkedVarCollection)
              : mode.name;

            // In row/column mode we normally emit `=<id>` and rewrite it to a
            // cell reference (e.g. `=E7`) later. But if the linked target's
            // mode is not part of the export, that cell never exists — fall
            // back to the readable textual reference instead of a dangling id.
            const matchedMode = linkedVarCollection && 'modes' in linkedVarCollection
              ? (linkedVarCollection.modes.find(m => m.name === matchedModeName) ?? linkedVarCollection.modes[0])
              : undefined;
            const targetSelected = !!(linkedVar && linkedVarCollection && 'id' in linkedVarCollection && matchedMode
              && isModeSelected(linkedVarCollection.id, matchedMode.modeId, selection));

            const useCellRef = !!collectionsVariablesMap && !!rowIndex && targetSelected;
            value = linkedVar ?
            useCellRef
            ? `=${linkedVar.id}`
            : `=${linkedVarCollection ? linkedVarCollection.name : ''}/${matchedModeName}/${linkedVar.name}` : "_unlinked";
          }
          else {
            value = isColor
              ? rgbToCssColor(varValue as RGBA)
              : isNumber
                ? parseFloat(varValue as string)
                  : isBool
                    ? Boolean(varValue)
                    : String(varValue);

            if (isColor && String(value).startsWith('rgb')) {
              value = `"${value}"`
            };
          }
          const scopesStr = `"${scopes.toString()}"`
          csvRows.push(`${name},${mode.name},${varName},${resolvedType},${value},${scopesStr},${varDescription}`);
        }
      }
    }
  }

  return csvRows;
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
  const csvData = ["Collection,Mode,Variable,Type,Value,Scopes,Description"];
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collectionsVariablesMap = new Map<string, VariablePosition>();

  try {
    for (const collection of collections) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      if(useLinkedVarRowAndColPos) {
        csvData.push(...(await processCollectionToCSV(collection, selection, parserId, csvData.length, collectionsVariablesMap)));
      }
      else {
        csvData.push(...(await processCollectionToCSV(collection, selection, parserId)));
      }
    }
    if(useLinkedVarRowAndColPos) {
      // Replace the linked vars (starting with `=`) with the map and its row/column references
      const linkedVarRegEx = /=([^,]*)/;
      for (let i = 0, leng = csvData.length; i < leng; i++) {
        const row: string = csvData[i];
        const linkedVarMatch = linkedVarRegEx.exec(row);
        const linkedVarKey = linkedVarMatch && linkedVarMatch[1] ? linkedVarMatch[1] : undefined;
        if (linkedVarKey) {
          const linkedVar = collectionsVariablesMap.get(linkedVarKey);

          if (linkedVar) {
            csvData[i] = row.replace(linkedVarRegEx, `=${linkedVar.column}${linkedVar.row}`)
          }
        }
      }
    }

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
