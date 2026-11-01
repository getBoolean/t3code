import { GitAccountId, type UnifiedSettings } from "@t3tools/contracts";

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
