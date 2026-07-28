import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GitHubApiError,
  GitHubConnection,
  buildCompareUrl,
  createBlob,
  createBranch,
  createCommit,
  createPullRequest,
  createTree,
  getAuthenticatedUser,
  getBranchSha,
  getFileContent,
  listBranches,
  listRepositories,
  pushFiles,
  updateRef,
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
  /** Content-Type header, mirroring what GitHub would send. */
  contentType?: string;
}

function fakeResponse({ status = 200, body, contentType }: FakeResponseInit) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(
      contentType ? { "Content-Type": contentType } : undefined,
    ),
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

describe("getAuthenticatedUser", () => {
  it("returns the login and sends auth headers", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({ body: { login: "octocat" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAuthenticatedUser({ token: "ghp_x" })).toEqual({
      login: "octocat",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/user");
    expect(init.headers.Authorization).toBe("Bearer ghp_x");
  });

  it("throws a GitHubApiError on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({ status: 401, body: { message: "Bad credentials" } }),
      ),
    );
    await expect(getAuthenticatedUser({ token: "bad" })).rejects.toBeInstanceOf(
      GitHubApiError,
    );
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
      return fakeResponse({ body: "{\n  \"a\": 1\n}", contentType: "text/plain; charset=utf-8" });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getFileContent(conn, "tokens.json", "main")).toBe('{\n  "a": 1\n}');
  });

  it("returns null when the file is missing (404)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ status: 404 })));
    expect(await getFileContent(conn, "tokens.json", "main")).toBeNull();
  });

  it("returns null when the path is a directory (200 with a JSON listing)", async () => {
    // GitHub ignores the raw media type for directories and answers 200 with
    // the JSON listing — it must not become the "old content" of a diff.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          body: [{ name: "a.json", type: "file" }],
          contentType: "application/json; charset=utf-8",
        }),
      ),
    );
    expect(await getFileContent(conn, "tokens", "main")).toBeNull();
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

describe("Git Data API helpers", () => {
  it("createBlob posts UTF-8 content and returns the blob SHA", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({ status: 201, body: { sha: "blobsha" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await createBlob(conn, "héllo")).toBe("blobsha");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/design-tokens/git/blobs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      content: "héllo",
      encoding: "utf-8",
    });
  });

  it("createTree posts blob entries on top of the base tree", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({ status: 201, body: { sha: "treesha" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const treeSha = await createTree(conn, {
      baseTree: "basetree",
      entries: [
        { path: "tokens/web.css", sha: "b1" },
        { path: "tokens/app.dart", sha: "b2" },
      ],
    });

    expect(treeSha).toBe("treesha");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/design-tokens/git/trees");
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      base_tree: "basetree",
      tree: [
        { path: "tokens/web.css", mode: "100644", type: "blob", sha: "b1" },
        { path: "tokens/app.dart", mode: "100644", type: "blob", sha: "b2" },
      ],
    });
  });

  it("createCommit posts message/tree/parents and maps the html_url", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({
        status: 201,
        body: { sha: "commitsha", html_url: "https://gh/commit" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const commit = await createCommit(conn, {
      message: "msg",
      tree: "treesha",
      parents: ["parentsha"],
    });

    expect(commit).toEqual({ sha: "commitsha", htmlUrl: "https://gh/commit" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/design-tokens/git/commits");
    expect(JSON.parse(init.body ?? "{}")).toEqual({
      message: "msg",
      tree: "treesha",
      parents: ["parentsha"],
    });
  });

  it("updateRef patches the branch ref non-forced", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: FetchInit) =>
      fakeResponse({ body: { ref: "refs/heads/feature" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateRef(conn, "feature/x", "commitsha");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/acme/design-tokens/git/refs/heads/feature/x",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body ?? "{}")).toEqual({ sha: "commitsha", force: false });
  });
});

describe("pushFiles", () => {
  const files = [
    { path: "tokens/web.css", content: ":root {}" },
    { path: "tokens/app.dart", content: "const x = 1;" },
  ];

  /** Bodies of every POST /git/commits call, in order. */
  function commitBodies(fetchMock: ReturnType<typeof routeFetch>) {
    return fetchMock.mock.calls
      .filter(
        ([url, init]) =>
          url.includes("/git/commits") && (init as FetchInit).method === "POST",
      )
      .map(([, init]) => JSON.parse((init as FetchInit).body ?? "{}"));
  }

  it("creates the branch and lands one atomic commit + PR for a new branch", async () => {
    const fetchMock = routeFetch([
      // target branch does not exist yet
      { method: "GET", match: "/git/ref/heads/variform/tokens", response: { status: 404 } },
      // base branch SHA lookup
      {
        method: "GET",
        match: "/git/ref/heads/main",
        response: { body: { object: { sha: "basesha" } } },
      },
      // create branch
      { method: "POST", match: "/git/refs", response: { status: 201, body: { ref: "x" } } },
      // one blob per file
      { method: "POST", match: "/git/blobs", response: { status: 201, body: { sha: "blob1" } } },
      { method: "POST", match: "/git/blobs", response: { status: 201, body: { sha: "blob2" } } },
      // HEAD commit → base tree
      {
        method: "GET",
        match: "/git/commits/basesha",
        response: { body: { sha: "basesha", tree: { sha: "basetree" } } },
      },
      { method: "POST", match: "/git/trees", response: { status: 201, body: { sha: "newtree" } } },
      {
        method: "POST",
        match: "/git/commits",
        response: { status: 201, body: { sha: "newcommit", html_url: "https://gh/c" } },
      },
      { method: "PATCH", match: "/git/refs/heads/variform/tokens", response: { body: {} } },
      {
        method: "POST",
        match: "/pulls",
        response: { status: 201, body: { html_url: "https://gh/pr/9", number: 9 } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushFiles(conn, {
      branch: "variform/tokens-abc",
      message: "update tokens",
      files,
      createPr: true,
    });

    expect(result).toEqual({
      branch: "variform/tokens-abc",
      commitSha: "newcommit",
      commitUrl: "https://gh/c",
      prUrl: "https://gh/pr/9",
      compareUrl:
        "https://github.com/acme/design-tokens/compare/main...variform/tokens-abc?expand=1",
    });
    // Both files went into a single commit based on the branch HEAD.
    expect(commitBodies(fetchMock)).toEqual([
      { message: "update tokens", tree: "newtree", parents: ["basesha"] },
    ]);
  });

  it("reuses an existing branch without recreating it", async () => {
    const fetchMock = routeFetch([
      {
        method: "GET",
        match: "/git/ref/heads/variform/tokens",
        response: { body: { object: { sha: "headsha" } } },
      },
      { method: "POST", match: "/git/blobs", response: { status: 201, body: { sha: "blob1" } } },
      {
        method: "GET",
        match: "/git/commits/headsha",
        response: { body: { sha: "headsha", tree: { sha: "basetree" } } },
      },
      { method: "POST", match: "/git/trees", response: { status: 201, body: { sha: "newtree" } } },
      {
        method: "POST",
        match: "/git/commits",
        response: { status: 201, body: { sha: "newcommit", html_url: null } },
      },
      { method: "PATCH", match: "/git/refs/heads/variform/tokens", response: { body: {} } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushFiles(conn, {
      branch: "variform/tokens-abc",
      message: "update tokens",
      files: [files[0]],
      createPr: false,
    });

    expect(result.commitSha).toBe("newcommit");
    expect(result.prUrl).toBeNull();
    // No branch creation, no PR: 6 calls total.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("rebuilds tree/commit on the fresh HEAD and retries once on a ref race (422)", async () => {
    const fetchMock = routeFetch([
      {
        method: "GET",
        match: "/git/ref/heads/variform/tokens",
        response: { body: { object: { sha: "headsha" } } },
      },
      { method: "POST", match: "/git/blobs", response: { status: 201, body: { sha: "blob1" } } },
      {
        method: "GET",
        match: "/git/commits/headsha",
        response: { body: { sha: "headsha", tree: { sha: "basetree" } } },
      },
      { method: "POST", match: "/git/trees", response: { status: 201, body: { sha: "tree1" } } },
      {
        method: "POST",
        match: "/git/commits",
        response: { status: 201, body: { sha: "commit1", html_url: null } },
      },
      // branch moved underneath us
      {
        method: "PATCH",
        match: "/git/refs/heads/variform/tokens",
        response: { status: 422, body: { message: "Update is not a fast forward" } },
      },
      // retry: re-fetch HEAD, rebuild tree/commit, patch again
      {
        method: "GET",
        match: "/git/ref/heads/variform/tokens",
        response: { body: { object: { sha: "freshsha" } } },
      },
      {
        method: "GET",
        match: "/git/commits/freshsha",
        response: { body: { sha: "freshsha", tree: { sha: "freshtree" } } },
      },
      { method: "POST", match: "/git/trees", response: { status: 201, body: { sha: "tree2" } } },
      {
        method: "POST",
        match: "/git/commits",
        response: { status: 201, body: { sha: "commit2", html_url: "https://gh/c2" } },
      },
      { method: "PATCH", match: "/git/refs/heads/variform/tokens", response: { body: {} } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushFiles(conn, {
      branch: "variform/tokens-abc",
      message: "update tokens",
      files: [files[0]],
      createPr: false,
    });

    expect(result.commitSha).toBe("commit2");
    // The retried commit is re-parented on the fresh HEAD (blobs are reused).
    expect(commitBodies(fetchMock)).toEqual([
      { message: "update tokens", tree: "tree1", parents: ["headsha"] },
      { message: "update tokens", tree: "tree2", parents: ["freshsha"] },
    ]);
  });

  it("fails after the single retry when the ref keeps racing", async () => {
    const fetchMock = routeFetch([
      {
        method: "GET",
        match: "/git/ref/heads/variform/tokens",
        response: { body: { object: { sha: "headsha" } } },
      },
      { method: "POST", match: "/git/blobs", response: { status: 201, body: { sha: "blob1" } } },
      {
        method: "GET",
        match: "/git/commits/headsha",
        response: { body: { sha: "headsha", tree: { sha: "basetree" } } },
      },
      { method: "POST", match: "/git/trees", response: { status: 201, body: { sha: "tree1" } } },
      {
        method: "POST",
        match: "/git/commits",
        response: { status: 201, body: { sha: "commit1" } },
      },
      {
        method: "PATCH",
        match: "/git/refs/heads/variform/tokens",
        response: { status: 422, body: { message: "race" } },
      },
      {
        method: "GET",
        match: "/git/ref/heads/variform/tokens",
        response: { body: { object: { sha: "freshsha" } } },
      },
      {
        method: "GET",
        match: "/git/commits/freshsha",
        response: { body: { sha: "freshsha", tree: { sha: "freshtree" } } },
      },
      { method: "POST", match: "/git/trees", response: { status: 201, body: { sha: "tree2" } } },
      {
        method: "POST",
        match: "/git/commits",
        response: { status: 201, body: { sha: "commit2" } },
      },
      // second race — no further retry
      {
        method: "PATCH",
        match: "/git/refs/heads/variform/tokens",
        response: { status: 422, body: { message: "race again" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pushFiles(conn, {
        branch: "variform/tokens-abc",
        message: "update tokens",
        files: [files[0]],
        createPr: false,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("aborts without a commit when a blob creation fails (partial API failure)", async () => {
    const fetchMock = routeFetch([
      {
        method: "GET",
        match: "/git/ref/heads/variform/tokens",
        response: { body: { object: { sha: "headsha" } } },
      },
      { method: "POST", match: "/git/blobs", response: { status: 201, body: { sha: "blob1" } } },
      {
        method: "POST",
        match: "/git/blobs",
        response: { status: 403, body: { message: "Resource not accessible" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pushFiles(conn, {
        branch: "variform/tokens-abc",
        message: "update tokens",
        files,
        createPr: false,
      }),
    ).rejects.toMatchObject({ status: 403 });

    // Nothing was committed: no tree/commit/ref calls happened.
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes("/git/trees")),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url.includes("/git/refs") && (init as FetchInit).method === "PATCH",
      ),
    ).toBe(false);
  });

  it("rejects when asked to push zero files", async () => {
    await expect(
      pushFiles(conn, { branch: "x", message: "m", files: [] }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("skips PR creation and falls back to compareUrl when the PR already exists", async () => {
    const fetchMock = routeFetch([
      {
        method: "GET",
        match: "/git/ref/heads/variform/tokens",
        response: { body: { object: { sha: "headsha" } } },
      },
      { method: "POST", match: "/git/blobs", response: { status: 201, body: { sha: "blob1" } } },
      {
        method: "GET",
        match: "/git/commits/headsha",
        response: { body: { sha: "headsha", tree: { sha: "basetree" } } },
      },
      { method: "POST", match: "/git/trees", response: { status: 201, body: { sha: "newtree" } } },
      {
        method: "POST",
        match: "/git/commits",
        response: { status: 201, body: { sha: "newcommit", html_url: null } },
      },
      { method: "PATCH", match: "/git/refs/heads/variform/tokens", response: { body: {} } },
      {
        method: "POST",
        match: "/pulls",
        response: { status: 422, body: { message: "already exists" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushFiles(conn, {
      branch: "variform/tokens-abc",
      message: "update tokens",
      files: [files[0]],
      createPr: true,
    });

    expect(result.prUrl).toBeNull();
    expect(result.compareUrl).toContain("compare/main...variform/tokens-abc");
  });
});
