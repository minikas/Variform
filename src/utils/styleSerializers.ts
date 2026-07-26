import type { StyleSelection, TailwindUnit } from "../types.d";
import { toCssVar } from "./stringTransformation";
import { toJsObjectLiteral } from "./jsSerialize";
import {
  fontWeightFromStyle,
  isItalicStyle,
  lineHeightToCss,
  letterSpacingToCss,
  textCaseToCss,
  textDecorationToCss,
  paintsToCss,
  paintToCss,
  effectsToCss,
} from "./styleConversion";

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bundle of all local Figma styles grouped by kind
 */
export interface LocalStyles {
  text: TextStyle[];
  paint: PaintStyle[];
  effect: EffectStyle[];
  grid: GridStyle[];
}

/**
 * Fetches all local Figma styles (text, paint, effect, grid).
 * Uses the async getters required by the plugin's `documentAccess: dynamic-page`.
 * @returns All local styles grouped by kind
 */
export const getLocalStyles = async (): Promise<LocalStyles> => {
  const [text, paint, effect, grid] = await Promise.all([
    figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalGridStylesAsync(),
  ]);

  return { text, paint, effect, grid };
};

/**
 * Returns a copy of the styles bundle with the deselected kinds emptied, so the
 * per-format serializers naturally skip them.
 * @param styles - The full local styles bundle
 * @param selection - Which style kinds to keep
 * @returns A new bundle keeping only the selected kinds
 */
export const filterStyles = (
  styles: LocalStyles,
  selection: StyleSelection
): LocalStyles => ({
  text: selection.text ? styles.text : [],
  paint: selection.paint ? styles.paint : [],
  effect: selection.effect ? styles.effect : [],
  grid: selection.grid ? styles.grid : [],
});

/* -------------------------------------------------------------------------- */
/* Design-token trees (shared by JSON and JS)                                 */
/* -------------------------------------------------------------------------- */

interface StyleToken {
  $type: string;
  $description: string;
  $value: unknown;
}

interface StyleTokenTrees {
  textStyles: Record<string, any>;
  paintStyles: Record<string, any>;
  effectStyles: Record<string, any>;
  gridStyles: Record<string, any>;
}

/**
 * Nests a token under a slash-delimited Figma style name within a tree.
 *
 * Prototype-pollution safe: path segments are always created as OWN
 * properties (via defineProperty, so `__proto__` never triggers the
 * prototype setter) and inherited nodes are never reused.
 *
 * Collision policy (style "a" vs style "a/b", or duplicate paths): the LAST
 * token never overwrites or merges into what is already there — a token is
 * never mixed with a group and no data is silently lost. The collision is
 * logged with console.warn and the later token is skipped.
 */
const nestToken = (
  tree: Record<string, any>,
  name: string,
  token: StyleToken
): void => {
  const isTokenNode = (node: unknown): boolean =>
    typeof node === "object" && node !== null && ("$value" in node || "value" in node);

  const parts = name.split("/");
  let cursor = tree;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const existing = Object.prototype.hasOwnProperty.call(cursor, part) ? cursor[part] : undefined;

    if (index === parts.length - 1) {
      if (existing !== undefined) {
        console.warn(`Duplicate style path "${name}": keeping the first token, skipping the later one.`);
        return;
      }
      Object.defineProperty(cursor, part, { value: token, writable: true, enumerable: true, configurable: true });
      return;
    }

    if (existing !== undefined && (typeof existing !== "object" || existing === null || isTokenNode(existing))) {
      console.warn(`Style name collision at "${name}": a token already sits at "${part}", skipping the nested one.`);
      return;
    }
    if (existing === undefined) {
      const node: Record<string, any> = {};
      Object.defineProperty(cursor, part, { value: node, writable: true, enumerable: true, configurable: true });
      cursor = node;
    } else {
      cursor = existing;
    }
  }
};

const buildTextTree = (textStyles: TextStyle[]): Record<string, any> => {
  const tree: Record<string, any> = {};
  for (const style of textStyles) {
    nestToken(tree, style.name, {
      $type: "typography",
      $description: style.description || "",
      $value: {
        fontFamily: style.fontName.family,
        fontStyle: isItalicStyle(style.fontName.style) ? "italic" : "normal",
        fontWeight: fontWeightFromStyle(style.fontName.style),
        fontSize: style.fontSize,
        lineHeight: lineHeightToCss(style.lineHeight),
        letterSpacing: letterSpacingToCss(style.letterSpacing),
        textCase: style.textCase,
        textDecoration: style.textDecoration,
        paragraphSpacing: style.paragraphSpacing,
      },
    });
  }
  return tree;
};

const buildPaintTree = (paintStyles: PaintStyle[]): Record<string, any> => {
  const tree: Record<string, any> = {};
  for (const style of paintStyles) {
    const css = paintsToCss(style.paints);
    nestToken(tree, style.name, {
      $type: "color",
      $description: style.description || "",
      $value: {
        css: css ? css.value : null,
        paints: style.paints.map((paint) => ({
          type: paint.type,
          css: paintToCss(paint),
        })),
      },
    });
  }
  return tree;
};

const buildEffectTree = (effectStyles: EffectStyle[]): Record<string, any> => {
  const tree: Record<string, any> = {};
  for (const style of effectStyles) {
    nestToken(tree, style.name, {
      $type: "effect",
      $description: style.description || "",
      $value: {
        ...effectsToCss(style.effects),
        effects: style.effects.map((effect) => ({ ...effect })),
      },
    });
  }
  return tree;
};

const buildGridTree = (gridStyles: GridStyle[]): Record<string, any> => {
  const tree: Record<string, any> = {};
  for (const style of gridStyles) {
    nestToken(tree, style.name, {
      $type: "grid",
      $description: style.description || "",
      $value: {
        layoutGrids: style.layoutGrids.map((grid) => ({ ...grid })),
      },
    });
  }
  return tree;
};

/**
 * Builds design-token trees for every kind of local style.
 * Shared by the JSON serializer and the JS serializer.
 * @param styles - The local styles bundle
 * @returns Token trees grouped by style kind
 */
export const buildStyleTokenTrees = (styles: LocalStyles): StyleTokenTrees => ({
  textStyles: buildTextTree(styles.text),
  paintStyles: buildPaintTree(styles.paint),
  effectStyles: buildEffectTree(styles.effect),
  gridStyles: buildGridTree(styles.grid),
});

/* -------------------------------------------------------------------------- */
/* CSS fragments                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Neutralizes sequences that would break out of a CSS comment (a star-slash
 * pair closes the comment early; `<!--` can confuse HTML parsers when the
 * CSS is inlined). Safe to interpolate inside a comment afterwards.
 * @param text - The raw text (e.g. a Figma style description)
 * @returns The sanitized text
 */
export const sanitizeCssComment = (text: string): string =>
  text.replace(/\*\//g, "* /").replace(/<!--/g, "< !--");

/**
 * Sanitizes a Figma style name into a valid CSS class name (without the
 * leading dot): lowercases and kebab-cases via toCssVar, strips characters
 * outside [a-z0-9_-] and prefixes a leading digit with `_` (e.g. "24px/Body"
 * → "_24px--body"). Exported so the CSS/Tailwind serializers share it.
 * @param name - The Figma style name
 * @returns A valid CSS class name
 */
export const toCssClassName = (name: string): string => {
  const sanitized = toCssVar(name).replace(/[^a-z0-9_-]/g, "");
  if (sanitized.length === 0) return "_";
  return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
};

const descriptionComment = (description: string): string =>
  description ? `\t/* ${sanitizeCssComment(description)} */` : "";

const textStylesToCss = (textStyles: TextStyle[]): string[] =>
  textStyles.map((style) => {
    const declarations: string[] = [
      `  font-family: "${style.fontName.family}";`,
      `  font-size: ${style.fontSize}px;`,
      `  font-weight: ${fontWeightFromStyle(style.fontName.style)};`,
      `  line-height: ${lineHeightToCss(style.lineHeight)};`,
      `  letter-spacing: ${letterSpacingToCss(style.letterSpacing)};`,
    ];

    if (isItalicStyle(style.fontName.style)) {
      declarations.push(`  font-style: italic;`);
    }

    const { textTransform, fontVariant } = textCaseToCss(style.textCase);
    if (textTransform) {
      declarations.push(`  text-transform: ${textTransform};`);
    }
    if (fontVariant) {
      declarations.push(`  font-variant: ${fontVariant};`);
    }

    const decoration = textDecorationToCss(style.textDecoration);
    if (decoration) {
      declarations.push(`  text-decoration: ${decoration};`);
    }

    if (style.paragraphSpacing) {
      declarations.push(`  margin-bottom: ${style.paragraphSpacing}px;`);
    }

    const selector = `.${toCssClassName(style.name)}`;
    const comment = style.description ? `/* ${sanitizeCssComment(style.description)} */\n` : "";
    return `${comment}${selector} {\n${declarations.join("\n")}\n}`;
  });

const paintStylesToVars = (paintStyles: PaintStyle[]): string[] =>
  paintStyles
    .map((style) => {
      const css = paintsToCss(style.paints);
      if (!css) {
        return null;
      }
      return `  --${toCssVar(style.name)}: ${css.value};${descriptionComment(style.description)}`;
    })
    .filter((line): line is string => line !== null);

const effectStylesToVars = (effectStyles: EffectStyle[]): string[] =>
  effectStyles.flatMap((style) => {
    const css = effectsToCss(style.effects);
    const name = toCssVar(style.name);
    const lines: string[] = [];

    if (css.boxShadow) {
      lines.push(`  --${name}: ${css.boxShadow};${descriptionComment(style.description)}`);
    }
    if (css.filter) {
      lines.push(`  --${name}-filter: ${css.filter};`);
    }
    if (css.backdropFilter) {
      lines.push(`  --${name}-backdrop-filter: ${css.backdropFilter};`);
    }
    return lines;
  });

const gridStylesToComment = (gridStyles: GridStyle[]): string | null => {
  if (gridStyles.length === 0) {
    return null;
  }

  const lines = gridStyles.map((style) => {
    const grids = style.layoutGrids
      .map((grid) => {
        if (grid.pattern === "GRID") {
          return `GRID size=${grid.sectionSize}`;
        }
        return `${grid.pattern} count=${"count" in grid ? grid.count : "auto"} gutter=${grid.gutterSize} size=${grid.sectionSize ?? "auto"}`;
      })
      .join(" | ");
    return `   - ${style.name}: ${grids}`;
  });

  return `/*\n * Grid Styles (no direct CSS equivalent)\n${lines.join("\n")}\n */`;
};

/**
 * CSS fragments produced from local styles, ready to merge into variables CSS
 */
export interface StylesCssFragments {
  /** Custom property declarations to merge into the shared :root block */
  rootVars: string[];
  /** Standalone blocks (text classes, grid docs) to append after :root */
  blocks: string[];
}

/**
 * Converts local Figma styles into CSS fragments for merging with variables.
 * Paint and effect styles become :root custom properties; text styles become
 * utility classes; grid styles are documented in a comment block.
 * @param styles - The local styles bundle
 * @returns The CSS fragments to merge into the variables CSS output
 */
export const stylesToCssFragments = (styles: LocalStyles): StylesCssFragments => {
  const rootVars = [
    ...paintStylesToVars(styles.paint),
    ...effectStylesToVars(styles.effect),
  ];

  const blocks: string[] = [];
  const textClasses = textStylesToCss(styles.text);
  if (textClasses.length > 0) {
    blocks.push(`/* Text Styles */\n${textClasses.join("\n\n")}`);
  }
  const gridComment = gridStylesToComment(styles.grid);
  if (gridComment) {
    blocks.push(gridComment);
  }

  return { rootVars, blocks };
};

/* -------------------------------------------------------------------------- */
/* CSV rows (variables schema: Collection,Mode,Variable,Type,Value,Scopes,Description) */
/* -------------------------------------------------------------------------- */

/**
 * Escapes a single CSV cell: always double-quoted, inner quotes doubled.
 * Exported so the variables CSV serializer shares the same escaping.
 */
export const csvCell = (value: string | number): string =>
  `"${String(value).replace(/"/g, '""')}"`;

const csvRow = (
  collection: string,
  name: string,
  type: string,
  value: string,
  description: string
): string =>
  [collection, "", csvCell(name), type, csvCell(value), "", csvCell(description)].join(",");

const textStyleValue = (style: TextStyle): string => {
  const parts: string[] = [
    `font-family: "${style.fontName.family}"`,
    `font-size: ${style.fontSize}px`,
    `font-weight: ${fontWeightFromStyle(style.fontName.style)}`,
    `line-height: ${lineHeightToCss(style.lineHeight)}`,
    `letter-spacing: ${letterSpacingToCss(style.letterSpacing)}`,
  ];
  if (isItalicStyle(style.fontName.style)) {
    parts.push("font-style: italic");
  }
  const { textTransform, fontVariant } = textCaseToCss(style.textCase);
  if (textTransform) {
    parts.push(`text-transform: ${textTransform}`);
  }
  if (fontVariant) {
    parts.push(`font-variant: ${fontVariant}`);
  }
  const decoration = textDecorationToCss(style.textDecoration);
  if (decoration) {
    parts.push(`text-decoration: ${decoration}`);
  }
  return parts.join("; ");
};

const effectStyleValue = (style: EffectStyle): string => {
  const css = effectsToCss(style.effects);
  const parts: string[] = [];
  if (css.boxShadow) {
    parts.push(`box-shadow: ${css.boxShadow}`);
  }
  if (css.filter) {
    parts.push(`filter: ${css.filter}`);
  }
  if (css.backdropFilter) {
    parts.push(`backdrop-filter: ${css.backdropFilter}`);
  }
  return parts.join("; ");
};

const gridStyleValue = (style: GridStyle): string =>
  style.layoutGrids
    .map((grid) =>
      grid.pattern === "GRID"
        ? `GRID size=${grid.sectionSize}`
        : `${grid.pattern} count=${"count" in grid ? grid.count : "auto"} gutter=${grid.gutterSize}`
    )
    .join(" | ");

/**
 * Converts local Figma styles into CSV rows matching the variables schema,
 * so they can be appended to the variables CSV output.
 * @param styles - The local styles bundle
 * @returns CSV rows (Collection,Mode,Variable,Type,Value,Scopes,Description)
 */
export const stylesToCsvRows = (styles: LocalStyles): string[] => {
  const rows: string[] = [];

  for (const style of styles.text) {
    rows.push(csvRow("Text Styles", style.name, "TEXT", textStyleValue(style), style.description || ""));
  }
  for (const style of styles.paint) {
    const css = paintsToCss(style.paints);
    if (css) {
      rows.push(csvRow("Paint Styles", style.name, "PAINT", css.value, style.description || ""));
    }
  }
  for (const style of styles.effect) {
    rows.push(csvRow("Effect Styles", style.name, "EFFECT", effectStyleValue(style), style.description || ""));
  }
  for (const style of styles.grid) {
    rows.push(csvRow("Grid Styles", style.name, "GRID", gridStyleValue(style), style.description || ""));
  }

  return rows;
};

/**
 * Builds inspect-table rows (name, kind, value, description) for every local
 * style, reusing the same value formatting as the CSV export.
 * @param styles - The local styles bundle
 * @returns Rows of [name, kind, value, description]
 */
export const stylesToInspectRows = (styles: LocalStyles): string[][] => {
  const rows: string[][] = [];

  for (const style of styles.text) {
    rows.push([style.name, "Text", textStyleValue(style), style.description || ""]);
  }
  for (const style of styles.paint) {
    const css = paintsToCss(style.paints);
    rows.push([style.name, "Paint", css ? css.value : "", style.description || ""]);
  }
  for (const style of styles.effect) {
    rows.push([style.name, "Effect", effectStyleValue(style), style.description || ""]);
  }
  for (const style of styles.grid) {
    rows.push([style.name, "Grid", gridStyleValue(style), style.description || ""]);
  }

  return rows;
};

/* -------------------------------------------------------------------------- */
/* JS export statements                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Serializes a token tree as a JS object literal, unquoting only keys that are
 * valid JS identifiers (style names with spaces or digits stay quoted).
 */
const toExportStatement = (name: string, tree: Record<string, any>): string => {
  return `export const ${name} = ${toJsObjectLiteral(tree)};`;
};

/** Base names of the consts emitted by {@link stylesToJsStatements}. */
export const STYLE_CONST_NAMES = ["textStyles", "paintStyles", "effectStyles", "gridStyles"] as const;

/**
 * Converts local Figma styles into JavaScript export statements, one per
 * non-empty style kind, for appending to the variables JS output.
 * @param styles - The local styles bundle
 * @param reservedNames - Const names already taken in the target module
 *   (e.g. by variable collections); collisions get a numeric suffix
 *   (`textStyles2`, ...)
 * @returns A JS string with one exported const per non-empty style kind
 */
export const stylesToJsStatements = (styles: LocalStyles, reservedNames?: Set<string>): string => {
  const trees = buildStyleTokenTrees(styles);
  const used = new Set(reservedNames);

  return (Object.keys(trees) as Array<keyof StyleTokenTrees>)
    .filter((key) => Object.keys(trees[key]).length > 0)
    .map((key) => {
      let name: string = key;
      for (let suffix = 2; used.has(name); suffix++) {
        name = `${key}${suffix}`;
      }
      used.add(name);
      return toExportStatement(name, trees[key]);
    })
    .join("\n\n");
};

/* -------------------------------------------------------------------------- */
/* Tailwind v4 @theme tokens                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Formats a px length in the chosen unit (rem/em are converted from a 16px
 * base). Local copy of formatTailwindLength — importing it from
 * collectionToTailwind would create a circular module dependency.
 */
const formatStyleLength = (value: number, unit: TailwindUnit): string => {
  if (unit === "px") return `${value}px`;
  return `${parseFloat((value / 16).toFixed(4))}${unit}`;
};

const textTokens = (textStyles: TextStyle[], unit: TailwindUnit): string[] =>
  textStyles.flatMap((style) => {
    const name = toCssVar(style.name);
    // Percent/auto line-heights and em letter-spacing are already relative;
    // only px lengths are converted to the chosen unit.
    const lineHeight =
      unit !== "px" && style.lineHeight.unit === "PIXELS"
        ? formatStyleLength(style.lineHeight.value, unit)
        : lineHeightToCss(style.lineHeight);
    const letterSpacing =
      unit !== "px" && style.letterSpacing.unit === "PIXELS"
        ? formatStyleLength(style.letterSpacing.value, unit)
        : letterSpacingToCss(style.letterSpacing);
    return [
      `  --text-${name}: ${formatStyleLength(style.fontSize, unit)};`,
      `  --text-${name}--line-height: ${lineHeight};`,
      `  --text-${name}--font-weight: ${fontWeightFromStyle(style.fontName.style)};`,
      `  --text-${name}--letter-spacing: ${letterSpacing};`,
    ];
  });

const paintTokens = (paintStyles: PaintStyle[], prefix: string): string[] =>
  paintStyles
    .map((style) => {
      const css = paintsToCss(style.paints);
      if (!css) {
        return null;
      }
      const category = css.property === "color" ? "color" : "gradient";
      const prefixSegment = prefix ? `${toCssVar(prefix)}-` : "";
      return `  --${category}-${prefixSegment}${toCssVar(style.name)}: ${css.value};`;
    })
    .filter((line): line is string => line !== null);

const effectTokens = (effectStyles: EffectStyle[]): string[] =>
  effectStyles
    .map((style) => {
      const css = effectsToCss(style.effects);
      if (!css.boxShadow) {
        return null;
      }
      return `  --shadow-${toCssVar(style.name)}: ${css.boxShadow};`;
    })
    .filter((line): line is string => line !== null);

/**
 * Converts local Figma styles into Tailwind v4 `@theme` token lines, for
 * merging into the variables Tailwind output. Grid styles have no @theme
 * equivalent, so they are documented in a comment block (same as the CSS
 * export) — this keeps the grid toggle meaningful instead of a no-op.
 * @param styles - The local styles bundle
 * @param prefix - Optional prefix inserted after the category segment
 * @param unit - Length unit for px-valued tokens (rem/em use a 16px base)
 * @returns Theme token declaration lines
 */
export const stylesToTailwindTokens = (
  styles: LocalStyles,
  prefix: string = "",
  unit: TailwindUnit = "px"
): string[] => {
  const lines = [
    ...paintTokens(styles.paint, prefix),
    ...textTokens(styles.text, unit),
    ...effectTokens(styles.effect),
  ];
  const gridComment = gridStylesToComment(styles.grid);
  if (gridComment) {
    lines.push(gridComment);
  }
  return lines;
};
