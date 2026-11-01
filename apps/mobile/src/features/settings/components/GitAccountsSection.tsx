import {
  GIT_ACCOUNT_FORGES,
  gitAccountIdFromLabel,
  projectsUsingGitAccount,
} from "@t3tools/client-runtime/git-accounts";
import {
  type GitAccountConfig,
  type GitAccountId,
  type ServerSettings,
  type ServerSettingsPatch,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { confirm } from "../../../components/ui/Dialog";
import { ListActionRow } from "../../../components/ui/ListActionRow";
import { ListChoiceRow } from "../../../components/ui/ListChoiceRow";
import { SettingsSection } from "./SettingsSection";

const INPUT_CLASS = "min-h-10 rounded-xl px-3 py-2 text-base text-foreground";

/** Accounts live on one environment's server; the screen shows this only for a single environment. */
export function GitAccountsSection(props: {
  readonly settings: Pick<
    ServerSettings,
    "gitAccounts" | "gitAccountId" | "projectSettingsOverrides"
  >;
  readonly disabled: boolean;
  readonly onChange: (patch: ServerSettingsPatch) => void;
}) {
  const [adding, setAdding] = useState(false);
  const entries = Object.entries(props.settings.gitAccounts) as Array<
    [GitAccountId, GitAccountConfig]
  >;

  const remove = (id: GitAccountId, account: GitAccountConfig) => {
    const projects = projectsUsingGitAccount(props.settings, id);
    const isDefault = props.settings.gitAccountId === id;
    confirm({
      title: `Remove ${account.label}?`,
      message:
        projects === 0 && !isDefault
          ? "No project uses this account. Its saved token is deleted from this server."
          : "Projects that use it will have commits, pushes and pull requests blocked until another account is picked.",
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => props.onChange({ gitAccounts: { [id]: null } }),
    });
  };

  return (
    <SettingsSection title="Git accounts">
      {entries.map(([id, account]) => (
        <ListActionRow
          key={id}
          label={account.label}
          description={`${account.authorName} · ${account.authorEmail} · ${account.host}`}
          detail="Remove"
          tone="danger"
          disabled={props.disabled}
          onPress={() => remove(id, account)}
        />
      ))}
      {adding ? (
        <AddGitAccountForm
          accounts={props.settings.gitAccounts}
          onCancel={() => setAdding(false)}
          onSave={(patch) => {
            props.onChange(patch);
            setAdding(false);
          }}
        />
      ) : (
        <ListActionRow
          icon="plus"
          label="Add account"
          disabled={props.disabled}
          onPress={() => setAdding(true)}
        />
      )}
    </SettingsSection>
  );
}

function AddGitAccountForm(props: {
  readonly accounts: ServerSettings["gitAccounts"];
  readonly onCancel: () => void;
  readonly onSave: (patch: ServerSettingsPatch) => void;
}) {
  const [label, setLabel] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [forge, setForge] = useState<string>("github");
  const [host, setHost] = useState("github.com");
  const [useLogin, setUseLogin] = useState(false);
  const [token, setToken] = useState("");
  const [cliLogin, setCliLogin] = useState("");
  const loginAllowed = forge === "github";
  const kind = loginAllowed && useLogin ? "cliLogin" : "token";
  const ready =
    label.trim() !== "" &&
    authorName.trim() !== "" &&
    authorEmail.trim() !== "" &&
    host.trim() !== "" &&
    (kind === "token" ? token.trim() !== "" : cliLogin.trim() !== "");

  const field = (input: {
    readonly label: string;
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly secret?: boolean;
  }) => (
    <AppTextInput
      accessibilityLabel={input.label}
      placeholder={input.label}
      value={input.value}
      onChangeText={input.onChange}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={input.secret === true}
      className={INPUT_CLASS}
    />
  );

  return (
    <View className="gap-2 px-4 py-3">
      <Text className="text-sm text-foreground-muted">
        Projects that use this account commit, push and open pull requests as it. Credentials stay
        on this server.
      </Text>
      {field({ label: "Label", value: label, onChange: setLabel })}
      {field({ label: "Author name", value: authorName, onChange: setAuthorName })}
      {field({ label: "Author email", value: authorEmail, onChange: setAuthorEmail })}
      {GIT_ACCOUNT_FORGES.map((entry, index) => (
        <ListChoiceRow
          key={entry.kind}
          label={entry.label}
          selected={forge === entry.kind}
          separated={index > 0}
          onPress={() => {
            setForge(entry.kind);
            setHost(entry.host);
          }}
        />
      ))}
      {field({ label: "Host", value: host, onChange: setHost })}
      {loginAllowed ? (
        <>
          <ListChoiceRow label="Token" selected={!useLogin} onPress={() => setUseLogin(false)} />
          <ListChoiceRow
            label="gh login on this server"
            selected={useLogin}
            separated
            onPress={() => setUseLogin(true)}
          />
        </>
      ) : null}
      {kind === "token"
        ? field({ label: "Token", value: token, onChange: setToken, secret: true })
        : field({ label: "gh login", value: cliLogin, onChange: setCliLogin })}
      <ListActionRow
        label="Save account"
        disabled={!ready}
        onPress={() =>
          props.onSave({
            gitAccounts: {
              [gitAccountIdFromLabel(label, props.accounts)]: {
                label: label.trim(),
                authorName: authorName.trim(),
                authorEmail: authorEmail.trim(),
                forge: SourceControlProviderKind.make(forge),
                host: host.trim().toLowerCase(),
                credentialKind: kind,
                token: kind === "token" ? token.trim() : "",
                cliLogin: kind === "cliLogin" ? cliLogin.trim() : "",
                sshKeyPath: "",
              },
            },
          })
        }
      />
      <ListActionRow label="Cancel" onPress={props.onCancel} />
    </View>
  );
}
