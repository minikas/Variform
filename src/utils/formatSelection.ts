import { OutputFormats } from "../types.d";

/**
 * Toggle one format in the main page's multi-format selection.
 *
 * Rules:
 * - Checking a format makes it the ACTIVE format (preview/download follow the
 *   last checked one).
 * - Unchecking the active format moves the active one to the last remaining.
 * - Everything may be unchecked: the active value is kept (there is no
 *   "next" to move to) and callers hide the preview and disable actions.
 */
export function toggleCheckedFormat(
  checked: OutputFormats[],
  format: OutputFormats,
  active: OutputFormats,
): { checked: OutputFormats[]; active: OutputFormats } {
  if (checked.includes(format)) {
    const next = checked.filter((item) => item !== format);
    return {
      checked: next,
      active: active === format && next.length > 0 ? next[next.length - 1] : active,
    };
  }
  return { checked: [...checked, format], active: format };
}
