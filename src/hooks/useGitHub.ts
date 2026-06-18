import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitHubConnection,
  PushResult,
  getFileContent,
  pushFile,
  verifyConnection,
} from "../utils/github/githubApi";
import { DiffResult, computeDiff } from "../utils/github/tokenDiff";
import { EncryptedSecret, decryptSecret, encryptSecret } from "../utils/github/crypto";
import { useClientStorage } from "./useClientStorage";

/** clientStorage key holding the JSON-encoded GitHub connection. */
export const GITHUB_CONNECTION_KEY = "varvar.github.connection";

export type GitHubStatus = "idle" | "verifying" | "pushing" | "success" | "error";

export type DiffStatus = "idle" | "loading" | "error";

/**
 * Connection metadata persisted in clientStorage. The plaintext token is NEVER
 * persisted — only the AES-GCM-encrypted blob (when the user opts to remember).
 */
export interface StoredConnection {
  owner: string;
  repo: string;
  baseBranch: string;
  baseUrl?: string;
  /** Present when the token was persisted (encrypted with a passphrase). */
  encrypted?: EncryptedSecret;
}

export interface ConnectArgs {
  token: string;
  owner: string;
  repo: string;
  baseBranch: string;
  baseUrl?: string;
  /** Persist the encrypted token across plugin sessions. */
  persist: boolean;
  /** Required when `persist` is true — used to encrypt the token. */
  passphrase?: string;
}

export interface PushArgs {
  path: string;
  content: string;
  commitMessage: string;
  branch: string;
  createPr: boolean;
  prTitle?: string;
  prBody?: string;
}

export interface PreviewDiffArgs {
  path: string;
  branch: string;
  /** The freshly generated export contents. */
  content: string;
  /** File extension that selects the diff parser (e.g. "json" / "css"). */
  extension: string;
}

export interface UseGitHubReturn {
  /** Connection metadata (owner/repo/branch), without the token. */
  meta: StoredConnection | null;
  /** True when a connection exists (whether locked or unlocked). */
  isConnected: boolean;
  /** True when the connection is persisted+encrypted and not yet unlocked. */
  isLocked: boolean;
  /** Full connection incl. token — only available once unlocked this session. */
  connection: GitHubConnection | null;
  /** True once clientStorage has been read. */
  isLoaded: boolean;
  status: GitHubStatus;
  error: string | null;
  result: PushResult | null;
  /** Verify, then keep (and optionally encrypt+persist) a connection. */
  connect: (args: ConnectArgs) => Promise<boolean>;
  /** Decrypt the persisted token with the passphrase for this session. */
  unlock: (passphrase: string) => Promise<boolean>;
  /** Forget the saved connection and clear the in-memory token. */
  disconnect: () => void;
  /** Commit a file and optionally open a PR. Resolves to true on success. */
  push: (args: PushArgs) => Promise<boolean>;
  /** Clear transient status/error/result/diff (e.g. when reopening the dialog). */
  reset: () => void;
  /** Diff of the current repo file against the new export, once previewed. */
  diff: DiffResult | null;
  diffStatus: DiffStatus;
  diffError: string | null;
  /** Fetch the existing file and compute a diff against the new export. */
  previewDiff: (args: PreviewDiffArgs) => void;
  /** Discard a previously computed diff. */
  clearDiff: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred while contacting GitHub.";
}

interface ParsedStored {
  meta: StoredConnection;
  /** Set only for legacy plaintext connections saved before encryption. */
  plaintextToken?: string;
}

function parseStored(value: string | null | undefined): ParsedStored | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.owner === "string" && typeof parsed.repo === "string") {
      const meta: StoredConnection = {
        owner: parsed.owner,
        repo: parsed.repo,
        baseBranch: typeof parsed.baseBranch === "string" ? parsed.baseBranch : "main",
      };
      if (typeof parsed.baseUrl === "string") {
        meta.baseUrl = parsed.baseUrl;
      }
      if (parsed.encrypted && typeof parsed.encrypted === "object") {
        meta.encrypted = parsed.encrypted as EncryptedSecret;
      }
      return {
        meta,
        plaintextToken: typeof parsed.token === "string" ? parsed.token : undefined,
      };
    }
  } catch {
    // Corrupt value — treat as not connected.
  }
  return null;
}

/**
 * Orchestrates the "Push to GitHub" flow with TanStack Query: connect/unlock/
 * push are mutations, the diff is a query. The token lives in memory for the
 * session; if remembered, it's encrypted with a passphrase (AES-256-GCM) and
 * persisted, then decrypted via {@link unlock} on reopen.
 */
export function useGitHub(): UseGitHubReturn {
  const { value, loaded, save } = useClientStorage(GITHUB_CONNECTION_KEY);
  const queryClient = useQueryClient();

  // In-memory connection for this session (not persisted unless the user opts in).
  const [sessionMeta, setSessionMeta] = useState<StoredConnection | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const parsed = useMemo(() => parseStored(value), [value]);
  const storedMeta = parsed?.meta ?? null;
  const meta = sessionMeta ?? storedMeta;
  // Legacy plaintext tokens (pre-encryption) are adopted for the session.
  const effectiveToken = sessionToken ?? parsed?.plaintextToken ?? null;

  const connection = useMemo<GitHubConnection | null>(
    () => (meta && effectiveToken ? { ...meta, token: effectiveToken } : null),
    [meta, effectiveToken],
  );

  const isConnected = meta != null;
  const isLocked = meta != null && effectiveToken == null;

  // --- Mutations: connect / unlock / push -----------------------------------

  const connectMutation = useMutation({
    mutationFn: async (args: ConnectArgs) => {
      const candidate: GitHubConnection = {
        token: args.token,
        owner: args.owner,
        repo: args.repo,
        baseBranch: args.baseBranch,
        ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
      };
      const info = await verifyConnection(candidate);
      const nextMeta: StoredConnection = {
        owner: args.owner,
        repo: args.repo,
        baseBranch: args.baseBranch || info.defaultBranch,
        ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
      };
      if (args.persist) {
        if (!args.passphrase) {
          throw new Error("Enter a passphrase to encrypt the saved token.");
        }
        const encrypted = await encryptSecret(args.token, args.passphrase);
        save(JSON.stringify({ ...nextMeta, encrypted }));
      } else {
        // Not remembering — make sure no previous (encrypted) copy lingers.
        save(null);
      }
      return { nextMeta, token: args.token };
    },
    onSuccess: ({ nextMeta, token }) => {
      setSessionMeta(nextMeta);
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
        setSessionMeta(storedMeta);
      }
      setSessionToken(token);
    },
  });

  const pushMutation = useMutation({
    mutationFn: (args: PushArgs) => {
      if (!connection) {
        throw new Error("Connect a GitHub repository first.");
      }
      return pushFile(connection, args);
    },
    onSuccess: () => {
      // The push created/updated the branch and the file, so any cached diff and
      // branch list are now stale — invalidate them to refetch fresh state (the
      // diff against the pushed branch will then read as "no changes").
      queryClient.invalidateQueries({ queryKey: ["github", "diff"] });
      queryClient.invalidateQueries({ queryKey: ["github", "branches"] });
    },
  });

  // --- Query: diff preview ---------------------------------------------------

  const [diffArgs, setDiffArgs] = useState<PreviewDiffArgs | null>(null);
  // Bumped on each preview so an identical (path, branch) re-reads the repo.
  const [diffNonce, setDiffNonce] = useState(0);

  const diffQuery = useQuery({
    queryKey: [
      "github",
      "diff",
      connection?.owner,
      connection?.repo,
      diffArgs?.path,
      diffArgs?.branch,
      diffArgs?.extension,
      diffNonce,
    ],
    enabled: !!connection && !!diffArgs,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const conn = connection!;
      const args = diffArgs!;
      // The target branch usually doesn't exist yet, so fall back to the base
      // branch — that is the content the new commit will actually replace.
      let oldContent = await getFileContent(conn, args.path, args.branch);
      if (oldContent === null && args.branch !== conn.baseBranch) {
        oldContent = await getFileContent(conn, args.path, conn.baseBranch);
      }
      return computeDiff(args.extension, oldContent, args.content);
    },
  });

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

  const push = useCallback(
    async (args: PushArgs): Promise<boolean> => {
      try {
        await pushMutation.mutateAsync(args);
        return true;
      } catch {
        return false;
      }
    },
    [pushMutation.mutateAsync],
  );

  const previewDiff = useCallback((args: PreviewDiffArgs) => {
    setDiffArgs(args);
    setDiffNonce((nonce) => nonce + 1);
  }, []);

  const clearDiff = useCallback(() => {
    setDiffArgs(null);
  }, []);

  const reset = useCallback(() => {
    connectMutation.reset();
    unlockMutation.reset();
    pushMutation.reset();
    setDiffArgs(null);
  }, [connectMutation.reset, unlockMutation.reset, pushMutation.reset]);

  const disconnect = useCallback(() => {
    save(null);
    setSessionMeta(null);
    setSessionToken(null);
    connectMutation.reset();
    unlockMutation.reset();
    pushMutation.reset();
    setDiffArgs(null);
  }, [save, connectMutation.reset, unlockMutation.reset, pushMutation.reset]);

  // --- Derived status/error/result (keeps the public shape stable) ----------

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

  const diffStatus: DiffStatus = !diffArgs
    ? "idle"
    : diffQuery.isFetching
      ? "loading"
      : diffQuery.isError
        ? "error"
        : "idle";

  return {
    meta,
    isConnected,
    isLocked,
    connection,
    isLoaded: loaded,
    status,
    error,
    result: pushMutation.data ?? null,
    connect,
    unlock,
    disconnect,
    push,
    reset,
    diff: diffArgs ? (diffQuery.data ?? null) : null,
    diffStatus,
    diffError: diffArgs && diffQuery.isError ? messageOf(diffQuery.error) : null,
    previewDiff,
    clearDiff,
  };
}
