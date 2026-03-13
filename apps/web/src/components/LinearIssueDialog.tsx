import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  linearBindProjectMutationOptions,
  linearImportIssueMutationOptions,
  linearIssueQueryOptionsWithCredential,
  linearProjectIssuesQueryOptions,
  linearTeamsQueryOptions,
} from "~/lib/linearReactQuery";
import { serverProjectLinearBindingQueryOptions } from "~/lib/serverReactQuery";
import { normalizeLinearIssueReference } from "@t3tools/shared/linear";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";

interface LinearIssueDialogProps {
  open: boolean;
  projectId: string | null;
  projectName: string | null;
  initialReference?: string | null;
  onOpenChange: (open: boolean) => void;
  onImported: (threadId: string) => void;
}

const EMPTY_LINEAR_ISSUES: ReadonlyArray<{
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly state: { readonly id: string; readonly name: string; readonly type: string } | null;
  readonly teamName: string | null;
  readonly projectName: string | null;
  readonly updatedAt: string;
}> = [];

function getLinearTeamSelectionKey(input: { credentialId: string; teamId: string }): string {
  return `${input.credentialId}:${input.teamId}`;
}

function formatRelativeUpdatedAt(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function isCompletedLinearIssue(issue: { state: { type: string } | null }): boolean {
  return issue.state?.type.trim().toLowerCase() === "completed";
}

export function LinearIssueDialog({
  open,
  projectId,
  projectName,
  initialReference,
  onOpenChange,
  onImported,
}: LinearIssueDialogProps) {
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const manualReferenceInputRef = useRef<HTMLInputElement>(null);
  const [manualReference, setManualReference] = useState(initialReference ?? "");
  const [manualReferenceDirty, setManualReferenceDirty] = useState(false);
  const [issueSearch, setIssueSearch] = useState("");
  const [includeCompletedIssues, setIncludeCompletedIssues] = useState(false);
  const [selectedIssueIdentifier, setSelectedIssueIdentifier] = useState<string | null>(null);
  const [selectedTeamSelectionKey, setSelectedTeamSelectionKey] = useState("");
  const [bindingNotice, setBindingNotice] = useState<string | null>(null);

  const bindingQuery = useQuery(serverProjectLinearBindingQueryOptions(open ? projectId : null));
  const teamsQuery = useQuery({
    ...linearTeamsQueryOptions(),
    enabled: open,
  });
  const binding = bindingQuery.data ?? null;
  const projectIssuesQuery = useQuery({
    ...linearProjectIssuesQueryOptions(open && binding ? projectId : null),
    enabled: open && binding !== null && projectId !== null,
  });
  const importMutation = useMutation(linearImportIssueMutationOptions({ projectId, queryClient }));
  const bindMutation = useMutation(linearBindProjectMutationOptions({ projectId, queryClient }));
  const boundTeamSelectionKey = useMemo(
    () =>
      binding
        ? getLinearTeamSelectionKey({
            credentialId: binding.credentialId,
            teamId: binding.teamId,
          })
        : "",
    [binding],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setManualReference(initialReference ?? "");
    setManualReferenceDirty(false);
    setIssueSearch("");
    setIncludeCompletedIssues(false);
    setBindingNotice(null);
    const frame = window.requestAnimationFrame(() => {
      manualReferenceInputRef.current?.focus();
      manualReferenceInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [initialReference, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedTeamSelectionKey((current) => {
      if (current.length > 0) {
        return current;
      }
      return boundTeamSelectionKey;
    });
  }, [boundTeamSelectionKey, open]);

  const teams = teamsQuery.data?.teams ?? [];
  const selectedTeam =
    teams.find(
      (team) =>
        getLinearTeamSelectionKey({ credentialId: team.credentialId, teamId: team.id }) ===
        selectedTeamSelectionKey,
    ) ??
    (binding && boundTeamSelectionKey === selectedTeamSelectionKey
      ? {
          credentialId: binding.credentialId,
          credentialName: binding.credentialName,
          id: binding.teamId,
          key: binding.teamKey,
          name: binding.teamName,
        }
      : null);
  const selectedTeamLabel = selectedTeam
    ? `${selectedTeam.credentialName} · ${selectedTeam.key} · ${selectedTeam.name}`
    : null;

  const issueList = projectIssuesQuery.data?.issues ?? EMPTY_LINEAR_ISSUES;
  const filteredIssues = useMemo(() => {
    const normalizedSearch = issueSearch.trim().toLowerCase();
    return issueList.filter((issue) => {
      if (!includeCompletedIssues && isCompletedLinearIssue(issue)) {
        return false;
      }
      if (normalizedSearch.length === 0) {
        return true;
      }
      const haystack = [
        issue.identifier,
        issue.title,
        issue.description,
        issue.projectName ?? "",
        issue.state?.name ?? "",
      ]
        .join("\n")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [includeCompletedIssues, issueList, issueSearch]);

  useEffect(() => {
    if (!open || filteredIssues.length === 0 || normalizeLinearIssueReference(manualReference)) {
      return;
    }
    setSelectedIssueIdentifier((current) => {
      if (current && filteredIssues.some((issue) => issue.identifier === current)) {
        return current;
      }
      return filteredIssues[0]?.identifier ?? null;
    });
  }, [filteredIssues, manualReference, open]);

  const normalizedManualReference = normalizeLinearIssueReference(manualReference);
  const activeReference = normalizedManualReference ?? selectedIssueIdentifier;
  const activeCredentialId = selectedTeam?.credentialId ?? binding?.credentialId ?? null;
  const issueQuery = useQuery(
    linearIssueQueryOptionsWithCredential({
      reference: open ? activeReference : null,
      credentialId: activeCredentialId,
    }),
  );
  const liveIssue = issueQuery.data?.issue ?? null;

  const isBindingDirty =
    selectedTeamSelectionKey !== boundTeamSelectionKey &&
    (selectedTeamSelectionKey.length > 0 || binding !== null);
  const validationMessage =
    manualReferenceDirty && manualReference.trim().length > 0 && normalizedManualReference === null
      ? "Use a Linear issue URL or identifier like ABC-123."
      : null;
  const errorMessage =
    validationMessage ??
    (bindingQuery.error instanceof Error
      ? bindingQuery.error.message
      : teamsQuery.error instanceof Error
        ? teamsQuery.error.message
        : projectIssuesQuery.error instanceof Error
          ? projectIssuesQuery.error.message
          : issueQuery.error instanceof Error
            ? issueQuery.error.message
            : bindMutation.error instanceof Error
              ? bindMutation.error.message
              : importMutation.error instanceof Error
                ? importMutation.error.message
                : null);

  const canImport =
    projectId !== null &&
    activeReference !== null &&
    liveIssue !== null &&
    !issueQuery.isPending &&
    !importMutation.isPending &&
    !bindMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!importMutation.isPending && !bindMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Import Linear Issue</DialogTitle>
          <DialogDescription>
            Bind {projectName ?? "this project"} to a Linear workspace once, browse issues from that
            workspace, and import the selected issue into a dedicated worktree-backed thread.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <section className="space-y-3 rounded-xl border border-border/70 bg-muted/18 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-sm">Project Workspace Binding</p>
                <p className="text-muted-foreground text-xs">
                  Bind this project to a Linear team so you can browse issues directly.
                </p>
              </div>
              {binding ? (
                <Badge variant="outline" className="shrink-0">
                  {binding.credentialName} · {binding.teamKey}
                </Badge>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">Linear workspace</span>
                <Select
                  value={selectedTeamSelectionKey}
                  onValueChange={(value) => setSelectedTeamSelectionKey(value ?? "")}
                >
                  <SelectTrigger size="sm">
                    <SelectValue
                      placeholder={
                        teamsQuery.isPending ? "Loading workspaces..." : "Choose a Linear workspace"
                      }
                    >
                      {selectedTeamLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem
                        key={`${team.credentialId}:${team.id}`}
                        value={getLinearTeamSelectionKey({
                          credentialId: team.credentialId,
                          teamId: team.id,
                        })}
                      >
                        {team.credentialName} · {team.key} · {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!projectId || !selectedTeam || !isBindingDirty || bindMutation.isPending}
                onClick={async () => {
                  if (!selectedTeam) {
                    return;
                  }
                  const result = await bindMutation.mutateAsync({
                    credentialId: selectedTeam.credentialId,
                    credentialName: selectedTeam.credentialName,
                    teamId: selectedTeam.id,
                    teamKey: selectedTeam.key,
                    teamName: selectedTeam.name,
                  });
                  setBindingNotice(
                    result
                      ? `Bound this project to ${result.credentialName} · ${result.teamKey} · ${result.teamName}.`
                      : "Cleared the Linear workspace binding.",
                  );
                }}
              >
                {bindMutation.isPending
                  ? "Saving..."
                  : binding
                    ? "Update Binding"
                    : "Bind Workspace"}
              </Button>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!projectId || binding === null || bindMutation.isPending}
                onClick={async () => {
                  await bindMutation.mutateAsync({
                    credentialId: null,
                    credentialName: null,
                    teamId: null,
                    teamKey: null,
                    teamName: null,
                  });
                  setSelectedTeamSelectionKey("");
                  setSelectedIssueIdentifier(null);
                  setBindingNotice("Cleared the Linear workspace binding.");
                }}
              >
                Clear
              </Button>
            </div>

            {binding ? (
              <p className="text-muted-foreground text-xs">
                Current binding: {binding.credentialName} · {binding.teamKey} · {binding.teamName}
              </p>
            ) : null}
            {bindingNotice ? (
              <p className="text-muted-foreground text-xs">{bindingNotice}</p>
            ) : null}
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)]">
            <div className="space-y-3 rounded-xl border border-border/70 bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-sm">Workspace Issues</p>
                  <p className="text-muted-foreground text-xs">
                    {binding
                      ? `Showing recent issues from ${binding.credentialName} · ${binding.teamKey} · ${binding.teamName}.`
                      : "Bind a workspace to browse recent issues for this project."}
                  </p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant={includeCompletedIssues ? "outline" : "ghost"}
                  disabled={!binding}
                  onClick={() => setIncludeCompletedIssues((current) => !current)}
                >
                  {includeCompletedIssues ? "Hide completed" : "Show completed"}
                </Button>
              </div>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">Filter issues</span>
                <Input
                  className="font-sans text-sm"
                  value={issueSearch}
                  onChange={(event) => setIssueSearch(event.target.value)}
                  placeholder={
                    binding ? "Search by key, title, or description" : "Bind a workspace first"
                  }
                  disabled={!binding}
                  size="sm"
                />
              </label>

              <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/14 p-2">
                {projectIssuesQuery.isPending ? (
                  <div className="flex items-center gap-2 px-2 py-4 text-muted-foreground text-xs">
                    <Spinner className="size-3.5" />
                    Loading bound issues...
                  </div>
                ) : filteredIssues.length > 0 ? (
                  filteredIssues.map((issue) => {
                    const isSelected =
                      normalizedManualReference === null &&
                      selectedIssueIdentifier === issue.identifier;
                    return (
                      <button
                        key={issue.id}
                        type="button"
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? "border-primary/50 bg-primary/6"
                            : "border-transparent bg-background hover:border-border hover:bg-muted/30"
                        }`}
                        onClick={() => {
                          setManualReference("");
                          setManualReferenceDirty(false);
                          setSelectedIssueIdentifier(issue.identifier);
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {issue.identifier}
                            </p>
                            <p className="line-clamp-2 text-sm font-medium text-foreground">
                              {issue.title}
                            </p>
                            <p className="truncate text-muted-foreground text-xs">
                              {issue.state?.name ?? "No state"}
                              {issue.projectName ? ` · ${issue.projectName}` : ""}
                            </p>
                          </div>
                          <span className="shrink-0 text-muted-foreground text-[11px]">
                            {formatRelativeUpdatedAt(issue.updatedAt)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-2 py-4 text-muted-foreground text-xs">
                    {binding
                      ? includeCompletedIssues
                        ? "No issues matched the current filter."
                        : "No open issues matched the current filter."
                      : "No workspace is bound to this project yet."}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border/70 bg-background p-4">
              <div className="space-y-1">
                <p className="font-medium text-sm">Selected Issue</p>
                <p className="text-muted-foreground text-xs">
                  Paste a Linear URL/key to override the workspace selection, or import the selected
                  workspace issue directly.
                </p>
              </div>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">Manual issue (optional)</span>
                <Input
                  ref={manualReferenceInputRef}
                  className="font-sans text-sm"
                  placeholder="https://linear.app/team/issue/ABC-123 or ABC-123"
                  value={manualReference}
                  onChange={(event) => {
                    setBindingNotice(null);
                    setManualReferenceDirty(true);
                    setManualReference(event.target.value);
                  }}
                  size="sm"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }
                    event.preventDefault();
                    if (!canImport || !activeReference) {
                      return;
                    }
                    void importMutation
                      .mutateAsync({
                        reference: activeReference,
                        credentialId: activeCredentialId,
                        branchPrefix: settings.pullRequestWorktreeBranchPrefix,
                      })
                      .then((result) => {
                        onImported(result.threadId);
                        onOpenChange(false);
                      });
                  }}
                />
              </label>

              {issueQuery.isPending ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Spinner className="size-3.5" />
                  Loading issue details...
                </div>
              ) : liveIssue ? (
                <div className="space-y-3 rounded-xl border border-border/70 bg-muted/24 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {liveIssue.identifier}
                      </p>
                      <p className="line-clamp-2 text-sm font-medium text-foreground">
                        {liveIssue.title}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {liveIssue.teamName ?? "Unknown team"}
                        {liveIssue.projectName ? ` · ${liveIssue.projectName}` : ""}
                      </p>
                    </div>
                    {liveIssue.state?.name ? (
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {liveIssue.state.name}
                      </span>
                    ) : null}
                  </div>
                  <p className="line-clamp-8 whitespace-pre-wrap text-muted-foreground text-xs">
                    {liveIssue.description.trim().length > 0
                      ? liveIssue.description
                      : "No description provided."}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {liveIssue.comments.length} comment{liveIssue.comments.length === 1 ? "" : "s"}
                    {liveIssue.imageUrls.length > 0
                      ? ` · ${liveIssue.imageUrls.length} linked image${liveIssue.imageUrls.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/14 p-4 text-muted-foreground text-xs">
                  {binding
                    ? "Choose a workspace issue or paste a Linear issue reference."
                    : "Bind a workspace or paste a Linear issue reference to continue."}
                </div>
              )}
            </div>
          </section>

          {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={importMutation.isPending || bindMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              if (!activeReference || !canImport) {
                setManualReferenceDirty(true);
                return;
              }
              const result = await importMutation.mutateAsync({
                reference: activeReference,
                credentialId: activeCredentialId,
                branchPrefix: settings.pullRequestWorktreeBranchPrefix,
              });
              onImported(result.threadId);
              onOpenChange(false);
            }}
            disabled={!canImport}
          >
            {importMutation.isPending ? "Importing..." : "Import into new worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
