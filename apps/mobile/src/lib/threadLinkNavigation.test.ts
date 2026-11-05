// Fork: recorded child navigation remains restricted to the parent environment.
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { resolveThreadLinkRef } from "./threadLinkNavigation";

it("opens a recorded child outside the loaded sidebar without guessing another environment", () => {
  const environmentId = EnvironmentId.make("environment");
  const threadId = ThreadId.make("child");
  const link = { environmentId, threadId };
  const subagents = [{ childThreadId: threadId }];
  expect(
    resolveThreadLinkRef(
      link,
      environmentId,
      () => null,
      () => [],
      subagents,
    ),
  ).toEqual(link);
  expect(
    resolveThreadLinkRef(
      link,
      EnvironmentId.make("other"),
      () => null,
      () => [],
      subagents,
    ),
  ).toBeNull();
  expect(
    resolveThreadLinkRef(
      link,
      environmentId,
      () => null,
      () => [],
    ),
  ).toBeNull();
});
