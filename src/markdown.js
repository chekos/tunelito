import { Marked, Renderer } from "marked";

export const MERMAID_LIBRARY_ROUTE = "/__tunelito/mermaid.js";
export const MERMAID_CLIENT_ROUTE = "/__tunelito/mermaid-client.js";

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
.tunelito-markdown h1,
.tunelito-markdown h2,
.tunelito-markdown h3 {
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
  .tunelito-markdown h3 {
    color: #f9fafb;
  }
  .tunelito-markdown a {
    color: #5eead4;
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
  const markdown = createMarkdownParser();
  const body = markdown.parser.parse(String(markdownSource || "").replace(/^\uFEFF/, ""));
  const customCssHref = normalizeMarkdownCssHref(cssHref, { throwOnUnsafe: false });
  const customCss = customCssHref ? `  <link rel="stylesheet" href="${escapeAttribute(customCssHref)}">\n` : "";
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
    "</head>",
    "<body>",
    `  <main class="tunelito-markdown" data-tunelito-source-type="markdown">\n${body.trimEnd()}\n  </main>`,
    "</body>",
    "</html>",
  ].filter((line) => line !== "").join("\n");
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
