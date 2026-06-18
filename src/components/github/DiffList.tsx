import React from "react";
import { Flex, Text } from "figma-kit";
import { DiffResult, TokenChange } from "../../utils/github/tokenDiff";

/** Cap how many rows we render so a huge diff can't lock up the UI. */
const MAX_VISIBLE = 200;

const secondaryStyle: React.CSSProperties = {
  color: "var(--figma-color-text-secondary)",
};

type RowKind = "add" | "del";

/**
 * Longest common prefix length between two strings. Used for cheap word-level
 * highlighting so we only emphasise the segment that actually changed.
 */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * Longest common suffix length between two strings, not overlapping the prefix
 * region already consumed on either side.
 */
function commonSuffixLength(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix;
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Split `text` into [before, changed, after] where `changed` is the segment
 * that differs from `other` (the affixes shared with `other` are stripped).
 * Returns null when there is nothing meaningful to highlight (identical, or the
 * whole string changed).
 */
function splitChangedSegment(
  text: string,
  other: string,
): { before: string; changed: string; after: string } | null {
  if (text === other) return null;
  const prefix = commonPrefixLength(text, other);
  const suffix = commonSuffixLength(text, other, prefix);
  if (prefix === 0 && suffix === 0) return null;
  const changed = text.slice(prefix, text.length - suffix);
  if (changed === "") return null;
  return {
    before: text.slice(0, prefix),
    changed,
    after: text.slice(text.length - suffix),
  };
}

/** Render a value with the changed segment wrapped in a word-level highlight. */
function highlightedValue(value: string, counterpart: string | undefined): React.ReactNode {
  if (counterpart === undefined) return value;
  const segment = splitChangedSegment(value, counterpart);
  if (!segment) return value;
  return (
    <>
      {segment.before}
      <span className="varvar-diff-word">{segment.changed}</span>
      {segment.after}
    </>
  );
}

interface DiffRowProps {
  kind: RowKind;
  children: React.ReactNode;
}

/** A single full-width unified-diff row with a fixed +/− sign gutter. */
function DiffRow({ kind, children }: DiffRowProps): React.ReactElement {
  return (
    <div className={`varvar-diff-row varvar-diff-${kind}`}>
      <span className="varvar-diff-gutter" aria-hidden="true">
        {kind === "add" ? "+" : "−"}
      </span>
      <span className="varvar-diff-code">{children}</span>
    </div>
  );
}

/**
 * Render one logical change as one or two GitHub-style rows.
 *
 * - added   → a single green row
 * - removed → a single red row
 * - updated → the canonical GitHub pair: a red "removed" row showing the old
 *             value immediately followed by a green "added" row showing the
 *             new value, with word-level highlighting of the changed segment.
 *
 * Line diffs (`isLineDiff`) render just the line value; token diffs render
 * `key: value`.
 */
function renderChange(change: TokenChange, isLineDiff: boolean, baseKey: string): React.ReactNode {
  const prefix = isLineDiff ? "" : `${change.key}: `;

  if (change.type === "added") {
    return (
      <DiffRow key={`${baseKey}-add`} kind="add">
        {prefix}
        {change.newValue}
      </DiffRow>
    );
  }

  if (change.type === "removed") {
    return (
      <DiffRow key={`${baseKey}-del`} kind="del">
        {prefix}
        {change.oldValue}
      </DiffRow>
    );
  }

  // updated: red old row then green new row (token diffs only).
  const oldValue = change.oldValue ?? "";
  const newValue = change.newValue ?? "";
  return (
    <React.Fragment key={`${baseKey}-upd`}>
      <DiffRow kind="del">
        {prefix}
        {highlightedValue(oldValue, newValue)}
      </DiffRow>
      <DiffRow kind="add">
        {prefix}
        {highlightedValue(newValue, oldValue)}
      </DiffRow>
    </React.Fragment>
  );
}

interface DiffStatProps {
  variant: "add" | "mod" | "del";
  children: React.ReactNode;
}

/** A diffstat chunk: a colored square plus its count, GitHub-style. */
function DiffStat({ variant, children }: DiffStatProps): React.ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <span className={`varvar-diff-stat varvar-diff-stat-${variant}`} aria-hidden="true" />
      {children}
    </span>
  );
}

interface DiffListProps {
  diff: DiffResult;
}

/**
 * Renders the result of {@link DiffResult} as a GitHub-style unified diff: a
 * diffstat summary line plus a scrollable list of tinted rows. Additions are
 * green, removals red, and `updated` token changes appear as a red old row
 * followed by a green new row.
 */
export const DiffList: React.FC<DiffListProps> = ({ diff }) => {
  if (diff.changes.length === 0) {
    return <Text style={secondaryStyle}>No changes — the file is already up to date.</Text>;
  }

  const visible = diff.changes.slice(0, MAX_VISIBLE);
  const hidden = diff.changes.length - visible.length;

  return (
    <Flex direction="column" gap="2">
      <Text style={secondaryStyle}>
        <DiffStat variant="add">{diff.added} added</DiffStat>
        {" · "}
        <DiffStat variant="mod">{diff.updated} changed</DiffStat>
        {" · "}
        <DiffStat variant="del">{diff.removed} removed</DiffStat>
        {diff.isLineDiff ? " · line diff" : ""}
      </Text>
      <div className="varvar-diff varvar-scroll-thin" style={{ maxHeight: 200, overflowY: "auto" }}>
        {visible.map((change, index) =>
          renderChange(change, diff.isLineDiff, `${change.type}-${change.key}-${index}`),
        )}
        {hidden > 0 ? (
          <div className="varvar-diff-row">
            <span className="varvar-diff-gutter" aria-hidden="true" />
            <span className="varvar-diff-code" style={secondaryStyle}>
              …and {hidden} more change{hidden === 1 ? "" : "s"}.
            </span>
          </div>
        ) : null}
      </div>
    </Flex>
  );
};
