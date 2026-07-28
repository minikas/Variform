/**
 * Minimal GitHub REST client used by the "Push to GitHub" feature.
 *
 * Variform exports a single file per format (exporters stay single-output), so
 * we deliberately avoid the heavy Octokit dependency and talk to the GitHub
 * REST API directly with `fetch`. Multi-format pushes bundle several exported
 * files into one atomic commit via the Git Data API (see {@link pushFiles}).
 * All requests run inside the plugin UI iframe, which has full browser APIs and
 * is granted network access to api.github.com via the plugin manifest.
 *
 * The Personal Access Token is only ever sent to the configured GitHub host
 * over HTTPS — it is never logged or embedded in any exported file.
 */

export const DEFAULT_API_BASE = "https://api.github.com";

/** Auth for any GitHub API call that does not target a specific repository. */
export interface GitHubAuth {
  /** Personal Access Token. */
  token: string;
  /** API base URL. Defaults to api.github.com; override for GitHub Enterprise. */
  baseUrl?: string;
}

/** Persisted connection details for a GitHub repository. */
export interface GitHubConnection extends GitHubAuth {
  /** Repository owner (user or organization). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Branch new branches and pull requests are based on (e.g. "main"). */
  baseBranch: string;
}

/** Subset of repository metadata the UI needs after verifying a connection. */
export interface RepoInfo {
  defaultBranch: string;
  canPush: boolean;
  fullName: string;
}

/** Error thrown when GitHub responds with a non-2xx status. */
export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

interface GitHubRequestOptions {
  method?: string;
  body?: unknown;
  /** When true, a 404 resolves to `null` instead of throwing. */
  allow404?: boolean;
}

function apiBase(auth: GitHubAuth): string {
  return (auth.baseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
}

/** Encode a single path segment (owner, repo, branch in query position). */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/** Encode a slash-separated path while keeping the separators intact. */
function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

async function toApiError(response: Response): Promise<GitHubApiError> {
  let detail = "";
  try {
    const data = await response.json();
    detail = typeof data?.message === "string" ? data.message : "";
  } catch {
    // Body was empty or not JSON — fall back to the status code alone.
  }
  const message = detail
    ? `GitHub API error (${response.status}): ${detail}`
    : `GitHub API error (${response.status})`;
  return new GitHubApiError(response.status, message);
}

async function githubRequest<T>(
  auth: GitHubAuth,
  path: string,
  options: GitHubRequestOptions = {},
): Promise<T | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${apiBase(auth)}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 404 && options.allow404) {
    return null;
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return null;
  }
  return (await response.json()) as T;
}

/**
 * Verify the token is valid and return the authenticated user's login.
 * Used when connecting (the connection stores identity only — decision D3).
 * Throws a {@link GitHubApiError} when the token is invalid (401).
 */
export async function getAuthenticatedUser(
  auth: GitHubAuth,
): Promise<{ login: string }> {
  const data = await githubRequest<{ login: string }>(auth, "/user");
  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty user response.");
  }
  return { login: data.login };
}

/**
 * Verify the token and repository are valid and reachable.
 * Throws a {@link GitHubApiError} when the token is invalid (401) or the
 * repository cannot be accessed (404).
 */
export async function verifyConnection(conn: GitHubConnection): Promise<RepoInfo> {
  const data = await githubRequest<{
    default_branch: string;
    full_name: string;
    permissions?: { push?: boolean };
  }>(conn, `/repos/${seg(conn.owner)}/${seg(conn.repo)}`);

  // A 2xx without a body should never happen here, but keep types honest.
  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty repository response.");
  }

  return {
    defaultBranch: data.default_branch,
    canPush: Boolean(data.permissions?.push),
    fullName: data.full_name,
  };
}

/** Summary of a repository the token can access (for the connect picker). */
export interface RepoSummary {
  /** "owner/repo". */
  fullName: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  canPush: boolean;
}

/** Max pages (×100 items) fetched when listing repositories/branches. */
const LIST_MAX_PAGES = 5;

/**
 * List repositories the token can access (owned, collaborator and org repos),
 * most-recently-updated first. Paginated up to {@link LIST_MAX_PAGES}×100.
 */
export async function listRepositories(auth: GitHubAuth): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = [];
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const data = await githubRequest<
      Array<{
        full_name: string;
        name: string;
        owner: { login: string };
        default_branch: string;
        permissions?: { push?: boolean };
      }>
    >(
      auth,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    if (!data || data.length === 0) {
      break;
    }
    for (const item of data) {
      repos.push({
        fullName: item.full_name,
        owner: item.owner.login,
        repo: item.name,
        defaultBranch: item.default_branch,
        canPush: Boolean(item.permissions?.push),
      });
    }
    if (data.length < 100) {
      break;
    }
  }
  return repos;
}

/** List branch names for a repository (paginated). */
export async function listBranches(
  auth: GitHubAuth,
  owner: string,
  repo: string,
): Promise<string[]> {
  const branches: string[] = [];
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const data = await githubRequest<Array<{ name: string }>>(
      auth,
      `/repos/${seg(owner)}/${seg(repo)}/branches?per_page=100&page=${page}`,
    );
    if (!data || data.length === 0) {
      break;
    }
    branches.push(...data.map((branch) => branch.name));
    if (data.length < 100) {
      break;
    }
  }
  return branches;
}

/** Return the commit SHA a branch points to, or `null` if it does not exist. */
export async function getBranchSha(
  conn: GitHubConnection,
  branch: string,
): Promise<string | null> {
  const data = await githubRequest<{ object: { sha: string } }>(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/git/ref/heads/${encodePath(branch)}`,
    { allow404: true },
  );
  return data ? data.object.sha : null;
}

/** Create a new branch pointing at `fromSha`. */
export async function createBranch(
  conn: GitHubConnection,
  newBranch: string,
  fromSha: string,
): Promise<void> {
  await githubRequest(conn, `/repos/${seg(conn.owner)}/${seg(conn.repo)}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${newBranch}`, sha: fromSha },
  });
}

/**
 * Fetch the raw text of a file on a branch, or `null` when it does not exist
 * (or the path resolves to a directory — see below).
 * Uses the raw media type so the body comes back as the file contents directly
 * (rather than the base64-wrapped JSON envelope).
 */
export async function getFileContent(
  conn: GitHubConnection,
  path: string,
  branch: string,
): Promise<string | null> {
  const response = await fetch(
    `${apiBase(conn)}/repos/${seg(conn.owner)}/${seg(conn.repo)}/contents/${encodePath(path)}?ref=${seg(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${conn.token}`,
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  // The raw media type only applies to files: for a DIRECTORY path GitHub
  // ignores it and answers 200 with the JSON listing. Treat that like a
  // missing file instead of diffing against directory JSON.
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return null;
  }
  return await response.text();
}

/**
 * Create a Git blob with UTF-8 content and return its SHA.
 * (`utf-8` encoding avoids the base64 round-trip the Contents API requires.)
 */
export async function createBlob(
  conn: GitHubConnection,
  content: string,
): Promise<string> {
  const data = await githubRequest<{ sha: string }>(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/git/blobs`,
    {
      method: "POST",
      body: { content, encoding: "utf-8" },
    },
  );
  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty blob response.");
  }
  return data.sha;
}

/** Return the tree SHA of a commit (used as `base_tree` for new trees). */
export async function getCommitTreeSha(
  conn: GitHubConnection,
  commitSha: string,
): Promise<string> {
  const data = await githubRequest<{ tree: { sha: string } }>(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/git/commits/${seg(commitSha)}`,
  );
  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty commit response.");
  }
  return data.tree.sha;
}

/** A file entry in a new tree: repository-relative path + blob SHA. */
export interface TreeEntry {
  path: string;
  sha: string;
}

/**
 * Create a tree on top of `baseTree` containing the given file entries.
 * Files absent from `entries` keep their `baseTree` content.
 */
export async function createTree(
  conn: GitHubConnection,
  params: { baseTree: string; entries: TreeEntry[] },
): Promise<string> {
  const data = await githubRequest<{ sha: string }>(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/git/trees`,
    {
      method: "POST",
      body: {
        base_tree: params.baseTree,
        tree: params.entries.map((entry) => ({
          path: entry.path,
          mode: "100644",
          type: "blob",
          sha: entry.sha,
        })),
      },
    },
  );
  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty tree response.");
  }
  return data.sha;
}

export interface CreatedCommit {
  sha: string;
  htmlUrl: string | null;
}

/** Create a commit with the given tree and parent(s). */
export async function createCommit(
  conn: GitHubConnection,
  params: { message: string; tree: string; parents: string[] },
): Promise<CreatedCommit> {
  const data = await githubRequest<{ sha: string; html_url?: string }>(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/git/commits`,
    {
      method: "POST",
      body: { message: params.message, tree: params.tree, parents: params.parents },
    },
  );
  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty commit response.");
  }
  return { sha: data.sha, htmlUrl: data.html_url ?? null };
}

/**
 * Move a branch ref to `sha` (non-forced: the update is rejected with a 422
 * when the branch HEAD is not the parent of `sha` — callers may rebuild the
 * commit on the fresh HEAD and retry once).
 */
export async function updateRef(
  conn: GitHubConnection,
  branch: string,
  sha: string,
): Promise<void> {
  await githubRequest(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/git/refs/heads/${encodePath(branch)}`,
    {
      method: "PATCH",
      body: { sha, force: false },
    },
  );
}

/** Run `fn` over `items` with at most `limit` promises in flight, order-preserving. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** Max concurrent blob creations (friendly to secondary rate limits). */
const BLOB_CONCURRENCY = 3;

export interface PushFilesParams {
  /** Target branch. When equal to the base branch, no PR is created. */
  branch: string;
  /** Base branch for branch creation and PRs. Defaults to the connection's. */
  baseBranch?: string;
  message: string;
  files: Array<{ path: string; content: string }>;
  createPr?: boolean;
  prTitle?: string;
  prBody?: string;
}

export interface CreatePullRequestParams {
  title: string;
  head: string;
  base: string;
  body?: string;
}

export interface PullRequestResult {
  url: string;
  number: number;
}

/** Open a pull request from `head` into `base`. */
export async function createPullRequest(
  conn: GitHubConnection,
  params: CreatePullRequestParams,
): Promise<PullRequestResult> {
  const data = await githubRequest<{ html_url: string; number: number }>(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/pulls`,
    {
      method: "POST",
      body: {
        title: params.title,
        head: params.head,
        base: params.base,
        body: params.body ?? "",
      },
    },
  );

  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty pull request response.");
  }

  return { url: data.html_url, number: data.number };
}

/**
 * Build the github.com "compare" URL that opens a pre-filled pull request form.
 * Used as a fallback when automatic PR creation is skipped or fails.
 */
export function buildCompareUrl(conn: GitHubConnection, branch: string): string {
  const base = apiBase(conn);
  const webBase =
    base === DEFAULT_API_BASE
      ? "https://github.com"
      : base.replace(/\/api\/v3$/, "");
  return `${webBase}/${conn.owner}/${conn.repo}/compare/${conn.baseBranch}...${branch}?expand=1`;
}

export interface PushResult {
  branch: string;
  commitSha: string;
  commitUrl: string | null;
  /** Set when a pull request was created automatically. */
  prUrl: string | null;
  /** Always available so the user can open a PR manually if needed. */
  compareUrl: string;
}

/**
 * Commit several files to GitHub as ONE atomic commit (Git Data API:
 * blobs → tree on the branch HEAD tree → commit → ref update) and, when
 * requested, open a single pull request for the whole set.
 *
 * The target branch is created from the base branch when it does not exist.
 * If the ref update races (branch moved between diff and push), the tree and
 * commit are rebuilt once on the fresh HEAD. If automatic PR creation fails,
 * the returned {@link PushResult.compareUrl} still lets the user open one.
 */
export async function pushFiles(
  conn: GitHubConnection,
  params: PushFilesParams,
): Promise<PushResult> {
  if (params.files.length === 0) {
    throw new GitHubApiError(400, "pushFiles requires at least one file.");
  }

  const baseBranch = params.baseBranch ?? conn.baseBranch;
  // Scope the connection to the group's base branch so buildCompareUrl and
  // createPullRequest target the right base even when it differs from the
  // connection default.
  const repo: GitHubConnection = { ...conn, baseBranch };
  const targetIsBase = params.branch === baseBranch;

  // Resolve the branch HEAD, creating the branch from the base when missing.
  let headSha = await getBranchSha(repo, params.branch);
  if (!headSha) {
    const baseSha = await getBranchSha(repo, baseBranch);
    if (!baseSha) {
      throw new GitHubApiError(
        404,
        `Base branch "${baseBranch}" was not found in ${repo.owner}/${repo.repo}.`,
      );
    }
    try {
      await createBranch(repo, params.branch, baseSha);
      headSha = baseSha;
    } catch (error) {
      // Race: another process created the branch between our existence check
      // and the create call. A 422 is only safe to ignore if the branch
      // really exists now — otherwise rethrow (e.g. an invalid base SHA).
      if (!(error instanceof GitHubApiError) || error.status !== 422) {
        throw error;
      }
      const raced = await getBranchSha(repo, params.branch);
      if (!raced) {
        throw error;
      }
      headSha = raced;
    }
  }

  // One blob per file (small concurrency to stay friendly to rate limits).
  // Blobs are content-addressed, so a ref-race rebuild can reuse these SHAs.
  const blobShas = await mapWithConcurrency(params.files, BLOB_CONCURRENCY, (file) =>
    createBlob(repo, file.content),
  );

  // Build a tree + commit on top of the given parent commit.
  const buildCommit = async (parentSha: string): Promise<CreatedCommit> => {
    const baseTree = await getCommitTreeSha(repo, parentSha);
    const tree = await createTree(repo, {
      baseTree,
      entries: params.files.map((file, index) => ({
        path: file.path,
        sha: blobShas[index],
      })),
    });
    return createCommit(repo, {
      message: params.message,
      tree,
      parents: [parentSha],
    });
  };

  let commit = await buildCommit(headSha);
  try {
    await updateRef(repo, params.branch, commit.sha);
  } catch (error) {
    // Ref race: the branch HEAD moved while we were pushing. Re-fetch the
    // HEAD, rebuild the tree/commit on top of it, and retry exactly once.
    if (!(error instanceof GitHubApiError) || error.status !== 422) {
      throw error;
    }
    const freshHead = await getBranchSha(repo, params.branch);
    if (!freshHead) {
      throw error;
    }
    commit = await buildCommit(freshHead);
    await updateRef(repo, params.branch, commit.sha);
  }

  const compareUrl = buildCompareUrl(repo, params.branch);

  let prUrl: string | null = null;
  if (params.createPr && !targetIsBase) {
    try {
      const pr = await createPullRequest(repo, {
        title: params.prTitle || params.message,
        head: params.branch,
        base: baseBranch,
        body: params.prBody,
      });
      prUrl = pr.url;
    } catch {
      // PR may already exist or have no diff — the compare URL is the fallback.
      prUrl = null;
    }
  }

  return {
    branch: params.branch,
    commitSha: commit.sha,
    commitUrl: commit.htmlUrl,
    prUrl,
    compareUrl,
  };
}
