import { describe, it, expect, afterEach, vi } from "vitest";
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

/** A single collection with two modes (Light values differ from Dark ones). */
function makeMultiModeMock() {
  const collection = {
    id: "c1",
    name: "Primitives",
    modes: [
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ],
    variableIds: ["blue500"],
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
  };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => (id === "c1" ? collection : null),
    },
  };
}

/** A "Colors/Blue" leaf next to a "Colors/Blue/500" child (leaf/group clash). */
function makeLeafGroupMock(variableIds: string[]) {
  const collection = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds,
  };

  const vars: Record<string, any> = {
    blue: {
      name: "Colors/Blue",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
    },
    blue500: {
      name: "Colors/Blue/500",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: { M1: { r: 0, g: 17 / 255, b: 51 / 255, a: 1 } },
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

/** Two collections defining homonymous variables (same exported path). */
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

  it("uses the first selected mode and ignores extra selected modes", async () => {
    (globalThis as any).figma = makeMultiModeMock();
    // Both modes selected: the static export keeps a single value per token,
    // taken from the first selected mode; the extra mode is ignored.
    const parsed = JSON.parse(await exportToStyleDictionary({ c1: ["L", "D"] }));

    expect(parsed.colors.blue["500"]).toEqual({ value: "#0000ff", type: "color" });
    expect(JSON.stringify(parsed)).not.toContain("#001133");
  });

  it("honors a different first selected mode", async () => {
    (globalThis as any).figma = makeMultiModeMock();
    const parsed = JSON.parse(await exportToStyleDictionary({ c1: ["D"] }));

    expect(parsed.colors.blue["500"]).toEqual({ value: "#001133", type: "color" });
  });

  it("warns and keeps the leaf when a child would nest under it (leaf/group clash)", async () => {
    (globalThis as any).figma = makeLeafGroupMock(["blue", "blue500"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parsed = JSON.parse(await exportToStyleDictionary());

      // Tokens and groups are never mixed: the leaf stays, the child is skipped.
      expect(parsed.colors.blue).toEqual({ value: "#0000ff", type: "color" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("colors/blue/500"));
    } finally {
      warn.mockRestore();
    }
  });

  it("warns and keeps the group when a leaf would overwrite it (group/leaf clash)", async () => {
    (globalThis as any).figma = makeLeafGroupMock(["blue500", "blue"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parsed = JSON.parse(await exportToStyleDictionary());

      expect(parsed.colors.blue).toEqual({ "500": { value: "#001133", type: "color" } });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("colors/blue"));
    } finally {
      warn.mockRestore();
    }
  });

  it("warns and skips homonymous tokens instead of silently overwriting", async () => {
    (globalThis as any).figma = makeCollisionMock();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parsed = JSON.parse(await exportToStyleDictionary());

      // First collection wins; the duplicate is skipped, not overwritten.
      expect(parsed.colors.blue["500"]).toEqual({ value: "#0000ff", type: "color" });
      expect(JSON.stringify(parsed)).not.toContain("#ff0000");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("colors/blue/500"));
    } finally {
      warn.mockRestore();
    }
  });
});
