import { Marked, Renderer } from "marked";
import { extractFrontMatter, propertyDisplay } from "./frontmatter.js";

export const MERMAID_LIBRARY_ROUTE = "/__tunelito/mermaid.js";
export const MERMAID_CLIENT_ROUTE = "/__tunelito/mermaid-client.js";
export const MARKDOWN_CLIENT_ROUTE = "/__tunelito/markdown-client.js";

const DEFAULT_MARKDOWN_CSS = `
:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.55;
  background: #f7f8fb;
  color: #1f2937;
}
body {
  margin: 0;
  overflow-x: hidden;
}
.tunelito-page-frame {
  box-sizing: border-box;
  min-height: 100vh;
  transition: padding-left 180ms ease;
}
.tunelito-has-properties.tunelito-properties-open .tunelito-page-frame {
  padding-left: 288px;
}
.tunelito-markdown {
  box-sizing: border-box;
  max-width: 760px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 48px 24px 72px;
  background: #ffffff;
}
.tunelito-markdown > :first-child {
  margin-top: 0;
}
.tunelito-markdown > * {
  scroll-margin-top: 24px;
}
.tunelito-markdown h1,
.tunelito-markdown h2,
.tunelito-markdown h3,
.tunelito-markdown h4,
.tunelito-markdown h5,
.tunelito-markdown h6 {
  line-height: 1.2;
  letter-spacing: 0;
  color: #111827;
}
.tunelito-markdown h1 {
  font-size: 2.25rem;
  margin: 0 0 1.5rem;
}
.tunelito-markdown h2 {
  font-size: 1.45rem;
  margin: 2rem 0 0.8rem;
}
.tunelito-markdown h3 {
  font-size: 1.15rem;
  margin: 1.6rem 0 0.6rem;
}
.tunelito-markdown h4 {
  font-size: 1rem;
  margin: 1.35rem 0 0.5rem;
}
.tunelito-markdown h5,
.tunelito-markdown h6 {
  font-size: 0.9rem;
  margin: 1.15rem 0 0.45rem;
}
.tunelito-markdown h6 {
  color: #334155;
  letter-spacing: 0.02em;
}
.tunelito-markdown p,
.tunelito-markdown ul,
.tunelito-markdown ol,
.tunelito-markdown blockquote,
.tunelito-markdown pre,
.tunelito-markdown table {
  margin: 0 0 1rem;
}
.tunelito-markdown a {
  color: #0f766e;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}
.tunelito-wikilink {
  color: #0f766e;
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
  cursor: text;
}
.tunelito-wikilink:hover {
  text-decoration-style: solid;
}
.tunelito-properties {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 2147483600;
  box-sizing: border-box;
  width: 272px;
  overflow: auto;
  border-right: 1px solid #d8e0e8;
  background: #f3f5f4;
  color: #334155;
  box-shadow: 12px 0 36px rgba(15, 23, 42, 0.06);
  transition: transform 180ms ease, visibility 180ms ease;
}
.tunelito-properties-header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 24px 20px 16px;
  border-bottom: 1px solid #dfe5e9;
  background: color-mix(in srgb, #f3f5f4 92%, transparent);
  backdrop-filter: blur(12px);
}
.tunelito-properties-kicker {
  margin: 0 0 3px;
  color: #566477;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.tunelito-properties-title {
  margin: 0;
  color: #1f2937;
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  font-size: 1.05rem;
  font-weight: 650;
}
.tunelito-properties-collapse,
.tunelito-properties-tab {
  border: 1px solid #cbd5df;
  background: #fff;
  color: #475569;
  cursor: pointer;
  font: 700 0.75rem/1 ui-sans-serif, system-ui, sans-serif;
}
.tunelito-properties-collapse {
  width: 34px;
  height: 34px;
  border-radius: 999px;
}
.tunelito-properties-collapse:hover,
.tunelito-properties-tab:hover {
  border-color: #0f766e;
  color: #0f766e;
}
.tunelito-properties-collapse:focus-visible,
.tunelito-properties-tab:focus-visible {
  outline: 3px solid rgba(20, 184, 166, 0.32);
  outline-offset: 3px;
}
.tunelito-properties-list {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 20px;
}
.tunelito-property {
  display: grid;
  gap: 5px;
}
.tunelito-property dt {
  color: #566477;
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tunelito-property dd {
  min-width: 0;
  margin: 0;
  color: #263445;
  font-size: 0.86rem;
  overflow-wrap: anywhere;
}
.tunelito-property-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.tunelito-property-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border: 1px solid #c9ddd9;
  border-radius: 999px;
  background: #e8f2ef;
  color: #305d57;
  padding: 2px 8px;
  font-size: 0.76rem;
}
.tunelito-property-complex {
  margin: 0;
  white-space: pre-wrap;
  font: 0.72rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.tunelito-properties-error {
  margin: 20px;
  border: 1px solid #e3b6a7;
  border-radius: 8px;
  background: #fff7ed;
  padding: 14px;
  color: #7c2d12;
  font-size: 0.82rem;
}
.tunelito-properties-error p {
  margin: 0 0 10px;
}
.tunelito-properties-error details pre {
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 0.7rem;
}
.tunelito-properties-tab {
  position: fixed;
  top: 32px;
  left: 0;
  z-index: 2147483601;
  min-height: 42px;
  border-left: 0;
  border-radius: 0 999px 999px 0;
  box-shadow: 6px 8px 22px rgba(15, 23, 42, 0.12);
  padding: 0 14px 0 11px;
}
.tunelito-properties-collapsed .tunelito-properties {
  visibility: hidden;
  transform: translateX(-100%);
}
.tunelito-properties-open .tunelito-properties-tab {
  display: none;
}
.tunelito-document-map {
  --ruler-unread: #64748b;
  --ruler-consumed: #dbe2e8;
  --ruler-accent: #0f766e;
  position: fixed;
  top: 22px;
  right: 0;
  bottom: 22px;
  z-index: 2147483598;
  width: 58px;
  color: #334155;
  transition: width 160ms ease, right 160ms ease, opacity 160ms ease;
}
.tunelito-document-map:hover,
.tunelito-document-map:focus-within,
.tunelito-document-map[data-pinned="true"] {
  width: min(300px, 40vw);
}
.tunelito-document-map-track {
  position: absolute;
  inset: 36px 0 18px;
}
.tunelito-ruler-toggle {
  position: absolute;
  top: 0;
  right: 13px;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font: 700 18px/1 ui-sans-serif, system-ui, sans-serif;
}
.tunelito-ruler-toggle:hover,
.tunelito-ruler-toggle:focus-visible {
  color: var(--ruler-accent);
  outline: 2px solid rgba(20, 184, 166, 0.35);
  outline-offset: 1px;
}
.tunelito-ruler-marker {
  position: absolute;
  top: calc(var(--ruler-position) * 100%);
  right: 12px;
  display: block;
  width: var(--ruler-length);
  height: 16px;
  margin: -8px 0 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}
.tunelito-document-map:hover .tunelito-ruler-marker,
.tunelito-document-map:focus-within .tunelito-ruler-marker,
.tunelito-document-map[data-pinned="true"] .tunelito-ruler-marker {
  width: calc(var(--ruler-length) + 190px);
}
.tunelito-ruler-tick {
  position: absolute;
  top: 7px;
  right: 0;
  width: var(--ruler-length);
  height: 1px;
  background: var(--ruler-unread);
  transition: width 120ms ease, background 120ms ease, height 120ms ease;
}
.tunelito-ruler-marker[data-state="consumed"] .tunelito-ruler-tick {
  background: var(--ruler-consumed);
}
.tunelito-ruler-marker[data-state="current"] .tunelito-ruler-tick,
.tunelito-ruler-marker:hover .tunelito-ruler-tick,
.tunelito-ruler-marker:focus-visible .tunelito-ruler-tick {
  width: 38px;
  height: 2px;
  background: var(--ruler-accent);
}
.tunelito-ruler-label {
  position: absolute;
  top: 50%;
  right: 48px;
  max-width: 205px;
  overflow: hidden;
  color: #475569;
  font: 650 0.73rem/1.2 ui-sans-serif, system-ui, sans-serif;
  opacity: 0;
  pointer-events: none;
  text-align: right;
  text-overflow: ellipsis;
  transform: translate(8px, -50%);
  transition: opacity 120ms ease, transform 120ms ease;
  white-space: nowrap;
}
.tunelito-document-map:hover .tunelito-ruler-label,
.tunelito-document-map:focus-within .tunelito-ruler-label,
.tunelito-document-map[data-pinned="true"] .tunelito-ruler-label {
  opacity: 1;
  pointer-events: auto;
  transform: translate(0, -50%);
}
.tunelito-ruler-marker[data-state="current"] .tunelito-ruler-label,
.tunelito-ruler-marker:hover .tunelito-ruler-label,
.tunelito-ruler-marker:focus-visible .tunelito-ruler-label {
  color: var(--ruler-accent);
}
.tunelito-ruler-marker:focus-visible {
  outline: 2px solid rgba(20, 184, 166, 0.4);
  outline-offset: 2px;
}
.tunelito-ruler-scrubber {
  position: absolute;
  top: 36px;
  right: 10px;
  bottom: 18px;
  width: 40px;
  height: auto;
  border: 0;
  padding: 0;
  background: transparent;
  pointer-events: none;
}
.tunelito-ruler-scrubber:focus-visible {
  outline: 2px solid var(--ruler-accent);
  outline-offset: 4px;
}
body.tunelito-comments-open .tunelito-document-map {
  right: 396px;
}
@media (max-width: 1180px) {
  body.tunelito-comments-open .tunelito-document-map {
    opacity: 0;
    pointer-events: none;
  }
}
@media (max-width: 960px) {
  .tunelito-has-properties.tunelito-properties-open .tunelito-page-frame {
    padding-left: 0;
  }
  .tunelito-properties {
    width: min(320px, calc(100vw - 28px));
    box-shadow: 18px 0 50px rgba(15, 23, 42, 0.2);
  }
}
@media (max-width: 760px) {
  .tunelito-document-map {
    display: none;
  }
  .tunelito-markdown {
    padding: 34px 20px 64px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tunelito-page-frame,
  .tunelito-properties,
  .tunelito-document-map,
  .tunelito-ruler-tick,
  .tunelito-ruler-label {
    scroll-behavior: auto;
    transition: none;
  }
}
.tunelito-markdown blockquote {
  border-left: 4px solid #cbd5e1;
  padding-left: 1rem;
  color: #475569;
}
.tunelito-markdown code,
.tunelito-markdown pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
.tunelito-markdown code {
  border-radius: 4px;
  padding: 0.1rem 0.28rem;
  background: #edf2f7;
}
.tunelito-markdown pre {
  overflow-x: auto;
  border: 1px solid #dbe3ee;
  border-radius: 8px;
  padding: 1rem;
  background: #111827;
  color: #f9fafb;
}
.tunelito-markdown pre code {
  padding: 0;
  background: transparent;
  color: inherit;
}
.tunelito-mermaid {
  margin: 0 0 1rem;
  border: 1px solid #dbe3ee;
  border-radius: 8px;
  padding: 1rem;
  background: #f8fafc;
}
.tunelito-mermaid-canvas {
  overflow-x: auto;
  text-align: center;
}
.tunelito-mermaid-canvas svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.tunelito-mermaid-status {
  margin: 0.75rem 0 0;
  color: #475569;
  font-size: 0.9rem;
}
.tunelito-mermaid[data-mermaid-state="rendered"] .tunelito-mermaid-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.tunelito-mermaid[data-mermaid-state="error"] {
  border-color: #dc2626;
  background: #fef2f2;
}
.tunelito-mermaid[data-mermaid-state="error"] .tunelito-mermaid-status {
  color: #991b1b;
  font-weight: 600;
}
.tunelito-mermaid details {
  margin-top: 0.75rem;
}
.tunelito-mermaid details pre {
  margin: 0.75rem 0 0;
}
.tunelito-markdown table {
  width: 100%;
  border-collapse: collapse;
}
.tunelito-markdown th,
.tunelito-markdown td {
  border: 1px solid #dbe3ee;
  padding: 0.5rem 0.65rem;
  text-align: left;
}
.tunelito-markdown th {
  background: #f1f5f9;
}
.tunelito-markdown img {
  max-width: 100%;
  height: auto;
}
@media (prefers-color-scheme: dark) {
  :root {
    background: #111827;
    color: #e5e7eb;
  }
  .tunelito-markdown {
    background: #18202f;
  }
  .tunelito-markdown h1,
  .tunelito-markdown h2,
  .tunelito-markdown h3,
  .tunelito-markdown h4,
  .tunelito-markdown h5,
  .tunelito-markdown h6 {
    color: #f9fafb;
  }
  .tunelito-markdown h6 {
    color: #cbd5e1;
  }
  .tunelito-markdown a {
    color: #5eead4;
  }
  .tunelito-wikilink {
    color: #5eead4;
  }
  .tunelito-properties {
    border-right-color: #334155;
    background: #151d2a;
    color: #cbd5e1;
    box-shadow: 12px 0 40px rgba(0, 0, 0, 0.18);
  }
  .tunelito-properties-header {
    border-bottom-color: #334155;
    background: color-mix(in srgb, #151d2a 92%, transparent);
  }
  .tunelito-properties-kicker,
  .tunelito-property dt {
    color: #94a3b8;
  }
  .tunelito-properties-title,
  .tunelito-property dd {
    color: #e5e7eb;
  }
  .tunelito-properties-collapse,
  .tunelito-properties-tab {
    border-color: #475569;
    background: #1f2937;
    color: #cbd5e1;
  }
  .tunelito-property-pill {
    border-color: #285b55;
    background: #183c39;
    color: #99f6e4;
  }
  .tunelito-properties-error {
    border-color: #9a5a42;
    background: #351f1b;
    color: #fed7aa;
  }
  .tunelito-document-map {
    --ruler-unread: #94a3b8;
    --ruler-consumed: #263244;
    --ruler-accent: #5eead4;
    color: #cbd5e1;
  }
  .tunelito-ruler-label {
    color: #cbd5e1;
  }
  .tunelito-markdown blockquote {
    border-left-color: #475569;
    color: #cbd5e1;
  }
  .tunelito-markdown code {
    background: #243044;
  }
  .tunelito-markdown th,
  .tunelito-markdown td,
  .tunelito-markdown pre {
    border-color: #334155;
  }
  .tunelito-markdown th {
    background: #243044;
  }
  .tunelito-mermaid {
    border-color: #334155;
    background: #111827;
  }
  .tunelito-mermaid-status {
    color: #cbd5e1;
  }
  .tunelito-mermaid[data-mermaid-state="error"] {
    border-color: #f87171;
    background: #351b22;
  }
  .tunelito-mermaid[data-mermaid-state="error"] .tunelito-mermaid-status {
    color: #fecaca;
  }
}
`;

function createMarkdownParser() {
  let hasMermaid = false;
  const defaultRenderer = new Renderer();
  const parser = new Marked({
    gfm: true,
    extensions: [
      {
        name: "escaped-inline-html",
        level: "inline",
        start(source) {
          return source.indexOf("<");
        },
        tokenizer(source) {
          const match = /^<([A-Za-z][A-Za-z0-9-]*)\b[^<>]*>[\s\S]*?<\/\1\s*>/i.exec(source);
          if (!match) return undefined;
          return { type: "escaped-inline-html", raw: match[0] };
        },
        renderer(token) {
          return escapeHtml(token.raw);
        },
      },
      {
        name: "obsidian-embed",
        level: "inline",
        start(source) {
          return source.indexOf("![[");
        },
        tokenizer(source) {
          const match = /^!\[\[([^\]\n]*)\]\]/.exec(source);
          if (!match) return undefined;
          return { type: "obsidian-embed", raw: match[0] };
        },
        renderer(token) {
          return escapeHtml(token.raw);
        },
      },
      {
        name: "wikilink",
        level: "inline",
        start(source) {
          return source.indexOf("[[");
        },
        tokenizer(source) {
          const match = /^\[\[([^\]\n]+)\]\]/.exec(source);
          if (!match) return undefined;
          const parsed = parseWikiLink(match[1]);
          if (!parsed) return undefined;
          return { type: "wikilink", raw: match[0], ...parsed };
        },
        renderer(token) {
          const normalizedTarget = token.target && token.heading ? `${token.target}#${token.heading}` : token.target || `#${token.heading}`;
          const targetAttribute = ` data-tunelito-wikilink="${escapeAttribute(normalizedTarget)}"`;
          const headingAttribute = token.heading ? ` data-tunelito-wikilink-heading="${escapeAttribute(token.heading)}"` : "";
          return `<span class="tunelito-wikilink"${targetAttribute}${headingAttribute}>${escapeHtml(token.label)}</span>`;
        },
      },
    ],
    renderer: {
      html(token) {
        return escapeHtml(token?.raw || token?.text || "");
      },
      link(token) {
        const href = safeHref(token?.href, { media: false });
        const text = this.parser.parseInline(token?.tokens || []);
        if (!href) return text;
        const title = token?.title ? ` title="${escapeAttribute(token.title)}"` : "";
        return `<a href="${escapeAttribute(href)}"${title}>${text}</a>`;
      },
      image(token) {
        const src = safeHref(token?.href, { media: true });
        const alt = escapeAttribute(token?.text || "");
        if (!src) return alt;
        const title = token?.title ? ` title="${escapeAttribute(token.title)}"` : "";
        return `<img src="${escapeAttribute(src)}" alt="${alt}"${title}>`;
      },
      code(token) {
        if (String(token?.lang || "").trim().toLowerCase() !== "mermaid") {
          return defaultRenderer.code.call(this, token);
        }
        hasMermaid = true;
        return renderMermaidFigure(token?.text || "");
      },
    },
  });
  return { parser, hasMermaid: () => hasMermaid };
}

export function isMarkdownPath(pathname) {
  return /\.md$/i.test(String(pathname || ""));
}

export function renderMarkdownDocument({ markdownSource, sourceName = "Markdown page", cssHref = "" } = {}) {
  const title = String(sourceName || "Markdown page");
  const frontMatter = extractFrontMatter(markdownSource);
  const markdown = createMarkdownParser();
  const body = markdown.parser.parse(frontMatter.body);
  const customCssHref = normalizeMarkdownCssHref(cssHref, { throwOnUnsafe: false });
  const customCss = customCssHref ? `  <link rel="stylesheet" href="${escapeAttribute(customCssHref)}">\n` : "";
  const properties = renderProperties(frontMatter);
  const bodyClasses = frontMatter.kind === "none" ? "" : ' class="tunelito-has-properties tunelito-properties-open"';
  const mermaidScripts = markdown.hasMermaid()
    ? [
        `  <script src="${MERMAID_LIBRARY_ROUTE}" defer></script>`,
        `  <script src="${MERMAID_CLIENT_ROUTE}" defer></script>`,
      ]
    : [];

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    DEFAULT_MARKDOWN_CSS.trim(),
    "  </style>",
    customCss.trimEnd(),
    ...mermaidScripts,
    `  <script src="${MARKDOWN_CLIENT_ROUTE}" defer></script>`,
    "</head>",
    `<body${bodyClasses}>`,
    '  <div class="tunelito-page-frame">',
    properties,
    `    <main class="tunelito-markdown" data-tunelito-source-type="markdown">\n${body.trimEnd()}\n    </main>`,
    '    <nav class="tunelito-document-map" aria-label="Document map" data-tunelito-document-map></nav>',
    "  </div>",
    "</body>",
    "</html>",
  ].filter((line) => line !== "").join("\n");
}

function parseWikiLink(value) {
  const source = String(value || "");
  const pipeIndex = source.indexOf("|");
  const reference = (pipeIndex >= 0 ? source.slice(0, pipeIndex) : source).trim();
  const alias = pipeIndex >= 0 ? source.slice(pipeIndex + 1).trim() : "";
  if (!reference || (pipeIndex >= 0 && !alias) || reference.includes("[") || reference.includes("]")) return null;

  const hashIndex = reference.indexOf("#");
  const target = (hashIndex >= 0 ? reference.slice(0, hashIndex) : reference).trim();
  const heading = (hashIndex >= 0 ? reference.slice(hashIndex + 1) : "").trim();
  if (!target && !heading) return null;
  if (hashIndex >= 0 && !heading) return null;

  return {
    target,
    heading,
    alias,
    label: alias || (target && heading ? `${target} › ${heading}` : target || heading),
  };
}

function renderProperties(frontMatter) {
  if (frontMatter.kind === "none") return "";
  const count = frontMatter.properties.length;
  const countLabel = frontMatter.kind === "error" ? "issue" : String(count);
  const content = frontMatter.kind === "error"
    ? renderPropertiesError(frontMatter)
    : `<dl class="tunelito-properties-list">\n${frontMatter.properties.map(renderProperty).join("\n")}\n      </dl>`;

  return [
    '    <button class="tunelito-properties-tab" type="button" aria-controls="tunelito-properties" aria-expanded="true" hidden>',
    `      Properties · ${escapeHtml(countLabel)}`,
    "    </button>",
    '    <aside class="tunelito-properties" id="tunelito-properties" aria-label="Document properties">',
    '      <header class="tunelito-properties-header">',
    "        <div>",
    '          <p class="tunelito-properties-kicker">Document metadata</p>',
    `          <h2 class="tunelito-properties-title">Properties · ${escapeHtml(countLabel)}</h2>`,
    "        </div>",
    '        <button class="tunelito-properties-collapse" type="button" aria-controls="tunelito-properties" aria-expanded="true" aria-label="Collapse document properties">←</button>',
    "      </header>",
    content,
    "    </aside>",
  ].join("\n");
}

function renderProperty({ key, value }) {
  const display = propertyDisplay(value);
  let renderedValue;
  if (display.kind === "pills") {
    renderedValue = `<span class="tunelito-property-pills">${display.values.map((item) => `<span class="tunelito-property-pill">${escapeHtml(item)}</span>`).join("")}</span>`;
  } else if (display.kind === "complex") {
    renderedValue = `<pre class="tunelito-property-complex">${escapeHtml(display.text)}</pre>`;
  } else {
    renderedValue = escapeHtml(display.text);
  }
  return `        <div class="tunelito-property"><dt>${escapeHtml(key)}</dt><dd>${renderedValue}</dd></div>`;
}

function renderPropertiesError(frontMatter) {
  return [
    '      <div class="tunelito-properties-error" role="status">',
    `        <p><strong>Metadata needs attention.</strong> ${escapeHtml(frontMatter.error)}</p>`,
    "        <details>",
    "          <summary>View front matter source</summary>",
    `          <pre>${escapeHtml(frontMatter.originalSource)}</pre>`,
    "        </details>",
    "      </div>",
  ].join("\n");
}

function renderMermaidFigure(source) {
  const escapedSource = escapeHtml(source);
  return [
    '<figure class="tunelito-mermaid" data-tunelito-mermaid data-mermaid-state="source">',
    '  <div class="tunelito-mermaid-canvas" aria-hidden="true"></div>',
    '  <figcaption class="tunelito-mermaid-status">Mermaid diagram source. Diagram rendering requires JavaScript.</figcaption>',
    "  <details open>",
    "    <summary>View Mermaid source</summary>",
    `    <pre><code class="language-mermaid">${escapedSource}\n</code></pre>`,
    "  </details>",
    "</figure>",
  ].join("\n");
}

export function normalizeMarkdownCssHref(value, { throwOnUnsafe = true } = {}) {
  const href = String(value || "").replace(/\u0000/g, "").trim().slice(0, 2000);
  if (!href) return "";
  if (isSafeHref(href, { media: false, allowMailto: false })) return href;
  if (!throwOnUnsafe) return "";
  throw new Error("--markdown-css must be a relative path, root-relative path, http URL, or https URL");
}

function safeHref(value, { media }) {
  const href = String(value || "").replace(/\u0000/g, "").trim();
  return isSafeHref(href, { media, allowMailto: !media }) ? href : "";
}

function isSafeHref(href, { media, allowMailto }) {
  if (!href) return false;
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) return true;
  if (/^[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:[/?#]|$)/.test(href) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)) return true;
  try {
    const protocol = new URL(href).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" || (allowMailto && protocol === "mailto:");
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
