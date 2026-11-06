// Fork: Preserve completed native Mermaid embeds and source fallbacks until upstream supports code block renderers.
import { expect, it } from "vite-plus/test";
import { markdownWithMermaidBlocks } from "./markdownMermaid";

it("embeds completed Mermaid fences without changing other code or unfinished streams", () => {
  const markdown =
    "Before\n\n```mermaid\ngraph LR\n A --> B\n```\n\n```ts\nconst x = 1;\n```\n\n~~~mermaid\nsequenceDiagram\n A->>B: Hi\n~~~\n\n```mermaid\ngraph LR\n A -->";
  const result = markdownWithMermaidBlocks(markdown);
  expect([...result.diagrams.values()]).toEqual([
    { source: "graph LR\n A --> B", markdown: "```mermaid\ngraph LR\n A --> B\n```" },
    {
      source: "sequenceDiagram\n A->>B: Hi",
      markdown: "~~~mermaid\nsequenceDiagram\n A->>B: Hi\n~~~",
    },
  ]);
  expect(result.markdown).toContain("![Mermaid diagram](t3-mermaid://diagram/0)");
  expect(result.markdown).toContain("```ts\nconst x = 1;\n```");
  expect(result.markdown).toContain("```mermaid\ngraph LR\n A -->");
});

it("preserves quote placement and leaves list and literal fences in native code", () => {
  const quote = "> ```mermaid\n> graph TD\n> A --> B\n> ```";
  expect(markdownWithMermaidBlocks(quote).markdown).toBe(
    "> ![Mermaid diagram](t3-mermaid://diagram/0)",
  );
  for (const markdown of [
    "- item\n\n  ```mermaid\n  graph TD\n  A --> B\n  ```",
    "````text\n```mermaid\ngraph TD\nA --> B\n```\n````",
    "```mermaid\ngraph TD\nA --> B\n~~~",
    "```mermaid\ngraph TD\n> ```",
    "    ```mermaid\n    graph TD\n    ```",
  ]) {
    expect(markdownWithMermaidBlocks(markdown).markdown).toBe(markdown);
  }
});
