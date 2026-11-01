import {
  type GitAccountConfig,
  GitAccountId,
  type GitAccountMachineIdentity,
  type GitAccountThreadStatus,
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
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

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
    /** `forWorkspace` plus `requireUsable`; `null` also when the thread bypassed the problem. */
    readonly forRemote: (input: {
      readonly cwd: string;
      readonly threadId?: ThreadId | undefined;
      readonly projectId?: ProjectId | undefined;
      readonly remoteUrl: string | null;
    }) => Effect.Effect<LaunchIdentity | null, GitAccountUnavailable>;
    /** `draftProjectId` stands in for a thread the server hasn't created yet. */
    readonly threadStatus: (
      threadId: ThreadId,
      draftProjectId?: ProjectId,
    ) => Effect.Effect<GitAccountThreadStatus>;
    /** A bypass lasts until the account works again or its settings change. */
    readonly setThreadBypass: (
      threadId: ThreadId,
      bypass: boolean,
      draftProjectId?: ProjectId,
    ) => Effect.Effect<GitAccountThreadStatus>;
    /** Threads whose bypass started or ended, so open terminals can refresh. */
    readonly bypassChanges: Stream.Stream<ThreadId>;
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
const STORE_UNAVAILABLE = "store-unavailable";

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

  const bypasses = new Map<ThreadId, string>();
  const bypassPubSub = yield* PubSub.unbounded<ThreadId>();
  const clearBypass = (threadId: ThreadId) =>
    bypasses.delete(threadId) ? PubSub.publish(bypassPubSub, threadId) : Effect.void;

  // A bypass key is the identity's fingerprint, plus `@<host>` when the problem is the remote's host.
  const bypassedBy = (threadId: ThreadId, identity: LaunchIdentity) => {
    const held = bypasses.get(threadId);
    return held === identity.fingerprint || held?.startsWith(`${identity.fingerprint}@`) === true;
  };

  const withBypass = Effect.fn("GitAccounts.withBypass")(function* (
    threadId: ThreadId,
    identity: LaunchIdentity | null,
  ) {
    if (!bypasses.has(threadId)) return identity;
    if (identity !== null && bypassedBy(threadId, identity)) return null;
    yield* clearBypass(threadId);
    return identity;
  });

  const storeUnavailableIdentity = (): LaunchIdentity => {
    const unavailable = new GitAccountUnavailable({
      accountLabel: "this project's account",
      reason: "T3 Code couldn't read which project this thread belongs to",
    });
    return {
      accountId: GitAccountId.make("unknown"),
      label: unavailable.accountLabel,
      authorName: "",
      authorEmail: "",
      forge: "github",
      host: "",
      fingerprint: STORE_UNAVAILABLE,
      overlay: missingAccountOverlay(unavailable.message),
      token: null,
      unavailable,
    };
  };

  // A store read failure resolves to a blocked identity, never to the machine login.
  const identityForThread = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed(storeUnavailableIdentity()),
        onSuccess: (thread) => forProject(thread?.projectId ?? null),
      }),
    );

  const forThread: GitAccounts["Service"]["forThread"] = Effect.fn("GitAccounts.forThread")(
    function* (threadId) {
      return yield* withBypass(threadId, yield* identityForThread(threadId));
    },
  );

  const forWorkspace: GitAccounts["Service"]["forWorkspace"] = Effect.fn(
    "GitAccounts.forWorkspace",
  )(function* (input) {
    if (input.projectId !== undefined) {
      const identity = yield* forProject(input.projectId);
      return input.threadId === undefined ? identity : yield* withBypass(input.threadId, identity);
    }
    if (input.threadId !== undefined) return yield* forThread(input.threadId);
    return yield* projects.findActiveByWorkspaceRoot(input.cwd).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed(storeUnavailableIdentity()),
        onSuccess: (project) => forProject(Option.getOrNull(project)?.projectId ?? null),
      }),
    );
  });

  const hostMismatch = (identity: LaunchIdentity, remoteUrl: string | null | undefined) => {
    const host = remoteUrl ? remoteHost(remoteUrl) : null;
    return host !== null && host !== identity.host ? host : null;
  };

  const requireUsable: GitAccounts["Service"]["requireUsable"] = Effect.fn(
    "GitAccounts.requireUsable",
  )(function* (identity, options) {
    if (identity.unavailable !== null) return yield* identity.unavailable;
    const host = hostMismatch(identity, options?.remoteUrl);
    if (host !== null) {
      return yield* new GitAccountUnavailable({
        accountLabel: identity.label,
        reason: `it belongs to ${identity.host}, but this remote is on ${host}`,
      });
    }
  });

  const forRemote: GitAccounts["Service"]["forRemote"] = Effect.fn("GitAccounts.forRemote")(
    function* (input) {
      const identity = yield* forWorkspace(input);
      if (identity === null) return null;
      yield* requireUsable(identity, { remoteUrl: input.remoteUrl });
      return identity;
    },
  );

  const gitOutput = (cwd: string, args: ReadonlyArray<string>) =>
    process
      .run({
        operation: "GitAccounts.machineIdentity",
        command: "git",
        args,
        cwd,
        timeoutMs: 5_000,
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((output) => (output.exitCode === 0 ? output.stdout.trim() || null : null)),
        Effect.orElseSucceed(() => null),
      );

  const pushRemoteUrl = Effect.fn("GitAccounts.pushRemoteUrl")(function* (cwd: string) {
    const upstream = yield* gitOutput(cwd, ["rev-parse", "--abbrev-ref", "@{push}"]);
    const remote = upstream?.split("/")[0] ?? "origin";
    return yield* gitOutput(cwd, ["remote", "get-url", "--push", remote]);
  });

  const forgeLogin = (cwd: string, host: string) =>
    process
      .run({
        operation: "GitAccounts.machineIdentity",
        command: "gh",
        args: ["auth", "status", "--active", "--hostname", host],
        cwd,
        env: { GH_PROMPT_DISABLED: "1" },
        timeoutMs: 5_000,
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map(
          (output) => /account (\S+)/.exec(`${output.stdout}\n${output.stderr}`)?.[1] ?? null,
        ),
        Effect.orElseSucceed(() => null),
      );

  const machineIdentity = Effect.fn("GitAccounts.machineIdentity")(function* (
    cwd: string | null,
    host: string | null,
  ) {
    const at = cwd ?? ".";
    return {
      authorName: yield* gitOutput(at, ["config", "user.name"]),
      authorEmail: yield* gitOutput(at, ["config", "user.email"]),
      host,
      forgeLogin: host === null ? null : yield* forgeLogin(at, host),
    } satisfies GitAccountMachineIdentity;
  });

  const problemFor = Effect.fn("GitAccounts.problemFor")(function* (
    threadId: ThreadId,
    draftProjectId: ProjectId | undefined,
  ) {
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.option);
    if (Option.isNone(thread)) {
      const identity = storeUnavailableIdentity();
      return {
        identity,
        cwd: null,
        problem: { key: identity.fingerprint, reason: identity.unavailable!.reason, host: null },
      };
    }
    const projectId = thread.value?.projectId ?? draftProjectId ?? null;
    const identity = yield* forProject(projectId);
    if (identity === null) return { identity, cwd: null, problem: null };
    const project =
      projectId === null
        ? Option.none()
        : yield* projects.get(projectId).pipe(Effect.orElseSucceed(() => Option.none()));
    const cwd = thread.value?.worktreePath ?? Option.getOrNull(project)?.workspaceRoot ?? null;
    if (identity.unavailable !== null) {
      return {
        identity,
        cwd,
        problem: {
          key: identity.fingerprint,
          reason: identity.unavailable.reason,
          host: identity.host === "" ? null : identity.host,
        },
      };
    }
    const host = cwd === null ? null : hostMismatch(identity, yield* pushRemoteUrl(cwd));
    return {
      identity,
      cwd,
      problem:
        host === null
          ? null
          : {
              key: `${identity.fingerprint}@${host}`,
              reason: `it belongs to ${identity.host}, but this thread's remote is on ${host}`,
              host,
            },
    };
  });

  const threadStatus: GitAccounts["Service"]["threadStatus"] = Effect.fn(
    "GitAccounts.threadStatus",
  )(function* (threadId, draftProjectId) {
    const { identity, cwd, problem } = yield* problemFor(threadId, draftProjectId);
    const account = {
      accountId:
        identity === null || identity.fingerprint === STORE_UNAVAILABLE ? null : identity.accountId,
      accountLabel: identity?.label ?? null,
    };
    if (identity === null || problem === null) {
      yield* clearBypass(threadId);
      return {
        state: identity === null ? "none" : "ready",
        ...account,
        reason: null,
        machine: null,
      } satisfies GitAccountThreadStatus;
    }
    const held = bypasses.get(threadId);
    if (held !== undefined && held !== problem.key) yield* clearBypass(threadId);
    return {
      state: held === problem.key ? "bypassed" : "unavailable",
      ...account,
      reason: problem.reason,
      machine: yield* machineIdentity(cwd, problem.host),
    } satisfies GitAccountThreadStatus;
  });

  const setThreadBypass: GitAccounts["Service"]["setThreadBypass"] = Effect.fn(
    "GitAccounts.setThreadBypass",
  )(function* (threadId, bypass, draftProjectId) {
    if (!bypass) {
      yield* clearBypass(threadId);
      return yield* threadStatus(threadId, draftProjectId);
    }
    const { problem } = yield* problemFor(threadId, draftProjectId);
    if (problem !== null && bypasses.get(threadId) !== problem.key) {
      bypasses.set(threadId, problem.key);
      yield* PubSub.publish(bypassPubSub, threadId);
    }
    return yield* threadStatus(threadId, draftProjectId);
  });

  return GitAccounts.of({
    forProject,
    forThread,
    forWorkspace,
    requireUsable,
    forRemote,
    threadStatus,
    setThreadBypass,
    bypassChanges: Stream.fromPubSub(bypassPubSub),
  });
});

export const layer = Layer.effect(GitAccounts, make);
