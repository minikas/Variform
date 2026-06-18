import { describe, it, expect } from "vitest";
import {
  initSelection,
  deselectAllSelection,
  toggleMode,
  getCollectionCheckedState,
  toggleCollection,
  hasAnySelection,
  reconcileSelection,
} from "./selectionState";
import type { CollectionMeta } from "../types.d";

const COLLECTIONS: CollectionMeta[] = [
  {
    id: "colors",
    name: "Colors",
    modes: [
      { modeId: "L", name: "Light" },
      { modeId: "D", name: "Dark" },
    ],
  },
  {
    id: "spacing",
    name: "Spacing",
    modes: [{ modeId: "M1", name: "Mode 1" }],
  },
];

describe("initSelection", () => {
  it("selects every mode of every collection", () => {
    expect(initSelection(COLLECTIONS)).toEqual({
      colors: ["L", "D"],
      spacing: ["M1"],
    });
  });
});

describe("deselectAllSelection", () => {
  it("keeps a key per collection mapped to an empty array", () => {
    expect(deselectAllSelection(COLLECTIONS)).toEqual({
      colors: [],
      spacing: [],
    });
  });
});

describe("toggleMode", () => {
  it("removes a selected mode and keeps the rest", () => {
    const result = toggleMode({ colors: ["L", "D"] }, "colors", "L");
    expect(result.colors).toEqual(["D"]);
  });

  it("adds an unselected mode", () => {
    const result = toggleMode({ colors: ["L"] }, "colors", "D");
    expect(result.colors).toEqual(["L", "D"]);
  });

  it("does not mutate the input selection", () => {
    const input = { colors: ["L", "D"] };
    toggleMode(input, "colors", "L");
    expect(input.colors).toEqual(["L", "D"]);
  });
});

describe("getCollectionCheckedState", () => {
  it("is true when all modes are selected", () => {
    expect(getCollectionCheckedState({ colors: ["L", "D"] }, COLLECTIONS[0])).toBe(true);
  });

  it("is false when no modes are selected", () => {
    expect(getCollectionCheckedState({ colors: [] }, COLLECTIONS[0])).toBe(false);
  });

  it("is indeterminate when some but not all modes are selected", () => {
    expect(getCollectionCheckedState({ colors: ["L"] }, COLLECTIONS[0])).toBe(
      "indeterminate"
    );
  });
});

describe("toggleCollection", () => {
  it("clears a fully selected collection", () => {
    const result = toggleCollection({ colors: ["L", "D"] }, COLLECTIONS[0]);
    expect(result.colors).toEqual([]);
  });

  it("selects all modes of a partially selected collection", () => {
    const result = toggleCollection({ colors: ["L"] }, COLLECTIONS[0]);
    expect(result.colors).toEqual(["L", "D"]);
  });

  it("selects all modes of an empty collection", () => {
    const result = toggleCollection({ colors: [] }, COLLECTIONS[0]);
    expect(result.colors).toEqual(["L", "D"]);
  });
});

describe("hasAnySelection", () => {
  it("is false when every collection is empty", () => {
    expect(hasAnySelection({ colors: [], spacing: [] })).toBe(false);
  });

  it("is true when at least one mode is selected", () => {
    expect(hasAnySelection({ colors: [], spacing: ["M1"] })).toBe(true);
  });
});

describe("reconcileSelection", () => {
  it("keeps stored modes that still exist and drops stale ones", () => {
    const stored = { colors: ["L", "GONE"], spacing: ["M1"] };
    expect(reconcileSelection(stored, COLLECTIONS)).toEqual({
      colors: ["L"],
      spacing: ["M1"],
    });
  });

  it("preserves an explicitly deselected (empty) collection", () => {
    const stored = { colors: [], spacing: ["M1"] };
    expect(reconcileSelection(stored, COLLECTIONS)).toEqual({
      colors: [],
      spacing: ["M1"],
    });
  });

  it("treats a collection unknown to the stored state as fully selected", () => {
    const stored = { spacing: ["M1"] };
    expect(reconcileSelection(stored, COLLECTIONS)).toEqual({
      colors: ["L", "D"],
      spacing: ["M1"],
    });
  });

  it("ignores stored collections that no longer exist", () => {
    const stored = { colors: ["L", "D"], spacing: ["M1"], deleted: ["x"] };
    expect(reconcileSelection(stored, COLLECTIONS)).toEqual({
      colors: ["L", "D"],
      spacing: ["M1"],
    });
  });
});
