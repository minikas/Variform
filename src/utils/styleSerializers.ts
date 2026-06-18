import type { StyleSelection } from "../types.d";
import { toCssVar } from "./stringTransformation";
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
 * Nests a token under a slash-delimited Figma style name within a tree
 */
const nestToken = (
  tree: Record<string, any>,
  name: string,
  token: StyleToken
): void => {
  const parts = name.split("/");
  let cursor = tree;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = token;
    } else {
      cursor[part] = cursor[part] || {};
      cursor = cursor[part];
    }
  });
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

const descriptionComment = (description: string): string =>
  description ? `\t/* ${description} */` : "";

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

    const selector = `.${toCssVar(style.name)}`;
    const comment = style.description ? `/* ${style.description} */\n` : "";
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

const csvCell = (value: string | number): string =>
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
  const body = JSON.stringify(tree, null, 2).replace(
    /"([A-Za-z_$][A-Za-z0-9_$]*)":/g,
    "$1:"
  );
  return `export const ${name} = ${body};`;
};

/**
 * Converts local Figma styles into JavaScript export statements, one per
 * non-empty style kind, for appending to the variables JS output.
 * @param styles - The local styles bundle
 * @returns A JS string with one exported const per non-empty style kind
 */
export const stylesToJsStatements = (styles: LocalStyles): string => {
  const trees = buildStyleTokenTrees(styles);

  return (Object.keys(trees) as Array<keyof StyleTokenTrees>)
    .filter((key) => Object.keys(trees[key]).length > 0)
    .map((key) => toExportStatement(key, trees[key]))
    .join("\n\n");
};

/* -------------------------------------------------------------------------- */
/* Tailwind v4 @theme tokens                                                  */
/* -------------------------------------------------------------------------- */

const textTokens = (textStyles: TextStyle[]): string[] =>
  textStyles.flatMap((style) => {
    const name = toCssVar(style.name);
    return [
      `  --text-${name}: ${style.fontSize}px;`,
      `  --text-${name}--line-height: ${lineHeightToCss(style.lineHeight)};`,
      `  --text-${name}--font-weight: ${fontWeightFromStyle(style.fontName.style)};`,
      `  --text-${name}--letter-spacing: ${letterSpacingToCss(style.letterSpacing)};`,
    ];
  });

const paintTokens = (paintStyles: PaintStyle[]): string[] =>
  paintStyles
    .map((style) => {
      const css = paintsToCss(style.paints);
      if (!css) {
        return null;
      }
      const prefix = css.property === "color" ? "color" : "gradient";
      return `  --${prefix}-${toCssVar(style.name)}: ${css.value};`;
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
 * merging into the variables Tailwind output.
 * @param styles - The local styles bundle
 * @returns Theme token declaration lines
 */
export const stylesToTailwindTokens = (styles: LocalStyles): string[] => [
  ...paintTokens(styles.paint),
  ...textTokens(styles.text),
  ...effectTokens(styles.effect),
];
