import { describe, it, expect } from "vitest";
import {
  BRANCH_PREFIX,
  defaultBranchName,
  defaultCommitMessage,
  defaultPrBody,
  defaultPrTitle,
  sanitizeBranchSegment,
} from "./branchName";

describe("sanitizeBranchSegment", () => {
  it("lowercases and replaces unsafe characters with dashes", () => {
    expect(sanitizeBranchSegment("My Doc Variables")).toBe("my-doc-variables");
  });

  it("collapses repeated separators and strips edges", () => {
    expect(sanitizeBranchSegment("--Foo__Bar..baz--")).toBe("foo__bar-baz");
  });

  it("removes the forbidden '..' git sequence", () => {
    expect(sanitizeBranchSegment("a..b")).toBe("a-b");
  });

  it("falls back to 'export' when nothing usable remains", () => {
    expect(sanitizeBranchSegment("***")).toBe("export");
    expect(sanitizeBranchSegment("   ")).toBe("export");
  });
});

describe("defaultBranchName", () => {
  it("prefixes with the VarVar namespace and appends the suffix", () => {
    expect(defaultBranchName("My Tokens", "k9x2")).toBe(
      `${BRANCH_PREFIX}/my-tokens-k9x2`,
    );
  });

  it("uses a fallback slug for an empty filename", () => {
    expect(defaultBranchName("", "abc")).toBe(`${BRANCH_PREFIX}/variables-abc`);
  });
});

describe("default copy helpers", () => {
  it("builds a conventional commit message", () => {
    expect(defaultCommitMessage("tokens.json")).toBe(
      "chore: update tokens.json via Variform",
    );
  });

  it("builds a PR title and body referencing the path", () => {
    expect(defaultPrTitle("tokens.json")).toBe("Update tokens.json");
    expect(defaultPrBody("tokens.json")).toContain("tokens.json");
  });
});
