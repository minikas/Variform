/**
 * Computes a human-readable diff between the file currently in the GitHub repo
 * and the freshly generated export, so the user can review which tokens change
 * (and how they were before) prior to committing.
 *
 * Token-level parsing is used for the structured formats (JSON/DSCG and CSS);
 * everything else falls back to a line-by-line diff.
 */

export type ChangeType = "added" | "updated" | "removed";

export interface TokenChange {
  /** Identifier for the change: a token path, CSS variable, or line marker. */
  key: string;
  type: ChangeType;
  /** Previous value (set for "updated" and "removed"). */
  oldValue?: string;
  /** New value (set for "added" and "updated"). */
  newValue?: string;
}

export interface DiffResult {
  changes: TokenChange[];
  /** True when token parsing was not possible and a line diff was used. */
  isLineDiff: boolean;
  added: number;
  updated: number;
  removed: number;
}

/** Flatten a JSON document into a map of dotted paths to stringified leaf values. */
export function flattenJson(content: string): Map<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const map = new Map<string, string>();
  const walk = (node: unknown, prefix: string) => {
    if (node === null || typeof node !== "object") {
      map.set(prefix || "(root)", String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((value, index) =>
        walk(value, prefix ? `${prefix}[${index}]` : `[${index}]`),
      );
      return;
    }
    for (const [childKey, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, prefix ? `${prefix}.${childKey}` : childKey);
    }
  };

  walk(parsed, "");
  return map;
}

/**
 * Parse CSS custom properties into a map. Keys are namespaced by their selector
 * nesting so the same variable defined under `:root` and under a dark-mode
 * media query is diffed independently.
 */
export function parseCssVars(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const selectorStack: string[] = [];
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "");

  let buffer = "";
  for (const ch of withoutComments) {
    if (ch === "{") {
      selectorStack.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (ch === "}") {
      selectorStack.pop();
      buffer = "";
    } else if (ch === ";") {
      const match = /^(--[A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(buffer.trim());
      if (match) {
        const context = selectorStack.filter(Boolean).join(" > ");
        const key = context ? `${context} | ${match[1]}` : match[1];
        map.set(key, match[2].trim());
      }
      buffer = "";
    } else {
      buffer += ch;
    }
  }

  return map;
}

/** Diff two value maps into added / updated / removed changes. */
export function diffMaps(
  oldMap: Map<string, string>,
  newMap: Map<string, string>,
): TokenChange[] {
  const changes: TokenChange[] = [];

  for (const [key, newValue] of newMap) {
    if (!oldMap.has(key)) {
      changes.push({ key, type: "added", newValue });
    } else if (oldMap.get(key) !== newValue) {
      changes.push({ key, type: "updated", oldValue: oldMap.get(key), newValue });
    }
  }
  for (const [key, oldValue] of oldMap) {
    if (!newMap.has(key)) {
      changes.push({ key, type: "removed", oldValue });
    }
  }

  changes.sort((a, b) => a.key.localeCompare(b.key));
  return changes;
}

/** Largest input the LCS line diff will attempt before degrading to a set diff. */
const LINE_DIFF_CELL_LIMIT = 4_000_000;

/** Line-by-line diff used as a fallback for unstructured formats. */
export function lineDiff(oldText: string, newText: string): TokenChange[] {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  const changes: TokenChange[] = [];

  const keep = (change: TokenChange) =>
    (change.oldValue ?? change.newValue ?? "").trim() !== "";

  // For very large inputs, fall back to an order-insensitive set diff.
  if (a.length * b.length > LINE_DIFF_CELL_LIMIT) {
    const oldSet = new Set(a);
    const newSet = new Set(b);
    b.forEach((line, index) => {
      if (!oldSet.has(line)) changes.push({ key: `+${index}`, type: "added", newValue: line });
    });
    a.forEach((line, index) => {
      if (!newSet.has(line)) changes.push({ key: `-${index}`, type: "removed", oldValue: line });
    });
    return changes.filter(keep);
  }

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      changes.push({ key: `-${i}`, type: "removed", oldValue: a[i] });
      i++;
    } else {
      changes.push({ key: `+${j}`, type: "added", newValue: b[j] });
      j++;
    }
  }
  while (i < m) {
    changes.push({ key: `-${i}`, type: "removed", oldValue: a[i] });
    i++;
  }
  while (j < n) {
    changes.push({ key: `+${j}`, type: "added", newValue: b[j] });
    j++;
  }

  return changes.filter(keep);
}

function summarize(changes: TokenChange[], isLineDiff: boolean): DiffResult {
  return {
    changes,
    isLineDiff,
    added: changes.filter((c) => c.type === "added").length,
    updated: changes.filter((c) => c.type === "updated").length,
    removed: changes.filter((c) => c.type === "removed").length,
  };
}

/**
 * Compute a diff between the previous file content (or null when the file is
 * new) and the freshly generated export, picking a token-level parser for
 * JSON/CSS and falling back to a line diff otherwise.
 */
export function computeDiff(
  extension: string,
  oldContent: string | null,
  newContent: string,
): DiffResult {
  const normalized = extension.toLowerCase();

  if (normalized === "json") {
    const newMap = flattenJson(newContent);
    const oldMap = oldContent === null ? new Map<string, string>() : flattenJson(oldContent);
    if (newMap && oldMap) {
      return summarize(diffMaps(oldMap, newMap), false);
    }
  } else if (normalized === "css") {
    const newMap = parseCssVars(newContent);
    const oldMap = oldContent === null ? new Map<string, string>() : parseCssVars(oldContent);
    return summarize(diffMaps(oldMap, newMap), false);
  }

  return summarize(lineDiff(oldContent ?? "", newContent), true);
}
