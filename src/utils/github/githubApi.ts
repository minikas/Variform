/**
 * Minimal GitHub REST client used by the "Push to GitHub" feature.
 *
 * Variform exports a single file per format, so we deliberately avoid the heavy
 * Octokit dependency and talk to the GitHub REST API directly with `fetch`.
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
 * Encode a UTF-8 string to base64 (required by the GitHub Contents API).
 * `btoa` only handles Latin-1, so we go through TextEncoder first.
 */
export function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
 * Return the blob SHA of an existing file on a branch, or `null` if the file
 * does not exist (or the path resolves to a directory).
 */
export async function getFileSha(
  conn: GitHubConnection,
  path: string,
  branch: string,
): Promise<string | null> {
  const data = await githubRequest<{ sha: string } | unknown[]>(
    conn,
    `/repos/${seg(conn.owner)}/${seg(conn.repo)}/contents/${encodePath(path)}?ref=${seg(branch)}`,
    { allow404: true },
  );
  if (!data || Array.isArray(data)) {
    return null;
  }
  return (data as { sha: string }).sha;
}

/**
 * Fetch the raw text of a file on a branch, or `null` when it does not exist.
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
  return await response.text();
}

export interface CommitFileParams {
  path: string;
  content: string;
  message: string;
  branch: string;
  /** Blob SHA of the file being replaced. Omit when creating a new file. */
  sha?: string;
}

export interface CommitResult {
  commitSha: string;
  contentHtmlUrl: string | null;
}

/** Create or update a single file on a branch. */
export async function commitFile(
  conn: GitHubConnection,
  params: CommitFileParams,
): Promise<CommitResult> {
  const data = await githubRequest<{
    commit: { sha: string };
    content: { html_url: string } | null;
  }>(conn, `/repos/${seg(conn.owner)}/${seg(conn.repo)}/contents/${encodePath(params.path)}`, {
    method: "PUT",
    body: {
      message: params.message,
      content: utf8ToBase64(params.content),
      branch: params.branch,
      ...(params.sha ? { sha: params.sha } : {}),
    },
  });

  if (!data) {
    throw new GitHubApiError(500, "GitHub returned an empty commit response.");
  }

  return {
    commitSha: data.commit.sha,
    contentHtmlUrl: data.content?.html_url ?? null,
  };
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

export interface PushParams {
  /** Repository-relative file path, e.g. "tokens/variables.json". */
  path: string;
  content: string;
  commitMessage: string;
  /** Target branch. When equal to the base branch, no PR is created. */
  branch: string;
  createPr: boolean;
  prTitle?: string;
  prBody?: string;
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
 * Commit a file to GitHub and, when requested, open a pull request.
 *
 * The target branch is created from the base branch when it does not exist.
 * If automatic PR creation fails (e.g. one already exists or there is no diff),
 * the returned {@link PushResult.compareUrl} still lets the user open one.
 */
export async function pushFile(
  conn: GitHubConnection,
  params: PushParams,
): Promise<PushResult> {
  const targetIsBase = params.branch === conn.baseBranch;

  if (!targetIsBase) {
    const existing = await getBranchSha(conn, params.branch);
    if (!existing) {
      const baseSha = await getBranchSha(conn, conn.baseBranch);
      if (!baseSha) {
        throw new GitHubApiError(
          404,
          `Base branch "${conn.baseBranch}" was not found in ${conn.owner}/${conn.repo}.`,
        );
      }
      await createBranch(conn, params.branch, baseSha);
    }
  }

  const existingFileSha = await getFileSha(conn, params.path, params.branch);
  const commit = await commitFile(conn, {
    path: params.path,
    content: params.content,
    message: params.commitMessage,
    branch: params.branch,
    sha: existingFileSha ?? undefined,
  });

  const compareUrl = buildCompareUrl(conn, params.branch);

  let prUrl: string | null = null;
  if (params.createPr && !targetIsBase) {
    try {
      const pr = await createPullRequest(conn, {
        title: params.prTitle || params.commitMessage,
        head: params.branch,
        base: conn.baseBranch,
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
    commitSha: commit.commitSha,
    commitUrl: commit.contentHtmlUrl,
    prUrl,
    compareUrl,
  };
}
