import { Effect, FileSystem, Layer, Path, Schema, ServiceMap } from "effect";
import { normalizePullRequestWorktreeBranchPrefix } from "@t3tools/shared/git";

import { ServerConfig } from "./config";

const ENV_LINEAR_CREDENTIAL_ID = "env";
const ENV_LINEAR_CREDENTIAL_NAME = "Environment";
const LEGACY_LINEAR_CREDENTIAL_ID = "saved-default";
const LEGACY_LINEAR_CREDENTIAL_NAME = "Default";

interface PersistedServerSettings {
  readonly pullRequestWorktreeBranchPrefix?: string;
  readonly linearApiKey?: string;
  readonly linearCredentials?: Record<string, PersistedLinearCredential>;
  readonly linearProjectBindings?: Record<string, PersistedLinearProjectBinding>;
}

interface PersistedLinearCredential {
  readonly name: string;
  readonly apiKey: string;
  readonly updatedAt: string;
}

interface PersistedLinearProjectBinding {
  readonly credentialId?: string;
  readonly credentialName?: string;
  readonly teamId: string;
  readonly teamKey: string;
  readonly teamName: string;
  readonly updatedAt: string;
}

export interface LinearCredential {
  readonly id: string;
  readonly name: string;
  readonly source: "env" | "saved";
  readonly updatedAt: string | null;
}

export interface LinearConfig {
  readonly configured: boolean;
  readonly source: "env" | "saved" | "none";
  readonly credentials: ReadonlyArray<LinearCredential>;
}

export interface LinearProjectBinding {
  readonly projectId: string;
  readonly credentialId: string;
  readonly credentialName: string;
  readonly teamId: string;
  readonly teamKey: string;
  readonly teamName: string;
  readonly updatedAt: string;
}

export interface GitSettings {
  readonly pullRequestWorktreeBranchPrefix: string;
}

export interface ServerSettingsShape {
  readonly getGitSettings: () => Effect.Effect<GitSettings, ServerSettingsError>;
  readonly getLinearConfig: () => Effect.Effect<LinearConfig, ServerSettingsError>;
  readonly listLinearCredentials: () => Effect.Effect<
    ReadonlyArray<LinearCredential>,
    ServerSettingsError
  >;
  readonly resolveLinearApiKey: (
    credentialId?: string | null,
  ) => Effect.Effect<string | null, ServerSettingsError>;
  readonly listLinearProjectBindings: () => Effect.Effect<
    ReadonlyArray<LinearProjectBinding>,
    ServerSettingsError
  >;
  readonly getLinearProjectBinding: (
    projectId: string,
  ) => Effect.Effect<LinearProjectBinding | null, ServerSettingsError>;
  readonly upsertLinearCredential: (input: {
    readonly credentialId?: string | null | undefined;
    readonly name: string;
    readonly apiKey: string;
  }) => Effect.Effect<LinearConfig, ServerSettingsError>;
  readonly deleteLinearCredential: (
    credentialId: string,
  ) => Effect.Effect<LinearConfig, ServerSettingsError>;
  readonly setLinearProjectBinding: (input: {
    readonly projectId: string;
    readonly credentialId: string | null;
    readonly credentialName: string | null;
    readonly teamId: string | null;
    readonly teamKey: string | null;
    readonly teamName: string | null;
  }) => Effect.Effect<LinearProjectBinding | null, ServerSettingsError>;
  readonly setGitSettings: (input: {
    readonly pullRequestWorktreeBranchPrefix: string;
  }) => Effect.Effect<GitSettings, ServerSettingsError>;
}

export class ServerSettings extends ServiceMap.Service<ServerSettings, ServerSettingsShape>()(
  "t3/serverSettings",
) {}

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings failed in ${this.operation}: ${this.detail}`;
  }
}

const emptySettings = (): PersistedServerSettings => ({});
const DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX =
  normalizePullRequestWorktreeBranchPrefix("t3code");

const normalizeStoredKey = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeStoredString = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const ensureIsoTimestamp = (value: string): string | null => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
};

function sortLinearCredentials(
  credentials: ReadonlyArray<LinearCredential>,
): ReadonlyArray<LinearCredential> {
  return [...credentials].toSorted((left, right) => {
    if (left.source !== right.source) {
      return left.source === "env" ? -1 : 1;
    }
    const leftUpdatedAt = left.updatedAt ? Date.parse(left.updatedAt) : -1;
    const rightUpdatedAt = right.updatedAt ? Date.parse(right.updatedAt) : -1;
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }
    return left.name.localeCompare(right.name);
  });
}

function summarizeLinearConfig(credentials: ReadonlyArray<LinearCredential>): LinearConfig {
  const orderedCredentials = sortLinearCredentials(credentials);
  const hasEnvCredential = orderedCredentials.some((credential) => credential.source === "env");
  return {
    configured: orderedCredentials.length > 0,
    source: hasEnvCredential ? "env" : orderedCredentials.length > 0 ? "saved" : "none",
    credentials: orderedCredentials,
  };
}

const makeServerSettings = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const settingsPath = path.join(serverConfig.stateDir, "server-settings.json");

  const readPersistedSettings = (): Effect.Effect<PersistedServerSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const exists = yield* fileSystem.exists(settingsPath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return emptySettings();
      }

      const contents = yield* fileSystem.readFileString(settingsPath).pipe(
        Effect.mapError(
          (cause) =>
            new ServerSettingsError({
              operation: "readPersistedSettings",
              detail: "Failed to read server settings.",
              cause,
            }),
        ),
      );

      const raw = yield* Effect.try({
        try: () => JSON.parse(contents) as unknown,
        catch: (cause) =>
          new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "Server settings contain invalid JSON.",
            cause,
          }),
      });

      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return yield* new ServerSettingsError({
          operation: "readPersistedSettings",
          detail: "Server settings must be a JSON object.",
        });
      }

      const rawRecord = raw as Record<string, unknown>;
      const pullRequestWorktreeBranchPrefixValue = rawRecord.pullRequestWorktreeBranchPrefix;
      let pullRequestWorktreeBranchPrefix: string | null = null;
      if (pullRequestWorktreeBranchPrefixValue !== undefined) {
        if (typeof pullRequestWorktreeBranchPrefixValue !== "string") {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "The saved PR worktree branch prefix must be a string.",
          });
        }

        pullRequestWorktreeBranchPrefix = normalizePullRequestWorktreeBranchPrefix(
          pullRequestWorktreeBranchPrefixValue,
        );
      }

      const legacyLinearApiKeyValue = rawRecord.linearApiKey;
      let legacyLinearApiKey: string | null = null;
      if (legacyLinearApiKeyValue !== undefined) {
        if (typeof legacyLinearApiKeyValue !== "string") {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "The saved Linear API key must be a string.",
          });
        }

        legacyLinearApiKey = normalizeStoredKey(legacyLinearApiKeyValue);
        if (!legacyLinearApiKey) {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "The saved Linear API key cannot be empty.",
          });
        }
        if (legacyLinearApiKey.length > 4096) {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "The saved Linear API key is too long.",
          });
        }
      }

      const linearCredentialsValue = rawRecord.linearCredentials;
      let linearCredentials: Record<string, PersistedLinearCredential> | undefined;
      if (linearCredentialsValue !== undefined) {
        if (
          linearCredentialsValue === null ||
          typeof linearCredentialsValue !== "object" ||
          Array.isArray(linearCredentialsValue)
        ) {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "Saved Linear credentials must be a JSON object.",
          });
        }

        linearCredentials = {};
        for (const [credentialId, candidate] of Object.entries(linearCredentialsValue)) {
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            return yield* new ServerSettingsError({
              operation: "readPersistedSettings",
              detail: `Saved Linear credential '${credentialId}' is invalid.`,
            });
          }

          const candidateRecord = candidate as Record<string, unknown>;
          const name = normalizeStoredString(
            typeof candidateRecord.name === "string" ? candidateRecord.name : null,
          );
          const apiKey = normalizeStoredKey(
            typeof candidateRecord.apiKey === "string" ? candidateRecord.apiKey : null,
          );
          const updatedAt =
            typeof candidateRecord.updatedAt === "string"
              ? ensureIsoTimestamp(candidateRecord.updatedAt)
              : null;
          if (!name || !apiKey || !updatedAt) {
            return yield* new ServerSettingsError({
              operation: "readPersistedSettings",
              detail: `Saved Linear credential '${credentialId}' is missing required fields.`,
            });
          }

          linearCredentials[credentialId] = {
            name,
            apiKey,
            updatedAt,
          };
        }
      }

      if (
        legacyLinearApiKey &&
        (!linearCredentials || Object.keys(linearCredentials).length === 0)
      ) {
        linearCredentials = {
          [LEGACY_LINEAR_CREDENTIAL_ID]: {
            name: LEGACY_LINEAR_CREDENTIAL_NAME,
            apiKey: legacyLinearApiKey,
            updatedAt: new Date(0).toISOString(),
          },
        };
      }

      const normalizedCredentials = Object.entries(linearCredentials ?? {}).map(
        ([credentialId, credential]) => ({
          id: credentialId,
          name: credential.name,
        }),
      );

      const defaultBindingCredential =
        normalizedCredentials.length === 1
          ? normalizedCredentials[0]
          : normalizedCredentials.length === 0 && normalizeStoredKey(process.env.LINEAR_API_KEY)
            ? { id: ENV_LINEAR_CREDENTIAL_ID, name: ENV_LINEAR_CREDENTIAL_NAME }
            : null;

      const linearProjectBindingsValue = rawRecord.linearProjectBindings;
      let linearProjectBindings: Record<string, PersistedLinearProjectBinding> | undefined;
      if (linearProjectBindingsValue !== undefined) {
        if (
          linearProjectBindingsValue === null ||
          typeof linearProjectBindingsValue !== "object" ||
          Array.isArray(linearProjectBindingsValue)
        ) {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "Saved Linear project bindings must be a JSON object.",
          });
        }

        linearProjectBindings = {};
        for (const [projectId, candidate] of Object.entries(linearProjectBindingsValue)) {
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            return yield* new ServerSettingsError({
              operation: "readPersistedSettings",
              detail: `Saved Linear binding for project '${projectId}' is invalid.`,
            });
          }

          const candidateRecord = candidate as Record<string, unknown>;
          const credentialId = normalizeStoredString(
            typeof candidateRecord.credentialId === "string"
              ? candidateRecord.credentialId
              : defaultBindingCredential?.id,
          );
          const credentialName = normalizeStoredString(
            typeof candidateRecord.credentialName === "string"
              ? candidateRecord.credentialName
              : defaultBindingCredential?.name,
          );
          const teamId = normalizeStoredString(
            typeof candidateRecord.teamId === "string" ? candidateRecord.teamId : null,
          );
          const teamKey = normalizeStoredString(
            typeof candidateRecord.teamKey === "string" ? candidateRecord.teamKey : null,
          );
          const teamName = normalizeStoredString(
            typeof candidateRecord.teamName === "string" ? candidateRecord.teamName : null,
          );
          const updatedAt =
            typeof candidateRecord.updatedAt === "string"
              ? ensureIsoTimestamp(candidateRecord.updatedAt)
              : null;
          if (!credentialId || !credentialName || !teamId || !teamKey || !teamName || !updatedAt) {
            return yield* new ServerSettingsError({
              operation: "readPersistedSettings",
              detail: `Saved Linear binding for project '${projectId}' is missing required fields.`,
            });
          }

          linearProjectBindings[projectId] = {
            credentialId,
            credentialName,
            teamId,
            teamKey,
            teamName,
            updatedAt,
          };
        }
      }

      return {
        ...(pullRequestWorktreeBranchPrefix ? { pullRequestWorktreeBranchPrefix } : {}),
        ...(linearCredentials && Object.keys(linearCredentials).length > 0
          ? { linearCredentials }
          : {}),
        ...(linearProjectBindings && Object.keys(linearProjectBindings).length > 0
          ? { linearProjectBindings }
          : {}),
      };
    });

  const writePersistedSettings = (
    settings: PersistedServerSettings,
  ): Effect.Effect<void, ServerSettingsError> =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.dirname(settingsPath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ServerSettingsError({
              operation: "writePersistedSettings",
              detail: "Failed to prepare the server settings directory.",
              cause,
            }),
        ),
      );
      yield* fileSystem.writeFileString(settingsPath, JSON.stringify(settings, null, 2)).pipe(
        Effect.mapError(
          (cause) =>
            new ServerSettingsError({
              operation: "writePersistedSettings",
              detail: "Failed to persist server settings.",
              cause,
            }),
        ),
      );
    });

  const listLinearCredentials = (): Effect.Effect<
    ReadonlyArray<LinearCredential>,
    ServerSettingsError
  > =>
    Effect.gen(function* () {
      const persisted = yield* readPersistedSettings();
      const credentials: LinearCredential[] = [];
      const envKey = normalizeStoredKey(process.env.LINEAR_API_KEY);
      if (envKey) {
        credentials.push({
          id: ENV_LINEAR_CREDENTIAL_ID,
          name: ENV_LINEAR_CREDENTIAL_NAME,
          source: "env",
          updatedAt: null,
        });
      }

      for (const [credentialId, credential] of Object.entries(persisted.linearCredentials ?? {})) {
        credentials.push({
          id: credentialId,
          name: credential.name,
          source: "saved",
          updatedAt: credential.updatedAt,
        });
      }

      return sortLinearCredentials(credentials);
    });

  const getLinearConfig = (): Effect.Effect<LinearConfig, ServerSettingsError> =>
    listLinearCredentials().pipe(Effect.map((credentials) => summarizeLinearConfig(credentials)));

  const getGitSettings = (): Effect.Effect<GitSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const persisted = yield* readPersistedSettings();
      return {
        pullRequestWorktreeBranchPrefix:
          persisted.pullRequestWorktreeBranchPrefix ?? DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX,
      };
    });

  const resolveLinearApiKey = (
    credentialId?: string | null,
  ): Effect.Effect<string | null, ServerSettingsError> =>
    Effect.gen(function* () {
      const normalizedCredentialId = normalizeStoredString(credentialId);
      const envKey = normalizeStoredKey(process.env.LINEAR_API_KEY);

      if (normalizedCredentialId) {
        if (normalizedCredentialId === ENV_LINEAR_CREDENTIAL_ID) {
          return envKey;
        }
        const persisted = yield* readPersistedSettings();
        return normalizeStoredKey(persisted.linearCredentials?.[normalizedCredentialId]?.apiKey);
      }

      if (envKey) {
        return envKey;
      }

      const persisted = yield* readPersistedSettings();
      const fallbackCredential = Object.values(persisted.linearCredentials ?? {}).toSorted(
        (left, right) => right.updatedAt.localeCompare(left.updatedAt),
      )[0];
      return normalizeStoredKey(fallbackCredential?.apiKey);
    });

  const normalizeLinearProjectBinding = (input: {
    readonly projectId: string;
    readonly binding: PersistedLinearProjectBinding;
  }): LinearProjectBinding | null => {
    const projectId = normalizeStoredString(input.projectId);
    const credentialId = normalizeStoredString(input.binding.credentialId);
    const credentialName = normalizeStoredString(input.binding.credentialName);
    const teamId = normalizeStoredString(input.binding.teamId);
    const teamKey = normalizeStoredString(input.binding.teamKey);
    const teamName = normalizeStoredString(input.binding.teamName);
    const updatedAt = ensureIsoTimestamp(input.binding.updatedAt);
    if (
      !projectId ||
      !credentialId ||
      !credentialName ||
      !teamId ||
      !teamKey ||
      !teamName ||
      !updatedAt
    ) {
      return null;
    }

    return {
      projectId,
      credentialId,
      credentialName,
      teamId,
      teamKey,
      teamName,
      updatedAt,
    };
  };

  const listLinearProjectBindings = (): Effect.Effect<
    ReadonlyArray<LinearProjectBinding>,
    ServerSettingsError
  > =>
    Effect.gen(function* () {
      const persisted = yield* readPersistedSettings();
      return Object.entries(persisted.linearProjectBindings ?? {})
        .map(([projectId, binding]) => normalizeLinearProjectBinding({ projectId, binding }))
        .filter((binding): binding is LinearProjectBinding => binding !== null)
        .toSorted((left, right) => left.projectId.localeCompare(right.projectId));
    });

  const getLinearProjectBinding = (
    projectId: string,
  ): Effect.Effect<LinearProjectBinding | null, ServerSettingsError> =>
    Effect.gen(function* () {
      const normalizedProjectId = normalizeStoredString(projectId);
      if (!normalizedProjectId) {
        return yield* new ServerSettingsError({
          operation: "getLinearProjectBinding",
          detail: "Project id is required.",
        });
      }

      const persisted = yield* readPersistedSettings();
      const binding = persisted.linearProjectBindings?.[normalizedProjectId];
      if (!binding) {
        return null;
      }
      const normalizedBinding = normalizeLinearProjectBinding({
        projectId: normalizedProjectId,
        binding,
      });
      if (!normalizedBinding) {
        return yield* new ServerSettingsError({
          operation: "getLinearProjectBinding",
          detail: "Saved Linear binding for this project is invalid.",
        });
      }
      return normalizedBinding;
    });

  const upsertLinearCredential = (input: {
    readonly credentialId?: string | null | undefined;
    readonly name: string;
    readonly apiKey: string;
  }): Effect.Effect<LinearConfig, ServerSettingsError> =>
    Effect.gen(function* () {
      const credentialId = normalizeStoredString(input.credentialId) ?? crypto.randomUUID();
      if (credentialId === ENV_LINEAR_CREDENTIAL_ID) {
        return yield* new ServerSettingsError({
          operation: "upsertLinearCredential",
          detail: "The environment credential cannot be modified from Settings.",
        });
      }

      const name = normalizeStoredString(input.name);
      if (!name) {
        return yield* new ServerSettingsError({
          operation: "upsertLinearCredential",
          detail: "Credential name is required.",
        });
      }
      if (name.length > 128) {
        return yield* new ServerSettingsError({
          operation: "upsertLinearCredential",
          detail: "Credential name is too long.",
        });
      }

      const apiKey = normalizeStoredKey(input.apiKey);
      if (!apiKey) {
        return yield* new ServerSettingsError({
          operation: "upsertLinearCredential",
          detail: "Linear API key is required.",
        });
      }
      if (apiKey.length > 4096) {
        return yield* new ServerSettingsError({
          operation: "upsertLinearCredential",
          detail: "The Linear API key is too long.",
        });
      }

      const persisted = yield* readPersistedSettings();
      const updatedAt = new Date().toISOString();
      const nextCredentials = {
        ...persisted.linearCredentials,
        [credentialId]: {
          name,
          apiKey,
          updatedAt,
        },
      };
      const nextBindings = Object.fromEntries(
        Object.entries(persisted.linearProjectBindings ?? {}).map(([projectId, binding]) => [
          projectId,
          binding.credentialId === credentialId
            ? {
                ...binding,
                credentialName: name,
              }
            : binding,
        ]),
      );

      yield* writePersistedSettings({
        ...(persisted.pullRequestWorktreeBranchPrefix
          ? { pullRequestWorktreeBranchPrefix: persisted.pullRequestWorktreeBranchPrefix }
          : {}),
        ...(Object.keys(nextCredentials).length > 0 ? { linearCredentials: nextCredentials } : {}),
        ...(Object.keys(nextBindings).length > 0 ? { linearProjectBindings: nextBindings } : {}),
      });

      return yield* getLinearConfig();
    });

  const deleteLinearCredential = (
    credentialId: string,
  ): Effect.Effect<LinearConfig, ServerSettingsError> =>
    Effect.gen(function* () {
      const normalizedCredentialId = normalizeStoredString(credentialId);
      if (!normalizedCredentialId) {
        return yield* new ServerSettingsError({
          operation: "deleteLinearCredential",
          detail: "Credential id is required.",
        });
      }
      if (normalizedCredentialId === ENV_LINEAR_CREDENTIAL_ID) {
        return yield* new ServerSettingsError({
          operation: "deleteLinearCredential",
          detail: "The environment credential cannot be deleted from Settings.",
        });
      }

      const persisted = yield* readPersistedSettings();
      const nextCredentials = { ...persisted.linearCredentials };
      delete nextCredentials[normalizedCredentialId];

      const nextBindings = Object.fromEntries(
        Object.entries(persisted.linearProjectBindings ?? {}).filter(
          ([, binding]) => binding.credentialId !== normalizedCredentialId,
        ),
      );

      yield* writePersistedSettings({
        ...(persisted.pullRequestWorktreeBranchPrefix
          ? { pullRequestWorktreeBranchPrefix: persisted.pullRequestWorktreeBranchPrefix }
          : {}),
        ...(Object.keys(nextCredentials).length > 0 ? { linearCredentials: nextCredentials } : {}),
        ...(Object.keys(nextBindings).length > 0 ? { linearProjectBindings: nextBindings } : {}),
      });

      return yield* getLinearConfig();
    });

  const setLinearProjectBinding = (input: {
    readonly projectId: string;
    readonly credentialId: string | null;
    readonly credentialName: string | null;
    readonly teamId: string | null;
    readonly teamKey: string | null;
    readonly teamName: string | null;
  }): Effect.Effect<LinearProjectBinding | null, ServerSettingsError> =>
    Effect.gen(function* () {
      const projectId = normalizeStoredString(input.projectId);
      if (!projectId) {
        return yield* new ServerSettingsError({
          operation: "setLinearProjectBinding",
          detail: "Project id is required.",
        });
      }

      const credentialId = normalizeStoredString(input.credentialId);
      const credentialName = normalizeStoredString(input.credentialName);
      const teamId = normalizeStoredString(input.teamId);
      const teamKey = normalizeStoredString(input.teamKey);
      const teamName = normalizeStoredString(input.teamName);
      const persisted = yield* readPersistedSettings();
      const existingBindings = { ...persisted.linearProjectBindings };

      if (!credentialId && !credentialName && !teamId && !teamKey && !teamName) {
        delete existingBindings[projectId];
        yield* writePersistedSettings({
          ...(persisted.pullRequestWorktreeBranchPrefix
            ? { pullRequestWorktreeBranchPrefix: persisted.pullRequestWorktreeBranchPrefix }
            : {}),
          ...(persisted.linearCredentials && Object.keys(persisted.linearCredentials).length > 0
            ? { linearCredentials: persisted.linearCredentials }
            : {}),
          ...(Object.keys(existingBindings).length > 0
            ? { linearProjectBindings: existingBindings }
            : {}),
        });
        return null;
      }

      if (!credentialId || !credentialName || !teamId || !teamKey || !teamName) {
        return yield* new ServerSettingsError({
          operation: "setLinearProjectBinding",
          detail: "Credential, team id, key, and name are required to bind a project.",
        });
      }

      const credentials = yield* listLinearCredentials();
      if (!credentials.some((credential) => credential.id === credentialId)) {
        return yield* new ServerSettingsError({
          operation: "setLinearProjectBinding",
          detail: "The selected Linear credential is no longer available.",
        });
      }

      const updatedAt = new Date().toISOString();
      const persistedBinding: PersistedLinearProjectBinding = {
        credentialId,
        credentialName,
        teamId,
        teamKey,
        teamName,
        updatedAt,
      };
      existingBindings[projectId] = persistedBinding;
      yield* writePersistedSettings({
        ...(persisted.pullRequestWorktreeBranchPrefix
          ? { pullRequestWorktreeBranchPrefix: persisted.pullRequestWorktreeBranchPrefix }
          : {}),
        ...(persisted.linearCredentials && Object.keys(persisted.linearCredentials).length > 0
          ? { linearCredentials: persisted.linearCredentials }
          : {}),
        linearProjectBindings: existingBindings,
      });

      const normalizedBinding = normalizeLinearProjectBinding({
        projectId,
        binding: persistedBinding,
      });
      if (!normalizedBinding) {
        return yield* new ServerSettingsError({
          operation: "setLinearProjectBinding",
          detail: "Failed to normalize the saved Linear binding.",
        });
      }
      return normalizedBinding;
    });

  const setGitSettings = (input: {
    readonly pullRequestWorktreeBranchPrefix: string;
  }): Effect.Effect<GitSettings, ServerSettingsError> =>
    Effect.gen(function* () {
      const persisted = yield* readPersistedSettings();
      const pullRequestWorktreeBranchPrefix = normalizePullRequestWorktreeBranchPrefix(
        input.pullRequestWorktreeBranchPrefix,
      );

      yield* writePersistedSettings({
        ...(pullRequestWorktreeBranchPrefix !== DEFAULT_PULL_REQUEST_WORKTREE_BRANCH_PREFIX
          ? { pullRequestWorktreeBranchPrefix }
          : {}),
        ...(persisted.linearCredentials && Object.keys(persisted.linearCredentials).length > 0
          ? { linearCredentials: persisted.linearCredentials }
          : {}),
        ...(persisted.linearProjectBindings &&
        Object.keys(persisted.linearProjectBindings).length > 0
          ? { linearProjectBindings: persisted.linearProjectBindings }
          : {}),
      });

      return {
        pullRequestWorktreeBranchPrefix,
      };
    });

  return {
    getGitSettings,
    getLinearConfig,
    listLinearCredentials,
    resolveLinearApiKey,
    listLinearProjectBindings,
    getLinearProjectBinding,
    upsertLinearCredential,
    deleteLinearCredential,
    setLinearProjectBinding,
    setGitSettings,
  } satisfies ServerSettingsShape;
});

export const ServerSettingsLive = Layer.effect(ServerSettings, makeServerSettings);
