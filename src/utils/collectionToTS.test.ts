import { describe, it, expect, afterEach } from "vitest";
import { exportToTS } from "./collectionToTS";

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

describe("exportToTS (end-to-end with a Figma mock)", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("exports one typed const per collection with `as const`", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = (await exportToTS(undefined, { text: false, paint: false, effect: false, grid: false })) as string;

    expect(result).toContain("export const primitives = {");
    expect(result).toContain("} as const;");
    expect(result).toContain('value: "#0000ff"');
  });

  it("emits aliases as direct references to the linked const path", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = (await exportToTS(undefined, { text: false, paint: false, effect: false, grid: false })) as string;

    expect(result).toContain('value: primitives.mode1.colors.blue["500"].value');
  });
});
