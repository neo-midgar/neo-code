import type { GitObservePullRequestResult, GitPullRequestReviewFinding } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo } from "react";

import { gitObservePullRequestQueryOptions, gitStatusQueryOptions } from "~/lib/gitReactQuery";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

function summarizeCheckBuckets(checks: GitObservePullRequestResult["checks"]) {
  return checks.reduce(
    (summary, check) => {
      summary[check.bucket] += 1;
      return summary;
    },
    { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 },
  );
}

function formatFindingLocation(finding: GitPullRequestReviewFinding): string {
  return finding.line ? `${finding.path}:${finding.line}` : finding.path;
}

function isBotFinding(finding: GitPullRequestReviewFinding): boolean {
  return (
    finding.authorLogin.toLowerCase().includes("bot") ||
    finding.authorLogin.toLowerCase().includes("coderabbit")
  );
}

function getReviewDecisionTone(reviewDecision: string | null): {
  label: string;
  className: string;
} | null {
  switch (reviewDecision) {
    case "APPROVED":
      return { label: "Approved", className: "text-emerald-700" };
    case "CHANGES_REQUESTED":
      return { label: "Changes requested", className: "text-amber-700" };
    case "REVIEW_REQUIRED":
      return { label: "Review required", className: "text-muted-foreground" };
    default:
      return null;
  }
}

interface PullRequestObserverCardProps {
  gitCwd: string | null;
  onOpenUrl: (url: string) => void;
  onFixFinding: (input: {
    finding: GitPullRequestReviewFinding;
    observation: GitObservePullRequestResult;
  }) => void;
}

export function PullRequestObserverCard({
  gitCwd,
  onOpenUrl,
  onFixFinding,
}: PullRequestObserverCardProps) {
  const gitStatusQuery = useQuery(gitStatusQueryOptions(gitCwd));
  const openPr = gitStatusQuery.data?.pr?.state === "open" ? gitStatusQuery.data.pr : null;
  const observationQuery = useQuery({
    ...gitObservePullRequestQueryOptions({
      cwd: gitCwd,
      reference: openPr?.url ?? null,
    }),
    enabled: gitCwd !== null && openPr !== null,
  });

  const observation = observationQuery.data ?? null;
  const visibleFindings = useMemo(() => {
    const findings = observation?.findings ?? [];
    return findings.toSorted(
      (left, right) => Number(isBotFinding(right)) - Number(isBotFinding(left)),
    );
  }, [observation?.findings]);

  if (!gitCwd || !openPr) {
    return null;
  }

  const errorMessage =
    gitStatusQuery.error instanceof Error
      ? gitStatusQuery.error.message
      : observationQuery.error instanceof Error
        ? observationQuery.error.message
        : null;

  const checkSummary = observation ? summarizeCheckBuckets(observation.checks) : null;
  const reviewDecisionTone = getReviewDecisionTone(observation?.reviewDecision ?? null);

  return (
    <div className="border-b border-border/80 bg-muted/12 px-3 py-3 sm:px-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-xl border border-border/70 bg-background/92 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="gap-1.5"
            onClick={() => onOpenUrl(openPr.url)}
          >
            <span>PR #{openPr.number}</span>
            <ExternalLinkIcon className="size-3 opacity-70" />
          </Button>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {openPr.title}
          </span>
          {reviewDecisionTone ? (
            <Badge variant="outline" className={reviewDecisionTone.className}>
              {reviewDecisionTone.label}
            </Badge>
          ) : null}
          {observationQuery.isFetching ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
              <LoaderCircleIcon className="size-3 animate-spin" />
              Watching checks
            </span>
          ) : null}
        </div>

        {observationQuery.isPending ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Spinner className="size-3.5" />
            Loading pull request status...
          </div>
        ) : null}

        {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}

        {observation ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-emerald-700">
                <CheckCircle2Icon className="size-3" />
                {checkSummary?.pass ?? 0} passing
              </Badge>
              <Badge variant="outline" className="gap-1 text-amber-700">
                <LoaderCircleIcon className="size-3" />
                {checkSummary?.pending ?? 0} pending
              </Badge>
              <Badge variant="outline" className="gap-1 text-red-700">
                <XCircleIcon className="size-3" />
                {checkSummary?.fail ?? 0} failing
              </Badge>
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <AlertCircleIcon className="size-3" />
                {observation.findings.length} review finding
                {observation.findings.length === 1 ? "" : "s"}
              </Badge>
            </div>

            {observation.checks.length > 0 ? (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 bg-muted/14 p-2">
                {observation.checks.map((check) => (
                  <div
                    key={`${check.name}:${check.workflow ?? "none"}`}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{check.name}</p>
                      <p className="truncate text-muted-foreground text-xs">
                        {check.workflow ?? check.event ?? check.state}
                        {check.description ? ` · ${check.description}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{check.bucket}</Badge>
                      {check.link ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => onOpenUrl(check.link!)}
                        >
                          Open
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {visibleFindings.length > 0 ? (
              <div className="flex max-h-52 flex-col gap-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/14 p-2">
                {visibleFindings.map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-lg border border-border/60 bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {formatFindingLocation(finding)}
                          </p>
                          <Badge variant="outline" className="gap-1">
                            {isBotFinding(finding) ? <BotIcon className="size-3" /> : null}
                            {finding.authorLogin}
                          </Badge>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-muted-foreground text-xs">
                          {finding.body}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => onFixFinding({ finding, observation })}
                        >
                          Fix
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => onOpenUrl(finding.url)}
                        >
                          Open
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
