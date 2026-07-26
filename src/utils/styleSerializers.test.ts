import { describe, it, expect, vi, afterEach } from "vitest";
import {
  stylesToInspectRows,
  stylesToJsStatements,
  stylesToTailwindTokens,
  buildStyleTokenTrees,
  sanitizeCssComment,
  toCssClassName,
  STYLE_CONST_NAMES,
} from "./styleSerializers";

const emptyStyles = { text: [], paint: [], effect: [], grid: [] } as any;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stylesToInspectRows", () => {
  it("returns no rows when there are no local styles", () => {
    expect(stylesToInspectRows(emptyStyles)).toEqual([]);
  });

  it("builds [name, kind, value, description] rows per style kind", () => {
    const styles = {
      ...emptyStyles,
      paint: [
        {
          name: "Brand/Accent",
          description: "primary",
          paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
        },
      ],
    } as any;

    const rows = stylesToInspectRows(styles);

    expect(rows).toHaveLength(1);
    const [name, kind, value, description] = rows[0];
    expect(name).toBe("Brand/Accent");
    expect(kind).toBe("Paint");
    expect(value.length).toBeGreaterThan(0);
    expect(description).toBe("primary");
  });
});

describe("sanitizeCssComment", () => {
  it("neutralizes comment-closing and HTML-comment sequences", () => {
    expect(sanitizeCssComment("ends here */ .evil {}")).toBe("ends here * / .evil {}");
    expect(sanitizeCssComment("a <!-- b")).toBe("a < !-- b");
    expect(sanitizeCssComment("plain text")).toBe("plain text");
  });
});

describe("toCssClassName", () => {
  it("prefixes names starting with a digit", () => {
    expect(toCssClassName("24px/Body")).toBe("_24px--body");
  });

  it("strips characters outside [a-z0-9_-]", () => {
    expect(toCssClassName("Título (grande)!")).toBe("ttulo-grande");
  });

  it("keeps already-valid names untouched", () => {
    expect(toCssClassName("Heading/H1")).toBe("heading--h1");
  });
});

describe("buildStyleTokenTrees (nestToken)", () => {
  const textStyle = (name: string) =>
    ({
      name,
      description: "",
      fontName: { family: "Inter", style: "Regular" },
      fontSize: 16,
      lineHeight: { unit: "AUTO" },
      letterSpacing: { unit: "PERCENT", value: 0 },
      textCase: "ORIGINAL",
      textDecoration: "NONE",
      paragraphSpacing: 0,
    } as unknown as TextStyle);

  it("nests slash-delimited names into a token tree", () => {
    const trees = buildStyleTokenTrees({ ...emptyStyles, text: [textStyle("Heading/H1")] });
    expect(trees.textStyles.Heading.H1.$type).toBe("typography");
  });

  it("warns and skips on token/group collision instead of mixing or overwriting", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const trees = buildStyleTokenTrees({
      ...emptyStyles,
      text: [textStyle("a"), textStyle("a/b"), textStyle("a")],
    });

    expect(trees.textStyles.a.$type).toBe("typography");  // first token kept
    expect(trees.textStyles.a.b).toBeUndefined();         // nested one skipped
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("creates __proto__ segments as own properties without polluting Object.prototype", () => {
    const trees = buildStyleTokenTrees({ ...emptyStyles, text: [textStyle("__proto__/polluted")] });

    expect((Object.prototype as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(trees.textStyles, "__proto__")).toBe(true);
    expect(JSON.stringify(trees.textStyles)).toContain('"__proto__"');
  });
});

describe("stylesToJsStatements", () => {
  const paint = {
    name: "Brand/Accent",
    description: "",
    paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
  } as any;

  it("emits one exported const per non-empty style kind", () => {
    const out = stylesToJsStatements({ ...emptyStyles, paint: [paint] });
    expect(out).toContain("export const paintStyles = {");
    expect(out).not.toContain("textStyles");
    expect(STYLE_CONST_NAMES).toEqual(["textStyles", "paintStyles", "effectStyles", "gridStyles"]);
  });

  it("suffixes const names that collide with reserved names", () => {
    const out = stylesToJsStatements({ ...emptyStyles, paint: [paint] }, new Set(["paintStyles"]));
    expect(out).toContain("export const paintStyles2 = {");
    expect(out).not.toContain("export const paintStyles =");
  });

  it("never rewrites key-like patterns inside string values", () => {
    const noted = { ...paint, description: "Note: test" };
    const out = stylesToJsStatements({ ...emptyStyles, paint: [noted] });
    expect(out).toContain('"Note: test"');
  });
});

describe("stylesToTailwindTokens", () => {
  const paint = {
    name: "Brand/Accent",
    description: "",
    paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
  } as any;
  const text = {
    name: "Body/Regular",
    description: "",
    fontName: { family: "Inter", style: "Regular" },
    fontSize: 16,
    lineHeight: { unit: "PIXELS", value: 24 },
    letterSpacing: { unit: "PIXELS", value: 2 },
    textCase: "ORIGINAL",
    textDecoration: "NONE",
    paragraphSpacing: 0,
  } as any;
  const grid = {
    name: "Desktop/12col",
    description: "",
    layoutGrids: [{ pattern: "COLUMNS", count: 12, gutterSize: 24, sectionSize: 80, visible: true }],
  } as any;

  it("applies the prefix to paint tokens", () => {
    const tokens = stylesToTailwindTokens({ ...emptyStyles, paint: [paint] }, "acme");
    expect(tokens).toContain("  --color-acme-brand--accent: #ff0000;");
  });

  it("converts px text lengths to the chosen unit (16px base)", () => {
    const tokens = stylesToTailwindTokens({ ...emptyStyles, text: [text] }, "", "rem");
    expect(tokens).toContain("  --text-body--regular: 1rem;");
    expect(tokens).toContain("  --text-body--regular--line-height: 1.5rem;");
    expect(tokens).toContain("  --text-body--regular--letter-spacing: 0.125rem;");
  });

  it("keeps px by default", () => {
    const tokens = stylesToTailwindTokens({ ...emptyStyles, text: [text] });
    expect(tokens).toContain("  --text-body--regular: 16px;");
  });

  it("documents grid styles in a comment block instead of dropping them", () => {
    const tokens = stylesToTailwindTokens({ ...emptyStyles, grid: [grid] });
    const comment = tokens.find((line) => line.includes("Grid Styles"));
    expect(comment).toContain("/*");
    expect(comment).toContain("Desktop/12col");
    expect(comment).toContain("COLUMNS count=12");
  });
});
