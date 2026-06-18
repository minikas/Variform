import type { CollectionMeta, ExportSelection } from "../types.d";

/**
 * Tri-state for a collection's checkbox: every mode selected, none selected, or
 * a mix of the two.
 */
export type CheckedState = boolean | "indeterminate";

/**
 * Builds a selection with every mode of every collection selected.
 *
 * This is the default "all selected" state used when the accordion first loads.
 * @param collections - The collection/mode tree from the plugin
 * @returns A selection mapping each collection id to all of its mode ids
 */
export function initSelection(collections: CollectionMeta[]): ExportSelection {
  const selection: ExportSelection = {};
  for (const collection of collections) {
    selection[collection.id] = collection.modes.map((mode) => mode.modeId);
  }
  return selection;
}

/**
 * Returns an empty selection (nothing exported). Every collection is kept as an
 * empty array so the map still distinguishes "explicitly deselected" from
 * "unknown collection" when reconciling persisted state.
 * @param collections - The collection/mode tree from the plugin
 * @returns A selection mapping each collection id to an empty array
 */
export function deselectAllSelection(collections: CollectionMeta[]): ExportSelection {
  const selection: ExportSelection = {};
  for (const collection of collections) {
    selection[collection.id] = [];
  }
  return selection;
}

/**
 * Toggles a single mode within a collection, returning a new selection.
 * @param selection - The current selection
 * @param collectionId - The collection id
 * @param modeId - The mode id to toggle
 * @returns A new selection with the mode added or removed
 */
export function toggleMode(
  selection: ExportSelection,
  collectionId: string,
  modeId: string
): ExportSelection {
  const current = selection[collectionId] ?? [];
  const next = current.includes(modeId)
    ? current.filter((id) => id !== modeId)
    : [...current, modeId];
  return { ...selection, [collectionId]: next };
}

/**
 * Computes the tri-state for a collection's header checkbox.
 * @param selection - The current selection
 * @param collection - The collection to evaluate
 * @returns `true` (all modes), `false` (none) or `"indeterminate"` (some)
 */
export function getCollectionCheckedState(
  selection: ExportSelection,
  collection: CollectionMeta
): CheckedState {
  const selectedCount = (selection[collection.id] ?? []).length;
  if (selectedCount === 0) return false;
  if (selectedCount >= collection.modes.length) return true;
  return "indeterminate";
}

/**
 * Toggles every mode of a collection at once. A collection that is fully
 * selected becomes empty; any other state (none or partial) becomes fully
 * selected — matching the common "click the header to (de)select all" behaviour.
 * @param selection - The current selection
 * @param collection - The collection whose modes to toggle
 * @returns A new selection with the collection fully selected or cleared
 */
export function toggleCollection(
  selection: ExportSelection,
  collection: CollectionMeta
): ExportSelection {
  const checked = getCollectionCheckedState(selection, collection);
  const next = checked === true ? [] : collection.modes.map((mode) => mode.modeId);
  return { ...selection, [collection.id]: next };
}

/**
 * Whether anything at all is selected across every collection.
 * @param selection - The current selection
 * @returns `true` when at least one mode is selected
 */
export function hasAnySelection(selection: ExportSelection): boolean {
  return Object.values(selection).some((modeIds) => modeIds.length > 0);
}

/**
 * Reconciles a persisted selection against the current collection tree.
 *
 * - Known collections keep their stored mode ids, intersected with the modes
 *   that still exist (stale modes are dropped).
 * - Collections absent from the stored selection are treated as new and default
 *   to fully selected, preserving the "all selected by default" philosophy.
 *
 * Because {@link deselectAllSelection} and {@link toggleCollection} keep an
 * (possibly empty) entry per collection, a deselected collection survives
 * reconciliation as an empty array rather than being re-selected.
 * @param stored - The previously persisted selection
 * @param collections - The current collection/mode tree from the plugin
 * @returns A selection valid for the current document
 */
export function reconcileSelection(
  stored: ExportSelection,
  collections: CollectionMeta[]
): ExportSelection {
  const reconciled: ExportSelection = {};
  for (const collection of collections) {
    const storedModes = stored[collection.id];
    if (storedModes === undefined) {
      reconciled[collection.id] = collection.modes.map((mode) => mode.modeId);
      continue;
    }
    const validModeIds = new Set(collection.modes.map((mode) => mode.modeId));
    reconciled[collection.id] = storedModes.filter((modeId) => validModeIds.has(modeId));
  }
  return reconciled;
}
