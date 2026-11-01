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
  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    // An unresolved secret reference carries no value; the registry resolves it for the provider.
    if (typeof variable.value !== "string") continue;
    next[variable.name] =
      variable.name === "CODEX_HOME" || variable.name === "CLAUDE_CONFIG_DIR"
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
