import { describe, it, expect, afterEach } from "vitest";
import { exportToStyleDictionary } from "./collectionToStyleDictionary";

function makeFigmaMock() {
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["blue500", "spacing4", "weightBold", "familySans", "bgPrimary"],
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
    bgPrimary: {
      name: "Background/Primary",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: { M1: { type: "VARIABLE_ALIAS", id: "blue500" } },
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

describe("exportToStyleDictionary", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("nests tokens as CTI groups with { value, type } leaves", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToStyleDictionary();
    const parsed = JSON.parse(result);

    expect(parsed.colors.blue["500"]).toEqual({ value: "#0000ff", type: "color" });
    expect(parsed.spacing["4"]).toEqual({ value: 16, type: "number" });
    expect(parsed.fontWeight.weight.bold).toEqual({ value: 700, type: "number" });
    expect(parsed.fontFamily.sans).toEqual({ value: "Inter", type: "string" });
  });

  it("resolves aliases to concrete values", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const parsed = JSON.parse(await exportToStyleDictionary());

    expect(parsed.colors.background.primary).toEqual({ value: "#0000ff", type: "color" });
    expect(JSON.stringify(parsed)).not.toContain("VARIABLE_ALIAS");
  });

  it("applies the prefix to the token family segment", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const parsed = JSON.parse(await exportToStyleDictionary(undefined, "acme"));

    expect(parsed.colors["acme-blue"]["500"]).toEqual({ value: "#0000ff", type: "color" });
    expect(parsed.spacing["acme-4"]).toEqual({ value: 16, type: "number" });
  });

  it("emits plain JSON with quoted keys and no import expression", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToStyleDictionary();

    expect(result).toContain('"value": "#0000ff"');
    expect(result).toContain('"type": "color"');
    expect(result).not.toContain("imp" + "ort(");
  });
});
