import {
  type GitAccountConfig,
  type GitAccountId,
  type ProjectId,
  type ServerSettings as ServerSettingsValue,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import type { EnvironmentOverlay } from "@t3tools/provider-core/server/instanceEnvironment";
import { blockedOverlay, buildOverlay, fingerprint, shellQuote } from "./launchIdentity.ts";

export class GitAccountUnavailable extends Schema.TaggedError<GitAccountUnavailable>()(
  "GitAccountUnavailable",
  { accountLabel: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `The git account "${this.accountLabel}" can't be used: ${this.reason}`;
  }
}

/** How a project's git account reaches a process; `overlay` is the blocked form when `unavailable` is set. */
export interface LaunchIdentity {
  readonly accountId: GitAccountId;
  readonly label: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly forge: string;
  readonly host: string;
  readonly fingerprint: string;
  readonly overlay: EnvironmentOverlay;
  readonly token: string | null;
  readonly unavailable: GitAccountUnavailable | null;
}

export class GitAccounts extends Context.Service<
  GitAccounts,
  {
    /** `null` when the project has no effective account, so callers keep the machine identity. */
    readonly forProject: (projectId: ProjectId | null) => Effect.Effect<LaunchIdentity | null>;
    readonly forThread: (threadId: ThreadId) => Effect.Effect<LaunchIdentity | null>;
    readonly forWorkspace: (input: {
      readonly cwd: string;
      readonly threadId?: ThreadId | undefined;
      readonly projectId?: ProjectId | undefined;
    }) => Effect.Effect<LaunchIdentity | null>;
    /** Fails closed when the identity is unusable or the remote is on another host. */
    readonly requireUsable: (
      identity: LaunchIdentity,
      options?: { readonly remoteUrl?: string | null | undefined },
    ) => Effect.Effect<void, GitAccountUnavailable>;
  }
>()("t3/gitAccounts/GitAccounts") {}

function remoteHost(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const scp = /^[^@/:]+@([^:/]+):/.exec(trimmed);
  if (scp) return scp[1]!.toLowerCase();
  try {
    const url = new URL(trimmed);
    return url.hostname ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Without the account its host is unknown, so transport is blocked for every host. */
const missingAccountOverlay = (message: string): EnvironmentOverlay => {
  const fail = `echo ${shellQuote(message)} >&2; false`;
  return {
    set: { GIT_TERMINAL_PROMPT: "0" },
    unset: ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"],
    gitConfig: [
      ["user.name", ""],
      ["user.email", ""],
      ["user.useConfigOnly", "true"],
      ["credential.helper", ""],
      ["credential.helper", `!f() { ${fail}; }; f`],
      ["core.sshCommand", fail],
    ],
  };
};

const LOGIN_TOKEN_TTL_MS = 30_000;

const accountIdFor = (settings: ServerSettingsValue, projectId: ProjectId | null) =>
  resolveProjectSettings(settings, projectId).settings.gitAccountId;

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const fileSystem = yield* FileSystem.FileSystem;
  const process = yield* VcsProcess.VcsProcess;

  // Every turn, terminal and forge call resolves the account; don't spawn gh for each one.
  const cachedLoginTokens = new Map<string, { readonly token: string; readonly at: number }>();
  const cliLoginToken = Effect.fn("GitAccounts.cliLoginToken")(function* (
    account: GitAccountConfig,
  ) {
    const cacheKey = `${account.host}\0${account.cliLogin}`;
    const now = yield* Clock.currentTimeMillis;
    const cached = cachedLoginTokens.get(cacheKey);
    if (cached !== undefined && now - cached.at < LOGIN_TOKEN_TTL_MS) return cached.token;
    if (account.forge !== "github") {
      return yield* Effect.fail(
        `machine logins are supported for GitHub accounts; save a token for ${account.forge}`,
      );
    }
    const output = yield* process
      .run({
        operation: "GitAccounts.cliLoginToken",
        command: "gh",
        args: ["auth", "token", "--hostname", account.host, "--user", account.cliLogin],
        cwd: ".",
        env: { GH_DEBUG: "", GH_PROMPT_DISABLED: "1" },
        timeoutMs: 10_000,
      })
      .pipe(Effect.mapError(() => `gh has no login "${account.cliLogin}" for ${account.host}`));
    const token = output.stdout.trim();
    if (token === "")
      return yield* Effect.fail(`gh has no login "${account.cliLogin}" for ${account.host}`);
    cachedLoginTokens.set(cacheKey, { token, at: now });
    return token;
  });

  const identityFor = Effect.fn("GitAccounts.identityFor")(
    function* (id: GitAccountId, account: GitAccountConfig | undefined) {
      if (account === undefined) {
        const unavailable = new GitAccountUnavailable({
          accountLabel: id,
          reason: "it was deleted; pick another account for this project",
        });
        return {
          accountId: id,
          label: id,
          authorName: "",
          authorEmail: "",
          forge: "github",
          host: "",
          fingerprint: `missing:${id}`,
          overlay: missingAccountOverlay(unavailable.message),
          token: null,
          unavailable,
        } satisfies LaunchIdentity;
      }
      const token =
        account.credentialKind === "token"
          ? account.token === ""
            ? yield* Effect.fail("it has no saved token")
            : account.token
          : yield* cliLoginToken(account);
      if (
        account.sshKeyPath !== "" &&
        !(yield* fileSystem.exists(account.sshKeyPath).pipe(Effect.orElseSucceed(() => false)))
      ) {
        return yield* Effect.fail(`its SSH key ${account.sshKeyPath} is missing`);
      }
      return {
        accountId: id,
        label: account.label,
        authorName: account.authorName,
        authorEmail: account.authorEmail,
        forge: account.forge,
        host: account.host.toLowerCase(),
        fingerprint: fingerprint({ id, account, token }),
        overlay: buildOverlay({ id, account, token }),
        token,
        unavailable: null,
      } satisfies LaunchIdentity;
    },
    (effect, id, account) =>
      Effect.catch(effect, (reason: string) =>
        Effect.succeed({
          accountId: id,
          label: account!.label,
          authorName: account!.authorName,
          authorEmail: account!.authorEmail,
          forge: account!.forge,
          host: account!.host.toLowerCase(),
          fingerprint: `unavailable:${fingerprint({ id, account: account!, token: "" })}`,
          overlay: blockedOverlay({ account: account!, reason }),
          token: null,
          unavailable: new GitAccountUnavailable({ accountLabel: account!.label, reason }),
        } satisfies LaunchIdentity),
      ),
  );

  const forProject: GitAccounts["Service"]["forProject"] = Effect.fn("GitAccounts.forProject")(
    function* (projectId) {
      const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
      const id = accountIdFor(settings, projectId);
      if (id === null) return null;
      return yield* identityFor(id, settings.gitAccounts[id]);
    },
  );

  const projectIdForThread = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.map((thread) => thread?.projectId ?? null),
      Effect.orElseSucceed(() => null),
    );

  const forThread: GitAccounts["Service"]["forThread"] = Effect.fn("GitAccounts.forThread")(
    function* (threadId) {
      return yield* forProject(yield* projectIdForThread(threadId));
    },
  );

  const forWorkspace: GitAccounts["Service"]["forWorkspace"] = Effect.fn(
    "GitAccounts.forWorkspace",
  )(function* (input) {
    const fromThread =
      input.threadId === undefined ? null : yield* projectIdForThread(input.threadId);
    const projectId =
      fromThread ??
      input.projectId ??
      (yield* projects.findActiveByWorkspaceRoot(input.cwd).pipe(
        Effect.map((project) => Option.getOrNull(project)?.projectId ?? null),
        Effect.orElseSucceed(() => null),
      ));
    return yield* forProject(projectId);
  });

  const requireUsable: GitAccounts["Service"]["requireUsable"] = Effect.fn(
    "GitAccounts.requireUsable",
  )(function* (identity, options) {
    if (identity.unavailable !== null) return yield* identity.unavailable;
    const host = options?.remoteUrl ? remoteHost(options.remoteUrl) : null;
    if (host !== null && host !== identity.host) {
      return yield* new GitAccountUnavailable({
        accountLabel: identity.label,
        reason: `it belongs to ${identity.host}, but this remote is on ${host}`,
      });
    }
  });

  return GitAccounts.of({ forProject, forThread, forWorkspace, requireUsable });
});

export const layer = Layer.effect(GitAccounts, make);
