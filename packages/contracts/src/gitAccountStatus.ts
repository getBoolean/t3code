// Fork: Keep credential-free thread account status and explicit bypass RPC input contracts shared by server and clients.
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { GitAccountId } from "./gitAccountId.ts";

/** What git and the forge fall back to on this machine when a thread bypasses its account. */
export const GitAccountMachineIdentity = Schema.Struct({
  authorName: Schema.NullOr(Schema.String),
  authorEmail: Schema.NullOr(Schema.String),
  host: Schema.NullOr(Schema.String),
  forgeLogin: Schema.NullOr(Schema.String),
});
export type GitAccountMachineIdentity = typeof GitAccountMachineIdentity.Type;

export const GitAccountThreadState = Schema.Literals(["none", "ready", "unavailable", "bypassed"]);
export type GitAccountThreadState = typeof GitAccountThreadState.Type;

export const GitAccountThreadStatus = Schema.Struct({
  state: GitAccountThreadState,
  accountId: Schema.NullOr(GitAccountId),
  accountLabel: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  /** Set for `unavailable` and `bypassed`: who the thread runs as when it bypasses the account. */
  machine: Schema.NullOr(GitAccountMachineIdentity),
});
export type GitAccountThreadStatus = typeof GitAccountThreadStatus.Type;

/** `projectId` covers a draft thread the server doesn't know yet. */
export const GitAccountThreadStatusInput = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.optional(ProjectId),
});
export type GitAccountThreadStatusInput = typeof GitAccountThreadStatusInput.Type;

export const GitAccountSetThreadBypassInput = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.optional(ProjectId),
  bypass: Schema.Boolean,
});
export type GitAccountSetThreadBypassInput = typeof GitAccountSetThreadBypassInput.Type;
