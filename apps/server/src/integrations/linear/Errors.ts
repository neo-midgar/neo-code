import { Schema } from "effect";

import type { GitCommandError } from "../../git/Errors.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export class LinearIntegrationError extends Schema.TaggedErrorClass<LinearIntegrationError>()(
  "LinearIntegrationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Linear integration failed in ${this.operation}: ${this.detail}`;
  }
}

export type LinearServiceError =
  | LinearIntegrationError
  | GitCommandError
  | ProjectionRepositoryError;
