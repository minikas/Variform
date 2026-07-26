import { describe, it, expect, afterEach } from "vitest";
import { detectTailwindCategory, exportToTailwind, formatTailwindLength, transformToTailwindName } from "./collectionToTailwind";
import { rgbToTailwindColor } from "./color";

/* ----------------------------- color formatter --------------------------- */

describe("rgbToTailwindColor", () => {
  it("always emits space-separated rgb with an explicit alpha channel", () => {
    expect(rgbToTailwindColor({ r: 0, g: 0, b: 1, a: 1 } as RGBA)).toBe("rgb(0 0 255 / 1)");
    expect(rgbToTailwindColor({ r: 1, g: 1, b: 1, a: 0.25 } as RGBA)).toBe("rgb(255 255 255 / 0.25)");
    expect(rgbToTailwindColor({ r: 1, g: 0, b: 0, a: 0.8 } as RGBA)).toBe("rgb(255 0 0 / 0.8)");
  });
});

/* ----------------------------- pure functions ---------------------------- */

describe("detectTailwindCategory", () => {
  it("detects colors by resolved type even without naming hints", () => {
    expect(detectTailwindCategory("Foo/Bar", "COLOR")).toBe("color");
  });

  it("detects categories from naming conventions", () => {
    expect(detectTailwindCategory("Spacing/4", "FLOAT")).toBe("spacing");
    expect(detectTailwindCategory("Radius/SM", "FLOAT")).toBe("size");
    expect(detectTailwindCategory("Font Family/Sans", "STRING")).toBe("font-family");
    expect(detectTailwindCategory("Weight/Bold", "FLOAT")).toBe("font-weight");
    expect(detectTailwindCategory("Line/Tight", "FLOAT")).toBe("line-height");
    expect(detectTailwindCategory("Shadow/SM", "STRING")).toBe("shadow");
    expect(detectTailwindCategory("Opacity/50", "FLOAT")).toBe("opacity");
    expect(detectTailwindCategory("Duration/Fast", "FLOAT")).toBe("duration");
  });

  it("classifies border widths as lengths and text sizes as typography, not colors", () => {
    // "border"/"text" used to be color keywords and shadowed the branches
    // below them ("Border/Width" → color namespace without a unit).
    expect(detectTailwindCategory("Border/Width", "FLOAT")).toBe("size");
    expect(detectTailwindCategory("Text/Size", "FLOAT")).toBe("font-size");
    expect(detectTailwindCategory("Border/Radius", "FLOAT")).toBe("size");
  });

  it("returns empty string for unrecognized patterns", () => {
    expect(detectTailwindCategory("Foo/Bar", "FLOAT")).toBe("");
  });
});

/* --------------------------- v4 namespace mapping ------------------------ */

describe("transformToTailwindName", () => {
  it("maps categories to real Tailwind v4 theme namespaces", () => {
    expect(transformToTailwindName("Colors/Blue/500", "COLOR")).toBe("--color-colors--blue--500");
    expect(transformToTailwindName("Spacing/4", "FLOAT")).toBe("--spacing-spacing--4");
    expect(transformToTailwindName("Font Family/Sans", "STRING")).toBe("--font-font-family--sans");
    expect(transformToTailwindName("Weight/Bold", "FLOAT")).toBe("--font-weight-weight--bold");
    expect(transformToTailwindName("Line/Tight", "FLOAT")).toBe("--leading-line--tight");
    expect(transformToTailwindName("Letter/Wide", "FLOAT")).toBe("--tracking-letter--wide");
    expect(transformToTailwindName("Shadow/SM", "STRING")).toBe("--shadow-shadow--sm");
  });

  it("splits the legacy size category into radius and spacing", () => {
    expect(transformToTailwindName("Radius/SM", "FLOAT")).toBe("--radius-radius--sm");
    expect(transformToTailwindName("Width/Container", "FLOAT")).toBe("--spacing-width--container");
  });

  it("puts border widths in a length namespace and text sizes in --text-*", () => {
    expect(transformToTailwindName("Border/Width", "FLOAT")).toBe("--spacing-border--width");
    expect(transformToTailwindName("Text/Size", "FLOAT")).toBe("--text-text--size");
  });
});

/* ----------------------------- length formatter -------------------------- */

describe("formatTailwindLength", () => {
  it("keeps px as-is", () => {
    expect(formatTailwindLength(16, "px")).toBe("16px");
    expect(formatTailwindLength(0, "px")).toBe("0px");
  });

  it("converts to rem/em from a 16px base, rounded to 4 decimals", () => {
    expect(formatTailwindLength(16, "rem")).toBe("1rem");
    expect(formatTailwindLength(4, "rem")).toBe("0.25rem");
    expect(formatTailwindLength(10, "em")).toBe("0.625em");
    expect(formatTailwindLength(0, "rem")).toBe("0rem");
  });
});

/* ------------------------- end-to-end with a mock ------------------------ */

function makeFigmaMock() {
  const blue500 = {
    name: "Colors/Blue/500",
    resolvedType: "COLOR",
    valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
  };
  const spacing4 = {
    name: "Spacing/4",
    resolvedType: "FLOAT",
    valuesByMode: { M1: 16 },
  };
  const weightBold = {
    name: "Weight/Bold",
    resolvedType: "FLOAT",
    valuesByMode: { M1: 700 },
  };
  const opacityHalf = {
    name: "Opacity/50",
    resolvedType: "FLOAT",
    valuesByMode: { M1: 0.5 },
  };
  const durationFast = {
    name: "Duration/Fast",
    resolvedType: "FLOAT",
    valuesByMode: { M1: 150 },
  };
  const borderWidth = {
    name: "Border/Width",
    resolvedType: "FLOAT",
    valuesByMode: { M1: 2 },
  };
  const lineTight = {
    name: "Line/Tight",
    resolvedType: "FLOAT",
    valuesByMode: { M1: 24 },
  };
  const contentQuote = {
    name: "Content/Quote",
    resolvedType: "STRING",
    valuesByMode: { M1: 'say "hi"\nbye' },
  };
  const described = {
    name: "Colors/Described",
    resolvedType: "COLOR",
    description: "closes */ early",
    valuesByMode: { M1: { r: 1, g: 0, b: 0, a: 1 } },
  };
  const brokenRef = {
    name: "Background/Broken",
    resolvedType: "COLOR",
    valuesByMode: { M1: { type: "VARIABLE_ALIAS", id: "missing" } },
  };
  const surfaceCard = {
    name: "Surface/Card",
    resolvedType: "COLOR",
    valuesByMode: {
      L: { r: 1, g: 1, b: 1, a: 1 },
      D: { r: 0, g: 0, b: 0, a: 1 },
      C: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    },
  };
  const gutter = {
    name: "Spacing/Gutter",
    resolvedType: "FLOAT",
    valuesByMode: { DK: 24, MB: 16 },
  };
  const gap = {
    name: "Spacing/Gap",
    resolvedType: "FLOAT",
    valuesByMode: { DK2: 8, MB2: 4 },
  };
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: [
      "blue500", "spacing4", "weightBold", "opacityHalf", "durationFast",
      "borderWidth", "lineTight", "contentQuote", "described", "brokenRef",
    ],
  };
  const tokens = {
    id: "c2",
    name: "Tokens",
    modes: [
      { name: "Light", modeId: "L" },
      { name: "Dark", modeId: "D" },
      { name: "Contrast", modeId: "C" },
    ],
    variableIds: ["surfaceCard"],
  };
  // Two collections with homonymous non-light/dark modes (Desktop/Mobile) to
  // exercise the first-selected-mode default and the variant dedupe.
  const responsive = {
    id: "c4",
    name: "Responsive",
    modes: [
      { name: "Desktop", modeId: "DK" },
      { name: "Mobile", modeId: "MB" },
    ],
    variableIds: ["gutter"],
  };
  const breakpoints = {
    id: "c5",
    name: "Breakpoints",
    modes: [
      { name: "Desktop", modeId: "DK2" },
      { name: "Mobile", modeId: "MB2" },
    ],
    variableIds: ["gap"],
  };
  const vars: Record<string, any> = {
    blue500, spacing4, weightBold, opacityHalf, durationFast, borderWidth,
    lineTight, contentQuote, described, brokenRef, surfaceCard, gutter, gap,
  };
  const collections: Record<string, any> = { c1: primitives, c2: tokens, c4: responsive, c5: breakpoints };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [primitives, tokens, responsive, breakpoints],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections[id] ?? null,
    },
    getLocalTextStylesAsync: async () => [
      {
        name: "Body/Base",
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 16,
        lineHeight: { unit: "PIXELS", value: 24 },
        letterSpacing: { unit: "PIXELS", value: 0 },
      },
    ],
    getLocalPaintStylesAsync: async () => [
      { name: "Brand/Primary", paints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 }, opacity: 1 }] },
    ],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
  };
}

describe("exportToTailwind — prefix option", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("emits the category namespace without a prefix by default", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, { text: false, paint: false, effect: false, grid: false });
    expect(result).toContain("--color-colors--blue--500: rgb(0 0 255 / 1);");
    expect(result).not.toContain("--color-acme-");
  });

  it("inserts the sanitized prefix right after the category segment", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, { text: false, paint: false, effect: false, grid: false }, "Acme Co");
    expect(result).toContain("--color-acme-co-colors--blue--500: rgb(0 0 255 / 1);");
  });

  it("converts lengths to the chosen unit", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const px = await exportToTailwind(undefined, { text: false, paint: false, effect: false, grid: false });
    expect(px).toContain("--spacing-spacing--4: 16px;");

    const rem = await exportToTailwind(undefined, { text: false, paint: false, effect: false, grid: false }, "", "rem");
    expect(rem).toContain("--spacing-spacing--4: 1rem;");
  });

  it("keeps non-length numbers unitless and durations in ms", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, { text: false, paint: false, effect: false, grid: false });
    expect(result).toContain("--font-weight-weight--bold: 700;");
    expect(result).toContain("--opacity-opacity--50: 0.5;");
    expect(result).toContain("--duration-duration--fast: 150ms;");
  });

  it("never emits the `import(` sequence (breaks the Figma plugin runtime)", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, { text: false, paint: false, effect: false, grid: false });
    expect(result).not.toContain("import(");
  });
});

describe("exportToTailwind — modes (light/dark/themes)", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  const NO_STYLES = { text: false, paint: false, effect: false, grid: false };

  it("puts Light/Default values in @theme and Dark values in a media query", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, NO_STYLES);

    const [beforeMedia, ...mediaRest] = result.split("@media (prefers-color-scheme: dark)");
    expect(mediaRest.length).toBe(1);

    // Light value is the @theme default; the dark value only appears inside
    // the media query (never overriding the default in @theme).
    expect(beforeMedia).toContain("--color-surface--card: rgb(255 255 255 / 1);");
    expect(beforeMedia).not.toContain("rgb(0 0 0 / 1)");
    expect(mediaRest[0]).toContain("--color-surface--card: rgb(0 0 0 / 1);");
  });

  it("scopes other modes to [data-theme] blocks with a matching @custom-variant", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, NO_STYLES);

    expect(result).toContain('[data-theme="Contrast"] {');
    expect(result).toContain("--color-surface--card: rgb(128 128 128 / 1);");
    expect(result).toContain('@custom-variant theme-contrast (&:where([data-theme="Contrast"] *));');
    // Themed value must not leak into the @theme defaults.
    const themeBlock = result.split("@media")[0].split("[data-theme]")[0];
    expect(themeBlock).not.toContain("rgb(128 128 128 / 1)");
  });

  it("uses the first selected mode as the @theme default on a Dark-only selection", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind({ c2: ["D"] }, NO_STYLES);

    // No Light/Default mode selected: Dark becomes the default, so @theme is
    // populated and no dark media query is emitted.
    expect(result).toContain("--color-surface--card: rgb(0 0 0 / 1);");
    expect(result).not.toContain("@media (prefers-color-scheme: dark)");
    expect(result).not.toContain("[data-theme=");
  });

  it("falls back to the first selected mode for collections without Light/Dark modes", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, NO_STYLES);

    // Desktop/Mobile collections: Desktop (first mode) holds the @theme
    // defaults, Mobile becomes a [data-theme] override block.
    expect(result).toContain("--spacing-spacing--gutter: 24px;");
    expect(result).toContain('[data-theme="Mobile"] {');
    expect(result).toContain("--spacing-spacing--gutter: 16px;");
    expect(result).toContain('@custom-variant theme-mobile (&:where([data-theme="Mobile"] *));');
  });

  it("emits a single @custom-variant for homonymous modes across collections", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, NO_STYLES);

    // Both c4 and c5 have a "Mobile" mode: the variant directive must appear
    // only once, while each collection keeps its own [data-theme] block.
    expect(result.split("@custom-variant theme-mobile").length - 1).toBe(1);
    expect(result.split('[data-theme="Mobile"] {').length - 1).toBe(2);
  });
});

describe("exportToTailwind — values and escaping", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  const NO_STYLES = { text: false, paint: false, effect: false, grid: false };

  it("applies the unit to border widths and line-heights", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const px = await exportToTailwind(undefined, NO_STYLES);
    expect(px).toContain("--spacing-border--width: 2px;");
    expect(px).toContain("--leading-line--tight: 24px;");

    const rem = await exportToTailwind(undefined, NO_STYLES, "", "rem");
    expect(rem).toContain("--spacing-border--width: 0.125rem;");
    expect(rem).toContain("--leading-line--tight: 1.5rem;");
  });

  it("escapes quotes, backslashes and line breaks inside STRING values", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, NO_STYLES);
    expect(result).toContain('--content--quote: "say \\"hi\\"\\nbye";');
  });

  it("sanitizes descriptions that would close the CSS comment early", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, NO_STYLES);
    expect(result).toContain("/* closes * / early */");
    expect(result).not.toContain("closes */ early");
  });

  it("skips broken aliases with a comment instead of emitting `initial`", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(undefined, NO_STYLES);
    expect(result).toContain("/* unresolved alias: --color-background--broken */");
    expect(result).not.toContain("--color-background--broken: initial;");
    expect(result).not.toContain(": initial;");
  });
});

describe("exportToTailwind — style tokens wiring", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("passes the prefix and unit options through to the style tokens", async () => {
    (globalThis as any).figma = makeFigmaMock();
    const result = await exportToTailwind(
      undefined,
      { text: true, paint: true, effect: false, grid: false },
      "acme",
      "rem"
    );

    // Paint style tokens honor the prefix; text style tokens honor the unit.
    expect(result).toContain("--color-acme-brand--primary:");
    expect(result).toContain("--text-body--base: 1rem;");
    expect(result).toContain("--text-body--base--line-height: 1.5rem;");
  });
});
