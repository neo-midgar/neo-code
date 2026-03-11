import { describe, expect, it } from "vitest";

import {
  buildPullRequestWorktreeBranchName,
  DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX,
  normalizePullRequestWorktreeBranchPrefix,
  sanitizeBranchFragment,
} from "./git";

describe("sanitizeBranchFragment", () => {
  it("falls back to update when sanitization removes the entire value", () => {
    expect(sanitizeBranchFragment("///")).toBe("update");
  });
});

describe("normalizePullRequestWorktreeBranchPrefix", () => {
  it("defaults to the built-in prefix when unset", () => {
    expect(normalizePullRequestWorktreeBranchPrefix(undefined)).toBe(
      DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX,
    );
  });

  it("sanitizes custom namespaces", () => {
    expect(normalizePullRequestWorktreeBranchPrefix(" Team Branches / Review ")).toBe(
      "team-branches/review",
    );
  });

  it("falls back to the default when the custom prefix is invalid", () => {
    expect(normalizePullRequestWorktreeBranchPrefix("///")).toBe(
      DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX,
    );
  });
});

describe("buildPullRequestWorktreeBranchName", () => {
  it("builds a prefixed PR worktree branch name", () => {
    expect(
      buildPullRequestWorktreeBranchName({
        prefix: "team/review",
        pullRequestNumber: 42,
        headBranch: "main",
      }),
    ).toBe("team/review/pr-42/main");
  });
});
