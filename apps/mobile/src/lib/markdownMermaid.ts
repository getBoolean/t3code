// Fork: Adapt closed Mermaid fences to native image slots until upstream offers custom code block rendering.
import type { Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse);

export function markdownWithMermaidBlocks(markdown: string) {
  const diagrams = new Map<string, { source: string; markdown: string }>();
  if (!markdown.includes("mermaid")) return { markdown, diagrams };
  const edits: { start: number; end: number; content: string }[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === "code" && node.lang === "mermaid") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || !node.value.trim()) return;
      const fenced = markdown.slice(start, end);
      const lines = fenced.split(/\r?\n/);
      const opening = /^(`{3,}|~{3,})/.exec(lines[0] ?? "")?.[1];
      const closing = /^[\s>]*(`{3,}|~{3,})\s*$/.exec(lines.at(-1) ?? "")?.[1];
      if (
        !opening ||
        !closing ||
        closing[0] !== opening[0] ||
        closing.length < opening.length ||
        lines.length < node.value.split("\n").length + 2
      )
        return;
      const href = `t3-mermaid://diagram/${diagrams.size}`;
      diagrams.set(href, {
        source: node.value,
        markdown: `${opening}mermaid\n${node.value}\n${opening}`,
      });
      edits.push({ start, end, content: `![Mermaid diagram](${href})` });
    } else if (node.type === "root" || node.type === "blockquote") {
      // Native slots do not replace images inside lists or table cells.
      for (const child of node.children) visit(child);
    }
  };
  visit(parser.parse(markdown));
  let result = "";
  let offset = 0;
  for (const edit of edits) {
    result += markdown.slice(offset, edit.start) + edit.content;
    offset = edit.end;
  }
  return { markdown: result + markdown.slice(offset), diagrams };
}
