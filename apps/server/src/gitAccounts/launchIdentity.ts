// Fork: Overlay author, forge, SSH, and credential-helper identity while removing inherited credentials; blocked accounts must not silently use the machine login.
import type { GitAccountConfig } from "@t3tools/contracts";
import type { EnvironmentOverlay } from "@t3tools/provider-core/server/instanceEnvironment";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- a synchronous hash keeps overlay building pure.
import * as NodeCrypto from "node:crypto";

type OverlayAccount = Omit<GitAccountConfig, "forge"> & { readonly forge: string };

interface ForgeEnvironment {
  readonly tokenVariables: (host: string) => Readonly<Record<string, string>>;
  readonly inheritedTokenVariables: ReadonlyArray<string>;
  readonly username: string;
}

const UNAVAILABLE_TOKEN = "t3code-git-account-unavailable";
const TOKEN_VARIABLE = "T3CODE_GIT_ACCOUNT_TOKEN";

const forges: Readonly<Record<string, ForgeEnvironment>> = {
  github: {
    tokenVariables: (host) =>
      host === "github.com" ? { GH_TOKEN: "" } : { GH_ENTERPRISE_TOKEN: "", GH_HOST: host },
    inheritedTokenVariables: [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GH_ENTERPRISE_TOKEN",
      "GITHUB_ENTERPRISE_TOKEN",
    ],
    username: "x-access-token",
  },
  gitlab: {
    tokenVariables: (host) => ({ GITLAB_TOKEN: "", GITLAB_HOST: host }),
    inheritedTokenVariables: ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN", "OAUTH_TOKEN"],
    username: "oauth2",
  },
  forgejo: {
    tokenVariables: (host) => ({ GITEA_SERVER_TOKEN: "", GITEA_SERVER_URL: `https://${host}` }),
    inheritedTokenVariables: ["GITEA_SERVER_TOKEN", "GITEA_TOKEN"],
    username: "t3code",
  },
  bitbucket: {
    tokenVariables: () => ({ T3CODE_BITBUCKET_ACCESS_TOKEN: "" }),
    inheritedTokenVariables: [
      "T3CODE_BITBUCKET_ACCESS_TOKEN",
      "T3CODE_BITBUCKET_EMAIL",
      "T3CODE_BITBUCKET_API_TOKEN",
    ],
    username: "x-token-auth",
  },
  "azure-devops": {
    tokenVariables: () => ({ AZURE_DEVOPS_EXT_PAT: "" }),
    inheritedTokenVariables: ["AZURE_DEVOPS_EXT_PAT"],
    username: "t3code",
  },
  gitcafe: {
    tokenVariables: (host) => ({ CAFE_TOKEN: "", CAFE_HOST: host }),
    inheritedTokenVariables: ["CAFE_TOKEN"],
    username: "t3code",
  },
};

const forgeFor = (account: OverlayAccount): ForgeEnvironment =>
  forges[account.forge] ?? forges.github!;

/** Single-quotes a value for the POSIX shell git uses to run `!` helpers and `core.sshCommand`. */
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const tokenVariablesFor = (account: OverlayAccount, token: string) =>
  Object.fromEntries(
    Object.entries(forgeFor(account).tokenVariables(account.host)).map(([name, value]) => [
      name,
      value === "" ? token : value,
    ]),
  );

const helperKey = (host: string) => `credential.https://${host}.helper`;

export function buildOverlay(input: {
  readonly id: string;
  readonly account: OverlayAccount;
  readonly token: string;
}): EnvironmentOverlay {
  const { account, token } = input;
  const forge = forgeFor(account);
  const rejected = `T3 Code: ${account.host} rejected the git account "${account.label}". Update it in Settings > Source Control.`;
  const helper =
    `!f() { if [ "$1" = get ]; then echo username=${forge.username}; echo "password=$${TOKEN_VARIABLE}"; ` +
    `elif [ "$1" = erase ]; then echo ${shellQuote(rejected)} >&2; fi; }; f`;
  const sshKey = account.sshKeyPath.replaceAll("\\", "/");
  const gitConfig: Array<readonly [string, string]> = [
    [helperKey(account.host), ""],
    [helperKey(account.host), helper],
  ];
  if (sshKey === "") {
    gitConfig.push(
      [`url.https://${account.host}/.insteadOf`, `git@${account.host}:`],
      [`url.https://${account.host}/.insteadOf`, `ssh://git@${account.host}/`],
    );
  } else {
    gitConfig.push(
      [`url.git@${account.host}:.insteadOf`, `https://${account.host}/`],
      [
        "core.sshCommand",
        `ssh -i ${shellQuote(sshKey)} -o IdentitiesOnly=yes -o IdentityAgent=none`,
      ],
    );
  }
  return {
    set: {
      GIT_AUTHOR_NAME: account.authorName,
      GIT_AUTHOR_EMAIL: account.authorEmail,
      GIT_COMMITTER_NAME: account.authorName,
      GIT_COMMITTER_EMAIL: account.authorEmail,
      [TOKEN_VARIABLE]: token,
      ...tokenVariablesFor(account, token),
    },
    unset: forge.inheritedTokenVariables,
    gitConfig,
  };
}

/** The environment for an account that can't be used: reads work, commits, pushes and forge calls fail naming it. */
export function blockedOverlay(input: {
  readonly account: OverlayAccount;
  readonly reason: string;
}): EnvironmentOverlay {
  const { account } = input;
  const message = `T3 Code: the git account "${account.label}" can't be used: ${input.reason}`;
  const fail = `echo ${shellQuote(message)} >&2; false`;
  return {
    set: { GIT_TERMINAL_PROMPT: "0", ...tokenVariablesFor(account, UNAVAILABLE_TOKEN) },
    unset: [
      ...forgeFor(account).inheritedTokenVariables,
      "GIT_AUTHOR_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_NAME",
      "GIT_COMMITTER_EMAIL",
    ],
    gitConfig: [
      ["user.name", ""],
      ["user.email", ""],
      ["user.useConfigOnly", "true"],
      [helperKey(account.host), ""],
      [helperKey(account.host), `!f() { ${fail}; }; f`],
      ["core.sshCommand", fail],
    ],
  };
}

/** Changes whenever anything that shapes the launch changes; never contains the secret. */
export function fingerprint(input: {
  readonly id: string;
  readonly account: OverlayAccount;
  readonly token: string;
}): string {
  const { account } = input;
  return NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify([
        input.id,
        account.authorName,
        account.authorEmail,
        account.forge,
        account.host,
        account.credentialKind,
        account.cliLogin,
        account.sshKeyPath,
        NodeCrypto.createHash("sha256").update(input.token).digest("hex"),
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}
