import { describe, it, expect, afterEach } from "vitest";
import ts from "typescript";
import { exportToTS } from "./collectionToTS";
import { exportToJS } from "./collectionToJS";

const NO_STYLES = { text: false, paint: false, effect: false, grid: false };

function makeFigmaMock() {
  const blue500 = {
    name: "Colors/Blue/500",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
  };
  const bgPrimary = {
    name: "Background/Primary",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: { type: "VARIABLE_ALIAS", id: "blue500" } },
  };
  const collection = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["blue500", "bgPrimary"],
  };
  const vars: Record<string, any> = { blue500, bgPrimary };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async () => collection,
    },
  };
}

/** Two collections where the first one aliases variables of the second */
function makeCrossCollectionMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
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
    valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
  };
  const bgPrimary = {
    name: "Background/Primary",
    resolvedType: "COLOR",
    description: "",
    variableCollectionId: "c2",
    valuesByMode: { S1: { type: "VARIABLE_ALIAS", id: "blue500" } },
  };
  const collections: Record<string, any> = { c1: primitives, c2: semantic };
  const vars: Record<string, any> = { blue500, bgPrimary };

  return {
    variables: {
      // semantic is returned first on purpose: its reference must still
      // point at an already-declared const in the output
      getLocalVariableCollectionsAsync: async () => [semantic, primitives],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections[id] ?? null,
    },
  };
}

/** Tokens exercising tricky values: path-like strings and numeric-leading keys */
function makeEdgeCaseMock() {
  const strToken = {
    name: "Font/Family",
    resolvedType: "STRING",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: "inter.bold" },
  };
  const numericLeadingKey = {
    name: "Spacing/2XL",
    resolvedType: "FLOAT",
    description: "",
    variableCollectionId: "c1",
    valuesByMode: { M1: 32 },
  };
  const collection = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["strToken", "numericLeadingKey"],
  };
  const vars: Record<string, any> = { strToken, numericLeadingKey };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async () => collection,
    },
  };
}

/** Evaluates the export as a plain script, returning the created bindings */
function evaluate(js: string): Record<string, any> {
  const names = [...js.matchAll(/export const ([$_a-zA-Z][$_a-zA-Z0-9]*) =/g)].map((m) => m[1]);
  const body = js.replace(/export const /g, "const ").replace(/ as const;/g, ";");
  return new Function(`${body}\nreturn { ${names.join(", ")} };`)();
}

describe("exportToTS (end-to-end with a Figma mock)", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("exports one typed const per collection with `as const`", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = (await exportToTS(undefined, NO_STYLES)) as string;

    expect(result).toContain("export const primitives = {");
    expect(result).toContain("} as const;");
    expect(result).toContain('value: "#0000ff"');
  });

  it("resolves same-collection aliases to their concrete value", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = (await exportToTS(undefined, NO_STYLES)) as string;

    // A reference would be a self-reference inside the const's own
    // initializer (temporal dead zone), so the alias must be inlined
    expect(result).not.toContain("primitives.mode1");
    const scope = evaluate(result);
    expect(scope.primitives.mode1.background.primary.value).toBe("#0000ff");
  });

  it("emits cross-collection aliases as references to an already-declared const", async () => {
    (globalThis as any).figma = makeCrossCollectionMock();
    const result = (await exportToTS(undefined, NO_STYLES)) as string;

    expect(result).toContain('value: primitives.mode1.colors.blue["500"].value');
    // primitives is returned second by the Figma API but must be declared first
    expect(result.indexOf("export const primitives")).toBeLessThan(result.indexOf("export const semantic"));

    const scope = evaluate(result);
    expect(scope.semantic.mode1.background.primary.value).toBe("#0000ff");
  });

  it("keeps path-like string values quoted and invalid-identifier keys quoted", async () => {
    (globalThis as any).figma = makeEdgeCaseMock();
    const result = (await exportToJS(undefined, NO_STYLES)) as string;

    expect(result).toContain('value: "inter.bold"');
    expect(result).toContain('"2XL":');

    const scope = evaluate(result);
    expect(scope.primitives.mode1.font.family.value).toBe("inter.bold");
    expect(scope.primitives.mode1.spacing["2XL"].value).toBe(32);
  });

  it("produces output the TypeScript compiler accepts", async () => {
    (globalThis as any).figma = makeCrossCollectionMock();
    const result = (await exportToTS(undefined, NO_STYLES)) as string;

    const { diagnostics } = ts.transpileModule(result, {
      reportDiagnostics: true,
      compilerOptions: { strict: true, target: ts.ScriptTarget.ES2020 },
    });
    const errors = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    expect(errors).toEqual([]);
  });

  it("never emits the sequence that breaks the Figma plugin runtime", async () => {
    (globalThis as any).figma = makeCrossCollectionMock();
    const result = (await exportToTS(undefined, NO_STYLES)) as string;

    expect(result).not.toContain("import" + "(");
  });
});
