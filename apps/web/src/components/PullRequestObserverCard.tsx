import type { GitObservePullRequestResult, GitPullRequestReviewFinding } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  SparklesIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

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

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFindingAdvice(finding: GitPullRequestReviewFinding): string | null {
  const normalizedBody = finding.body.replace(/\r\n?/g, "\n").trim();
  if (normalizedBody.length === 0) {
    return null;
  }

  const sectionPatterns = [
    /(?:^|\n)(?:#+\s*)?(?:possible fix|suggested fix|suggested solution|recommended fix|recommendation|how to fix|for ai agents|prompt for ai agents|implementation guidance)\s*:?\n([\s\S]*?)(?=\n(?:#+\s*\S|---+\s*$)|$)/i,
    /(?:^|\n)\*\*(?:possible fix|suggested fix|suggested solution|recommended fix|recommendation|how to fix|for ai agents|prompt for ai agents|implementation guidance)\*\*\s*:?\n?([\s\S]*?)(?=\n\*\*|$)/i,
  ];

  for (const pattern of sectionPatterns) {
    const match = normalizedBody.match(pattern);
    const advice = stripMarkdown(match?.[1] ?? "");
    if (advice.length > 0) {
      return truncateText(advice, 700);
    }
  }

  const cleanedBody = stripMarkdown(normalizedBody);
  const paragraphs = cleanedBody
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (paragraphs.length === 0) {
    return null;
  }
  return truncateText(paragraphs.slice(0, 2).join("\n\n"), 700);
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

function getPullRequestStateTone(state: "open" | "closed" | "merged"): {
  label: string;
  className: string;
} {
  switch (state) {
    case "merged":
      return { label: "Merged", className: "text-emerald-700" };
    case "closed":
      return { label: "Closed", className: "text-muted-foreground" };
    case "open":
    default:
      return { label: "Open", className: "text-sky-700" };
  }
}

interface PullRequestObserverCardProps {
  gitCwd: string | null;
  canCleanupThread?: boolean;
  onOpenUrl: (url: string) => void;
  onFixFinding: (input: {
    finding: GitPullRequestReviewFinding;
    findingAdvice: string | null;
    observation: GitObservePullRequestResult;
  }) => void;
  onCleanupThread?: () => void;
}

export function PullRequestObserverCard({
  gitCwd,
  canCleanupThread = false,
  onOpenUrl,
  onFixFinding,
  onCleanupThread,
}: PullRequestObserverCardProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [expandedFindingIds, setExpandedFindingIds] = useState<Record<string, boolean>>({});
  const gitStatusQuery = useQuery(gitStatusQueryOptions(gitCwd));
  const trackedPr = gitStatusQuery.data?.pr ?? null;
  const observationQuery = useQuery({
    ...gitObservePullRequestQueryOptions({
      cwd: gitCwd,
      reference: trackedPr?.url ?? null,
    }),
    enabled: gitCwd !== null && trackedPr !== null,
  });

  const observation = observationQuery.data ?? null;
  const visibleFindings = useMemo(() => {
    const findings = observation?.findings ?? [];
    return findings.toSorted(
      (left, right) => Number(isBotFinding(right)) - Number(isBotFinding(left)),
    );
  }, [observation?.findings]);

  if (!gitCwd || !trackedPr) {
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
  const prStateTone = getPullRequestStateTone(trackedPr.state);

  return (
    <div className="border-b border-border/80 bg-muted/12 px-3 py-3 sm:px-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-xl border border-border/70 bg-background/92 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="gap-1.5"
            onClick={() => onOpenUrl(trackedPr.url)}
          >
            <span>PR #{trackedPr.number}</span>
            <ExternalLinkIcon className="size-3 opacity-70" />
          </Button>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {trackedPr.title}
          </span>
          <Badge variant="outline" className={prStateTone.className}>
            {prStateTone.label}
          </Badge>
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
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className={
              trackedPr.state !== "open" && canCleanupThread && onCleanupThread ? "" : "ml-auto"
            }
            onClick={() => setDetailsExpanded((current) => !current)}
          >
            {detailsExpanded ? (
              <>
                <ChevronUpIcon className="size-3" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDownIcon className="size-3" />
                Expand
              </>
            )}
          </Button>
          {trackedPr.state !== "open" && canCleanupThread && onCleanupThread ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="gap-1.5"
              onClick={onCleanupThread}
            >
              <Trash2Icon className="size-3" />
              Clean up locally
            </Button>
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

            {detailsExpanded && observation.checks.length > 0 ? (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 bg-muted/14 p-2">
                {observation.checks.map((check) =>
                  (() => {
                    const checkLink = check.link;
                    return (
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
                          {checkLink ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              onClick={() => onOpenUrl(checkLink)}
                            >
                              Open
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })(),
                )}
              </div>
            ) : null}

            {detailsExpanded && visibleFindings.length > 0 ? (
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/14 p-2">
                {visibleFindings.map((finding) => {
                  const findingAdvice = isBotFinding(finding)
                    ? extractFindingAdvice(finding)
                    : null;
                  const isExpanded = expandedFindingIds[finding.id] === true;
                  return (
                    <div
                      key={finding.id}
                      className="rounded-lg border border-border/60 bg-background px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-foreground">
                              {formatFindingLocation(finding)}
                            </p>
                            <Badge variant="outline" className="gap-1">
                              {isBotFinding(finding) ? <BotIcon className="size-3" /> : null}
                              {finding.authorLogin}
                            </Badge>
                            {findingAdvice ? (
                              <Badge variant="outline" className="gap-1 text-amber-700">
                                <SparklesIcon className="size-3" />
                                Advice extracted
                              </Badge>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap text-muted-foreground text-xs">
                            {findingAdvice
                              ? findingAdvice
                              : truncateText(stripMarkdown(finding.body), 220)}
                          </p>
                          {isExpanded ? (
                            <div className="rounded-md border border-border/60 bg-muted/18 px-2 py-2">
                              <p className="whitespace-pre-wrap text-muted-foreground text-xs">
                                {finding.body}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => onFixFinding({ finding, findingAdvice, observation })}
                          >
                            {findingAdvice ? "Fix advice" : "Fix"}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setExpandedFindingIds((current) => ({
                                ...current,
                                [finding.id]: !current[finding.id],
                              }))
                            }
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUpIcon className="size-3" />
                                Collapse
                              </>
                            ) : (
                              <>
                                <ChevronDownIcon className="size-3" />
                                Expand
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => onOpenUrl(finding.url)}
                          >
                            Comment
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {detailsExpanded &&
            observation.checks.length === 0 &&
            visibleFindings.length === 0 &&
            !errorMessage ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-3 py-3 text-muted-foreground text-xs">
                No active checks or unresolved review findings.
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
