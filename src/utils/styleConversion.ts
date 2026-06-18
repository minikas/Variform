import { rgbToCssColor } from "./color";

/**
 * Maps a Figma font style name (e.g. "Bold", "Semi Bold Italic") to a numeric
 * CSS font-weight. Falls back to 400 (normal) when no keyword matches.
 * @param style - The Figma font style string (fontName.style)
 * @returns The numeric CSS font-weight
 */
export const fontWeightFromStyle = (style: string): number => {
  const normalized = style.toLowerCase();
  const weights: Array<[string, number]> = [
    ["thin", 100],
    ["extralight", 200],
    ["extra light", 200],
    ["ultralight", 200],
    ["semibold", 600],
    ["semi bold", 600],
    ["demibold", 600],
    ["extrabold", 800],
    ["extra bold", 800],
    ["ultrabold", 800],
    ["light", 300],
    ["medium", 500],
    ["bold", 700],
    ["black", 900],
    ["heavy", 900],
    ["regular", 400],
    ["normal", 400],
  ];

  for (const [keyword, weight] of weights) {
    if (normalized.includes(keyword)) {
      return weight;
    }
  }
  return 400;
};

/**
 * Detects whether a Figma font style name represents an italic face
 * @param style - The Figma font style string (fontName.style)
 * @returns True when the style is italic or oblique
 */
export const isItalicStyle = (style: string): boolean => {
  const normalized = style.toLowerCase();
  return normalized.includes("italic") || normalized.includes("oblique");
};

/**
 * Converts a Figma LineHeight to a CSS line-height value
 * @param lineHeight - The Figma line-height object
 * @returns A CSS line-height string
 */
export const lineHeightToCss = (lineHeight: LineHeight): string => {
  if (lineHeight.unit === "AUTO") {
    return "normal";
  }
  if (lineHeight.unit === "PERCENT") {
    return `${Number(lineHeight.value.toFixed(2))}%`;
  }
  return `${Number(lineHeight.value.toFixed(2))}px`;
};

/**
 * Converts a Figma LetterSpacing to a CSS letter-spacing value.
 * PERCENT spacing is relative to the font size, so it maps to `em`.
 * @param letterSpacing - The Figma letter-spacing object
 * @returns A CSS letter-spacing string
 */
export const letterSpacingToCss = (letterSpacing: LetterSpacing): string => {
  if (letterSpacing.unit === "PERCENT") {
    return `${Number((letterSpacing.value / 100).toFixed(4))}em`;
  }
  return `${Number(letterSpacing.value.toFixed(2))}px`;
};

/**
 * Maps a Figma TextCase to the relevant CSS declarations
 * @param textCase - The Figma text-case value
 * @returns Partial CSS declarations for text-transform / font-variant
 */
export const textCaseToCss = (
  textCase: TextCase
): { textTransform?: string; fontVariant?: string } => {
  switch (textCase) {
    case "UPPER":
      return { textTransform: "uppercase" };
    case "LOWER":
      return { textTransform: "lowercase" };
    case "TITLE":
      return { textTransform: "capitalize" };
    case "SMALL_CAPS":
    case "SMALL_CAPS_FORCED":
      return { fontVariant: "small-caps" };
    default:
      return {};
  }
};

/**
 * Maps a Figma TextDecoration to a CSS text-decoration value
 * @param textDecoration - The Figma text-decoration value
 * @returns A CSS text-decoration string, or null when there is none
 */
export const textDecorationToCss = (
  textDecoration: TextDecoration
): string | null => {
  switch (textDecoration) {
    case "UNDERLINE":
      return "underline";
    case "STRIKETHROUGH":
      return "line-through";
    default:
      return null;
  }
};

/**
 * Applies a global opacity multiplier to a gradient color stop
 * @param color - The stop RGBA color
 * @param opacity - The gradient-wide opacity (0-1)
 * @returns A new RGBA color with combined alpha
 */
const applyOpacity = (color: RGBA, opacity: number): RGBA => ({
  ...color,
  a: (color.a ?? 1) * opacity,
});

/**
 * Serializes Figma gradient stops to a CSS color-stop list
 * @param stops - The Figma gradient stops
 * @param opacity - The gradient-wide opacity (0-1)
 * @returns A comma-joined CSS color-stop string
 */
const gradientStopsToCss = (
  stops: readonly ColorStop[],
  opacity: number
): string =>
  stops
    .map((stop) => {
      const color = rgbToCssColor(applyOpacity(stop.color, opacity));
      const position = Number((stop.position * 100).toFixed(2));
      return `${color} ${position}%`;
    })
    .join(", ");

/**
 * Derives the CSS gradient angle from a Figma gradient transform matrix.
 * Assumes a square aspect ratio (the standard approach, since styles have no
 * intrinsic box). 0deg points up and the angle increases clockwise.
 * @param transform - The Figma 2x3 affine gradient transform
 * @returns The CSS angle in degrees, normalized to [0, 360)
 */
export const gradientAngle = (transform: Transform): number => {
  const a = transform[0][0];
  const b = transform[0][1];
  const radians = Math.atan2(a, -b);
  const degrees = (radians * 180) / Math.PI;
  return Math.round(((degrees % 360) + 360) % 360);
};

/**
 * Converts a single Figma gradient paint to a CSS gradient function
 * @param paint - The Figma gradient paint
 * @returns A CSS gradient string
 */
export const gradientToCss = (paint: GradientPaint): string => {
  const opacity = paint.opacity ?? 1;
  const stops = gradientStopsToCss(paint.gradientStops, opacity);

  switch (paint.type) {
    case "GRADIENT_LINEAR":
      return `linear-gradient(${gradientAngle(paint.gradientTransform)}deg, ${stops})`;
    case "GRADIENT_RADIAL":
      return `radial-gradient(circle at center, ${stops})`;
    case "GRADIENT_ANGULAR":
      return `conic-gradient(from ${gradientAngle(paint.gradientTransform)}deg, ${stops})`;
    case "GRADIENT_DIAMOND":
      // CSS has no diamond gradient; approximate with a radial gradient.
      return `radial-gradient(circle at center, ${stops}) /* diamond gradient approximated */`;
    default:
      return `linear-gradient(${stops})`;
  }
};

/**
 * Converts a single Figma paint to its CSS color/gradient representation
 * @param paint - The Figma paint
 * @returns A CSS value string, or null when the paint cannot be represented
 */
export const paintToCss = (paint: Paint): string | null => {
  if (paint.visible === false) {
    return null;
  }

  if (paint.type === "SOLID") {
    return rgbToCssColor({ ...paint.color, a: paint.opacity ?? 1 });
  }

  if (paint.type.startsWith("GRADIENT_")) {
    return gradientToCss(paint as GradientPaint);
  }

  if (paint.type === "IMAGE") {
    return "/* image paint — not exportable to CSS */";
  }

  return null;
};

/**
 * Result of converting a paint style's paints to CSS
 */
export interface PaintCss {
  property: "color" | "background";
  value: string;
}

/**
 * Converts a list of Figma paints to a single CSS color/background value.
 * Multiple paints are layered as a comma-separated `background` (top paint
 * first, matching Figma's render order).
 * @param paints - The Figma paints from a paint style
 * @returns The CSS property and value, or null when there is nothing to render
 */
export const paintsToCss = (paints: readonly Paint[]): PaintCss | null => {
  const values = paints
    .map(paintToCss)
    .filter((value): value is string => value !== null);

  if (values.length === 0) {
    return null;
  }

  const isSingleSolid =
    values.length === 1 && paints.filter((p) => p.visible !== false)[0]?.type === "SOLID";

  if (isSingleSolid) {
    return { property: "color", value: values[0] };
  }

  // CSS background layers render first-listed on top, so reverse Figma's order.
  return { property: "background", value: [...values].reverse().join(", ") };
};

/**
 * Result of converting an effect style's effects to CSS
 */
export interface EffectCss {
  boxShadow?: string;
  filter?: string;
  backdropFilter?: string;
}

/**
 * Converts a single Figma shadow effect to a CSS box-shadow segment
 * @param effect - The Figma drop or inner shadow effect
 * @returns A CSS box-shadow segment
 */
const shadowToCss = (effect: DropShadowEffect | InnerShadowEffect): string => {
  const { offset, radius, color } = effect;
  const spread = "spread" in effect && effect.spread ? effect.spread : 0;
  const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
  return `${inset}${offset.x}px ${offset.y}px ${radius}px ${spread}px ${rgbToCssColor(color)}`;
};

/**
 * Converts a list of Figma effects to CSS box-shadow / filter declarations
 * @param effects - The Figma effects from an effect style
 * @returns The CSS effect declarations
 */
export const effectsToCss = (effects: readonly Effect[]): EffectCss => {
  const shadows: string[] = [];
  let filter: string | undefined;
  let backdropFilter: string | undefined;

  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }

    switch (effect.type) {
      case "DROP_SHADOW":
      case "INNER_SHADOW":
        shadows.push(shadowToCss(effect));
        break;
      case "LAYER_BLUR":
        filter = `blur(${effect.radius}px)`;
        break;
      case "BACKGROUND_BLUR":
        backdropFilter = `blur(${effect.radius}px)`;
        break;
    }
  }

  const result: EffectCss = {};
  if (shadows.length > 0) {
    result.boxShadow = shadows.join(", ");
  }
  if (filter) {
    result.filter = filter;
  }
  if (backdropFilter) {
    result.backdropFilter = backdropFilter;
  }
  return result;
};
