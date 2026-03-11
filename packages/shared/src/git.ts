export const DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX = "t3code";

function sanitizeBranchNamespace(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  return normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");
}

/**
 * Sanitize an arbitrary string into a valid, lowercase git branch fragment.
 * Strips quotes, collapses separators, limits to 64 chars.
 */
export function sanitizeBranchFragment(raw: string): string {
  const branchFragment = sanitizeBranchNamespace(raw);

  return branchFragment.length > 0 ? branchFragment : "update";
}

/**
 * Normalize the configurable namespace used for generated PR worktree branch names.
 */
export function normalizePullRequestWorktreeBranchPrefix(raw: string | null | undefined): string {
  const normalized = typeof raw === "string" ? sanitizeBranchNamespace(raw) : "";
  return normalized.length > 0 ? normalized : DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX;
}

/**
 * Build the local branch name used for a fork PR worktree checkout.
 */
export function buildPullRequestWorktreeBranchName(input: {
  prefix?: string | null | undefined;
  pullRequestNumber: number;
  headBranch: string;
}): string {
  const prefix = normalizePullRequestWorktreeBranchPrefix(input.prefix);
  const sanitizedHeadBranch = sanitizeBranchFragment(input.headBranch).trim();
  const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
  return `${prefix}/pr-${input.pullRequestNumber}/${suffix}`;
}

/**
 * Sanitize a string into a `feature/…` branch name.
 * Preserves an existing `feature/` prefix or slash-separated namespace.
 */
export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw);
  if (sanitized.includes("/")) {
    return sanitized.startsWith("feature/") ? sanitized : `feature/${sanitized}`;
  }
  return `feature/${sanitized}`;
}

const AUTO_FEATURE_BRANCH_FALLBACK = "feature/update";

/**
 * Resolve a unique `feature/…` branch name that doesn't collide with
 * any existing branch. Appends a numeric suffix when needed.
 */
export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK,
  );
  const existingNames = new Set(existingBranchNames.map((branch) => branch.toLowerCase()));

  if (!existingNames.has(resolvedBase)) {
    return resolvedBase;
  }

  let suffix = 2;
  while (existingNames.has(`${resolvedBase}-${suffix}`)) {
    suffix += 1;
  }

  return `${resolvedBase}-${suffix}`;
}
