import {
  type EnvironmentId,
  type GitAccountConfig,
  type GitAccountId,
  SourceControlProviderKind,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { gitAccountIdFromLabel, GIT_ACCOUNT_FORGES } from "@t3tools/client-runtime/git-accounts";
import { SecretInput } from "./SecretInput";

/** The token goes once to the server's secret store; settings keep only a redaction marker. */
export function GitAccountDialog({
  environmentId,
  accounts,
  editing,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly accounts: UnifiedSettings["gitAccounts"];
  readonly editing: { readonly id: GitAccountId; readonly account: GitAccountConfig } | null;
  readonly onClose: () => void;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const initial = editing?.account;
  const [label, setLabel] = useState(initial?.label ?? "");
  const [authorName, setAuthorName] = useState(initial?.authorName ?? "");
  const [authorEmail, setAuthorEmail] = useState(initial?.authorEmail ?? "");
  const [forge, setForge] = useState<string>(initial?.forge ?? "github");
  const [host, setHost] = useState(initial?.host ?? "github.com");
  const [credentialKind, setCredentialKind] = useState<GitAccountConfig["credentialKind"]>(
    initial?.credentialKind ?? "token",
  );
  // A saved token comes back redacted; leaving it untouched keeps the stored secret.
  const [token, setToken] = useState(initial?.token ?? "");
  const [cliLogin, setCliLogin] = useState(initial?.cliLogin ?? "");
  const [sshKeyPath, setSshKeyPath] = useState(initial?.sshKeyPath ?? "");
  const cliLoginSupported = forge === "github";
  const kind = cliLoginSupported ? credentialKind : "token";
  const credentialReady = kind === "token" ? token.trim() !== "" : cliLogin.trim() !== "";
  const canSave =
    label.trim() !== "" &&
    authorName.trim() !== "" &&
    authorEmail.trim() !== "" &&
    host.trim() !== "" &&
    credentialReady;

  const save = () => {
    if (!canSave) return;
    const id = editing?.id ?? gitAccountIdFromLabel(label, accounts);
    updateSettings({
      gitAccounts: {
        [id]: {
          label: label.trim(),
          authorName: authorName.trim(),
          authorEmail: authorEmail.trim(),
          forge: SourceControlProviderKind.make(forge),
          host: host.trim().toLowerCase(),
          credentialKind: kind,
          token: kind === "token" ? token.trim() : "",
          cliLogin: kind === "cliLogin" ? cliLogin.trim() : "",
          sshKeyPath: sshKeyPath.trim(),
        },
      },
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.account.label}` : "Add git account"}</DialogTitle>
          <DialogDescription>
            Projects that use this account commit, push and open pull requests as it. Credentials
            stay on this server.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Field id="git-account-label" label="Label">
              <Input
                id="git-account-label"
                placeholder="Work"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                autoFocus
              />
            </Field>
            <Field id="git-account-name" label="Author name">
              <Input
                id="git-account-name"
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
              />
            </Field>
            <Field id="git-account-email" label="Author email">
              <Input
                id="git-account-email"
                type="email"
                value={authorEmail}
                onChange={(event) => setAuthorEmail(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="git-account-forge" label="Forge">
                <Select
                  value={forge}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    const preset = GIT_ACCOUNT_FORGES.find((entry) => entry.kind === value);
                    setForge(value);
                    if (preset?.host) setHost(preset.host);
                  }}
                >
                  <SelectTrigger id="git-account-forge" size="sm" aria-label="Forge">
                    <SelectValue>
                      {(value: string | null) =>
                        GIT_ACCOUNT_FORGES.find((entry) => entry.kind === value)?.label ?? value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {GIT_ACCOUNT_FORGES.map((entry) => (
                      <SelectItem key={entry.kind} value={entry.kind}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              <Field id="git-account-host" label="Host">
                <Input
                  id="git-account-host"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                />
              </Field>
            </div>
            {cliLoginSupported ? (
              <Field id="git-account-kind" label="Sign in with">
                <ToggleGroup
                  aria-label="Sign in with"
                  value={[kind]}
                  onValueChange={(values) => {
                    const next = values[0];
                    if (next === "token" || next === "cliLogin") setCredentialKind(next);
                  }}
                >
                  <ToggleGroupItem value="token">Token</ToggleGroupItem>
                  <ToggleGroupItem value="cliLogin">gh login</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            ) : null}
            {kind === "token" ? (
              <Field id="git-account-token" label="Token">
                <SecretInput
                  id="git-account-token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </Field>
            ) : (
              <Field id="git-account-login" label="gh login">
                <Input
                  id="git-account-login"
                  placeholder="The user name shown by gh auth status"
                  value={cliLogin}
                  onChange={(event) => setCliLogin(event.target.value)}
                />
              </Field>
            )}
            <Field id="git-account-ssh" label="SSH key (optional)">
              <Input
                id="git-account-ssh"
                placeholder="~/.ssh/id_work on this server"
                value={sshKeyPath}
                onChange={(event) => setSshKeyPath(event.target.value)}
              />
            </Field>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {editing ? "Save" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function Field(props: {
  readonly id: string;
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
    </div>
  );
}
