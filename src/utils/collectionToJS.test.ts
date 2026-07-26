import { describe, it, expect, afterEach } from "vitest";
import { exportToJS } from "./collectionToJS";
import type { ExportSelection } from "../types.d";

const NO_STYLES = { text: false, paint: false, effect: false, grid: false };
const TEXT_ONLY = { text: true, paint: false, effect: false, grid: false };

/** Minimal local-styles API: one text style, everything else empty */
function withTextStyle(mock: Record<string, any>) {
  return {
    ...mock,
    getLocalTextStylesAsync: async () => [
      {
        name: "Body/Regular",
        description: "",
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 16,
        lineHeight: { unit: "PIXELS", value: 24 },
        letterSpacing: { unit: "PERCENT", value: 0 },
        textCase: "ORIGINAL",
        textDecoration: "NONE",
        paragraphSpacing: 0,
      },
    ],
    getLocalPaintStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
}

/** Wires a collections/variables pair into a figma.variables mock */
function makeMock(collections: any[], variables: Record<string, any>) {
  const byId: Record<string, any> = Object.fromEntries(collections.map((c) => [c.id, c]));
  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => byId[id] ?? null,
    },
  };
}

/** Single collection, one concrete token — the happy path */
function makeBasicMock() {
  const blue500 = {
    name: "Colors/Blue/500",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
  };
  const collection = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["blue500"],
  };
  return makeMock([collection], { blue500 });
}

/**
 * Semantic's mode "Mode 1" matches primitives' mode "Mode 1" by name, but the
 * selection only exports primitives' "Mode 2" — the alias must be inlined
 * instead of pointing at a mode absent from the export.
 */
function makeDeselectedModeMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [
      { name: "Mode 1", modeId: "M1" },
      { name: "Mode 2", modeId: "M2" },
    ],
    variableIds: ["blue500"],
  };
  const semantic = {
    id: "c2",
    name: "Semantic",
    modes: [{ name: "Mode 1", modeId: "S1" }],
    variableIds: ["bgPrimary"],
  };
  const blue500 = {
    name: "Colors/Blue/500",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 }, M2: { r: 1, g: 0, b: 0, a: 1 } },
  };
  const bgPrimary = {
    name: "Background/Primary",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c2",
    valuesByMode: { S1: { type: "VARIABLE_ALIAS", id: "blue500" } },
  };
  return makeMock([semantic, primitives], { blue500, bgPrimary });
}

/**
 * Two-hop cross-collection chain: semantic -> mid -> primitives. The middle
 * collection is deselected, so the chain is resolved to a concrete value;
 * each hop must re-resolve the mode by name (primitives stores the wrong
 * value first in valuesByMode to catch arbitrary-mode fallbacks).
 */
function makeTwoHopChainMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [
      { name: "Mode 1", modeId: "P1" },
      { name: "Mode 2", modeId: "P2" },
    ],
    variableIds: ["blue500"],
  };
  const mid = {
    id: "c2",
    name: "Mid",
    modes: [{ name: "Mode 1", modeId: "MM1" }],
    variableIds: ["midVar"],
  };
  const semantic = {
    id: "c3",
    name: "Semantic",
    modes: [{ name: "Mode 1", modeId: "S1" }],
    variableIds: ["bgPrimary"],
  };
  const blue500 = {
    name: "Colors/Blue/500",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c1",
    // red is first on purpose: a fallback to "any mode" would pick it
    valuesByMode: { P2: { r: 1, g: 0, b: 0, a: 1 }, P1: { r: 0, g: 0, b: 1, a: 1 } },
  };
  const midVar = {
    name: "Mid/Token",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c2",
    valuesByMode: { MM1: { type: "VARIABLE_ALIAS", id: "blue500" } },
  };
  const bgPrimary = {
    name: "Background/Primary",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c3",
    valuesByMode: { S1: { type: "VARIABLE_ALIAS", id: "midVar" } },
  };
  return makeMock([semantic, mid, primitives], { blue500, midVar, bgPrimary });
}

/** Cross-collection alias whose target path has segments needing brackets */
function makeSpecialCharsMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["bracketVar", "quotedVar"],
  };
  const semantic = {
    id: "c2",
    name: "Semantic",
    modes: [{ name: "Mode 1", modeId: "S1" }],
    variableIds: ["aliasBracket", "aliasQuoted"],
  };
  const bracketVar = {
    name: "Colors/Blue[500]",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
  };
  const quotedVar = {
    name: 'Colors/Theme "A"',
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: { r: 1, g: 0, b: 0, a: 1 } },
  };
  const aliasBracket = {
    name: "Alias/Bracket",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c2",
    valuesByMode: { S1: { type: "VARIABLE_ALIAS", id: "bracketVar" } },
  };
  const aliasQuoted = {
    name: "Alias/Quoted",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c2",
    valuesByMode: { S1: { type: "VARIABLE_ALIAS", id: "quotedVar" } },
  };
  return makeMock([primitives, semantic], { bracketVar, quotedVar, aliasBracket, aliasQuoted });
}

/** Evaluates the export as a plain script, returning the created bindings */
function evaluate(js: string): Record<string, any> {
  const names = [...js.matchAll(/export const ([$_a-zA-Z][$_a-zA-Z0-9]*) =/g)].map((m) => m[1]);
  const body = js.replace(/export const /g, "const ");
  return new Function(`${body}\nreturn { ${names.join(", ")} };`)();
}

describe("exportToJS (end-to-end with a Figma mock)", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("exports one const per collection without `as const`", async () => {
    (globalThis as any).figma = makeBasicMock();
    const result = (await exportToJS(undefined, NO_STYLES)) as string;

    expect(result).toContain("export const primitives = {");
    expect(result).not.toContain("as const");
    expect(result).toContain('value: "#0000ff"');

    const scope = evaluate(result);
    expect(scope.primitives.mode1.colors.blue["500"].value).toBe("#0000ff");
  });

  it("prefixes collection names that are reserved words", async () => {
    const blue500 = {
      name: "Blue",
      resolvedType: "COLOR",
      description: "",
      variableCollectionId: "c1",
      valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
    };
    const collection = {
      id: "c1",
      name: "Default",
      modes: [{ name: "Mode 1", modeId: "M1" }],
      variableIds: ["blue500"],
    };
    (globalThis as any).figma = makeMock([collection], { blue500 });

    const result = (await exportToJS(undefined, NO_STYLES)) as string;

    // `export const default` would be a SyntaxError
    expect(result).toContain("export const _default = {");
    const scope = evaluate(result);
    expect(scope._default.mode1.blue.value).toBe("#0000ff");
  });

  it("deduplicates const names of colliding collections", async () => {
    const tokenA = {
      name: "Alpha",
      resolvedType: "FLOAT",
      description: "",
      variableCollectionId: "c1",
      valuesByMode: { M1: 1 },
    };
    const tokenB = {
      name: "Beta",
      resolvedType: "FLOAT",
      description: "",
      variableCollectionId: "c2",
      valuesByMode: { N1: 2 },
    };
    const first = {
      id: "c1",
      name: "My Tokens",
      modes: [{ name: "Mode 1", modeId: "M1" }],
      variableIds: ["tokenA"],
    };
    const second = {
      id: "c2",
      name: "my-tokens",
      modes: [{ name: "Mode 1", modeId: "N1" }],
      variableIds: ["tokenB"],
    };
    (globalThis as any).figma = makeMock([first, second], { tokenA, tokenB });

    const result = (await exportToJS(undefined, NO_STYLES)) as string;

    expect(result).toContain("export const myTokens = {");
    expect(result).toContain("export const myTokens2 = {");
    const scope = evaluate(result);
    expect(scope.myTokens.mode1.alpha.value).toBe(1);
    expect(scope.myTokens2.mode1.beta.value).toBe(2);
  });

  it("renames the style const when a collection takes its name", async () => {
    const token = {
      name: "Alpha",
      resolvedType: "FLOAT",
      description: "",
      variableCollectionId: "c1",
      valuesByMode: { M1: 1 },
    };
    const collection = {
      id: "c1",
      name: "Text Styles",
      modes: [{ name: "Mode 1", modeId: "M1" }],
      variableIds: ["token"],
    };
    (globalThis as any).figma = withTextStyle(makeMock([collection], { token }));

    const result = (await exportToJS(undefined, TEXT_ONLY)) as string;

    expect(result).toContain("export const textStyles = {");
    expect(result).toContain("export const textStyles2 = {");
    const scope = evaluate(result);
    expect(scope.textStyles.mode1.alpha.value).toBe(1);
    expect(scope.textStyles2.Body.Regular.$value.fontFamily).toBe("Inter");
  });

  it("inlines the alias value when the resolved target mode is deselected", async () => {
    (globalThis as any).figma = makeDeselectedModeMock();
    // primitives exports only "Mode 2"; semantic's "Mode 1" matches the
    // deselected "Mode 1" of primitives by name
    const selection: ExportSelection = { c1: ["M2"], c2: ["S1"] };
    const result = (await exportToJS(selection, NO_STYLES)) as string;

    // A reference would point at primitives.mode1, which is not exported
    expect(result).not.toContain("primitives.mode1");
    // The concrete value is resolved in the mode matched by name ("Mode 1")
    const scope = evaluate(result);
    expect(scope.semantic.mode1.background.primary.value).toBe("#0000ff");
  });

  it("emits a reference when the resolved target mode IS selected", async () => {
    (globalThis as any).figma = makeDeselectedModeMock();
    const selection: ExportSelection = { c1: ["M1"], c2: ["S1"] };
    const result = (await exportToJS(selection, NO_STYLES)) as string;

    expect(result).toContain("value: primitives.mode1.colors.blue[\"500\"].value");
    const scope = evaluate(result);
    expect(scope.semantic.mode1.background.primary.value).toBe("#0000ff");
  });

  it("resolves a two-hop alias chain mode by mode across collections", async () => {
    (globalThis as any).figma = makeTwoHopChainMock();
    // The middle collection is deselected, so the chain must be inlined;
    // each hop re-resolves "Mode 1" in the hop's own collection
    const selection: ExportSelection = { c1: ["P1"], c3: ["S1"] };
    const result = (await exportToJS(selection, NO_STYLES)) as string;

    expect(result).not.toContain("mid.mode1");
    const scope = evaluate(result);
    // blue, not the red stored first in primitives' valuesByMode
    expect(scope.semantic.mode1.background.primary.value).toBe("#0000ff");
  });

  it("serializes bracket-notation segments with special characters safely", async () => {
    (globalThis as any).figma = makeSpecialCharsMock();
    const result = (await exportToJS(undefined, NO_STYLES)) as string;

    expect(result).toContain('primitives.mode1.colors["blue[500]"].value');
    expect(result).toContain('primitives.mode1.colors["theme \\"A\\""].value');

    const scope = evaluate(result);
    expect(scope.semantic.mode1.alias.bracket.value).toBe("#0000ff");
    expect(scope.semantic.mode1.alias.quoted.value).toBe("#ff0000");
  });
});
