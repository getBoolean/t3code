// Fork: Require a user-authored confirmation phrase before an agent switches an account or enables bypass; ending bypass restores the account.
import {
  type GitAccountId,
  type GitAccountMachineIdentity,
  type OrchestrationV2ConversationMessage,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitAccounts from "./GitAccounts.ts";

export class GitAccountSwitchError extends Schema.TaggedError<GitAccountSwitchError>()(
  "GitAccountSwitchError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export type GitAccountSwitchResult =
  | {
      readonly status: "confirmation_required";
      readonly phrase: string;
      readonly instructions: string;
    }
  | { readonly status: "switched"; readonly accountLabel: string };

export type GitAccountBypassResult =
  | {
      readonly status: "confirmation_required";
      readonly phrase: string;
      readonly instructions: string;
      readonly reason: string;
      readonly machine: GitAccountMachineIdentity | null;
    }
  | {
      readonly status: "bypassed" | "bypass_ended";
      readonly machine: GitAccountMachineIdentity | null;
    };

interface PendingSwitch {
  readonly projectId: ProjectId;
  /** `null` asks to bypass the project's unusable account instead of switching. */
  readonly accountId: GitAccountId | null;
  readonly phrase: string;
  readonly requestedAt: DateTime.Utc;
}

/** Only a message the person typed in a client counts; agents can't author these. */
const confirmedByUser = (
  message: OrchestrationV2ConversationMessage,
  pending: PendingSwitch,
): boolean =>
  message.role === "user" &&
  message.createdBy === "user" &&
  (message.creationSource === "web" || message.creationSource === "mobile") &&
  DateTime.isGreaterThan(message.createdAt, pending.requestedAt) &&
  message.text.toLowerCase().includes(pending.phrase.toLowerCase());

export class GitAccountSwitch extends Context.Service<
  GitAccountSwitch,
  {
    /**
     * Switches the calling thread's project to `accountId` once the user has typed the returned
     * phrase in that thread; until then it returns the phrase to ask for.
     */
    readonly switchProject: (input: {
      readonly threadId: ThreadId;
      readonly accountId: GitAccountId;
    }) => Effect.Effect<GitAccountSwitchResult, GitAccountSwitchError>;
    /**
     * Lets the calling thread run as this machine's git login once the user has typed the
     * returned phrase; `bypass: false` ends a bypass at once, since that only restores the account.
     */
    readonly bypassThread: (input: {
      readonly threadId: ThreadId;
      readonly bypass: boolean;
    }) => Effect.Effect<GitAccountBypassResult, GitAccountSwitchError>;
  }
>()("t3/gitAccounts/GitAccountSwitch") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const pendingByThread = yield* Ref.make(new Map<ThreadId, PendingSwitch>());

  const fail = (reason: string) => Effect.fail(new GitAccountSwitchError({ reason }));

  const switchProject: GitAccountSwitch["Service"]["switchProject"] = Effect.fn(
    "GitAccountSwitch.switchProject",
  )(function* (input) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => new GitAccountSwitchError({ reason: "Settings are unavailable." })),
    );
    const account = settings.gitAccounts[input.accountId];
    if (account === undefined)
      return yield* fail(`No git account has the id "${input.accountId}".`);
    const records = yield* threads
      .getThreadRecords(input.threadId, ["messages"])
      .pipe(
        Effect.mapError(() => new GitAccountSwitchError({ reason: "The thread is unavailable." })),
      );
    const projectId = records.thread.projectId;
    const pending = (yield* Ref.get(pendingByThread)).get(input.threadId);

    if (
      pending !== undefined &&
      pending.projectId === projectId &&
      pending.accountId === input.accountId &&
      records.messages.some((message) => confirmedByUser(message, pending))
    ) {
      const current = settings.projectSettingsOverrides[projectId] ?? {};
      yield* settingsService
        .updateSettings({
          projectSettingsOverrides: { [projectId]: { ...current, gitAccountId: input.accountId } },
        })
        .pipe(Effect.mapError(() => new GitAccountSwitchError({ reason: "Saving failed." })));
      yield* Ref.update(pendingByThread, (current) => {
        const next = new Map(current);
        next.delete(input.threadId);
        return next;
      });
      return { status: "switched", accountLabel: account.label } satisfies GitAccountSwitchResult;
    }

    const phrase = `use ${account.label} ${yield* Random.nextIntBetween(1000, 10000)}`;
    const requestedAt = yield* DateTime.now;
    yield* Ref.update(pendingByThread, (current) =>
      new Map(current).set(input.threadId, {
        projectId,
        accountId: input.accountId,
        phrase,
        requestedAt,
      }),
    );
    return {
      status: "confirmation_required",
      phrase,
      instructions: `Ask the user to reply "${phrase}" in this thread, then call this tool again with the same accountId. Only a reply the user types counts.`,
    } satisfies GitAccountSwitchResult;
  });

  const clearPending = (threadId: ThreadId) =>
    Ref.update(pendingByThread, (current) => {
      const next = new Map(current);
      next.delete(threadId);
      return next;
    });

  const bypassThread: GitAccountSwitch["Service"]["bypassThread"] = Effect.fn(
    "GitAccountSwitch.bypassThread",
  )(function* (input) {
    // Looked up per call: MCP's toolkit layers can't carry the server's shared instance.
    const gitAccounts = yield* Effect.serviceOption(GitAccounts.GitAccounts).pipe(
      Effect.flatMap((service) =>
        service._tag === "Some"
          ? Effect.succeed(service.value)
          : fail("Git accounts are unavailable."),
      ),
    );
    if (!input.bypass) {
      const status = yield* gitAccounts.setThreadBypass(input.threadId, false);
      return { status: "bypass_ended", machine: status.machine } satisfies GitAccountBypassResult;
    }
    const status = yield* gitAccounts.threadStatus(input.threadId);
    if (status.state === "bypassed") {
      return { status: "bypassed", machine: status.machine } satisfies GitAccountBypassResult;
    }
    if (status.state !== "unavailable") {
      return yield* fail("This thread's git account works, so there is nothing to bypass.");
    }
    const records = yield* threads
      .getThreadRecords(input.threadId, ["messages"])
      .pipe(
        Effect.mapError(() => new GitAccountSwitchError({ reason: "The thread is unavailable." })),
      );
    const projectId = records.thread.projectId;
    const pending = (yield* Ref.get(pendingByThread)).get(input.threadId);
    if (
      pending !== undefined &&
      pending.projectId === projectId &&
      pending.accountId === null &&
      records.messages.some((message) => confirmedByUser(message, pending))
    ) {
      yield* clearPending(input.threadId);
      const next = yield* gitAccounts.setThreadBypass(input.threadId, true);
      return { status: "bypassed", machine: next.machine } satisfies GitAccountBypassResult;
    }
    const phrase = `continue without ${status.accountLabel ?? "the account"} ${yield* Random.nextIntBetween(1000, 10000)}`;
    const requestedAt = yield* DateTime.now;
    yield* Ref.update(pendingByThread, (current) =>
      new Map(current).set(input.threadId, { projectId, accountId: null, phrase, requestedAt }),
    );
    return {
      status: "confirmation_required",
      phrase,
      reason: status.reason ?? "",
      machine: status.machine,
      instructions: `Tell the user why the account can't be used and which machine login this thread would use instead (see machine), then ask them to reply "${phrase}" in this thread and call this tool again. Only a reply the user types counts.`,
    } satisfies GitAccountBypassResult;
  });

  return GitAccountSwitch.of({ switchProject, bypassThread });
});

export const layer = Layer.effect(GitAccountSwitch, make);
