/**
 * GitHubCli - Effect service contract for `gh` process interactions.
 *
 * Provides thin command execution helpers used by Git workflow orchestration.
 *
 * @module GitHubCli
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProcessRunResult } from "../../processRunner";
import type { GitHubCliError } from "../Errors.ts";

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubPullRequestCheck {
  readonly name: string;
  readonly state: string;
  readonly bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
  readonly description: string | null;
  readonly link: string | null;
  readonly workflow: string | null;
  readonly event: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface GitHubPullRequestReviewFinding {
  readonly id: string;
  readonly authorLogin: string;
  readonly authorName: string | null;
  readonly body: string;
  readonly path: string;
  readonly line: number | null;
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

/**
 * GitHubCliShape - Service API for executing GitHub CLI commands.
 */
export interface GitHubCliShape {
  /**
   * Execute a GitHub CLI command and return full process output.
   */
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, GitHubCliError>;

  /**
   * List open pull requests for a head branch.
   */
  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  /**
   * Resolve a pull request by URL, number, or branch-ish identifier.
   */
  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  /**
   * Resolve clone URLs for a GitHub repository.
   */
  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  /**
   * Create a pull request from branch context and body file.
   */
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Resolve repository default branch through GitHub metadata.
   */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  /**
   * Checkout a pull request into the current repository worktree.
   */
  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * List current status checks for a pull request.
   */
  readonly listPullRequestChecks: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestCheck>, GitHubCliError>;

  /**
   * Resolve the aggregate review decision for a pull request.
   */
  readonly getPullRequestReviewDecision: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  /**
   * List unresolved code review findings left on a pull request.
   */
  readonly listPullRequestReviewFindings: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly number: number;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestReviewFinding>, GitHubCliError>;
}

/**
 * GitHubCli - Service tag for GitHub CLI process execution.
 */
export class GitHubCli extends ServiceMap.Service<GitHubCli, GitHubCliShape>()(
  "t3/git/Services/GitHubCli",
) {}
