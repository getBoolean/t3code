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

const layer = (settings: Parameters<typeof ServerSettings.ServerSettingsService.layerTest>[0]) =>
  GitAccounts.layer.pipe(
    Layer.provide(ServerSettings.ServerSettingsService.layerTest(settings)),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        findActiveByWorkspaceRoot: (root) =>
          Effect.succeed(
            root === "/repo/a" ? Option.some({ projectId: projectA } as never) : Option.none(),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: (threadId) =>
          Effect.succeed(threadId === "thread-b" ? ({ projectId: projectB } as never) : null),
      }),
    ),
    Layer.provide(
      Layer.mock(VcsProcess.VcsProcess)({
        run: (input) =>
          input.args.includes("signed-in")
            ? Effect.succeed({ stdout: "gh-token\n", stderr: "" } as never)
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
