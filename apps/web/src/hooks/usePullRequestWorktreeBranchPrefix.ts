import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useAppSettings } from "../appSettings";
import {
  serverGitSettingsQueryOptions,
  serverQueryKeys,
  serverSetGitSettingsMutationOptions,
} from "../lib/serverReactQuery";

export function usePullRequestWorktreeBranchPrefix() {
  const { settings, defaults, updateSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const serverGitSettingsQuery = useQuery(serverGitSettingsQueryOptions());
  const setGitSettingsMutation = useMutation(serverSetGitSettingsMutationOptions({ queryClient }));
  const attemptedMigrationRef = useRef(false);

  const serverBranchPrefix = serverGitSettingsQuery.data?.pullRequestWorktreeBranchPrefix ?? null;
  const branchPrefix = serverBranchPrefix ?? settings.pullRequestWorktreeBranchPrefix;

  useEffect(() => {
    if (!serverBranchPrefix) {
      return;
    }
    if (serverBranchPrefix === settings.pullRequestWorktreeBranchPrefix) {
      return;
    }
    updateSettings({
      pullRequestWorktreeBranchPrefix: serverBranchPrefix,
    });
  }, [serverBranchPrefix, settings.pullRequestWorktreeBranchPrefix, updateSettings]);

  useEffect(() => {
    if (attemptedMigrationRef.current) {
      return;
    }
    if (!serverGitSettingsQuery.isSuccess) {
      return;
    }
    if (serverBranchPrefix !== defaults.pullRequestWorktreeBranchPrefix) {
      return;
    }
    if (settings.pullRequestWorktreeBranchPrefix === defaults.pullRequestWorktreeBranchPrefix) {
      return;
    }

    attemptedMigrationRef.current = true;
    void setGitSettingsMutation
      .mutateAsync({
        pullRequestWorktreeBranchPrefix: settings.pullRequestWorktreeBranchPrefix,
      })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: serverQueryKeys.gitSettings(),
        }),
      )
      .catch(() => {
        attemptedMigrationRef.current = false;
      });
  }, [
    defaults.pullRequestWorktreeBranchPrefix,
    queryClient,
    serverBranchPrefix,
    serverGitSettingsQuery.isSuccess,
    setGitSettingsMutation,
    settings.pullRequestWorktreeBranchPrefix,
  ]);

  return {
    branchPrefix,
    isLoading: serverGitSettingsQuery.isLoading,
    isSaving: setGitSettingsMutation.isPending,
  } as const;
}
