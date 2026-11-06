// Fork: Keep diagram input inert and renderer assets offline until mobile gains native Mermaid rendering.
export function expandedMermaidFrame(
  diagram: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const scale = Math.min(viewport.width / diagram.width, viewport.height / diagram.height);
  const width = viewport.width / scale;
  const height = viewport.height / scale;
  return { width, height, x: (width - diagram.width) / 2, y: (height - diagram.height) / 2 };
}

export function mermaidMessage(data: string) {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object" || !("type" in message)) return null;
  if (message.type === "error") return { type: "error" } as const;
  if (
    message.type === "height" &&
    "height" in message &&
    typeof message.height === "number" &&
    Number.isFinite(message.height) &&
    message.height > 0
  )
    return { type: "height", height: message.height } as const;
  return null;
}

export function mermaidDocument(
  source: string,
  dark: boolean,
  colors: Record<string, string>,
  script: string,
  expanded = false,
) {
  const configuration = JSON.stringify({ source, dark, colors, expanded }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>html,body { margin:0; background:transparent; ${expanded ? "height:100%; overflow:hidden;" : ""} } #diagram { width:100%; ${expanded ? "height:100%;" : ""} } ${expanded ? "#diagram>svg { display:block; }" : "svg { display:block; max-width:100%; height:auto; }"}</style>
</head><body><div id="diagram"></div><script>window.__T3_MERMAID__=${configuration};</script>
<script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
