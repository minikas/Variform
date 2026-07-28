import { useEffect, useRef, useState } from "react";
import type { PushTarget, TargetFile } from "../utils/github/pushTargets";
import { targetFiles } from "../utils/github/pushTargets";
import { requestExport } from "../utils/exportRequest";
import { useSelection } from "../contexts/SelectionContext";

/** Per-file export state: content while/after loading, or the error. */
export interface TargetFileExportState {
  content: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Export state keyed by FILE key (see {@link exportFileKey}) — a multi-file
 * target (Tailwind "both") has one entry per produced file.
 */
export type TargetExportMap = Record<string, TargetFileExportState>;

/** A target file with its export content resolved. */
export interface TargetResolvedFile {
  /** File key (see {@link exportFileKey}) — also keys the diff state. */
  key: string;
  targetId: string;
  path: string;
  extension: string;
  content: string;
}

export interface UseTargetExportsReturn {
  /** Per-file export state (a file appears once its export starts). */
  exports: TargetExportMap;
  /** True while any file export is in flight. */
  isLoading: boolean;
}

/**
 * Key identifying one produced file of a target: the first file keeps the bare
 * target id (back-compat with single-file targets), additional files append
 * their target-local key — e.g. `t1` and `t1:preset`.
 */
export function exportFileKey(targetId: string, file: TargetFile, index: number): string {
  return index === 0 ? targetId : `${targetId}:${file.key}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred while exporting.";
}

/**
 * Resolve all target FILE contents in parallel (allSettled semantics): one
 * export request per produced file (two for a Tailwind "both" target), keyed
 * by file key, with per-file error capture so a single failing file does not
 * abort the others. `filenames` is the main page's per-file filename map
 * (filenameByFormat) used to resolve each file's full path.
 *
 * The request function is injected so tests can mock the plugin bridge.
 */
export async function resolveTargetExports(
  targets: PushTarget[],
  filenames: Partial<Record<string, string>>,
  request: (target: PushTarget, file: TargetFile) => Promise<string>,
): Promise<TargetExportMap> {
  const jobs = targets.flatMap((target) =>
    targetFiles(target, filenames).map((file, index) => ({ target, file, index })),
  );
  const entries = await Promise.all(
    jobs.map(async ({ target, file, index }): Promise<[string, TargetFileExportState]> => {
      const key = exportFileKey(target.id, file, index);
      try {
        const content = await request(target, file);
        return [key, { content, loading: false, error: null }];
      } catch (error) {
        return [key, { content: null, loading: false, error: messageOf(error) }];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * The files a target produces with their resolved contents — empty entries
 * for files whose export has not resolved (or failed) yet.
 */
export function resolvedFilesFor(
  target: PushTarget,
  filenames: Partial<Record<string, string>>,
  exports: TargetExportMap,
): TargetResolvedFile[] {
  return targetFiles(target, filenames).map((file, index) => {
    const key = exportFileKey(target.id, file, index);
    return {
      key,
      targetId: target.id,
      path: file.path,
      extension: file.extension,
      content: exports[key]?.content ?? "",
    };
  });
}

/** True when every file of every target has a resolved content. */
export function allFilesResolved(
  targets: PushTarget[],
  filenames: Partial<Record<string, string>>,
  exports: TargetExportMap,
): boolean {
  return (
    targets.length > 0 &&
    targets.every((target) =>
      targetFiles(target, filenames).every(
        (file, index) => exports[exportFileKey(target.id, file, index)]?.content != null,
      ),
    )
  );
}

/**
 * Resolve the export contents for every file of every push target in
 * parallel, with per-file loading/error state. Re-runs only when a target's
 * id/format/formatOptions or the underlying selection changes — editing
 * repo/branch/path does NOT re-trigger an export (they don't affect the
 * content). Responses from superseded runs are discarded (sequence guard on
 * top of requestExport's requestId correlation).
 */
export function useTargetExports(targets: PushTarget[]): UseTargetExportsReturn {
  const { selection, styleSelection, parserId, filenameByFormat } = useSelection();
  const [exports, setExports] = useState<TargetExportMap>({});
  const seqRef = useRef(0);

  // Same rule as useExportData: omit the selection until it is initialised so
  // the plugin exports everything instead of "nothing selected".
  const isInitialised = Object.keys(selection).length > 0;
  const exportSelection = isInitialised ? selection : undefined;

  // The effect keys on this content signature (not the array identity) so
  // target edits that don't change the export (folder, branch, repo, filename)
  // are free.
  const signature = targets
    .map((target) => `${target.id}:${target.format}:${JSON.stringify(target.formatOptions)}`)
    .join("|");
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const filenamesRef = useRef(filenameByFormat);
  filenamesRef.current = filenameByFormat;

  useEffect(() => {
    const currentTargets = targetsRef.current;
    const seq = ++seqRef.current;
    const jobs = currentTargets.flatMap((target) =>
      targetFiles(target, filenamesRef.current).map((file, index) => ({
        key: exportFileKey(target.id, file, index),
      })),
    );
    if (jobs.length === 0) {
      setExports({});
      return;
    }
    // Mark every file as loading up front, keeping any previous content so
    // the UI does not flicker while re-exporting.
    setExports((prev) =>
      Object.fromEntries(
        jobs.map(({ key }) => [
          key,
          { content: prev[key]?.content ?? null, loading: true, error: null },
        ]),
      ),
    );
    resolveTargetExports(currentTargets, filenamesRef.current, (target, file) =>
      requestExport(target.format, {
        ...file.formatOptions,
        selection: exportSelection,
        styleSelection,
        parserId,
      }),
    ).then((map) => {
      if (seqRef.current === seq) {
        setExports(map);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs mirror `targets`/filenames; the signature covers the export-relevant fields.
  }, [signature, exportSelection, styleSelection, parserId]);

  return {
    exports,
    isLoading: Object.values(exports).some((state) => state.loading),
  };
}
