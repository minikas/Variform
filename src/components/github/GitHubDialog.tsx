import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, Button, Input, Textarea, Switch, Select, Label, Text, Flex, Link } from "figma-kit";
import { UseGitHubReturn } from "../../hooks/useGitHub";
import {
  allFilesResolved,
  exportFileKey,
  resolvedFilesFor,
  useTargetExports,
} from "../../hooks/useTargetExports";
import {
  defaultBranchName,
  defaultCommitMessage,
} from "../../utils/github/branchName";
import { listRepositories } from "../../utils/github/githubApi";
import {
  PushTarget,
  PushTargetGroup,
  TargetFormatOptions,
  defaultTargetFolder,
  deriveTargets,
  groupTargets,
  targetFiles,
} from "../../utils/github/pushTargets";
import { OutputFormats } from "../../types.d";
import { DiffList } from "./DiffList";
import { TargetRow } from "./TargetRow";
import { useSelection } from "../../contexts/SelectionContext";
import { SectionAccordion } from "../SectionAccordion";

interface GitHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  github: UseGitHubReturn;
}

const secondaryText: React.CSSProperties = {
  color: "var(--figma-color-text-secondary)",
};

const dangerText: React.CSSProperties = {
  color: "var(--figma-color-text-danger)",
};

// figma-kit's Dialog.Controls ships with no padding, so the footer buttons sit
// flush against the dialog edges. Add footer padding and a gap between actions.
const controlsStyle: React.CSSProperties = {
  gap: "var(--space-2)",
  padding: "var(--space-3) var(--space-4)",
};

/** Label + control + optional hint, matching the plugin's existing form style. */
const Field: React.FC<{
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, children }) => (
  <Flex direction="column" gap="1">
    <Label htmlFor={htmlFor}>{label}</Label>
    {children}
    {hint ? <Text size="small" style={secondaryText}>{hint}</Text> : null}
  </Flex>
);

/** Number of concrete files a group pushes (a "both" target produces two). */
function groupFileCount(
  group: PushTargetGroup,
  filenames: Partial<Record<string, string>>,
): number {
  return group.targets.reduce(
    (count, target) => count + targetFiles(target, filenames).length,
    0,
  );
}

/** Default commit message for a group: per-file when single, generic otherwise. */
function defaultGroupMessage(
  group: PushTargetGroup,
  filenames: Partial<Record<string, string>>,
): string {
  const fileCount = groupFileCount(group, filenames);
  return fileCount === 1
    ? defaultCommitMessage(targetFiles(group.targets[0], filenames)[0].path)
    : `chore: update ${fileCount} token files via Variform`;
}

/** Per-group edits made in the dialog (commit message / create-PR switch). */
interface GroupEdit {
  message?: string;
  createPr?: boolean;
}

/**
 * Dialog driving the connect → push flow (decision D7). The push phase is a
 * list of per-format targets grouped by `${owner}/${repo}#${branch}`: each
 * group lands as one atomic commit (and at most one PR), with an aggregated
 * per-file diff preview per group. Export contents are pulled from the plugin
 * sandbox by the dialog itself (useTargetExports) — no `data` prop anymore.
 */
export const GitHubDialog: React.FC<GitHubDialogProps> = ({
  open,
  onOpenChange,
  github,
}) => {
  const {
    auth,
    meta,
    repoScope,
    isConnected,
    isLocked,
    status,
    error,
    groupResults,
    pushProgress,
  } = github;
  const {
    pushTargets,
    setPushTargets,
    formats: checkedFormats,
    filenameByFormat,
    useRowColumnPos,
    useDSCGFormat,
    tailwindOutput,
    tailwindPrefix,
    tailwindUnit,
    tailwindColorMode,
  } = useSelection();
  const isBusy = status === "verifying" || status === "pushing";

  // Connect form state
  const [token, setToken] = useState("");
  const [persist, setPersist] = useState(false);
  const [passphrase, setPassphrase] = useState("");

  // Unlock form state
  const [unlockPassphrase, setUnlockPassphrase] = useState("");

  // Per-group commit message / create-PR edits, keyed by group key.
  const [groupEdits, setGroupEdits] = useState<Record<string, GroupEdit>>({});

  // Export contents for every target, resolved by the dialog (decision D4).
  const { exports: targetExports, isLoading: isExporting } =
    useTargetExports(pushTargets);

  // Repositories the token can access, for the per-target repo pickers. The
  // query key carries the login so a different account never sees stale repos;
  // the token itself stays out of the cache key.
  const reposQuery = useQuery({
    queryKey: ["github", "repos", meta?.login ?? "session"],
    enabled: open && !!auth,
    queryFn: () => listRepositories(auth!),
  });
  const repos = reposQuery.data ?? null;

  // Clear transient status whenever the dialog is opened.
  useEffect(() => {
    if (open) {
      github.reset();
    }
  }, [open, github.reset]);

  // Seed format options of a new target from the global (per-document) export
  // options, so a target starts consistent with the preview the user tuned.
  // Exception: Tailwind targets default to "both" outputs (stylesheet + preset
  // as two files with independent paths), regardless of the single-file
  // preview option.
  const seedFormatOptions = (format: OutputFormats): TargetFormatOptions => ({
    useRowColumnPos,
    useDSCGFormat,
    tailwindOutput:
      format === OutputFormats.TAILWIND ? "both" : tailwindOutput,
    tailwindPrefix,
    tailwindUnit,
    tailwindColorMode,
  });

  // The seeded folder of a Tailwind "both" target is the stylesheet's; the
  // preset file lands at the repo root unless presetFolder is set.
  const seedTargetFolder = (format: OutputFormats): string =>
    defaultTargetFolder(
      format,
      format === OutputFormats.TAILWIND ? "css" : tailwindOutput,
    );

  // Derive the target set from the main page's checked formats, once per
  // dialog open (idempotent): each checked format reuses the persisted target
  // with the same format or gets a new one with defaults; persisted targets
  // of unchecked formats (ad-hoc additions) are kept. Targets without a
  // repository (e.g. migrated from a legacy githubFilePath) first inherit the
  // repo recovered from a legacy connection.
  const derivedOnOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      derivedOnOpenRef.current = false;
      return;
    }
    if (!isConnected || isLocked || derivedOnOpenRef.current) {
      return;
    }
    derivedOnOpenRef.current = true;
    let targets = pushTargets;
    if (repoScope && targets.some((t) => !t.owner.trim() && !t.repo.trim())) {
      targets = targets.map((t) =>
        !t.owner.trim() && !t.repo.trim()
          ? {
              ...t,
              owner: repoScope.owner,
              repo: repoScope.repo,
              baseBranch: t.baseBranch || repoScope.baseBranch,
            }
          : t,
      );
    }
    const existing = targets[0];
    const derived = deriveTargets(checkedFormats, targets, {
      // Share the session branch seed so same-repo targets keep grouping.
      branch:
        existing?.branch ||
        defaultBranchName("variables", Date.now().toString(36).slice(-4)),
      repo:
        existing && existing.owner.trim() && existing.repo.trim()
          ? {
              owner: existing.owner,
              repo: existing.repo,
              baseBranch: existing.baseBranch,
            }
          : (repoScope ?? undefined),
      formatOptions: seedFormatOptions,
      folder: seedTargetFolder,
    });
    setPushTargets(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derivation runs once per dialog open.
  }, [open, isConnected, isLocked, pushTargets, repoScope, checkedFormats]);

  const updateTarget = (id: string, patch: Partial<PushTarget>) => {
    setPushTargets(pushTargets.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  // Grouping (decision D2): one atomic commit per repo+branch group.
  const groups = useMemo(() => groupTargets(pushTargets), [pushTargets]);

  // Auto-preview the per-file diffs (debounced) whenever the targets or the
  // exported contents change, so "Changes" always reflects the current inputs.
  useEffect(() => {
    if (!open || !auth || isLocked || isBusy || status === "success") {
      return;
    }
    const args = pushTargets
      .filter(
        (t) =>
          t.owner.trim() && t.repo.trim() && t.branch.trim(),
      )
      .flatMap((t) =>
        resolvedFilesFor(t, filenameByFormat, targetExports)
          .filter((file) => file.content)
          .map((file) => ({
            targetId: file.key,
            owner: t.owner.trim(),
            repo: t.repo.trim(),
            baseBranch: t.baseBranch.trim() || "main",
            branch: t.branch.trim(),
            path: file.path.trim(),
            extension: file.extension,
            content: file.content,
          })),
      );
    const handle = setTimeout(() => {
      if (args.length > 0) {
        github.previewDiffs(args);
      } else {
        github.clearDiffs();
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [open, auth, isLocked, isBusy, status, pushTargets, filenameByFormat, targetExports, github.previewDiffs, github.clearDiffs]);

  const handleConnect = async () => {
    const ok = await github.connect({
      token: token.trim(),
      persist,
      passphrase: persist ? passphrase : undefined,
    });
    if (ok) {
      // Don't keep secrets in the form fields once the session holds them.
      setToken("");
      setPassphrase("");
    }
  };

  const handleUnlock = async () => {
    const ok = await github.unlock(unlockPassphrase);
    if (ok) {
      setUnlockPassphrase("");
    }
  };

  const groupMessage = (group: PushTargetGroup) =>
    groupEdits[group.key]?.message ?? defaultGroupMessage(group, filenameByFormat);
  const groupCreatePr = (group: PushTargetGroup) =>
    groupEdits[group.key]?.createPr ?? group.createPr;

  const editGroup = (key: string, edit: GroupEdit) => {
    setGroupEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...edit } }));
  };

  // Two files pushed to the same path in a group would silently overwrite
  // each other in the commit tree — surface the collision and block the push.
  const groupDuplicatePaths = (group: PushTargetGroup): string[] => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const target of group.targets) {
      for (const file of targetFiles(target, filenameByFormat)) {
        const path = file.path.trim();
        if (!path || duplicates.includes(path)) {
          continue;
        }
        if (seen.has(path)) {
          duplicates.push(path);
        } else {
          seen.add(path);
        }
      }
    }
    return duplicates;
  };
  const hasDuplicatePaths = groups.some(
    (group) => groupDuplicatePaths(group).length > 0,
  );

  // Every target must be fully configured and have every produced file's
  // export resolved before any group can be pushed. Folders may be empty
  // (repo root) — only repo/branches are required.
  const targetsReady =
    pushTargets.length > 0 &&
    pushTargets.every(
      (t) =>
        t.owner.trim() && t.repo.trim() && t.baseBranch.trim() && t.branch.trim(),
    );
  const exportsReady = allFilesResolved(pushTargets, filenameByFormat, targetExports);
  const canPush =
    targetsReady && exportsReady && !isExporting && !isBusy && !hasDuplicatePaths;

  const anyPr = groups.some((group) => groupCreatePr(group));

  const handlePush = async () => {
    await github.pushGroups(
      groups.map((group) => ({
        key: group.key,
        owner: group.owner,
        repo: group.repo,
        baseBranch: group.baseBranch,
        branch: group.branch,
        message: groupMessage(group),
        createPr: groupCreatePr(group),
        targetIds: group.targets.map((t) => t.id),
        files: group.targets.flatMap((t) =>
          resolvedFilesFor(t, filenameByFormat, targetExports).map((file) => ({
            path: file.path.trim(),
            content: file.content,
          })),
        ),
      })),
    );
  };

  const renderConnectForm = () => {
    const canConnect =
      Boolean(token.trim()) && (!persist || Boolean(passphrase.trim())) && !isBusy;
    return (
      <>
        <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Flex direction="column" gap="3">
            <Text style={secondaryText}>
              Connect with a token, then push one or more export formats — each
              to its own repository, branch and path. Your token goes only to
              GitHub — if remembered, it's encrypted on this device with a
              passphrase.
            </Text>
            <Field
              label="Personal access token"
              htmlFor="gh-token"
              hint={
                <>
                  Needs a{" "}
                  <Link
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    fine-grained token ↗
                  </Link>{" "}
                  with Contents + Pull requests = Read and write (or a classic repo
                  token).
                </>
              }
            >
              <Input
                id="gh-token"
                type="password"
                placeholder="ghp_…"
                value={token}
                autoComplete="off"
                style={{ width: "100%" }}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>

            <Flex gap="2" align="center">
              <Switch
                id="gh-persist"
                checked={persist}
                onCheckedChange={(checked) => setPersist(Boolean(checked))}
              />
              <Label htmlFor="gh-persist">Remember this connection on this device</Label>
            </Flex>
            {persist ? (
              <Field
                label="Encryption passphrase"
                htmlFor="gh-passphrase"
                hint="Encrypts the token (AES-256-GCM). Never stored."
              >
                <Input
                  id="gh-passphrase"
                  type="password"
                  placeholder="••••••"
                  value={passphrase}
                  autoComplete="off"
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </Field>
            ) : null}

            {error ? <Text style={dangerText}>{error}</Text> : null}
          </Flex>
        </Dialog.Section>
        <Dialog.Controls style={controlsStyle}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canConnect} onClick={handleConnect}>
            {status === "verifying" ? "Verifying…" : "Connect"}
          </Button>
        </Dialog.Controls>
      </>
    );
  };

  // One diff block per produced file of a target ("both" → two blocks).
  const renderTargetDiffs = (target: PushTarget) =>
    resolvedFilesFor(target, filenameByFormat, targetExports).map((file) => {
      const state = github.diffs[file.key];
      return (
        <Flex direction="column" gap="1" key={file.key}>
          <Text size="small" style={secondaryText}>
            {file.path}
          </Text>
          {state?.error ? (
            <Text style={dangerText}>{state.error}</Text>
          ) : state?.status === "loading" && !state.diff ? (
            <Text size="small" style={secondaryText}>Loading diff…</Text>
          ) : state?.diff ? (
            <DiffList diff={state.diff} />
          ) : (
            <Text size="small" style={secondaryText}>No diff preview yet.</Text>
          )}
        </Flex>
      );
    });

  // Collapsed group summary: basename of the first file, with "+N" for the
  // remaining FILES of the group (e.g. "tokens.css, +1").
  const groupFileSummary = (group: PushTargetGroup): string => {
    const fileCount = groupFileCount(group, filenameByFormat);
    const firstPath = targetFiles(group.targets[0], filenameByFormat)[0]?.path ?? "";
    const firstName = firstPath.split("/").pop() || firstPath;
    return fileCount > 1 ? `${firstName}, +${fileCount - 1}` : firstName;
  };

  const renderPushForm = () => (
    <>
      <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Text style={secondaryText}>
              Connected{meta?.login ? (
                <> as <strong>{meta.login}</strong></>
              ) : null}
            </Text>
            <Button
              variant="text"
              onClick={() => github.disconnect()}
              style={{ color: "var(--figma-color-text-danger)" }}
            >
              Disconnect
            </Button>
          </Flex>

          {pushTargets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              auth={auth}
              repos={repos}
              reposLoading={reposQuery.isFetching}
              exportStates={targetFiles(target, filenameByFormat).map((file, index) =>
                targetExports[exportFileKey(target.id, file, index)],
              )}
              onChange={(patch) => updateTarget(target.id, patch)}
            />
          ))}

          {groups.length > 0 ? (
            <Flex direction="column" gap="2">
              <Label>Changes</Label>
              {groups.map((group) => (
                <SectionAccordion
                  key={group.key}
                  label={`${group.owner}/${group.repo}`}
                  summary={groupFileSummary(group)}
                >
                  <Flex direction="column" gap="3">
                    <Text size="small" style={secondaryText}>
                      Branch: {group.branch}
                    </Text>
                    {groupDuplicatePaths(group).map((path) => (
                      <Text key={path} size="small" style={dangerText}>
                        Duplicate file path in this push: {path} — give each
                        file its own path.
                      </Text>
                    ))}
                    <Flex direction="column" gap="1">
                      <Label htmlFor={`gh-group-msg-${group.key}`}>Commit message</Label>
                      <Textarea
                        id={`gh-group-msg-${group.key}`}
                        rows={2}
                        value={groupMessage(group)}
                        onChange={(e) => editGroup(group.key, { message: e.target.value })}
                      />
                    </Flex>
                    <Flex gap="2" align="center">
                      <Switch
                        id={`gh-group-pr-${group.key}`}
                        checked={groupCreatePr(group)}
                        onCheckedChange={(checked) =>
                          editGroup(group.key, { createPr: Boolean(checked) })
                        }
                      />
                      <Label htmlFor={`gh-group-pr-${group.key}`}>
                        Open a pull request after committing
                      </Label>
                    </Flex>
                    {group.targets.map(renderTargetDiffs)}
                  </Flex>
                </SectionAccordion>
              ))}
            </Flex>
          ) : null}

          {error ? <Text style={dangerText}>{error}</Text> : null}
        </Flex>
      </Dialog.Section>
      <Dialog.Controls style={controlsStyle}>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canPush} onClick={handlePush}>
          {status === "pushing"
            ? pushProgress
              ? `Pushing ${pushProgress.done}/${pushProgress.total}…`
              : "Pushing…"
            : isExporting
              ? "Exporting…"
              : anyPr
                ? "Commit & create PRs"
                : "Commit"}
        </Button>
      </Dialog.Controls>
    </>
  );

  const renderResult = () => {
    const results = groupResults ?? [];
    const succeeded = results.filter((r) => r.result).length;
    const partial = succeeded > 0 && succeeded < results.length;
    return (
      <>
        <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Flex direction="column" gap="3" style={{ padding: "12px 0" }}>
            <Text size="large" weight="strong">
              {succeeded === results.length
                ? "Pushed to GitHub"
                : partial
                  ? `Partially pushed (${succeeded}/${results.length} groups)`
                  : "Push failed"}
            </Text>
            {results.map((r) => (
              <Flex direction="column" gap="1" key={r.key}>
                <Text weight="strong">
                  {r.owner}/{r.repo} · {r.branch}
                </Text>
                {r.result ? (
                  r.result.prUrl ? (
                    <Link href={r.result.prUrl} target="_blank" rel="noopener noreferrer">
                      Open pull request ↗
                    </Link>
                  ) : (
                    <Text style={secondaryText}>
                      Committed. No pull request was created automatically.{" "}
                      <Link href={r.result.compareUrl} target="_blank" rel="noopener noreferrer">
                        Open one ↗
                      </Link>
                    </Text>
                  )
                ) : (
                  <Text style={dangerText}>{r.error}</Text>
                )}
              </Flex>
            ))}
          </Flex>
        </Dialog.Section>
        <Dialog.Controls style={controlsStyle}>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </Dialog.Controls>
      </>
    );
  };

  const renderUnlockForm = () => {
    const canUnlock = Boolean(unlockPassphrase) && status !== "verifying";
    return (
      <>
        <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center">
              <Text style={secondaryText}>
                Locked{meta?.login ? (
                  <>: <strong>{meta.login}</strong></>
                ) : null}
              </Text>
              <Button
                variant="text"
                onClick={() => github.disconnect()}
                style={{ color: "var(--figma-color-text-danger)" }}
              >
                Disconnect
              </Button>
            </Flex>
            <Text style={secondaryText}>
              Enter your passphrase to unlock the saved token for this session.
            </Text>
            <Field label="Passphrase" htmlFor="gh-unlock">
              <Input
                id="gh-unlock"
                type="password"
                placeholder="••••••"
                value={unlockPassphrase}
                autoComplete="off"
                onChange={(e) => setUnlockPassphrase(e.target.value)}
              />
            </Field>
            {error ? <Text style={dangerText}>{error}</Text> : null}
          </Flex>
        </Dialog.Section>
        <Dialog.Controls style={controlsStyle}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canUnlock} onClick={handleUnlock}>
            {status === "verifying" ? "Unlocking…" : "Unlock"}
          </Button>
        </Dialog.Controls>
      </>
    );
  };

  const renderBody = () => {
    if (!isConnected) {
      return renderConnectForm();
    }
    if (isLocked) {
      return renderUnlockForm();
    }
    if (status === "success" && groupResults) {
      return renderResult();
    }
    return renderPushForm();
  };

  const title = !isConnected
    ? "Connect to GitHub"
    : isLocked
      ? "Unlock GitHub"
      : status === "success" && groupResults
        ? "Pushed to GitHub"
        : "Push to GitHub";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          size="1"
          placement="center"
          width="480px"
          maxWidth="92vw"
          style={{ display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "84vh" }}
        >
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
          </Dialog.Header>
          {renderBody()}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
