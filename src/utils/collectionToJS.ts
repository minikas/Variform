import { rgbToCssColor } from "./color";
import { toCamelCase } from "./stringTransformation";
import { getMatchingModeName } from "./variableUtils";
import { getLocalStyles, stylesToJsStatements, filterStyles } from "./styleSerializers";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import { applyDescriptionParser } from "./descriptionParsers";
import type { ExportSelection, StyleSelection } from "../types.d";

/** Matches a valid JavaScript identifier (safe to emit unquoted) */
const IDENTIFIER_RE = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/;

/**
 * Marker wrapping alias reference paths inside the working object so the
 * serializer can tell real references apart from plain string values.
 * JSON.stringify escapes the NUL character as the six-character sequence
 * backslash-u-0-0-0-0, which serializeCollection then unquotes into a
 * member expression.
 */
const ALIAS_MARKER = "\u0000";

/**
 * Converts a collection name into a valid JS identifier for the exported const
 * @param name - The collection name
 * @returns A camelCased name, prefixed with `_` when it is not a valid identifier
 */
const toSafeConstName = (name: string): string => {
  const camel = toCamelCase(name);
  return IDENTIFIER_RE.test(camel) ? camel : `_${camel}`;
};

/**
 * Formats a concrete (non-alias) variable value for the JS/TS output
 * @param value - The raw variable value
 * @param resolvedType - The variable's resolved type
 * @returns The processed scalar value
 */
const formatValue = (value: VariableValue, resolvedType: string) =>
  resolvedType === "COLOR"
    ? rgbToCssColor(value as RGBA)
    : resolvedType === "FLOAT"
      ? parseFloat(value as string)
      : resolvedType === "BOOLEAN"
        ? Boolean(value)
        : String(value);

/**
 * Resolves an alias chain to its concrete value, following VARIABLE_ALIAS
 * hops until a real value is found. Used whenever a reference cannot be
 * emitted (same-collection aliases would be self-references inside the
 * const's own initializer; unexported collections would dangle). Guards
 * against cycles and broken links with the '_unlinked' fallback.
 * @param variableId - The aliased variable id to start from
 * @param modeId - The mode to resolve the value in
 * @param resolvedType - The resolved type used to format the final value
 * @param seen - Variable ids already visited (cycle guard)
 * @returns The processed scalar value, or '_unlinked'
 */
const resolveAliasValue = async (
  variableId: string,
  modeId: string,
  resolvedType: string,
  seen: Set<string> = new Set()
): Promise<string | number | boolean> => {
  if (seen.has(variableId)) return "_unlinked";
  seen.add(variableId);

  const linked = await figma.variables.getVariableByIdAsync(variableId);
  if (!linked) return "_unlinked";

  const value: VariableValue = linked.valuesByMode[modeId] ?? Object.values(linked.valuesByMode)[0];
  if (value === undefined) return "_unlinked";
  if (typeof value === "object" && "type" in value && value.type === "VARIABLE_ALIAS") {
    return resolveAliasValue(value.id, modeId, resolvedType, seen);
  }
  return formatValue(value, resolvedType);
};

/**
 * Processes a variable collection into a nested JavaScript object
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @param parserId - Optional description parser id
 * @returns The exported const name, the nested object for the collection,
 *   and the const names of other collections its aliases reference
 */
async function processCollection(
    collection: VariableCollection,
    selection?: ExportSelection,
    parserId?: string
): Promise<{ varName: string; variables: Record<string, any>; referencedCollections: Set<string> }> {
  const { name: collectionName, variableIds } = collection;
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);
  const variables: Record<string, any> = {};
  const referencedCollections = new Set<string>();

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
                  // References are only valid across collections that are part
                  // of the export: a same-collection path would be a
                  // self-reference inside the const's own initializer (TDZ
                  // crash), and an unexported collection would dangle. In both
                  // cases the alias chain is resolved to its concrete value.
                  const canReference = linkedVarCollection !== null
                    && linkedVarCollection.id !== collection.id
                    && isCollectionSelected(linkedVarCollection.id, selection);

                  if (canReference && linkedVarCollection) {
                    const linkedConstName = toSafeConstName(linkedVarCollection.name);
                    const matchedModeName = getMatchingModeName(mode.name, linkedVarCollection);
                    const aliasPath = `${linkedConstName}.${toCamelCase(matchedModeName)}.${linkedVar.name.split('/').map((str) => toCamelCase(str)).join('.')}.value`;
                    referencedCollections.add(linkedConstName);
                    currentObj[part] = description
                      ? { value: `${ALIAS_MARKER}${aliasPath}${ALIAS_MARKER}`, description: parsedDescription }
                      : { value: `${ALIAS_MARKER}${aliasPath}${ALIAS_MARKER}` };
                  } else {
                    const matchedModeId = linkedVarCollection
                      ? linkedVarCollection.modes.find((m) => m.name === getMatchingModeName(mode.name, linkedVarCollection))?.modeId ?? mode.modeId
                      : mode.modeId;
                    const resolved = await resolveAliasValue(value.id, matchedModeId, resolvedType);
                    currentObj[part] = description
                      ? { value: resolved, description: parsedDescription }
                      : { value: resolved };
                  }
                } else {
                  currentObj[part] = '_unlinked';
                }
              } else {
                const processedValue = formatValue(value, resolvedType);

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

  return { varName: toSafeConstName(collectionName), variables, referencedCollections };
}

/**
 * Converts a dot-delimited reference path into a valid JS member expression,
 * using bracket notation for segments that are not valid identifiers
 * (e.g. numeric groups like `500`)
 * @param path - The dot-delimited path (const name, mode, groups, `value`)
 * @returns A valid member expression
 */
const toMemberExpression = (path: string): string =>
  path.split('.').reduce((acc, segment, index) => {
    if (index === 0) return segment; // const names are sanitized identifiers
    return IDENTIFIER_RE.test(segment) ? `${acc}.${segment}` : `${acc}["${segment}"]`;
  }, '');

/**
 * Serializes a processed collection as an `export const` statement, unquoting
 * identifier keys and turning marked alias strings into real references.
 * @param varName - The exported const name
 * @param variables - The nested object for the collection
 * @param asConst - Whether to append `as const` (TypeScript export)
 * @returns The serialized statement
 */
function serializeCollection(varName: string, variables: Record<string, any>, asConst: boolean = false): string {
  return `export const ${varName} = ${JSON.stringify(variables, null, 2)
    // Unquote marked alias references into real member expressions —
    // plain string values keep their quotes
    .replace(/"\\u0000(.+?)\\u0000"/g, (_match, path) => toMemberExpression(path))
    // Unquote property keys that are valid identifiers, keep the rest quoted
    .replace(/"([^"]+)":/g, (match, key) => IDENTIFIER_RE.test(key) ? `${key}:` : match)}${asConst ? " as const" : ""};\n`;
}

/**
 * Shared builder for the JavaScript and TypeScript exports: processes every
 * selected collection and appends the selected local style kinds.
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to append (default all)
 * @param parserId - Optional description parser id
 * @param asConst - Whether to append `as const` (TypeScript export)
 * @returns The export statements joined by newlines
 */
export const buildJsModuleExports = async (
  selection: ExportSelection | undefined,
  styleSelection: StyleSelection,
  parserId: string | undefined,
  asConst: boolean
): Promise<string | undefined> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  try {
    const entries: Array<{ varName: string; statement: string; referencedCollections: Set<string> }> = [];
    for (const collection of collections) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      const { varName, variables, referencedCollections } = await processCollection(collection, selection, parserId);
      entries.push({ varName, statement: serializeCollection(varName, variables, asConst), referencedCollections });
    }

    // Emit referenced collections first so alias references never point at a
    // const declared later in the module (temporal dead zone). On a
    // cross-collection reference cycle, fall back to the original order.
    const exports: string[] = [];
    const emitted = new Set<string>();
    const exportedNames = new Set(entries.map((entry) => entry.varName));
    const pending = [...entries];
    while (pending.length > 0) {
      const readyIndex = pending.findIndex((entry) =>
        [...entry.referencedCollections].every((dep) => emitted.has(dep) || !exportedNames.has(dep)));
      const next = readyIndex === -1 ? pending.shift()! : pending.splice(readyIndex, 1)[0];
      exports.push(next.statement);
      emitted.add(next.varName);
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
): Promise<string | undefined> => buildJsModuleExports(selection, styleSelection, parserId, false);
