import { describe, it, expect } from "vitest";
import { toCamelCase, toCssVar } from "./stringTransformation";

describe("toCamelCase", () => {
  it("keeps the all-caps shortcut (returns the string without spaces)", () => {
    expect(toCamelCase("DARK")).toBe("DARK");
    expect(toCamelCase("DARK MODE")).toBe("DARKMODE");
    // Existing quirk with the all-caps detection off: only the first letter
    // is lowercased ("dARK"), kept as-is for backwards compatibility.
    expect(toCamelCase("DARK", false)).toBe("dARK");
  });

  it("camelCases common ASCII names", () => {
    expect(toCamelCase("hello world")).toBe("helloWorld");
    expect(toCamelCase("hello-world")).toBe("helloWorld");
    expect(toCamelCase("Blue 500")).toBe("blue500");
    expect(toCamelCase("foo.bar")).toBe("foo_Bar"); // dots become underscores
    expect(toCamelCase("alreadyCamel")).toBe("alreadyCamel");
  });

  it("does not uppercase letters after accented characters", () => {
    expect(toCamelCase("Ação")).toBe("ação");
    expect(toCamelCase("Açúcar")).toBe("açúcar");
    expect(toCamelCase("Botão Primário")).toBe("botãoPrimário");
  });

  it("handles leading digits and underscores", () => {
    expect(toCamelCase("4px")).toBe("4px");
    expect(toCamelCase("spacing 4")).toBe("spacing4");
  });
});

describe("toCssVar", () => {
  it("converts to a kebab-case CSS variable name", () => {
    expect(toCssVar("Colors/Blue 500")).toBe("colors--blue-500");
    expect(toCssVar("a.b", true)).toBe("--a_b");
  });
});
