import { describe, it, expect, vi } from "vitest";
import { OutputFormats } from "../types.d";
import type { PushTarget, TargetFile } from "../utils/github/pushTargets";
import {
  allFilesResolved,
  exportFileKey,
  resolveTargetExports,
  resolvedFilesFor,
} from "./useTargetExports";

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

describe("exportFileKey", () => {
  it("keeps the bare target id for the first file and suffixes the rest", () => {
    const css = { key: "css" } as TargetFile;
    const preset = { key: "preset" } as TargetFile;
    expect(exportFileKey("t1", css, 0)).toBe("t1");
    expect(exportFileKey("t1", preset, 1)).toBe("t1:preset");
  });
});

describe("resolveTargetExports", () => {
  it("resolves all target contents in parallel, keyed by target id", async () => {
    const targets = [
      makeTarget({ id: "t1", format: OutputFormats.TAILWIND }),
      makeTarget({ id: "t2", format: OutputFormats.FLUTTER }),
      makeTarget({ id: "t3", format: OutputFormats.JSON }),
    ];
    // Mocked bridge: each target resolves with content derived from its format.
    const request = vi.fn(async (target: PushTarget) => `content:${target.format}`);

    const result = await resolveTargetExports(targets, {}, request);

    expect(request).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      t1: { content: "content:tailwind", loading: false, error: null },
      t2: { content: "content:flutter", loading: false, error: null },
      t3: { content: "content:json", loading: false, error: null },
    });
  });

  it("issues one request per FILE for a Tailwind 'both' target", async () => {
    const targets = [
      makeTarget({
        id: "t1",
        format: OutputFormats.TAILWIND,
        formatOptions: { tailwindOutput: "both", tailwindUnit: "rem" },
        folder: "src/styles",
      }),
    ];
    const request = vi.fn(async (target: PushTarget, file: TargetFile) =>
      `content:${file.key}:${file.formatOptions.tailwindOutput}`,
    );

    const result = await resolveTargetExports(targets, {}, request);

    expect(request).toHaveBeenCalledTimes(2);
    // Each file is exported with its own normalized single-output options.
    expect(request.mock.calls[0][1].formatOptions.tailwindOutput).toBe("css");
    expect(request.mock.calls[1][1].formatOptions.tailwindOutput).toBe("preset");
    expect(result).toEqual({
      t1: { content: "content:css:css", loading: false, error: null },
      "t1:preset": { content: "content:preset:preset", loading: false, error: null },
    });
  });

  it("starts all requests before any resolves (parallel, not sequential)", async () => {
    const targets = [makeTarget({ id: "t1" }), makeTarget({ id: "t2" })];
    const started: string[] = [];
    const request = vi.fn((target: PushTarget) => {
      started.push(target.id);
      return new Promise<string>((resolve) =>
        setTimeout(() => resolve("ok"), started.length === 2 ? 0 : 5),
      );
    });

    await resolveTargetExports(targets, {}, request);

    // The second request was issued without awaiting the first one's content.
    expect(started).toEqual(["t1", "t2"]);
  });

  it("captures a per-file error without aborting the other files", async () => {
    const targets = [
      makeTarget({ id: "t1" }),
      makeTarget({
        id: "t2",
        format: OutputFormats.TAILWIND,
        formatOptions: { tailwindOutput: "both" },
        folder: "src/styles",
      }),
    ];
    const request = vi.fn(async (target: PushTarget, file: TargetFile) => {
      if (file.key === "preset") {
        throw new Error("Preset export blew up");
      }
      return "fine";
    });

    const result = await resolveTargetExports(targets, {}, request);

    expect(result.t1).toEqual({ content: "fine", loading: false, error: null });
    expect(result.t2).toEqual({ content: "fine", loading: false, error: null });
    expect(result["t2:preset"]).toEqual({
      content: null,
      loading: false,
      error: "Preset export blew up",
    });
  });

  it("maps non-Error rejections to a generic message", async () => {
    const result = await resolveTargetExports(
      [makeTarget({ id: "t1" })],
      {},
      () => Promise.reject("nope"),
    );

    expect(result.t1.error).toBe("An unexpected error occurred while exporting.");
  });

  it("returns an empty map for no targets", async () => {
    const request = vi.fn(async () => "unused");
    expect(await resolveTargetExports([], {}, request)).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });
});

describe("resolvedFilesFor / allFilesResolved", () => {
  const bothTarget = makeTarget({
    id: "t1",
    format: OutputFormats.TAILWIND,
    formatOptions: { tailwindOutput: "both" },
    folder: "src/styles",
    presetFolder: "packages/web",
  });

  it("expands a 'both' target into its resolved files", () => {
    const resolved = resolvedFilesFor(
      bothTarget,
      { tailwind: "globals", "tailwind:preset": "tailwind.config" },
      {
        t1: { content: "css-content", loading: false, error: null },
        "t1:preset": { content: "preset-content", loading: false, error: null },
      },
    );

    expect(resolved).toEqual([
      {
        key: "t1",
        targetId: "t1",
        path: "src/styles/globals.css",
        extension: "css",
        content: "css-content",
      },
      {
        key: "t1:preset",
        targetId: "t1",
        path: "packages/web/tailwind.config.js",
        extension: "js",
        content: "preset-content",
      },
    ]);
  });

  it("reports unresolved files as empty content and blocks allFilesResolved", () => {
    const partial = {
      t1: { content: "css-content", loading: false, error: null },
    };

    const resolved = resolvedFilesFor(bothTarget, {}, partial);
    expect(resolved[1].content).toBe("");
    expect(allFilesResolved([bothTarget], {}, partial)).toBe(false);
    expect(
      allFilesResolved([bothTarget], {}, {
        ...partial,
        "t1:preset": { content: "p", loading: false, error: null },
      }),
    ).toBe(true);
  });
});
