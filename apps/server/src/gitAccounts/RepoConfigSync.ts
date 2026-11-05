// Fork: Apply repository-local author identity only when opted in, and restore previous values when the account is unbound or the option is disabled.
import type { ProjectId, ServerSettings as ServerSettingsValue } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const SAVED = "t3code.savedUserIdentity";
const PREVIOUS = {
  "user.name": "t3code.previousUserName",
  "user.email": "t3code.previousUserEmail",
};

interface RepoIdentity {
  readonly name: string;
  readonly email: string;
}

const desiredIdentity = (
  settings: ServerSettingsValue,
  projectId: ProjectId,
): RepoIdentity | null => {
  const { gitAccountId, gitAccountWritesRepoConfig } = resolveProjectSettings(
    settings,
    projectId,
  ).settings;
  if (!gitAccountWritesRepoConfig || gitAccountId === null) return null;
  const account = settings.gitAccounts[gitAccountId];
  return account === undefined ? null : { name: account.authorName, email: account.authorEmail };
};

const sameIdentity = (left: RepoIdentity | null, right: RepoIdentity | null) =>
  left?.name === right?.name && left?.email === right?.email;

export class RepoConfigSync extends Context.Service<
  RepoConfigSync,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly apply: (settings: ServerSettingsValue) => Effect.Effect<void>;
  }
>()("t3/gitAccounts/RepoConfigSync") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const process = yield* VcsProcess.VcsProcess;
  const applied = new Map<ProjectId, RepoIdentity | null>();

  const gitConfig = (cwd: string, args: ReadonlyArray<string>, allowNonZeroExit = false) =>
    process.run({
      operation: "RepoConfigSync.gitConfig",
      command: "git",
      args: ["config", "--local", ...args],
      cwd,
      allowNonZeroExit,
    });

  const read = (cwd: string, key: string) =>
    gitConfig(cwd, ["--get", key], true).pipe(
      Effect.map((output) => (output.exitCode === 0 ? output.stdout.replace(/\r?\n$/, "") : null)),
    );

  const write = Effect.fn("RepoConfigSync.write")(function* (cwd: string, identity: RepoIdentity) {
    if ((yield* read(cwd, SAVED)) === null) {
      for (const [key, previousKey] of Object.entries(PREVIOUS)) {
        const previous = yield* read(cwd, key);
        if (previous !== null) yield* gitConfig(cwd, [previousKey, previous]);
      }
      yield* gitConfig(cwd, [SAVED, "true"]);
    }
    yield* gitConfig(cwd, ["user.name", identity.name]);
    yield* gitConfig(cwd, ["user.email", identity.email]);
  });

  const restore = Effect.fn("RepoConfigSync.restore")(function* (cwd: string) {
    if ((yield* read(cwd, SAVED)) === null) return;
    for (const [key, previousKey] of Object.entries(PREVIOUS)) {
      const previous = yield* read(cwd, previousKey);
      yield* previous === null
        ? gitConfig(cwd, ["--unset-all", key], true)
        : gitConfig(cwd, [key, previous]);
    }
    yield* gitConfig(cwd, ["--remove-section", "t3code"]);
  });

  const apply: RepoConfigSync["Service"]["apply"] = Effect.fn("RepoConfigSync.apply")(
    function* (settings) {
      const rows = yield* projects.list().pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("repo config sync could not list projects", { cause }),
        ),
        Effect.orElseSucceed(() => []),
      );
      for (const project of rows) {
        const next = desiredIdentity(settings, project.projectId);
        if (sameIdentity(applied.get(project.projectId) ?? null, next)) continue;
        yield* (
          next === null ? restore(project.workspaceRoot) : write(project.workspaceRoot, next)
        ).pipe(
          Effect.tap(() => Effect.sync(() => applied.set(project.projectId, next))),
          Effect.catch((cause) =>
            Effect.logWarning("repo config sync failed", {
              projectId: project.projectId,
              cause,
            }),
          ),
        );
      }
    },
  );

  const start: RepoConfigSync["Service"]["start"] = Effect.fn("RepoConfigSync.start")(function* () {
    // Subscribe before the first read so a change in between is not missed.
    const changes = yield* settingsService.subscribeChanges;
    yield* settingsService.getSettings.pipe(
      Effect.flatMap(apply),
      Effect.catch((cause) =>
        Effect.logWarning("repo config sync could not read settings", { cause }),
      ),
    );
    yield* changes.pipe(Stream.runForEach(apply), Effect.forkScoped);
  });

  return RepoConfigSync.of({ start, apply });
});

export const layer = Layer.effect(RepoConfigSync, make);
