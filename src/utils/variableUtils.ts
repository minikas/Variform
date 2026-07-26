import { isModeSelected } from "./selectionUtils";
import type { ExportSelection } from "../types.d";

/**
 * Finds a matching mode name in the linked variable's collection.
 * Matching is exact first, then case/whitespace-insensitive (Figma mode names
 * are compared loosely across collections, e.g. "Dark" vs "dark "). When no
 * mode matches, falls back to the first SELECTED mode of the collection (so
 * aliases never point at a mode absent from the export), or to the first mode
 * when no selection is provided.
 * @param currentModeName - The current mode name to match
 * @param linkedVarCollection - The variable collection to search in
 * @param selection - Optional export selection used for the fallback
 * @returns The matched mode name or the fallback mode's name
 */
export function getMatchingModeName(
    currentModeName: string,
    linkedVarCollection: VariableCollection,
    selection?: ExportSelection
): string {
    const exactMode = linkedVarCollection.modes.find(
        mode => mode.name === currentModeName
    );
    if (exactMode) return exactMode.name;

    const normalizedName = currentModeName.trim().toLowerCase();
    const matchedMode = linkedVarCollection.modes.find(
        mode => mode.name.trim().toLowerCase() === normalizedName
    );
    if (matchedMode) return matchedMode.name;

    if (selection) {
        const firstSelectedMode = linkedVarCollection.modes.find(
            mode => isModeSelected(linkedVarCollection.id, mode.modeId, selection)
        );
        if (firstSelectedMode) return firstSelectedMode.name;
    }

    return linkedVarCollection.modes[0].name;
}
