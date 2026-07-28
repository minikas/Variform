/**
 * Push target data model for the multi-format "Push to GitHub" flow
 * (see openspec/changes/multi-format-github-push, decision D2).
 *
 * Each target pushes one export format (with its own format options) to one
 * folder in one repository/branch; the FILENAMES come from the main page's
 * per-file filename map (see utils/filename). Targets sharing
 * `${owner}/${repo}#${branch}` are grouped and land in a single atomic commit
 * (and at most one PR).
 *
 * The full target set is persisted per Figma document — EXCEPT the push branch
 * names, which stay session-scoped and are reseeded on every load.
 */

import {
  OutputFormats,
  type TailwindColorMode,
  type TailwindOutput,
  type TailwindUnit,
} from "../../types.d";
import { formatExtension } from "../formatExtension";
import { defaultFilename, filenameKey } from "../filename";

/** Version of the persisted target set inside the export-selection record. */
export const PUSH_TARGETS_VERSION = 1;

/**
 * Format-specific export options carried by a target. Mirrors the options the
 * plugin sandbox export handler accepts; irrelevant fields are ignored per
 * format (same gating as the single-format export).
 *
 * `tailwindOutput` additionally accepts `"both"` — a TARGET-ONLY extension of
 * the global `TailwindOutput` type: the target then produces two files (the
 * v4 stylesheet AND the v3 preset, see {@link targetFiles}). The single-format
 * flow (code.ts, ExportOptions) never sees `"both"`.
 */
export interface TargetFormatOptions {
  useRowColumnPos?: boolean;
  useDSCGFormat?: boolean;
  tailwindOutput?: TailwindOutput | "both";
  tailwindPrefix?: string;
  tailwindUnit?: TailwindUnit;
  tailwindColorMode?: TailwindColorMode;
}

/** One target to push: a format + options serialized into a repo folder. */
export interface PushTarget {
  /** Stable id for React keys / diff query keys (persisted). */
  id: string;
  format: OutputFormats;
  formatOptions: TargetFormatOptions;
  owner: string;
  repo: string;
  /** Branch new branches and PRs are based on (filled from the repo default). */
  baseBranch: string;
  /** Push branch — session-scoped, reseeded per session, never persisted. */
  branch: string;
  /**
   * Destination FOLDER inside the repository ("" = repo root). The filename
   * is configured on the main page (filenameByFormat), not here.
   */
  folder: string;
  /**
   * Folder of the Tailwind v3 preset file — only meaningful when the target
   * is Tailwind with `tailwindOutput: "both"` (`folder` stays the
   * stylesheet's). Defaults to the repo root.
   */
  presetFolder?: string;
  createPr: boolean;
}

/** Everything before the last "/" ("" when there is no folder part). */
export function dirname(path: string): string {
  const clean = path.trim().replace(/\/+$/, "");
  const index = clean.lastIndexOf("/");
  return index === -1 ? "" : clean.slice(0, index);
}

/** Join a folder and a filename (folder may be "" = repo root). */
function joinFolder(folder: string, name: string): string {
  const clean = folder.trim().replace(/\/+$/, "");
  return clean ? `${clean}/${name}` : name;
}

/**
 * One concrete file a target produces. Most targets produce exactly one; a
 * Tailwind target with `tailwindOutput: "both"` produces two (stylesheet +
 * preset), each with its own normalized single-output formatOptions.
 */
export interface TargetFile {
  /** Stable key within the target ("file" / "css" / "preset"). */
  key: string;
  path: string;
  /** File extension selecting the diff parser (e.g. "css" / "js"). */
  extension: string;
  /** Format options for THIS file's export (normalized — never `"both"`). */
  formatOptions: TargetFormatOptions & { tailwindOutput?: TailwindOutput };
}

/**
 * Expand a target into the file(s) it pushes, resolving full paths from the
 * target's folder(s) plus the per-file filenames configured on the main page
 * (`filenames` = the `filenameByFormat` map, keyed by {@link filenameKey}).
 * Tailwind "both" returns the stylesheet first (the target's `folder`) and
 * the preset second (`presetFolder`, defaulting to the repo root);
 * everything else returns the single current file.
 */
export function targetFiles(
  target: PushTarget,
  filenames: Partial<Record<string, string>>,
): TargetFile[] {
  const nameFor = (key: string): string =>
    filenames[key]?.trim() || defaultFilename(key);
  const output = target.formatOptions.tailwindOutput;
  if (target.format === OutputFormats.TAILWIND && output === "both") {
    const cssKey = filenameKey(OutputFormats.TAILWIND, "css");
    const presetKey = filenameKey(OutputFormats.TAILWIND, "preset");
    return [
      {
        key: "css",
        path: joinFolder(target.folder, `${nameFor(cssKey)}.css`),
        extension: "css",
        formatOptions: { ...target.formatOptions, tailwindOutput: "css" },
      },
      {
        key: "preset",
        path: joinFolder(target.presetFolder ?? "", `${nameFor(presetKey)}.js`),
        extension: "js",
        formatOptions: { ...target.formatOptions, tailwindOutput: "preset" },
      },
    ];
  }
  const singleOutput = output === "both" ? undefined : output;
  const key = filenameKey(target.format, singleOutput);
  const extension = formatExtension(target.format, singleOutput);
  return [
    {
      key: "file",
      path: joinFolder(target.folder, `${nameFor(key)}.${extension}`),
      extension,
      formatOptions: { ...target.formatOptions, tailwindOutput: singleOutput },
    },
  ];
}

/** Persisted shape of a target: everything but the session-scoped branch. */
export type PersistedPushTarget = Omit<PushTarget, "branch">;

let nextTargetId = 0;

/** Unique id for a new target (session-unique is enough; ids are persisted). */
export function createTargetId(): string {
  return `target-${Date.now().toString(36)}-${nextTargetId++}`;
}

/** Grouping key: targets sharing it form one commit/PR. */
export function targetGroupKey(
  target: Pick<PushTarget, "owner" | "repo" | "branch">,
): string {
  return `${target.owner}/${target.repo}#${target.branch}`;
}

/** A set of targets that land in a single atomic commit (and at most one PR). */
export interface PushTargetGroup {
  /** `${owner}/${repo}#${branch}`. */
  key: string;
  owner: string;
  repo: string;
  branch: string;
  /** Base branch of the group's first target. */
  baseBranch: string;
  /** True when any target in the group wants a PR. */
  createPr: boolean;
  targets: PushTarget[];
}

/**
 * Group targets by `${owner}/${repo}#${branch}` (decision D2). Group order
 * follows first appearance, target order within a group is preserved.
 */
export function groupTargets(targets: PushTarget[]): PushTargetGroup[] {
  const groups = new Map<string, PushTargetGroup>();
  for (const target of targets) {
    const key = targetGroupKey(target);
    const existing = groups.get(key);
    if (existing) {
      existing.targets.push(target);
      existing.createPr = existing.createPr || target.createPr;
    } else {
      groups.set(key, {
        key,
        owner: target.owner,
        repo: target.repo,
        branch: target.branch,
        baseBranch: target.baseBranch,
        createPr: target.createPr,
        targets: [target],
      });
    }
  }
  return [...groups.values()];
}

/** Strip the session-scoped branch names before persisting (decision D6). */
export function toPersistedTargets(targets: PushTarget[]): PersistedPushTarget[] {
  return targets.map(({ branch: _branch, ...persisted }) => persisted);
}

/** Inputs needed to seed NEW targets in {@link deriveTargets}. */
export interface DeriveTargetsSeed {
  /** Shared session branch for newly created targets. */
  branch: string;
  /** Repo defaults for new targets (first existing target or legacy scope). */
  repo?: { owner: string; repo: string; baseBranch: string };
  /** Format options for a NEW target of the given format. */
  formatOptions: (format: OutputFormats) => TargetFormatOptions;
  /** Default destination folder for a NEW target of the given format. */
  folder: (format: OutputFormats) => string;
}

/**
 * Derive the push target set from the main page's multi-format selection:
 * every checked format gets a target — reusing the existing one with the same
 * format (keeping owner/repo/baseBranch/folders and options) when present,
 * otherwise creating one with the seed defaults. The selection is the single
 * source of truth: targets whose format is NOT checked are dropped (there is
 * no manual add/remove in the dialog). Idempotent.
 */
export function deriveTargets(
  formats: OutputFormats[],
  existingTargets: PushTarget[],
  seed: DeriveTargetsSeed,
): PushTarget[] {
  const seen = new Set<OutputFormats>();
  const result = existingTargets.filter((target) => {
    // Keep the first target per checked format; drop unchecked formats and
    // duplicates from the manual add/remove era (one target per format).
    if (!formats.includes(target.format) || seen.has(target.format)) {
      return false;
    }
    seen.add(target.format);
    return true;
  });
  for (const format of formats) {
    if (result.some((target) => target.format === format)) {
      continue;
    }
    result.push(
      createTarget({
        format,
        folder: seed.folder(format),
        branch: seed.branch,
        owner: seed.repo?.owner,
        repo: seed.repo?.repo,
        baseBranch: seed.repo?.baseBranch,
        formatOptions: seed.formatOptions(format),
      }),
    );
  }
  return result;
}

export interface CreateTargetInit {
  format: OutputFormats;
  /** Destination folder ("" = repo root). */
  folder: string;
  /** Push branch (session-scoped seed, e.g. from defaultBranchName). */
  branch: string;
  owner?: string;
  repo?: string;
  baseBranch?: string;
  /** Preset file folder for Tailwind "both" targets (see PushTarget). */
  presetFolder?: string;
  formatOptions?: TargetFormatOptions;
  createPr?: boolean;
  id?: string;
}

/** Build a target with defaults for the optional fields. */
export function createTarget(init: CreateTargetInit): PushTarget {
  return {
    id: init.id ?? createTargetId(),
    format: init.format,
    formatOptions: init.formatOptions ?? {},
    owner: init.owner ?? "",
    repo: init.repo ?? "",
    baseBranch: init.baseBranch ?? "",
    branch: init.branch,
    folder: init.folder,
    ...(init.presetFolder !== undefined ? { presetFolder: init.presetFolder } : {}),
    createPr: init.createPr ?? true,
  };
}

/**
 * Default destination FOLDER seeded for a new target, following the
 * per-platform conventions for committed design tokens ("" = repo root):
 * - JSON / Style Dictionary: `tokens` (Style Dictionary package layout)
 * - CSS / Tailwind v4 `@theme` stylesheet: `src/styles`
 * - Tailwind v3 preset: repo root (official presets convention)
 * - SCSS: partials under `src/styles/abstracts`
 * - JS / TS module: `src/tokens`
 * - React Native / Tamagui: `src/theme`
 * - iOS Swift: `Sources/DesignSystem`
 * - Android: `app/src/main/res/values` (resource names must be lowercase)
 * - Flutter: `lib/theme`
 * - CSV (documentation artifact): `docs`
 */
export function defaultTargetFolder(
  format: OutputFormats,
  tailwindOutput?: TailwindOutput,
): string {
  switch (format) {
    case OutputFormats.JSON:
    case OutputFormats.STYLE_DICTIONARY:
      return "tokens";
    case OutputFormats.CSS:
      return "src/styles";
    case OutputFormats.TAILWIND:
      return tailwindOutput === "preset" ? "" : "src/styles";
    case OutputFormats.SCSS:
      return "src/styles/abstracts";
    case OutputFormats.JS:
    case OutputFormats.TS:
      return "src/tokens";
    case OutputFormats.REACT_NATIVE:
    case OutputFormats.TAMAGUI:
      return "src/theme";
    case OutputFormats.SWIFT:
      return "Sources/DesignSystem";
    case OutputFormats.ANDROID:
      return "app/src/main/res/values";
    case OutputFormats.FLUTTER:
      return "lib/theme";
    case OutputFormats.CSV:
      return "docs";
    default:
      return "tokens";
  }
}

/**
 * Migration (decision D6): derive the initial target set from a legacy
 * per-document `githubFilePath`. The active format gets the legacy path's
 * FOLDER (the filename now lives in the main page's filename map); the
 * repository fields come from the legacy global connection when available.
 * Returns an empty array when there is no legacy path to migrate.
 */
export function migrateLegacyTargets(args: {
  githubFilePath: string;
  format: OutputFormats;
  /** Freshly seeded push branch for the session. */
  branch: string;
  repo?: { owner: string; repo: string; baseBranch: string };
}): PushTarget[] {
  if (!args.githubFilePath) {
    return [];
  }
  return [
    createTarget({
      format: args.format,
      folder: dirname(args.githubFilePath),
      branch: args.branch,
      owner: args.repo?.owner,
      repo: args.repo?.repo,
      baseBranch: args.repo?.baseBranch,
    }),
  ];
}

/**
 * Normalize one persisted entry, migrating the legacy full-path shape
 * (`path` / `presetPath`) to folders (dirname only — filenames moved to the
 * main page's filename map). Returns null for entries too corrupt to restore.
 */
function normalizePersistedTarget(value: unknown): PersistedPushTarget | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const target = value as Record<string, unknown>;
  if (
    typeof target.id !== "string" ||
    typeof target.format !== "string" ||
    typeof target.owner !== "string" ||
    typeof target.repo !== "string"
  ) {
    return null;
  }
  let folder: string;
  let presetFolder: string | undefined;
  if (typeof target.folder === "string") {
    folder = target.folder;
    presetFolder =
      typeof target.presetFolder === "string" ? target.presetFolder : undefined;
  } else if (typeof target.path === "string") {
    folder = dirname(target.path);
    presetFolder =
      typeof target.presetPath === "string" ? dirname(target.presetPath) : undefined;
  } else {
    return null;
  }
  // Strip the legacy full-path fields — only the folders survive.
  const { path: _path, presetPath: _presetPath, ...rest } = target;
  return {
    ...(rest as unknown as PersistedPushTarget),
    folder,
    ...(presetFolder !== undefined ? { presetFolder } : {}),
  };
}

/**
 * Restore persisted targets for a new session: invalid entries are dropped and
 * every target gets the freshly seeded push branch (branch names are never
 * persisted — a shared seed per session keeps same-repo targets grouped).
 */
export function restorePersistedTargets(
  persisted: PersistedPushTarget[],
  branch: string,
): PushTarget[] {
  return persisted
    .map(normalizePersistedTarget)
    .filter((target): target is PersistedPushTarget => target !== null)
    .map((target) => ({ ...target, branch }));
}

/**
 * Resolve the session's target set from a parsed export-selection record:
 * restored persisted targets when present, otherwise the migration of a legacy
 * `githubFilePath`. Returns `null` when the record holds neither (the caller
 * then keeps its current/default targets).
 */
export function parseStoredTargets(
  record: {
    pushTargets?: unknown;
    githubFilePath?: unknown;
    format?: unknown;
  },
  branch: string,
): PushTarget[] | null {
  if (Array.isArray(record.pushTargets)) {
    return restorePersistedTargets(
      record.pushTargets as PersistedPushTarget[],
      branch,
    );
  }
  if (typeof record.githubFilePath === "string" && record.githubFilePath) {
    return migrateLegacyTargets({
      githubFilePath: record.githubFilePath,
      format:
        typeof record.format === "string"
          ? (record.format as OutputFormats)
          : OutputFormats.JSON,
      branch,
    });
  }
  return null;
}
