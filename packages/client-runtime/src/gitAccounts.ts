import {
  GitAccountId,
  type GitAccountThreadStatus,
  type UnifiedSettings,
} from "@t3tools/contracts";

export const GIT_ACCOUNT_FORGES = [
  { kind: "github", label: "GitHub", host: "github.com" },
  { kind: "gitlab", label: "GitLab", host: "gitlab.com" },
  { kind: "forgejo", label: "Forgejo / Gitea", host: "codeberg.org" },
  { kind: "bitbucket", label: "Bitbucket", host: "bitbucket.org" },
  { kind: "azure-devops", label: "Azure DevOps", host: "dev.azure.com" },
  { kind: "gitcafe", label: "GitCafe", host: "git.cafe" },
] as const;

/** Settings merge by id, so a new account must never reuse an existing one's id. */
export function gitAccountIdFromLabel(
  label: string,
  accounts: UnifiedSettings["gitAccounts"],
): GitAccountId {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "account";
  let id = base;
  for (let suffix = 2; id in accounts; suffix += 1) id = `${base}-${suffix}`;
  return GitAccountId.make(id);
}

/** Projects whose own override names the account; the default is reported separately. */
export function projectsUsingGitAccount(
  settings: Pick<UnifiedSettings, "projectSettingsOverrides">,
  accountId: GitAccountId,
): number {
  return Object.values(settings.projectSettingsOverrides).filter(
    (overrides) => overrides.gitAccountId === accountId,
  ).length;
}

/** The warning shown before a thread runs without its unusable git account. */
export function gitAccountBypassPrompt(status: GitAccountThreadStatus): {
  readonly title: string;
  readonly body: string;
} {
  const machine = status.machine;
  const author =
    machine?.authorName && machine.authorEmail
      ? `Commits will be authored as ${machine.authorName} <${machine.authorEmail}>.`
      : "Commits will use this machine's git config, which has no name or email set.";
  const forge =
    machine?.host === null || machine?.host === undefined
      ? "Pushes will use whatever credentials this machine has."
      : machine.forgeLogin
        ? `Pushes and pull requests will use the ${machine.host} login "${machine.forgeLogin}".`
        : `Pushes and pull requests will use whatever credentials this machine has for ${machine.host}.`;
  return {
    title: `Continue without the git account "${status.accountLabel ?? "unknown"}"?`,
    body: [
      `It can't be used: ${status.reason ?? "unknown reason"}.`,
      `This thread will run as this machine's git login instead. ${author} ${forge}`,
      "Only this thread is affected, until the account works again.",
    ].join("\n"),
  };
}
