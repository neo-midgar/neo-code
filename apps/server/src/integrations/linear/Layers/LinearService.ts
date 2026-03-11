import path from "node:path";

import {
  CommandId,
  EventId,
  type LinearIssue,
  type LinearIssueSummary,
  type LinearTeam,
  MessageId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import {
  buildLinearIssueBranchName,
  LINEAR_THREAD_ACTIVITY_KIND,
  LINEAR_THREAD_REPORTED_ACTIVITY_KIND,
  normalizeLinearIssueReference,
} from "@t3tools/shared/linear";
import { Effect, FileSystem, Layer } from "effect";

import { persistImageAttachmentBytes } from "../../../chatAttachments.ts";
import { ServerConfig } from "../../../config.ts";
import { GitCore } from "../../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettings } from "../../../serverSettings.ts";
import { LinearIntegrationError } from "../Errors.ts";
import { LinearService, type LinearServiceShape } from "../Services/LinearService.ts";

interface LinearGraphqlResponse<TData> {
  readonly data?: TData;
  readonly errors?: ReadonlyArray<{ readonly message?: string }>;
}

interface LinearGraphqlIssueState {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

interface LinearGraphqlComment {
  readonly id: string;
  readonly body: string | null;
  readonly createdAt: string;
  readonly user: { readonly name: string | null } | null;
}

interface LinearGraphqlIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly state: LinearGraphqlIssueState | null;
  readonly team: {
    readonly name: string | null;
    readonly states: { readonly nodes: ReadonlyArray<LinearGraphqlIssueState> };
  } | null;
  readonly project: { readonly name: string | null } | null;
  readonly comments: { readonly nodes: ReadonlyArray<LinearGraphqlComment> };
}

interface LinearGraphqlIssueSummary {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly updatedAt: string;
  readonly state: LinearGraphqlIssueState | null;
  readonly team: { readonly name: string | null } | null;
  readonly project: { readonly name: string | null } | null;
}

interface LinearGraphqlTeam {
  readonly id: string;
  readonly key: string | null;
  readonly name: string | null;
}

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const MAX_IMPORTED_IMAGE_COUNT = 6;
const MAX_IMPORTED_COMMENT_COUNT = 8;
const MAX_REPORT_ASSISTANT_EXCERPT_CHARS = 2_000;
const LINEAR_HOST_SUFFIX = ".linear.app";
const LINEAR_ISSUE_QUERY = `
  query ResolveIssue($identifier: String!) {
    issue(id: $identifier) {
      id
      identifier
      title
      description
      url
      state {
        id
        name
        type
      }
      team {
        name
        states(first: 50) {
          nodes {
            id
            name
            type
          }
        }
      }
      project {
        name
      }
      comments(first: 25) {
        nodes {
          id
          body
          createdAt
          user {
            name
          }
        }
      }
    }
  }
`;

const LINEAR_TEAMS_QUERY = `
  query ListTeams {
    teams {
      nodes {
        id
        key
        name
      }
    }
  }
`;

const LINEAR_TEAM_ISSUES_QUERY = `
  query TeamIssues($teamId: String!, $first: Int!) {
    team(id: $teamId) {
      id
      issues(first: $first, orderBy: updatedAt) {
        nodes {
          id
          identifier
          title
          description
          url
          updatedAt
          state {
            id
            name
            type
          }
          team {
            name
          }
          project {
            name
          }
        }
      }
    }
  }
`;

const LINEAR_COMMENT_CREATE_MUTATION = `
  mutation CreateIssueComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment {
        id
        url
      }
    }
  }
`;

const LINEAR_ISSUE_UPDATE_MUTATION = `
  mutation UpdateIssueState($issueId: String!, $stateId: String!) {
    issueUpdate(id: $issueId, input: { stateId: $stateId }) {
      success
      issue {
        state {
          id
          name
          type
        }
      }
    }
  }
`;

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function dedupeStrings(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function extractImageUrls(text: string): string[] {
  const results: string[] = [];
  const markdownPattern = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi;
  const rawUrlPattern = /\bhttps?:\/\/[^\s<>"')]+/gi;

  for (const match of text.matchAll(markdownPattern)) {
    if (match[1]) {
      results.push(match[1]);
    }
  }

  for (const match of text.matchAll(rawUrlPattern)) {
    const url = match[0];
    if (!url) {
      continue;
    }
    const lower = url.toLowerCase();
    if (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".webp")
    ) {
      results.push(url);
    }
  }

  return dedupeStrings(results);
}

function mapIssue(issue: LinearGraphqlIssue): LinearIssue {
  const commentBodies = issue.comments.nodes.map((comment) => comment.body ?? "");
  const imageUrls = dedupeStrings(
    [issue.description ?? "", ...commentBodies].flatMap((entry) => extractImageUrls(entry)),
  );

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    url: issue.url,
    state: issue.state
      ? {
          id: issue.state.id,
          name: issue.state.name,
          type: issue.state.type,
        }
      : null,
    teamName: issue.team?.name?.trim() || null,
    projectName: issue.project?.name?.trim() || null,
    comments: issue.comments.nodes.map((comment) => ({
      id: comment.id,
      body: comment.body ?? "",
      userName: comment.user?.name?.trim() || null,
      createdAt: comment.createdAt,
    })),
    imageUrls,
    availableStates:
      issue.team?.states.nodes.map((state) => ({
        id: state.id,
        name: state.name,
        type: state.type,
      })) ?? [],
  };
}

function mapIssueSummary(issue: LinearGraphqlIssueSummary): LinearIssueSummary {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    url: issue.url,
    state: issue.state
      ? {
          id: issue.state.id,
          name: issue.state.name,
          type: issue.state.type,
        }
      : null,
    teamName: issue.team?.name?.trim() || null,
    projectName: issue.project?.name?.trim() || null,
    updatedAt: issue.updatedAt,
  };
}

function mapTeam(
  team: LinearGraphqlTeam,
  credential: { readonly id: string; readonly name: string },
): LinearTeam | null {
  const id = team.id.trim();
  const key = team.key?.trim() ?? "";
  const name = team.name?.trim() ?? "";
  if (id.length === 0 || key.length === 0 || name.length === 0) {
    return null;
  }
  return {
    id,
    key,
    name,
    credentialId: credential.id,
    credentialName: credential.name,
  };
}

function buildIssueImportPrompt(issue: LinearIssue): string {
  const sections = [
    `You are working on Linear issue ${issue.identifier}: ${issue.title}`,
    `Issue URL: ${issue.url}`,
  ];

  if (issue.state?.name) {
    sections.push(`Current state: ${issue.state.name}`);
  }

  if (issue.description.trim().length > 0) {
    sections.push(`Description:\n${issue.description.trim()}`);
  } else {
    sections.push("Description: No description was provided.");
  }

  if (issue.comments.length > 0) {
    const renderedComments = issue.comments
      .slice(0, MAX_IMPORTED_COMMENT_COUNT)
      .map((comment) => {
        const author = comment.userName ?? "Unknown user";
        const body = comment.body.trim().length > 0 ? comment.body.trim() : "(empty comment)";
        return `- ${author} (${comment.createdAt}): ${body}`;
      })
      .join("\n");
    sections.push(`Recent comments:\n${renderedComments}`);
  }

  sections.push(
    [
      "Task:",
      "Investigate and fix the issue in this workspace.",
      "Keep the branch/worktree isolated to this issue.",
      "When the fix is complete, summarize the root cause and the implemented change clearly so it can be reported back to Linear.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

function pickFileNameFromUrl(url: string, fallbackBase: string, index: number): string {
  try {
    const parsed = new URL(url);
    const baseName = path.basename(parsed.pathname).trim();
    if (baseName.length > 0) {
      return baseName;
    }
  } catch {
    // Ignore malformed URLs here; the fetch step will fail later if needed.
  }
  return `${fallbackBase}-image-${index + 1}.png`;
}

function shouldSendLinearAuthHeader(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "linear.app" || hostname.endsWith(LINEAR_HOST_SUFFIX);
  } catch {
    return false;
  }
}

function resolveUniqueBranchName(
  existingBranches: ReadonlyArray<string>,
  desiredBranch: string,
): string {
  if (!existingBranches.includes(desiredBranch)) {
    return desiredBranch;
  }

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = `${desiredBranch}-${suffix}`;
    if (!existingBranches.includes(candidate)) {
      return candidate;
    }
  }

  return `${desiredBranch}-${crypto.randomUUID().slice(0, 8)}`;
}

const makeLinearService = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const git = yield* GitCore;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const fileSystem = yield* FileSystem.FileSystem;
  const serverSettings = yield* ServerSettings;

  const ensureLinearApiKey = Effect.fn(function* (credentialId?: string | null) {
    const apiKey = yield* serverSettings.resolveLinearApiKey(credentialId).pipe(
      Effect.mapError(
        (error) =>
          new LinearIntegrationError({
            operation: "auth",
            detail: error.message,
            cause: error,
          }),
      ),
    );
    if (!apiKey) {
      return yield* Effect.fail(
        new LinearIntegrationError({
          operation: "auth",
          detail:
            "Configure a Linear API key in Settings or set LINEAR_API_KEY before using the Linear integration.",
        }),
      );
    }
    return apiKey;
  });

  const requestGraphql = Effect.fn(function* <TData>(input: {
    readonly operation: string;
    readonly query: string;
    readonly variables: Record<string, unknown>;
    readonly credentialId?: string | null | undefined;
  }) {
    const apiKey = yield* ensureLinearApiKey(input.credentialId);
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(LINEAR_GRAPHQL_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: apiKey,
          },
          body: JSON.stringify({
            query: input.query,
            variables: input.variables,
          }),
        }),
      catch: (cause) =>
        new LinearIntegrationError({
          operation: input.operation,
          detail: "Failed to reach Linear.",
          cause,
        }),
    });

    const json = (yield* Effect.tryPromise({
      try: () => response.json() as Promise<LinearGraphqlResponse<TData>>,
      catch: (cause) =>
        new LinearIntegrationError({
          operation: input.operation,
          detail: "Linear returned an unreadable response.",
          cause,
        }),
    })) as LinearGraphqlResponse<TData>;

    if (!response.ok) {
      const detail =
        json.errors
          ?.map((entry) => entry.message)
          .filter(Boolean)
          .join("; ") || `HTTP ${response.status}`;
      return yield* Effect.fail(
        new LinearIntegrationError({
          operation: input.operation,
          detail,
        }),
      );
    }

    if (json.errors && json.errors.length > 0) {
      return yield* Effect.fail(
        new LinearIntegrationError({
          operation: input.operation,
          detail: json.errors
            .map((entry) => entry.message)
            .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
            .join("; "),
        }),
      );
    }

    if (!json.data) {
      return yield* Effect.fail(
        new LinearIntegrationError({
          operation: input.operation,
          detail: "Linear returned no data.",
        }),
      );
    }

    return json.data;
  });

  const loadIssue = Effect.fn(function* (reference: string, credentialId?: string | null) {
    const identifier = normalizeLinearIssueReference(reference);
    if (!identifier) {
      return yield* Effect.fail(
        new LinearIntegrationError({
          operation: "getIssue",
          detail: "Use a Linear issue URL or identifier like ABC-123.",
        }),
      );
    }

    const result = yield* requestGraphql<{
      readonly issue: LinearGraphqlIssue | null;
    }>({
      operation: "getIssue",
      query: LINEAR_ISSUE_QUERY,
      variables: { identifier },
      credentialId,
    });

    const issue = result.issue;
    if (!issue) {
      return yield* Effect.fail(
        new LinearIntegrationError({
          operation: "getIssue",
          detail: `Linear issue '${identifier}' was not found.`,
        }),
      );
    }

    return mapIssue(issue);
  });

  const listTeams: LinearServiceShape["listTeams"] = () =>
    Effect.gen(function* () {
      const credentials = yield* serverSettings.listLinearCredentials().pipe(
        Effect.mapError(
          (error) =>
            new LinearIntegrationError({
              operation: "listTeams",
              detail: error.message,
              cause: error,
            }),
        ),
      );
      if (credentials.length === 0) {
        yield* ensureLinearApiKey();
      }

      const results = yield* Effect.forEach(
        credentials,
        (credential) =>
          requestGraphql<{
            readonly teams: { readonly nodes: ReadonlyArray<LinearGraphqlTeam> };
          }>({
            operation: "listTeams",
            query: LINEAR_TEAMS_QUERY,
            variables: {},
            credentialId: credential.id,
          }).pipe(
            Effect.map((result) =>
              result.teams.nodes
                .map((team) => mapTeam(team, credential))
                .filter((team): team is LinearTeam => team !== null),
            ),
            Effect.catch(() => Effect.succeed([])),
          ),
        { concurrency: 1 },
      );

      return {
        teams: results
          .flat()
          .toSorted((left, right) =>
            `${left.credentialName}:${left.key}`.localeCompare(
              `${right.credentialName}:${right.key}`,
            ),
          ),
      };
    });

  const listProjectIssues: LinearServiceShape["listProjectIssues"] = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const project = snapshot.projects.find(
        (entry) => entry.id === input.projectId && entry.deletedAt === null,
      );
      if (!project) {
        return yield* Effect.fail(
          new LinearIntegrationError({
            operation: "listProjectIssues",
            detail: "Project not found.",
          }),
        );
      }

      const binding = yield* serverSettings.getLinearProjectBinding(project.id).pipe(
        Effect.mapError(
          (error) =>
            new LinearIntegrationError({
              operation: "listProjectIssues",
              detail: error.message,
              cause: error,
            }),
        ),
      );
      if (!binding) {
        return yield* Effect.fail(
          new LinearIntegrationError({
            operation: "listProjectIssues",
            detail: "Bind this project to a Linear workspace before browsing issues.",
          }),
        );
      }

      const result = yield* requestGraphql<{
        readonly team: {
          readonly id: string;
          readonly issues: { readonly nodes: ReadonlyArray<LinearGraphqlIssueSummary> };
        } | null;
      }>({
        operation: "listProjectIssues",
        query: LINEAR_TEAM_ISSUES_QUERY,
        variables: {
          teamId: binding.teamId,
          first: input.limit,
        },
        credentialId: binding.credentialId,
      });

      if (!result.team) {
        return yield* Effect.fail(
          new LinearIntegrationError({
            operation: "listProjectIssues",
            detail: `The bound Linear workspace '${binding.teamKey}' could not be found.`,
          }),
        );
      }

      return {
        issues: result.team.issues.nodes.map(mapIssueSummary),
      };
    });

  const importIssueAttachments = Effect.fn(function* (input: {
    readonly threadId: ThreadId;
    readonly issue: LinearIssue;
  }) {
    const apiKey = yield* ensureLinearApiKey();

    return yield* Effect.forEach(
      input.issue.imageUrls.slice(0, MAX_IMPORTED_IMAGE_COUNT),
      (url, index) =>
        Effect.gen(function* () {
          const headers =
            shouldSendLinearAuthHeader(url) && apiKey.length > 0
              ? { Authorization: apiKey }
              : undefined;
          const response = yield* Effect.tryPromise({
            try: () => fetch(url, { headers }),
            catch: (cause) =>
              new LinearIntegrationError({
                operation: "importIssueAttachments.fetch",
                detail: `Failed to fetch '${url}'.`,
                cause,
              }),
          });
          if (!response.ok) {
            return null;
          }

          const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
          if (!mimeType.startsWith("image/")) {
            return null;
          }

          const bytes = new Uint8Array(
            yield* Effect.tryPromise({
              try: () => response.arrayBuffer(),
              catch: (cause) =>
                new LinearIntegrationError({
                  operation: "importIssueAttachments.readBytes",
                  detail: `Failed to read image bytes for '${url}'.`,
                  cause,
                }),
            }),
          );
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            return null;
          }

          const attachment = yield* persistImageAttachmentBytes({
            threadId: input.threadId,
            name: pickFileNameFromUrl(url, input.issue.identifier.toLowerCase(), index),
            mimeType,
            bytes,
            stateDir: serverConfig.stateDir,
            fileSystem,
          }).pipe(Effect.catch(() => Effect.succeed(null)));

          return attachment;
        }).pipe(Effect.catch(() => Effect.succeed(null))),
      { concurrency: 1 },
    ).pipe(Effect.map((attachments) => attachments.filter((entry) => entry !== null)));
  });

  const wrapDispatchError = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new LinearIntegrationError({
            operation,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      ),
    );

  const appendThreadActivity = Effect.fn(function* (input: {
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
    readonly turnId?: TurnId | null;
  }) {
    const createdAt = new Date().toISOString();
    return yield* wrapDispatchError(
      "appendThreadActivity",
      orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe(`server:linear:${crypto.randomUUID()}`),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: "info",
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: input.turnId ?? null,
          createdAt,
        },
        createdAt,
      }),
    );
  });

  const getIssue: LinearServiceShape["getIssue"] = (input) =>
    loadIssue(input.reference, input.credentialId).pipe(Effect.map((issue) => ({ issue })));

  const importIssue: LinearServiceShape["importIssue"] = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const project = snapshot.projects.find(
        (entry) => entry.id === input.projectId && entry.deletedAt === null,
      );
      if (!project) {
        return yield* Effect.fail(
          new LinearIntegrationError({
            operation: "importIssue",
            detail: "Project not found.",
          }),
        );
      }

      const binding = yield* serverSettings.getLinearProjectBinding(project.id).pipe(
        Effect.mapError(
          (error) =>
            new LinearIntegrationError({
              operation: "importIssue",
              detail: error.message,
              cause: error,
            }),
        ),
      );
      const credentialId = input.credentialId ?? binding?.credentialId ?? null;
      const credentialName = binding?.credentialName ?? null;
      const issue = yield* loadIssue(input.reference, credentialId);
      let branch: string | null = null;
      let worktreePath: string | null = null;

      if (input.mode === "worktree") {
        const branches = yield* git.listBranches({ cwd: project.workspaceRoot });
        const defaultBranch =
          branches.branches.find((entry) => entry.isDefault && !entry.isRemote)?.name ??
          branches.branches.find((entry) => entry.isDefault)?.name ??
          null;
        if (!defaultBranch) {
          return yield* Effect.fail(
            new LinearIntegrationError({
              operation: "importIssue",
              detail: "Could not determine the repository default branch for this project.",
            }),
          );
        }

        const localBranches = yield* git.listLocalBranchNames(project.workspaceRoot);
        const requestedBranch = buildLinearIssueBranchName({
          prefix: input.branchPrefix,
          identifier: issue.identifier,
          title: issue.title,
        });
        branch = resolveUniqueBranchName(localBranches, requestedBranch);
        const worktree = yield* git.createWorktree({
          cwd: project.workspaceRoot,
          branch: defaultBranch,
          newBranch: branch,
          path: null,
        });
        worktreePath = worktree.worktree.path;
      }

      const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
      const createdAt = new Date().toISOString();
      const attachments = yield* importIssueAttachments({
        threadId,
        issue,
      });
      const model = project.defaultModel ?? "gpt-5-codex";
      const title = `${issue.identifier} ${issue.title}`;

      yield* wrapDispatchError(
        "importIssue.threadCreate",
        orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId,
          projectId: project.id,
          title,
          model,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          branch,
          worktreePath,
          createdAt,
        }),
      );

      yield* appendThreadActivity({
        threadId,
        kind: LINEAR_THREAD_ACTIVITY_KIND,
        summary: `Linked Linear issue ${issue.identifier}`,
        payload: {
          issue,
          credentialId,
          credentialName,
          importedAt: createdAt,
        },
      });

      yield* wrapDispatchError(
        "importIssue.turnStart",
        orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId,
          message: {
            messageId: MessageId.makeUnsafe(crypto.randomUUID()),
            role: "user",
            text: buildIssueImportPrompt(issue),
            attachments,
          },
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          createdAt,
        }),
      );

      return {
        threadId,
        branch,
        worktreePath,
        issue,
      };
    });

  const reportThread: LinearServiceShape["reportThread"] = (input) =>
    Effect.gen(function* () {
      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const thread = snapshot.threads.find(
        (entry) => entry.id === input.threadId && entry.deletedAt === null,
      );
      if (!thread) {
        return yield* Effect.fail(
          new LinearIntegrationError({
            operation: "reportThread",
            detail: "Thread not found.",
          }),
        );
      }

      const linkedActivity = thread.activities
        .toReversed()
        .find((activity) => activity.kind === LINEAR_THREAD_ACTIVITY_KIND);
      const linkedIssueId =
        linkedActivity &&
        typeof linkedActivity.payload === "object" &&
        linkedActivity.payload !== null &&
        "issue" in linkedActivity.payload &&
        typeof (linkedActivity.payload as { issue?: { id?: unknown } }).issue?.id === "string"
          ? (linkedActivity.payload as { issue: { id: string; identifier: string } }).issue.id
          : null;
      const linkedIssueIdentifier =
        linkedActivity &&
        typeof linkedActivity.payload === "object" &&
        linkedActivity.payload !== null &&
        "issue" in linkedActivity.payload &&
        typeof (linkedActivity.payload as { issue?: { identifier?: unknown } }).issue
          ?.identifier === "string"
          ? (linkedActivity.payload as { issue: { id: string; identifier: string } }).issue
              .identifier
          : null;

      if (!linkedIssueId || !linkedIssueIdentifier) {
        return yield* Effect.fail(
          new LinearIntegrationError({
            operation: "reportThread",
            detail: "This thread is not linked to a Linear issue.",
          }),
        );
      }

      const linkedCredentialId =
        linkedActivity &&
        typeof linkedActivity.payload === "object" &&
        linkedActivity.payload !== null &&
        "credentialId" in linkedActivity.payload &&
        typeof (linkedActivity.payload as { credentialId?: unknown }).credentialId === "string"
          ? (linkedActivity.payload as { credentialId: string }).credentialId
          : null;
      const binding = yield* serverSettings
        .getLinearProjectBinding(thread.projectId)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const credentialId = linkedCredentialId ?? binding?.credentialId ?? null;

      const issue = yield* loadIssue(linkedIssueIdentifier, credentialId);
      const gitCwd =
        thread.worktreePath ??
        snapshot.projects.find((entry) => entry.id === thread.projectId)?.workspaceRoot ??
        null;
      const gitStatus = gitCwd
        ? yield* git.status({ cwd: gitCwd }).pipe(Effect.catch(() => Effect.succeed(null)))
        : null;
      const latestAssistantMessage = thread.messages
        .toReversed()
        .find((message) => message.role === "assistant" && message.streaming === false);

      const reportLines = [
        `Update from T3 Code thread "${thread.title}"`,
        "",
        `Linear issue: ${issue.identifier} - ${issue.title}`,
        ...(thread.branch ? [`Branch: \`${thread.branch}\``] : []),
        ...(thread.worktreePath ? [`Worktree: \`${thread.worktreePath}\``] : []),
        ...(gitStatus?.pr?.url ? [`Pull request: ${gitStatus.pr.url}`] : []),
      ];

      const assistantExcerpt = latestAssistantMessage?.text.trim() ?? "";
      if (assistantExcerpt.length > 0) {
        reportLines.push(
          "",
          "Latest assistant summary:",
          truncate(assistantExcerpt, MAX_REPORT_ASSISTANT_EXCERPT_CHARS),
        );
      }

      const trimmedNote = input.note?.trim() ?? "";
      if (trimmedNote.length > 0) {
        reportLines.push("", "Operator note:", trimmedNote);
      }

      const commentCreate = yield* requestGraphql<{
        readonly commentCreate: {
          readonly success: boolean;
          readonly comment: { readonly id: string; readonly url: string | null } | null;
        };
      }>({
        operation: "reportThread.commentCreate",
        query: LINEAR_COMMENT_CREATE_MUTATION,
        variables: {
          issueId: linkedIssueId,
          body: reportLines.join("\n"),
        },
        credentialId,
      });

      const createdComment = commentCreate.commentCreate.comment;
      if (!commentCreate.commentCreate.success || !createdComment) {
        return yield* Effect.fail(
          new LinearIntegrationError({
            operation: "reportThread",
            detail: "Linear did not confirm comment creation.",
          }),
        );
      }

      let nextState = issue.state;
      if (input.stateId) {
        const stateUpdate = yield* requestGraphql<{
          readonly issueUpdate: {
            readonly success: boolean;
            readonly issue: { readonly state: LinearGraphqlIssueState | null } | null;
          };
        }>({
          operation: "reportThread.issueUpdate",
          query: LINEAR_ISSUE_UPDATE_MUTATION,
          variables: {
            issueId: linkedIssueId,
            stateId: input.stateId,
          },
          credentialId,
        });

        if (!stateUpdate.issueUpdate.success) {
          return yield* Effect.fail(
            new LinearIntegrationError({
              operation: "reportThread",
              detail: "Linear did not confirm the issue state update.",
            }),
          );
        }

        nextState = stateUpdate.issueUpdate.issue?.state
          ? {
              id: stateUpdate.issueUpdate.issue.state.id,
              name: stateUpdate.issueUpdate.issue.state.name,
              type: stateUpdate.issueUpdate.issue.state.type,
            }
          : null;
      }

      yield* appendThreadActivity({
        threadId: thread.id,
        kind: LINEAR_THREAD_REPORTED_ACTIVITY_KIND,
        summary: `Posted update to Linear issue ${issue.identifier}`,
        payload: {
          issue: {
            ...issue,
            state: nextState,
          },
          commentId: createdComment.id,
          commentUrl: createdComment.url,
          reportedAt: new Date().toISOString(),
        },
      });

      return {
        issue: {
          ...issue,
          state: nextState,
        },
        commentId: createdComment.id,
        commentUrl: createdComment.url,
        state: nextState,
      };
    });

  return {
    listTeams,
    listProjectIssues,
    getIssue,
    importIssue,
    reportThread,
  } satisfies LinearServiceShape;
});

export const LinearServiceLive = Layer.effect(LinearService, makeLinearService);
