import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, Button, Input, Textarea, Switch, Select, Label, Text, Flex, Link } from "figma-kit";
import { UseGitHubReturn } from "../../hooks/useGitHub";
import {
  defaultBranchName,
  defaultCommitMessage,
  defaultPrBody,
  defaultPrTitle,
} from "../../utils/github/branchName";
import { DiffList } from "./DiffList";
import { useSelection } from "../../contexts/SelectionContext";
import { SectionAccordion } from "../SectionAccordion";
import { listBranches, listRepositories } from "../../utils/github/githubApi";

interface GitHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  github: UseGitHubReturn;
  /** The already-exported file contents to commit. */
  data: string;
  /** Filename (without extension) used to seed the path and branch. */
  filename: string;
  /** File extension, e.g. "json" / "css". */
  fileFormat: string;
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

const iconButtonStyle: React.CSSProperties = {
  all: "unset",
  boxSizing: "border-box",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  flexShrink: 0,
  borderRadius: "4px",
  border: "1px solid var(--figma-color-border)",
  color: "var(--figma-color-text-secondary)",
};

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unexpected error contacting GitHub.";
}

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

/**
 * Dialog driving the connect → commit → pull request flow. It renders one of
 * three phases based on the hook state: a connect form when no repository is
 * linked, a push form once connected, and a success summary after a push.
 */
export const GitHubDialog: React.FC<GitHubDialogProps> = ({
  open,
  onOpenChange,
  github,
  data,
  filename,
  fileFormat,
}) => {
  const { connection, meta, isLocked, status, error, result } = github;
  const { githubFilePath, setGithubFilePath } = useSelection();
  const isBusy = status === "verifying" || status === "pushing";

  // Connect form state
  const [token, setToken] = useState("");
  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [persist, setPersist] = useState(false);
  const [passphrase, setPassphrase] = useState("");

  // Unlock form state
  const [unlockPassphrase, setUnlockPassphrase] = useState("");

  // Repositories + branches for the entered token (loaded on "Validate").
  const reposQuery = useQuery({
    queryKey: ["github", "repos", token.trim()],
    queryFn: () => listRepositories({ token: token.trim() }),
    enabled: false,
  });
  const repos = reposQuery.data ?? null;
  const selectedRepo = repos?.find((item) => item.fullName === selectedRepoFullName);
  const branchesQuery = useQuery({
    queryKey: ["github", "branches", token.trim(), selectedRepo?.owner, selectedRepo?.repo],
    queryFn: () => listBranches({ token: token.trim() }, selectedRepo!.owner, selectedRepo!.repo),
    enabled: Boolean(token.trim() && selectedRepo),
  });
  const branches = branchesQuery.data ?? null;

  // Push form state
  const [path, setPath] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [branch, setBranch] = useState("");
  const [openPr, setOpenPr] = useState(true);

  // Clear transient status whenever the dialog is opened.
  useEffect(() => {
    if (open) {
      github.reset();
    }
  }, [open, github.reset]);

  // Seed push-form defaults once a connection exists and the dialog is open.
  // Only fill EMPTY fields, so the branch (and any edits) persist across reopens.
  // That way re-committing targets the SAME branch/PR and the diff is measured
  // against it (showing "no changes" once pushed) instead of re-diffing a fresh
  // branch against the base every time.
  useEffect(() => {
    if (open && connection) {
      const seededPath = githubFilePath || `src/${filename}.${fileFormat}`;
      setPath((prev) => prev || seededPath);
      setCommitMessage((prev) => prev || defaultCommitMessage(seededPath));
      setBranch(
        (prev) => prev || defaultBranchName(filename, Date.now().toString(36).slice(-4)),
      );
    }
  }, [open, connection, filename, fileFormat, githubFilePath]);

  // Auto-preview the diff while the push form is open, and re-fetch (debounced)
  // whenever the path / branch / content change, so "Changes" always reflects
  // the current inputs without a manual click.
  useEffect(() => {
    if (
      !open ||
      !connection ||
      isLocked ||
      isBusy ||
      status === "success" ||
      !path.trim() ||
      !branch.trim() ||
      !data
    ) {
      return;
    }
    const handle = setTimeout(() => {
      github.previewDiff({
        path: path.trim(),
        branch: branch.trim(),
        content: data,
        extension: fileFormat,
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [open, connection, isLocked, isBusy, status, path, branch, data, fileFormat, github.previewDiff]);

  const handleTokenChange = (value: string) => {
    setToken(value);
    // The repository list is keyed on the token; reset the selection on change.
    setSelectedRepoFullName("");
  };

  const handleSelectRepo = (fullName: string) => {
    setSelectedRepoFullName(fullName);
    const summary = repos?.find((item) => item.fullName === fullName);
    if (summary) {
      setBaseBranch(summary.defaultBranch);
    }
  };

  const handleConnect = async () => {
    const summary = repos?.find((item) => item.fullName === selectedRepoFullName);
    if (!summary) {
      return;
    }
    const ok = await github.connect({
      token: token.trim(),
      owner: summary.owner,
      repo: summary.repo,
      baseBranch: baseBranch.trim() || summary.defaultBranch,
      persist,
      passphrase: persist ? passphrase : undefined,
    });
    if (ok) {
      // Don't keep secrets in the form fields once the session holds them.
      setToken("");
      setPassphrase("");
      // Connecting is a setup step — close the modal; reopen to push.
      onOpenChange(false);
    }
  };

  const handleUnlock = async () => {
    const ok = await github.unlock(unlockPassphrase);
    if (ok) {
      setUnlockPassphrase("");
    }
  };

  const handlePush = async () => {
    const trimmedPath = path.trim();
    const message = commitMessage.trim() || defaultCommitMessage(trimmedPath);
    await github.push({
      path: trimmedPath,
      content: data,
      commitMessage: message,
      branch: branch.trim(),
      createPr: openPr,
      prTitle: message || defaultPrTitle(trimmedPath),
      prBody: defaultPrBody(trimmedPath),
    });
  };

  const handlePreviewDiff = () => {
    github.previewDiff({
      path: path.trim(),
      branch: branch.trim(),
      content: data,
      extension: fileFormat,
    });
  };

  const handleGenerateBranch = () => {
    setBranch(defaultBranchName(filename, Date.now().toString(36).slice(-4)));
  };

  const renderConnectForm = () => {
    const canConnect =
      Boolean(token.trim() && selectedRepoFullName && baseBranch.trim()) &&
      (!persist || Boolean(passphrase.trim())) &&
      !isBusy &&
      !reposQuery.isFetching &&
      !branchesQuery.isFetching;
    return (
      <>
        <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Flex direction="column" gap="3">
            <Text style={secondaryText}>
              Commit the export and open a PR. Your token goes only to GitHub — if
              remembered, it's encrypted on this device with a passphrase.
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
              <Flex gap="2" align="center">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Input
                    id="gh-token"
                    type="password"
                    placeholder="ghp_…"
                    value={token}
                    autoComplete="off"
                    style={{ width: "100%" }}
                    onChange={(e) => handleTokenChange(e.target.value)}
                  />
                </div>
                <Button
                  variant="secondary"
                  style={{ flexShrink: 0 }}
                  disabled={!token.trim() || reposQuery.isFetching}
                  onClick={() => reposQuery.refetch()}
                >
                  {reposQuery.isFetching ? "Validating…" : "Validate"}
                </Button>
              </Flex>
            </Field>
            {reposQuery.isError ? (
              <Text style={dangerText}>{messageOf(reposQuery.error)}</Text>
            ) : null}

            {repos ? (
              <Field label="Repository" htmlFor="gh-repo-select">
                <Select.Root value={selectedRepoFullName} onValueChange={handleSelectRepo}>
                  <Select.Trigger
                    id="gh-repo-select"
                    placeholder={
                      repos.length
                        ? "Select a repository"
                        : "No repositories found for this token"
                    }
                  />
                  <Select.Content portal style={{ maxHeight: 280, overflowY: "auto" }}>
                    {[...repos]
                      .sort((a, b) => a.fullName.localeCompare(b.fullName))
                      .map((item) => (
                        <Select.Item key={item.fullName} value={item.fullName}>
                          {item.fullName}
                        </Select.Item>
                      ))}
                  </Select.Content>
                </Select.Root>
              </Field>
            ) : null}

            {selectedRepoFullName ? (
              <Field
                label="Base branch"
                htmlFor="gh-branch-select"
                hint="New branches and pull requests are based on this."
              >
                {branchesQuery.isFetching ? (
                  <Text style={secondaryText}>Loading branches…</Text>
                ) : (
                  <Select.Root value={baseBranch} onValueChange={setBaseBranch}>
                    <Select.Trigger id="gh-branch-select" placeholder="Select a branch" />
                    <Select.Content portal style={{ maxHeight: 280, overflowY: "auto" }}>
                      {[...(branches ?? [])]
                        .sort((a, b) => a.localeCompare(b))
                        .map((name) => (
                          <Select.Item key={name} value={name}>
                            {name}
                          </Select.Item>
                        ))}
                    </Select.Content>
                  </Select.Root>
                )}
                {branchesQuery.isError ? (
                  <Text style={dangerText}>{messageOf(branchesQuery.error)}</Text>
                ) : null}
              </Field>
            ) : null}

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

  const renderPushForm = () => {
    // Nothing to commit when the previewed diff is empty.
    const noChanges = github.diff !== null && github.diff.changes.length === 0;
    const canPush =
      Boolean(path.trim() && branch.trim() && data) && !isBusy && !noChanges;
    return (
      <>
        <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center">
              <Text style={secondaryText}>
                Connected to <strong>{connection?.owner}/{connection?.repo}</strong>
              </Text>
              <Button
                variant="text"
                onClick={() => github.disconnect()}
                style={{ color: "var(--figma-color-text-danger)" }}
              >
                Disconnect
              </Button>
            </Flex>
            <Field label="Commit message" htmlFor="gh-commit">
              <Textarea
                id="gh-commit"
                rows={2}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
              />
            </Field>

            <SectionAccordion label="Options" summary={path}>
              <Flex direction="column" gap="3">
                <Field
                  label="File path"
                  htmlFor="gh-path"
                  hint="Path within the repository, including the filename."
                >
                  <Input
                    id="gh-path"
                    placeholder="tokens/variables.json"
                    value={path}
                    onChange={(e) => {
                      setPath(e.target.value);
                      setGithubFilePath(e.target.value);
                    }}
                  />
                </Field>
                <Field
                  label="Branch"
                  htmlFor="gh-branch"
                  hint={`Created from ${connection?.baseBranch || "the base branch"} if it doesn't exist.`}
                >
                  <Flex gap="2" align="center">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Input
                        id="gh-branch"
                        value={branch}
                        style={{ width: "100%" }}
                        onChange={(e) => setBranch(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label="Generate a new branch name"
                      title="Generate a new branch name"
                      onClick={handleGenerateBranch}
                      style={iconButtonStyle}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                        <path d="M16 16h5v5" />
                      </svg>
                    </button>
                  </Flex>
                </Field>
                <Flex gap="2" align="center">
                  <Switch
                    id="gh-open-pr"
                    checked={openPr}
                    onCheckedChange={(checked) => setOpenPr(Boolean(checked))}
                  />
                  <Label htmlFor="gh-open-pr">Open a pull request after committing</Label>
                </Flex>
              </Flex>
            </SectionAccordion>

            <Flex direction="column" gap="2">
              <Flex justify="between" align="center">
                <Label>Changes</Label>
                <Button
                  variant="secondary"
                  disabled={
                    !path.trim() || !branch.trim() || !data || github.diffStatus === "loading"
                  }
                  onClick={handlePreviewDiff}
                >
                  {github.diffStatus === "loading" ? "Loading…" : "Refresh"}
                </Button>
              </Flex>
              {github.diffError ? (
                <Text style={dangerText}>{github.diffError}</Text>
              ) : null}
              {github.diffStatus === "loading" && !github.diff ? (
                <div
                  style={{
                    border: "1px solid var(--figma-color-border)",
                    borderRadius: 4,
                    padding: 8,
                  }}
                  aria-hidden
                >
                  <Flex direction="column" gap="2">
                    {["70%", "45%", "85%", "55%", "65%", "40%"].map((width, index) => (
                      <div key={index} className="varvar-skeleton-line" style={{ width }} />
                    ))}
                  </Flex>
                </div>
              ) : null}
              {github.diff ? <DiffList diff={github.diff} /> : null}
            </Flex>

            {error ? <Text style={dangerText}>{error}</Text> : null}
          </Flex>
        </Dialog.Section>
        <Dialog.Controls style={controlsStyle}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canPush} onClick={handlePush}>
            {status === "pushing"
              ? "Pushing…"
              : openPr
                ? "Commit & create PR"
                : "Commit"}
          </Button>
        </Dialog.Controls>
      </>
    );
  };

  const renderSuccess = () => (
    <>
      <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Flex
          direction="column"
          align="center"
          gap="3"
          style={{ textAlign: "center", padding: "12px 0" }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill="var(--figma-color-icon-success, #14ae5c)" />
            <path
              d="M7.5 12.5l3 3 6-7"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Text size="large" weight="strong">Pushed to GitHub</Text>
          <Text style={secondaryText}>
            Committed to <strong>{result?.branch}</strong> in{" "}
            <strong>{connection?.owner}/{connection?.repo}</strong>.
          </Text>
          {result?.prUrl ? (
            <Link href={result.prUrl} target="_blank" rel="noopener noreferrer">
              Open pull request ↗
            </Link>
          ) : (
            <Text style={secondaryText}>
              No pull request was created automatically.{" "}
              <Link href={result?.compareUrl} target="_blank" rel="noopener noreferrer">
                Open one ↗
              </Link>
            </Text>
          )}
        </Flex>
      </Dialog.Section>
      <Dialog.Controls style={controlsStyle}>
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </Dialog.Controls>
    </>
  );

  const renderUnlockForm = () => {
    const canUnlock = Boolean(unlockPassphrase) && status !== "verifying";
    return (
      <>
        <Dialog.Section className="varvar-scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center">
              <Text style={secondaryText}>
                Locked: <strong>{meta?.owner}/{meta?.repo}</strong>
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
    if (!meta) {
      return renderConnectForm();
    }
    if (isLocked) {
      return renderUnlockForm();
    }
    if (status === "success" && result) {
      return renderSuccess();
    }
    return renderPushForm();
  };

  const title = !meta
    ? "Connect to GitHub"
    : isLocked
      ? "Unlock GitHub"
      : status === "success" && result
        ? "Pushed to GitHub"
        : "Push to GitHub";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          size="1"
          placement="center"
          width="440px"
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
