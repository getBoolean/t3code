import {
  type GitAccountId,
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

interface PendingSwitch {
  readonly projectId: ProjectId;
  readonly accountId: GitAccountId;
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

  return GitAccountSwitch.of({ switchProject });
});

export const layer = Layer.effect(GitAccountSwitch, make);
