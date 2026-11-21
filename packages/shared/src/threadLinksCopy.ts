import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import {
  formatThreadLink,
  replaceThreadLinks,
  threadLinkCandidates,
  type ThreadLink,
} from "./threadLinks.ts";

/** @public */
export function unknownThreadLinkLabel(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
  resolve: MFunctionType = mFallback,
): string {
  return link.environmentId === null || link.environmentId === messageEnvironmentId
    ? resolve(msg("Thread no longer available"))
    : resolve(msg("Thread on another machine"));
}

/**
 * Writes each link with its thread's current title, a hosted link as a v2 link. A link `title`
 * cannot resolve becomes plain text, its written label or a neutral one, except a labeled v1
 * link, which may open elsewhere, and (fork) a scoped v2 link, which stays navigable.
 */
export function relabelThreadLinks(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  title: (ref: ScopedThreadRef, label: string | undefined) => string | undefined,
  resolve: MFunctionType = mFallback,
): string {
  return replaceThreadLinks(markdown, (written, label) => {
    for (const ref of threadLinkCandidates(written, messageEnvironmentId)) {
      const current = title(ref, label);
      if (current === undefined) continue;
      return formatThreadLink(
        { environmentId: written.environmentId, threadId: ref.threadId },
        current.trim() || label || ref.threadId,
      );
    }
    // Fork: sidebar absence does not prove deletion; preserve scoped targets until navigation loads them (remove when upstream does).
    if (written.environmentId !== null) return formatThreadLink(written, label || "Open thread");
    if (label !== undefined && written.environmentId === null) return undefined;
    return label?.trim() || unknownThreadLinkLabel(written, messageEnvironmentId, resolve);
  });
}
