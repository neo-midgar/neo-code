import { Effect, Layer, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";

import { runProcess } from "../../processRunner";
import { GitHubCliError } from "../Errors.ts";
import {
  GitHubCli,
  type GitHubPullRequestCheck,
  type GitHubPullRequestReviewFinding,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
  type GitHubPullRequestSummary,
} from "../Services/GitHubCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeGitHubCliError(operation: "execute" | "stdout", error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token")
    ) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        cause: error,
      });
    }

    if (
      lower.includes("could not resolve to a pullrequest") ||
      lower.includes("repository.pullrequest") ||
      lower.includes("no pull requests found for branch") ||
      lower.includes("pull request not found")
    ) {
      return new GitHubCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        cause: error,
      });
    }

    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: "GitHub CLI command failed.",
    cause: error,
  });
}

function normalizePullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const mergedAt = input.mergedAt;
  const state = input.state;
  if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  return "open";
}

const RawGitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.String,
      }),
    ),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.String,
      }),
    ),
  ),
});

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

const GitHubPullRequestCheckBucket = Schema.Literals([
  "pass",
  "fail",
  "pending",
  "skipping",
  "cancel",
]);

const RawGitHubPullRequestCheckSchema = Schema.Struct({
  name: TrimmedNonEmptyString,
  state: Schema.String,
  bucket: GitHubPullRequestCheckBucket,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  link: Schema.optional(Schema.NullOr(Schema.String)),
  workflow: Schema.optional(Schema.NullOr(Schema.String)),
  event: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitHubPullRequestReviewDecisionSchema = Schema.Struct({
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitHubPullRequestReviewFindingSchema = Schema.Struct({
  id: PositiveInt,
  body: Schema.String,
  path: TrimmedNonEmptyString,
  line: Schema.optional(Schema.NullOr(PositiveInt)),
  html_url: TrimmedNonEmptyString,
  created_at: TrimmedNonEmptyString,
  updated_at: TrimmedNonEmptyString,
  in_reply_to_id: Schema.optional(Schema.NullOr(PositiveInt)),
  user: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: TrimmedNonEmptyString,
      }),
    ),
  ),
});

function normalizePullRequestSummary(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestSchema>,
): GitHubPullRequestSummary {
  const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null;
  const headRepositoryOwnerLogin =
    raw.headRepositoryOwner?.login ??
    (typeof headRepositoryNameWithOwner === "string" && headRepositoryNameWithOwner.includes("/")
      ? (headRepositoryNameWithOwner.split("/")[0] ?? null)
      : null);
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizePullRequestState(raw),
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

function normalizePullRequestCheck(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestCheckSchema>,
): GitHubPullRequestCheck {
  return {
    name: raw.name,
    state: raw.state,
    bucket: raw.bucket,
    description: raw.description ?? null,
    link: raw.link ?? null,
    workflow:
      typeof raw.workflow === "string" && raw.workflow.trim().length > 0 ? raw.workflow : null,
    event: typeof raw.event === "string" && raw.event.trim().length > 0 ? raw.event : null,
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
  };
}

function normalizePullRequestReviewFinding(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestReviewFindingSchema>,
): GitHubPullRequestReviewFinding | null {
  if (raw.in_reply_to_id !== undefined && raw.in_reply_to_id !== null) {
    return null;
  }
  const authorLogin = raw.user?.login?.trim() ?? "";
  if (authorLogin.length === 0) {
    return null;
  }
  const body = raw.body.trim();
  if (body.length === 0) {
    return null;
  }

  return {
    id: String(raw.id),
    authorLogin,
    authorName: null,
    body,
    path: raw.path,
    line: raw.line ?? null,
    url: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation:
    | "listOpenPullRequests"
    | "getPullRequest"
    | "getRepositoryCloneUrls"
    | "listPullRequestChecks"
    | "getPullRequestReviewDecision"
    | "listPullRequestReviewFindings",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
          cause: error,
        }),
    ),
  );
}

const makeGitHubCli = Effect.sync(() => {
  const execute: GitHubCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });

  const service = {
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : decodeGitHubJson(
                raw,
                Schema.Array(RawGitHubPullRequestSchema),
                "listOpenPullRequests",
                "GitHub CLI returned invalid PR list JSON.",
              ),
        ),
        Effect.map((pullRequests) => pullRequests.map(normalizePullRequestSummary)),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubPullRequestSchema,
            "getPullRequest",
            "GitHub CLI returned invalid pull request JSON.",
          ),
        ),
        Effect.map(normalizePullRequestSummary),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    listPullRequestChecks: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "checks",
          input.reference,
          "--json",
          "bucket,completedAt,description,event,link,name,startedAt,state,workflow",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : decodeGitHubJson(
                raw,
                Schema.Array(RawGitHubPullRequestCheckSchema),
                "listPullRequestChecks",
                "GitHub CLI returned invalid pull request checks JSON.",
              ),
        ),
        Effect.map((checks) => checks.map(normalizePullRequestCheck)),
      ),
    getPullRequestReviewDecision: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "view", input.reference, "--json", "reviewDecision"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubPullRequestReviewDecisionSchema,
            "getPullRequestReviewDecision",
            "GitHub CLI returned invalid pull request review decision JSON.",
          ),
        ),
        Effect.map((result) => {
          const reviewDecision = result.reviewDecision?.trim() ?? "";
          return reviewDecision.length > 0 ? reviewDecision : null;
        }),
      ),
    listPullRequestReviewFindings: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "api",
          `repos/${input.repository}/pulls/${input.number}/comments?per_page=${String(
            input.limit ?? 100,
          )}`,
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : decodeGitHubJson(
                raw,
                Schema.Array(RawGitHubPullRequestReviewFindingSchema),
                "listPullRequestReviewFindings",
                "GitHub CLI returned invalid pull request review comment JSON.",
              ),
        ),
        Effect.map((findings) =>
          findings
            .map(normalizePullRequestReviewFinding)
            .filter((finding): finding is GitHubPullRequestReviewFinding => finding !== null)
            .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
        ),
      ),
  } satisfies GitHubCliShape;

  return service;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
