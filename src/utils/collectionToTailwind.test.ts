import { describe, it, expect, afterEach } from "vitest";
import { detectTailwindCategory, exportToTailwind, formatTailwindLength } from "./collectionToTailwind";
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
  const collection = {
    id: "c1",
    name: "Primitives",
    modes: [{ name: "Mode 1", modeId: "M1" }],
    variableIds: ["blue500", "spacing4"],
  };
  const vars: Record<string, any> = { blue500, spacing4 };

  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async () => collection,
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
});
