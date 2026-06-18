import type { ExportSelection } from "../types.d";

/**
 * Whether a collection has at least one selected mode and should be exported.
 *
 * An `undefined` selection means "export everything", so every collection is
 * considered selected (back-compat with the pre-selection behaviour).
 * @param collectionId - The collection's Figma id
 * @param selection - The current export selection, or `undefined` for "all"
 * @returns `true` when the collection should be included in the export
 */
export function isCollectionSelected(
  collectionId: string,
  selection?: ExportSelection
): boolean {
  if (!selection) return true;
  return (selection[collectionId]?.length ?? 0) > 0;
}

/**
 * Whether a specific collection/mode pair is selected for export.
 *
 * Used by serializers that need to decide, per linked-variable reference,
 * whether the referenced target is part of the exported subset.
 * @param collectionId - The collection's Figma id
 * @param modeId - The mode's Figma id within that collection
 * @param selection - The current export selection, or `undefined` for "all"
 * @returns `true` when the pair is part of the export
 */
export function isModeSelected(
  collectionId: string,
  modeId: string,
  selection?: ExportSelection
): boolean {
  if (!selection) return true;
  return (selection[collectionId] ?? []).includes(modeId);
}

/**
 * Filters a collection's modes down to the ones the user selected.
 *
 * An `undefined` selection returns every mode (a fresh copy). The generic keeps
 * the caller's mode shape (Figma's `{ modeId, name, ... }`) intact.
 * @param collectionId - The collection's Figma id
 * @param modes - The collection's full list of modes
 * @param selection - The current export selection, or `undefined` for "all"
 * @returns The subset of modes to export, preserving their original order
 */
export function selectedModes<M extends { modeId: string }>(
  collectionId: string,
  modes: readonly M[],
  selection?: ExportSelection
): M[] {
  if (!selection) return [...modes];
  const allowed = selection[collectionId] ?? [];
  return modes.filter((mode) => allowed.includes(mode.modeId));
}
