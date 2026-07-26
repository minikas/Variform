import { describe, it, expect, afterEach, vi } from "vitest";
import * as sass from "sass";
import { exportToSCSS } from "./collectionToSCSS";

function makeFigmaMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ],
    variableIds: ["blue500", "spacing4", "weightBold", "familySans", "bgPrimary", "tricky"],
  };

  const vars: Record<string, any> = {
    blue500: {
      name: "Colors/Blue/500",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: {
        L: { r: 0, g: 0, b: 1, a: 1 },
        D: { r: 0, g: 17 / 255, b: 51 / 255, a: 1 },
      },
    },
    spacing4: {
      name: "Spacing/4",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { L: 16, D: 16 },
    },
    weightBold: {
      name: "Weight/Bold",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { L: 700, D: 700 },
    },
    familySans: {
      name: "Font Family/Sans",
      resolvedType: "STRING",
      variableCollectionId: "c1",
      valuesByMode: { L: "Inter", D: "Inter" },
    },
    bgPrimary: {
      name: "Background/Primary",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: {
        L: { type: "VARIABLE_ALIAS", id: "blue500" },
        D: { type: "VARIABLE_ALIAS", id: "blue500" },
      },
    },
    tricky: {
      name: "Content/Tricky",
      resolvedType: "STRING",
      variableCollectionId: "c1",
      valuesByMode: {
        L: 'say "hi" // not a comment',
        D: 'say "hi" // not a comment',
      },
    },
  };

  const collections: Record<string, any> = { c1: primitives };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [primitives],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections[id] ?? null,
    },
  };
}

/** Collections/variables whose string values contain `#{...}` interpolation. */
function makeInterpolationMock() {
  const collection = {
    id: "c1",
    name: "Content",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["interp", "sum"],
  };

  const vars: Record<string, any> = {
    interp: {
      name: "Content/Interp",
      resolvedType: "STRING",
      variableCollectionId: "c1",
      valuesByMode: { M1: "#{$accent}" },
    },
    sum: {
      name: "Content/Sum",
      resolvedType: "STRING",
      variableCollectionId: "c1",
      valuesByMode: { M1: "sum: #{1+2}" },
    },
  };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => (id === "c1" ? collection : null),
    },
  };
}

/** Variables with characters that are invalid in an SCSS identifier. */
function makeSpecialNamesMock() {
  const collection = {
    id: "c1",
    name: "Primitives",
    modes: [
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ],
    variableIds: ["compact", "price", "quoted"],
  };

  const vars: Record<string, any> = {
    compact: {
      name: "Spacing/4 (compact)",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { L: 16, D: 8 },
    },
    price: {
      name: "Content/$price",
      resolvedType: "STRING",
      variableCollectionId: "c1",
      valuesByMode: { L: "10", D: "10" },
    },
    quoted: {
      name: 'Colors/Weird "Quoted"',
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: {
        L: { r: 1, g: 0, b: 0, a: 1 },
        D: { r: 0.5, g: 0, b: 0, a: 1 },
      },
    },
  };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => (id === "c1" ? collection : null),
    },
  };
}

/** Two collections defining homonymous variables (same exported name). */
function makeCollisionMock() {
  const c1 = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["blueA"],
  };
  const c2 = {
    id: "c2",
    name: "Semantics",
    modes: [{ name: "Mode 1", modeId: "M2" }],
    variableIds: ["blueB"],
  };

  const vars: Record<string, any> = {
    blueA: {
      name: "Colors/Blue/500",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
    },
    blueB: {
      name: "Colors/Blue/500",
      resolvedType: "COLOR",
      variableCollectionId: "c2",
      valuesByMode: { M2: { r: 1, g: 0, b: 0, a: 1 } },
    },
  };

  const collections: Record<string, any> = { c1, c2 };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [c1, c2],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections[id] ?? null,
    },
  };
}

describe("exportToSCSS", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("emits one kebab-case SCSS variable per token with the default (Light) values", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS();

    expect(result).toContain("$colors-blue-500: #0000ff;");
    expect(result).toContain("$spacing-4: 16px;");
    expect(result).toContain("$font-weight-weight-bold: 700;");
    expect(result).toContain('$font-family-sans: "Inter";');
  });

  it("resolves aliases to concrete values", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS();

    expect(result).toContain("$colors-background-primary: #0000ff;");
    expect(result).not.toContain("VARIABLE_ALIAS");
  });

  it("documents modes, prefix and themes in the header comment", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS(undefined, "acme");

    expect(result).toContain("// Modes: Primitives → Light");
    expect(result).toContain('// Prefix: "acme"');
    expect(result).toContain("// Themes: dark");
    expect(result).toContain("$colors-acme-blue-500: #0000ff;");
    expect(result).toContain("$spacing-acme-4: 16px;");
  });

  it("documents map.get consumption and the static-export theme-switching gap", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS();

    // Per https://sass-lang.com/documentation/values/maps/ maps are consumed
    // with map.get after `@use "sass:map"`; the header must say so.
    expect(result).toContain('map.get($theme-dark, "<name>")');
    expect(result).toContain('@use "sass:map"');
    // A static file cannot switch themes at runtime — the gap is documented.
    expect(result).toContain("@media (prefers-color-scheme: dark)");
  });

  it("emits a theme map consumable via map.get per the Sass docs", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS();

    const css = sass.compileString(
      `@use "sass:map";\n${result}\n.dark { color: map.get($theme-dark, "colors-blue-500"); }`
    ).css;

    expect(css).toContain("color: #001133");
  });

  it("emits a $theme-<mode> map per extra selected mode with that mode's values", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS();

    expect(result).toContain("$theme-dark: (");
    expect(result).toContain('"colors-blue-500": #001133,');
    expect(result).toContain('"spacing-4": 16px,');
    // Alias inside the theme resolves to the dark terminal value.
    expect(result).toContain('"colors-background-primary": #001133,');
  });

  it("emits no $theme- map when a single mode is selected", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS({ c1: ["L"] });

    expect(result).toContain("$colors-blue-500: #0000ff;");
    expect(result).not.toContain("$theme-");
    expect(result).not.toContain("// Themes:");
  });

  it("quotes string values so spaces, quotes and // cannot break the syntax", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS();

    expect(result).toContain('$other-content-tricky: "say \\"hi\\" // not a comment";');
    expect(result).toContain('"other-content-tricky": "say \\"hi\\" // not a comment",');
  });

  it("generates output that compiles with Dart Sass", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS(undefined, "acme");

    expect(() => sass.compileString(result)).not.toThrow();
  });

  it("never emits an import expression (rejected by the Figma runtime)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToSCSS(undefined, "acme");

    expect(result).not.toContain("imp" + "ort(");
  });

  it("escapes #{...} in string values so Sass cannot interpolate them", async () => {
    (globalThis as any).figma = makeInterpolationMock();
    const result = await exportToSCSS();

    expect(result).toContain('$other-content-interp: "\\#{$accent}";');
    // Compiles with the real Dart Sass and the value survives literally:
    // no "Undefined variable" error and no silent rewrite to "sum: 3".
    const css = sass.compileString(
      `${result}\n.check { a: $other-content-interp; b: $other-content-sum; }`
    ).css;
    expect(css).toContain('"#{$accent}"');
    expect(css).toContain('"sum: #{1+2}"');
  });

  it("sanitizes characters invalid in SCSS identifiers out of variable names", async () => {
    (globalThis as any).figma = makeSpecialNamesMock();
    const result = await exportToSCSS();

    expect(result).toContain("$spacing-4-compact: 16px;");
    expect(result).toContain('$other-content-price: "10";');
    expect(result).not.toContain("(compact)");
    expect(result).toContain("$colors-weird-quoted: #ff0000;");
    expect(() => sass.compileString(result)).not.toThrow();
  });

  it("escapes theme map keys so quotes cannot corrupt them", async () => {
    (globalThis as any).figma = makeSpecialNamesMock();
    const result = await exportToSCSS();

    expect(result).toContain('"colors-weird-quoted": #800000,');
    expect(result).not.toContain('"colors-weird-"quoted""');
    const css = sass.compileString(
      `@use "sass:map";\n${result}\n.dark { color: map.get($theme-dark, "colors-weird-quoted"); }`
    ).css;
    expect(css).toContain("color: #800000");
  });

  it("warns and skips homonymous variables instead of silently overwriting", async () => {
    (globalThis as any).figma = makeCollisionMock();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await exportToSCSS();

      // One declaration only, and the first collection's value wins.
      expect(result.match(/\$colors-blue-500:/g)).toHaveLength(1);
      expect(result).toContain("$colors-blue-500: #0000ff;");
      expect(result).not.toContain("#ff0000");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("$colors-blue-500"));
      expect(() => sass.compileString(result)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});
