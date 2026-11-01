import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { gitAccountBypassPrompt } from "@t3tools/client-runtime/git-accounts";

import * as Dialog from "../../components/ui/Dialog";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export interface GitAccountGuardTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
}

const inputFor = (target: GitAccountGuardTarget) => ({
  threadId: target.threadId,
  ...(target.projectId === null ? {} : { projectId: target.projectId }),
});

const confirmBypass = (title: string, message: string) =>
  new Promise<boolean>((resolve) =>
    Dialog.confirm({
      title,
      message,
      confirmText: "Continue",
      destructive: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    }),
  );

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
  const check = useAtomCommand(serverEnvironment.checkGitAccountThread, { reportFailure: false });
  const setBypass = useAtomCommand(serverEnvironment.setGitAccountThreadBypass, {
    label: "Could not change the git account bypass",
  });

  const setThreadBypass = async (bypass: boolean) => {
    if (target === null) return false;
    const result = await setBypass({
      environmentId: target.environmentId,
      input: { ...inputFor(target), bypass },
    });
    return result._tag === "Success";
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
    return (await confirmBypass(prompt.title, prompt.body)) && (await setThreadBypass(true));
  };

  return { status: status.data, ensureGitAccount, setThreadBypass };
}
