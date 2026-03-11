import { ProjectId, ThreadId } from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";
import { serverQueryKeys } from "./serverReactQuery";

export const linearQueryKeys = {
  all: ["linear"] as const,
  teams: () => ["linear", "teams"] as const,
  projectIssues: (projectId: string | null) => ["linear", "project-issues", projectId] as const,
  issue: (reference: string | null) => ["linear", "issue", reference] as const,
};

export const linearMutationKeys = {
  bindProject: (projectId: string | null) =>
    ["linear", "mutation", "bind-project", projectId] as const,
  importIssue: (projectId: string | null) =>
    ["linear", "mutation", "import-issue", projectId] as const,
  reportThread: (threadId: string | null) =>
    ["linear", "mutation", "report-thread", threadId] as const,
};

export function linearTeamsQueryOptions() {
  return queryOptions({
    queryKey: linearQueryKeys.teams(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.linear.listTeams();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function linearProjectIssuesQueryOptions(projectId: string | null) {
  return queryOptions({
    queryKey: linearQueryKeys.projectIssues(projectId),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!projectId) {
        throw new Error("Bound Linear issue browsing is unavailable.");
      }
      return api.linear.listProjectIssues({
        projectId: ProjectId.makeUnsafe(projectId),
        limit: 50,
      });
    },
    enabled: projectId !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function linearIssueQueryOptions(reference: string | null) {
  return queryOptions({
    queryKey: linearQueryKeys.issue(reference),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!reference) {
        throw new Error("Linear issue lookup is unavailable.");
      }
      return api.linear.getIssue({ reference });
    },
    enabled: reference !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function linearImportIssueMutationOptions(input: {
  projectId: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: linearMutationKeys.importIssue(input.projectId),
    mutationFn: async (reference: string) => {
      const api = ensureNativeApi();
      if (!input.projectId) {
        throw new Error("Linear issue import is unavailable.");
      }
      return api.linear.importIssue({
        projectId: ProjectId.makeUnsafe(input.projectId),
        reference,
        mode: "worktree",
        runtimeMode: "full-access",
        interactionMode: "default",
      });
    },
    onSettled: async () => {
      await input.queryClient.invalidateQueries({ queryKey: linearQueryKeys.all });
    },
  });
}

export function linearBindProjectMutationOptions(input: {
  projectId: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: linearMutationKeys.bindProject(input.projectId),
    mutationFn: async (payload: {
      teamId: string | null;
      teamKey: string | null;
      teamName: string | null;
    }) => {
      const api = ensureNativeApi();
      if (!input.projectId) {
        throw new Error("Linear project binding is unavailable.");
      }
      return api.server.setProjectLinearBinding({
        projectId: ProjectId.makeUnsafe(input.projectId),
        teamId: payload.teamId,
        teamKey: payload.teamKey,
        teamName: payload.teamName,
      });
    },
    onSettled: async () => {
      await Promise.all([
        input.queryClient.invalidateQueries({ queryKey: linearQueryKeys.all }),
        input.queryClient.invalidateQueries({
          queryKey: serverQueryKeys.projectLinearBinding(input.projectId),
        }),
      ]);
    },
  });
}

export function linearReportThreadMutationOptions(input: {
  threadId: string | null;
  queryClient: QueryClient;
}) {
  return mutationOptions({
    mutationKey: linearMutationKeys.reportThread(input.threadId),
    mutationFn: async (payload: { note?: string; stateId?: string }) => {
      const api = ensureNativeApi();
      if (!input.threadId) {
        throw new Error("Linear thread reporting is unavailable.");
      }
      return api.linear.reportThread({
        threadId: ThreadId.makeUnsafe(input.threadId),
        ...(payload.note && payload.note.trim().length > 0 ? { note: payload.note } : {}),
        ...(payload.stateId ? { stateId: payload.stateId } : {}),
      });
    },
    onSettled: async () => {
      await input.queryClient.invalidateQueries({ queryKey: linearQueryKeys.all });
    },
  });
}
