// Fork: Keep regression coverage for run each project as its own git account (#1).
// @effect-diagnostics nodeBuiltinImport:off - checks the overlay against a real git subprocess.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { applyEnvironmentOverlay } from "@t3tools/provider-core/server/instanceEnvironment";
import { blockedOverlay, buildOverlay, fingerprint } from "./launchIdentity.ts";

const account = {
  label: "Work",
  authorName: "Work Name",
  authorEmail: "work@example.test",
  forge: "github",
  host: "github.com",
  credentialKind: "token",
  token: "work-token",
  cliLogin: "",
  sshKeyPath: "",
} as const;

const configEntries = (env: Readonly<Record<string, string | undefined>>) => {
  const count = Number(env.GIT_CONFIG_COUNT ?? "0");
  return Array.from({ length: count }, (_, index) => [
    env[`GIT_CONFIG_KEY_${index}`],
    env[`GIT_CONFIG_VALUE_${index}`],
  ]);
};

describe("buildOverlay", () => {
  it("sets the identity, a host-scoped helper, an SSH-to-HTTPS rewrite and GH_TOKEN for a token account", () => {
    const env = applyEnvironmentOverlay(
      { GH_TOKEN: "machine-token", GITHUB_TOKEN: "machine-token", PATH: "/bin" },
      buildOverlay({ id: "work", account, token: "work-token" }),
    );
    expect(env).toMatchObject({
      GIT_AUTHOR_NAME: "Work Name",
      GIT_AUTHOR_EMAIL: "work@example.test",
      GIT_COMMITTER_NAME: "Work Name",
      GIT_COMMITTER_EMAIL: "work@example.test",
      GH_TOKEN: "work-token",
      PATH: "/bin",
    });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    const entries = configEntries(env);
    expect(entries).toContainEqual(["credential.https://github.com.helper", ""]);
    expect(
      entries.find(
        ([key, value]) => key === "credential.https://github.com.helper" && value !== "",
      )?.[1],
    ).toContain("Work");
    expect(entries).toContainEqual(["url.https://github.com/.insteadOf", "git@github.com:"]);
    expect(entries).toContainEqual(["url.https://github.com/.insteadOf", "ssh://git@github.com/"]);
  });

  it("uses GH_ENTERPRISE_TOKEN with GH_HOST for a GitHub Enterprise host", () => {
    const env = applyEnvironmentOverlay(
      {},
      buildOverlay({ id: "work", account: { ...account, host: "ghe.example.test" }, token: "t" }),
    );
    expect(env.GH_ENTERPRISE_TOKEN).toBe("t");
    expect(env.GH_HOST).toBe("ghe.example.test");
    expect(env.GH_TOKEN).toBeUndefined();
  });

  it("adds the SSH key and an HTTPS-to-SSH rewrite while keeping the forge token", () => {
    const env = applyEnvironmentOverlay(
      {},
      buildOverlay({ id: "work", account: { ...account, sshKeyPath: "/keys/work" }, token: "t" }),
    );
    const entries = configEntries(env);
    expect(entries.find(([key]) => key === "core.sshCommand")?.[1]).toContain("IdentitiesOnly=yes");
    expect(entries.find(([key]) => key === "core.sshCommand")?.[1]).toContain("/keys/work");
    expect(entries).toContainEqual(["url.git@github.com:.insteadOf", "https://github.com/"]);
    expect(env.GH_TOKEN).toBe("t");
  });

  it("appends to config entries the base environment already carries", () => {
    const env = applyEnvironmentOverlay(
      { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.longpaths", GIT_CONFIG_VALUE_0: "true" },
      buildOverlay({ id: "work", account, token: "t" }),
    );
    expect(configEntries(env)[0]).toEqual(["core.longpaths", "true"]);
    expect(configEntries(env).length).toBeGreaterThan(1);
  });

  it.each([
    ["gitlab", "gitlab.com", "GITLAB_TOKEN"],
    ["forgejo", "codeberg.org", "GITEA_SERVER_TOKEN"],
    ["azure-devops", "dev.azure.com", "AZURE_DEVOPS_EXT_PAT"],
    ["bitbucket", "bitbucket.org", "T3CODE_BITBUCKET_ACCESS_TOKEN"],
    ["gitcafe", "git.cafe", "CAFE_TOKEN"],
  ])("sets the %s CLI token variable", (forge, host, variable) => {
    const env = applyEnvironmentOverlay(
      {},
      buildOverlay({ id: "a", account: { ...account, forge, host }, token: "t" }),
    );
    expect(env[variable]).toBe("t");
  });
});

describe("blockedOverlay", () => {
  it("empties the identity, fails the helper and SSH, and strips the host's forge tokens", () => {
    const env = applyEnvironmentOverlay(
      { GH_TOKEN: "machine-token" },
      blockedOverlay({ account, reason: "Work's token was revoked" }),
    );
    const entries = configEntries(env);
    expect(entries).toContainEqual(["user.name", ""]);
    expect(entries).toContainEqual(["user.email", ""]);
    expect(entries.find(([key]) => key === "core.sshCommand")?.[1]).toContain("Work");
    expect(env.GH_TOKEN).not.toBe("machine-token");
    expect(env.GIT_AUTHOR_NAME).toBeUndefined();
  });
});

describe("fingerprint", () => {
  it("changes with the token, name, email or host but not the label", () => {
    const base = fingerprint({ id: "work", account, token: "t" });
    expect(fingerprint({ id: "work", account: { ...account, label: "Renamed" }, token: "t" })).toBe(
      base,
    );
    expect(fingerprint({ id: "work", account, token: "t2" })).not.toBe(base);
    expect(
      fingerprint({ id: "work", account: { ...account, authorEmail: "x@y.z" }, token: "t" }),
    ).not.toBe(base);
    expect(
      fingerprint({ id: "work", account: { ...account, authorName: "Other" }, token: "t" }),
    ).not.toBe(base);
    expect(
      fingerprint({ id: "work", account: { ...account, host: "ghe.test" }, token: "t" }),
    ).not.toBe(base);
    expect(base).not.toContain("t");
  });
});

describe("overlay with real git", () => {
  const git = (
    cwd: string,
    env: Readonly<Record<string, string | undefined>>,
    args: string[],
    input?: string,
  ) => NodeChildProcess.spawnSync("git", args, { cwd, env: { ...env }, input, encoding: "utf8" });
  const repo = () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-git-account-"));
    git(dir, process.env, ["init", "-q"]);
    NodeFS.writeFileSync(NodePath.join(dir, "file.txt"), "content");
    git(dir, process.env, ["add", "file.txt"]);
    return dir;
  };
  const machineEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "Machine",
    GIT_CONFIG_KEY_1: "user.email",
    GIT_CONFIG_VALUE_1: "machine@example.test",
  };

  it("authors commits as the account and answers credential requests with its token", () => {
    const dir = repo();
    const env = applyEnvironmentOverlay(
      machineEnv,
      buildOverlay({ id: "work", account, token: "work-token" }),
    );
    expect(git(dir, env, ["commit", "-q", "-m", "x"]).status).toBe(0);
    expect(git(dir, env, ["log", "-1", "--format=%an <%ae> / %cn <%ce>"]).stdout.trim()).toBe(
      "Work Name <work@example.test> / Work Name <work@example.test>",
    );
    const filled = git(dir, env, ["credential", "fill"], "protocol=https\nhost=github.com\n\n");
    expect(filled.stdout).toContain("password=work-token");
    expect(filled.stdout).toContain("username=x-access-token");
  });

  it("refuses to commit or authenticate under the blocked overlay even with a machine identity", () => {
    const dir = repo();
    const env = applyEnvironmentOverlay(machineEnv, blockedOverlay({ account, reason: "revoked" }));
    const commit = git(dir, env, ["commit", "-q", "-m", "x"]);
    expect(commit.status).not.toBe(0);
    const filled = git(
      dir,
      { ...env, GIT_TERMINAL_PROMPT: "0" },
      ["credential", "fill"],
      "protocol=https\nhost=github.com\n\n",
    );
    expect(filled.stdout).not.toContain("password=");
    expect(filled.stderr).toContain("Work");
  });
});
