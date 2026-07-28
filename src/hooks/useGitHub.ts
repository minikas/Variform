import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  GitHubAuth,
  GitHubConnection,
  PushResult,
  getAuthenticatedUser,
  getFileContent,
  pushFiles,
} from "../utils/github/githubApi";
import { DiffResult, computeDiff } from "../utils/github/tokenDiff";
import { EncryptedSecret, decryptSecret, encryptSecret } from "../utils/github/crypto";
import { useClientStorage } from "./useClientStorage";

/** clientStorage key holding the JSON-encoded GitHub connection. */
export const GITHUB_CONNECTION_KEY = "varvar.github.connection";

export type GitHubStatus = "idle" | "verifying" | "pushing" | "success" | "error";

export type DiffStatus = "idle" | "loading" | "error";

/**
 * Connection metadata persisted in clientStorage (decision D3): identity only.
 * The plaintext token is NEVER persisted — only the AES-GCM-encrypted blob
 * (when the user opts to remember). Repository/branch/path live in
 * per-document push targets, not here.
 */
export interface StoredConnection {
  baseUrl?: string;
  /** Present when the token was persisted (encrypted with a passphrase). */
  encrypted?: EncryptedSecret;
  /** Cached GitHub login for display purposes. */
  login?: string;
}

/**
 * Repository scope recovered from a legacy single-repo connection. Used once
 * to seed the initial push target; never persisted as part of the connection.
 */
export interface RepoScope {
  owner: string;
  repo: string;
  baseBranch: string;
}

/**
 * Connection metadata as exposed to the UI: the stored identity plus the
 * legacy repository scope when one was migrated (display/seeding only).
 */
export type ConnectionMeta = StoredConnection & Partial<RepoScope>;

export interface ConnectArgs {
  token: string;
  baseUrl?: string;
  /** Persist the encrypted token across plugin sessions. */
  persist: boolean;
  /** Required when `persist` is true — used to encrypt the token. */
  passphrase?: string;
}

/** One file to diff: a target's repo coordinates plus the fresh export. */
export interface PreviewDiffArgs {
  /** Push target id — keys the per-target diff state and query cache. */
  targetId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  branch: string;
  path: string;
  /** File extension that selects the diff parser (e.g. "json" / "css"). */
  extension: string;
  /** The freshly generated export contents. */
  content: string;
}

export interface TargetDiffState {
  diff: DiffResult | null;
  status: DiffStatus;
  error: string | null;
}

/** One repo+branch group to push as a single atomic commit (decision D1/D2). */
export interface PushGroupInput {
  /** Grouping key `${owner}/${repo}#${branch}` (see utils/github/pushTargets). */
  key: string;
  owner: string;
  repo: string;
  baseBranch: string;
  branch: string;
  message: string;
  createPr: boolean;
  /** Ids of the targets in the group — used to invalidate their diff queries. */
  targetIds: string[];
  files: Array<{ path: string; content: string }>;
}

/** Outcome of one group's push (partial success is reported per group). */
export interface PushGroupResult {
  key: string;
  owner: string;
  repo: string;
  branch: string;
  result?: PushResult;
  error?: string;
}

/** Progress of a multi-group push, for the dialog footer. */
export interface PushProgress {
  done: number;
  total: number;
}

export interface UseGitHubReturn {
  /** Connection metadata (identity-only), without the token. */
  meta: ConnectionMeta | null;
  /** Legacy repo scope recovered from storage — seed for the first target. */
  repoScope: RepoScope | null;
  /** True when a connection exists (whether locked or unlocked). */
  isConnected: boolean;
  /** True when the connection is persisted+encrypted and not yet unlocked. */
  isLocked: boolean;
  /** Token + baseUrl for this session — only available once unlocked. */
  auth: GitHubAuth | null;
  /** True once clientStorage has been read. */
  isLoaded: boolean;
  status: GitHubStatus;
  error: string | null;
  /** Verify the token, then keep (and optionally encrypt+persist) identity. */
  connect: (args: ConnectArgs) => Promise<boolean>;
  /** Decrypt the persisted token with the passphrase for this session. */
  unlock: (passphrase: string) => Promise<boolean>;
  /** Forget the saved connection and clear the in-memory token. */
  disconnect: () => void;
  /**
   * Push all groups sequentially (one atomic commit each). Resolves to true
   * when the run completed — per-group outcomes are in {@link groupResults}
   * (partial success does not throw).
   */
  pushGroups: (groups: PushGroupInput[]) => Promise<boolean>;
  /** Per-group outcomes of the last push run, in group order. */
  groupResults: PushGroupResult[] | null;
  /** Live progress while a push run is in flight. */
  pushProgress: PushProgress | null;
  /** Clear transient status/error/results/diffs (e.g. when reopening). */
  reset: () => void;
  /** Per-target diff state, keyed by target id. */
  diffs: Record<string, TargetDiffState>;
  /** Fetch repo files and compute per-target diffs against the new exports. */
  previewDiffs: (args: PreviewDiffArgs[]) => void;
  /** Discard all previously computed diffs. */
  clearDiffs: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred while contacting GitHub.";
}

export interface ParsedStored {
  /** Identity-only connection metadata (decision D3). */
  meta: StoredConnection;
  /**
   * Repo fields recovered from a legacy single-repo record. They seed the
   * initial push target instead of being persisted back into the connection.
   */
  repo?: RepoScope;
  /** Set only for legacy plaintext connections saved before encryption. */
  plaintextToken?: string;
}

/** Validate that a stored `encrypted` blob has all required string fields. */
function parseEncrypted(value: unknown): EncryptedSecret | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const blob = value as Record<string, unknown>;
  if (
    typeof blob.salt === "string" &&
    typeof blob.iv === "string" &&
    typeof blob.ciphertext === "string"
  ) {
    return { salt: blob.salt, iv: blob.iv, ciphertext: blob.ciphertext };
  }
  return undefined;
}

export function parseStored(value: string | null | undefined): ParsedStored | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const encrypted = parseEncrypted(parsed.encrypted);
    const hasLegacyRepo =
      typeof parsed.owner === "string" && typeof parsed.repo === "string";
    // A record is a connection when it carries the legacy repo fields or the
    // identity-only shape (an encrypted token blob). Anything else is ignored.
    if (!hasLegacyRepo && !encrypted) {
      return null;
    }
    const meta: StoredConnection = {};
    if (typeof parsed.baseUrl === "string") {
      meta.baseUrl = parsed.baseUrl;
    }
    if (typeof parsed.login === "string") {
      meta.login = parsed.login;
    }
    if (encrypted) {
      meta.encrypted = encrypted;
    }
    const result: ParsedStored = { meta };
    if (hasLegacyRepo) {
      result.repo = {
        owner: parsed.owner as string,
        repo: parsed.repo as string,
        baseBranch: typeof parsed.baseBranch === "string" ? parsed.baseBranch : "main",
      };
    }
    const plaintextToken = typeof parsed.token === "string" ? parsed.token : undefined;
    if (plaintextToken) {
      result.plaintextToken = plaintextToken;
    }
    return result;
  } catch {
    // Corrupt value — treat as not connected.
  }
  return null;
}

/**
 * Legacy migration: records saved before token encryption held the token in
 * plaintext. Rewrite clientStorage WITHOUT the plaintext field (keeping any
 * encrypted blob) and return the adopted token so the current session keeps
 * working. Returns `null` when there is nothing to migrate. On the next
 * session there is no plaintext to adopt, so the user reconnects (or unlocks,
 * if an encrypted record exists).
 *
 * The rewrite persists the identity-only {@link StoredConnection} (decision
 * D3): legacy repo fields are dropped from storage here — they live on in the
 * session via {@link ParsedStored.repo} and, afterwards, in per-document
 * push targets.
 */
export function migrateLegacyPlaintext(
  parsed: ParsedStored | null,
  save: (next: string | null) => void,
): string | null {
  if (!parsed?.plaintextToken) {
    return null;
  }
  save(JSON.stringify(parsed.meta));
  return parsed.plaintextToken;
}

/**
 * Push the groups SEQUENTIALLY (one atomic commit per repo+branch group),
 * capturing per-group outcomes so one failing repo does not abort the others
 * (partial success is reported explicitly). The push function is injected so
 * tests can mock the GitHub client.
 */
export async function runPushGroups(
  groups: PushGroupInput[],
  push: (group: PushGroupInput) => Promise<PushResult>,
  onGroupDone?: (done: number, total: number) => void,
): Promise<PushGroupResult[]> {
  const results: PushGroupResult[] = [];
  for (const group of groups) {
    const base = {
      key: group.key,
      owner: group.owner,
      repo: group.repo,
      branch: group.branch,
    };
    try {
      const result = await push(group);
      results.push({ ...base, result });
    } catch (error) {
      results.push({ ...base, error: messageOf(error) });
    }
    onGroupDone?.(results.length, groups.length);
  }
  return results;
}

/**
 * Orchestrates the "Push to GitHub" flow with TanStack Query: connect/unlock/
 * push are mutations, the per-target diffs are queries. The token lives in
 * memory for the session; if remembered, it's encrypted with a passphrase
 * (AES-256-GCM) and persisted, then decrypted via {@link unlock} on reopen.
 * The stored connection is identity-only (D3) — repositories live in the
 * per-document push targets.
 */
export function useGitHub(): UseGitHubReturn {
  const { value, loaded, save } = useClientStorage(GITHUB_CONNECTION_KEY);
  const queryClient = useQueryClient();

  // In-memory identity for this session (not persisted unless the user opts in).
  const [sessionIdentity, setSessionIdentity] = useState<StoredConnection | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const parsed = useMemo(() => parseStored(value), [value]);
  const storedMeta = parsed?.meta ?? null;
  const identity = sessionIdentity ?? storedMeta;
  // Legacy repo fields of a stored record surface once, to seed the initial
  // push target — they are never written back into the connection.
  const repoScope = parsed?.repo ?? null;
  const meta = useMemo<ConnectionMeta | null>(
    () => (identity || repoScope ? { ...identity, ...repoScope } : null),
    [identity, repoScope],
  );
  // Legacy plaintext tokens (pre-encryption) are adopted for the session.
  const effectiveToken = sessionToken ?? parsed?.plaintextToken ?? null;

  const auth = useMemo<GitHubAuth | null>(
    () =>
      effectiveToken
        ? {
            token: effectiveToken,
            ...(identity?.baseUrl ? { baseUrl: identity.baseUrl } : {}),
          }
        : null,
    [effectiveToken, identity],
  );

  const isConnected = meta != null;
  const isLocked = meta != null && effectiveToken == null;

  // Scrub legacy plaintext tokens from clientStorage as soon as one is seen:
  // the token is adopted into the in-memory session (so this session keeps
  // working) and the record is rewritten without it — never persisted in
  // clear again. On the next session the user reconnects (or unlocks).
  useEffect(() => {
    if (!loaded) {
      return;
    }
    const adopted = migrateLegacyPlaintext(parsed, save);
    if (adopted !== null) {
      setSessionToken((current) => current ?? adopted);
    }
  }, [loaded, parsed, save]);

  // --- Mutations: connect / unlock / push -----------------------------------

  const connectMutation = useMutation({
    mutationFn: async (args: ConnectArgs) => {
      const user = await getAuthenticatedUser({
        token: args.token,
        ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
      });
      const nextIdentity: StoredConnection = {
        login: user.login,
        ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
      };
      if (args.persist) {
        if (!args.passphrase) {
          throw new Error("Enter a passphrase to encrypt the saved token.");
        }
        const encrypted = await encryptSecret(args.token, args.passphrase);
        // Identity-only record (D3): repos/branches/paths live in the
        // per-document push targets, never in the connection.
        save(JSON.stringify({ ...nextIdentity, encrypted }));
      } else {
        // Not remembering — make sure no previous (encrypted) copy lingers.
        save(null);
      }
      return { nextIdentity, token: args.token };
    },
    onSuccess: ({ nextIdentity, token }) => {
      setSessionIdentity(nextIdentity);
      setSessionToken(token);
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (passphrase: string) => {
      if (!storedMeta?.encrypted) {
        throw new Error("No saved connection to unlock.");
      }
      return decryptSecret(storedMeta.encrypted, passphrase);
    },
    onSuccess: (token) => {
      if (storedMeta) {
        setSessionIdentity(storedMeta);
      }
      setSessionToken(token);
    },
  });

  const [pushProgress, setPushProgress] = useState<PushProgress | null>(null);

  const pushMutation = useMutation({
    mutationFn: (groups: PushGroupInput[]) => {
      if (!auth) {
        throw new Error("Connect to GitHub first.");
      }
      const sessionAuth = auth;
      setPushProgress({ done: 0, total: groups.length });
      return runPushGroups(
        groups,
        (group) => {
          const conn: GitHubConnection = {
            ...sessionAuth,
            owner: group.owner,
            repo: group.repo,
            baseBranch: group.baseBranch,
          };
          return pushFiles(conn, {
            branch: group.branch,
            baseBranch: group.baseBranch,
            message: group.message,
            files: group.files,
            createPr: group.createPr,
            prTitle: group.message,
          });
        },
        (done, total) => setPushProgress({ done, total }),
      );
    },
    onSuccess: (results, groups) => {
      // Each successful group created/updated its branch and files, so the
      // cached diffs of ITS targets (and its branch list) are now stale —
      // the re-fetched diff against the pushed branch reads "no changes".
      for (const group of groups) {
        const succeeded = results.some((r) => r.key === group.key && r.result);
        if (!succeeded) {
          continue;
        }
        queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "github" &&
            query.queryKey[1] === "diff" &&
            group.targetIds.includes(query.queryKey[2] as string),
        });
        queryClient.invalidateQueries({
          queryKey: ["github", "branches", group.owner, group.repo],
        });
      }
    },
  });

  // --- Queries: per-target diff previews (decision D5) -----------------------

  const [diffArgsList, setDiffArgsList] = useState<PreviewDiffArgs[]>([]);
  // Bumped on each preview so identical args re-read the repo.
  const [diffNonce, setDiffNonce] = useState(0);

  const diffQueries = useQueries({
    queries: diffArgsList.map((args) => ({
      queryKey: [
        "github",
        "diff",
        args.targetId,
        args.owner,
        args.repo,
        args.path,
        args.branch,
        args.extension,
        diffNonce,
      ],
      enabled: !!auth,
      staleTime: 0,
      gcTime: 0,
      queryFn: async (): Promise<DiffResult> => {
        const conn: GitHubConnection = {
          ...auth!,
          owner: args.owner,
          repo: args.repo,
          baseBranch: args.baseBranch,
        };
        // The target branch usually doesn't exist yet, so fall back to the
        // base branch — that is the content the new commit will replace.
        let oldContent = await getFileContent(conn, args.path, args.branch);
        if (oldContent === null && args.branch !== args.baseBranch) {
          oldContent = await getFileContent(conn, args.path, args.baseBranch);
        }
        return computeDiff(args.extension, oldContent, args.content);
      },
    })),
  });

  const diffs = useMemo<Record<string, TargetDiffState>>(() => {
    const map: Record<string, TargetDiffState> = {};
    diffArgsList.forEach((args, index) => {
      const query = diffQueries[index];
      map[args.targetId] = {
        diff: query?.data ?? null,
        status: query?.isFetching ? "loading" : query?.isError ? "error" : "idle",
        error: query?.isError ? messageOf(query.error) : null,
      };
    });
    return map;
  }, [diffArgsList, diffQueries]);

  // --- Public API ------------------------------------------------------------

  const connect = useCallback(
    async (args: ConnectArgs): Promise<boolean> => {
      try {
        await connectMutation.mutateAsync(args);
        return true;
      } catch {
        return false;
      }
    },
    [connectMutation.mutateAsync],
  );

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      try {
        await unlockMutation.mutateAsync(passphrase);
        return true;
      } catch {
        return false;
      }
    },
    [unlockMutation.mutateAsync],
  );

  const pushGroups = useCallback(
    async (groups: PushGroupInput[]): Promise<boolean> => {
      try {
        await pushMutation.mutateAsync(groups);
        return true;
      } catch {
        return false;
      }
    },
    [pushMutation.mutateAsync],
  );

  const previewDiffs = useCallback((args: PreviewDiffArgs[]) => {
    setDiffArgsList(args);
    setDiffNonce((nonce) => nonce + 1);
  }, []);

  const clearDiffs = useCallback(() => {
    setDiffArgsList([]);
  }, []);

  const reset = useCallback(() => {
    connectMutation.reset();
    unlockMutation.reset();
    pushMutation.reset();
    setDiffArgsList([]);
    setPushProgress(null);
  }, [connectMutation.reset, unlockMutation.reset, pushMutation.reset]);

  const disconnect = useCallback(() => {
    save(null);
    setSessionIdentity(null);
    setSessionToken(null);
    connectMutation.reset();
    unlockMutation.reset();
    pushMutation.reset();
    setDiffArgsList([]);
    setPushProgress(null);
  }, [save, connectMutation.reset, unlockMutation.reset, pushMutation.reset]);

  // --- Derived status/error (keeps the public shape stable) ------------------

  const status: GitHubStatus =
    connectMutation.isPending || unlockMutation.isPending
      ? "verifying"
      : pushMutation.isPending
        ? "pushing"
        : pushMutation.isSuccess
          ? "success"
          : connectMutation.isError || unlockMutation.isError || pushMutation.isError
            ? "error"
            : "idle";

  const firstError =
    connectMutation.error ?? unlockMutation.error ?? pushMutation.error ?? null;
  const error = firstError ? messageOf(firstError) : null;

  return {
    meta,
    repoScope,
    isConnected,
    isLocked,
    auth,
    isLoaded: loaded,
    status,
    error,
    connect,
    unlock,
    disconnect,
    pushGroups,
    groupResults: pushMutation.data ?? null,
    pushProgress,
    reset,
    diffs,
    previewDiffs,
    clearDiffs,
  };
}
