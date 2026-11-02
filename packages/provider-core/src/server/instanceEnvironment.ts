import type { ProviderInstanceEnvironment } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { expandHomePath } from "./pathExpansion.ts";

export const mergeProviderInstanceEnvironment = Effect.fn(function* (
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  if (!environment || environment.length === 0) {
    return baseEnv;
  }

  const home = yield* HostProcess.HomeDirectory;
  const windows = (yield* HostProcess.Platform) === "win32";
  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    // An unresolved secret reference carries no value; the registry resolves it for the provider.
    if (typeof variable.value !== "string") continue;
    // Windows reads names without regard to case, and a child gets the first spelling in sort
    // order. Upper case sorts first, so the configured value wins even where a spawn merges the
    // parent environment back in.
    const name = windows ? variable.name.toUpperCase() : variable.name;
    if (windows) {
      for (const inherited of Object.keys(next)) {
        if (inherited.toUpperCase() === name) delete next[inherited];
      }
    }
    next[name] =
      name === "CODEX_HOME" || name === "CLAUDE_CONFIG_DIR"
        ? expandHomePath(variable.value, home)
        : variable.value;
  }
  return next;
});

/** Environment changes that make a process act as a git account. */
export interface EnvironmentOverlay {
  readonly set: Readonly<Record<string, string>>;
  readonly unset: ReadonlyArray<string>;
  readonly gitConfig: ReadonlyArray<readonly [string, string]>;
}

export function applyEnvironmentOverlay(
  base: Readonly<Record<string, string | undefined>>,
  overlay: EnvironmentOverlay,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...base };
  for (const name of overlay.unset) delete next[name];
  Object.assign(next, overlay.set);
  let count = Number.parseInt(next.GIT_CONFIG_COUNT ?? "0", 10);
  if (!Number.isFinite(count) || count < 0) count = 0;
  for (const [key, value] of overlay.gitConfig) {
    next[`GIT_CONFIG_KEY_${count}`] = key;
    next[`GIT_CONFIG_VALUE_${count}`] = value;
    count += 1;
  }
  next.GIT_CONFIG_COUNT = String(count);
  return next;
}
