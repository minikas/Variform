import { describe, it, expect, afterEach } from "vitest";
import {
  dscgTypeFromResolvedType,
  toDscgReference,
  formatDscgValue,
  buildFigmaExtensions,
  setNestedToken,
  exportToDSCG,
  lineHeightToRatio,
  textStyleToTypographyToken,
  paintStyleToColorToken,
  effectStyleToShadowToken,
  type DscgToken,
} from "./collectionToDSCG";
import { rgbToHex8 } from "./color";

/* ----------------------------- pure functions ---------------------------- */

describe("dscgTypeFromResolvedType", () => {
  it("maps Figma types to DTCG types", () => {
    expect(dscgTypeFromResolvedType("COLOR")).toBe("color");
    expect(dscgTypeFromResolvedType("FLOAT")).toBe("number");
    expect(dscgTypeFromResolvedType("STRING")).toBe("text");
    expect(dscgTypeFromResolvedType("BOOLEAN")).toBe("boolean");
  });
});

describe("toDscgReference", () => {
  it("wraps a slash path as a dotted reference", () => {
    expect(toDscgReference("Brand/500 - P")).toBe("{Brand.500 - P}");
    expect(toDscgReference("Background/Neutral/Primary")).toBe(
      "{Background.Neutral.Primary}"
    );
  });
});

describe("formatDscgValue", () => {
  it("formats colors as hex / hex8", () => {
    expect(formatDscgValue("COLOR", { r: 1, g: 1, b: 1, a: 1 } as RGBA)).toBe(
      "#ffffff"
    );
    expect(
      formatDscgValue("COLOR", {
        r: 191 / 255,
        g: 205 / 255,
        b: 244 / 255,
        a: 0.8,
      } as RGBA)
    ).toBe("#bfcdf4cc");
  });

  it("rounds floats to a number, stringifies booleans, passes strings", () => {
    expect(formatDscgValue("FLOAT", 16)).toBe(16);
    expect(formatDscgValue("FLOAT", 1.23456)).toBe(1.235);
    expect(formatDscgValue("BOOLEAN", true)).toBe("true");
    expect(formatDscgValue("STRING", "Inter")).toBe("Inter");
  });
});

describe("rgbToHex8", () => {
  it("omits alpha when opaque, appends it (padded) when translucent", () => {
    expect(rgbToHex8({ r: 0, g: 0, b: 0, a: 1 } as RGBA)).toBe("#000000");
    expect(rgbToHex8({ r: 1, g: 1, b: 1, a: 0.25 } as RGBA)).toBe("#ffffff40");
    expect(rgbToHex8({ r: 0, g: 0, b: 0, a: 0.05 } as RGBA)).toBe("#0000000d");
  });
});

describe("buildFigmaExtensions", () => {
  it("omits scopes when empty but keeps hiddenFromPublishing", () => {
    expect(
      buildFigmaExtensions({ scopes: [], hiddenFromPublishing: false } as any)
    ).toEqual({ "com.figma.hiddenFromPublishing": false });
  });

  it("includes non-empty scopes BEFORE hiddenFromPublishing (DTCG order)", () => {
    const ext = buildFigmaExtensions({
      scopes: ["FRAME_FILL", "SHAPE_FILL"],
      hiddenFromPublishing: false,
    } as any);
    expect(Object.keys(ext ?? {})).toEqual([
      "com.figma.scopes",
      "com.figma.hiddenFromPublishing",
    ]);
    expect(ext).toEqual({
      "com.figma.scopes": ["FRAME_FILL", "SHAPE_FILL"],
      "com.figma.hiddenFromPublishing": false,
    });
  });

  it("returns undefined when there is no meaningful metadata", () => {
    expect(
      buildFigmaExtensions({
        scopes: [],
        hiddenFromPublishing: undefined as unknown as boolean,
      } as any)
    ).toBeUndefined();
  });
});

describe("setNestedToken", () => {
  it("nests by slash path and writes $extensions, $type, $value (in order)", () => {
    const root: Record<string, any> = {};
    const token: DscgToken = {
      $type: "color",
      $value: "#000000",
      $extensions: { "com.figma.hiddenFromPublishing": false },
    };
    setNestedToken(root, "Grayscale/Black", token);

    expect(root.Grayscale.Black).toEqual({
      $extensions: { "com.figma.hiddenFromPublishing": false },
      $type: "color",
      $value: "#000000",
    });
    expect(Object.keys(root.Grayscale.Black)).toEqual([
      "$extensions",
      "$type",
      "$value",
    ]);
  });

  it("trims whitespace around path segments", () => {
    const root: Record<string, any> = {};
    setNestedToken(root, "Font Family / Prompt", { $type: "text", $value: "Prompt" });
    expect(root).toEqual({
      "Font Family": { Prompt: { $type: "text", $value: "Prompt" } },
    });
  });
});

/* ------------------------- exportToDSCG (end-to-end) ----------------------- */

/**
 * Builds a `figma` mock shaped like the user's real file: multi-mode color
 * collection, an aliased usage token, a numeric spacing token, a string token,
 * and a translucent gradient color.
 */
function makeFigmaMock() {
  const vars: Record<string, any> = {
    white: {
      name: "Grayscale/White",
      resolvedType: "COLOR",
      valuesByMode: { L: { r: 1, g: 1, b: 1, a: 1 }, D: { r: 1, g: 1, b: 1, a: 1 } },
      scopes: [],
      hiddenFromPublishing: false,
    },
    brand: {
      name: "Brand/500 - P",
      resolvedType: "COLOR",
      valuesByMode: {
        L: { r: 4 / 255, g: 58 / 255, b: 209 / 255, a: 1 },
        D: { r: 118 / 255, g: 148 / 255, b: 230 / 255, a: 1 },
      },
      scopes: [],
      hiddenFromPublishing: false,
    },
    grad: {
      name: "Gradient/Blue/XS",
      resolvedType: "COLOR",
      valuesByMode: {
        L: { r: 191 / 255, g: 205 / 255, b: 244 / 255, a: 0.8 },
        D: { r: 0, g: 0, b: 0, a: 0.8 },
      },
      scopes: ["EFFECT_COLOR"],
      hiddenFromPublishing: false,
    },
    bg: {
      name: "Background/Brand/Bold_01",
      resolvedType: "COLOR",
      valuesByMode: { U: { type: "VARIABLE_ALIAS", id: "brand" } },
      scopes: ["FRAME_FILL", "SHAPE_FILL"],
      hiddenFromPublishing: false,
    },
    sp0: {
      name: "sp-0",
      resolvedType: "FLOAT",
      valuesByMode: { S: 0 },
      scopes: ["GAP", "LINE_HEIGHT"],
      hiddenFromPublishing: false,
    },
    weight: {
      name: "Weight/Regular",
      resolvedType: "STRING",
      valuesByMode: { T: "Regular" },
      scopes: ["ALL_SCOPES"],
      hiddenFromPublishing: false,
    },
  };

  const collections = [
    {
      name: "Colour Primitives",
      modes: [
        { name: "Light", modeId: "L" },
        { name: "Dark", modeId: "D" },
      ],
      variableIds: ["white", "brand", "grad"],
    },
    { name: "Colour Usage", modes: [{ name: "Mode 1", modeId: "U" }], variableIds: ["bg"] },
    { name: "Space", modes: [{ name: "Mode 1", modeId: "S" }], variableIds: ["sp0"] },
    {
      name: "Typography Primitives",
      modes: [{ name: "Mode 1", modeId: "T" }],
      variableIds: ["weight"],
    },
  ];

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
    },
    getLocalTextStylesAsync: async () => [],
    getLocalPaintStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
}

/** Collects the key array of every leaf (a node carrying `$type`/`$value`). */
function collectLeafKeySets(node: any, acc: string[][] = []): string[][] {
  if (node && typeof node === "object") {
    if ("$value" in node && "$type" in node) {
      acc.push(Object.keys(node));
    } else {
      for (const v of Object.values(node)) collectLeafKeySets(v, acc);
    }
  }
  return acc;
}

/* --------------------------- style mappers (DTCG) ------------------------- */

describe("lineHeightToRatio", () => {
  it("returns undefined for AUTO", () => {
    expect(lineHeightToRatio({ unit: "AUTO" } as LineHeight, 16)).toBeUndefined();
  });
  it("maps PERCENT to a unitless ratio", () => {
    expect(lineHeightToRatio({ unit: "PERCENT", value: 150 } as LineHeight, 16)).toBe(1.5);
  });
  it("maps PIXELS to value / fontSize", () => {
    expect(lineHeightToRatio({ unit: "PIXELS", value: 24 } as LineHeight, 16)).toBe(1.5);
  });
});

describe("textStyleToTypographyToken", () => {
  it("maps a text style to a typography composite with Figma extras under $extensions", () => {
    const style = {
      name: "Heading/H1",
      fontName: { family: "Inter", style: "Bold Italic" },
      fontSize: 32,
      lineHeight: { unit: "PERCENT", value: 120 },
      letterSpacing: { unit: "PIXELS", value: 0 },
      textCase: "UPPER",
      textDecoration: "UNDERLINE",
      paragraphSpacing: 8,
    } as unknown as TextStyle;

    expect(textStyleToTypographyToken(style)).toEqual({
      $type: "typography",
      $value: {
        fontFamily: "Inter",
        fontWeight: 700,
        fontSize: "32px",
        letterSpacing: "0px",
        lineHeight: 1.2,
      },
      $extensions: {
        "com.figma.fontStyle": "italic",
        "com.figma.textCase": "UPPER",
        "com.figma.textDecoration": "UNDERLINE",
        "com.figma.paragraphSpacing": 8,
      },
    });
  });

  it("omits $extensions and lineHeight for a plain AUTO style", () => {
    const style = {
      name: "Body",
      fontName: { family: "Inter", style: "Regular" },
      fontSize: 16,
      lineHeight: { unit: "AUTO" },
      letterSpacing: { unit: "PERCENT", value: 0 },
      textCase: "ORIGINAL",
      textDecoration: "NONE",
      paragraphSpacing: 0,
    } as unknown as TextStyle;

    expect(textStyleToTypographyToken(style)).toEqual({
      $type: "typography",
      $value: {
        fontFamily: "Inter",
        fontWeight: 400,
        fontSize: "16px",
        letterSpacing: "0em",
      },
    });
  });
});

describe("paintStyleToColorToken", () => {
  it("maps a single visible solid paint to a color token", () => {
    const style = {
      name: "Brand/Primary",
      paints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 }, opacity: 1, visible: true }],
    } as unknown as PaintStyle;
    expect(paintStyleToColorToken(style)).toEqual({
      $type: "color",
      $value: rgbToHex8({ r: 0, g: 0, b: 1, a: 1 }),
    });
  });

  it("returns null for gradient or multi-paint styles", () => {
    const gradient = {
      name: "Brand/Gradient",
      paints: [{ type: "GRADIENT_LINEAR", visible: true }],
    } as unknown as PaintStyle;
    expect(paintStyleToColorToken(gradient)).toBeNull();
  });
});

describe("effectStyleToShadowToken", () => {
  it("maps a single drop shadow to a shadow object", () => {
    const style = {
      name: "Elevation/Low",
      effects: [
        {
          type: "DROP_SHADOW",
          visible: true,
          offset: { x: 0, y: 2 },
          radius: 4,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.25 },
        },
      ],
    } as unknown as EffectStyle;
    expect(effectStyleToShadowToken(style)).toEqual({
      $type: "shadow",
      $value: {
        color: rgbToHex8({ r: 0, g: 0, b: 0, a: 0.25 }),
        offsetX: "0px",
        offsetY: "2px",
        blur: "4px",
        spread: "0px",
        inset: false,
      },
    });
  });

  it("maps stacked shadows to an array (inner → inset) and skips blur-only styles", () => {
    const stacked = {
      name: "Elevation/High",
      effects: [
        { type: "DROP_SHADOW", visible: true, offset: { x: 0, y: 1 }, radius: 2, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.2 } },
        { type: "INNER_SHADOW", visible: true, offset: { x: 0, y: 0 }, radius: 1, spread: 1, color: { r: 0, g: 0, b: 0, a: 0.3 } },
      ],
    } as unknown as EffectStyle;
    const token = effectStyleToShadowToken(stacked) as DscgToken;
    const value = token.$value as Array<{ inset: boolean }>;
    expect(Array.isArray(value)).toBe(true);
    expect(value[1].inset).toBe(true);

    const blurOnly = {
      name: "Blur",
      effects: [{ type: "LAYER_BLUR", visible: true, radius: 4 }],
    } as unknown as EffectStyle;
    expect(effectStyleToShadowToken(blurOnly)).toBeNull();
  });
});

describe("exportToDSCG — local styles", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it('adds a "Styles" set (typography/color/shadow), nested by name, in tokenSetOrder', async () => {
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: async () => [],
        getVariableByIdAsync: async () => null,
      },
      getLocalTextStylesAsync: async () => [
        { name: "Heading/H1", fontName: { family: "Inter", style: "Bold" }, fontSize: 32, lineHeight: { unit: "PERCENT", value: 120 }, letterSpacing: { unit: "PIXELS", value: 0 }, textCase: "ORIGINAL", textDecoration: "NONE", paragraphSpacing: 0 },
      ],
      getLocalPaintStylesAsync: async () => [
        { name: "Brand/Primary", paints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 }, opacity: 1, visible: true }] },
      ],
      getLocalEffectStylesAsync: async () => [
        { name: "Elevation/Low", effects: [{ type: "DROP_SHADOW", visible: true, offset: { x: 0, y: 2 }, radius: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }] },
      ],
      getLocalGridStylesAsync: async () => [],
    };

    const result = JSON.parse((await exportToDSCG()) as string);

    expect(result.Styles.typography.Heading.H1.$type).toBe("typography");
    expect(result.Styles.color.Brand.Primary).toEqual({ $type: "color", $value: "#0000ff" });
    expect(result.Styles.shadow.Elevation.Low.$type).toBe("shadow");
    expect(result.$metadata.tokenSetOrder).toContain("Styles");
  });

  it('omits the "Styles" set when no style kind is selected', async () => {
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: async () => [],
        getVariableByIdAsync: async () => null,
      },
      getLocalTextStylesAsync: async () => [
        { name: "Body", fontName: { family: "Inter", style: "Regular" }, fontSize: 16, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PIXELS", value: 0 }, textCase: "ORIGINAL", textDecoration: "NONE", paragraphSpacing: 0 },
      ],
      getLocalPaintStylesAsync: async () => [],
      getLocalEffectStylesAsync: async () => [],
      getLocalGridStylesAsync: async () => [],
    };

    const result = JSON.parse(
      (await exportToDSCG(undefined, { text: false, paint: false, effect: false, grid: false })) as string
    );
    expect(result.Styles).toBeUndefined();
    expect(result.$metadata.tokenSetOrder).not.toContain("Styles");
  });
});

describe("exportToDSCG (end-to-end with a Figma mock)", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("matches the DTCG leaf shape — every leaf is exactly [$extensions, $type, $value]", async () => {
    (globalThis as any).figma = makeFigmaMock();

    const result = JSON.parse((await exportToDSCG()) as string);
    const leafKeySets = collectLeafKeySets({
      ...result,
      $themes: undefined,
      $metadata: undefined,
    });

    expect(leafKeySets.length).toBeGreaterThan(0);
    for (const keys of leafKeySets) {
      expect(keys).toEqual(["$extensions", "$type", "$value"]);
    }
  });

  it("emits $extensions (scopes when set + hiddenFromPublishing), mapped types, hex/hex8 colors and {refs}", async () => {
    (globalThis as any).figma = makeFigmaMock();

    const result = JSON.parse((await exportToDSCG()) as string);

    // empty scopes -> only hiddenFromPublishing
    expect(result["Colour Primitives/Light"].Grayscale.White).toEqual({
      $extensions: { "com.figma.hiddenFromPublishing": false },
      $type: "color",
      $value: "#ffffff",
    });
    // non-empty scopes -> scopes first, then hiddenFromPublishing; alpha -> hex8
    expect(result["Colour Primitives/Light"].Gradient.Blue.XS).toEqual({
      $extensions: {
        "com.figma.scopes": ["EFFECT_COLOR"],
        "com.figma.hiddenFromPublishing": false,
      },
      $type: "color",
      $value: "#bfcdf4cc",
    });
    // alias -> {ref}
    expect(result["Colour Usage/Mode 1"].Background.Brand.Bold_01).toEqual({
      $extensions: {
        "com.figma.scopes": ["FRAME_FILL", "SHAPE_FILL"],
        "com.figma.hiddenFromPublishing": false,
      },
      $type: "color",
      $value: "{Brand.500 - P}",
    });
    // number
    expect(result["Space/Mode 1"]["sp-0"]).toEqual({
      $extensions: {
        "com.figma.scopes": ["GAP", "LINE_HEIGHT"],
        "com.figma.hiddenFromPublishing": false,
      },
      $type: "number",
      $value: 0,
    });
    // string
    expect(result["Typography Primitives/Mode 1"].Weight.Regular).toEqual({
      $extensions: {
        "com.figma.scopes": ["ALL_SCOPES"],
        "com.figma.hiddenFromPublishing": false,
      },
      $type: "text",
      $value: "Regular",
    });
  });

  it("emits one token set per collection/mode plus $themes and $metadata.tokenSetOrder", async () => {
    (globalThis as any).figma = makeFigmaMock();

    const result = JSON.parse((await exportToDSCG()) as string);
    const setNames = Object.keys(result).filter(
      (k) => k !== "$themes" && k !== "$metadata"
    );

    expect(setNames).toEqual([
      "Colour Primitives/Light",
      "Colour Primitives/Dark",
      "Colour Usage/Mode 1",
      "Space/Mode 1",
      "Typography Primitives/Mode 1",
    ]);
    expect(result.$themes).toEqual([]);
    expect(result.$metadata.tokenSetOrder).toEqual(setNames);
  });
});
