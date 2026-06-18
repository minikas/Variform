import type { StyleSelection } from "../types.d";

/** Every style kind enabled — the default when no selection is provided. */
export const ALL_STYLES: StyleSelection = {
  text: true,
  paint: true,
  effect: true,
  grid: true,
};

/** No style kind enabled. */
export const NO_STYLES: StyleSelection = {
  text: false,
  paint: false,
  effect: false,
  grid: false,
};

/** The style kinds in display order, with their UI labels. */
export const STYLE_KINDS: ReadonlyArray<{ key: keyof StyleSelection; label: string }> = [
  { key: "text", label: "Text styles" },
  { key: "paint", label: "Paint styles" },
  { key: "effect", label: "Effect styles" },
  { key: "grid", label: "Grid styles" },
];

/** Whether at least one style kind is enabled. */
export const anyStyleSelected = (selection: StyleSelection): boolean =>
  selection.text || selection.paint || selection.effect || selection.grid;
