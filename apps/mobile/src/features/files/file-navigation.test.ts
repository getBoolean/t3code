// Fork: preserve native pop behavior and direct-file recovery across upstream merges.
import * as NodeModule from "node:module";
import { expect, it } from "vite-plus/test";
import { returnToFileThreadAction } from "./file-navigation";

const require = NodeModule.createRequire(import.meta.url);
const requireFromNative = NodeModule.createRequire(
  require.resolve("@react-navigation/native/package.json"),
);
const requireFromCore = NodeModule.createRequire(
  requireFromNative.resolve("@react-navigation/core/package.json"),
);
const { StackActions, StackRouter } = requireFromCore("@react-navigation/routers") as {
  readonly StackActions: typeof import("@react-navigation/native").StackActions;
  readonly StackRouter: typeof import("@react-navigation/native").StackRouter;
};

it("returns from a file to the existing thread and handles a file opened without thread history", () => {
  const router = StackRouter({});
  const options = {
    routeNames: ["Home", "Thread", "ThreadFiles", "ThreadFile"],
    routeParamList: {},
    routeGetIdList: {},
  };
  const apply = (
    state: ReturnType<typeof router.getInitialState>,
    action: Parameters<typeof router.getStateForAction>[1],
  ) => {
    const next = router.getStateForAction(state, action, options);
    if (!next) throw new Error(`Router rejected ${action.type}`);
    return router.getRehydratedState(next, options);
  };
  const params = { environmentId: "environment", threadId: "thread" };
  let state = apply(router.getInitialState(options), StackActions.push("Thread", params));
  const original = state.routes.at(-1)!;
  state = apply(state, StackActions.push("ThreadFiles", params));
  state = apply(state, StackActions.push("ThreadFile", { ...params, path: ["README.md"] }));
  const returned = apply(state, returnToFileThreadAction(params));
  expect(returned.routes.map((route) => route.name)).toEqual(["Home", "Thread"]);
  expect(returned.routes.at(-1)?.key).toBe(original.key);
  const direct = apply(router.getInitialState(options), StackActions.push("ThreadFile", params));
  const recovered = apply(direct, returnToFileThreadAction(params));
  expect(recovered.routes.map((route) => route.name)).toEqual(["Home", "Thread"]);
  expect(recovered.routes.at(-1)?.params).toEqual(params);
});
