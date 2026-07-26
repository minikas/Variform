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
  const surfaceCard = {
    name: "Surface/Card",
    resolvedType: "COLOR",
    valuesByMode: {
      L: { r: 1, g: 1, b: 1, a: 1 },
      D: { r: 0, g: 0, b: 0, a: 1 },
      C: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    },
  };
  const primitives = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["blue500", "spacing4", "weightBold", "opacityHalf", "durationFast"],
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
  const vars: Record<string, any> = { blue500, spacing4, weightBold, opacityHalf, durationFast, surfaceCard };
  const collections: Record<string, any> = { c1: primitives, c2: tokens };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [primitives, tokens],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => collections[id] ?? null,
    },
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
});
