import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Label, Select, Text, Flex } from "figma-kit";
import {
  GitHubAuth,
  RepoSummary,
  listBranches,
  verifyConnection,
} from "../../utils/github/githubApi";
import { PushTarget, targetFiles } from "../../utils/github/pushTargets";
import { formatLabel } from "../../utils/formatLabel";
import { useSelection } from "../../contexts/SelectionContext";
import { SectionAccordion } from "../SectionAccordion";
import type { TargetFileExportState } from "../../hooks/useTargetExports";

const secondaryText: React.CSSProperties = {
  color: "var(--figma-color-text-secondary)",
};

const dangerText: React.CSSProperties = {
  color: "var(--figma-color-text-danger)",
};

/** Read-only badge showing the resolved filename next to a folder input. */
const filenameBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  alignSelf: "center",
  background: "var(--figma-color-bg-secondary)",
  borderRadius: 4,
  padding: "4px 6px",
  fontFamily: "monospace",
  fontSize: "11px",
  whiteSpace: "nowrap",
  color: "var(--figma-color-text-secondary)",
};

const folderInputStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 100,
};

interface TargetRowProps {
  target: PushTarget;
  /** Session auth for the lazy per-repo verification (null while locked). */
  auth: GitHubAuth | null;
  /** Repositories the token can access (for the repo picker). */
  repos: RepoSummary[] | null;
  reposLoading: boolean;
  /** Export state per produced file (errors surface inline). */
  exportStates?: (TargetFileExportState | undefined)[];
  onChange: (patch: Partial<PushTarget>) => void;
}

/** Folder input + read-only filename badge (the filename is set on the main page). */
const FolderField: React.FC<{
  id: string;
  label: string;
  folder: string;
  /** Resolved filename shown as a badge, e.g. "globals.css". */
  fileName: string;
  onFolderChange: (folder: string) => void;
}> = ({ id, label, folder, fileName, onFolderChange }) => (
  <Flex direction="column" gap="1">
    <Label htmlFor={id}>{label}</Label>
    <Flex gap="2" align="center">
      <div style={folderInputStyle}>
        <Input
          id={id}
          placeholder="root"
          value={folder}
          style={{ width: "100%" }}
          onChange={(e) => onFolderChange(e.target.value)}
        />
      </div>
      <span style={filenameBadgeStyle} title={fileName}>
        {fileName}
      </span>
    </Flex>
  </Flex>
);

/**
 * One push target row: collapsed it shows the format badge and the resolved
 * file path; expanded it edits the GitHub destination — repository (picker +
 * lazy verification), push/base branches and the destination FOLDER(s). The
 * filename is configured on the main page and shown as a read-only badge.
 */
export const TargetRow: React.FC<TargetRowProps> = ({
  target,
  auth,
  repos,
  reposLoading,
  exportStates,
  onChange,
}) => {
  const { filenameByFormat } = useSelection();
  const hasRepo = Boolean(target.owner.trim() && target.repo.trim());

  // Lazy per-target verification (GET /repos/{owner}/{repo}): surfaces
  // "no access" / "not found" inline without invalidating other targets, and
  // backfills the base branch from the repo default when still unset.
  const verifyQuery = useQuery({
    queryKey: ["github", "repo-verify", target.owner, target.repo],
    enabled: !!auth && hasRepo,
    retry: false,
    staleTime: 60_000,
    queryFn: () =>
      verifyConnection({
        ...auth!,
        owner: target.owner,
        repo: target.repo,
        baseBranch: target.baseBranch || "main",
      }),
  });
  const repoInfo = verifyQuery.data ?? null;

  useEffect(() => {
    if (repoInfo && !target.baseBranch) {
      onChange({ baseBranch: repoInfo.defaultBranch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only backfill when the verification lands.
  }, [repoInfo]);

  // Base branch picker: the repo's branches. The current value is always an
  // option — while the list loads, after it changed upstream, or when the
  // query fails (the row must stay usable anyway).
  const branchesQuery = useQuery({
    queryKey: ["github", "branches", target.owner, target.repo],
    enabled: !!auth && hasRepo,
    retry: false,
    staleTime: 60_000,
    queryFn: () => listBranches(auth!, target.owner, target.repo),
  });
  const branchOptions = [
    ...new Set([
      ...(target.baseBranch ? [target.baseBranch] : []),
      ...(branchesQuery.data ?? []),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const handleSelectRepo = (fullName: string) => {
    const summary = repos?.find((item) => item.fullName === fullName);
    if (summary) {
      onChange({
        owner: summary.owner,
        repo: summary.repo,
        baseBranch: summary.defaultBranch,
      });
    }
  };

  const files = targetFiles(target, filenameByFormat);
  const isBoth = files.length > 1;
  const basename = (path: string) => path.split("/").pop() || path;
  // Collapsed summary: resolved path of the first file, "+N" for the extra
  // files a multi-file target produces (e.g. "globals.css, +1").
  const summary = isBoth
    ? `${basename(files[0].path)}, +${files.length - 1}`
    : files[0].path;
  const fullName = hasRepo ? `${target.owner}/${target.repo}` : "";
  const repoError = verifyQuery.isError
    ? verifyQuery.error instanceof Error
      ? verifyQuery.error.message
      : "Could not verify this repository."
    : repoInfo && !repoInfo.canPush
      ? "The token has no push access to this repository."
      : null;
  // First export error across the target's files, labelled with its path.
  const exportError = files
    .map((file, index) => ({ file, state: exportStates?.[index] }))
    .find(({ state }) => state?.error);

  return (
    <SectionAccordion
      label={formatLabel(target.format)}
      summary={summary}
    >
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Label htmlFor={`gh-target-repo-${target.id}`}>Repository</Label>
          <Select.Root
            value={fullName}
            onValueChange={handleSelectRepo}
            disabled={!repos || repos.length === 0}
          >
            <Select.Trigger
              id={`gh-target-repo-${target.id}`}
              placeholder={
                reposLoading
                  ? "Loading repositories…"
                  : repos && repos.length
                    ? "Select a repository"
                    : "No repositories found for this token"
              }
            />
            <Select.Content portal style={{ maxHeight: 280, overflowY: "auto" }}>
              {[...(repos ?? [])]
                .sort((a, b) => a.fullName.localeCompare(b.fullName))
                .map((item) => (
                  <Select.Item
                    key={item.fullName}
                    value={item.fullName}
                    disabled={!item.canPush}
                  >
                    {item.canPush ? item.fullName : `${item.fullName} (no push access)`}
                  </Select.Item>
                ))}
            </Select.Content>
          </Select.Root>
          {repoError ? <Text style={dangerText}>{repoError}</Text> : null}
        </Flex>

        <FolderField
          id={`gh-target-folder-${target.id}`}
          label={isBoth ? "Stylesheet folder" : "Folder"}
          folder={target.folder}
          fileName={basename(files[0].path)}
          onFolderChange={(folder) => onChange({ folder })}
        />

        {isBoth ? (
          <FolderField
            id={`gh-target-preset-folder-${target.id}`}
            label="Preset folder"
            folder={target.presetFolder ?? ""}
            fileName={basename(files[1].path)}
            onFolderChange={(presetFolder) => onChange({ presetFolder })}
          />
        ) : null}

        <Flex gap="2" align="stretch">
          <div style={{ flex: 1, minWidth: 0 }}>
            <Flex direction="column" gap="1">
              <Label htmlFor={`gh-target-branch-${target.id}`}>Branch</Label>
              <Input
                id={`gh-target-branch-${target.id}`}
                value={target.branch}
                style={{ width: "100%" }}
                onChange={(e) => onChange({ branch: e.target.value })}
              />
            </Flex>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Flex direction="column" gap="1">
              <Label htmlFor={`gh-target-base-${target.id}`}>Base branch</Label>
              <Select.Root
                value={target.baseBranch}
                onValueChange={(value) => onChange({ baseBranch: value })}
                disabled={!hasRepo}
              >
                <Select.Trigger
                  id={`gh-target-base-${target.id}`}
                  placeholder={
                    !hasRepo
                      ? "Select a repository first"
                      : branchesQuery.isFetching
                        ? "Loading branches…"
                        : "Select a branch"
                  }
                />
                <Select.Content portal style={{ maxHeight: 280, overflowY: "auto" }}>
                  {branchOptions.map((name) => (
                    <Select.Item key={name} value={name}>
                      {name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
          </div>
        </Flex>

        {exportError?.state?.error ? (
          <Text style={dangerText}>
            Export failed ({exportError.file.path}): {exportError.state.error}
          </Text>
        ) : null}
      </Flex>
    </SectionAccordion>
  );
};
