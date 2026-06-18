import { rgbToCssColor } from "./color";
import { toCamelCase } from "./stringTransformation";
import { getMatchingModeName } from "./variableUtils";
import { getLocalStyles, stylesToJsStatements, filterStyles } from "./styleSerializers";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import { applyDescriptionParser } from "./descriptionParsers";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * Processes a variable collection into JavaScript format
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @param parserId - Optional description parser id
 * @returns JavaScript export string for the collection
 */
async function processCollection(
    collection: VariableCollection,
    selection?: ExportSelection,
    parserId?: string
): Promise<string> {
  const { name, variableIds } = collection;
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);
  const variables: Record<string, any> = {};

  for (const mode of selectedModes(collection.id, collection.modes, selection)) {
    variables[toCamelCase(mode.name)] = {};

    for (const variableId of variableIds) {
      const figVar = await figma.variables.getVariableByIdAsync(variableId);
      if (figVar !== null) {
        const { name, resolvedType, valuesByMode, description }: Variable = figVar;
        const value: VariableValue = valuesByMode[mode.modeId];
        const parsedDescription = applyDescriptionParser(description || '', parserId);

        if (value !== undefined && validTypes.has(resolvedType)) {
          let currentObj = variables[toCamelCase(mode.name)];
          const parts = name.split("/").map((str) => toCamelCase(str));

          for (let i = 0, partsLength=parts.length; i < partsLength; i++) {
            const part = parts[i];

            if (i === partsLength - 1) {
              if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
                const linkedVar = await figma.variables.getVariableByIdAsync(value.id);

                if (linkedVar) {
                  const linkedVarCollection = await figma.variables.getVariableCollectionByIdAsync(linkedVar.variableCollectionId);
                  const collPrefix = linkedVarCollection && linkedVarCollection.name !== name ?
                    `${toCamelCase(linkedVarCollection.name)}.` : '';

                    const matchedModeName = linkedVarCollection 
                      ? getMatchingModeName(mode.name, linkedVarCollection)
                      : mode.name;
                    const aliasValue = `${collPrefix}${toCamelCase(matchedModeName)}.${linkedVar.name.split('/').map((str) => toCamelCase(str)).join('.')}.value`;
                    currentObj[part] = description
                      ? { value: aliasValue, description: parsedDescription }
                      : { value: aliasValue };
                } else {
                  currentObj[part] = '_unlinked';
                }
              } else {
                const processedValue = resolvedType === "COLOR"
                  ? rgbToCssColor(value as RGBA)
                  : resolvedType === "FLOAT"
                    ? parseFloat(value as string)
                    : resolvedType === "BOOLEAN"
                      ? Boolean(value)
                      : String(value);
                
                currentObj[part] = description
                  ? { value: processedValue, description: parsedDescription }
                  : { value: processedValue };
              }
            }
            else {
              currentObj[part] = currentObj[part] || {};
              currentObj = currentObj[part];
            }
          }
        }
      }
    }
  }

  const varName = toCamelCase(name);
  const output = `export const ${varName} = ${JSON.stringify(variables, null, 2)
    // First handle numeric-only keys
    .replace(/^(\s*)"(\d+)":/gm, '$1"$2":')
    // Then handle property keys
    .replace(/"([^"]+)":/g, (match, key) => {
        return /^\d+$/.test(key) ? match : `${key}:`
    })
    // Handle linked variable references in value field
    .replace(/"value":\s*"([$_a-zA-Z][$_a-zA-Z0-9]*(?:\.[$_a-zA-Z][$_a-zA-Z0-9]*)*(?:\.\d+)*(?:\.[$_a-zA-Z][$_a-zA-Z0-9]*)*)"/g, (match, p1) => {
        return `value: ${p1.replace(/\.(\d+)(?=\.|$)/g, '["$1"]')}`;
    })};\n`;

    return output;
}

/**
 * Exports all local variable collections to JavaScript format
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to append (default all)
 * @param parserId - Optional description parser id
 * @returns JavaScript string with exported variable objects
 */
export const exportToJS = async (
  selection?: ExportSelection,
  styleSelection: StyleSelection = ALL_STYLES,
  parserId?: string
): Promise<string | undefined> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  try {
    const exports: string[] = [];
    for (const collection of collections) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      const processedCollection = await processCollection(collection, selection, parserId);
      exports.push(processedCollection);
    }

    // Merge the selected local style kinds as additional exported consts
    if (anyStyleSelected(styleSelection)) {
      const styles = filterStyles(await getLocalStyles(), styleSelection);
      const styleStatements = stylesToJsStatements(styles);
      if (styleStatements) {
        exports.push(styleStatements);
      }
    }

    return exports.join('\n');
  } catch (err) {
    console.error(err);
  }
};