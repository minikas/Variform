import { describe, it, expect } from "vitest";
import {
  isCollectionSelected,
  isModeSelected,
  selectedModes,
} from "./selectionUtils";
import type { ExportSelection } from "../types.d";

const MODES = [
  { modeId: "L", name: "Light" },
  { modeId: "D", name: "Dark" },
];

describe("isCollectionSelected", () => {
  it("treats an undefined selection as 'export everything'", () => {
    expect(isCollectionSelected("any", undefined)).toBe(true);
  });

  it("is true only when the collection has at least one selected mode", () => {
    const selection: ExportSelection = { c1: ["L"], c2: [] };
    expect(isCollectionSelected("c1", selection)).toBe(true);
    expect(isCollectionSelected("c2", selection)).toBe(false);
    expect(isCollectionSelected("missing", selection)).toBe(false);
  });
});

describe("isModeSelected", () => {
  it("treats an undefined selection as 'export everything'", () => {
    expect(isModeSelected("c1", "L", undefined)).toBe(true);
  });

  it("checks membership of the mode in the collection's selected list", () => {
    const selection: ExportSelection = { c1: ["L"] };
    expect(isModeSelected("c1", "L", selection)).toBe(true);
    expect(isModeSelected("c1", "D", selection)).toBe(false);
    expect(isModeSelected("missing", "L", selection)).toBe(false);
  });
});

describe("selectedModes", () => {
  it("returns a fresh copy of every mode when selection is undefined", () => {
    const result = selectedModes("c1", MODES, undefined);
    expect(result).toEqual(MODES);
    expect(result).not.toBe(MODES);
  });

  it("returns only the selected modes, preserving order", () => {
    const selection: ExportSelection = { c1: ["D"] };
    expect(selectedModes("c1", MODES, selection)).toEqual([
      { modeId: "D", name: "Dark" },
    ]);
  });

  it("returns an empty array when the collection is not selected", () => {
    expect(selectedModes("c1", MODES, { c1: [] })).toEqual([]);
    expect(selectedModes("c1", MODES, {})).toEqual([]);
  });
});
