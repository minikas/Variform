import { describe, it, expect } from "vitest";
import { getMatchingModeName } from "./variableUtils";

const collection = (modes: Array<{ name: string; modeId: string }>, id = "c1") =>
  ({ id, name: "Collection", modes } as unknown as VariableCollection);

describe("getMatchingModeName", () => {
  it("returns the exact match when one exists", () => {
    const c = collection([
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ]);
    expect(getMatchingModeName("Dark", c)).toBe("Dark");
  });

  it("prefers the exact match over a normalized one", () => {
    const c = collection([
      { name: "dark", modeId: "d1" },
      { name: "Dark", modeId: "d2" },
    ]);
    expect(getMatchingModeName("Dark", c)).toBe("Dark");
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    const c = collection([
      { name: "Light", modeId: "L" },
      { name: "dark ", modeId: "D" },
    ]);
    expect(getMatchingModeName("Dark", c)).toBe("dark ");
    expect(getMatchingModeName(" DARK", c)).toBe("dark ");
  });

  it("falls back to the first selected mode when a selection is provided", () => {
    const c = collection(
      [
        { name: "Light", modeId: "L" },
        { name: "Contrast", modeId: "C" },
      ],
      "c2"
    );
    // "Dark" does not exist; modes[0] (Light) is deselected, so the fallback
    // must be the first selected mode (Contrast), not modes[0].
    expect(getMatchingModeName("Dark", c, { c2: ["C"] })).toBe("Contrast");
  });

  it("falls back to modes[0] when nothing matches and there is no selection", () => {
    const c = collection([
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
    ]);
    expect(getMatchingModeName("Contrast", c)).toBe("Light");
  });

  it("falls back to modes[0] when the selection has no mode of the collection", () => {
    const c = collection(
      [
        { name: "Light", modeId: "L" },
        { name: "Dark", modeId: "D" },
      ],
      "c3"
    );
    expect(getMatchingModeName("Contrast", c, { other: ["X"] })).toBe("Light");
  });
});
