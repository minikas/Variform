import { describe, it, expect, afterEach } from "vitest";
import {
  tailwindPresetKey,
  tokenPath,
  exportToTailwindPreset,
} from "./collectionToTailwindPreset";

/* ----------------------------- pure functions ---------------------------- */

describe("tailwindPresetKey", () => {
  it("maps categories to v3 theme keys", () => {
    expect(tailwindPresetKey("Colors/Blue/500", "COLOR")).toBe("colors");
    expect(tailwindPresetKey("Spacing/4", "FLOAT")).toBe("spacing");
    expect(tailwindPresetKey("Radius/SM", "FLOAT")).toBe("borderRadius");
    expect(tailwindPresetKey("Font Family/Sans", "STRING")).toBe("fontFamily");
    expect(tailwindPresetKey("Weight/Bold", "FLOAT")).toBe("fontWeight");
    expect(tailwindPresetKey("Line/Tight", "FLOAT")).toBe("lineHeight");
    expect(tailwindPresetKey("Shadow/SM", "STRING")).toBe("boxShadow");
    expect(tailwindPresetKey("Opacity/50", "FLOAT")).toBe("opacity");
    expect(tailwindPresetKey("Duration/Fast", "FLOAT")).toBe("transitionDuration");
  });

  it("falls back by resolved type for unrecognized names", () => {
    expect(tailwindPresetKey("Foo/Bar", "COLOR")).toBe("colors");
    expect(tailwindPresetKey("Foo/Bar", "FLOAT")).toBe("spacing");
    expect(tailwindPresetKey("Foo/Bar", "STRING")).toBe("other");
  });
});

describe("tokenPath", () => {
  it("drops a leading segment that repeats the category", () => {
    expect(tokenPath("Colors/Blue/500", "color")).toEqual(["blue", "500"]);
    expect(tokenPath("Spacing/4", "spacing")).toEqual(["4"]);
  });

  it("keeps unrelated leading segments", () => {
    expect(tokenPath("Blue/500", "color")).toEqual(["blue", "500"]);
  });

  it("prepends the sanitized prefix to the family segment", () => {
    expect(tokenPath("Colors/Blue/500", "color", "Acme Co")).toEqual(["acme-co-blue", "500"]);
  });
});

/* ------------------------- end-to-end with a mock ------------------------ */

function makeFigmaMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["blue500", "spacing4", "weightBold", "familySans", "radiusSm"],
  };
  const tokens = {
    id: "c2",
    name: "Tokens",
    modes: [
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ],
    variableIds: ["bgPrimary", "surfaceCard", "overlayDim", "broken"],
  };

  const vars: Record<string, any> = {
    blue500: {
      name: "Colors/Blue/500",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
    },
    spacing4: {
      name: "Spacing/4",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { M1: 16 },
    },
    weightBold: {
      name: "Weight/Bold",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { M1: 700 },
    },
    familySans: {
      name: "Font Family/Sans",
      resolvedType: "STRING",
      variableCollectionId: "c1",
      valuesByMode: { M1: "Inter" },
    },
    radiusSm: {
      name: "Radius/SM",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { M1: 4 },
    },
    bgPrimary: {
      name: "Background/Primary",
      resolvedType: "COLOR",
      variableCollectionId: "c2",
      valuesByMode: {
        L: { type: "VARIABLE_ALIAS", id: "blue500" },
        D: { type: "VARIABLE_ALIAS", id: "blue500" },
      },
    },
    surfaceCard: {
      name: "Surface/Card",
      resolvedType: "COLOR",
      variableCollectionId: "c2",
      valuesByMode: {
        L: { r: 1, g: 1, b: 1, a: 1 },
        D: { r: 0, g: 0, b: 0, a: 1 },
      },
    },
    broken: {
      name: "Background/Broken",
      resolvedType: "COLOR",
      variableCollectionId: "c2",
      valuesByMode: { L: { type: "VARIABLE_ALIAS", id: "missing" } },
    },
    overlayDim: {
      name: "Overlay/Dim",
      resolvedType: "COLOR",
      variableCollectionId: "c2",
      valuesByMode: {
        L: { r: 0, g: 0, b: 0, a: 0.5 },
        D: { r: 0, g: 0, b: 0, a: 0.5 },
      },
    },
  };

  const collections: Record<string, any> = { c1: primitives, c2: tokens };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [primitives, tokens],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections[id] ?? null,
    },
  };
}

describe("exportToTailwindPreset (end-to-end with a Figma mock)", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("nests tokens under v3 theme keys inside theme.extend", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset();

    expect(result).toContain("module.exports = {");
    expect(result).toContain("theme: {");
    expect(result).toContain("extend: {");
    expect(result).toContain("colors: {");
    // Unquoted identifier keys, quoted kebab/numeric keys.
    expect(result).toContain("blue: {");
    expect(result).toContain('"500": "rgb(from var(--color-colors--blue--500, #0000ff) r g b / <alpha-value>)"');
    expect(result).toContain('"4": "16px"');
    expect(result).toContain("bold: 700");
    expect(result).toContain('sans: "Inter"');
    expect(result).toContain('"4px"');
  });

  it("keeps translucent colors concrete (their alpha is already baked in)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset();

    expect(result).toContain('dim: "rgb(0 0 0 / 0.5)"');
  });

  it("resolves aliases to concrete values and skips broken ones", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset();

    expect(result).toContain('primary: "rgb(from var(--color-colors--blue--500, #0000ff) r g b / <alpha-value>)"');
    expect(result).not.toContain("broken");
    expect(result).not.toContain("VARIABLE_ALIAS");
  });

  it("uses the first selected mode of each collection", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset({ c2: ["D"] });

    expect(result).toContain('card: "rgb(from var(--color-surface--card, #000000) r g b / <alpha-value>)"');
    expect(result).not.toContain('card: "rgb(from var(--color-surface--card, #ffffff) r g b / <alpha-value>)"');
  });

  it("respects the selection (skips unselected collections)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset({ c1: ["M1"] });

    expect(result).toContain('"500": "rgb(from var(--color-colors--blue--500, #0000ff) r g b / <alpha-value>)"');
    expect(result).not.toContain("background");
    expect(result).not.toContain("surface");
  });

  it("applies the prefix to the token family segment and notes it in the header", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset(undefined, "acme");

    expect(result).toContain('"acme-blue": {');
    expect(result).toContain('"acme-4": "16px"');
    expect(result).toContain("var(--color-acme-colors--blue--500, #0000ff)");
    expect(result).toContain('Prefix: "acme"');
  });

  it("converts lengths to the chosen unit", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset(undefined, "", "rem");

    expect(result).toContain('"4": "1rem"');
    expect(result).toContain('"0.25rem"');  // Radius/SM = 4px
    expect(result).toContain("bold: 700");   // unitless keys stay numbers
    expect(result).toContain('Unit: rem');
  });

  it("emits bare var() colors in 'var' color mode", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset(undefined, "", "px", "var");

    expect(result).toContain('"500": "var(--color-colors--blue--500)"');
    expect(result).not.toContain("<alpha-value>");
  });

  it("emits concrete rgb() colors in 'concrete' color mode", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset(undefined, "", "px", "concrete");

    expect(result).toContain('"500": "rgb(0 0 255 / 1)"');
    expect(result).not.toContain("var(--color-");
  });

  it("emits plain hex colors in 'hex' color mode (hex8 with alpha)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset(undefined, "", "px", "hex");

    expect(result).toContain('"500": "#0000ff"');
    expect(result).toContain('dim: "#00000080"');  // translucent → hex8
    expect(result).not.toContain("var(--color-");
  });

  it("generates a valid JS module that evaluates to the preset object", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset();

    // The Figma plugin runtime statically rejects anything resembling a
    // dynamic import expression, even inside a string.
    expect(result).not.toContain("import" + "(");

    const mod = { exports: {} as any };
    new Function("module", "exports", result)(mod, mod.exports);
    expect(mod.exports.theme.extend.colors.blue["500"]).toBe(
      "rgb(from var(--color-colors--blue--500, #0000ff) r g b / <alpha-value>)"
    );
    expect(mod.exports.theme.extend.spacing["4"]).toBe("16px");
    expect(mod.exports.theme.extend.fontWeight.weight.bold).toBe(700);
  });
});
