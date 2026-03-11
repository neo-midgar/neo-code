import { Schema } from "effect";
import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ProviderKind } from "./orchestration";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderStatusState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderStatusState = typeof ServerProviderStatusState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderStatus = typeof ServerProviderStatus.Type;

const ServerProviderStatuses = Schema.Array(ServerProviderStatus);

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
  availableEditors: Schema.Array(EditorId),
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerLinearCredentialSource = Schema.Literals(["env", "saved", "none"]);
export type ServerLinearCredentialSource = typeof ServerLinearCredentialSource.Type;

export const ServerLinearCredential = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  source: Schema.Literals(["env", "saved"]),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ServerLinearCredential = typeof ServerLinearCredential.Type;

export const ServerLinearConfig = Schema.Struct({
  configured: Schema.Boolean,
  source: ServerLinearCredentialSource,
  credentials: Schema.Array(ServerLinearCredential),
});
export type ServerLinearConfig = typeof ServerLinearConfig.Type;

export const ServerUpsertLinearCredentialInput = Schema.Struct({
  credentialId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  apiKey: Schema.String.check(Schema.isMaxLength(4096)),
});
export type ServerUpsertLinearCredentialInput = typeof ServerUpsertLinearCredentialInput.Type;

export const ServerDeleteLinearCredentialInput = Schema.Struct({
  credentialId: TrimmedNonEmptyString,
});
export type ServerDeleteLinearCredentialInput = typeof ServerDeleteLinearCredentialInput.Type;

export const ServerLinearProjectBinding = Schema.Struct({
  projectId: ProjectId,
  credentialId: TrimmedNonEmptyString,
  credentialName: TrimmedNonEmptyString,
  teamId: TrimmedNonEmptyString,
  teamKey: TrimmedNonEmptyString,
  teamName: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type ServerLinearProjectBinding = typeof ServerLinearProjectBinding.Type;

export const ServerGetProjectLinearBindingInput = Schema.Struct({
  projectId: ProjectId,
});
export type ServerGetProjectLinearBindingInput = typeof ServerGetProjectLinearBindingInput.Type;

export const ServerSetProjectLinearBindingInput = Schema.Struct({
  projectId: ProjectId,
  credentialId: Schema.NullOr(TrimmedNonEmptyString),
  credentialName: Schema.NullOr(TrimmedNonEmptyString),
  teamId: Schema.NullOr(TrimmedNonEmptyString),
  teamKey: Schema.NullOr(TrimmedNonEmptyString),
  teamName: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerSetProjectLinearBindingInput = typeof ServerSetProjectLinearBindingInput.Type;

export const ServerGetLinearProjectBindingsResult = Schema.Struct({
  bindings: Schema.Array(ServerLinearProjectBinding),
});
export type ServerGetLinearProjectBindingsResult = typeof ServerGetLinearProjectBindingsResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;
