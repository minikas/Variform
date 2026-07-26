import type { CssColor } from "../types";

/**
 * Converts an RGBA color to a CSS color string
 * @param {RGBA} param0 - The RGBA color to convert
 * @returns {CssColor} The CSS color string
 */
export const rgbToCssColor = ({ r, g, b, a = 1 }: RGBA): CssColor => {
  if (a !== 1) {
    return `rgba(${[r, g, b]
      .map((n) => Math.round(n * 255))
      .join(", ")}, ${a.toFixed(2)})`;
  }

  /**
   * Converts a number to a hex string
   * @param {number} value - The number to convert
   * @returns {string} The hex string
   */
  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.padStart(2, "0");
  };

  /**
   * Converts the RGB values to a hex string
   * @returns {string} The hex string
   */
  const hex = [toHex(r), toHex(g), toHex(b)].join("");
  return `#${hex}`;
};

/**
 * Converts an RGB color to a 6-digit hex string (alpha is ignored — the DTCG
 * color object carries it in a separate `alpha` field).
 * @param {RGB} param0 - The RGB color to convert
 * @returns {string} The hex string (`#rrggbb`)
 */
export const rgbToHex = ({ r, g, b }: RGB): string => {
  const toHex = (value: number) =>
    Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Converts an RGBA color to a hex string, appending an 8th/2-digit alpha
 * channel only when the color is not fully opaque, so DSCG output uses the
 * standard DTCG hex color formatting (e.g. `#0326880d`).
 * @param {RGBA} param0 - The RGBA color to convert
 * @returns {string} The hex string (`#rrggbb` or `#rrggbbaa`)
 */
export const rgbToHex8 = ({ r, g, b, a = 1 }: RGBA): string => {
  const toHex = (value: number) =>
    Math.round(value * 255).toString(16).padStart(2, "0");

  const alphaHex = toHex(a);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${alphaHex === "ff" ? "" : alphaHex}`;
};

/**
 * Converts an RGBA color to the modern space-separated `rgb()` syntax with an
 * explicit alpha channel. Used by the Tailwind exporters so opacity modifiers
 * (e.g. `bg-primary/20`) keep working on the exported tokens — with bare hex
 * values the modifier cannot inject the alpha channel.
 * @param {RGBA} param0 - The RGBA color to convert
 * @returns {string} The color as `rgb(R G B / A)`
 */
export const rgbToTailwindColor = ({ r, g, b, a = 1 }: RGBA): string => {
  const channels = [r, g, b].map((n) => Math.round(n * 255)).join(" ");
  const alpha = Math.round(a * 100) / 100;
  return `rgb(${channels} / ${alpha})`;
};
