// Fork: Manage git accounts with secret-safe edits and disclose affected projects before removal.
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type GitAccountConfig,
  type GitAccountId,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import type { MessageResolver } from "../../i18n/messages";
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
import { useSearchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

type Editing = { readonly id: GitAccountId; readonly account: GitAccountConfig } | null;

export function GitAccountsSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
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
              <T>Add account</T>
            </Button>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <SettingsRow
            title={gt("No git accounts.")}
            description={gt(
              "Add one to commit, push and open pull requests as a specific account per project.",
            )}
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
                    ? // oxlint-disable-next-line t3code/no-untranslated-copy -- A CLI command and a user name stay English.
                      `gh login "${account.cliLogin}"`
                    : gt("saved token")}
                  {account.sshKeyPath ? ` · ${gt("SSH key")}` : ""}
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
                      {gt("Edit", { $context: "verb, edit a git account" })}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setRemoving(id)}>
                      {gt("Remove", { $context: "verb, remove a git account" })}
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
              <AlertDialogTitle>
                {gt("Remove {account}?", { account: removingAccount.label })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {removalImpact(
                  projectsUsingGitAccount(settings, removing),
                  settings.gitAccountId === removing,
                  m,
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </AlertDialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  updateSettings({ gitAccounts: { [removing]: null } });
                  setRemoving(null);
                }}
              >
                {gt("Remove", { $context: "verb, remove a git account" })}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : null}
    </>
  );
}

function removalImpact(projectCount: number, isDefault: boolean, resolve: MessageResolver): string {
  if (projectCount > 0 && isDefault) {
    return resolve(
      msg(
        "It's used by {count, plural, one {{count} project} other {{count} projects}} and every project that uses the default. Commits, pushes and pull requests there will be blocked until another account is picked.",
        { count: projectCount },
      ),
    );
  }
  if (projectCount > 0) {
    return resolve(
      msg(
        "It's used by {count, plural, one {{count} project} other {{count} projects}}. Commits, pushes and pull requests there will be blocked until another account is picked.",
        { count: projectCount },
      ),
    );
  }
  if (isDefault) {
    return resolve(
      msg(
        "It's used by every project that uses the default. Commits, pushes and pull requests there will be blocked until another account is picked.",
      ),
    );
  }
  return resolve(msg("No project uses this account. Its saved token is deleted from this server."));
}
