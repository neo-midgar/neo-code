import type { GitStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveThreadGitTarget, resolveTrackedPullRequest } from "./threadPullRequest";

describe("resolveThreadGitTarget", () => {
  it("falls back to the project cwd when the thread has no worktree", () => {
    expect(
      resolveThreadGitTarget(
        {
          branch: "feature/pr-card",
          worktreePath: null,
        },
        "/repo/project",
      ),
    ).toEqual({
      branch: "feature/pr-card",
      cwd: "/repo/project",
    });
  });

  it("prefers the thread worktree path when present", () => {
    expect(
      resolveThreadGitTarget(
        {
          branch: "feature/pr-card",
          worktreePath: "/repo/project/.worktrees/pr-card",
        },
        "/repo/project",
      ),
    ).toEqual({
      branch: "feature/pr-card",
      cwd: "/repo/project/.worktrees/pr-card",
    });
  });
});

describe("resolveTrackedPullRequest", () => {
  const pr = {
    number: 42,
    title: "Fix PR card tracking",
    url: "https://github.com/t3tools/neo-code/pull/42",
    baseBranch: "main",
    headBranch: "feature/pr-card",
    state: "open",
  } satisfies NonNullable<GitStatusResult["pr"]>;

  it("hides pull requests when the thread is not attached to a branch", () => {
    expect(
      resolveTrackedPullRequest({
        threadBranch: null,
        status: {
          branch: "feature/pr-card",
          pr,
        },
      }),
    ).toBeNull();
  });

  it("hides pull requests when git status is for a different branch", () => {
    expect(
      resolveTrackedPullRequest({
        threadBranch: "feature/other",
        status: {
          branch: "feature/pr-card",
          pr,
        },
      }),
    ).toBeNull();
  });

  it("returns the pull request when git status matches the tracked branch", () => {
    expect(
      resolveTrackedPullRequest({
        threadBranch: "feature/pr-card",
        status: {
          branch: "feature/pr-card",
          pr,
        },
      }),
    ).toEqual(pr);
  });
});
