// Fork: Render Mermaid offline in a sandboxed mobile WebView until native Markdown has diagram support.
import DOMPurify from "dompurify";
import { enableZoom, mount, render, type Zoom } from "pele";
import { expandedMermaidFrame } from "./mermaid-document";

declare global {
  interface Window {
    __T3_MERMAID__: {
      source: string;
      dark: boolean;
      colors: Record<string, string>;
      expanded: boolean;
    };
    ReactNativeWebView: { postMessage: (message: string) => void };
  }
}

const configuration = window.__T3_MERMAID__;
document.documentElement.style.colorScheme = configuration.dark ? "dark" : "light";
// Pele's SVG defaults stay light regardless of the WebView's color scheme.
for (const [name, color] of Object.entries(configuration.colors)) {
  document.documentElement.style.setProperty(name, color);
}
const container = document.getElementById("diagram")!;
const report = (message: object) => {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- React Native's bridge takes only the message.
  window.ReactNativeWebView.postMessage(JSON.stringify(message));
};
const options = {
  links: false,
  images: false,
  autoDirection: false,
};
const sanitize = (svg: string) =>
  DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["foreignObject", "image", "a", "style"],
  });
if (configuration.expanded) {
  // Fork: Pele fits zoom by width, so pad the SVG domain to the viewport's aspect ratio until its zoom API supports height fitting.
  try {
    const diagram = render(configuration.source, options);
    let zoom: Zoom | undefined;
    new ResizeObserver(() => {
      const viewport = container.getBoundingClientRect();
      if (viewport.width <= 0 || viewport.height <= 0) return;
      zoom?.destroy();
      const svg = sanitize(diagram.svg).firstElementChild!;
      const frame = expandedMermaidFrame(diagram, viewport);
      svg.setAttribute("x", String(frame.x));
      svg.setAttribute("y", String(frame.y));
      if (svg instanceof SVGSVGElement) {
        svg.style.height = "";
        svg.style.maxWidth = "none";
      }
      const outer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      outer.setAttribute("width", String(frame.width));
      outer.setAttribute("height", String(frame.height));
      outer.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
      outer.style.width = "100%";
      outer.style.height = "100%";
      outer.append(svg);
      container.replaceChildren(outer);
      zoom = enableZoom(container, { always: true });
    }).observe(container);
  } catch {
    report({ type: "error" });
  }
} else {
  mount(container, configuration.source, {
    ...options,
    zoom: false,
    sanitize,
    onError: () => report({ type: "error" }),
  });
  new ResizeObserver(() => {
    report({ type: "height", height: Math.ceil(container.getBoundingClientRect().height) });
  }).observe(container);
}
