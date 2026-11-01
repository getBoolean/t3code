import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { gitAccountBypassPrompt } from "@t3tools/client-runtime/git-accounts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

export interface GitAccountGuardTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
}

const inputFor = (target: GitAccountGuardTarget) => ({
  threadId: target.threadId,
  ...(target.projectId === null ? {} : { projectId: target.projectId }),
});

/**
 * Warns before a thread acts without its unusable git account, and starts the thread's bypass
 * when the user continues. Without a bypass the server still blocks the thread's git.
 */
export function useGitAccountGuard(target: GitAccountGuardTarget | null) {
  const status = useEnvironmentQuery(
    target === null
      ? null
      : serverEnvironment.gitAccountThreadStatus({
          environmentId: target.environmentId,
          input: inputFor(target),
        }),
  );
  const check = useAtomCommand(serverEnvironment.checkGitAccountThread, {
    label: "git account check thread",
  });
  const setBypass = useAtomCommand(serverEnvironment.setGitAccountThreadBypass, {
    label: "git account set thread bypass",
  });

  const setThreadBypass = async (bypass: boolean) => {
    if (target === null) return false;
    const result = await setBypass({
      environmentId: target.environmentId,
      input: { ...inputFor(target), bypass },
    });
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: bypass
            ? "Could not continue without the git account"
            : "Could not go back to the git account",
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
    return false;
  };

  /** `true` when the action may go ahead. */
  const ensureGitAccount = async () => {
    if (target === null) return true;
    // Only an account that looked unusable, or no answer yet, costs a round trip before acting.
    if (status.data !== null && status.data.state !== "unavailable") return true;
    const result = await check({ environmentId: target.environmentId, input: inputFor(target) });
    // A failed check leaves the decision to the server, which still fails closed.
    if (result._tag !== "Success" || result.value.state !== "unavailable") return true;
    const prompt = gitAccountBypassPrompt(result.value);
    const message = `${prompt.title}\n${prompt.body}`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    return confirmed && (await setThreadBypass(true));
  };

  return { status: status.data, ensureGitAccount, setThreadBypass };
}
