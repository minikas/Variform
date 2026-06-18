import { rgbToHex8 } from "./color";
import { isCollectionSelected, selectedModes } from "./selectionUtils";
import { getLocalStyles, filterStyles } from "./styleSerializers";
import { fontWeightFromStyle, isItalicStyle, letterSpacingToCss } from "./styleConversion";
import { ALL_STYLES, anyStyleSelected } from "./styleSelection";
import type { ExportSelection, StyleSelection } from "../types.d";

/**
 * Converts Figma variable collections into the DTCG (Design Tokens
 * Community Group) format, a.k.a. "DSCG".
 *
 * Shape of the output (single object, not an array):
 *  - Each `collection` + `mode` pair becomes a top-level token set named
 *    `"${collection}/${mode}"`.
 *  - Variables are nested by their `/`-delimited name.
 *  - Each leaf carries `$extensions`, `$type` and `$value` (in that order).
 *    `$extensions` holds `com.figma.scopes` (when the variable has scopes) and
 *    `com.figma.hiddenFromPublishing`.
 *  - Aliases (linked variables) become `{dot.path}` references.
 *  - The file ends with `$themes: []` and `$metadata.tokenSetOrder`.
 */

const VALID_TYPES = new Set<VariableResolvedDataType>([
  "COLOR",
  "FLOAT",
  "BOOLEAN",
  "STRING",
]);

export type DscgTokenType =
  | "color"
  | "number"
  | "boolean"
  | "text"
  | "typography"
  | "shadow";

export interface DscgFigmaExtensions {
  "com.figma.scopes"?: VariableScope[];
  "com.figma.hiddenFromPublishing"?: boolean;
}

export interface DscgToken {
  $type: DscgTokenType;
  // `unknown` so composite style tokens (typography object, shadow object/array)
  // share the type with the scalar variable tokens (string | number).
  $value: unknown;
  // Variable tokens use the flat com.figma.* keys (DscgFigmaExtensions); style
  // tokens use an arbitrary com.figma.* bag.
  $extensions?: DscgFigmaExtensions | Record<string, unknown>;
}

type DscgNode = Record<string, unknown>;

/**
 * Maps a Figma resolved variable type to its DTCG token `$type`.
 * @param resolvedType - The Figma `resolvedType` of the variable
 * @returns The DTCG token type
 */
export function dscgTypeFromResolvedType(
  resolvedType: VariableResolvedDataType
): DscgTokenType {
  switch (resolvedType) {
    case "COLOR":
      return "color";
    case "BOOLEAN":
      return "boolean";
    case "STRING":
      return "text";
    case "FLOAT":
    default:
      return "number";
  }
}

/**
 * Formats a (slash-delimited) variable name as a DTCG reference.
 * @param variableName - The linked variable's name (e.g. `Brand/500 - P`)
 * @returns The reference token (e.g. `{Brand.500 - P}`)
 */
export function toDscgReference(variableName: string): string {
  return `{${variableName.replace(/\//g, ".")}}`;
}

/**
 * Formats a non-alias variable value for its DTCG `$type`.
 * @param resolvedType - The Figma `resolvedType` of the variable
 * @param value - The raw Figma value (already known not to be an alias)
 * @returns The formatted `$value`
 */
export function formatDscgValue(
  resolvedType: VariableResolvedDataType,
  value: Exclude<VariableValue, VariableAlias>
): string | number {
  switch (resolvedType) {
    case "COLOR":
      return rgbToHex8(value as RGBA);
    case "FLOAT":
      return Number((value as number).toFixed(3));
    case "BOOLEAN":
      // Boolean token values are emitted as the strings "true"/"false".
      return JSON.stringify(value as boolean);
    case "STRING":
    default:
      return String(value);
  }
}

/**
 * Builds the `$extensions` block from a variable's Figma metadata.
 * Emits `com.figma.scopes` (when the variable has scopes) and
 * `com.figma.hiddenFromPublishing`, matching the DTCG export.
 * @param variable - The variable's scope/visibility metadata
 * @returns The `$extensions` object, or `undefined` when empty
 */
export function buildFigmaExtensions(
  variable: Pick<Variable, "scopes" | "hiddenFromPublishing">
): DscgFigmaExtensions | undefined {
  const extensions: DscgFigmaExtensions = {};

  if (variable.scopes && variable.scopes.length > 0) {
    extensions["com.figma.scopes"] = variable.scopes;
  }

  if (typeof variable.hiddenFromPublishing === "boolean") {
    extensions["com.figma.hiddenFromPublishing"] = variable.hiddenFromPublishing;
  }

  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

/**
 * Inserts a token at its nested path (split on `/`) within a token set.
 * Leaf keys are written in the order `$extensions`, `$type`, `$value` to match
 * the DTCG output shape.
 * @param setRoot - The token set object to mutate
 * @param variableName - The variable's `/`-delimited name
 * @param token - The DTCG token to insert
 */
export function setNestedToken(
  setRoot: DscgNode,
  variableName: string,
  token: DscgToken
): void {
  const parts = variableName.split("/").map((part) => part.trim());
  let node = setRoot;

  parts.forEach((part) => {
    node[part] = (node[part] as DscgNode) || {};
    node = node[part] as DscgNode;
  });

  if (token.$extensions) node.$extensions = token.$extensions;
  node.$type = token.$type;
  node.$value = token.$value;
}

/**
 * Builds a single token set for a collection + mode pair.
 * @param collection - The variable collection
 * @param mode - The mode within the collection
 * @returns The nested token set object
 */
async function buildTokenSet(
  { variableIds }: VariableCollection,
  mode: { name: string; modeId: string }
): Promise<DscgNode> {
  const setRoot: DscgNode = {};

  for (const variableId of variableIds) {
    const figVar = await figma.variables.getVariableByIdAsync(variableId);
    if (figVar === null) continue;

    const { name, resolvedType, valuesByMode, scopes, hiddenFromPublishing } = figVar;

    if (!VALID_TYPES.has(resolvedType)) continue;

    const value: VariableValue = valuesByMode[mode.modeId];
    if (value === undefined) continue;

    let resolvedValue: string | number;
    if (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "VARIABLE_ALIAS"
    ) {
      const linkedVar = await figma.variables.getVariableByIdAsync(value.id);
      resolvedValue = linkedVar ? toDscgReference(linkedVar.name) : "_unlinked";
    } else {
      resolvedValue = formatDscgValue(
        resolvedType,
        value as Exclude<VariableValue, VariableAlias>
      );
    }

    const extensions = buildFigmaExtensions({ scopes, hiddenFromPublishing });

    setNestedToken(setRoot, name, {
      $type: dscgTypeFromResolvedType(resolvedType),
      $value: resolvedValue,
      ...(extensions ? { $extensions: extensions } : {}),
    });
  }

  return setRoot;
}

/* -------------------------------------------------------------------------- */
/* Local styles → DTCG tokens (typography / color / shadow)                   */
/* -------------------------------------------------------------------------- */

/**
 * Converts a Figma LineHeight to the DTCG `typography.lineHeight` — a unitless
 * ratio. AUTO has no numeric value (returns undefined); PERCENT → value / 100;
 * PIXELS → value / fontSize.
 */
export function lineHeightToRatio(
  lineHeight: LineHeight,
  fontSize: number
): number | undefined {
  if (lineHeight.unit === "AUTO") return undefined;
  if (lineHeight.unit === "PERCENT") {
    return Number((lineHeight.value / 100).toFixed(3));
  }
  if (!fontSize) return undefined;
  return Number((lineHeight.value / fontSize).toFixed(3));
}

/** Maps a Figma text style to a DTCG `typography` composite token. */
export function textStyleToTypographyToken(style: TextStyle): DscgToken {
  const value: Record<string, unknown> = {
    fontFamily: style.fontName.family,
    fontWeight: fontWeightFromStyle(style.fontName.style),
    fontSize: `${style.fontSize}px`,
    letterSpacing: letterSpacingToCss(style.letterSpacing),
  };
  const ratio = lineHeightToRatio(style.lineHeight, style.fontSize);
  if (ratio !== undefined) value.lineHeight = ratio;

  // Figma-only fields with no DTCG `typography` slot live under $extensions.
  const figma: Record<string, unknown> = {};
  if (isItalicStyle(style.fontName.style)) figma["com.figma.fontStyle"] = "italic";
  if (style.textCase && style.textCase !== "ORIGINAL") {
    figma["com.figma.textCase"] = style.textCase;
  }
  if (style.textDecoration && style.textDecoration !== "NONE") {
    figma["com.figma.textDecoration"] = style.textDecoration;
  }
  if (style.paragraphSpacing) {
    figma["com.figma.paragraphSpacing"] = style.paragraphSpacing;
  }

  return {
    $type: "typography",
    $value: value,
    ...(Object.keys(figma).length > 0 ? { $extensions: figma } : {}),
  };
}

/**
 * Maps a Figma paint style to a DTCG `color` token when it is a single visible
 * solid paint. Returns null otherwise (gradients / multi-paint are phase 2).
 */
export function paintStyleToColorToken(style: PaintStyle): DscgToken | null {
  const visible = style.paints.filter((paint) => paint.visible !== false);
  if (visible.length !== 1 || visible[0].type !== "SOLID") return null;
  const paint = visible[0] as SolidPaint;
  return {
    $type: "color",
    $value: rgbToHex8({ ...paint.color, a: paint.opacity ?? 1 }),
  };
}

/**
 * Maps a Figma effect style's drop/inner shadows to a DTCG `shadow` token
 * (a single object, or an array when stacked). Returns null when the style has
 * no shadow effects (blur effects have no DTCG type — phase 2).
 */
export function effectStyleToShadowToken(style: EffectStyle): DscgToken | null {
  const shadows = style.effects.filter(
    (effect): effect is DropShadowEffect | InnerShadowEffect =>
      effect.visible !== false &&
      (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW")
  );
  if (shadows.length === 0) return null;

  const toShadow = (effect: DropShadowEffect | InnerShadowEffect) => ({
    color: rgbToHex8(effect.color),
    offsetX: `${effect.offset.x}px`,
    offsetY: `${effect.offset.y}px`,
    blur: `${effect.radius}px`,
    spread: `${"spread" in effect && effect.spread ? effect.spread : 0}px`,
    inset: effect.type === "INNER_SHADOW",
  });

  return {
    $type: "shadow",
    $value: shadows.length === 1 ? toShadow(shadows[0]) : shadows.map(toShadow),
  };
}

/**
 * Builds the dedicated "Styles" token set, grouped by kind (typography / color
 * / shadow), honoring the style selection. Gradient/blur/grid kinds have no
 * clean DTCG type and are intentionally omitted in phase 1.
 */
async function buildStylesTokenSet(styleSelection: StyleSelection): Promise<DscgNode> {
  const styles = filterStyles(await getLocalStyles(), styleSelection);
  const root: DscgNode = {};

  const add = (kind: string, name: string, token: DscgToken | null) => {
    if (!token) return;
    if (!root[kind]) root[kind] = {};
    setNestedToken(root[kind] as DscgNode, name, token);
  };

  for (const style of styles.text) {
    add("typography", style.name, textStyleToTypographyToken(style));
  }
  for (const style of styles.paint) {
    add("color", style.name, paintStyleToColorToken(style));
  }
  for (const style of styles.effect) {
    add("shadow", style.name, effectStyleToShadowToken(style));
  }

  return root;
}

/**
 * Exports all local variable collections to the DTCG (DSCG) format, optionally
 * including local styles (typography / color / shadow) per `styleSelection`.
 * @param selection - Optional export selection (omit to export everything)
 * @param styleSelection - Which local style kinds to include (default: all)
 * @returns A JSON string in the DSCG format, or `undefined` on failure
 */
export const exportToDSCG = async (
  selection?: ExportSelection,
  styleSelection: StyleSelection = ALL_STYLES
): Promise<string | undefined> => {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const file: Record<string, unknown> = {};
    const tokenSetOrder: string[] = [];

    for (const collection of collections) {
      if (!isCollectionSelected(collection.id, selection)) continue;
      for (const mode of selectedModes(collection.id, collection.modes, selection)) {
        const tokenSetName = `${collection.name}/${mode.name}`;
        file[tokenSetName] = await buildTokenSet(collection, mode);
        tokenSetOrder.push(tokenSetName);
      }
    }

    // Local styles → a dedicated "Styles" set (typography / color / shadow).
    if (anyStyleSelected(styleSelection)) {
      const stylesSet = await buildStylesTokenSet(styleSelection);
      if (Object.keys(stylesSet).length > 0) {
        file["Styles"] = stylesSet;
        tokenSetOrder.push("Styles");
      }
    }

    file.$themes = [];
    file.$metadata = { tokenSetOrder };

    return JSON.stringify(file, null, 2);
  } catch (err) {
    console.error(err);
    return undefined;
  }
};
