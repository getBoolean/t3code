// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - writes screenshots and a report beside the run.
/**
 * Opens every screen that mounts a native module or native view, one deep link at a time, and
 * records what broke: a route that never opened, error text on screen, a JS error or rejection the
 * probe caught, or an app that stopped answering. Run it on the oldest supported iOS to catch APIs
 * the deployment target lacks.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";

import type { Metrics } from "./grade.ts";
import type { ScenarioContext } from "./scenarios.ts";

export interface NativeWalkStep {
  readonly id: string;
  /** Deep link path; `{thread}` is the seeded thread's route prefix. With no path or params the
   * step starts on Home. */
  readonly path?: string;
  /** Params for an in-app navigation to `route` instead, merged with the seeded thread's ids. */
  readonly params?: Record<string, unknown>;
  /** The route that must open. */
  readonly route: string;
  /** What native code the screen runs, for the report. */
  readonly native: string;
  /** A control to tap once the screen is up, then how to clear what it presented. */
  readonly press?: {
    readonly label: string;
    readonly afterwards?: "accept-alert" | "tap-outside";
    /** The control is only shown in some states, so a missing one is not a failure. */
    readonly optional?: boolean;
    /** A label that must be on screen after the tap, or `navigates` for a new route. */
    readonly expect?: { readonly label: string } | "navigates";
  };
}

export const NATIVE_WALK_STEPS: ReadonlyArray<NativeWalkStep> = [
  {
    id: "compose",
    route: "Home",
    native: "native tab bar, compose button",
    press: { label: "New chat", expect: "navigates" },
  },
  { id: "settings", path: "settings", route: "Settings", native: "settings list, SF Symbols" },
  {
    id: "appearance",
    path: "settings/appearance",
    route: "SettingsAppearance",
    native: "SegmentedControl",
  },
  {
    id: "organization",
    path: "settings/organization",
    route: "SettingsOrganization",
    native: "Menu",
  },
  { id: "follow-ups", path: "settings/follow-ups", route: "SettingsFollowUp", native: "Menu" },
  { id: "labs", path: "settings/labs", route: "SettingsLabs", native: "switches" },
  { id: "about", path: "settings/about", route: "SettingsAbout", native: "expo-updates" },
  { id: "archive", path: "settings/archive", route: "SettingsArchive", native: "list" },
  { id: "keyboard", path: "settings/keyboard", route: "SettingsKeyboard", native: "key commands" },
  {
    id: "microphone",
    path: "settings/microphone",
    route: "SettingsMicrophone",
    native: "expo-audio permission",
  },
  {
    id: "navigation-tabs",
    path: "settings/navigation-tabs",
    route: "SettingsNavigation",
    native: "native tabs",
  },
  {
    id: "project-grouping",
    path: "settings/project-grouping",
    route: "SettingsProjectGrouping",
    native: "Menu",
  },
  {
    id: "thread-preferences",
    path: "settings/thread-preferences",
    route: "SettingsThreads",
    native: "switches",
  },
  {
    id: "environments",
    path: "settings/environments",
    route: "SettingsEnvironments",
    native: "list",
  },
  {
    id: "new-threads",
    path: "settings/new-threads",
    route: "SettingsEnvironmentNewThreads",
    native: "Menu",
  },
  {
    id: "source-control",
    path: "settings/source-control",
    route: "SettingsEnvironmentSourceControl",
    native: "Menu, git accounts form",
    press: { label: "Add account", expect: { label: "Author email" } },
  },
  {
    id: "agent-behavior",
    path: "settings/agent-behavior",
    route: "SettingsEnvironmentAgentBehavior",
    native: "switches",
  },
  { id: "worktrees", path: "settings/worktrees", route: "SettingsWorktrees", native: "list" },
  {
    id: "provider-accounts",
    path: "settings/provider-accounts",
    route: "SettingsProviderAccounts",
    native: "list",
  },
  {
    id: "maintenance",
    path: "settings/maintenance",
    route: "SettingsEnvironmentMaintenance",
    native: "list",
  },
  {
    id: "scheduled-tasks",
    path: "settings/scheduled-tasks",
    route: "SettingsScheduledTasks",
    native: "list",
  },
  {
    id: "scheduled-task-new",
    path: "settings/scheduled-tasks/new",
    route: "SettingsScheduledTaskNew",
    native: "SwiftUI DateTimePicker, SegmentedControl",
  },
  {
    id: "usage",
    path: "settings/usage",
    route: "SettingsUsage",
    native: "SegmentedControl, SwiftUI Chart",
    press: { label: "Tokens" },
  },
  {
    id: "diagnostics",
    path: "settings/diagnostics",
    route: "SettingsDiagnostics",
    native: "expo-updates",
  },
  {
    id: "client-storage",
    path: "settings/client-storage",
    route: "SettingsClientStorage",
    native: "expo-sqlite, expo-secure-store",
  },
  {
    id: "licenses",
    path: "settings/open-source-licenses",
    route: "SettingsOpenSourceLicenses",
    native: "list",
  },
  { id: "legal", path: "settings/legal", route: "SettingsLegal", native: "WebView" },
  {
    id: "environment-new",
    path: "settings/environment-new",
    route: "SettingsEnvironmentNew",
    native: "form sheet",
  },
  {
    id: "component-catalog",
    path: "dev/components",
    route: "ComponentCatalog",
    native: "Menu, sheets, SegmentedControl, SwiftUI ProgressView, glass",
  },
  { id: "connections", path: "connections", route: "Connections", native: "sheet detents" },
  {
    id: "connections-new",
    path: "connections/new",
    route: "ConnectionsNew",
    native: "expo-camera, FrostedCutout",
    // Once camera access is granted the scanner starts on its own and the button is gone.
    press: { label: "Scan QR code", afterwards: "accept-alert", optional: true },
  },
  { id: "new-task", path: "new", route: "NewTaskProject", native: "composer editor" },
  { id: "add-project", path: "new/add-project", route: "AddProject", native: "form sheet" },
  {
    id: "thread",
    path: "{thread}",
    route: "Thread",
    native: "T3ComposerEditor, enriched markdown, attachment menu",
    press: { label: "Add attachment", afterwards: "tap-outside" },
  },
  { id: "git", path: "{thread}/git", route: "GitOverview", native: "form sheet" },
  { id: "git-branches", path: "{thread}/git/branches", route: "GitBranches", native: "list" },
  { id: "git-commit", path: "{thread}/git/commit", route: "GitCommit", native: "text input" },
  {
    id: "thread-pull-requests",
    path: "{thread}/pull-requests",
    route: "ThreadPullRequests",
    native: "form sheet",
  },
  { id: "review", path: "{thread}/review", route: "ThreadReview", native: "t3-review-diff" },
  { id: "terminal", path: "{thread}/terminal", route: "ThreadTerminal", native: "t3-terminal" },
  { id: "files", path: "{thread}/files", route: "ThreadFiles", native: "file tree" },
  {
    // The `files/:path*` deep link carries no path (React Navigation has no wildcard params).
    id: "file",
    params: { path: ["README.md"] },
    route: "ThreadFile",
    native: "t3-source-text, t3-highlights",
  },
];

/** The error text React Native and iOS show for a crash or redbox; the same list mobile:e2e checks. */
const ERROR_TEXT =
  /\b(Render Error|Uncaught Error|Unhandled JS Exception|Syntax Error|keeps stopping|isn't responding)\b/i;

interface CapturedError {
  readonly kind: "uncaught" | "fatal" | "rejection" | "console";
  readonly message: string;
}

interface StepResult {
  readonly id: string;
  readonly route: string | null;
  readonly opened: boolean;
  readonly errorText: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<CapturedError>;
  readonly alive: boolean;
  readonly screenshot: string;
  readonly note?: string;
  readonly labels?: ReadonlyArray<string>;
}

const drainErrors = (ctx: ScenarioContext) =>
  ctx.device
    .evaluate("__t3Behavior.errors()")
    .pipe(Effect.map((value) => JSON.parse(String(value)) as ReadonlyArray<CapturedError>));

const runStep = Effect.fn("nativeWalk.step")(function* (
  ctx: ScenarioContext,
  step: NativeWalkStep,
  index: number,
  directory: string,
) {
  const thread = `threads/${encodeURIComponent(ctx.env.environmentId)}/${encodeURIComponent(ctx.fixtures.longThread)}`;
  yield* ctx.device.evaluate("__t3Behavior.popToTop()");
  yield* Effect.sleep("1 second");
  yield* drainErrors(ctx);
  if (step.path !== undefined) yield* ctx.device.open(step.path.replace("{thread}", thread));
  else if (step.params !== undefined)
    yield* ctx.device.evaluate(
      `__t3Behavior.navigate(${JSON.stringify(step.route)}, ${JSON.stringify({
        environmentId: ctx.env.environmentId,
        threadId: ctx.fixtures.longThread,
        ...step.params,
      })})`,
    );
  const reached = yield* ctx.device
    .waitFor(`route ${step.route}`, (state) => state.route?.name === step.route, 30_000)
    .pipe(Effect.option);
  // Native views mount after the route commits.
  yield* Effect.sleep("2 seconds");
  let note: string | undefined;
  if (reached._tag === "Some" && step.press) {
    // A control's label repeats on its containers, so tap the smallest node that carries it.
    const label = step.press.label;
    const target = (yield* ctx.device.nodes.pipe(Effect.orElseSucceed(() => [])))
      .filter((node) => node.label === label && node.rect && node.rect.width > 0)
      .sort((a, b) => a.rect!.width * a.rect!.height - b.rect!.width * b.rect!.height)[0];
    const tapped = target
      ? yield* ctx.device
          .pressAt(ctx.device.center(target).x, ctx.device.center(target).y)
          .pipe(Effect.result)
      : undefined;
    if (tapped?._tag === "Failure" || (!tapped && !step.press.optional))
      note = `could not tap "${label}"`;
    const expected = step.press.expect;
    if (tapped?._tag === "Success" && expected === "navigates") {
      const moved = yield* ctx.device
        .waitFor("a new route", (state) => state.route?.name !== step.route, 15_000)
        .pipe(Effect.option);
      if (moved._tag === "None") note = `"${label}" did not open a screen`;
    }
    if (tapped?._tag === "Success" && typeof expected === "object") {
      yield* Effect.sleep("1 second");
      const shown = yield* ctx.device.nodes.pipe(Effect.orElseSucceed(() => []));
      if (!shown.some((node) => node.label === expected.label))
        note = `"${label}" did not show "${expected.label}"`;
    }
    yield* Effect.sleep("2 seconds");
    if (step.press.afterwards === "accept-alert")
      yield* ctx.device.run(["alert", "accept"], 15_000).pipe(Effect.ignore);
    if (step.press.afterwards === "tap-outside")
      yield* ctx.device.pressAt(8, 120).pipe(Effect.ignore);
    yield* Effect.sleep("1 second");
  }
  const screenshot = NodePath.join(
    directory,
    `${ctx.pose}-${String(index + 1).padStart(2, "0")}-${step.id}.png`,
  );
  const shot = yield* ctx.device.run(["screenshot", screenshot]).pipe(Effect.result);
  const nodes = yield* ctx.device.nodes.pipe(Effect.orElseSucceed(() => []));
  NodeFS.writeFileSync(screenshot.replace(/\.png$/, ".ax.json"), JSON.stringify(nodes));
  const errorText = nodes
    .flatMap((node) => (ERROR_TEXT.test(node.label ?? "") ? [node.label!] : []))
    .slice(0, 3);
  // A native crash takes the JS runtime with it, so the probe stops answering. A busy JS thread
  // can miss one inspector call, so the app gets a window before it counts as gone.
  const state = yield* ctx.device
    .waitFor("the probe to answer", () => true, 45_000)
    .pipe(Effect.option);
  const errors = yield* drainErrors(ctx).pipe(Effect.orElseSucceed(() => []));
  const opened = reached._tag === "Some";
  return {
    id: step.id,
    route: state._tag === "Some" ? (state.value.route?.name ?? null) : null,
    opened,
    errorText,
    errors,
    alive: state._tag === "Some",
    screenshot: shot._tag === "Success" ? screenshot : `failed: ${shot.failure.message}`,
    ...(note ? { note } : {}),
    // What was on screen, to fix a step whose control or route was not found.
    ...(note || !opened
      ? { labels: nodes.flatMap((node) => (node.label ? [node.label] : [])).slice(0, 60) }
      : {}),
  } satisfies StepResult;
});

/** Visits every step; stops at the first step after which the app no longer answers. */
export const nativeWalk = function* (ctx: ScenarioContext) {
  const directory = NodePath.join(ctx.out, "native-walk");
  NodeFS.mkdirSync(directory, { recursive: true });
  // An uncommitted change gives the review screen a diff to render.
  NodeFS.appendFileSync(NodePath.join(ctx.env.workspace, "README.md"), "\nNative walk edit.\n");
  const results: StepResult[] = [];
  // T3_NATIVE_WALK_STEPS=file,review reruns only those steps while fixing them.
  const only = process.env.T3_NATIVE_WALK_STEPS?.split(",");
  for (const [index, step] of NATIVE_WALK_STEPS.entries()) {
    if (only && !only.includes(step.id)) continue;
    const result = yield* runStep(ctx, step, index, directory);
    results.push(result);
    if (!result.alive) break;
  }
  yield* ctx.device.evaluate("__t3Behavior.popToTop()").pipe(Effect.ignore);
  NodeFS.writeFileSync(
    NodePath.join(directory, `${ctx.pose}-report.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  const count = (kind: CapturedError["kind"]) =>
    results.reduce((sum, result) => sum + result.errors.filter((e) => e.kind === kind).length, 0);
  const problems = results.flatMap((result) => [
    ...(result.opened ? [] : [`${result.id}: opened ${result.route ?? "nothing"}`]),
    ...(result.alive ? [] : [`${result.id}: app stopped answering`]),
    ...result.errorText.map((text) => `${result.id}: "${text}" on screen`),
    ...result.errors
      .filter((error) => error.kind !== "console")
      .map((error) => `${result.id}: ${error.kind} ${error.message}`),
    ...(result.note ? [`${result.id}: ${result.note}`] : []),
  ]);
  return {
    steps: NATIVE_WALK_STEPS.length,
    visited: results.length,
    failedSteps: results.filter(
      (result) =>
        !result.opened ||
        !result.alive ||
        result.errorText.length > 0 ||
        result.errors.some((error) => error.kind !== "console") ||
        result.note !== undefined,
    ).length,
    crashedAt: results.find((result) => !result.alive)?.id ?? null,
    uncaught: count("uncaught") + count("fatal"),
    rejections: count("rejection"),
    consoleErrors: count("console"),
    problems: problems.join(" | ").slice(0, 2000),
  } satisfies Metrics;
};
