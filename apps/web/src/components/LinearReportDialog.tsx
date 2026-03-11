import type { LinearIssue } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  linearIssueQueryOptionsWithCredential,
  linearReportThreadMutationOptions,
} from "~/lib/linearReactQuery";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
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
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";

interface LinearReportDialogProps {
  open: boolean;
  threadId: string | null;
  linkedIssue: LinearIssue | null;
  linkedCredentialId?: string | null;
  onOpenChange: (open: boolean) => void;
  onReported?: (result: { commentUrl: string | null }) => void;
}

const KEEP_CURRENT_STATE = "__keep_current_state__";

export function LinearReportDialog({
  open,
  threadId,
  linkedIssue,
  linkedCredentialId,
  onOpenChange,
  onReported,
}: LinearReportDialogProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [stateId, setStateId] = useState("");
  const issueQuery = useQuery(
    linearIssueQueryOptionsWithCredential({
      reference: open ? (linkedIssue?.identifier ?? null) : null,
      credentialId: linkedCredentialId ?? null,
    }),
  );
  const reportMutation = useMutation(linearReportThreadMutationOptions({ threadId, queryClient }));
  const issue = issueQuery.data?.issue ?? linkedIssue;
  const currentStateId = issue?.state?.id ?? KEEP_CURRENT_STATE;

  useEffect(() => {
    if (!open) {
      return;
    }
    setNote("");
    setStateId(currentStateId);
  }, [currentStateId, open]);

  const selectableStates = useMemo(() => issue?.availableStates ?? [], [issue?.availableStates]);
  const errorMessage =
    issueQuery.error instanceof Error
      ? issueQuery.error.message
      : reportMutation.error instanceof Error
        ? reportMutation.error.message
        : reportMutation.error
          ? "Failed to report back to Linear."
          : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!reportMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Report Back to Linear</DialogTitle>
          <DialogDescription>
            Post an update to {issue?.identifier ?? "the linked issue"} and optionally move it to a
            new workflow state.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {issue ? (
            <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
              <p className="truncate font-medium text-sm">
                {issue.identifier} · {issue.title}
              </p>
              <p className="truncate text-muted-foreground text-xs">
                {issue.state?.name ?? "No current state"}
              </p>
            </div>
          ) : null}

          {issueQuery.isPending ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Loading issue workflow states...
            </div>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Operator note (optional)</span>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Anything you want included in the update comment."
              size="sm"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">New state (optional)</span>
            <Select
              value={stateId}
              onValueChange={(value) => setStateId(value ?? KEEP_CURRENT_STATE)}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Keep current state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP_CURRENT_STATE}>Keep current state</SelectItem>
                {selectableStates.map((state) => (
                  <SelectItem key={state.id} value={state.id}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={reportMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              const result = await reportMutation.mutateAsync({
                ...(note.trim().length > 0 ? { note } : {}),
                ...(stateId !== KEEP_CURRENT_STATE && stateId !== currentStateId
                  ? { stateId }
                  : {}),
              });
              onReported?.({ commentUrl: result.commentUrl });
              onOpenChange(false);
            }}
            disabled={!threadId || !issue || reportMutation.isPending}
          >
            {reportMutation.isPending ? "Reporting..." : "Post update"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
