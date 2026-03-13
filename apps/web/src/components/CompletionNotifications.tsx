import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { useAppSettings } from "../appSettings";
import {
  shouldShowBackgroundSystemNotification,
  showSystemNotification,
} from "../lib/notifications";
import { isLatestTurnSettled } from "../session-logic";
import { useStore } from "../store";
import { toastManager } from "./ui/toast";

function buildCompletionKey(input: { turnId: string; completedAt: string }): string {
  return `${input.turnId}:${input.completedAt}`;
}

export function CompletionNotifications() {
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const seenCompletionKeysRef = useRef(new Map<string, string>());
  const initializedRef = useRef(false);

  const projectNamesById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name] as const)),
    [projects],
  );

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    const settledCompletionKeys = new Map<string, string>();
    const completedThreads = threads
      .map((thread) => {
        if (!thread.latestTurn?.turnId || !thread.latestTurn.completedAt) {
          return null;
        }
        if (!isLatestTurnSettled(thread.latestTurn, thread.session)) {
          return null;
        }

        return {
          thread,
          completionKey: buildCompletionKey({
            turnId: thread.latestTurn.turnId,
            completedAt: thread.latestTurn.completedAt,
          }),
          completedAtMs: Date.parse(thread.latestTurn.completedAt),
        };
      })
      .filter(
        (
          candidate,
        ): candidate is {
          thread: (typeof threads)[number];
          completionKey: string;
          completedAtMs: number;
        } => candidate !== null && Number.isFinite(candidate.completedAtMs),
      )
      .toSorted((left, right) => left.completedAtMs - right.completedAtMs);

    for (const { thread, completionKey } of completedThreads) {
      settledCompletionKeys.set(thread.id, completionKey);
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      seenCompletionKeysRef.current = settledCompletionKeys;
      return;
    }

    if (!settings.enableCompletionNotifications) {
      seenCompletionKeysRef.current = settledCompletionKeys;
      return;
    }

    for (const { thread, completionKey } of completedThreads) {
      if (seenCompletionKeysRef.current.get(thread.id) === completionKey) {
        continue;
      }

      const projectName = projectNamesById.get(thread.projectId);
      const description = projectName ? `${thread.title} in ${projectName}.` : thread.title;

      toastManager.add({
        type: "success",
        title: "Work finished",
        description,
      });

      if (shouldShowBackgroundSystemNotification()) {
        showSystemNotification({
          title: "Work finished",
          body: description,
          tag: `thread-completed:${thread.id}`,
          onClick: () => {
            window.focus();
            void navigate({
              to: "/$threadId",
              params: { threadId: thread.id },
            });
          },
        });
      }
    }

    seenCompletionKeysRef.current = settledCompletionKeys;
  }, [
    navigate,
    projectNamesById,
    settings.enableCompletionNotifications,
    threads,
    threadsHydrated,
  ]);

  return null;
}
