import { describe, it, expect } from "vitest";
import { OutputFormats } from "../../types.d";
import {
  PushTarget,
  createTarget,
  defaultTargetFolder,
  deriveTargets,
  dirname,
  groupTargets,
  migrateLegacyTargets,
  parseStoredTargets,
  restorePersistedTargets,
  targetFiles,
  targetGroupKey,
  toPersistedTargets,
  type PersistedPushTarget,
} from "./pushTargets";

function makeTarget(overrides: Partial<PushTarget> = {}): PushTarget {
  return {
    id: "t1",
    format: OutputFormats.CSS,
    formatOptions: {},
    owner: "acme",
    repo: "design",
    baseBranch: "main",
    branch: "variform/tokens-abc",
    folder: "tokens",
    createPr: true,
    ...overrides,
  };
}

describe("dirname", () => {
  it("returns everything before the last slash", () => {
    expect(dirname("packages/web/tokens.css")).toBe("packages/web");
    expect(dirname("src/tokens.json")).toBe("src");
  });

  it("returns an empty string for root-level files", () => {
    expect(dirname("tokens.css")).toBe("");
    expect(dirname("")).toBe("");
  });
});

describe("targetGroupKey", () => {
  it("is ${owner}/${repo}#${branch}", () => {
    expect(targetGroupKey(makeTarget())).toBe("acme/design#variform/tokens-abc");
  });
});

describe("groupTargets", () => {
  it("groups targets sharing repo+branch into one group (monorepo)", () => {
    const groups = groupTargets([
      makeTarget({ id: "t1", folder: "packages/web" }),
      makeTarget({
        id: "t2",
        format: OutputFormats.FLUTTER,
        folder: "packages/app/lib",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("acme/design#variform/tokens-abc");
    expect(groups[0].targets.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("keeps different repositories in separate groups, in first-appearance order", () => {
    const groups = groupTargets([
      makeTarget({ id: "t1", repo: "web" }),
      makeTarget({ id: "t2", repo: "mobile" }),
      makeTarget({ id: "t3", repo: "web" }),
    ]);

    expect(groups.map((g) => g.key)).toEqual([
      "acme/web#variform/tokens-abc",
      "acme/mobile#variform/tokens-abc",
    ]);
    expect(groups[0].targets.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(groups[1].targets.map((t) => t.id)).toEqual(["t2"]);
  });

  it("splits same-repo targets when the push branch differs", () => {
    const groups = groupTargets([
      makeTarget({ id: "t1", branch: "variform/a" }),
      makeTarget({ id: "t2", branch: "variform/b" }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("enables the group PR when any target asks for it", () => {
    const groups = groupTargets([
      makeTarget({ id: "t1", createPr: false }),
      makeTarget({ id: "t2", createPr: true }),
    ]);

    expect(groups[0].createPr).toBe(true);
  });

  it("returns an empty array for no targets", () => {
    expect(groupTargets([])).toEqual([]);
  });
});

describe("toPersistedTargets / restorePersistedTargets", () => {
  it("strips branch names on persist and reseeds a shared branch on restore", () => {
    const targets = [
      makeTarget({ id: "t1", branch: "variform/old-1" }),
      makeTarget({ id: "t2", branch: "variform/old-2" }),
    ];

    const persisted = toPersistedTargets(targets);
    expect(persisted.every((t) => !("branch" in t))).toBe(true);

    const restored = restorePersistedTargets(persisted, "variform/fresh");
    expect(restored.map((t) => t.branch)).toEqual([
      "variform/fresh",
      "variform/fresh",
    ]);
    expect(restored.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("drops corrupt persisted entries on restore", () => {
    const restored = restorePersistedTargets(
      [
        toPersistedTargets([makeTarget({ id: "ok" })])[0],
        { id: 42 } as unknown as PersistedPushTarget,
        null as unknown as PersistedPushTarget,
      ],
      "variform/fresh",
    );

    expect(restored.map((t) => t.id)).toEqual(["ok"]);
  });

  it("migrates legacy full-path entries to folders (dirname only)", () => {
    const restored = restorePersistedTargets(
      [
        {
          id: "legacy",
          format: OutputFormats.TAILWIND,
          formatOptions: { tailwindOutput: "both" },
          owner: "acme",
          repo: "design",
          baseBranch: "main",
          path: "packages/web/globals.css",
          presetPath: "packages/web/tailwind.preset.js",
          createPr: true,
        } as unknown as PersistedPushTarget,
      ],
      "variform/fresh",
    );

    expect(restored).toHaveLength(1);
    expect(restored[0].folder).toBe("packages/web");
    expect(restored[0].presetFolder).toBe("packages/web");
    expect("path" in restored[0]).toBe(false);
  });

  it("migrates a root-level legacy path to an empty folder", () => {
    const restored = restorePersistedTargets(
      [
        {
          id: "legacy",
          format: OutputFormats.CSS,
          formatOptions: {},
          owner: "acme",
          repo: "design",
          baseBranch: "main",
          path: "tokens.css",
          createPr: true,
        } as unknown as PersistedPushTarget,
      ],
      "variform/fresh",
    );

    expect(restored[0].folder).toBe("");
  });
});

describe("migrateLegacyTargets", () => {
  it("derives one target for the active format, keeping only the legacy folder", () => {
    const targets = migrateLegacyTargets({
      githubFilePath: "src/tokens.css",
      format: OutputFormats.CSS,
      branch: "variform/fresh",
      repo: { owner: "acme", repo: "design", baseBranch: "main" },
    });

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      format: OutputFormats.CSS,
      folder: "src",
      owner: "acme",
      repo: "design",
      baseBranch: "main",
      branch: "variform/fresh",
      createPr: true,
    });
    expect(targets[0].id).toBeTruthy();
  });

  it("maps a root-level legacy path to an empty folder", () => {
    const targets = migrateLegacyTargets({
      githubFilePath: "tokens.json",
      format: OutputFormats.JSON,
      branch: "variform/fresh",
    });

    expect(targets[0]).toMatchObject({ folder: "", owner: "", repo: "" });
  });

  it("returns no targets without a legacy path", () => {
    expect(
      migrateLegacyTargets({
        githubFilePath: "",
        format: OutputFormats.JSON,
        branch: "variform/fresh",
      }),
    ).toEqual([]);
  });
});

describe("parseStoredTargets", () => {
  it("restores persisted targets with a freshly seeded branch", () => {
    const persisted = toPersistedTargets([makeTarget({ id: "t1" })]);
    const restored = parseStoredTargets(
      { pushTargets: persisted, githubFilePath: "legacy/ignored.css" },
      "variform/fresh",
    );

    // Persisted targets win over the legacy single path.
    expect(restored?.map((t) => t.id)).toEqual(["t1"]);
    expect(restored?.[0].branch).toBe("variform/fresh");
  });

  it("migrates a legacy githubFilePath when no targets were persisted", () => {
    const restored = parseStoredTargets(
      { githubFilePath: "src/tokens.css", format: OutputFormats.CSS },
      "variform/fresh",
    );

    expect(restored).toHaveLength(1);
    expect(restored?.[0]).toMatchObject({
      format: OutputFormats.CSS,
      folder: "src",
    });
  });

  it("falls back to JSON for records without a format", () => {
    const restored = parseStoredTargets(
      { githubFilePath: "tokens.json" },
      "variform/fresh",
    );

    expect(restored?.[0].format).toBe(OutputFormats.JSON);
  });

  it("returns null when the record holds neither targets nor a legacy path", () => {
    expect(parseStoredTargets({}, "variform/fresh")).toBeNull();
    expect(
      parseStoredTargets({ githubFilePath: "" }, "variform/fresh"),
    ).toBeNull();
  });
});

describe("createTarget", () => {
  it("applies defaults for the optional fields", () => {
    const target = createTarget({
      format: OutputFormats.TAILWIND,
      folder: "src/styles",
      branch: "variform/fresh",
    });

    expect(target).toMatchObject({
      formatOptions: {},
      owner: "",
      repo: "",
      baseBranch: "",
      createPr: true,
    });
    expect(target.presetFolder).toBeUndefined();
    expect(target.id).toBeTruthy();
  });
});

describe("defaultTargetFolder", () => {
  it.each([
    [OutputFormats.JSON, "tokens"],
    [OutputFormats.STYLE_DICTIONARY, "tokens"],
    [OutputFormats.CSS, "src/styles"],
    [OutputFormats.SCSS, "src/styles/abstracts"],
    [OutputFormats.JS, "src/tokens"],
    [OutputFormats.TS, "src/tokens"],
    [OutputFormats.REACT_NATIVE, "src/theme"],
    [OutputFormats.TAMAGUI, "src/theme"],
    [OutputFormats.SWIFT, "Sources/DesignSystem"],
    [OutputFormats.ANDROID, "app/src/main/res/values"],
    [OutputFormats.FLUTTER, "lib/theme"],
    [OutputFormats.CSV, "docs"],
  ] as const)("maps %s to its platform convention", (format, expected) => {
    expect(defaultTargetFolder(format)).toBe(expected);
  });

  it("seeds Tailwind per output: stylesheet folder vs preset root", () => {
    expect(defaultTargetFolder(OutputFormats.TAILWIND, "css")).toBe("src/styles");
    expect(defaultTargetFolder(OutputFormats.TAILWIND, "preset")).toBe("");
  });
});

describe("targetFiles", () => {
  it("resolves folder + default filename for a regular target", () => {
    const files = targetFiles(makeTarget({ folder: "tokens" }), {});

    expect(files).toEqual([
      {
        key: "file",
        path: "tokens/tokens.css",
        extension: "css",
        formatOptions: { tailwindOutput: undefined },
      },
    ]);
  });

  it("joins a root folder without a leading slash", () => {
    const files = targetFiles(makeTarget({ folder: "" }), {});

    expect(files[0].path).toBe("tokens.css");
  });

  it("uses the configured filename from the map when present", () => {
    const files = targetFiles(makeTarget({ folder: "tokens" }), {
      css: "variables",
    });

    expect(files[0].path).toBe("tokens/variables.css");
  });

  it("returns stylesheet + preset for a Tailwind 'both' target", () => {
    const files = targetFiles(
      makeTarget({
        format: OutputFormats.TAILWIND,
        formatOptions: { tailwindOutput: "both", tailwindUnit: "rem" },
        folder: "packages/web",
        presetFolder: "packages/web/presets",
      }),
      { tailwind: "globals", "tailwind:preset": "tailwind.config" },
    );

    expect(files).toEqual([
      {
        key: "css",
        path: "packages/web/globals.css",
        extension: "css",
        formatOptions: { tailwindOutput: "css", tailwindUnit: "rem" },
      },
      {
        key: "preset",
        path: "packages/web/presets/tailwind.config.js",
        extension: "js",
        formatOptions: { tailwindOutput: "preset", tailwindUnit: "rem" },
      },
    ]);
  });

  it("defaults the preset to the repo root with the default preset filename", () => {
    const files = targetFiles(
      makeTarget({
        format: OutputFormats.TAILWIND,
        formatOptions: { tailwindOutput: "both" },
        folder: "src/styles",
        presetFolder: "   ",
      }),
      {},
    );

    expect(files[0].path).toBe("src/styles/globals.css");
    expect(files[1].path).toBe("presets.tailwind.js");
  });

  it("ignores presetFolder when the output is not 'both'", () => {
    const files = targetFiles(
      makeTarget({
        format: OutputFormats.TAILWIND,
        formatOptions: { tailwindOutput: "css" },
        folder: "src/styles",
        presetFolder: "should/be/ignored",
      }),
      {},
    );

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/styles/globals.css");
  });
});

describe("folder persistence", () => {
  it("survives the persist/restore round-trip (only branch is stripped)", () => {
    const target = makeTarget({
      format: OutputFormats.TAILWIND,
      formatOptions: { tailwindOutput: "both" },
      folder: "packages/web",
      presetFolder: "packages/web/presets",
    });

    const persisted = toPersistedTargets([target]);
    expect(persisted[0].folder).toBe("packages/web");
    expect(persisted[0].presetFolder).toBe("packages/web/presets");

    const restored = restorePersistedTargets(persisted, "variform/fresh");
    expect(restored[0].folder).toBe("packages/web");
    expect(restored[0].presetFolder).toBe("packages/web/presets");
  });
});

describe("deriveTargets", () => {
  const seed = {
    branch: "variform/shared-seed",
    repo: { owner: "acme", repo: "design", baseBranch: "main" },
    formatOptions: (format: OutputFormats) =>
      format === OutputFormats.TAILWIND
        ? { tailwindOutput: "both" as const, tailwindUnit: "rem" as const }
        : {},
    folder: (format: OutputFormats) => `defaults/${format}`,
  };

  it("creates a target per checked format with the seed defaults", () => {
    const derived = deriveTargets(
      [OutputFormats.TAILWIND, OutputFormats.FLUTTER],
      [],
      seed,
    );

    expect(derived).toHaveLength(2);
    expect(derived[0]).toMatchObject({
      format: OutputFormats.TAILWIND,
      owner: "acme",
      repo: "design",
      baseBranch: "main",
      branch: "variform/shared-seed",
      folder: "defaults/tailwind",
      formatOptions: { tailwindOutput: "both", tailwindUnit: "rem" },
    });
    expect(derived[1]).toMatchObject({
      format: OutputFormats.FLUTTER,
      folder: "defaults/flutter",
    });
  });

  it("resolves the files of a derived dual-output Tailwind target", () => {
    const [tailwind] = deriveTargets([OutputFormats.TAILWIND], [], seed);

    expect(targetFiles(tailwind, {}).map((f) => f.path)).toEqual([
      "defaults/tailwind/globals.css",
      "presets.tailwind.js",
    ]);
  });

  it("reuses an existing target of the same format, keeping its repo/folders/options", () => {
    const existing = makeTarget({
      id: "keep-me",
      format: OutputFormats.TAILWIND,
      formatOptions: { tailwindOutput: "css" },
      owner: "other",
      repo: "web",
      folder: "packages/web",
      presetFolder: "packages/web/presets",
    });

    const derived = deriveTargets(
      [OutputFormats.TAILWIND, OutputFormats.FLUTTER],
      [existing],
      seed,
    );

    expect(derived).toHaveLength(2);
    // The persisted target is reused untouched — NOT re-seeded.
    expect(derived[0]).toBe(existing);
    expect(derived[1]).toMatchObject({ format: OutputFormats.FLUTTER });
  });

  it("drops existing targets whose format is not checked (selection is the source of truth)", () => {
    const stale = makeTarget({ id: "stale", format: OutputFormats.SWIFT });

    const derived = deriveTargets([OutputFormats.JSON], [stale], seed);

    expect(derived).toHaveLength(1);
    expect(derived[0].format).toBe(OutputFormats.JSON);
  });

  it("keeps only the first target when duplicates of a format were persisted", () => {
    const first = makeTarget({ id: "first", format: OutputFormats.JSON });
    const dup = makeTarget({ id: "dup", format: OutputFormats.JSON, folder: "other" });

    const derived = deriveTargets([OutputFormats.JSON], [first, dup], seed);

    expect(derived).toEqual([first]);
  });

  it("is idempotent: deriving twice adds nothing", () => {
    const once = deriveTargets([OutputFormats.JSON, OutputFormats.CSS], [], seed);
    const twice = deriveTargets([OutputFormats.JSON, OutputFormats.CSS], once, seed);

    expect(twice).toHaveLength(once.length);
  });

  it("works without a repo seed (empty repo fields for the user to fill)", () => {
    const [target] = deriveTargets([OutputFormats.JSON], [], {
      ...seed,
      repo: undefined,
    });

    expect(target).toMatchObject({ owner: "", repo: "", baseBranch: "" });
  });
});
