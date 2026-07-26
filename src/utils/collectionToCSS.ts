import { rgbToCssColor } from "./color";
import { toCssVar } from "./stringTransformation";
import { getLocalStyles, stylesToCssFragments, filterStyles, sanitizeCssComment, toCssClassName } from "./styleSerializers";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { getMatchingModeName } from "./variableUtils";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * FLOAT variables whose name contains one of these keywords are unitless in
 * CSS. Custom properties are substituted as raw token streams, so emitting
 * `--opacity: 0.5px` would be invalid at computed-value time; every other
 * FLOAT keeps the historical `px` suffix. Matched against hyphen-delimited
 * segments of the kebab-cased variable name (e.g. "Font Weight/Bold" →
 * "font-weight--bold" matches "font-weight").
 */
const UNITLESS_KEYWORDS = ["opacity", "font-weight", "weight", "z-index", "zindex", "scale", "flex", "order"];
const UNITLESS_PATTERN = new RegExp(`(?:^|-)(${UNITLESS_KEYWORDS.join("|")})(?:-|$)`);
const isUnitlessFloat = (name: string): boolean => UNITLESS_PATTERN.test(toCssVar(name));

const isAlias = (value: VariableValue): value is VariableAlias =>
  typeof value === 'object' && value !== null && 'type' in value && (value as VariableAlias).type === 'VARIABLE_ALIAS';

/**
 * Quotes a STRING variable for CSS, escaping backslashes, double quotes and
 * raw newlines/carriage returns (a literal LF/CR is invalid inside a CSS
 * string; `\a `/`\d ` are their escaped code points).
 */
const cssString = (value: VariableValue): string => {
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\a ")
    .replace(/\r/g, "\\d ");
  return `"${escaped}"`;
};

/**
 * Formats a concrete (non-alias) variable value as CSS. `varName` is the raw
 * Figma name, used to decide whether a FLOAT is unitless.
 */
const formatScalar = (value: VariableValue, resolvedType: string, varName: string): string => {
  if (resolvedType === "COLOR") return rgbToCssColor(value as RGBA);
  if (resolvedType === "FLOAT") return isUnitlessFloat(varName) ? `${value}` : `${value}px`;
  if (resolvedType === "BOOLEAN") return Boolean(value) ? 'var(--TRUE)' : 'var(--FALSE)';
  return cssString(value);
};

/**
 * Resolves an alias chain to a concrete CSS value, following the matching
 * mode of the linked variable's collection (wave-1 matching rules). Returns
 * `null` when the chain cannot be resolved (missing variable, cycle).
 */
const resolveAliasValue = async (
  variableId: string,
  currentModeName: string,
  selection: ExportSelection | undefined,
  seen: Set<string> = new Set()
): Promise<string | null> => {
  if (seen.has(variableId)) return null;
  seen.add(variableId);
  const linked = await figma.variables.getVariableByIdAsync(variableId);
  if (!linked) return null;
  const linkedCollection = await figma.variables.getVariableCollectionByIdAsync(linked.variableCollectionId);
  const matchedModeId = linkedCollection
    ? linkedCollection.modes.find((m) => m.name === getMatchingModeName(currentModeName, linkedCollection, selection))?.modeId
    : undefined;
  const raw: VariableValue = (matchedModeId ? linked.valuesByMode[matchedModeId] : undefined)
    ?? Object.values(linked.valuesByMode)[0];
  if (raw === undefined) return null;
  if (isAlias(raw)) return resolveAliasValue(raw.id, currentModeName, selection, seen);
  return formatScalar(raw, linked.resolvedType, linked.name);
};

/** A custom property declaration plus its name, for per-block dedupe. */
interface CssVarLine {
  name: string;
  line: string;
}

/**
 * Appends declarations to a block, skipping re-declarations of a custom
 * property already present: the first value wins (a second declaration would
 * silently win the cascade) and the skip leaves an audit-trail comment.
 */
const pushDeduped = (
  target: string[],
  seen: Set<string>,
  entries: CssVarLine[],
  collectionName: string
): void => {
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      target.push(`  /* duplicate skipped: ${entry.name} (from ${collectionName}) */`);
    } else {
      seen.add(entry.name);
      target.push(entry.line);
    }
  }
};

/** Extracts the custom property name out of a rendered declaration line. */
const VAR_NAME_PATTERN = /^\s*(--[\w-]+)\s*:/;

/**
 * Processes a variable collection into CSS format
 * @param collection - The variable collection to process
 * @param selection - Optional export selection used to filter the modes
 * @returns Object containing root variables and theme-specific CSS blocks
 */
async function processCollection(
  collection: VariableCollection,
  selection?: ExportSelection
): Promise<{ root: CssVarLine[], dark: CssVarLine[], theme: string[] }> {
  const { name, variableIds } = collection;
  const themeBlocks: string[] = [];
  const rootVars: CssVarLine[] = [];
  const darkVars: CssVarLine[] = [];
  const validTypes = new Set(["COLOR", "FLOAT", "BOOLEAN", "STRING"]);
  // Mode classification is exclusive per collection: at most one mode feeds
  // :root and at most one feeds the dark media query; every other selected
  // mode (including extra root/dark matches) becomes a theme class.
  let rootAssigned = false;
  let darkAssigned = false;

  for(const mode of selectedModes(collection.id, collection.modes, selection)) {
    const cssVars: CssVarLine[] = [];

    for (const variableId of variableIds) {
      const figVar = await figma.variables.getVariableByIdAsync(variableId);
      if (figVar === null) continue;
      const { name, resolvedType, valuesByMode, description }: Variable = figVar;
      if (!validTypes.has(resolvedType)) continue;
      // A variable may have no value for this mode: fall back to the first
      // available value (Figma's own fallback) instead of dropping the var.
      const value: VariableValue = valuesByMode[mode.modeId] ?? Object.values(valuesByMode)[0];
      if (value === undefined) continue;

      const cssVarName = toCssVar(name, true);
      let cssValue: string;
      const comments: string[] = [];

      if (isAlias(value)) {
        const linkedVar = await figma.variables.getVariableByIdAsync(value.id);

        if (linkedVar) {
          const linkedName = toCssVar(linkedVar.name);

          if (isCollectionSelected(linkedVar.variableCollectionId, selection)) {
            cssValue = `var(--${linkedName})`;
          }
          else {
            // The aliased collection is not part of the export: keep the
            // reference but attach the resolved value as a var() fallback so
            // it never dangles (or emit the bare value when the linked name
            // is not a safe custom property name).
            const resolved = await resolveAliasValue(value.id, mode.name, selection);
            const safeName = /^--[a-z0-9_-]+$/.test(`--${linkedName}`) ? `--${linkedName}` : null;

            if (resolved !== null) {
              cssValue = safeName ? `var(${safeName}, ${resolved})` : resolved;
            }
            else {
              cssValue = `var(--${linkedName})`;
              comments.push("unresolved alias");
            }
          }
        }
        else {
          // Broken alias (the target variable no longer exists).
          cssValue = "initial";
          comments.push("unresolved alias");
        }
      }
      else {
        cssValue = formatScalar(value, resolvedType, name);
      }

      if (description) comments.push(sanitizeCssComment(description));
      cssVars.push({ name: cssVarName, line: `  ${cssVarName}: ${cssValue};${comments.length ? `\t/* ${comments.join(' ')} */` : ''}` });
    }

    // Classify modes: Light/Default/Mode 1 are the default :root values,
    // Dark goes into a prefers-color-scheme media query, anything else stays
    // a theme class.
    const normalizedMode = mode.name.trim().toLowerCase();
    const isRoot = normalizedMode === 'default' || normalizedMode === 'mode 1' || normalizedMode === 'light';
    const isDark = normalizedMode === 'dark';

    if (isRoot && !rootAssigned) {
      rootAssigned = true;
      rootVars.push(...cssVars);
    }
    else if (isDark && !darkAssigned) {
      darkAssigned = true;
      darkVars.push(...cssVars);
    }
    else {
      const seen = new Set<string>();
      const lines: string[] = [];
      pushDeduped(lines, seen, cssVars, name);
      const selector = `.${toCssClassName(name)}--${toCssClassName(mode.name)}`;
      themeBlocks.push(`${selector} {\n${lines.join('\n')}\n}`);
    }
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
    const rootVars: string[] = [];
    const darkVars: string[] = [];  // "Dark" mode vars → media query
    const seenRoot = new Set<string>();  // First declaration of a name wins
    const seenDark = new Set<string>();
    const nonRootBlocks: string[] = [];

    for(const collection of collections) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      const { root, dark, theme } = await processCollection(collection, selection);
      pushDeduped(rootVars, seenRoot, root, collection.name);
      pushDeduped(darkVars, seenDark, dark, collection.name);
      nonRootBlocks.push(...theme);
    }

    // Merge local styles into the same output: paint/effect styles become
    // :root custom properties, text/grid styles become trailing blocks.
    const styleBlocks: string[] = [];
    if (anyStyleSelected(styleSelection)) {
      const styles = filterStyles(await getLocalStyles(), styleSelection);
      const { rootVars: styleRootVars, blocks } = stylesToCssFragments(styles);
      const styleEntries = styleRootVars.map((line) => ({
        name: line.match(VAR_NAME_PATTERN)?.[1] ?? line,
        line,
      }));
      pushDeduped(rootVars, seenRoot, styleEntries, "local styles");
      styleBlocks.push(...blocks);
    }

    // Create single root selector with all variables including TRUE/FALSE
    const rootBlock = `:root {\n  --TRUE: 1;\n  --FALSE: 0;\n${rootVars.join('\n')}\n}`;

    // Emit "Dark" mode values inside a prefers-color-scheme media query so they
    // apply automatically. Each var line is indented one extra level.
    const darkBlock = darkVars.length > 0
      ? `@media (prefers-color-scheme: dark) {\n  :root {\n${darkVars.map(v => `  ${v}`).join('\n')}\n  }\n}`
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
