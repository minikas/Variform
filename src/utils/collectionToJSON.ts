import { rgbToCssColor } from "./color";
import { getMatchingModeName } from "./variableUtils";
import { getLocalStyles, buildStyleTokenTrees, filterStyles } from "./styleSerializers";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import { applyDescriptionParser } from "./descriptionParsers";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * Processes a variable collection into JSON format
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @param parserId - Optional description parser id
 * @returns Array of JSON objects representing the collection
 */
async function processCollection(
  collection: VariableCollection,
  selection?: ExportSelection,
  parserId?: string
): Promise<[]> {
  const { name, variableIds } = collection;
  const entries: [] = [];
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);

  for(const mode of selectedModes(collection.id, collection.modes, selection)) {
    const file = { collection: name, mode: mode.name, variables: {} };

    for (const variableId of variableIds) {
      const figVar = await figma.variables.getVariableByIdAsync(variableId);
      if (figVar !== null) {
        const { name, resolvedType, valuesByMode, scopes, description }: Variable = figVar;
        const value: VariableValue = valuesByMode[mode.modeId];

        if (value !== undefined && validTypes.has(resolvedType)) {
          let obj: any = file.variables;

          name.split("/").forEach((groupName) => {
            obj[groupName] = obj[groupName] || {};
            obj = obj[groupName];
          });
          const isColor: boolean = resolvedType === "COLOR";
          const isNumber: boolean = resolvedType === "FLOAT";
          const isBool: boolean = resolvedType === "BOOLEAN";
          obj.$type = resolvedType;
          obj.$scopes = scopes;
          obj.$description = applyDescriptionParser(description || '', parserId);
          if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
            const linkedVar = await figma.variables.getVariableByIdAsync(value.id);

            if(linkedVar) {
              const linkedVarCollection = await figma.variables.getVariableCollectionByIdAsync(linkedVar.variableCollectionId);
              let collName = '$.';

              if(linkedVarCollection && name !== linkedVarCollection.name) {
                collName = `$.${linkedVarCollection.name}`
              }
              const matchedModeName = linkedVarCollection
                ? getMatchingModeName(mode.name, linkedVarCollection)
                : mode.name;
              obj.$value = `${collName}.${matchedModeName}.${linkedVar.name.replace(/\//g, ".")}`;
            }
            else {
              obj.$value = "_unlinked"
            }
          }
          else {
            obj.$value = isColor
              ? rgbToCssColor(value as RGBA)
              : isNumber
                ? parseFloat(value as string)
                  : isBool
                    ? Boolean(value)
                    : String(value);
          }
        }
      }
    }
    entries.push(file as never);
  };
  return entries;
}

/**
 * Exports all local variable collections to JSON format
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to append (default all)
 * @param parserId - Optional description parser id
 * @returns JSON string with structured variable data
 */
export const exportToJSON = async (
  selection?: ExportSelection,
  styleSelection: StyleSelection = ALL_STYLES,
  parserId?: string
): Promise<string | undefined> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  try {
    const files: any[] = [];
    for( const collection of collections ) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      const processedCollection = await processCollection(collection, selection, parserId);
      files.push(... processedCollection );
    }

    // Merge the selected local style kinds as an additional entry — but only
    // when at least one style exists, so deselecting everything yields an empty
    // array rather than a lone (empty) "Styles" entry.
    if (anyStyleSelected(styleSelection)) {
      const styles = filterStyles(await getLocalStyles(), styleSelection);
      const trees = buildStyleTokenTrees(styles);
      const hasAnyStyle = Object.values(trees).some(
        (tree) => Object.keys(tree).length > 0
      );
      if (hasAnyStyle) {
        files.push({ collection: "Styles", ...trees });
      }
    }

    const jsonData = JSON.stringify(files, null, 2);
    return jsonData;
  }
  catch (err) {
    console.error(err);
  }
};
