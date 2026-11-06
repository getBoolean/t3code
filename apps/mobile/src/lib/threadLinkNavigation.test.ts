// Fork: scoped links navigate without sidebar records in their explicit environment; remove when upstream supports this.
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { resolveThreadLinkRef } from "./threadLinkNavigation";

it("opens scoped links without cached sidebar records in their explicit environment", () => {
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
  ).toEqual(link);
  expect(
    resolveThreadLinkRef(
      link,
      environmentId,
      () => null,
      () => [],
    ),
  ).toEqual(link);
  const encoded = {
    environmentId,
    threadId: ThreadId.make("thread:delegated-task:command%3Amcp%3A1"),
  };
  expect(
    resolveThreadLinkRef(
      encoded,
      environmentId,
      () => null,
      () => [],
    ),
  ).toEqual(encoded);
  expect(
    resolveThreadLinkRef(
      { environmentId: null, threadId },
      environmentId,
      () => null,
      () => [],
    ),
  ).toBeNull();
});
