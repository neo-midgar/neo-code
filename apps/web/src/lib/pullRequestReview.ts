import type { GitObservePullRequestResult, GitPullRequestReviewFinding } from "@t3tools/contracts";

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

export function stripPullRequestReviewMarkdown(value: string): string {
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

export function isBotPullRequestFinding(finding: GitPullRequestReviewFinding): boolean {
  return (
    finding.authorLogin.toLowerCase().includes("bot") ||
    finding.authorLogin.toLowerCase().includes("coderabbit")
  );
}

export function extractPullRequestFindingAdvice(
  finding: GitPullRequestReviewFinding,
): string | null {
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
    const advice = stripPullRequestReviewMarkdown(match?.[1] ?? "");
    if (advice.length > 0) {
      return truncateText(advice, 700);
    }
  }

  const cleanedBody = stripPullRequestReviewMarkdown(normalizedBody);
  const paragraphs = cleanedBody
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (paragraphs.length === 0) {
    return null;
  }
  return truncateText(paragraphs.slice(0, 2).join("\n\n"), 700);
}

function formatFindingLocation(finding: GitPullRequestReviewFinding): string {
  return finding.line ? `${finding.path}:${finding.line}` : finding.path;
}

export function buildPullRequestFindingFixPrompt(input: {
  finding: GitPullRequestReviewFinding;
  findingAdvice: string | null;
  observation: GitObservePullRequestResult;
}): string {
  const location = formatFindingLocation(input.finding);
  return [
    `Address this pull request review finding on PR #${input.observation.pullRequest.number}: ${input.observation.pullRequest.title}`,
    `Reviewer: ${input.finding.authorLogin}`,
    `Location: ${location}`,
    input.findingAdvice
      ? `Apply this fix advice:\n${input.findingAdvice}`
      : `Review comment:\n${input.finding.body}`,
    "Task:",
    "Inspect the current branch/worktree, implement the fix if the feedback is valid, and summarize the change clearly.",
    "If you disagree with the finding, explain why before making any code changes.",
  ].join("\n\n");
}

export function buildPullRequestBatchFixPrompt(input: {
  observation: GitObservePullRequestResult;
  findings: ReadonlyArray<{
    finding: GitPullRequestReviewFinding;
    findingAdvice: string | null;
  }>;
}): string {
  const items = input.findings.map(({ finding, findingAdvice }, index) => {
    const location = formatFindingLocation(finding);
    return [
      `${index + 1}. ${location} (${finding.authorLogin})`,
      findingAdvice ? findingAdvice : stripPullRequestReviewMarkdown(finding.body),
    ].join("\n");
  });

  return [
    `Address these pull request review findings on PR #${input.observation.pullRequest.number}: ${input.observation.pullRequest.title}`,
    "Apply the following review advice where it is valid. Re-check each item against the current code before changing anything.",
    items.join("\n\n"),
    "Task:",
    "Implement the valid fixes in the current branch/worktree and summarize which findings were fixed.",
    "If any finding is no longer valid, explain that clearly instead of forcing a code change.",
  ].join("\n\n");
}
