import {
  GitAccountId,
  MessageId,
  type OrchestrationV2ConversationMessage,
  ProjectId,
  SourceControlProviderKind,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitAccountSwitch from "./GitAccountSwitch.ts";

const threadId = ThreadId.make("thread-a");
const projectId = ProjectId.make("project-a");
const work = GitAccountId.make("work");

const message = (
  text: string,
  createdAt: DateTime.Utc,
  author: Pick<OrchestrationV2ConversationMessage, "createdBy" | "creationSource">,
): OrchestrationV2ConversationMessage => ({
  ...author,
  id: MessageId.make(`message-${text}`),
  threadId,
  runId: null,
  nodeId: null,
  role: "user",
  text,
  attachments: [],
  streaming: false,
  createdAt,
  updatedAt: createdAt,
});

const setup = Effect.gen(function* () {
  const messages = yield* Ref.make<ReadonlyArray<OrchestrationV2ConversationMessage>>([]);
  const layer = GitAccountSwitch.layer.pipe(
    Layer.provideMerge(
      ServerSettings.ServerSettingsService.layerTest({
        gitAccounts: {
          [work]: {
            label: "Work",
            authorName: "Work Name",
            authorEmail: "work@example.test",
            forge: SourceControlProviderKind.make("github"),
            host: "github.com",
            credentialKind: "token",
            token: "t",
            cliLogin: "",
            sshKeyPath: "",
          },
        },
        projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } },
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadRecords: () =>
          Ref.get(messages).pipe(
            Effect.map((current) => ({ thread: { projectId }, messages: current }) as never),
          ),
      }),
    ),
  );
  return { messages, layer };
});

it.effect("switches only after the user types the confirmation phrase in the thread", () =>
  Effect.gen(function* () {
    const { messages, layer } = yield* setup;
    yield* Effect.gen(function* () {
      const switcher = yield* GitAccountSwitch.GitAccountSwitch;
      const settings = yield* ServerSettings.ServerSettingsService;
      const first = yield* switcher.switchProject({ threadId, accountId: work });
      assert.equal(first.status, "confirmation_required");
      const phrase = first.status === "confirmation_required" ? first.phrase : "";

      yield* TestClock.adjust("1 second");
      const later = yield* DateTime.now;
      yield* Ref.set(messages, [
        message(`sure, ${phrase}`, later, { createdBy: "agent", creationSource: "mcp" }),
      ]);
      const forged = yield* switcher.switchProject({ threadId, accountId: work });
      assert.equal(forged.status, "confirmation_required");
      assert.isUndefined(
        (yield* settings.getSettings).projectSettingsOverrides[projectId]?.gitAccountId,
      );

      const phraseNow = forged.status === "confirmation_required" ? forged.phrase : "";
      yield* TestClock.adjust("1 second");
      yield* Ref.set(messages, [
        message(phraseNow, yield* DateTime.now, { createdBy: "user", creationSource: "mobile" }),
      ]);
      const done = yield* switcher.switchProject({ threadId, accountId: work });
      assert.deepEqual(done, { status: "switched", accountLabel: "Work" });
      const overrides = (yield* settings.getSettings).projectSettingsOverrides[projectId];
      assert.equal(overrides?.gitAccountId, work);
      assert.equal(overrides?.defaultAutoPull, true);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("rejects an unknown account", () =>
  Effect.gen(function* () {
    const { layer } = yield* setup;
    const error = yield* Effect.gen(function* () {
      const switcher = yield* GitAccountSwitch.GitAccountSwitch;
      return yield* switcher
        .switchProject({ threadId, accountId: GitAccountId.make("nope") })
        .pipe(Effect.flip);
    }).pipe(Effect.provide(layer));
    assert.include(error.message, "nope");
  }),
);
