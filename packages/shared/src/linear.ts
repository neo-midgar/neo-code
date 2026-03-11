import type { LinearIssue, OrchestrationThreadActivity } from "@t3tools/contracts";

import { normalizePullRequestWorktreeBranchPrefix } from "./git";

export const LINEAR_THREAD_ACTIVITY_KIND = "linear.issue.linked";
export const LINEAR_THREAD_REPORTED_ACTIVITY_KIND = "linear.issue.reported";

const LINEAR_IDENTIFIER_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/i;
const LINEAR_HOST_PATTERN = /(^|\.)linear\.app$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeLinearIssueReference(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const directMatch = trimmed.match(LINEAR_IDENTIFIER_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1].toUpperCase();
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(LINEAR_IDENTIFIER_PATTERN);
    return match?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

export function buildLinearIssueBranchName(input: {
  readonly prefix?: string | null | undefined;
  readonly identifier: string;
  readonly title: string;
}): string {
  const prefix = normalizePullRequestWorktreeBranchPrefix(input.prefix);
  const identifier = input.identifier.trim().toLowerCase();
  const title = input.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 48)
    .replace(/[./_-]+$/g, "");

  return `${prefix}/${identifier}${title.length > 0 ? `-${title}` : ""}`;
}

export function toLinearAppUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith("linear://")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (!LINEAR_HOST_PATTERN.test(url.hostname)) {
      return null;
    }
    return `linear://${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function extractLinkedLinearIssueFromActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): LinearIssue | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== LINEAR_THREAD_ACTIVITY_KIND) {
      continue;
    }
    const payload = asRecord(activity.payload);
    const issue = payload ? payload.issue : null;
    const issueRecord = asRecord(issue);
    if (!issueRecord) {
      continue;
    }
    if (
      typeof issueRecord.id === "string" &&
      typeof issueRecord.identifier === "string" &&
      typeof issueRecord.title === "string" &&
      typeof issueRecord.description === "string" &&
      typeof issueRecord.url === "string" &&
      Array.isArray(issueRecord.comments) &&
      Array.isArray(issueRecord.imageUrls) &&
      Array.isArray(issueRecord.availableStates)
    ) {
      return issueRecord as LinearIssue;
    }
  }

  return null;
}

export function extractLinkedLinearCredentialIdFromActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== LINEAR_THREAD_ACTIVITY_KIND) {
      continue;
    }
    const payload = asRecord(activity.payload);
    if (!payload || typeof payload.credentialId !== "string") {
      continue;
    }
    const credentialId = payload.credentialId.trim();
    if (credentialId.length > 0) {
      return credentialId;
    }
  }

  return null;
}
