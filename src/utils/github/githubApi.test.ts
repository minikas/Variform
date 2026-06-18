import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GitHubApiError,
  GitHubConnection,
  buildCompareUrl,
  commitFile,
  createBranch,
  createPullRequest,
  getBranchSha,
  getFileContent,
  getFileSha,
  listBranches,
  listRepositories,
  pushFile,
  utf8ToBase64,
  verifyConnection,
} from "./githubApi";

const conn: GitHubConnection = {
  token: "ghp_secret_token",
  owner: "acme",
  repo: "design-tokens",
  baseBranch: "main",
};

interface FakeResponseInit {
  status?: number;
  body?: unknown;
}

function fakeResponse({ status = 200, body }: FakeResponseInit) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/** Shape of the second argument our client passes to `fetch`. */
type FetchInit = { method?: string; headers: Record<string, string>; body?: string };

/**
 * Route fetch calls by HTTP method + a substring of the URL. Each matcher may
 * be used once (FIFO when several match) so we can assert call ordering.
 */
function routeFetch(
  routes: Array<{ method?: string; match: string; response: FakeResponseInit }>,
) {
  const remaining = [...routes];
  return vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method || "GET";
    const idx = remaining.findIndex(
      (r) => (r.method || "GET") === method && url.includes(r.match),
    );
    if (idx === -1) {
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }
    const [route] = remaining.splice(idx, 1);
    return fakeResponse(route.response);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("utf8ToBase64", () => {
  it("encodes ASCII content", () => {
    expect(utf8ToBase64("hello")).toBe("aGVsbG8=");
  });

  it("encodes multi-byte UTF-8 content without throwing", () => {
    // "café — €" round-trips through base64 back to the original string.
    const original = "café — €";
    const encoded = utf8ToBase64(original);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe(original);
  });
});

describe("verifyConnection", () => {
  it("maps repository metadata and sends auth headers", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({
        body: {
          default_branch: "develop",
          full_name: "acme/design-tokens",
          permissions: { push: true },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const info = await verifyConnection(conn);

    expect(info).toEqual({
      defaultBranch: "develop",
      canPush: true,
      fullName: "acme/design-tokens",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/design-tokens");
    expect(init.headers.Authorization).toBe("Bearer ghp_secret_token");
    expect(init.headers.Accept).toBe("application/vnd.github+json");
  });

  it("throws a GitHubApiError with the status on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({ status: 401, body: { message: "Bad credentials" } }),
      ),
    );

    await expect(verifyConnection(conn)).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("Bad credentials"),
    });
    await expect(verifyConnection(conn)).rejects.toBeInstanceOf(GitHubApiError);
  });
});

describe("getBranchSha", () => {
  it("returns the commit SHA when the branch exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ body: { object: { sha: "abc123" } } })),
    );
    expect(await getBranchSha(conn, "main")).toBe("abc123");
  });

  it("returns null when the branch does not exist (404)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ status: 404 })));
    expect(await getBranchSha(conn, "missing")).toBeNull();
  });
});

describe("getFileSha", () => {
  it("returns the blob SHA for an existing file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ body: { sha: "blob789" } })),
    );
    expect(await getFileSha(conn, "tokens.json", "main")).toBe("blob789");
  });

  it("returns null when the path is a directory (array response)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ body: [{ name: "a.json" }] })),
    );
    expect(await getFileSha(conn, "tokens", "main")).toBeNull();
  });

  it("returns null when the file is missing (404)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ status: 404 })));
    expect(await getFileSha(conn, "tokens.json", "main")).toBeNull();
  });
});

describe("listRepositories", () => {
  it("maps repositories and stops when a short page is returned", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // Single page of two repos (length < 100 → no second request).
      expect(url).toContain("/user/repos");
      return fakeResponse({
        body: [
          {
            full_name: "acme/design-tokens",
            name: "design-tokens",
            owner: { login: "acme" },
            default_branch: "main",
            permissions: { push: true },
          },
          {
            full_name: "octocat/hello",
            name: "hello",
            owner: { login: "octocat" },
            default_branch: "trunk",
            permissions: { push: false },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const repos = await listRepositories({ token: "ghp_x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(repos).toEqual([
      {
        fullName: "acme/design-tokens",
        owner: "acme",
        repo: "design-tokens",
        defaultBranch: "main",
        canPush: true,
      },
      {
        fullName: "octocat/hello",
        owner: "octocat",
        repo: "hello",
        defaultBranch: "trunk",
        canPush: false,
      },
    ]);
  });
});

describe("listBranches", () => {
  it("returns branch names for a repository", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/repos/acme/design-tokens/branches");
        return fakeResponse({ body: [{ name: "main" }, { name: "develop" }] });
      }),
    );

    expect(await listBranches({ token: "ghp_x" }, "acme", "design-tokens")).toEqual([
      "main",
      "develop",
    ]);
  });
});

describe("getFileContent", () => {
  it("returns the raw file text when it exists", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      // Requests the raw media type rather than the JSON envelope.
      expect(init?.headers?.Accept).toBe("application/vnd.github.raw");
      return fakeResponse({ body: "{\n  \"a\": 1\n}" });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getFileContent(conn, "tokens.json", "main")).toBe('{\n  "a": 1\n}');
  });

  it("returns null when the file is missing (404)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ status: 404 })));
    expect(await getFileContent(conn, "tokens.json", "main")).toBeNull();
  });
});

describe("commitFile", () => {
  it("base64-encodes content and includes the sha when updating", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({
        status: 200,
        body: { commit: { sha: "c1" }, content: { html_url: "https://gh/file" } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await commitFile(conn, {
      path: "tokens.json",
      content: "{}",
      message: "msg",
      branch: "feature",
      sha: "oldblob",
    });

    expect(result).toEqual({ commitSha: "c1", contentHtmlUrl: "https://gh/file" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/acme/design-tokens/contents/tokens.json",
    );
    expect(init.method).toBe("PUT");
    const sent = JSON.parse(init.body ?? "{}");
    expect(sent).toMatchObject({
      message: "msg",
      branch: "feature",
      sha: "oldblob",
      content: utf8ToBase64("{}"),
    });
  });

  it("omits the sha when creating a new file", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({ body: { commit: { sha: "c2" }, content: null } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await commitFile(conn, {
      path: "tokens.json",
      content: "{}",
      message: "msg",
      branch: "main",
    });

    expect(result.contentHtmlUrl).toBeNull();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body ?? "{}");
    expect(sent.sha).toBeUndefined();
  });
});

describe("createPullRequest", () => {
  it("returns the html_url and number", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        status: 201,
        body: { html_url: "https://github.com/acme/design-tokens/pull/7", number: 7 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pr = await createPullRequest(conn, {
      title: "t",
      head: "feature",
      base: "main",
    });

    expect(pr).toEqual({
      url: "https://github.com/acme/design-tokens/pull/7",
      number: 7,
    });
  });
});

describe("createBranch", () => {
  it("posts a refs/heads ref with the source SHA", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({ status: 201, body: { ref: "refs/heads/feature" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createBranch(conn, "feature", "basesha");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/design-tokens/git/refs");
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      ref: "refs/heads/feature",
      sha: "basesha",
    });
  });
});

describe("buildCompareUrl", () => {
  it("builds a github.com compare URL for github.com", () => {
    expect(buildCompareUrl(conn, "varvar/foo")).toBe(
      "https://github.com/acme/design-tokens/compare/main...varvar/foo?expand=1",
    );
  });

  it("derives the web host for GitHub Enterprise", () => {
    const enterprise: GitHubConnection = {
      ...conn,
      baseUrl: "https://github.acme.com/api/v3",
    };
    expect(buildCompareUrl(enterprise, "feature")).toBe(
      "https://github.acme.com/acme/design-tokens/compare/main...feature?expand=1",
    );
  });
});

describe("pushFile", () => {
  it("creates the branch, commits, and opens a PR (happy path)", async () => {
    const fetchMock = routeFetch([
      // target branch does not exist yet
      { method: "GET", match: "/git/ref/heads/varvar/export", response: { status: 404 } },
      // base branch SHA lookup
      {
        method: "GET",
        match: "/git/ref/heads/main",
        response: { body: { object: { sha: "basesha" } } },
      },
      // create branch
      { method: "POST", match: "/git/refs", response: { status: 201, body: { ref: "x" } } },
      // file does not exist on the new branch
      { method: "GET", match: "/contents/tokens.json", response: { status: 404 } },
      // commit file
      {
        method: "PUT",
        match: "/contents/tokens.json",
        response: { body: { commit: { sha: "commitsha" }, content: { html_url: "u" } } },
      },
      // open PR
      {
        method: "POST",
        match: "/pulls",
        response: { status: 201, body: { html_url: "https://gh/pr/1", number: 1 } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushFile(conn, {
      path: "tokens.json",
      content: "{}",
      commitMessage: "msg",
      branch: "varvar/export-abc",
      createPr: true,
    });

    expect(result.prUrl).toBe("https://gh/pr/1");
    expect(result.commitSha).toBe("commitsha");
    expect(result.compareUrl).toContain("compare/main...varvar/export-abc");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("falls back to compareUrl when PR creation fails", async () => {
    const fetchMock = routeFetch([
      { method: "GET", match: "/git/ref/heads/varvar/export", response: { status: 404 } },
      {
        method: "GET",
        match: "/git/ref/heads/main",
        response: { body: { object: { sha: "basesha" } } },
      },
      { method: "POST", match: "/git/refs", response: { status: 201, body: {} } },
      { method: "GET", match: "/contents/tokens.json", response: { status: 404 } },
      {
        method: "PUT",
        match: "/contents/tokens.json",
        response: { body: { commit: { sha: "commitsha" }, content: null } },
      },
      // PR already exists
      {
        method: "POST",
        match: "/pulls",
        response: { status: 422, body: { message: "already exists" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushFile(conn, {
      path: "tokens.json",
      content: "{}",
      commitMessage: "msg",
      branch: "varvar/export-abc",
      createPr: true,
    });

    expect(result.prUrl).toBeNull();
    expect(result.compareUrl).toContain("compare/main...varvar/export-abc");
  });

  it("commits directly to the base branch and skips PR when target equals base", async () => {
    const fetchMock = routeFetch([
      // no branch lookups expected; only file SHA + commit
      {
        method: "GET",
        match: "/contents/tokens.json",
        response: { body: { sha: "existingblob" } },
      },
      {
        method: "PUT",
        match: "/contents/tokens.json",
        response: { body: { commit: { sha: "commitsha" }, content: { html_url: "u" } } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushFile(conn, {
      path: "tokens.json",
      content: "{}",
      commitMessage: "msg",
      branch: "main",
      createPr: true,
    });

    expect(result.prUrl).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
