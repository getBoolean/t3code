export function returnToFileThreadAction(params: {
  readonly environmentId: string;
  readonly threadId: string;
}) {
  return { type: "POP_TO" as const, payload: { name: "Thread", params } };
}
