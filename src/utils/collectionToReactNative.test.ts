import { describe, it, expect, afterEach, vi } from "vitest";
import { exportToReactNative } from "./collectionToReactNative";

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
 * Asserts the generated module parses as JS (exports and `as const`
 * stripped), exports no duplicate const names and has no duplicate keys in
 * the `themes` map.
 */
function expectValidModule(result: string) {
  const js = result.replace(/^export /gm, "").replace(/ as const/g, "");
  expect(() => new Function(js)).not.toThrow();
  const constNames = [...result.matchAll(/export const (\w+)/g)].map((m) => m[1]);
  expect(new Set(constNames).size).toBe(constNames.length);
  const mapIndex = result.indexOf("export const themes");
  if (mapIndex >= 0) {
    const keys = [...result.slice(mapIndex).matchAll(/^ {2}(\w+|"[^"]+"):/gm)].map((m) => m[1]);
    expect(new Set(keys).size).toBe(keys.length);
  }
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

describe("exportToReactNative", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
    vi.restoreAllMocks();
  });

  it("nests tokens under their category in a theme object marked as const", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative();

    expect(result).toContain("export const theme = {");
    expect(result).toContain("} as const;");
    expect(result).toContain("colors: {");
    expect(result).toContain("blue: {");
    expect(result).toContain('"500": "#0000ff"');
    expect(result).toContain("spacing: {");
    expect(result).toContain("fontFamily: {");
    expect(result).toContain('sans: "Inter"');
  });

  it("emits FLOATs as raw numbers, never with a px unit", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative();

    expect(result).toContain('"4": 16');
    expect(result).not.toContain("px");
  });

  it("uses the first selected mode (Light) for the default theme", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative();

    const defaultTheme = result.slice(result.indexOf("export const theme"), result.indexOf("darkTheme"));
    expect(defaultTheme).toContain('"500": "#0000ff"');
    expect(defaultTheme).not.toContain("#001133");
  });

  it("emits a darkTheme variant with the dark values", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative();

    const darkTheme = result.slice(result.indexOf("export const darkTheme"));
    expect(darkTheme).toContain("} as const;");
    expect(darkTheme).toContain('"500": "#001133"');
    // Tokens whose dark value equals the light value still appear.
    expect(darkTheme).toContain('"4": 16');
    expect(darkTheme).toContain('sans: "Inter"');
    // The header notes the variants.
    expect(result).toContain(" * Themes: dark");
  });

  it("resolves aliases per theme (dark alias → dark value)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative();

    const defaultTheme = result.slice(result.indexOf("export const theme"), result.indexOf("darkTheme"));
    const darkTheme = result.slice(result.indexOf("export const darkTheme"));
    expect(defaultTheme).toContain('primary: "#0000ff"');
    expect(darkTheme).toContain('primary: "#001133"');
    expect(result).not.toContain("VARIABLE_ALIAS");
  });

  it("emits a themes map keyed by mode name for useColorScheme lookup", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative();

    // Documented Expo/RN convention: a light/dark keyed map consumed via
    // useColorScheme() — themes[colorScheme ?? "light"].
    const themesMap = result.slice(result.indexOf("export const themes"));
    expect(themesMap).toContain("export const themes = {");
    expect(themesMap).toContain("light: theme");
    expect(themesMap).toContain("dark: darkTheme");
    expect(themesMap).toContain("} as const;");
    // The header documents the useColorScheme consumption pattern.
    expect(result).toContain("useColorScheme");
    expect(result).toContain('themes[colorScheme ?? "light"]');
    expect(result).toContain("userInterfaceStyle");
  });

  it("emits no theme variants when a single mode is selected", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative({ c1: ["L"] });

    expect(result).toContain("export const theme = {");
    expect(result).toContain('"500": "#0000ff"');
    expect(result).not.toContain("darkTheme");
    expect(result).not.toContain("Themes:");
    expect(result).not.toContain("export const themes");
  });

  it("prepends the prefix to the token family segment and notes it in the header", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative(undefined, "acme");

    expect(result).toContain('"acme-blue": {');
    expect(result).toContain('"acme-4": 16');
    expect(result).toContain('Prefix: "acme"');
  });

  it("never emits the forbidden dynamic-import sequence", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToReactNative();

    expect(result).not.toContain("import" + "(");
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
    const result = await exportToReactNative();

    // "Dark Mode" and "dark-mode" both normalize to darkMode — the second
    // gets a numeric suffix instead of a duplicate const / map key.
    expect(result).toContain("export const darkModeTheme");
    expect(result).toContain("export const darkMode2Theme");
    expect(result).toContain("darkMode: darkModeTheme");
    expect(result).toContain("darkMode2: darkMode2Theme");
    expect(result).toContain(" * Themes: darkMode, darkMode2");
    // Each variant keeps its own mode's values.
    const darkModeTheme = result.slice(result.indexOf("export const darkModeTheme"), result.indexOf("export const darkMode2Theme"));
    expect(darkModeTheme).toContain('"500": "#001133"');
    expect(result.slice(result.indexOf("export const darkMode2Theme"))).toContain('"500": "#112233"');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("darkMode2"));
    expectValidModule(result);
  });

  it("sanitizes the const name when the mode starts with a digit", async () => {
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
    const result = await exportToReactNative();

    // `export const 2xlTheme` would not parse — the identifier is prefixed.
    expect(result).toContain("export const _2xlTheme");
    expect(result).toContain('"2xl": _2xlTheme');
    expect(result).toContain(" * Themes: 2xl");
    expectValidModule(result);
  });

  it("lowercases all-caps mode keys so useColorScheme() resolves them", async () => {
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
    const result = await exportToReactNative();

    // useColorScheme() returns "light" / "dark" — all-caps mode names must
    // not survive toCamelCase's all-caps shortcut into the map keys.
    expect(result).toContain("light: theme");
    expect(result).toContain("dark: darkTheme");
    expect(result).toContain('themes[colorScheme ?? "light"]');
    expectValidModule(result);
  });

  it("keeps the default combination and emits no dead const with swapped mode orders", async () => {
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
    const result = await exportToReactNative();

    // The default theme documents "first selected mode of each collection":
    // c1 Light + c2 Dark. It stays in the map under "light".
    const defaultTheme = result.slice(result.indexOf("export const theme"), result.indexOf("export const darkTheme"));
    expect(defaultTheme).toContain('"500": "#0000ff"');
    expect(defaultTheme).toContain('surface: "#111111"');
    // The extra "Light" mode (from c2) collides with the default key: it is
    // suffixed and emitted — the old code dropped it from the map while
    // still exporting a dead `lightTheme` const.
    expect(result).toContain("export const darkTheme");
    expect(result).toContain("export const light2Theme");
    expect(result).not.toContain("export const lightTheme");
    const light2Theme = result.slice(result.indexOf("export const light2Theme"));
    expect(light2Theme).toContain('surface: "#eeeeee"');
    expect(light2Theme).toContain('"500": "#0000ff"');
    expect(result).toContain("light: theme");
    expect(result).toContain("dark: darkTheme");
    expect(result).toContain("light2: light2Theme");
    expect(result).toContain(" * Themes: dark, light2");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("light2"));
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
    const result = await exportToReactNative();

    // Same category + path from two collections: no silent overwrite.
    expect(result).toContain('"500": "#0000ff"');
    expect(result).not.toContain("#ff0000");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Duplicate token"));
    expectValidModule(result);
  });
});
