import { describe, it, expect, afterEach } from "vitest";
import { exportToReactNative } from "./collectionToReactNative";

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
});
