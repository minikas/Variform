import { describe, it, expect, afterEach, vi } from "vitest";
import { exportToJSON } from "./collectionToJSON";

/* ------------------------------ Figma mock ------------------------------- */

interface MockCollection {
  id: string;
  name: string;
  modes: Array<{ name: string; modeId: string }>;
  variableIds: string[];
}

/**
 * Builds a `figma` mock from a variable map and a collection list, following
 * the same pattern as the other exporter tests (no styles by default).
 */
function makeFigmaMock(vars: Record<string, any>, collections: MockCollection[]) {
  const collectionsById = Object.fromEntries(collections.map((c) => [c.id, c]));
  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) =>
        collectionsById[id] ?? null,
    },
    getLocalTextStylesAsync: async () => [],
    getLocalPaintStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
}

const makeVar = (
  name: string,
  resolvedType: string,
  value: unknown,
  extra: Record<string, unknown> = {}
) => ({
  name,
  resolvedType,
  valuesByMode: { m1: value },
  scopes: [],
  hiddenFromPublishing: false,
  description: "",
  variableCollectionId: "c1",
  ...extra,
});

const singleCollection = (variableIds: string[], name = "Primitives"): MockCollection => ({
  id: "c1",
  name,
  modes: [{ name: "Mode 1", modeId: "m1" }],
  variableIds,
});

describe("exportToJSON", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
    vi.restoreAllMocks();
  });

  it("emits one file per collection/mode with $type, $scopes, $hiddenFromPublishing, $description and $value", async () => {
    const vars = {
      a: makeVar("Grayscale/White", "COLOR", { r: 1, g: 1, b: 1, a: 1 }),
    };
    (globalThis as any).figma = makeFigmaMock(vars, [singleCollection(["a"])]);

    const result = JSON.parse((await exportToJSON()) as string);

    expect(result).toHaveLength(1);
    expect(result[0].collection).toBe("Primitives");
    expect(result[0].mode).toBe("Mode 1");
    expect(result[0].variables.Grayscale.White).toEqual({
      $type: "COLOR",
      $scopes: [],
      $hiddenFromPublishing: false,
      $description: "",
      $value: "#ffffff",
    });
  });

  it("uses the '$.' shorthand for same-collection aliases", async () => {
    const vars = {
      a: makeVar("Base", "COLOR", { r: 1, g: 0, b: 0, a: 1 }),
      b: makeVar("Alias", "COLOR", { type: "VARIABLE_ALIAS", id: "a" }),
    };
    (globalThis as any).figma = makeFigmaMock(vars, [singleCollection(["a", "b"])]);

    const result = JSON.parse((await exportToJSON()) as string);

    expect(result[0].variables.Alias.$value).toBe("$..Mode 1.Base");
  });

  it("names the linked collection even when the VARIABLE is homonymous with it", async () => {
    // Regression: the destructured variable `name` shadowed the collection
    // name, so a variable named like the linked collection produced a broken
    // same-collection shorthand.
    const collections: MockCollection[] = [
      { id: "c1", name: "A", modes: [{ name: "Mode 1", modeId: "m1" }], variableIds: ["hom"] },
      { id: "c2", name: "B", modes: [{ name: "Mode 1", modeId: "m2" }], variableIds: ["target"] },
    ];
    const vars = {
      hom: makeVar("B", "COLOR", { type: "VARIABLE_ALIAS", id: "target" }),
      target: makeVar("Target", "COLOR", { r: 0, g: 0, b: 1, a: 1 }, { variableCollectionId: "c2" }),
    };
    (globalThis as any).figma = makeFigmaMock(vars, collections);

    const result = JSON.parse((await exportToJSON()) as string);
    const fileA = result.find((f: any) => f.collection === "A");

    expect(fileA.variables.B.$value).toBe("$.B.Mode 1.Target");
  });

  it("downgrades a broken alias (_unlinked) to the string type", async () => {
    const vars = {
      broken: makeVar("Background/Broken", "COLOR", { type: "VARIABLE_ALIAS", id: "missing" }),
    };
    (globalThis as any).figma = makeFigmaMock(vars, [singleCollection(["broken"])]);

    const result = JSON.parse((await exportToJSON()) as string);

    expect(result[0].variables.Background.Broken.$type).toBe("string");
    expect(result[0].variables.Background.Broken.$value).toBe("_unlinked");
  });

  it("warns and skips on leaf/group collisions instead of mixing token and group", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vars = {
      leaf: makeVar("Color", "STRING", "x"),
      nested: makeVar("Color/Primary", "STRING", "y"),
      group: makeVar("Size/Base", "STRING", "b"),
      collidingLeaf: makeVar("Size", "STRING", "s"),
    };
    (globalThis as any).figma = makeFigmaMock(
      vars,
      [singleCollection(["leaf", "nested", "group", "collidingLeaf"])]
    );

    const result = JSON.parse((await exportToJSON()) as string);
    const variables = result[0].variables;

    // The first token wins; the colliding ones are skipped (both directions).
    expect(variables.Color.$value).toBe("x");
    expect(variables.Color.Primary).toBeUndefined();
    expect(variables.Size.Base.$value).toBe("b");
    expect(variables.Size.$value).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("trims path segments (nesting AND references) and rounds FLOATs to 3 decimals", async () => {
    const vars = {
      ff: makeVar("Font Family / Prompt", "STRING", "Prompt"),
      num: makeVar("Number/Spacing", "FLOAT", 1.23456),
      alias: makeVar("Alias", "STRING", { type: "VARIABLE_ALIAS", id: "ff" }),
    };
    (globalThis as any).figma = makeFigmaMock(
      vars,
      [singleCollection(["ff", "num", "alias"])]
    );

    const result = JSON.parse((await exportToJSON()) as string);
    const variables = result[0].variables;

    expect(variables["Font Family"].Prompt.$value).toBe("Prompt");
    expect(variables["Font Family "]).toBeUndefined();
    expect(variables.Number.Spacing.$value).toBe(1.235);
    expect(variables.Alias.$value).toBe("$..Mode 1.Font Family.Prompt");
  });

  it("emits $hiddenFromPublishing when the variable is hidden", async () => {
    const vars = {
      hidden: makeVar("Secret", "STRING", "s", { hiddenFromPublishing: true }),
    };
    (globalThis as any).figma = makeFigmaMock(vars, [singleCollection(["hidden"])]);

    const result = JSON.parse((await exportToJSON()) as string);

    expect(result[0].variables.Secret.$hiddenFromPublishing).toBe(true);
  });

  it("returns undefined (instead of rejecting) when listing collections fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: async () => {
          throw new Error("figma API unavailable");
        },
      },
    };

    await expect(exportToJSON()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
