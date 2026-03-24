import type { GitStatusResult } from "@t3tools/contracts";

import type { Thread } from "../types";

type ThreadGitTracking = Pick<Thread, "branch" | "worktreePath">;

export interface ThreadGitTarget {
  branch: string | null;
  cwd: string | null;
}

export function resolveThreadGitTarget(
  thread: ThreadGitTracking,
  projectCwd: string | null,
): ThreadGitTarget {
  return {
    branch: thread.branch,
    cwd: thread.worktreePath ?? projectCwd ?? null,
  };
}

export function resolveTrackedPullRequest(input: {
  threadBranch: string | null;
  status: Pick<GitStatusResult, "branch" | "pr"> | null | undefined;
}): GitStatusResult["pr"] {
  if (!input.threadBranch || !input.status?.branch || input.status.branch !== input.threadBranch) {
    return null;
  }

  return input.status.pr ?? null;
}
