import path from "node:path";

import type { ChatAttachment } from "@t3tools/contracts";
import { Effect, FileSystem } from "effect";

import { createAttachmentId, resolveAttachmentPath } from "./attachmentStore.ts";

export const persistImageAttachmentBytes = Effect.fn(function* (input: {
  readonly threadId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly stateDir: string;
  readonly fileSystem: FileSystem.FileSystem;
}) {
  const attachmentId = createAttachmentId(input.threadId);
  if (!attachmentId) {
    return yield* Effect.fail(new Error("Failed to create a safe attachment id."));
  }

  const persistedAttachment: ChatAttachment = {
    type: "image",
    id: attachmentId,
    name: input.name,
    mimeType: input.mimeType.toLowerCase(),
    sizeBytes: input.bytes.byteLength,
  };

  const attachmentPath = resolveAttachmentPath({
    stateDir: input.stateDir,
    attachment: persistedAttachment,
  });
  if (!attachmentPath) {
    return yield* Effect.fail(new Error(`Failed to resolve persisted path for '${input.name}'.`));
  }

  yield* input.fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true });
  yield* input.fileSystem.writeFile(attachmentPath, input.bytes);

  return persistedAttachment;
});
