import { Schema } from "effect";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ProviderInteractionMode, RuntimeMode } from "./orchestration";

export const LinearIssueReference = TrimmedNonEmptyString;
export type LinearIssueReference = typeof LinearIssueReference.Type;

export const LinearWorkflowMode = Schema.Literals(["local", "worktree"]);
export type LinearWorkflowMode = typeof LinearWorkflowMode.Type;

export const LinearIssueState = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  type: Schema.String,
});
export type LinearIssueState = typeof LinearIssueState.Type;

export const LinearIssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  body: Schema.String,
  userName: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type LinearIssueComment = typeof LinearIssueComment.Type;

export const LinearIssue = Schema.Struct({
  id: TrimmedNonEmptyString,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  url: Schema.String,
  state: Schema.NullOr(LinearIssueState),
  teamName: Schema.NullOr(TrimmedNonEmptyString),
  projectName: Schema.NullOr(TrimmedNonEmptyString),
  comments: Schema.Array(LinearIssueComment),
  imageUrls: Schema.Array(Schema.String),
  availableStates: Schema.Array(LinearIssueState),
});
export type LinearIssue = typeof LinearIssue.Type;

export const LinearTeam = Schema.Struct({
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type LinearTeam = typeof LinearTeam.Type;

export const LinearIssueSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  identifier: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  url: Schema.String,
  state: Schema.NullOr(LinearIssueState),
  teamName: Schema.NullOr(TrimmedNonEmptyString),
  projectName: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type LinearIssueSummary = typeof LinearIssueSummary.Type;

export const LinearGetIssueInput = Schema.Struct({
  reference: LinearIssueReference,
});
export type LinearGetIssueInput = typeof LinearGetIssueInput.Type;

export const LinearGetIssueResult = Schema.Struct({
  issue: LinearIssue,
});
export type LinearGetIssueResult = typeof LinearGetIssueResult.Type;

export const LinearListTeamsResult = Schema.Struct({
  teams: Schema.Array(LinearTeam),
});
export type LinearListTeamsResult = typeof LinearListTeamsResult.Type;

export const LinearListProjectIssuesInput = Schema.Struct({
  projectId: ProjectId,
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(100)).pipe(
    Schema.withDecodingDefault(() => 50),
  ),
});
export type LinearListProjectIssuesInput = typeof LinearListProjectIssuesInput.Type;

export const LinearListProjectIssuesResult = Schema.Struct({
  issues: Schema.Array(LinearIssueSummary),
});
export type LinearListProjectIssuesResult = typeof LinearListProjectIssuesResult.Type;

export const LinearImportIssueInput = Schema.Struct({
  projectId: ProjectId,
  reference: LinearIssueReference,
  mode: LinearWorkflowMode.pipe(Schema.withDecodingDefault(() => "worktree")),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => "full-access")),
  interactionMode: ProviderInteractionMode.pipe(Schema.withDecodingDefault(() => "default")),
});
export type LinearImportIssueInput = typeof LinearImportIssueInput.Type;

export const LinearImportIssueResult = Schema.Struct({
  threadId: ThreadId,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  issue: LinearIssue,
});
export type LinearImportIssueResult = typeof LinearImportIssueResult.Type;

export const LinearReportThreadInput = Schema.Struct({
  threadId: ThreadId,
  note: Schema.optional(Schema.String),
  stateId: Schema.optional(TrimmedNonEmptyString),
});
export type LinearReportThreadInput = typeof LinearReportThreadInput.Type;

export const LinearReportThreadResult = Schema.Struct({
  issue: LinearIssue,
  commentId: TrimmedNonEmptyString,
  commentUrl: Schema.NullOr(Schema.String),
  state: Schema.NullOr(LinearIssueState),
});
export type LinearReportThreadResult = typeof LinearReportThreadResult.Type;
