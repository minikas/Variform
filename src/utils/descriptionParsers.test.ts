import { describe, it, expect } from "vitest";
import {
  applyDescriptionParser,
  descriptionToString,
  descriptionParsers,
  NO_PARSER_ID,
} from "./descriptionParsers";

describe("applyDescriptionParser", () => {
  it("returns the raw string when no parser is selected", () => {
    expect(applyDescriptionParser('{"id":"x"}', NO_PARSER_ID)).toBe('{"id":"x"}');
    expect(applyDescriptionParser('{"id":"x"}', undefined)).toBe('{"id":"x"}');
  });

  it("returns the raw string for an unknown parser id", () => {
    expect(applyDescriptionParser("{}", "does-not-exist")).toBe("{}");
  });
});

describe("description-to-json parser", () => {
  const parse = (raw: string) => applyDescriptionParser(raw, "description-to-json");

  it("is registered", () => {
    expect(descriptionParsers.some((p) => p.id === "description-to-json")).toBe(true);
  });

  it("parses a valid JSON object", () => {
    expect(parse('{"id":"testando","n":1}')).toEqual({ id: "testando", n: 1 });
  });

  it("parses JSON arrays and primitives", () => {
    expect(parse("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parse("42")).toBe(42);
  });

  it("falls back to the raw string on invalid JSON", () => {
    expect(parse("just a note")).toBe("just a note");
  });

  it("returns an empty string for a blank description", () => {
    expect(parse("   ")).toBe("");
  });
});

describe("descriptionToString", () => {
  it("passes strings through and stringifies objects", () => {
    expect(descriptionToString("hi")).toBe("hi");
    expect(descriptionToString({ a: 1 })).toBe('{"a":1}');
    expect(descriptionToString([1, 2])).toBe("[1,2]");
  });
});
