import { describe, it, expect } from "vitest";
import {
  fontWeightFromStyle,
  isItalicStyle,
  lineHeightToCss,
  letterSpacingToCss,
  textCaseToCss,
  textDecorationToCss,
  gradientAngle,
  gradientToCss,
  paintToCss,
  paintsToCss,
  effectsToCss,
} from "./styleConversion";

/* ----------------------------- test factories ---------------------------- */

const solid = (r: number, g: number, b: number, opacity = 1, visible = true): Paint =>
  ({ type: "SOLID", color: { r, g, b }, opacity, visible } as unknown as Paint);

type Stop = { position: number; color: { r: number; g: number; b: number; a: number } };

const linearGradient = (
  transform: Transform,
  stops: Stop[],
  opacity = 1
): GradientPaint =>
  ({
    type: "GRADIENT_LINEAR",
    gradientTransform: transform,
    gradientStops: stops,
    opacity,
    visible: true,
  } as unknown as GradientPaint);

const dropShadow = (
  x: number,
  y: number,
  radius: number,
  spread: number,
  color: { r: number; g: number; b: number; a: number },
  visible = true
): Effect =>
  ({ type: "DROP_SHADOW", offset: { x, y }, radius, spread, color, visible } as unknown as Effect);

const innerShadow = (
  x: number,
  y: number,
  radius: number,
  spread: number,
  color: { r: number; g: number; b: number; a: number }
): Effect =>
  ({ type: "INNER_SHADOW", offset: { x, y }, radius, spread, color, visible: true } as unknown as Effect);

const layerBlur = (radius: number): Effect =>
  ({ type: "LAYER_BLUR", radius, visible: true } as unknown as Effect);

const backgroundBlur = (radius: number): Effect =>
  ({ type: "BACKGROUND_BLUR", radius, visible: true } as unknown as Effect);

const IDENTITY: Transform = [
  [1, 0, 0],
  [0, 1, 0],
];

/* -------------------------------- the tests ------------------------------- */

describe("fontWeightFromStyle", () => {
  it.each([
    ["Regular", 400],
    ["Normal", 400],
    ["Thin", 100],
    ["Light", 300],
    ["Medium", 500],
    ["Semi Bold", 600],
    ["SemiBold", 600],
    ["Bold", 700],
    ["Extra Bold", 800],
    ["Black", 900],
    ["Bold Italic", 700],
  ])("maps %s to %i", (style, weight) => {
    expect(fontWeightFromStyle(style)).toBe(weight);
  });

  it("falls back to 400 for italic-only or unknown styles", () => {
    expect(fontWeightFromStyle("Italic")).toBe(400);
    expect(fontWeightFromStyle("Whatever")).toBe(400);
  });
});

describe("isItalicStyle", () => {
  it("detects italic and oblique", () => {
    expect(isItalicStyle("Italic")).toBe(true);
    expect(isItalicStyle("Bold Italic")).toBe(true);
    expect(isItalicStyle("Oblique")).toBe(true);
  });

  it("returns false for upright styles", () => {
    expect(isItalicStyle("Regular")).toBe(false);
    expect(isItalicStyle("Bold")).toBe(false);
  });
});

describe("lineHeightToCss", () => {
  it("maps AUTO to normal", () => {
    expect(lineHeightToCss({ unit: "AUTO" } as LineHeight)).toBe("normal");
  });

  it("maps PERCENT and PIXELS", () => {
    expect(lineHeightToCss({ unit: "PERCENT", value: 150 } as LineHeight)).toBe("150%");
    expect(lineHeightToCss({ unit: "PIXELS", value: 24 } as LineHeight)).toBe("24px");
  });
});

describe("letterSpacingToCss", () => {
  it("maps PERCENT to em (relative to font size)", () => {
    expect(letterSpacingToCss({ unit: "PERCENT", value: 10 } as LetterSpacing)).toBe("0.1em");
  });

  it("maps PIXELS to px", () => {
    expect(letterSpacingToCss({ unit: "PIXELS", value: 2 } as LetterSpacing)).toBe("2px");
  });
});

describe("textCaseToCss", () => {
  it("maps text cases to the right declarations", () => {
    expect(textCaseToCss("UPPER")).toEqual({ textTransform: "uppercase" });
    expect(textCaseToCss("LOWER")).toEqual({ textTransform: "lowercase" });
    expect(textCaseToCss("TITLE")).toEqual({ textTransform: "capitalize" });
    expect(textCaseToCss("SMALL_CAPS")).toEqual({ fontVariant: "small-caps" });
    expect(textCaseToCss("ORIGINAL")).toEqual({});
  });
});

describe("textDecorationToCss", () => {
  it("maps decorations and returns null for NONE", () => {
    expect(textDecorationToCss("UNDERLINE")).toBe("underline");
    expect(textDecorationToCss("STRIKETHROUGH")).toBe("line-through");
    expect(textDecorationToCss("NONE")).toBeNull();
  });
});

describe("gradientAngle", () => {
  it("converts the identity transform to 90deg (left-to-right)", () => {
    expect(gradientAngle(IDENTITY)).toBe(90);
  });

  it("converts a vertical transform to 180deg (top-to-bottom)", () => {
    expect(gradientAngle([[0, 1, 0], [0, 0, 0]])).toBe(180);
  });

  it("converts the reverse-vertical transform to 0deg", () => {
    expect(gradientAngle([[0, -1, 0], [0, 0, 0]])).toBe(0);
  });

  it("converts a diagonal transform to 45deg", () => {
    expect(gradientAngle([[1, -1, 0], [0, 0, 0]])).toBe(45);
  });

  it("normalizes negative angles into [0, 360)", () => {
    expect(gradientAngle([[-1, 0, 0], [0, 0, 0]])).toBe(270);
  });
});

describe("gradientToCss", () => {
  it("serializes a linear gradient with angle and color stops", () => {
    const paint = linearGradient(IDENTITY, [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
    ]);
    expect(gradientToCss(paint)).toBe(
      "linear-gradient(90deg, #000000 0%, #ffffff 100%)"
    );
  });
});

describe("paintToCss", () => {
  it("serializes an opaque solid as a hex color", () => {
    expect(paintToCss(solid(1, 0, 0))).toBe("#ff0000");
  });

  it("serializes a translucent solid as rgba", () => {
    expect(paintToCss(solid(1, 0, 0, 0.5))).toBe("rgba(255, 0, 0, 0.50)");
  });

  it("returns null for invisible paints", () => {
    expect(paintToCss(solid(1, 0, 0, 1, false))).toBeNull();
  });
});

describe("paintsToCss", () => {
  it("returns a color property for a single solid", () => {
    expect(paintsToCss([solid(1, 0, 0)])).toEqual({
      property: "color",
      value: "#ff0000",
    });
  });

  it("layers multiple paints as a reversed background (top paint first)", () => {
    expect(paintsToCss([solid(1, 0, 0), solid(0, 0, 1)])).toEqual({
      property: "background",
      value: "#0000ff, #ff0000",
    });
  });

  it("returns null when there are no renderable paints", () => {
    expect(paintsToCss([])).toBeNull();
    expect(paintsToCss([solid(1, 0, 0, 1, false)])).toBeNull();
  });
});

describe("effectsToCss", () => {
  it("converts a drop shadow to box-shadow", () => {
    expect(effectsToCss([dropShadow(0, 2, 4, 0, { r: 0, g: 0, b: 0, a: 0.25 })])).toEqual({
      boxShadow: "0px 2px 4px 0px rgba(0, 0, 0, 0.25)",
    });
  });

  it("prefixes inner shadows with inset", () => {
    expect(effectsToCss([innerShadow(0, 2, 4, 0, { r: 0, g: 0, b: 0, a: 0.25 })])).toEqual({
      boxShadow: "inset 0px 2px 4px 0px rgba(0, 0, 0, 0.25)",
    });
  });

  it("joins multiple shadows with commas", () => {
    const result = effectsToCss([
      dropShadow(0, 1, 2, 0, { r: 0, g: 0, b: 0, a: 0.1 }),
      dropShadow(0, 4, 8, 0, { r: 0, g: 0, b: 0, a: 0.2 }),
    ]);
    expect(result.boxShadow).toBe(
      "0px 1px 2px 0px rgba(0, 0, 0, 0.10), 0px 4px 8px 0px rgba(0, 0, 0, 0.20)"
    );
  });

  it("maps layer blur to filter and background blur to backdrop-filter", () => {
    expect(effectsToCss([layerBlur(8)])).toEqual({ filter: "blur(8px)" });
    expect(effectsToCss([backgroundBlur(8)])).toEqual({ backdropFilter: "blur(8px)" });
  });

  it("skips invisible effects", () => {
    expect(effectsToCss([dropShadow(0, 2, 4, 0, { r: 0, g: 0, b: 0, a: 1 }, false)])).toEqual({});
  });
});
