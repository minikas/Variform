import { describe, it, expect, vi } from "vitest";
import { migrateLegacyPlaintext, parseStored } from "./useGitHub";

describe("parseStored", () => {
  it("parses a valid encrypted connection", () => {
    const value = JSON.stringify({
      owner: "acme",
      repo: "tokens",
      baseBranch: "main",
      encrypted: { salt: "s", iv: "i", ciphertext: "c" },
    });
    const parsed = parseStored(value);
    expect(parsed?.meta).toEqual({
      owner: "acme",
      repo: "tokens",
      baseBranch: "main",
      encrypted: { salt: "s", iv: "i", ciphertext: "c" },
    });
    expect(parsed?.plaintextToken).toBeUndefined();
  });

  it("exposes a legacy plaintext token for adoption", () => {
    const value = JSON.stringify({ owner: "acme", repo: "tokens", token: "ghp_legacy" });
    const parsed = parseStored(value);
    expect(parsed?.plaintextToken).toBe("ghp_legacy");
    // baseBranch falls back to "main" for records saved without it.
    expect(parsed?.meta.baseBranch).toBe("main");
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

  it("returns null for missing or corrupt values", () => {
    expect(parseStored(null)).toBeNull();
    expect(parseStored(undefined)).toBeNull();
    expect(parseStored("")).toBeNull();
    expect(parseStored("{ not json")).toBeNull();
    expect(parseStored(JSON.stringify({ owner: "a" }))).toBeNull();
  });
});

describe("migrateLegacyPlaintext", () => {
  it("rewrites clientStorage without the plaintext token and returns it for the session", () => {
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
    expect(rewritten.owner).toBe("acme");
    expect(rewritten.repo).toBe("tokens");
    expect(rewritten.baseBranch).toBe("main");
  });

  it("keeps an existing encrypted blob while dropping the plaintext token", () => {
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
