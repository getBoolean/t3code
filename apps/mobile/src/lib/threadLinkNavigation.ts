// Fork: recorded subagent links may target a child not present in the sidebar.
import type { EnvironmentId, OrchestrationV2Subagent, ScopedThreadRef } from "@t3tools/contracts";
import {
  guessThreadLinkRef,
  threadLinkCandidates,
  type ThreadLink,
} from "@t3tools/shared/threadLinks";

export function resolveThreadLinkRef(
  link: ThreadLink,
  environmentId: EnvironmentId,
  title: (ref: ScopedThreadRef) => string | null,
  refs: () => ReadonlyArray<ScopedThreadRef>,
  subagents: ReadonlyArray<Pick<OrchestrationV2Subagent, "childThreadId">> = [],
): ScopedThreadRef | null {
  const known = threadLinkCandidates(link, environmentId).find((ref) => title(ref) !== null);
  if (known) return known;
  if (
    link.environmentId === environmentId &&
    subagents.some((subagent) => subagent.childThreadId === link.threadId)
  )
    return { environmentId, threadId: link.threadId };
  return link.environmentId === null ? guessThreadLinkRef(link, refs()) : null;
}
