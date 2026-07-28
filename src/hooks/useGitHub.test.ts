import { describe, it, expect, vi } from "vitest";
import { GitHubApiError, PushResult } from "../utils/github/githubApi";
import {
  PushGroupInput,
  migrateLegacyPlaintext,
  parseStored,
  runPushGroups,
} from "./useGitHub";

describe("parseStored", () => {
  it("parses a legacy single-repo connection into identity-only meta + repo scope", () => {
    const value = JSON.stringify({
      owner: "acme",
      repo: "tokens",
      baseBranch: "main",
      encrypted: { salt: "s", iv: "i", ciphertext: "c" },
    });
    const parsed = parseStored(value);
    // The persisted shape is legacy, but the in-memory connection is
    // identity-only (decision D3); repo fields surface as the repo scope.
    expect(parsed?.meta).toEqual({
      encrypted: { salt: "s", iv: "i", ciphertext: "c" },
    });
    expect(parsed?.repo).toEqual({ owner: "acme", repo: "tokens", baseBranch: "main" });
    expect(parsed?.plaintextToken).toBeUndefined();
  });

  it("parses an identity-only record (encrypted blob, optional login) without a repo scope", () => {
    const value = JSON.stringify({
      login: "octocat",
      baseUrl: "https://github.acme.com/api/v3",
      encrypted: { salt: "s", iv: "i", ciphertext: "c" },
    });
    const parsed = parseStored(value);
    expect(parsed?.meta).toEqual({
      login: "octocat",
      baseUrl: "https://github.acme.com/api/v3",
      encrypted: { salt: "s", iv: "i", ciphertext: "c" },
    });
    expect(parsed?.repo).toBeUndefined();
  });

  it("exposes a legacy plaintext token for adoption", () => {
    const value = JSON.stringify({ owner: "acme", repo: "tokens", token: "ghp_legacy" });
    const parsed = parseStored(value);
    expect(parsed?.plaintextToken).toBe("ghp_legacy");
    // baseBranch falls back to "main" for records saved without it.
    expect(parsed?.repo?.baseBranch).toBe("main");
  });

  it("drops an encrypted blob whose fields are missing or not strings", () => {
    const missing = parseStored(
      JSON.stringify({ owner: "a", repo: "b", encrypted: { salt: "s" } }),
    );
    expect(missing?.meta.encrypted).toBeUndefined();

    const wrongTypes = parseStored(
      JSON.stringify({
        owner: "a",
        repo: "b",
        encrypted: { salt: 1, iv: "i", ciphertext: "c" },
      }),
    );
    expect(wrongTypes?.meta.encrypted).toBeUndefined();
  });

  it("returns null for missing, corrupt, or connection-less values", () => {
    expect(parseStored(null)).toBeNull();
    expect(parseStored(undefined)).toBeNull();
    expect(parseStored("")).toBeNull();
    expect(parseStored("{ not json")).toBeNull();
    expect(parseStored(JSON.stringify({ owner: "a" }))).toBeNull();
    // Identity-only shape without an encrypted blob is not a connection.
    expect(parseStored(JSON.stringify({ baseUrl: "https://api.github.com" }))).toBeNull();
  });
});

describe("migrateLegacyPlaintext", () => {
  it("rewrites clientStorage identity-only (no plaintext, no repo fields) and returns the token for the session", () => {
    // `save` stands in for the clientStorage write path.
    const save = vi.fn();
    const parsed = parseStored(
      JSON.stringify({
        owner: "acme",
        repo: "tokens",
        baseBranch: "main",
        token: "ghp_legacy",
      }),
    );

    const adopted = migrateLegacyPlaintext(parsed, save);

    expect(adopted).toBe("ghp_legacy");
    expect(save).toHaveBeenCalledTimes(1);
    const rewritten = JSON.parse(save.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(rewritten.token).toBeUndefined();
    expect(rewritten.owner).toBeUndefined();
    expect(rewritten.repo).toBeUndefined();
    expect(rewritten.baseBranch).toBeUndefined();
  });

  it("keeps an existing encrypted blob while dropping the plaintext token and repo fields", () => {
    const save = vi.fn();
    const parsed = parseStored(
      JSON.stringify({
        owner: "acme",
        repo: "tokens",
        token: "ghp_legacy",
        encrypted: { salt: "s", iv: "i", ciphertext: "c" },
      }),
    );

    migrateLegacyPlaintext(parsed, save);

    const rewritten = JSON.parse(save.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(rewritten.token).toBeUndefined();
    expect(rewritten.owner).toBeUndefined();
    expect(rewritten.encrypted).toEqual({ salt: "s", iv: "i", ciphertext: "c" });
  });

  it("does nothing when there is no plaintext token to migrate", () => {
    const save = vi.fn();
    const parsed = parseStored(
      JSON.stringify({
        owner: "acme",
        repo: "tokens",
        encrypted: { salt: "s", iv: "i", ciphertext: "c" },
      }),
    );

    expect(migrateLegacyPlaintext(parsed, save)).toBeNull();
    expect(migrateLegacyPlaintext(null, save)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("runPushGroups", () => {
  function makeGroup(key: string, overrides: Partial<PushGroupInput> = {}): PushGroupInput {
    const [repoPart, branch] = key.split("#");
    const [owner, repo] = repoPart.split("/");
    return {
      key,
      owner,
      repo,
      baseBranch: "main",
      branch,
      message: "msg",
      createPr: true,
      targetIds: [`t-${key}`],
      files: [{ path: "tokens.json", content: "{}" }],
      ...overrides,
    };
  }

  const pushResult = (branch: string): PushResult => ({
    branch,
    commitSha: "sha",
    commitUrl: "https://gh/commit",
    prUrl: "https://gh/pr/1",
    compareUrl: "https://gh/compare",
  });

  it("pushes groups sequentially in order and reports per-group success", async () => {
    const groups = [makeGroup("acme/web#b1"), makeGroup("acme/mobile#b1")];
    const started: string[] = [];
    const progress: Array<[number, number]> = [];
    const push = vi.fn((group: PushGroupInput) => {
      started.push(group.key);
      // The second group may only start after the first resolved.
      return new Promise<PushResult>((resolve) =>
        setTimeout(() => resolve(pushResult(group.branch)), started.length === 2 ? 0 : 5),
      );
    });

    const results = await runPushGroups(groups, push, (done, total) =>
      progress.push([done, total]),
    );

    expect(started).toEqual(["acme/web#b1", "acme/mobile#b1"]);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(results.map((r) => r.key)).toEqual(["acme/web#b1", "acme/mobile#b1"]);
    expect(results.every((r) => r.result && !r.error)).toBe(true);
  });

  it("captures a failing group and still pushes the remaining ones (partial failure)", async () => {
    const groups = [makeGroup("acme/web#b1"), makeGroup("acme/mobile#b1")];
    const push = vi.fn(async (group: PushGroupInput) => {
      if (group.repo === "mobile") {
        throw new GitHubApiError(403, "GitHub API error (403): Resource not accessible");
      }
      return pushResult(group.branch);
    });

    const results = await runPushGroups(groups, push);

    expect(push).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ key: "acme/web#b1", result: pushResult("b1") });
    expect(results[0].error).toBeUndefined();
    expect(results[1]).toMatchObject({
      key: "acme/mobile#b1",
      error: expect.stringContaining("403"),
    });
    expect(results[1].result).toBeUndefined();
  });

  it("returns an empty result list for no groups", async () => {
    const push = vi.fn();
    expect(await runPushGroups([], push)).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });
});
