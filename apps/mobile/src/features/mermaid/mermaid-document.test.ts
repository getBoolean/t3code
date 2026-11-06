// Fork: Preserve inert diagram input in the offline mobile renderer until native Mermaid support replaces it.
import { expect, it } from "vite-plus/test";
import { expandedMermaidFrame, mermaidDocument, mermaidMessage } from "./mermaid-document";

it.each([
  {
    diagram: { width: 100, height: 1600 },
    viewport: { width: 400, height: 800 },
    frame: { width: 800, height: 1600, x: 350, y: 0 },
  },
  {
    diagram: { width: 1600, height: 100 },
    viewport: { width: 800, height: 400 },
    frame: { width: 1600, height: 800, x: 0, y: 350 },
  },
  {
    diagram: { width: 100, height: 100 },
    viewport: { width: 400, height: 800 },
    frame: { width: 100, height: 200, x: 0, y: 50 },
  },
])(
  "fits and centers the entire diagram in the expanded viewport: $diagram",
  ({ diagram, viewport, frame }) => {
    expect(expandedMermaidFrame(diagram, viewport)).toEqual(frame);
  },
);

it.each([false, true])("keeps diagram input inert in expanded=%s mode", (expanded) => {
  const source = 'graph TD\n A["</script><script>alert(1)</script>"]';
  const colors = { "--pele-fg": "#fafafa" };
  const html = mermaidDocument(source, true, colors, "window.render = true;", expanded);
  expect(html.match(/<script>/g)).toHaveLength(2);
  const configuration = html.match(/window\.__T3_MERMAID__=(.*?);<\/script>/)?.[1];
  expect(JSON.parse(configuration!)).toEqual({ source, dark: true, colors, expanded });
  expect(html).toContain("default-src 'none'");
});

it("accepts diagram dimensions and errors without letting malformed bridge messages break layout", () => {
  expect(mermaidMessage('{"type":"height","height":240}')).toEqual({ type: "height", height: 240 });
  expect(mermaidMessage('{"type":"error"}')).toEqual({ type: "error" });
  for (const data of [
    "null",
    "{",
    "3",
    '{"type":"height","height":-1}',
    '{"type":"height","height":"80"}',
    '{"type":"height","height":1e999}',
  ])
    expect(mermaidMessage(data)).toBeNull();
});
