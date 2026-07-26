import { describe, it, expect, afterEach } from "vitest";
import { exportToTamagui } from "./collectionToTamagui";

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
});
