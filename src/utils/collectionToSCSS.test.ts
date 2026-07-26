import { describe, it, expect, afterEach } from "vitest";
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
});
