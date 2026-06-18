/**
 * Helpers for generating safe git branch names and sensible default commit /
 * pull request copy for the "Push to GitHub" flow.
 */

/** Branch name prefix so Variform-created branches are easy to spot. */
export const BRANCH_PREFIX = "variform";

/**
 * Reduce an arbitrary string to a git-ref-safe slug.
 * Git refs disallow spaces, "..", and a set of special characters; we keep
 * lowercase alphanumerics plus `.`, `_`, and `-`, collapsing everything else.
 */
export function sanitizeBranchSegment(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return slug || "export";
}

/**
 * Build a default target branch name, e.g. "variform/my-doc-variables-k9x2".
 * `suffix` keeps successive pushes from colliding; callers pass a short unique
 * token (typically derived from the current time).
 */
export function defaultBranchName(filename: string, suffix: string): string {
  const slug = sanitizeBranchSegment(filename || "variables");
  const safeSuffix = sanitizeBranchSegment(suffix);
  return `${BRANCH_PREFIX}/${slug}-${safeSuffix}`;
}

/** Default commit message for an exported file. */
export function defaultCommitMessage(path: string): string {
  return `chore: update ${path} via Variform`;
}

/** Default pull request title for an exported file. */
export function defaultPrTitle(path: string): string {
  return `Update ${path}`;
}

/** Default pull request body. */
export function defaultPrBody(path: string): string {
  return `Updates \`${path}\` with Figma variables exported by Variform.`;
}
