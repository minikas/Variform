import { describe, it, expect } from "vitest";
import {
  computeDiff,
  diffMaps,
  flattenJson,
  lineDiff,
  parseCssVars,
} from "./tokenDiff";

describe("flattenJson", () => {
  it("flattens nested objects into dotted paths", () => {
    const map = flattenJson('{"color":{"primary":"#fff","secondary":"#000"}}');
    expect(map?.get("color.primary")).toBe("#fff");
    expect(map?.get("color.secondary")).toBe("#000");
  });

  it("indexes array entries", () => {
    const map = flattenJson('{"sizes":[8,16]}');
    expect(map?.get("sizes[0]")).toBe("8");
    expect(map?.get("sizes[1]")).toBe("16");
  });

  it("returns null for invalid JSON", () => {
    expect(flattenJson("{ not json")).toBeNull();
  });

  it("does not collide when a key itself contains a dot", () => {
    // {"a":{"b":1}} and {"a.b":1} must not both flatten to the "a.b" key.
    const nested = flattenJson('{"a":{"b":1}}');
    const dotted = flattenJson('{"a.b":1}');
    expect(nested?.get("a.b")).toBe("1");
    expect(dotted?.get("a\\.b")).toBe("1");
    expect(nested?.size).toBe(1);
    expect(dotted?.size).toBe(1);

    const merged = flattenJson('{"a":{"b":1},"a.b":2}');
    expect(merged?.size).toBe(2);
    expect(merged?.get("a.b")).toBe("1");
    expect(merged?.get("a\\.b")).toBe("2");
  });

  it("does not collide between a literal bracket key and an array index", () => {
    const map = flattenJson('{"sizes[0]":8,"sizes":[16]}');
    expect(map?.get("sizes\\[0\\]")).toBe("8");
    expect(map?.get("sizes[0]")).toBe("16");
    expect(map?.size).toBe(2);
  });
});

describe("parseCssVars", () => {
  it("namespaces variables by selector context", () => {
    const css = `:root { --color-primary: #fff; }
    @media (prefers-color-scheme: dark) { :root { --color-primary: #000; } }`;
    const map = parseCssVars(css);
    expect(map.get(":root | --color-primary")).toBe("#fff");
    expect(
      map.get("@media (prefers-color-scheme: dark) > :root | --color-primary"),
    ).toBe("#000");
  });

  it("ignores comments and non-variable declarations", () => {
    const css = `/* comment */ :root { color: red; --gap: 4px; }`;
    const map = parseCssVars(css);
    expect(map.get(":root | --gap")).toBe("4px");
    expect(map.size).toBe(1);
  });

  it("parses the last declaration of a block even without a trailing semicolon", () => {
    const css = `:root { --gap: 4px; --color-primary: #fff }`;
    const map = parseCssVars(css);
    expect(map.get(":root | --gap")).toBe("4px");
    expect(map.get(":root | --color-primary")).toBe("#fff");
    expect(map.size).toBe(2);
  });

  it("does not split declarations on semicolons inside quoted strings", () => {
    const css = `:root { --font-stack: "Inter; fallback", sans-serif; --gap: 4px; }`;
    const map = parseCssVars(css);
    expect(map.get(":root | --font-stack")).toBe('"Inter; fallback", sans-serif');
    expect(map.get(":root | --gap")).toBe("4px");
    expect(map.size).toBe(2);
  });

  it("does not corrupt the selector stack on braces inside quoted strings", () => {
    const css = `:root { --icon: url("a{b}c.svg"); --gap: 4px; }
    .dark { --gap: 8px; }`;
    const map = parseCssVars(css);
    expect(map.get(":root | --icon")).toBe('url("a{b}c.svg")');
    expect(map.get(":root | --gap")).toBe("4px");
    // The ".dark" block must nest under nothing — a corrupted stack would
    // have kept stray selectors around.
    expect(map.get(".dark | --gap")).toBe("8px");
    expect(map.size).toBe(3);
  });

  it("handles escaped quotes inside strings", () => {
    const css = `:root { --quote: "a\\";b"; --gap: 4px; }`;
    const map = parseCssVars(css);
    expect(map.get(":root | --quote")).toBe('"a\\";b"');
    expect(map.get(":root | --gap")).toBe("4px");
    expect(map.size).toBe(2);
  });
});

describe("diffMaps", () => {
  it("classifies added, updated, and removed entries", () => {
    const oldMap = new Map([
      ["a", "1"],
      ["b", "2"],
    ]);
    const newMap = new Map([
      ["a", "1"],
      ["b", "9"],
      ["c", "3"],
    ]);
    const changes = diffMaps(oldMap, newMap);

    expect(changes).toContainEqual({ key: "c", type: "added", newValue: "3" });
    expect(changes).toContainEqual({
      key: "b",
      type: "updated",
      oldValue: "2",
      newValue: "9",
    });
    // "a" is unchanged and must not appear
    expect(changes.find((c) => c.key === "a")).toBeUndefined();
  });
});

describe("lineDiff", () => {
  it("reports added and removed non-empty lines", () => {
    const changes = lineDiff("export const a = 1;\nexport const b = 2;", "export const a = 1;\nexport const b = 3;");
    expect(changes).toContainEqual({
      key: expect.any(String),
      type: "removed",
      oldValue: "export const b = 2;",
    });
    expect(changes).toContainEqual({
      key: expect.any(String),
      type: "added",
      newValue: "export const b = 3;",
    });
  });
});

describe("computeDiff", () => {
  it("does a token-level diff for JSON", () => {
    const result = computeDiff(
      "json",
      '{"color":{"primary":"#fff"}}',
      '{"color":{"primary":"#000","accent":"#f00"}}',
    );
    expect(result.isLineDiff).toBe(false);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(1);
    const updated = result.changes.find((c) => c.type === "updated");
    expect(updated).toMatchObject({
      key: "color.primary",
      oldValue: "#fff",
      newValue: "#000",
    });
  });

  it("does a token-level diff for CSS", () => {
    const result = computeDiff(
      "css",
      ":root { --gap: 4px; }",
      ":root { --gap: 8px; }",
    );
    expect(result.isLineDiff).toBe(false);
    expect(result.updated).toBe(1);
    expect(result.changes[0]).toMatchObject({ oldValue: "4px", newValue: "8px" });
  });

  it("treats a missing previous file as all additions", () => {
    const result = computeDiff("json", null, '{"a":"1","b":"2"}');
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("falls back to a line diff for JS", () => {
    const result = computeDiff(
      "js",
      "export const a = 1;",
      "export const a = 2;",
    );
    expect(result.isLineDiff).toBe(true);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("falls back to a line diff when JSON cannot be parsed", () => {
    const result = computeDiff("json", "not json", "still not json");
    expect(result.isLineDiff).toBe(true);
  });
});
