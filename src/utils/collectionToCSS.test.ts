import { describe, it, expect, afterEach } from "vitest";
import { exportToCSS } from "./collectionToCSS";
import { NO_STYLES } from "./styleSelection";

function makeFigmaMock(collections: any[], vars: Record<string, any>) {
  const byId: Record<string, any> = Object.fromEntries(collections.map((c) => [c.id, c]));
  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => vars[id] ?? null,
      getVariableCollectionByIdAsync: async (id: string) => byId[id] ?? null,
    },
  };
}

function setFigma(collections: any[], vars: Record<string, any>) {
  (globalThis as any).figma = makeFigmaMock(collections, vars);
}

/** Extracts the `:root { ... }` block from the export. */
function rootBlockOf(css: string): string {
  return css.slice(css.indexOf(":root {"), css.indexOf("\n}") + 2);
}

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("exportToCSS", () => {
  afterEach(() => {
    delete (globalThis as any).figma;
  });

  it("keeps unitless FLOAT keywords unitless and appends px to the rest", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [{ name: "Default", modeId: "M" }],
      variableIds: ["opacity", "spacing", "weight", "zindex", "scale"],
    };
    setFigma([collection], {
      opacity: { name: "Opacity", resolvedType: "FLOAT", valuesByMode: { M: 0.5 } },
      spacing: { name: "Spacing/4", resolvedType: "FLOAT", valuesByMode: { M: 16 } },
      weight: { name: "Font Weight/Bold", resolvedType: "FLOAT", valuesByMode: { M: 700 } },
      zindex: { name: "Z-Index/Modal", resolvedType: "FLOAT", valuesByMode: { M: 10 } },
      scale: { name: "Scale/Up", resolvedType: "FLOAT", valuesByMode: { M: 1.5 } },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(result).toContain("--opacity: 0.5;");
    expect(result).toContain("--font-weight--bold: 700;");
    expect(result).toContain("--z-index--modal: 10;");
    expect(result).toContain("--scale--up: 1.5;");
    expect(result).toContain("--spacing--4: 16px;");
    expect(result).not.toContain("0.5px");
  });

  it("escapes quotes, backslashes and newlines inside STRING values", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [{ name: "Default", modeId: "M" }],
      variableIds: ["tricky"],
    };
    setFigma([collection], {
      tricky: {
        name: "Tricky",
        resolvedType: "STRING",
        valuesByMode: { M: 'say "hi"\nback\\slash' },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(result).toContain('--tricky: "say \\"hi\\"\\a back\\\\slash";');
    expect(result).not.toContain('say "hi"');
  });

  it("sanitizes descriptions that would break out of the CSS comment", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [{ name: "Default", modeId: "M" }],
      variableIds: ["x"],
    };
    setFigma([collection], {
      x: {
        name: "X",
        resolvedType: "FLOAT",
        description: "closes */ early",
        valuesByMode: { M: 1 },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(result).toContain("/* closes * / early */");
    expect(result).not.toContain("closes */ early");
  });

  it("maps Light to :root, Dark to a media query (case-insensitive) and other modes to theme classes", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [
        { name: "Light", modeId: "L" },
        { name: "DARK", modeId: "D" },
        { name: "High Contrast", modeId: "H" },
      ],
      variableIds: ["bg"],
    };
    setFigma([collection], {
      bg: {
        name: "Bg",
        resolvedType: "FLOAT",
        valuesByMode: { L: 1, D: 2, H: 3 },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(rootBlockOf(result)).toContain("--bg: 1px;");
    expect(result).toContain("@media (prefers-color-scheme: dark)");
    expect(result).toContain("--bg: 2px;");
    expect(result).toContain(".tokens--high-contrast {");
    expect(result).toContain("--bg: 3px;");
  });

  it("sends only the first root-classifying mode to :root; extra ones become theme classes", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [
        { name: "Default", modeId: "DF" },
        { name: "Light", modeId: "L" },
      ],
      variableIds: ["spacing"],
    };
    setFigma([collection], {
      spacing: {
        name: "Spacing",
        resolvedType: "FLOAT",
        valuesByMode: { DF: 10, L: 20 },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(rootBlockOf(result)).toContain("--spacing: 10px;");
    expect(rootBlockOf(result)).not.toContain("20px");
    expect(result).toContain(".tokens--light {");
    expect(result).toContain("--spacing: 20px;");
    expect(countOccurrences(result, "--spacing: 10px;")).toBe(1);
  });

  it("falls back to the first available value when a variable has no value in the root mode", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [
        { name: "Default", modeId: "DF" },
        { name: "Dark", modeId: "D" },
      ],
      variableIds: ["x"],
    };
    setFigma([collection], {
      x: {
        name: "X",
        resolvedType: "FLOAT",
        valuesByMode: { D: 30 },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(rootBlockOf(result)).toContain("--x: 30px;");
  });

  it("emits valid theme class selectors for mode names with parentheses", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [
        { name: "Default", modeId: "DF" },
        { name: "Mobile (Beta)", modeId: "MB" },
      ],
      variableIds: ["x"],
    };
    setFigma([collection], {
      x: {
        name: "X",
        resolvedType: "FLOAT",
        valuesByMode: { DF: 1, MB: 2 },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(result).toContain(".tokens--mobile-beta {");
    expect(result).not.toContain("(beta) {");
  });

  it("dedupes same-name variables across collections keeping the first, with an audit comment", async () => {
    const primitives = {
      id: "c1",
      name: "Primitives",
      modes: [{ name: "Default", modeId: "M1" }],
      variableIds: ["blue"],
    };
    const semantic = {
      id: "c2",
      name: "Semantic",
      modes: [{ name: "Default", modeId: "M2" }],
      variableIds: ["red"],
    };
    setFigma([primitives, semantic], {
      blue: {
        name: "Colors/Primary",
        resolvedType: "COLOR",
        valuesByMode: { M1: { r: 0, g: 0, b: 1, a: 1 } },
      },
      red: {
        name: "Colors/Primary",
        resolvedType: "COLOR",
        valuesByMode: { M2: { r: 1, g: 0, b: 0, a: 1 } },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(countOccurrences(rootBlockOf(result), "--colors--primary:")).toBe(1);
    expect(rootBlockOf(result)).toContain("--colors--primary: #0000ff;");
    expect(result).toContain("/* duplicate skipped: --colors--primary (from Semantic) */");
    expect(rootBlockOf(result)).not.toContain("#ff0000");
  });

  it("attaches a resolved var() fallback when the aliased collection is not exported", async () => {
    const primitives = {
      id: "c1",
      name: "Primitives",
      modes: [
        { name: "Light", modeId: "L" },
        { name: "Dark", modeId: "D" },
      ],
      variableIds: ["blue"],
    };
    const semantic = {
      id: "c2",
      name: "Semantic",
      modes: [{ name: "Default", modeId: "M" }],
      variableIds: ["bg"],
    };
    setFigma([primitives, semantic], {
      blue: {
        name: "Colors/Blue/500",
        resolvedType: "COLOR",
        valuesByMode: { L: { r: 0, g: 0, b: 1, a: 1 }, D: { r: 0, g: 0, b: 0.2, a: 1 } },
      },
      bg: {
        name: "Background/Primary",
        resolvedType: "COLOR",
        valuesByMode: { M: { type: "VARIABLE_ALIAS", id: "blue" } },
      },
    });

    const result = await exportToCSS({ c1: [], c2: ["M"] }, NO_STYLES);

    expect(result).toContain("--background--primary: var(--colors--blue--500, #0000ff);");
    // The deselected collection itself contributes nothing.
    expect(result).not.toContain("--colors--blue--500:");
  });

  it("keeps `initial` for broken aliases but flags them with a comment", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [{ name: "Default", modeId: "M" }],
      variableIds: ["broken"],
    };
    setFigma([collection], {
      broken: {
        name: "Broken",
        resolvedType: "COLOR",
        valuesByMode: { M: { type: "VARIABLE_ALIAS", id: "missing" } },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(result).toContain("--broken: initial;");
    expect(result).toContain("/* unresolved alias */");
  });

  it("emits aliases to exported collections as plain var() references", async () => {
    const collection = {
      id: "c1",
      name: "Tokens",
      modes: [{ name: "Default", modeId: "M" }],
      variableIds: ["blue", "bg"],
    };
    setFigma([collection], {
      blue: {
        name: "Colors/Blue/500",
        resolvedType: "COLOR",
        valuesByMode: { M: { r: 0, g: 0, b: 1, a: 1 } },
      },
      bg: {
        name: "Background/Primary",
        resolvedType: "COLOR",
        valuesByMode: { M: { type: "VARIABLE_ALIAS", id: "blue" } },
      },
    });

    const result = await exportToCSS(undefined, NO_STYLES);

    expect(result).toContain("--background--primary: var(--colors--blue--500);");
  });
});
