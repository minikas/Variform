import { describe, it, expect, afterEach, vi } from "vitest";
import {
  tailwindPresetKey,
  tokenPath,
  setNestedPath,
  collectThemedTokens,
  exportToTailwindPreset,
} from "./collectionToTailwindPreset";

/* ------------------------------ setNestedPath ---------------------------- */

describe("setNestedPath", () => {
  it("creates own properties for __proto__ segments without polluting Object.prototype", () => {
    const root: Record<string, any> = {};
    setNestedPath(root, ["colors", "__proto__", "polluted"], "yes");

    expect((Object.prototype as any).polluted).toBeUndefined();
    expect(JSON.stringify(root)).toBe('{"colors":{"__proto__":{"polluted":"yes"}}}');
  });

  it("never reuses the inherited constructor/prototype nodes", () => {
    const root: Record<string, any> = {};
    setNestedPath(root, ["constructor", "x"], 1);
    setNestedPath(root, ["a", "prototype", "y"], 2);

    expect(JSON.stringify(root)).toBe('{"constructor":{"x":1},"a":{"prototype":{"y":2}}}');
    expect((Object as any).x).toBeUndefined();
  });

  it("replaces a leaf when a longer path needs a group at the same key", () => {
    const root: Record<string, any> = {};
    setNestedPath(root, ["a"], "leaf");
    setNestedPath(root, ["a", "b"], 2);

    expect(JSON.stringify(root)).toBe('{"a":{"b":2}}');
  });
});

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
    variableIds: ["blue500", "spacing4", "weightBold", "familySans", "radiusSm", "lineTight", "flagOn"],
  };
  const tokens = {
    id: "c2",
    name: "Tokens",
    modes: [
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ],
    variableIds: ["bgPrimary", "surfaceCard", "overlayDim", "broken", "accentRef", "lightOnly"],
  };
  // Modes deliberately differ in case from the Tokens collection ("Dark" vs
  // "DARK") to exercise case-insensitive mode matching through aliases.
  const accents = {
    id: "c3",
    name: "Accents",
    modes: [
      { name: "light", modeId: "l3" },
      { name: "DARK", modeId: "d3" },
    ],
    variableIds: ["accent"],
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
    lineTight: {
      name: "Line/Tight",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { M1: 24 },
    },
    flagOn: {
      name: "Flag/On",
      resolvedType: "BOOLEAN",
      variableCollectionId: "c1",
      valuesByMode: { M1: true },
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
    accentRef: {
      name: "Accent/Ref",
      resolvedType: "COLOR",
      variableCollectionId: "c2",
      valuesByMode: {
        L: { type: "VARIABLE_ALIAS", id: "accent" },
        D: { type: "VARIABLE_ALIAS", id: "accent" },
      },
    },
    lightOnly: {
      name: "Light/Only",
      resolvedType: "COLOR",
      variableCollectionId: "c2",
      valuesByMode: { L: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },  // no Dark value
    },
    accent: {
      name: "Accent/Main",
      resolvedType: "COLOR",
      variableCollectionId: "c3",
      valuesByMode: {
        l3: { r: 1, g: 0, b: 0, a: 1 },
        d3: { r: 0, g: 1, b: 0, a: 1 },
      },
    },
  };

  const collections: Record<string, any> = { c1: primitives, c2: tokens, c3: accents };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [primitives, tokens, accents],
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

  it("treats line-height as a length (Figma line-heights are px, not multipliers)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const px = await exportToTailwindPreset();
    expect(px).toContain('tight: "24px"');

    const rem = await exportToTailwindPreset(undefined, "", "rem");
    expect(rem).toContain('tight: "1.5rem"');
  });

  it("emits real booleans (not the strings \"true\"/\"false\")", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwindPreset();

    expect(result).toContain("on: true");
    expect(result).not.toContain('on: "true"');

    const mod = { exports: {} as any };
    new Function("module", "exports", result)(mod, mod.exports);
    expect(mod.exports.theme.extend.other.flag.on).toBe(true);
  });

  it("warns when two collections collide on the same category+path", async () => {
    const dup = {
      name: "Colors/Blue/500",
      resolvedType: "COLOR",
      variableCollectionId: "cX",
      valuesByMode: { MX: { r: 1, g: 0, b: 0, a: 1 } },
    };
    const collision = { id: "cX", name: "Collision", modes: [{ name: "Mode 1", modeId: "MX" }], variableIds: ["dup"] };
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: async () => [
          { id: "c1", name: "A", modes: [{ name: "Mode 1", modeId: "M1" }], variableIds: ["base"] },
          collision,
        ],
        getVariableByIdAsync: async (id: string) => ({
          base: { name: "Colors/Blue/500", resolvedType: "COLOR", variableCollectionId: "c1", valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } } },
          dup,
        } as Record<string, any>)[id] ?? null,
        getVariableCollectionByIdAsync: async () => null,
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await exportToTailwindPreset();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("colors.blue.500"));
      // The later collection still wins (previous behavior kept, now loud).
      expect(result).toContain("#ff0000");
    } finally {
      warn.mockRestore();
    }
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

describe("collectThemedTokens (mode matching and fallbacks)", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  const selectAll = { c1: ["M1"], c2: ["L", "D"], c3: ["l3", "d3"] };

  it("resolves aliases through case-insensitive mode-name matching", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const { defaultTokens, extraThemes } = await collectThemedTokens(selectAll);

    const defaultRef = defaultTokens.find((token) => token.path.join("/") === "accent/ref");
    expect(defaultRef?.value).toEqual({ r: 1, g: 0, b: 0, a: 1 });  // "Light" → "light"

    const dark = extraThemes.find((theme) => theme.mode === "Dark");
    const darkRef = dark?.tokens.find((token) => token.path.join("/") === "accent/ref");
    expect(darkRef?.value).toEqual({ r: 0, g: 1, b: 0, a: 1 });  // "Dark" → "DARK"
  });

  it("falls back to the default mode value when a variable has none for the theme mode", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const { extraThemes } = await collectThemedTokens(selectAll);

    const dark = extraThemes.find((theme) => theme.mode === "Dark");
    const lightOnly = dark?.tokens.find((token) => token.path.join("/") === "light/only");
    expect(lightOnly?.value).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  });

  it("skips variables that have no value in any mode", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const { extraThemes } = await collectThemedTokens(selectAll);

    const dark = extraThemes.find((theme) => theme.mode === "Dark");
    expect(dark?.tokens.some((token) => token.path.join("/") === "background/broken")).toBe(false);
  });
});
