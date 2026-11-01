import { GitAccountId, ProjectId, SourceControlProviderKind, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Option from "effect/Option";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { VcsProcessExitError } from "@t3tools/contracts";
import * as GitAccounts from "./GitAccounts.ts";

const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");
const work = GitAccountId.make("work");
const personal = GitAccountId.make("personal");
const github = SourceControlProviderKind.make("github");

const account = (overrides: Partial<Record<string, string>> = {}) => ({
  label: "Work",
  authorName: "Work Name",
  authorEmail: "work@example.test",
  forge: github,
  host: "github.com",
  credentialKind: "token" as const,
  token: "work-token",
  cliLogin: "",
  sshKeyPath: "",
  ...overrides,
});

// What this machine's git and gh report when a thread falls back to them.
const machineOutput = (args: ReadonlyArray<string>, remote: string) =>
  args.includes("user.name")
    ? "Machine Name\n"
    : args.includes("user.email")
      ? "machine@example.test\n"
      : args[0] === "auth" && args[1] === "status"
        ? "github.com\n  Logged in to github.com account machine-login (keyring)\n"
        : args[0] === "remote"
          ? `${remote}\n`
          : null;

const layer = (
  settings: Parameters<typeof ServerSettings.ServerSettingsService.layerTest>[0],
  remote = "git@github.com:me/repo.git",
) =>
  GitAccounts.layer.pipe(
    Layer.provideMerge(ServerSettings.ServerSettingsService.layerTest(settings)),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeedNone,
        findActiveByWorkspaceRoot: (root) =>
          Effect.succeed(
            root === "/repo/a" ? Option.some({ projectId: projectA } as never) : Option.none(),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: (threadId) =>
          threadId === "thread-broken"
            ? Effect.fail(new ProjectionStore.ProjectionStoreReadError({ threadId }))
            : Effect.succeed(
                threadId === "thread-b"
                  ? ({ projectId: projectB, worktreePath: null } as never)
                  : threadId === "thread-a" || threadId === "thread-a2"
                    ? ({ projectId: projectA, worktreePath: "/repo/a" } as never)
                    : null,
              ),
      }),
    ),
    Layer.provide(
      Layer.mock(VcsProcess.VcsProcess)({
        run: (input) =>
          input.args.includes("signed-in")
            ? Effect.succeed({ stdout: "gh-token\n", stderr: "" } as never)
            : machineOutput(input.args, remote) !== null
              ? Effect.succeed({
                  exitCode: 0,
                  stdout: machineOutput(input.args, remote),
                  stderr: "",
                } as never)
              : Effect.fail(
                  new VcsProcessExitError({
                    operation: input.operation,
                    command: "gh",
                    cwd: ".",
                    exitCode: 1,
                    detail: "no oauth token",
                  } as never),
                ),
      }),
    ),
    Layer.provide(NodeServices.layer),
  );

it.effect("resolves the project override, then the default, then none", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    assert.equal((yield* accounts.forProject(projectA))?.accountId, work);
    assert.equal((yield* accounts.forProject(projectB))?.accountId, personal);
    assert.equal((yield* accounts.forWorkspace({ cwd: "/repo/a" }))?.accountId, work);
    assert.equal((yield* accounts.forThread(ThreadId.make("thread-b")))?.accountId, personal);
  }).pipe(
    Effect.provide(
      layer({
        gitAccounts: { [work]: account(), [personal]: account({ label: "Personal", token: "p" }) },
        gitAccountId: personal,
        projectSettingsOverrides: { [projectA]: { gitAccountId: work } },
      }),
    ),
  ),
);

it.effect("keeps the machine identity when no account applies", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    assert.isNull(yield* accounts.forProject(projectA));
  }).pipe(Effect.provide(layer({ gitAccounts: { [work]: account() } }))),
);

it.effect("fails closed for a deleted account instead of using the default", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    const identity = yield* accounts.forProject(projectA);
    assert.isNotNull(identity?.unavailable);
    const error = yield* accounts.requireUsable(identity!).pipe(Effect.flip);
    assert.include(error.message, "deleted");
    assert.isNull(identity?.token);
  }).pipe(
    Effect.provide(
      layer({
        gitAccounts: { [personal]: account({ label: "Personal" }) },
        gitAccountId: personal,
        projectSettingsOverrides: { [projectA]: { gitAccountId: work } },
      }),
    ),
  ),
);

it.effect(
  "resolves a gh login and fails closed, naming the account, when it is not signed in",
  () =>
    Effect.gen(function* () {
      const accounts = yield* GitAccounts.GitAccounts;
      assert.equal((yield* accounts.forProject(projectA))?.token, "gh-token");
      const missing = yield* accounts.forProject(projectB);
      assert.isNull(missing?.token);
      assert.include(missing?.unavailable?.message ?? "", "Personal");
      assert.include(missing?.unavailable?.message ?? "", "gh has no login");
    }).pipe(
      Effect.provide(
        layer({
          gitAccounts: {
            [work]: account({ credentialKind: "cliLogin", token: "", cliLogin: "signed-in" }),
            [personal]: account({
              label: "Personal",
              credentialKind: "cliLogin",
              token: "",
              cliLogin: "other",
            }),
          },
          gitAccountId: personal,
          projectSettingsOverrides: { [projectA]: { gitAccountId: work } },
        }),
      ),
    ),
);

it.effect("blocks a remote on another host but not a project without a remote", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    const identity = (yield* accounts.forProject(projectA))!;
    yield* accounts.requireUsable(identity);
    yield* accounts.requireUsable(identity, { remoteUrl: "git@github.com:me/repo.git" });
    const error = yield* accounts
      .requireUsable(identity, { remoteUrl: "https://git.cafe/me/repo.git" })
      .pipe(Effect.flip);
    assert.include(error.message, "git.cafe");
  }).pipe(Effect.provide(layer({ gitAccounts: { [work]: account() }, gitAccountId: work }))),
);

it.effect("treats a missing SSH key as unusable", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    const identity = yield* accounts.forProject(projectA);
    assert.include(identity?.unavailable?.message ?? "", "SSH key");
  }).pipe(
    Effect.provide(
      layer({
        gitAccounts: { [work]: account({ sshKeyPath: "/definitely/missing/key" }) },
        gitAccountId: work,
      }),
    ),
  ),
);

it.effect("fails closed when the thread's project can't be read", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    const identity = yield* accounts.forThread(ThreadId.make("thread-broken"));
    assert.include(identity?.unavailable?.message ?? "", "couldn't read which project");
    assert.isNull(identity?.token);
  }).pipe(Effect.provide(layer({ gitAccounts: { [work]: account() }, gitAccountId: work }))),
);

it.effect("lets one thread bypass an unusable account as the machine login it names", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    const thread = ThreadId.make("thread-a");
    const status = yield* accounts.threadStatus(thread);
    assert.equal(status.state, "unavailable");
    assert.deepEqual(status.machine, {
      authorName: "Machine Name",
      authorEmail: "machine@example.test",
      host: "github.com",
      forgeLogin: "machine-login",
    });

    assert.equal((yield* accounts.setThreadBypass(thread, true)).state, "bypassed");
    assert.isNull(yield* accounts.forThread(thread));
    assert.isNull(
      yield* accounts.forWorkspace({ cwd: "/repo/a", threadId: thread, projectId: projectA }),
    );
    // Other threads in the project still fail closed.
    assert.isNotNull((yield* accounts.forThread(ThreadId.make("thread-a2")))?.unavailable);

    assert.equal((yield* accounts.setThreadBypass(thread, false)).state, "unavailable");
    assert.isNotNull((yield* accounts.forThread(thread))?.unavailable);
  }).pipe(
    Effect.provide(layer({ gitAccounts: { [work]: account({ token: "" }) }, gitAccountId: work })),
  ),
);

it.effect("ends a bypass once the account works again", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    const settings = yield* ServerSettings.ServerSettingsService;
    const thread = ThreadId.make("thread-a");
    yield* accounts.setThreadBypass(thread, true);
    yield* settings.updateSettings({ gitAccounts: { [work]: account({ token: "fixed" }) } });
    assert.equal((yield* accounts.forThread(thread))?.token, "fixed");
    yield* settings.updateSettings({ gitAccounts: { [work]: account({ token: "" }) } });
    assert.isNotNull((yield* accounts.forThread(thread))?.unavailable);
  }).pipe(
    Effect.provide(layer({ gitAccounts: { [work]: account({ token: "" }) }, gitAccountId: work })),
  ),
);

it.effect("bypasses a remote on another host for that thread only", () =>
  Effect.gen(function* () {
    const accounts = yield* GitAccounts.GitAccounts;
    const thread = ThreadId.make("thread-a");
    const status = yield* accounts.threadStatus(thread);
    assert.equal(status.state, "unavailable");
    assert.include(status.reason ?? "", "git.cafe");
    assert.equal(status.machine?.host, "git.cafe");
    yield* accounts.setThreadBypass(thread, true);
    const remote = { cwd: "/repo/a", threadId: thread, remoteUrl: "git@git.cafe:me/repo.git" };
    assert.isNull(yield* accounts.forRemote(remote));
    yield* accounts
      .forRemote({ ...remote, threadId: ThreadId.make("thread-a2") })
      .pipe(Effect.flip);
  }).pipe(
    Effect.provide(
      layer({ gitAccounts: { [work]: account() }, gitAccountId: work }, "git@git.cafe:me/repo.git"),
    ),
  ),
);
