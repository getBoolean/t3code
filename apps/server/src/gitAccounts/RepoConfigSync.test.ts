// @effect-diagnostics nodeBuiltinImport:off - inspects real repos with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { GitAccountId, ProjectId, SourceControlProviderKind } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as RepoConfigSync from "./RepoConfigSync.ts";

const projectId = ProjectId.make("project-a");
const work = GitAccountId.make("work");
const personal = GitAccountId.make("personal");

const account = (label: string) => ({
  label,
  authorName: `${label} Name`,
  authorEmail: `${label.toLowerCase()}@example.test`,
  forge: SourceControlProviderKind.make("github"),
  host: "github.com",
  credentialKind: "token" as const,
  token: "token",
  cliLogin: "",
  sshKeyPath: "",
});

const git = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });

const makeRepo = (prior: { readonly name: string; readonly email: string } | null) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-repo-config-"));
  git(dir, ["init", "-q"]);
  if (prior !== null) {
    git(dir, ["config", "--local", "user.name", prior.name]);
    git(dir, ["config", "--local", "user.email", prior.email]);
  }
  return dir;
};

const localConfig = (dir: string) =>
  Object.fromEntries(
    git(dir, ["config", "--local", "--list"])
      .stdout.split("\n")
      .filter((line) => line.startsWith("user.") || line.startsWith("t3code."))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );

const layer = (dir: string, settings: Parameters<typeof ServerSettings.layerTest>[0]) =>
  RepoConfigSync.layer.pipe(
    Layer.provideMerge(ServerSettings.layerTest(settings)),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        list: () => Effect.succeed([{ projectId, workspaceRoot: dir } as never]),
      }),
    ),
    Layer.provide(VcsProcess.layer),
    Layer.provide(NodeServices.layer),
  );

it.effect(
  "writes the account identity, keeps the saved values across changes, then restores them",
  () => {
    const dir = makeRepo({ name: "Prior", email: "prior@example.test" });
    return Effect.gen(function* () {
      const sync = yield* RepoConfigSync.RepoConfigSync;
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* sync.start();
      expect(localConfig(dir)).toEqual({
        "user.name": "Work Name",
        "user.email": "work@example.test",
        "t3code.saveduseridentity": "true",
        "t3code.previoususername": "Prior",
        "t3code.previoususeremail": "prior@example.test",
      });

      yield* sync.apply(
        yield* settings.updateSettings({
          gitAccounts: { [personal]: account("Personal") },
          gitAccountId: personal,
        }),
      );
      expect(localConfig(dir)).toMatchObject({
        "user.name": "Personal Name",
        "user.email": "personal@example.test",
        "t3code.previoususername": "Prior",
      });

      yield* sync.apply(
        yield* settings.updateSettings({ projectSettingsOverrides: { [projectId]: null } }),
      );
      expect(localConfig(dir)).toEqual({
        "user.name": "Prior",
        "user.email": "prior@example.test",
      });
    }).pipe(
      Effect.provide(
        layer(dir, {
          gitAccounts: { [work]: account("Work") },
          gitAccountId: work,
          projectSettingsOverrides: { [projectId]: { gitAccountWritesRepoConfig: true } },
        }),
      ),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true }))),
    );
  },
);

it.effect.each([
  { exit: "turning the toggle off", patch: { gitAccountWritesRepoConfig: false } },
  { exit: "deleting the account", patch: { gitAccounts: { [work]: null } } },
  { exit: "unbinding the project", patch: { gitAccountId: null } },
] as const)("unsets the identity it wrote into a repo that had none after $exit", ({ patch }) => {
  const dir = makeRepo(null);
  return Effect.gen(function* () {
    const sync = yield* RepoConfigSync.RepoConfigSync;
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* sync.start();
    expect(localConfig(dir)).toMatchObject({ "user.name": "Work Name" });

    yield* sync.apply(yield* settings.updateSettings(patch));
    expect(localConfig(dir)).toEqual({});
  }).pipe(
    Effect.provide(
      layer(dir, {
        gitAccounts: { [work]: account("Work") },
        gitAccountId: work,
        gitAccountWritesRepoConfig: true,
      }),
    ),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true }))),
  );
});
