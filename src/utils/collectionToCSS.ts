import { rgbToCssColor } from "./color";
import { toCssVar } from "./stringTransformation";
import { getLocalStyles, stylesToCssFragments, filterStyles } from "./styleSerializers";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * Processes a variable collection into CSS format
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @returns Object containing root variables and theme-specific CSS blocks
 */
async function processCollection(
  collection: VariableCollection,
  selection?: ExportSelection
): Promise<{ root: string[], dark: string[], theme: string[] }> {
  const { name, variableIds } = collection;
  const themeBlocks: string[] = [];
  let rootVars: string[] = [];
  let darkVars: string[] = [];
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);

  for(const mode of selectedModes(collection.id, collection.modes, selection)) {
    let cssVars: string[] = [];

    for (const variableId of variableIds) {
      const figVar = await figma.variables.getVariableByIdAsync(variableId);
      if (figVar !== null) {
        const { name, resolvedType, valuesByMode, description }: Variable = figVar;
        const value: VariableValue = valuesByMode[mode.modeId];

        if (value !== undefined && validTypes.has(resolvedType)) {
          const cssVarName = toCssVar(name, true);
          let cssValue: string;

          const isColor: boolean = resolvedType === "COLOR";
          const isNumber: boolean = resolvedType === "FLOAT";
          const isBool: boolean = resolvedType === "BOOLEAN";

          if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
            const linkedVar = await figma.variables.getVariableByIdAsync(value.id);

            if(linkedVar) {
              const linkedName = toCssVar(linkedVar.name);
              cssValue = `var(--${linkedName})`;
            }
            else {
              cssValue = "initial";
            }
          }
          else {
            cssValue = isColor
              ? rgbToCssColor(value as RGBA)
              : isNumber
                ? `${parseFloat(value as string)}px`
                  : isBool
                    ? Boolean(value) ? 'var(--TRUE)' : 'var(--FALSE)'
                    : `"${String(value)}"`;
          }
          cssVars.push(`  ${cssVarName}: ${cssValue};${description ? `\t/* ${description} */` : ''}`);
        }
      }
    }
    // Classify modes: Light/Default/Mode 1 are the default :root values,
    // Dark goes into a prefers-color-scheme media query, anything else stays
    // a theme class.
    const normalizedMode = mode.name.trim().toLowerCase();
    const isRoot = normalizedMode === 'default' || normalizedMode === 'mode 1' || normalizedMode === 'light';
    const isDark = normalizedMode === 'dark';

    if (isRoot) {
      rootVars.push(... cssVars);
    }
    else if (isDark) {
      darkVars.push(... cssVars);
    }
    else {
      const selector = `.${toCssVar(name)}--${toCssVar(mode.name)}`;
      themeBlocks.push(`${selector} {\n${cssVars.join('\n')}\n}`);
    }
    cssVars= [];
  }
  return { root: rootVars, dark: darkVars, theme: themeBlocks };
}

/**
 * Exports all local variable collections to CSS format
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to append (default all)
 * @returns CSS string with custom properties and theme selectors
 */
export const exportToCSS = async (
  selection?: ExportSelection,
  styleSelection: StyleSelection = ALL_STYLES
): Promise<string> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  try {
    const rootVars = new Set<string>();  // Use Set to avoid duplicates
    const darkVars = new Set<string>();  // "Dark" mode vars → media query
    const nonRootBlocks: string[] = [];

    for(const collection of collections) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      const { root, dark, theme } = await processCollection(collection, selection);
      root.forEach(v => rootVars.add(v));
      dark.forEach(v => darkVars.add(v));
      nonRootBlocks.push(...theme);
    }

    // Merge local styles into the same output: paint/effect styles become
    // :root custom properties, text/grid styles become trailing blocks.
    const styleBlocks: string[] = [];
    if (anyStyleSelected(styleSelection)) {
      const styles = filterStyles(await getLocalStyles(), styleSelection);
      const { rootVars: styleRootVars, blocks } = stylesToCssFragments(styles);
      styleRootVars.forEach(v => rootVars.add(v));
      styleBlocks.push(...blocks);
    }

    // Create single root selector with all variables including TRUE/FALSE
    const rootBlock = `:root {\n  --TRUE: 1;\n  --FALSE: 0;\n${Array.from(rootVars).join('\n')}\n}`;

    // Emit "Dark" mode values inside a prefers-color-scheme media query so they
    // apply automatically. Each var line is indented one extra level.
    const darkBlock = darkVars.size > 0
      ? `@media (prefers-color-scheme: dark) {\n  :root {\n${Array.from(darkVars).map(v => `  ${v}`).join('\n')}\n  }\n}`
      : null;

    const blocks = [rootBlock];
    if (darkBlock) {
      blocks.push(darkBlock);
    }
    blocks.push(...nonRootBlocks, ...styleBlocks);

    return blocks.join('\n\n');
  } catch (err) {
    console.error(err);
    return `/* Something went wrong while converting:
            ${err}*/`;
  }
};
