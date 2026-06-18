import { describe, it, expect, afterEach } from "vitest";
import { exportToJSON } from "./collectionToJSON";
import { exportToCSS } from "./collectionToCSS";
import { exportToCSV } from "./collectionToCSV";
import { exportToJS } from "./collectionToJS";
import { exportToDSCG } from "./collectionToDSCG";
import { NO_STYLES } from "./styleSelection";
import type { ExportSelection } from "../types.d";

/**
 * Two collections, one multi-mode, so we can assert that a selection trims
 * collections and modes consistently across every exporter.
 */
function makeFigmaMock() {
  const vars: Record<string, any> = {
    white: {
      id: "white",
      name: "Grayscale/White",
      resolvedType: "COLOR",
      valuesByMode: { L: { r: 1, g: 1, b: 1, a: 1 }, D: { r: 0, g: 0, b: 0, a: 1 } },
      scopes: [],
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "c1",
    },
    brand: {
      id: "brand",
      name: "Brand/500",
      resolvedType: "COLOR",
      valuesByMode: {
        L: { r: 0, g: 0, b: 1, a: 1 },
        D: { r: 0.4, g: 0.4, b: 1, a: 1 },
      },
      scopes: [],
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "c1",
    },
    sp: {
      id: "sp",
      name: "sp-1",
      resolvedType: "FLOAT",
      valuesByMode: { M: 8 },
      scopes: [],
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "c2",
    },
  };

  const collections = [
    {
      id: "c1",
      name: "Colors",
      modes: [
        { name: "Light", modeId: "L" },
        { name: "Dark", modeId: "D" },
      ],
      variableIds: ["white", "brand"],
    },
    {
      id: "c2",
      name: "Spacing",
      modes: [{ name: "Mode 1", modeId: "M" }],
      variableIds: ["sp"],
    },
  ];

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) =>
        collections.find((c) => c.id === id) ?? null,
    },
    getLocalTextStylesAsync: async () => [],
    getLocalPaintStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
}

/** Same as {@link makeFigmaMock} but with one local paint style present. */
function makeStyledFigmaMock() {
  const base = makeFigmaMock();
  return {
    ...base,
    getLocalPaintStylesAsync: async () => [
      {
        name: "Brand/Accent",
        description: "",
        paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
      },
    ],
  };
}

describe("exporters respect the export selection", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("JSON: emits only the selected collection/mode pairs", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const selection: ExportSelection = { c1: ["L"], c2: ["M"] };

    const result = JSON.parse((await exportToJSON(selection)) as string);
    const pairs = result
      .filter((entry: any) => entry.mode)
      .map((entry: any) => `${entry.collection}/${entry.mode}`);

    expect(pairs).toEqual(["Colors/Light", "Spacing/Mode 1"]);
  });

  it("JSON: skips a collection that has no selected modes", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const selection: ExportSelection = { c1: ["L", "D"], c2: [] };

    const result = JSON.parse((await exportToJSON(selection)) as string);
    const collections = result
      .filter((entry: any) => entry.mode)
      .map((entry: any) => entry.collection);

    expect(collections).toEqual(["Colors", "Colors"]);
    expect(collections).not.toContain("Spacing");
  });

  it("JSON: omits the Styles entry when the file has no local styles", async () => {
    (globalThis as any).figma = makeFigmaMock();

    const result = JSON.parse((await exportToJSON()) as string);

    expect(result.some((e: any) => e.collection === "Styles")).toBe(false);
  });

  it("JSON: deselecting every collection yields an empty array (styleless file)", async () => {
    (globalThis as any).figma = makeFigmaMock();

    const result = JSON.parse((await exportToJSON({ c1: [], c2: [] })) as string);

    expect(result).toEqual([]);
  });

  it("JSON: the style selection toggles the Styles entry when the file has styles", async () => {
    (globalThis as any).figma = makeStyledFigmaMock();

    const withStyles = JSON.parse((await exportToJSON()) as string);
    const withoutStyles = JSON.parse((await exportToJSON(undefined, NO_STYLES)) as string);

    expect(withStyles.some((e: any) => e.collection === "Styles")).toBe(true);
    expect(withoutStyles.some((e: any) => e.collection === "Styles")).toBe(false);
  });

  it("JSON: includes only the selected style kinds", async () => {
    (globalThis as any).figma = makeStyledFigmaMock();

    // The mock only has a paint style.
    const onlyPaint = JSON.parse(
      (await exportToJSON(undefined, { text: false, paint: true, effect: false, grid: false })) as string
    );
    const onlyText = JSON.parse(
      (await exportToJSON(undefined, { text: true, paint: false, effect: false, grid: false })) as string
    );

    const paintEntry = onlyPaint.find((e: any) => e.collection === "Styles");
    expect(paintEntry).toBeDefined();
    expect(Object.keys(paintEntry.paintStyles).length).toBeGreaterThan(0);

    // No text styles exist, so a text-only selection yields no Styles entry.
    expect(onlyText.some((e: any) => e.collection === "Styles")).toBe(false);
  });

  it("DSCG: emits one token set per selected collection/mode", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const selection: ExportSelection = { c1: ["D"] };

    const result = JSON.parse((await exportToDSCG(selection)) as string);
    const setNames = Object.keys(result).filter(
      (k) => k !== "$themes" && k !== "$metadata"
    );

    expect(setNames).toEqual(["Colors/Dark"]);
    expect(result.$metadata.tokenSetOrder).toEqual(["Colors/Dark"]);
  });

  it("CSS: a deselected 'Dark' mode produces no prefers-color-scheme block", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const selection: ExportSelection = { c1: ["L"] };

    const css = await exportToCSS(selection);

    expect(css).not.toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root");
  });

  it("CSV: emits header + only the selected rows", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const selection: ExportSelection = { c1: ["L"] };

    const csv = (await exportToCSV(false, selection, NO_STYLES)) as string;
    const rows = csv.split("\n");

    // header + white(Light) + brand(Light) === 3 rows; no Dark, no Spacing
    expect(rows).toHaveLength(3);
    expect(csv).toContain("Colors,Light,Grayscale/White");
    expect(csv).not.toContain(",Dark,");
    expect(csv).not.toContain("Spacing");
  });

  it("JS: only the selected collection is exported", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const selection: ExportSelection = { c2: ["M"] };

    const js = (await exportToJS(selection, NO_STYLES)) as string;

    expect(js).toContain("export const spacing");
    expect(js).not.toContain("export const colors");
  });

  it("undefined selection still exports everything (back-compat)", async () => {
    (globalThis as any).figma = makeFigmaMock();

    const result = JSON.parse((await exportToJSON()) as string);
    const pairs = result
      .filter((entry: any) => entry.mode)
      .map((entry: any) => `${entry.collection}/${entry.mode}`);

    expect(pairs).toEqual(["Colors/Light", "Colors/Dark", "Spacing/Mode 1"]);
  });
});

/**
 * A "Usage" collection whose token aliases a "Colors" token, used to verify the
 * CSV row/column reference behaviour when the alias target is (de)selected.
 */
function makeAliasFigmaMock() {
  const vars: Record<string, any> = {
    brand: {
      id: "brand",
      name: "Brand/500",
      resolvedType: "COLOR",
      valuesByMode: {
        L: { r: 0, g: 0, b: 1, a: 1 },
        D: { r: 0.4, g: 0.4, b: 1, a: 1 },
      },
      scopes: [],
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "c1",
    },
    bg: {
      id: "bg",
      name: "Background/Brand",
      resolvedType: "COLOR",
      valuesByMode: { U: { type: "VARIABLE_ALIAS", id: "brand" } },
      scopes: [],
      description: "",
      hiddenFromPublishing: false,
      variableCollectionId: "c3",
    },
  };

  const collections = [
    {
      id: "c1",
      name: "Colors",
      modes: [
        { name: "Light", modeId: "L" },
        { name: "Dark", modeId: "D" },
      ],
      variableIds: ["brand"],
    },
    {
      id: "c3",
      name: "Usage",
      modes: [{ name: "Light", modeId: "U" }],
      variableIds: ["bg"],
    },
  ];

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) =>
        collections.find((c) => c.id === id) ?? null,
    },
    getLocalTextStylesAsync: async () => [],
    getLocalPaintStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
}

describe("description parser applies during export", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  function makeDescribedMock(description: string) {
    return {
      variables: {
        getLocalVariableCollectionsAsync: async () => [
          { id: "c1", name: "Colors", modes: [{ name: "Mode 1", modeId: "M" }], variableIds: ["v"] },
        ],
        getVariableByIdAsync: async () => ({
          id: "v",
          name: "Brand",
          resolvedType: "FLOAT",
          valuesByMode: { M: 8 },
          scopes: [],
          description,
        }),
        getVariableCollectionByIdAsync: async () => null,
      },
      getLocalTextStylesAsync: async () => [],
      getLocalPaintStylesAsync: async () => [],
      getLocalEffectStylesAsync: async () => [],
      getLocalGridStylesAsync: async () => [],
    };
  }

  it("JSON: description-to-json turns a JSON description string into an object", async () => {
    (globalThis as any).figma = makeDescribedMock('{"id":"testando","n":1}');

    const parsed = JSON.parse(
      (await exportToJSON({ c1: ["M"] }, NO_STYLES, "description-to-json")) as string
    );
    expect(parsed[0].variables.Brand.$description).toEqual({ id: "testando", n: 1 });
  });

  it("JSON: without a parser the description stays a string", async () => {
    (globalThis as any).figma = makeDescribedMock('{"id":"testando"}');

    const parsed = JSON.parse((await exportToJSON({ c1: ["M"] }, NO_STYLES)) as string);
    expect(parsed[0].variables.Brand.$description).toBe('{"id":"testando"}');
  });
});

describe("CSV linked-variable cell references respect the selection", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("uses a cell reference (=E#) when the alias target is part of the export", async () => {
    (globalThis as any).figma = makeAliasFigmaMock();

    const csv = (await exportToCSV(true, { c1: ["L", "D"], c3: ["U"] }, NO_STYLES)) as string;

    expect(csv).toMatch(/=E\d+/);
    expect(csv).not.toContain("=brand");
  });

  it("falls back to a readable textual reference when the target is deselected", async () => {
    (globalThis as any).figma = makeAliasFigmaMock();

    // c1 (the alias target) is not exported, so no cell can be referenced.
    const csv = (await exportToCSV(true, { c3: ["U"] }, NO_STYLES)) as string;

    expect(csv).toContain("=Colors/Light/Brand/500");
    expect(csv).not.toContain("=brand");
    expect(csv).not.toMatch(/=E\d+/);
  });
});
