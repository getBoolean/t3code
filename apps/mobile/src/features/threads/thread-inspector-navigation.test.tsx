import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import * as React from "react";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  dispatch: (_action: unknown) => {},
  getState: (): unknown => undefined,
  getRoute: (): unknown => undefined,
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({ fileInspector: { supported: true } }),
}));
vi.mock("@react-navigation/native", async () => {
  const { createRequire } = await import("node:module");
  const requireNavigation = createRequire(
    createRequire(import.meta.url).resolve("@react-navigation/native/package.json"),
  );
  return {
    StackActions: requireNavigation("@react-navigation/routers").StackActions,
    useNavigation: () => ({ dispatch: harness.dispatch, getState: harness.getState }),
    useRoute: () => harness.getRoute(),
  };
});

import { useOpenThreadInspector } from "./thread-inspector-navigation";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

const requireNavigation = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("@react-navigation/native/package.json"),
);
const { StackRouter, StackActions } = requireNavigation("@react-navigation/routers") as {
  StackRouter: typeof import("@react-navigation/native").StackRouter;
  StackActions: typeof import("@react-navigation/native").StackActions;
};

function setup(fromAgents: boolean, fullscreen = false, sheet = "ThreadAgents") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const router = StackRouter({});
  const options = {
    routeNames: [
      "Home",
      "Thread",
      "ThreadAgents",
      "ThreadBackgroundWork",
      "ThreadInspectorFullscreen",
    ],
    routeParamList: {},
    routeGetIdList: {},
  };
  let state = router.getInitialState(options);
  const dispatch = (action: Parameters<typeof router.getStateForAction>[1]) => {
    const next = router.getStateForAction(state, action, options);
    if (!next) throw new Error(`Rejected ${action.type}`);
    state = router.getRehydratedState(next, options);
  };
  harness.dispatch = (action) => dispatch(action as Parameters<typeof dispatch>[0]);
  harness.getState = () => state;
  harness.getRoute = () => state.routes.at(-1);
  const source = { environmentId: "remote-environment", threadId: "parent" };
  dispatch(StackActions.push("Thread", { ...source, prompt: "retained prompt" }));
  const parentKey = state.routes.at(-1)!.key;
  if (fullscreen)
    dispatch(StackActions.push("ThreadInspectorFullscreen", { ...source, threadId: "child" }));
  if (fromAgents)
    dispatch(StackActions.push(sheet, fullscreen ? { ...source, threadId: "child" } : source));
  let openInspector: ReturnType<typeof useOpenThreadInspector>;
  let openLinkedThread: ReturnType<typeof useOpenLinkedThread>;
  function Probe() {
    const open = useOpenThreadInspector();
    const openLinked = useOpenLinkedThread();
    useLayoutEffect(() => {
      openInspector = open;
      openLinkedThread = openLinked;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return {
    source,
    parentKey,
    dispatch,
    get state() {
      return state;
    },
    open(target: Parameters<typeof openInspector>[1], from = source) {
      let opened = false;
      act(() => {
        opened = openInspector(from, target);
      });
      return opened;
    },
    openLinked(threadId: string) {
      act(() => openLinkedThread({ environmentId: source.environmentId, threadId }));
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
    },
  };
}

// Fork: Background work shares the Agents sheet's parent-preserving inspector route until upstream unifies the entry points.
it.each(["ThreadAgents", "ThreadBackgroundWork"])(
  "opens a subagent from %s without replacing the parent thread",
  (sheet) => {
    using screen = setup(true, false, sheet);
    const inspector = {
      type: "thread",
      environmentId: screen.source.environmentId,
      threadId: "child",
    } as const;
    screen.open(inspector);
    expect(screen.state.routes.map((route) => route.name)).toEqual(["Home", "Thread"]);
    expect(screen.state.routes.at(-1)).toMatchObject({
      key: screen.parentKey,
      params: { ...screen.source, prompt: "retained prompt", inspector },
    });
    screen.dispatch(StackActions.push("ThreadInspectorFullscreen", inspector));
    screen.dispatch(StackActions.pop());
    expect(screen.state.routes.at(-1)).toMatchObject({
      key: screen.parentKey,
      params: { ...screen.source, inspector },
    });
  },
);

it("opens a completion link in the parent inspector", () => {
  using screen = setup(false);
  screen.openLinked("child");
  expect(screen.state.routes).toHaveLength(2);
  expect(screen.state.routes.at(-1)).toMatchObject({
    key: screen.parentKey,
    params: {
      ...screen.source,
      inspector: { type: "thread", environmentId: screen.source.environmentId, threadId: "child" },
    },
  });
});

it("switches between subagents and devices in the same parent route", () => {
  using screen = setup(false);
  screen.open({ type: "thread", environmentId: screen.source.environmentId, threadId: "child" });
  const inspector = { type: "device", ...screen.source } as const;
  screen.open(inspector);
  expect(screen.state.routes).toHaveLength(2);
  expect(screen.state.routes.at(-1)).toMatchObject({
    key: screen.parentKey,
    params: { ...screen.source, inspector },
  });
});

it.each(["thread", "device"] as const)(
  "keeps the parent when a maximized child opens a %s preview",
  (type) => {
    using screen = setup(false, true);
    const child = { ...screen.source, threadId: "child" };
    const originalState = screen.state;
    expect(screen.open({ type, ...child, threadId: "grandchild" }, child)).toBe(false);
    expect(screen.state).toEqual(originalState);
    screen.dispatch(StackActions.pop());
    expect(screen.state.routes.at(-1)).toMatchObject({
      key: screen.parentKey,
      params: screen.source,
    });
  },
);

it("keeps the parent when the maximized child's Agents sheet opens another child", () => {
  using screen = setup(true, true);
  const child = { ...screen.source, threadId: "child" };
  const originalState = screen.state;
  expect(screen.open({ type: "thread", ...child, threadId: "grandchild" }, child)).toBe(false);
  expect(screen.state).toEqual(originalState);
});

it("keeps a focused inspector registered across renders and updates its content", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const requireMobile = NodeModule.createRequire(import.meta.url);
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  let focused = true;
  let activeRender: (() => React.ReactNode) | undefined;
  const deactivate = vi.fn(() => {
    activeRender = undefined;
  });
  const registerWorkspaceInspector = vi.fn(
    (content: { readonly panes: ReadonlyArray<{ readonly render: () => React.ReactNode }> }) => {
      activeRender = content.panes[0]?.render;
      return deactivate;
    },
  );
  const navigation = {
    isFocused: () => focused,
    addListener(event: "focus" | "blur", listener: () => void) {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
  };
  const navigationContext = React.createContext(navigation);
  const routeContext = React.createContext({ key: "file" });
  const babel = requireMobile("@babel/core") as {
    transformFileSync(file: string, options: Record<string, unknown>): { code: string };
  };
  const compiled = babel.transformFileSync(
    NodePath.resolve(__dirname, "../layout/AdaptiveWorkspaceLayout.tsx"),
    {
      babelrc: false,
      configFile: false,
      presets: [
        [
          requireMobile.resolve("babel-preset-expo"),
          { unstable_transformImportMeta: true, enableBabelRuntime: false },
        ],
      ],
      caller: {
        name: "metro",
        bundler: "metro",
        platform: "ios",
        isDev: false,
        isServer: false,
        isNodeModule: false,
        supportsStaticESM: false,
        supportsReactCompiler: true,
      },
    },
  );
  const exports: {
    Inspector?: (props: {
      readonly content: {
        readonly active: string;
        readonly panes: ReadonlyArray<{ readonly key: string; readonly render: () => string }>;
      };
    }) => null;
  } = {};
  const load = (name: string) => {
    if (name === "react" || name.startsWith("react/")) return requireMobile(name);
    if (name === "./adaptive-workspace-context")
      return {
        useAdaptiveWorkspaceLayout: () => ({ registerWorkspaceInspector }),
      };
    if (name === "@react-navigation/native")
      return {
        NavigationContext: navigationContext,
        NavigationRouteContext: routeContext,
      };
    return {};
  };
  new Function("require", "exports", compiled.code)(load, exports);
  const Inspector = exports.Inspector!;
  const contents = new Map<string, Parameters<typeof Inspector>[0]["content"]>();
  function Screen({ content }: { content: string | undefined }) {
    if (content === undefined) return null;
    let panes = contents.get(content);
    if (!panes) {
      panes = { active: "main", panes: [{ key: "main", render: () => content }] };
      contents.set(content, panes);
    }
    return <Inspector content={panes} />;
  }
  const root = createRoot(document.createElement("div"));
  using _root = { [Symbol.dispose]: () => act(() => root.unmount()) };
  const render = (content: string | undefined) =>
    act(() => root.render(<Screen content={content} />));
  const first = "first";
  render(first);
  registerWorkspaceInspector.mockClear();
  deactivate.mockClear();
  render(first);
  render(first);
  expect(registerWorkspaceInspector).not.toHaveBeenCalled();
  expect(deactivate).not.toHaveBeenCalled();
  const second = "second";
  render(second);
  expect(registerWorkspaceInspector).toHaveBeenCalledTimes(1);
  const paneContainer = document.createElement("div");
  const paneRoot = createRoot(paneContainer);
  using _pane = { [Symbol.dispose]: () => act(() => paneRoot.unmount()) };
  act(() => paneRoot.render(activeRender?.()));
  expect(paneContainer.textContent).toBe("second");
  const emit = (event: "focus" | "blur") =>
    act(() => {
      focused = event === "focus";
      for (const listener of listeners[event]) listener();
    });
  emit("blur");
  expect(deactivate).toHaveBeenCalledTimes(1);
  registerWorkspaceInspector.mockClear();
  render(first);
  expect(registerWorkspaceInspector).not.toHaveBeenCalled();
  emit("focus");
  expect(registerWorkspaceInspector).toHaveBeenCalledTimes(1);
  emit("focus");
  expect(registerWorkspaceInspector).toHaveBeenCalledTimes(1);
  render(undefined);
  expect(activeRender).toBeUndefined();
  render(second);
  expect(activeRender).toBeDefined();
  act(() => root.unmount());
  expect(activeRender).toBeUndefined();
  expect(listeners.focus.size + listeners.blur.size).toBe(0);
});

// Fork: File previews opened in a subagent must stay on its local stack until upstream scopes inspector navigation.
it("opens attached and workspace files inside the subagent navigator and returns to that subagent", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const requireMobile = NodeModule.createRequire(import.meta.url);
  const babel = requireMobile("@babel/core") as {
    transformFileSync(file: string, options: Record<string, unknown>): { code: string };
  };
  const compiled = babel.transformFileSync(
    NodePath.resolve(__dirname, "thread-inspector-preview.tsx"),
    {
      babelrc: false,
      configFile: false,
      presets: [
        [
          requireMobile.resolve("babel-preset-expo"),
          { unstable_transformImportMeta: true, enableBabelRuntime: false },
        ],
      ],
      caller: {
        name: "metro",
        bundler: "metro",
        platform: "ios",
        isDev: false,
        isServer: false,
        isNodeModule: false,
        supportsStaticESM: false,
        supportsReactCompiler: true,
      },
    },
  );
  const passthrough = ({ children }: { children?: React.ReactNode }) => children;
  const context = React.createContext(null);
  const expandContext = React.createContext<(() => void) | null>(null);
  const closeContext = React.createContext<(() => void) | null>(null);
  let expand: (() => void) | null = null;
  let containerMounts = 0;
  let containerIdentity = 0;
  let initialState: unknown;
  let saveState: (state: unknown) => void = () => {};
  let closeExpanded: () => void = () => {};
  const exports: { ThreadInspectorPreview?: React.ComponentType<Record<string, unknown>> } = {};
  const load = (name: string) => {
    if (name === "react" || name.startsWith("react/")) return requireMobile(name);
    if (name === "@react-navigation/native")
      return {
        NavigationContainer: (props: {
          children: React.ReactNode;
          initialState?: unknown;
          onStateChange: (state: unknown) => void;
        }) => {
          [containerIdentity] = React.useState(() => ++containerMounts);
          expand = React.use(expandContext);
          closeExpanded = React.use(closeContext) ?? (() => {});
          initialState = props.initialState;
          saveState = props.onStateChange;
          return props.children;
        },
        NavigationIndependentTree: passthrough,
        useNavigation: () => ({ dispatch: () => undefined }),
        useIsFocused: () => true,
      };
    if (name === "../../native/createV5StackNavigator")
      return {
        createV5StackNavigator: () => ({
          Navigator: passthrough,
          Screen: ({ name }: { name: string }) => <span data-screen={name} />,
        }),
      };
    if (name === "react-native") return { View: passthrough, Modal: passthrough };
    if (name === "react-native-safe-area-context")
      return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === "../files/file-preview-presentation")
      return { FilePreviewExpandContext: expandContext, FilePreviewCloseContext: closeContext };
    if (name === "../../components/ui/SheetHeader")
      return {
        SheetHeader: ({ title }: { title: string }) => {
          return <span data-expanded-title>{title}</span>;
        },
      };
    if (name === "./thread-inspector-navigation")
      return { ThreadInspectorNavigationContext: context };
    if (name === "../layout/inspector-bar-store") return { InspectorCloseContext: context };
    if (name === "../../native/v5-workspace-context")
      return { WorkspaceSlotOptionsContext: context };
    if (name === "../layout/workspace-content-width")
      return {
        WorkspaceContentWidthContext: context,
        WorkspaceSettledContentWidthContext: context,
      };
    if (name === "../../lib/useMobileNavigationTheme")
      return { useMobileNavigationTheme: () => ({}) };
    return {};
  };
  new Function("require", "exports", compiled.code)(load, exports);
  const Preview = exports.ThreadInspectorPreview!;
  const container = document.createElement("div");
  const root = createRoot(container);
  using _root = { [Symbol.dispose]: () => act(() => root.unmount()) };
  act(() =>
    root.render(
      <Preview
        target={{ type: "thread", environmentId: "env", threadId: "child" }}
        onOpen={() => {}}
        onClose={() => {}}
        renderThread={() => null}
      />,
    ),
  );
  const routeNames = [...container.querySelectorAll<HTMLElement>("[data-screen]")].map(
    (node) => node.dataset.screen!,
  );
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  const initial = router.getRehydratedState(
    {
      stale: true,
      routes: [{ name: "Thread", params: { environmentId: "env", threadId: "child" } }],
    },
    options,
  );
  for (const name of ["ThreadAttachment", "ThreadFile", "ThreadFiles"]) {
    const opened = router.getStateForAction(
      initial,
      StackActions.push(name, {
        environmentId: "env",
        threadId: "child",
        path: ["README.md"],
        attachmentId: "a",
      }),
      options,
    );
    expect(opened?.routes.at(-1)?.name).toBe(name);
    if (!opened || opened.stale !== false) throw new Error("Expected a local file preview");
    const returned = router.getStateForAction(
      opened,
      name === "ThreadAttachment"
        ? StackActions.pop()
        : StackActions.popTo("Thread", { environmentId: "env", threadId: "child" }),
      options,
    );
    expect(returned?.routes).toEqual(initial.routes);
    act(() => saveState(opened));
    act(() => expand?.());
    expect(initialState).toBe(opened);
    expect(expand).toBeNull();
    expect(container.querySelector("[data-expanded-title]")).toBeNull();
    act(() => saveState(returned));
    expect(container.querySelector("[data-expanded-title]")).toBeNull();
    act(() => saveState(opened));
    act(() => closeExpanded());
    expect(initialState).toBe(opened);
    expect(expand).toBeTypeOf("function");
  }
  // Fork: A different subagent needs a fresh independent navigation state until upstream resets inspector containers by target.
  const previousContainer = containerIdentity;
  act(() =>
    root.render(
      <Preview
        target={{ type: "thread", environmentId: "env", threadId: "working-child" }}
        onOpen={() => {}}
        onClose={() => {}}
        renderThread={() => null}
      />,
    ),
  );
  expect(containerIdentity).not.toBe(previousContainer);
  expect(initialState).toBeUndefined();
});
