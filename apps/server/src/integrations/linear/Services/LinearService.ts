import type {
  LinearGetIssueInput,
  LinearGetIssueResult,
  LinearImportIssueInput,
  LinearImportIssueResult,
  LinearListProjectIssuesInput,
  LinearListProjectIssuesResult,
  LinearListTeamsResult,
  LinearReportThreadInput,
  LinearReportThreadResult,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { LinearServiceError } from "../Errors.ts";

export interface LinearServiceShape {
  readonly listTeams: () => Effect.Effect<LinearListTeamsResult, LinearServiceError>;
  readonly listProjectIssues: (
    input: LinearListProjectIssuesInput,
  ) => Effect.Effect<LinearListProjectIssuesResult, LinearServiceError>;
  readonly getIssue: (
    input: LinearGetIssueInput,
  ) => Effect.Effect<LinearGetIssueResult, LinearServiceError>;
  readonly importIssue: (
    input: LinearImportIssueInput,
  ) => Effect.Effect<LinearImportIssueResult, LinearServiceError>;
  readonly reportThread: (
    input: LinearReportThreadInput,
  ) => Effect.Effect<LinearReportThreadResult, LinearServiceError>;
}

export class LinearService extends ServiceMap.Service<LinearService, LinearServiceShape>()(
  "t3/integrations/linear/Services/LinearService",
) {}
