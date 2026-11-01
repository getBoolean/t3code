// @effect-diagnostics nodeBuiltinImport:off - runs the generated shims as real processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { ENV_FILE_VARIABLE, envChange, envScript, shimFiles } from "./terminalShims.ts";

// oxlint-disable-next-line t3code/no-global-process-runtime -- These run the shims as real processes on the host OS.
const platform = NodeOS.platform();
const delimiter = platform === "win32" ? ";" : ":";

function installShims() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-shims-"));
  const binDir = NodePath.join(root, "bin");
  NodeFS.mkdirSync(binDir);
  for (const shim of shimFiles(platform, binDir)) {
    NodeFS.writeFileSync(NodePath.join(binDir, shim.name), shim.content, {
      mode: shim.executable ? 0o755 : 0o644,
    });
  }
  return {
    root,
    binDir,
    envFile: NodePath.join(root, platform === "win32" ? "env.cmd" : "env.sh"),
  };
}

/** Runs `git` the way a T3 terminal resolves it: the shim directory first on PATH. */
function shimmedGit(binDir: string, envFile: string, args: ReadonlyArray<string>) {
  const env = {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    [ENV_FILE_VARIABLE]: envFile,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NodePath.join(binDir, "missing-global-config"),
  };
  const result =
    platform === "win32"
      ? NodeChildProcess.spawnSync(
          "cmd.exe",
          ["/d", "/c", NodePath.join(binDir, "git.cmd"), ...args],
          {
            env,
            encoding: "utf8",
          },
        )
      : NodeChildProcess.spawnSync(NodePath.join(binDir, "git"), args, { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

describe("terminal git shims", () => {
  it("runs the real git with whatever the env file currently says", () => {
    const { root, binDir, envFile } = installShims();
    try {
      const start = {};
      const work = {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "user.name",
        GIT_CONFIG_VALUE_0: "Work 100% Name",
      };
      const first = envChange(start, work, new Set());
      NodeFS.writeFileSync(envFile, envScript(platform, first));
      expect(shimmedGit(binDir, envFile, ["config", "--get", "user.name"])).toMatchObject({
        status: 0,
        stdout: "Work 100% Name",
      });

      // Switching back to the start environment unsets what the earlier write added.
      NodeFS.writeFileSync(envFile, envScript(platform, envChange(start, start, first.keys)));
      expect(shimmedGit(binDir, envFile, ["config", "--get", "user.name"])).toMatchObject({
        status: 1,
        stdout: "",
      });
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores a start value the account had replaced", () => {
    const change = envChange(
      { GH_TOKEN: "machine-token" },
      { GH_TOKEN: "machine-token" },
      new Set(["GH_TOKEN", "GIT_AUTHOR_NAME"]),
    );
    expect(change.set).toEqual({ GH_TOKEN: "machine-token" });
    expect(change.unset).toEqual(["GIT_AUTHOR_NAME"]);
  });
});
