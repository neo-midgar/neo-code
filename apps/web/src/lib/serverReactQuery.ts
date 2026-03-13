import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ProjectId } from "@t3tools/contracts";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  linearConfig: () => ["server", "linear-config"] as const,
  gitSettings: () => ["server", "git-settings"] as const,
  linearProjectBindings: () => ["server", "linear-project-bindings"] as const,
  projectLinearBinding: (projectId: string | null) =>
    ["server", "project-linear-binding", projectId] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function serverLinearConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.linearConfig(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getLinearConfig();
    },
    staleTime: Infinity,
  });
}

export function serverGitSettingsQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.gitSettings(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getGitSettings();
    },
    staleTime: Infinity,
  });
}

export function serverProjectLinearBindingQueryOptions(projectId: string | null) {
  return queryOptions({
    queryKey: serverQueryKeys.projectLinearBinding(projectId),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!projectId) {
        throw new Error("Project Linear binding lookup is unavailable.");
      }
      return api.server.getProjectLinearBinding({ projectId: ProjectId.makeUnsafe(projectId) });
    },
    enabled: projectId !== null,
    staleTime: 30_000,
  });
}

export function serverLinearProjectBindingsQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.linearProjectBindings(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getLinearProjectBindings();
    },
    staleTime: 30_000,
  });
}

export function serverSetGitSettingsMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["server", "mutation", "git-settings"] as const,
    mutationFn: async (payload: { pullRequestWorktreeBranchPrefix: string }) => {
      const api = ensureNativeApi();
      return api.server.setGitSettings(payload);
    },
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.gitSettings() });
    },
  });
}
