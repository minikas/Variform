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
  const { name: collectionName, variableIds } = collection;
  const entries: [] = [];
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);

  for(const mode of selectedModes(collection.id, collection.modes, selection)) {
    const file = { collection: collectionName, mode: mode.name, variables: {} };

    for (const variableId of variableIds) {
      const figVar = await figma.variables.getVariableByIdAsync(variableId);
      if (figVar !== null) {
        const { name: variableName, resolvedType, valuesByMode, scopes, hiddenFromPublishing, description }: Variable = figVar;
        const value: VariableValue = valuesByMode[mode.modeId];

        if (value !== undefined && validTypes.has(resolvedType)) {
          // Nest by the trimmed `/`-delimited path. Collision policy (leaf vs
          // group, or duplicate path): a token is never mixed with a group and
          // nothing is lost silently — warn and skip the colliding variable.
          const pathParts = variableName.split("/").map((part) => part.trim());
          let obj: any = file.variables;
          let collides = false;

          for (let index = 0; index < pathParts.length; index++) {
            const part = pathParts[index];
            const existing = obj[part];

            if (index === pathParts.length - 1) {
              if (existing !== undefined) {
                console.warn(`Variable name collision at "${variableName}": a token or group already sits at that path, skipping it.`);
                collides = true;
                break;
              }
              obj[part] = {};
              obj = obj[part];
            }
            else {
              if (existing !== undefined && "$value" in existing) {
                console.warn(`Variable name collision at "${variableName}": a token already sits at "${part}", skipping the nested one.`);
                collides = true;
                break;
              }
              obj[part] = existing || {};
              obj = obj[part];
            }
          }
          if (collides) continue;

          const isColor: boolean = resolvedType === "COLOR";
          const isNumber: boolean = resolvedType === "FLOAT";
          const isBool: boolean = resolvedType === "BOOLEAN";
          obj.$type = resolvedType;
          obj.$scopes = scopes;
          obj.$hiddenFromPublishing = hiddenFromPublishing;
          obj.$description = applyDescriptionParser(description || '', parserId);
          if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
            const linkedVar = await figma.variables.getVariableByIdAsync(value.id);

            if(linkedVar) {
              const linkedVarCollection = await figma.variables.getVariableCollectionByIdAsync(linkedVar.variableCollectionId);
              // Same-collection aliases use the "$." shorthand; cross-collection
              // ones name the linked collection explicitly.
              let collName = '$.';

              if(linkedVarCollection && collectionName !== linkedVarCollection.name) {
                collName = `$.${linkedVarCollection.name}`
              }
              const matchedModeName = linkedVarCollection
                ? getMatchingModeName(mode.name, linkedVarCollection, selection)
                : mode.name;
              obj.$value = `${collName}.${matchedModeName}.${linkedVar.name.split("/").map((part) => part.trim()).join(".")}`;
            }
            else {
              // A broken alias is a string, not the original resolved type.
              obj.$type = "string";
              obj.$value = "_unlinked"
            }
          }
          else {
            obj.$value = isColor
              ? rgbToCssColor(value as RGBA)
              : isNumber
                ? Number((value as number).toFixed(3))
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
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
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
