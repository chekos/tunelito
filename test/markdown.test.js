import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKDOWN_CLIENT_ROUTE,
  MERMAID_CLIENT_ROUTE,
  MERMAID_LIBRARY_ROUTE,
  renderMarkdownDocument,
} from "../src/markdown.js";

test("renderMarkdownDocument moves valid YAML front matter into the left properties drawer", () => {
  const html = renderMarkdownDocument({
    sourceName: "obsidian-note.md",
    markdownSource: [
      "---",
      "status: active",
      "tags: [markdown, review]",
      "owner:",
      "  name: '<img src=x onerror=alert(1)>'",
      "---",
      "",
      "# Review notes",
    ].join("\n"),
  });

  assert.match(html, /class="tunelito-has-properties tunelito-properties-open"/);
  assert.match(html, /id="tunelito-properties"/);
  assert.match(html, /id="tunelito-properties"[^>]*data-tunelito-comment-ignore/);
  assert.match(html, /data-tunelito-source-type="markdown" data-tunelito-comment-surface/);
  assert.match(html, /Properties · 3/);
  assert.match(html, /class="tunelito-property-pill">markdown/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<p>status: active/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /<h1>Review notes<\/h1>/);
  assert.match(html, new RegExp(MARKDOWN_CLIENT_ROUTE));
});

test("renderMarkdownDocument keeps invalid front matter inspectable and the article readable", () => {
  const html = renderMarkdownDocument({ markdownSource: "---\nstatus: [broken <script>\n---\n\n# Still readable" });

  assert.match(html, /Metadata needs attention/);
  assert.match(html, /View front matter source/);
  assert.match(html, /status: \[broken &lt;script&gt;/);
  assert.match(html, /<h1>Still readable<\/h1>/);
  assert.doesNotMatch(html, /<script>\n/);
});

test("renderMarkdownDocument renders supported wiki-link forms as honest inline references", () => {
  const html = renderMarkdownDocument({
    markdownSource: "[[Tunelito]] · [[Review workflow|the workflow]] · [[Tunelito#Security]] · [[#Local review]] · [[Tunelito#Security|security notes]]",
  });

  assert.match(html, /data-tunelito-wikilink="Tunelito">Tunelito<\/span>/);
  assert.match(html, /data-tunelito-wikilink="Review workflow">the workflow<\/span>/);
  assert.match(html, /data-tunelito-wikilink="Tunelito#Security"[^>]*>Tunelito › Security<\/span>/);
  assert.match(html, /data-tunelito-wikilink="#Local review"[^>]*>Local review<\/span>/);
  assert.match(html, />security notes<\/span>/);
  assert.doesNotMatch(html, /class="tunelito-wikilink"[^>]*href=/);
});

test("wiki links preserve Unicode and leave malformed candidates readable", () => {
  const html = renderMarkdownDocument({
    markdownSource: "[[Café ☕#Décisions|Revisión 日本語]] · [[ ]] · [[|alias]] · [[target|]] · [[target#]] · [[unclosed",
  });

  assert.match(html, /data-tunelito-wikilink="Café ☕#Décisions"/);
  assert.match(html, />Revisión 日本語<\/span>/);
  assert.match(html, /\[\[ \]\]/);
  assert.match(html, /\[\[\|alias\]\]/);
  assert.match(html, /\[\[target\|\]\]/);
  assert.match(html, /\[\[target#\]\]/);
  assert.match(html, /\[\[unclosed/);
});

test("wiki links escape hostile text and stay out of code, raw HTML, escaped literals, and embeds", () => {
  const html = renderMarkdownDocument({
    markdownSource: [
      "[[javascript:alert(1)|<img src=x onerror=alert(1)>]]",
      "",
      "`[[Inline code]]` and \\[[Escaped]] and ![[Embed]]",
      "",
      "<span>[[Raw HTML]]</span>",
      "<img alt=\"[[Raw attribute]]\">",
      "",
      "```text",
      "[[Fenced code]]",
      "```",
      "",
      "[safe](https://example.com) [unsafe](javascript:alert(1)) ![image](./safe.png)",
    ].join("\n"),
  });

  assert.match(html, /data-tunelito-wikilink="javascript:alert\(1\)"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;<\/span>/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /<code>\[\[Inline code\]\]<\/code>/);
  assert.match(html, /\[\[Escaped\]\]/);
  assert.match(html, /!\[\[Embed\]\]/);
  assert.match(html, /&lt;span&gt;\[\[Raw HTML\]\]&lt;\/span&gt;/);
  assert.match(html, /&lt;img alt=&quot;\[\[Raw attribute\]\]&quot;&gt;/);
  assert.doesNotMatch(html, /data-tunelito-wikilink="Raw attribute"/);
  assert.match(html, /<code class="language-text">\[\[Fenced code\]\]/);
  assert.match(html, /<a href="https:\/\/example\.com">safe<\/a>/);
  assert.match(html, /<p>safe<\/p>|>unsafe<\/a>| unsafe /);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<img src="\.\/safe\.png" alt="image">/);
});

test("renderMarkdownDocument adds a desktop document-map shell with theme and reduced-motion states", () => {
  const html = renderMarkdownDocument({ markdownSource: "# Title\n\nParagraph\n\n## Section\n\nMore prose" });

  assert.match(html, /aria-label="Document map"/);
  assert.match(html, /data-tunelito-document-map/);
  assert.match(html, /data-tunelito-document-map data-tunelito-comment-ignore/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /max-width: 760px/);
  assert.match(html, /body\.tunelito-comments-open \.tunelito-document-map/);
});

test("renderMarkdownDocument turns Mermaid fences into source-preserving diagram figures", () => {
  const html = renderMarkdownDocument({
    sourceName: "architecture.md",
    markdownSource: [
      "# Architecture",
      "",
      "```MeRmAiD",
      "flowchart LR",
      "  A[Source <script> [[Not a wiki link]]] --> B[Review]",
      "```",
    ].join("\n"),
  });

  assert.match(html, /data-tunelito-mermaid/);
  assert.match(html, /data-mermaid-state="source"/);
  assert.match(html, /class="language-mermaid"/);
  assert.match(html, /A\[Source &lt;script&gt; \[\[Not a wiki link\]\]\]/);
  assert.match(html, /\[\[Not a wiki link\]\]/);
  assert.doesNotMatch(html, /data-tunelito-wikilink="Not a wiki link"/);
  assert.match(html, new RegExp(MERMAID_LIBRARY_ROUTE));
  assert.match(html, new RegExp(MERMAID_CLIENT_ROUTE));
  assert.match(html, /<summary>View Mermaid source<\/summary>/);
  assert.doesNotMatch(html, /<script>\]/);
});

test("renderMarkdownDocument leaves ordinary fenced code unchanged and omits Mermaid assets", () => {
  const html = renderMarkdownDocument({
    markdownSource: "```javascript\nconst label = '<safe>';\n```",
  });

  assert.match(html, /<pre><code class="language-javascript">/);
  assert.match(html, /const label = &#39;&lt;safe&gt;&#39;;/);
  assert.doesNotMatch(html, /data-tunelito-mermaid/);
  assert.doesNotMatch(html, new RegExp(MERMAID_LIBRARY_ROUTE));
  assert.doesNotMatch(html, new RegExp(MERMAID_CLIENT_ROUTE));
});

test("renderMarkdownDocument only treats an exact Mermaid language tag as a diagram", () => {
  const html = renderMarkdownDocument({ markdownSource: "```mermaid-example\ngraph TD\n```" });

  assert.match(html, /<code class="language-mermaid-example">/);
  assert.doesNotMatch(html, /data-tunelito-mermaid/);
});
