import { Effect, FileSystem, Layer, Path, Schema, ServiceMap } from "effect";

import { ServerConfig } from "./config";

interface PersistedServerSettings {
  readonly linearApiKey?: string;
  readonly linearProjectBindings?: Record<string, PersistedLinearProjectBinding>;
}

interface PersistedLinearProjectBinding {
  readonly teamId: string;
  readonly teamKey: string;
  readonly teamName: string;
  readonly updatedAt: string;
}

export interface LinearCredentialSummary {
  readonly configured: boolean;
  readonly source: "env" | "saved" | "none";
}

export interface ServerSettingsShape {
  readonly getLinearApiKey: () => Effect.Effect<string | null, ServerSettingsError>;
  readonly getLinearCredentialSummary: () => Effect.Effect<
    LinearCredentialSummary,
    ServerSettingsError
  >;
  readonly getLinearProjectBinding: (
    projectId: string,
  ) => Effect.Effect<LinearProjectBinding | null, ServerSettingsError>;
  readonly setLinearApiKey: (
    apiKey: string | null,
  ) => Effect.Effect<LinearCredentialSummary, ServerSettingsError>;
  readonly setLinearProjectBinding: (input: {
    readonly projectId: string;
    readonly teamId: string | null;
    readonly teamKey: string | null;
    readonly teamName: string | null;
  }) => Effect.Effect<LinearProjectBinding | null, ServerSettingsError>;
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

export interface LinearProjectBinding {
  readonly projectId: string;
  readonly teamId: string;
  readonly teamKey: string;
  readonly teamName: string;
  readonly updatedAt: string;
}

const emptySettings = (): PersistedServerSettings => ({});

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

const normalizeLinearProjectBinding = (input: {
  readonly projectId: string;
  readonly binding: PersistedLinearProjectBinding;
}): LinearProjectBinding | null => {
  const projectId = normalizeStoredString(input.projectId);
  const teamId = normalizeStoredString(input.binding.teamId);
  const teamKey = normalizeStoredString(input.binding.teamKey);
  const teamName = normalizeStoredString(input.binding.teamName);
  const updatedAt = ensureIsoTimestamp(input.binding.updatedAt);
  if (!projectId || !teamId || !teamKey || !teamName || !updatedAt) {
    return null;
  }

  return {
    projectId,
    teamId,
    teamKey,
    teamName,
    updatedAt,
  };
};

const summarizeCredentialSource = (savedKey: string | null): LinearCredentialSummary => {
  const envKey = normalizeStoredKey(process.env.LINEAR_API_KEY);
  if (envKey) {
    return { configured: true, source: "env" };
  }
  if (savedKey) {
    return { configured: true, source: "saved" };
  }
  return { configured: false, source: "none" };
};

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

      const linearApiKeyValue = (raw as Record<string, unknown>).linearApiKey;
      let normalizedKey: string | undefined;
      if (linearApiKeyValue !== undefined && typeof linearApiKeyValue !== "string") {
        return yield* new ServerSettingsError({
          operation: "readPersistedSettings",
          detail: "The saved Linear API key must be a string.",
        });
      }
      if (typeof linearApiKeyValue === "string") {
        normalizedKey = normalizeStoredKey(linearApiKeyValue) ?? undefined;
        if (!normalizedKey) {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "The saved Linear API key cannot be empty.",
          });
        }
        if (normalizedKey.length > 4096) {
          return yield* new ServerSettingsError({
            operation: "readPersistedSettings",
            detail: "The saved Linear API key is too long.",
          });
        }
      }

      const linearProjectBindingsValue = (raw as Record<string, unknown>).linearProjectBindings;
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
          if (!teamId || !teamKey || !teamName || !updatedAt) {
            return yield* new ServerSettingsError({
              operation: "readPersistedSettings",
              detail: `Saved Linear binding for project '${projectId}' is missing required fields.`,
            });
          }

          linearProjectBindings[projectId] = {
            teamId,
            teamKey,
            teamName,
            updatedAt,
          };
        }
      }

      return {
        ...(normalizedKey ? { linearApiKey: normalizedKey } : {}),
        ...(linearProjectBindings ? { linearProjectBindings } : {}),
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

  const getLinearCredentialSummary = (): Effect.Effect<
    LinearCredentialSummary,
    ServerSettingsError
  > =>
    Effect.gen(function* () {
      const savedKey = normalizeStoredKey((yield* readPersistedSettings()).linearApiKey);
      return summarizeCredentialSource(savedKey);
    });

  const getLinearApiKey = (): Effect.Effect<string | null, ServerSettingsError> =>
    Effect.gen(function* () {
      const envKey = normalizeStoredKey(process.env.LINEAR_API_KEY);
      if (envKey) {
        return envKey;
      }
      const persisted = yield* readPersistedSettings();
      return normalizeStoredKey(persisted.linearApiKey);
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

  const setLinearApiKey = (
    apiKey: string | null,
  ): Effect.Effect<LinearCredentialSummary, ServerSettingsError> =>
    Effect.gen(function* () {
      const normalizedKey = normalizeStoredKey(apiKey);
      if (normalizedKey && normalizedKey.length > 4096) {
        return yield* new ServerSettingsError({
          operation: "setLinearApiKey",
          detail: "The Linear API key is too long.",
        });
      }

      const persisted = yield* readPersistedSettings();
      const nextSettings: PersistedServerSettings = normalizedKey
        ? { ...persisted, linearApiKey: normalizedKey }
        : persisted.linearProjectBindings
          ? { linearProjectBindings: persisted.linearProjectBindings }
          : {};
      yield* writePersistedSettings(nextSettings);
      return summarizeCredentialSource(normalizedKey);
    });

  const setLinearProjectBinding = (input: {
    readonly projectId: string;
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

      const teamId = normalizeStoredString(input.teamId);
      const teamKey = normalizeStoredString(input.teamKey);
      const teamName = normalizeStoredString(input.teamName);
      const persisted = yield* readPersistedSettings();
      const existingBindings = { ...persisted.linearProjectBindings };

      if (!teamId && !teamKey && !teamName) {
        delete existingBindings[projectId];
        const nextSettings: PersistedServerSettings = {
          ...(persisted.linearApiKey ? { linearApiKey: persisted.linearApiKey } : {}),
          ...(Object.keys(existingBindings).length > 0
            ? { linearProjectBindings: existingBindings }
            : {}),
        };
        yield* writePersistedSettings(nextSettings);
        return null;
      }

      if (!teamId || !teamKey || !teamName) {
        return yield* new ServerSettingsError({
          operation: "setLinearProjectBinding",
          detail: "Team id, key, and name are required to bind a project.",
        });
      }

      const updatedAt = new Date().toISOString();
      const persistedBinding: PersistedLinearProjectBinding = {
        teamId,
        teamKey,
        teamName,
        updatedAt,
      };
      existingBindings[projectId] = persistedBinding;
      const nextSettings: PersistedServerSettings = {
        ...(persisted.linearApiKey ? { linearApiKey: persisted.linearApiKey } : {}),
        linearProjectBindings: existingBindings,
      };
      yield* writePersistedSettings(nextSettings);
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

  return {
    getLinearApiKey,
    getLinearCredentialSummary,
    getLinearProjectBinding,
    setLinearApiKey,
    setLinearProjectBinding,
  } satisfies ServerSettingsShape;
});

export const ServerSettingsLive = Layer.effect(ServerSettings, makeServerSettings);
