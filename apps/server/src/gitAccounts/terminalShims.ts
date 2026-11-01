/**
 * `git` and `gh` shims for T3 terminals. Each call sources the terminal's env file before running
 * the real tool, so an account switch or bypass reaches terminals that are already open.
 */

const SHIMMED_TOOLS = ["git", "gh"] as const;

export const ENV_FILE_VARIABLE = "T3CODE_GIT_ACCOUNT_ENV";

export interface ShimFile {
  readonly name: string;
  readonly content: string;
  readonly executable: boolean;
}

const posixQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

// Batch expands `%` even inside quotes; doubling it keeps the value literal.
const batchValue = (value: string) => value.replaceAll("%", "%%");

export function shimFiles(platform: NodeJS.Platform, shimDir: string): ReadonlyArray<ShimFile> {
  return SHIMMED_TOOLS.map((tool) =>
    platform === "win32"
      ? {
          name: `${tool}.cmd`,
          executable: false,
          content: [
            "@echo off",
            "setlocal",
            `if defined ${ENV_FILE_VARIABLE} if exist "%${ENV_FILE_VARIABLE}%" call "%${ENV_FILE_VARIABLE}%"`,
            `set "T3CODE_REAL="`,
            `for %%d in ("%PATH:;=" "%") do if not defined T3CODE_REAL if /i not "%%~d"=="${shimDir}" if exist "%%~d\\${tool}.exe" set "T3CODE_REAL=%%~d\\${tool}.exe"`,
            `if not defined T3CODE_REAL (echo T3 Code: ${tool} was not found on PATH. 1>&2 & exit /b 127)`,
            `"%T3CODE_REAL%" %*`,
            "exit /b %ERRORLEVEL%",
            "",
          ].join("\r\n"),
        }
      : {
          name: tool,
          executable: true,
          content: [
            "#!/bin/sh",
            `f="\${${ENV_FILE_VARIABLE}:-}"`,
            `[ -n "$f" ] && [ -r "$f" ] && . "$f"`,
            "IFS=:",
            "for d in $PATH; do",
            `  [ "$d" = ${posixQuote(shimDir)} ] && continue`,
            `  [ -x "$d/${tool}" ] && exec "$d/${tool}" "$@"`,
            "done",
            `echo "T3 Code: ${tool} was not found on PATH." >&2`,
            "exit 127",
            "",
          ].join("\n"),
        },
  );
}

export interface EnvChange {
  readonly set: Readonly<Record<string, string>>;
  readonly unset: ReadonlyArray<string>;
}

/**
 * Brings a terminal from its start environment to `target`. `previous` holds every key an earlier
 * write touched, so a key the new target no longer sets is restored or unset.
 */
export function envChange(
  start: Readonly<Record<string, string | undefined>>,
  target: Readonly<Record<string, string | undefined>>,
  previous: ReadonlySet<string>,
): EnvChange & { readonly keys: ReadonlySet<string> } {
  const keys = new Set(previous);
  for (const key of new Set([...Object.keys(start), ...Object.keys(target)])) {
    if (start[key] !== target[key]) keys.add(key);
  }
  const set: Record<string, string> = {};
  const unset: Array<string> = [];
  for (const key of [...keys].sort()) {
    const value = target[key];
    if (value === undefined) unset.push(key);
    else set[key] = value;
  }
  return { set, unset, keys };
}

export function envScript(platform: NodeJS.Platform, change: EnvChange): string {
  if (platform === "win32") {
    return [
      ...Object.entries(change.set).map(([key, value]) => `set "${key}=${batchValue(value)}"`),
      ...change.unset.map((key) => `set "${key}="`),
      "",
    ].join("\r\n");
  }
  return [
    ...Object.entries(change.set).map(([key, value]) => `export ${key}=${posixQuote(value)}`),
    ...change.unset.map((key) => `unset ${key}`),
    "",
  ].join("\n");
}
