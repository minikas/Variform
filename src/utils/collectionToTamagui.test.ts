import { describe, it, expect, afterEach, vi } from "vitest";
import { exportToTamagui } from "./collectionToTamagui";

const hex = (r: number, g: number, b: number) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 });

/** Builds a figma.variables mock from a collection list + variable map. */
function makeFigmaMockFrom(collectionList: any[], vars: Record<string, any>) {
  const collections = Object.fromEntries(collectionList.map((collection) => [collection.id, collection]));
  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => collectionList,
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections[id] ?? null,
    },
  };
}

/**
 * Asserts the generated module parses as JS (import/exports and `as const`
 * stripped) and has no duplicate theme names in the `themes` object.
 */
function expectValidModule(result: string) {
  const js = result
    .replace(/^import .*$/gm, "")
    .replace(/^export /gm, "")
    .replace(/ as const/g, "");
  expect(() => new Function("createTokens", js)).not.toThrow();
  const themeNames = [...result.slice(result.indexOf("export const themes")).matchAll(/^ {2}(\w+|"[^"]+"):/gm)].map((m) => m[1]);
  expect(new Set(themeNames).size).toBe(themeNames.length);
}

function makeFigmaMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ],
    variableIds: ["blue500", "spacing4", "familySans", "bgPrimary"],
  };

  const vars: Record<string, any> = {
    blue500: {
      name: "Colors/Blue/500",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: {
        L: { r: 0, g: 0, b: 1, a: 1 },          // #0000ff
        D: { r: 0, g: 17 / 255, b: 0.2, a: 1 }, // #001133
      },
    },
    spacing4: {
      name: "Spacing/4",
      resolvedType: "FLOAT",
      variableCollectionId: "c1",
      valuesByMode: { L: 16, D: 16 },
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

describe("exportToTamagui", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
    vi.restoreAllMocks();
  });

  it("wraps the groups in createTokens with the tamagui import", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    expect(result).toContain('import { createTokens } from "tamagui";');
    expect(result).toContain("export const tokens = createTokens({");
  });

  it("maps categories to Tamagui groups (colors→color, spacing→space)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    expect(result).toContain("color: {");
    expect(result).toContain("space: {");
    // Non-mapped categories keep their own name.
    expect(result).toContain("fontFamily: {");
    expect(result).not.toContain("colors: {");
    expect(result).not.toContain("spacing: {");
  });

  it("uses the first selected mode (Light) for the base token values", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    const tokensConfig = result.slice(result.indexOf("createTokens({"), result.indexOf("export const themes"));
    expect(tokensConfig).toContain('blue500: "#0000ff"');
    // The dark value only appears as a mode-suffixed variant token.
    expect(tokensConfig).toContain('blue500Dark: "#001133"');
    expect(tokensConfig).not.toContain('blue500: "#001133"');
  });

  it("flattens token paths into camelCase keys, quoting numeric keys", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    expect(result).toContain('blue500: "#0000ff"');
    expect(result).toContain('"4": 16');
    expect(result).toContain('sans: "Inter"');
  });

  it("emits FLOATs as raw numbers, never with a px unit", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    expect(result).toContain('"4": 16');
    expect(result).not.toContain("px");
  });

  it("emits light (default) and dark themes that reference tokens, per the Tamagui docs", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    expect(result).toContain("export const themes = {");
    expect(result).toContain("} as const;");
    expect(result).toContain("light: {");
    expect(result).toContain("dark: {");

    const lightTheme = result.slice(result.indexOf("light: {"), result.indexOf("dark: {"));
    const darkTheme = result.slice(result.indexOf("dark: {"));
    // Docs (tamagui.dev/docs/intro/themes): themes share values from tokens
    // down to themes via JS references, e.g. background: tokens.color.black.
    expect(lightTheme).toContain("blue500: tokens.color.blue500");
    expect(lightTheme).toContain('"4": tokens.space["4"]');
    expect(lightTheme).toContain("sans: tokens.fontFamily.sans");
    expect(darkTheme).toContain("blue500: tokens.color.blue500Dark");
    // Values identical across modes reference the same base token —
    // no redundant variant tokens are created for them.
    expect(darkTheme).toContain('"4": tokens.space["4"]');
    expect(darkTheme).toContain("sans: tokens.fontFamily.sans");
    expect(result).not.toContain('"4Dark"');
    expect(result).not.toContain("sansDark");
    // Themes never repeat raw values that live in the tokens config.
    expect(lightTheme).not.toContain("#0000ff");
    expect(darkTheme).not.toContain("#001133");
    // The header documents the convention and how to wire the themes up.
    expect(result).toContain("https://tamagui.dev/docs/intro/themes");
    expect(result).toContain(" * Themes: light, dark");
    expect(result).toContain("createTamagui({ tokens, themes })");
  });

  it("emits per-mode values as mode-suffixed tokens (the docs' gray2Dark pattern)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    const tokensConfig = result.slice(result.indexOf("createTokens({"), result.indexOf("export const themes"));
    // Only values that actually change in dark mode get a variant token.
    expect(tokensConfig).toContain('blue500Dark: "#001133"');
    expect(tokensConfig).toContain('backgroundPrimaryDark: "#001133"');
    expect(tokensConfig).not.toContain('"4Dark"');
    expect(tokensConfig).not.toContain("sansDark");
  });

  it("resolves aliases per theme (dark alias → dark variant token)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    const tokensConfig = result.slice(result.indexOf("createTokens({"), result.indexOf("export const themes"));
    const lightTheme = result.slice(result.indexOf("light: {"), result.indexOf("dark: {"));
    const darkTheme = result.slice(result.indexOf("dark: {"));
    expect(tokensConfig).toContain('backgroundPrimary: "#0000ff"');
    expect(tokensConfig).toContain('backgroundPrimaryDark: "#001133"');
    expect(lightTheme).toContain("backgroundPrimary: tokens.color.backgroundPrimary");
    expect(darkTheme).toContain("backgroundPrimary: tokens.color.backgroundPrimaryDark");
    expect(result).not.toContain("VARIABLE_ALIAS");
  });

  it("still emits themes with just the default entry for a single-mode selection", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui({ c1: ["L"] });

    expect(result).toContain("export const tokens = createTokens({");
    expect(result).toContain("export const themes = {");
    expect(result).toContain("light: {");
    expect(result).toContain('blue500: "#0000ff"');
    expect(result).toContain("blue500: tokens.color.blue500");
    expect(result).not.toContain("dark: {");
    // No mode-suffixed variant tokens without an extra mode.
    const tokensConfig = result.slice(result.indexOf("createTokens({"), result.indexOf("export const themes"));
    expect(tokensConfig).not.toContain("blue500Dark");
    expect(result).toContain(" * Themes: light —");
  });

  it("prepends the prefix to the token family segment", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui(undefined, "acme");

    expect(result).toContain('acmeBlue500: "#0000ff"');
    expect(result).toContain("acmeBlue500: tokens.color.acmeBlue500");
    expect(result).toContain('Prefix: "acme"');
  });

  it("never emits the forbidden dynamic-import sequence", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTamagui();

    expect(result).not.toContain("import" + "(");
  });

  it("never overwrites the default theme when mode orders are swapped across collections", async () => {
    (globalThis as any).figma = makeFigmaMockFrom(
      [
        {
          id: "c1",
          name: "Primitives",
          modes: [
            { name: "Light", modeId: "L" },
            { name: "Dark", modeId: "D" },
          ],
          variableIds: ["blue500"],
        },
        {
          id: "c2",
          name: "Semantic",
          modes: [
            { name: "Dark", modeId: "D2" },
            { name: "Light", modeId: "L2" },
          ],
          variableIds: ["surface"],
        },
      ],
      {
        blue500: {
          name: "Colors/Blue/500",
          resolvedType: "COLOR",
          variableCollectionId: "c1",
          valuesByMode: { L: hex(0, 0, 255), D: hex(0, 17, 51) },
        },
        surface: {
          name: "Colors/Surface",
          resolvedType: "COLOR",
          variableCollectionId: "c2",
          valuesByMode: { D2: hex(17, 17, 17), L2: hex(238, 238, 238) },
        },
      }
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await exportToTamagui();

    // The documented default combination — "first selected mode of each
    // collection" (c1 Light + c2 Dark) — stays in the output under "light".
    expect(result).toContain("light: {");
    const lightTheme = result.slice(result.indexOf("light: {"), result.indexOf("dark: {"));
    expect(lightTheme).toContain("blue500: tokens.color.blue500");
    expect(lightTheme).toContain("surface: tokens.color.surface");
    const tokensConfig = result.slice(result.indexOf("createTokens({"), result.indexOf("export const themes"));
    expect(tokensConfig).toContain('blue500: "#0000ff"');
    expect(tokensConfig).toContain('surface: "#111111"');
    // The extra "Light" mode (from c2) collides with the default key: it is
    // suffixed instead of overwriting the default theme.
    expect(result).toContain("light2: {");
    expect(tokensConfig).toContain('surfaceLight2: "#eeeeee"');
    expect(result).toContain("surface: tokens.color.surfaceLight2");
    expect(result).toContain(" * Themes: light, dark, light2");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"light2"'));
    expectValidModule(result);
  });

  it("dedupes modes that collide after camelCase normalization", async () => {
    (globalThis as any).figma = makeFigmaMockFrom(
      [
        {
          id: "c1",
          name: "Primitives",
          modes: [
            { name: "Light", modeId: "L" },
            { name: "Dark Mode", modeId: "DM" },
            { name: "dark-mode", modeId: "dm" },
          ],
          variableIds: ["blue500"],
        },
      ],
      {
        blue500: {
          name: "Colors/Blue/500",
          resolvedType: "COLOR",
          variableCollectionId: "c1",
          valuesByMode: { L: hex(0, 0, 255), DM: hex(0, 17, 51), dm: hex(17, 34, 51) },
        },
      }
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await exportToTamagui();

    // "Dark Mode" and "dark-mode" both normalize to darkMode — the second
    // gets a numeric suffix, and its variant tokens follow the suffix.
    expect(result).toContain("darkMode: {");
    expect(result).toContain("darkMode2: {");
    const tokensConfig = result.slice(result.indexOf("createTokens({"), result.indexOf("export const themes"));
    expect(tokensConfig).toContain('blue500DarkMode: "#001133"');
    expect(tokensConfig).toContain('blue500DarkMode2: "#112233"');
    expect(result).toContain("blue500: tokens.color.blue500DarkMode2");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("darkMode2"));
    expectValidModule(result);
  });

  it("quotes a digit-leading theme name and keeps variant token keys valid", async () => {
    (globalThis as any).figma = makeFigmaMockFrom(
      [
        {
          id: "c1",
          name: "Primitives",
          modes: [
            { name: "Light", modeId: "L" },
            { name: "2xl", modeId: "X" },
          ],
          variableIds: ["blue500"],
        },
      ],
      {
        blue500: {
          name: "Colors/Blue/500",
          resolvedType: "COLOR",
          variableCollectionId: "c1",
          valuesByMode: { L: hex(0, 0, 255), X: hex(0, 17, 51) },
        },
      }
    );
    const result = await exportToTamagui();

    expect(result).toContain('"2xl": {');
    expect(result).toContain('blue5002xl: "#001133"');
    expect(result).toContain("blue500: tokens.color.blue5002xl");
    expectValidModule(result);
  });

  it("lowercases all-caps mode names into conventional theme keys", async () => {
    (globalThis as any).figma = makeFigmaMockFrom(
      [
        {
          id: "c1",
          name: "Primitives",
          modes: [
            { name: "LIGHT", modeId: "L" },
            { name: "DARK", modeId: "D" },
          ],
          variableIds: ["blue500"],
        },
      ],
      {
        blue500: {
          name: "Colors/Blue/500",
          resolvedType: "COLOR",
          variableCollectionId: "c1",
          valuesByMode: { L: hex(0, 0, 255), D: hex(0, 17, 51) },
        },
      }
    );
    const result = await exportToTamagui();

    // Tamagui theme names are conventionally lowercase ("light" / "dark") —
    // the all-caps shortcut of toCamelCase must not leak into theme keys.
    expect(result).toContain("light: {");
    expect(result).toContain("dark: {");
    expect(result).toContain('blue500Dark: "#001133"');
    expect(result).not.toContain("LIGHT: {");
    expect(result).not.toContain("DARK: {");
    expectValidModule(result);
  });

  it("qualifies theme keys with their group when two groups share a key", async () => {
    (globalThis as any).figma = makeFigmaMockFrom(
      [
        {
          id: "c1",
          name: "Primitives",
          modes: [{ name: "Light", modeId: "L" }],
          variableIds: ["colorGap", "spaceGap"],
        },
      ],
      {
        colorGap: {
          name: "Colors/Gap",
          resolvedType: "COLOR",
          variableCollectionId: "c1",
          valuesByMode: { L: hex(0, 0, 255) },
        },
        spaceGap: {
          name: "Spacing/Gap",
          resolvedType: "FLOAT",
          variableCollectionId: "c1",
          valuesByMode: { L: 16 },
        },
      }
    );
    const result = await exportToTamagui();

    // Both tokens flatten to the key "gap" — in the flat theme map they are
    // qualified with their group so neither overwrites the other.
    expect(result).toContain("colorGap: tokens.color.gap");
    expect(result).toContain("spaceGap: tokens.space.gap");
    expectValidModule(result);
  });

  it("uses the last arrow segment as the mode name when the collection name contains an arrow", async () => {
    (globalThis as any).figma = makeFigmaMockFrom(
      [
        {
          id: "c1",
          name: "Base → Colors",
          modes: [
            { name: "Light", modeId: "L" },
            { name: "Dark", modeId: "D" },
          ],
          variableIds: ["blue500"],
        },
      ],
      {
        blue500: {
          name: "Colors/Blue/500",
          resolvedType: "COLOR",
          variableCollectionId: "c1",
          valuesByMode: { L: hex(0, 0, 255), D: hex(0, 17, 51) },
        },
      }
    );
    const result = await exportToTamagui();

    // "Base → Colors → Light": the mode is "Light", not "Colors".
    expect(result).toContain("light: {");
    expect(result).toContain("dark: {");
    expect(result).not.toContain("colors: {");
    expect(result).toContain(" * Themes: light, dark");
    expectValidModule(result);
  });

  it("warns and keeps the first value for homonymous tokens across collections", async () => {
    (globalThis as any).figma = makeFigmaMockFrom(
      [
        { id: "c1", name: "Primitives", modes: [{ name: "Light", modeId: "L" }], variableIds: ["blue500"] },
        { id: "c2", name: "Brand", modes: [{ name: "Light", modeId: "L2" }], variableIds: ["blue500b"] },
      ],
      {
        blue500: {
          name: "Colors/Blue/500",
          resolvedType: "COLOR",
          variableCollectionId: "c1",
          valuesByMode: { L: hex(0, 0, 255) },
        },
        blue500b: {
          name: "Colors/Blue/500",
          resolvedType: "COLOR",
          variableCollectionId: "c2",
          valuesByMode: { L2: hex(255, 0, 0) },
        },
      }
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await exportToTamagui();

    // Same group + key from two collections: no silent overwrite.
    expect(result).toContain('blue500: "#0000ff"');
    expect(result).not.toContain("#ff0000");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Duplicate token"));
    expectValidModule(result);
  });
});
