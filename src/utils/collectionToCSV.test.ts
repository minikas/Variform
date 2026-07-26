import { describe, it, expect, afterEach } from "vitest";
import { exportToCSV } from "./collectionToCSV";
import { NO_STYLES } from "./styleSelection";
import type { ExportSelection } from "../types.d";

/** Builds a figma global mock from a variable table and a collection list. */
function makeFigmaMock(vars: Record<string, any>, collections: any[]) {
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

/** Quote-aware CSV parser (handles commas, doubled quotes and multi-line cells). */
function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/**
 * "Colors" collection (Light/Dark) with two color tokens, plus a "Usage"
 * collection whose token aliases "brand". Rows emitted (no selection):
 *   2 white/Light  3 brand/Light  4 white/Dark  5 brand/Dark  6 bg/Light
 */
function makeAliasMock() {
  const vars: Record<string, any> = {
    white: {
      id: "white",
      name: "Grayscale/White",
      resolvedType: "COLOR",
      valuesByMode: { L: { r: 1, g: 1, b: 1, a: 1 }, D: { r: 0, g: 0, b: 0, a: 1 } },
      scopes: [],
      description: "",
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
      variableCollectionId: "c1",
    },
    bg: {
      id: "bg",
      name: "Background/Brand",
      resolvedType: "COLOR",
      valuesByMode: { U: { type: "VARIABLE_ALIAS", id: "brand" } },
      scopes: [],
      description: "",
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
      variableIds: ["white", "brand"],
    },
    {
      id: "c3",
      name: "Usage",
      modes: [{ name: "Light", modeId: "U" }],
      variableIds: ["bg"],
    },
  ];

  return makeFigmaMock(vars, collections);
}

describe("exportToCSV", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  describe("happy path", () => {
    it("without row/column: emits one row per variable/mode with textual alias references", async () => {
      (globalThis as any).figma = makeAliasMock();

      const csv = (await exportToCSV(false, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      expect(rows).toHaveLength(6); // header + 5 variable rows
      expect(rows[0]).toEqual(["Collection", "Mode", "Variable", "Type", "Value", "Scopes", "Description"]);
      expect(rows[1]).toEqual(["Colors", "Light", "Grayscale/White", "COLOR", "#ffffff", "", ""]);
      expect(rows[2]).toEqual(["Colors", "Light", "Brand/500", "COLOR", "#0000ff", "", ""]);
      expect(rows[3]).toEqual(["Colors", "Dark", "Grayscale/White", "COLOR", "#000000", "", ""]);
      expect(rows[4]).toEqual(["Colors", "Dark", "Brand/500", "COLOR", "#6666ff", "", ""]);
      expect(rows[5]).toEqual(["Usage", "Light", "Background/Brand", "COLOR", "=Colors/Light/Brand/500", "", ""]);
    });

    it("with row/column: rewrites the alias to a cell reference of the target row", async () => {
      (globalThis as any).figma = makeAliasMock();

      const csv = (await exportToCSV(true, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      // brand/Light is spreadsheet row 3 (header is row 1).
      expect(rows[5][4]).toBe("=E3");
    });
  });

  describe("cell escaping", () => {
    it("quotes commas, quotes and newlines in names, values and descriptions", async () => {
      const vars: Record<string, any> = {
        s: {
          id: "s",
          name: "a,b",
          resolvedType: "STRING",
          valuesByMode: { M: 'hello, "world"' },
          scopes: [],
          description: "line1\nline2",
          variableCollectionId: "c1",
        },
      };
      const collections = [
        {
          id: "c1",
          name: "Colors, Main",
          modes: [{ name: 'Light "On"', modeId: "M" }],
          variableIds: ["s"],
        },
      ];
      (globalThis as any).figma = makeFigmaMock(vars, collections);

      const csv = (await exportToCSV(false, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      // The multi-line description stays inside a single record.
      expect(rows).toHaveLength(2);
      expect(rows[1]).toEqual([
        "Colors, Main",
        'Light "On"',
        "a,b",
        "STRING",
        'hello, "world"',
        "",
        "line1\nline2",
      ]);
      // Raw output uses doubled quotes inside quoted cells.
      expect(csv).toContain('"hello, ""world"""');
      expect(csv).toContain('"Colors, Main"');
      expect(csv).toContain('"Light ""On"""');
    });

    it("wraps rgba() color values (which contain commas) in quotes", async () => {
      const vars: Record<string, any> = {
        alpha: {
          id: "alpha",
          name: "Alpha",
          resolvedType: "COLOR",
          valuesByMode: { M: { r: 1, g: 0, b: 0, a: 0.5 } },
          scopes: [],
          description: "",
          variableCollectionId: "c1",
        },
      };
      const collections = [
        { id: "c1", name: "Colors", modes: [{ name: "Mode 1", modeId: "M" }], variableIds: ["alpha"] },
      ];
      (globalThis as any).figma = makeFigmaMock(vars, collections);

      const csv = (await exportToCSV(false, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      expect(rows).toHaveLength(2);
      expect(rows[1][4]).toBe("rgba(255, 0, 0, 0.50)");
    });
  });

  describe("row/column references", () => {
    it("points =E# at the row of the RESOLVED mode, not the first mode", async () => {
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
          variableCollectionId: "c1",
        },
        bg: {
          id: "bg",
          name: "Background/Brand",
          resolvedType: "COLOR",
          valuesByMode: {
            U: { type: "VARIABLE_ALIAS", id: "brand" },
            U2: { type: "VARIABLE_ALIAS", id: "brand" },
          },
          scopes: [],
          description: "",
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
          modes: [
            { name: "Light", modeId: "U" },
            { name: "Dark", modeId: "U2" },
          ],
          variableIds: ["bg"],
        },
      ];
      (globalThis as any).figma = makeFigmaMock(vars, collections);

      const csv = (await exportToCSV(true, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      // Rows: 2 brand/Light, 3 brand/Dark, 4 bg/Light, 5 bg/Dark.
      expect(rows[3][4]).toBe("=E2"); // bg in Light -> brand/Light row
      expect(rows[4][4]).toBe("=E3"); // bg in Dark -> brand/Dark row (NOT =E2)
    });

    it("keeps row indexes correct when a variable has no value in every mode", async () => {
      const vars: Record<string, any> = {
        solid: {
          id: "solid",
          name: "Solid",
          resolvedType: "COLOR",
          valuesByMode: { L: { r: 1, g: 1, b: 1, a: 1 }, D: { r: 0, g: 0, b: 0, a: 1 } },
          scopes: [],
          description: "first\nsecond",
          variableCollectionId: "c1",
        },
        partial: {
          id: "partial",
          name: "Partial",
          resolvedType: "COLOR",
          // No value for the Light mode.
          valuesByMode: { D: { r: 0, g: 0, b: 1, a: 1 } },
          scopes: [],
          description: "",
          variableCollectionId: "c1",
        },
        bg: {
          id: "bg",
          name: "Background/Partial",
          resolvedType: "COLOR",
          valuesByMode: { U2: { type: "VARIABLE_ALIAS", id: "partial" } },
          scopes: [],
          description: "",
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
          variableIds: ["solid", "partial"],
        },
        {
          id: "c3",
          name: "Usage",
          modes: [{ name: "Dark", modeId: "U2" }],
          variableIds: ["bg"],
        },
      ];
      (globalThis as any).figma = makeFigmaMock(vars, collections);

      const csv = (await exportToCSV(true, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      // Records: 2 solid/Light, 3 solid/Dark, 4 partial/Dark, 5 bg/Dark — the
      // multi-line description must not shift the numbering.
      expect(rows).toHaveLength(5);
      expect(rows[1][6]).toBe("first\nsecond");
      expect(rows[4][4]).toBe("=E4");
    });

    it("does not mistake a name containing '=' for the value placeholder", async () => {
      const vars: Record<string, any> = {
        brand: {
          id: "brand",
          name: "Brand=500",
          resolvedType: "COLOR",
          valuesByMode: { L: { r: 0, g: 0, b: 1, a: 1 } },
          scopes: [],
          description: "",
          variableCollectionId: "c1",
        },
        bg: {
          id: "bg",
          name: "Background/Brand",
          resolvedType: "COLOR",
          valuesByMode: { U: { type: "VARIABLE_ALIAS", id: "brand" } },
          scopes: [],
          description: "",
          variableCollectionId: "c3",
        },
      };
      const collections = [
        { id: "c1", name: "Colors=Main", modes: [{ name: "Light", modeId: "L" }], variableIds: ["brand"] },
        { id: "c3", name: "Usage", modes: [{ name: "Light", modeId: "U" }], variableIds: ["bg"] },
      ];
      (globalThis as any).figma = makeFigmaMock(vars, collections);

      const csv = (await exportToCSV(true, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      // The '=' inside collection/variable names is left untouched...
      expect(rows[1][0]).toBe("Colors=Main");
      expect(rows[1][2]).toBe("Brand=500");
      // ...and only the value cell of the alias row is rewritten.
      expect(rows[2][4]).toBe("=E2");
    });

    it("falls back to the textual reference when the target has no row in the resolved mode", async () => {
      const vars: Record<string, any> = {
        partial: {
          id: "partial",
          name: "Partial",
          resolvedType: "COLOR",
          // Only a Light value; the alias resolves to Dark.
          valuesByMode: { L: { r: 0, g: 0, b: 1, a: 1 } },
          scopes: [],
          description: "",
          variableCollectionId: "c1",
        },
        bg: {
          id: "bg",
          name: "Background/Partial",
          resolvedType: "COLOR",
          valuesByMode: { U2: { type: "VARIABLE_ALIAS", id: "partial" } },
          scopes: [],
          description: "",
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
          variableIds: ["partial"],
        },
        { id: "c3", name: "Usage", modes: [{ name: "Dark", modeId: "U2" }], variableIds: ["bg"] },
      ];
      (globalThis as any).figma = makeFigmaMock(vars, collections);

      const selection: ExportSelection = { c1: ["L", "D"], c3: ["U2"] };
      const csv = (await exportToCSV(true, selection, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      // partial/Dark was never emitted, so no dangling =E# reference.
      expect(rows[2][4]).toBe("=Colors/Dark/Partial");
      expect(csv).not.toMatch(/=E\d+/);
    });
  });

  describe("broken aliases", () => {
    it("emits _unlinked when the alias target's collection no longer exists", async () => {
      const vars: Record<string, any> = {
        ghost: {
          id: "ghost",
          name: "Ghost",
          resolvedType: "COLOR",
          valuesByMode: { X: { r: 0, g: 0, b: 0, a: 1 } },
          scopes: [],
          description: "",
          variableCollectionId: "deleted-collection",
        },
        bg: {
          id: "bg",
          name: "Background/Ghost",
          resolvedType: "COLOR",
          valuesByMode: { U: { type: "VARIABLE_ALIAS", id: "ghost" } },
          scopes: [],
          description: "",
          variableCollectionId: "c3",
        },
        gone: {
          id: "gone",
          name: "Background/Gone",
          resolvedType: "COLOR",
          valuesByMode: { U: { type: "VARIABLE_ALIAS", id: "missing-var" } },
          scopes: [],
          description: "",
          variableCollectionId: "c3",
        },
      };
      const collections = [
        { id: "c3", name: "Usage", modes: [{ name: "Light", modeId: "U" }], variableIds: ["bg", "gone"] },
      ];
      (globalThis as any).figma = makeFigmaMock(vars, collections);

      const csv = (await exportToCSV(true, undefined, NO_STYLES)) as string;
      const rows = parseCSV(csv);

      // Deleted collection: no `=/Light/Ghost` textual fallback.
      expect(rows[1][4]).toBe("_unlinked");
      // Deleted variable: already _unlinked before.
      expect(rows[2][4]).toBe("_unlinked");
      expect(csv).not.toContain("=/");
    });
  });
});
