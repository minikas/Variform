import { describe, it, expect } from "vitest";
import { toJsObjectLiteral } from "./jsSerialize";

/** Evaluates the literal and returns the resulting value. */
const evaluate = (literal: string): unknown =>
  new Function(`return ${literal}`)();

describe("toJsObjectLiteral", () => {
  it("leaves identifier-safe keys unquoted and quotes the rest", () => {
    const out = toJsObjectLiteral({ blue: 1, "blue-500": 2, "has space": 3, "has.dot": 4, "500": 5 });
    expect(out).toContain("blue: 1");
    expect(out).toContain('"blue-500": 2');
    expect(out).toContain('"has space": 3');
    expect(out).toContain('"has.dot": 4');
    expect(out).toContain('"500": 5');
  });

  it("quotes reserved-word keys", () => {
    const out = toJsObjectLiteral({ default: 1, class: 2, normal: 3 });
    expect(out).toContain('"default": 1');
    expect(out).toContain('"class": 2');
    expect(out).toContain("normal: 3");
  });

  it("never rewrites key-like patterns inside string values", () => {
    // The old JSON.stringify + unquote-regex idiom corrupted these.
    const input = { note: "Note: test", nested: { text: 'embedded {"foo": 1} json' } };
    const out = toJsObjectLiteral(input);
    expect(out).toContain('"Note: test"');
    expect(evaluate(out)).toEqual(input);
  });

  it("serializes nested objects and arrays", () => {
    const input = {
      theme: { extend: { colors: { blue: { "500": "#0000ff" } }, list: [1, "two", true, null] } },
      empty: {},
      emptyList: [],
    };
    expect(evaluate(toJsObjectLiteral(input))).toEqual(input);
  });

  it("round-trips arbitrary dictionaries through eval", () => {
    const input = {
      colors: { primary: "rgb(from var(--color-primary, #ff0000) r g b / <alpha-value>)" },
      spacing: { "4": "16px" },
      fontWeight: { bold: 700 },
      flag: { on: true, off: false, nothing: null },
    };
    expect(evaluate(toJsObjectLiteral(input))).toEqual(input);
  });

  it("respects a custom indent", () => {
    const out = toJsObjectLiteral({ a: { b: 1 } }, 4);
    expect(out).toBe('{\n    a: {\n        b: 1\n    }\n}');
  });
});
