// Fork: Manage git accounts with secret-safe edits and disclose affected projects before removal.
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type GitAccountConfig,
  type GitAccountId,
} from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentScope } from "../../state/session";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { GitAccountDialog } from "./GitAccountDialog";
import { projectsUsingGitAccount } from "@t3tools/client-runtime/git-accounts";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

type Editing = { readonly id: GitAccountId; readonly account: GitAccountConfig } | null;

export function GitAccountsSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [dialog, setDialog] = useState<{ readonly editing: Editing } | null>(null);
  const [removing, setRemoving] = useState<GitAccountId | null>(null);
  const entries = Object.entries(settings.gitAccounts) as Array<[GitAccountId, GitAccountConfig]>;
  const removingAccount = removing === null ? undefined : settings.gitAccounts[removing];

  return (
    <>
      <SettingsSection
        {...searchableSetting("git-accounts")}
        headerAction={
          canManage ? (
            <Button size="xs" variant="outline" onClick={() => setDialog({ editing: null })}>
              <PlusIcon className="size-3" aria-hidden />
              Add account
            </Button>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <SettingsRow
            title="No git accounts."
            description="Add one to commit, push and open pull requests as a specific account per project."
          />
        ) : (
          entries.map(([id, account]) => (
            <SettingsRow
              key={id}
              title={account.label}
              description={
                <span className="break-all">
                  {account.authorName} · {account.authorEmail} · {account.host} ·{" "}
                  {account.credentialKind === "cliLogin"
                    ? `gh login "${account.cliLogin}"`
                    : "saved token"}
                  {account.sshKeyPath ? " · SSH key" : ""}
                </span>
              }
              control={
                canManage ? (
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => setDialog({ editing: { id, account } })}
                    >
                      Edit
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setRemoving(id)}>
                      Remove
                    </Button>
                  </div>
                ) : null
              }
            />
          ))
        )}
      </SettingsSection>
      {dialog !== null && canManage ? (
        <GitAccountDialog
          environmentId={environmentId}
          accounts={settings.gitAccounts}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {removing !== null && removingAccount !== undefined ? (
        <AlertDialog open onOpenChange={(open) => (open ? undefined : setRemoving(null))}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {removingAccount.label}?</AlertDialogTitle>
              <AlertDialogDescription>
                {removalImpact(
                  projectsUsingGitAccount(settings, removing),
                  settings.gitAccountId === removing,
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  updateSettings({ gitAccounts: { [removing]: null } });
                  setRemoving(null);
                }}
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : null}
    </>
  );
}

function removalImpact(projectCount: number, isDefault: boolean): string {
  const users = [
    ...(projectCount > 0 ? [`${projectCount} project${projectCount === 1 ? "" : "s"}`] : []),
    ...(isDefault ? ["every project that uses the default"] : []),
  ];
  return users.length === 0
    ? "No project uses this account. Its saved token is deleted from this server."
    : `It's used by ${users.join(" and ")}. Commits, pushes and pull requests there will be blocked until another account is picked.`;
}
