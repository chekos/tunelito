import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKDOWN_CLIENT_ROUTE,
  MERMAID_CLIENT_ROUTE,
  MERMAID_LIBRARY_ROUTE,
  renderFolderLandingDocument,
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

  assert.match(html, /class="tunelito-has-properties tunelito-has-sidebar tunelito-properties-open"/);
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

test("renderMarkdownDocument keeps injected navigation distinct from source properties", () => {
  const html = renderMarkdownDocument({
    sourceName: "Project brief.md",
    markdownSource: "---\nstatus: active\n---\n\n# Project brief",
    navigation: {
      entries: [
        { type: "document", name: "Project brief.md", href: "/Project%20brief.md", current: true },
        {
          type: "directory",
          name: "Resources",
          href: "/Resources/",
          children: [
            { type: "document", name: "Café & notes.md", href: "/Resources/Caf%C3%A9%20%26%20notes.md", current: false },
            {
              type: "directory",
              name: "Deep",
              href: "/Resources/Deep/",
              children: [{ type: "document", name: "ten.md", href: "/Resources/Deep/ten.md", current: false }],
            },
          ],
        },
      ],
    },
  });

  assert.match(html, /Tunelito navigation/);
  assert.match(html, /Served documents/);
  assert.match(html, /Source metadata/);
  assert.match(html, /Properties · 1/);
  assert.match(html, /href="\/Project%20brief\.md" aria-current="page"/);
  assert.match(html, />Current<\/span>/);
  assert.match(html, /<details class="tunelito-navigation-folder">/);
  assert.doesNotMatch(html, /<details class="tunelito-navigation-folder" open/);
  assert.match(html, /href="\/Resources\/" aria-label="Open Resources folder">/);
  assert.match(html, /Café &amp; notes\.md/);
  assert.match(html, /data-tunelito-comment-ignore/);
});

test("renderMarkdownDocument shows directory navigation without an empty properties section", () => {
  const html = renderMarkdownDocument({
    markdownSource: "# No front matter",
    navigation: {
      entries: [{ type: "document", name: "note.md", href: "/note.md", current: true }],
    },
  });

  assert.match(html, /class="tunelito-has-sidebar tunelito-properties-open"/);
  assert.match(html, /Tunelito navigation/);
  assert.doesNotMatch(html, /Source metadata/);
  assert.doesNotMatch(html, /Properties · 0/);
});

test("renderFolderLandingDocument renders a themed, escaped, no-script folder page", () => {
  const html = renderFolderLandingDocument({
    folderName: '<Project "alpha">',
    pagePath: "/Plans/",
    parentHref: "../",
    themeName: "technical",
    entries: [
      { type: "directory", name: "Resources & links", href: "/Plans/Resources%20%26%20links/", extension: "" },
      { type: "document", name: "<script>.md", href: "/Plans/%3Cscript%3E.md", extension: ".md" },
    ],
  });

  assert.match(html, /data-tunelito-theme="technical"/);
  assert.match(html, /Tunelito-generated navigation/);
  assert.match(html, /href="\.\.\/">← Parent folder/);
  assert.match(html, /Resources &amp; links/);
  assert.match(html, /&lt;script&gt;\.md/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-tunelito-comment-surface/);
});

test("Markdown documents and generated folder pages default to BNS Pitaya", () => {
  const documentHtml = renderMarkdownDocument({ markdownSource: "# Default theme" });
  const folderHtml = renderFolderLandingDocument({ folderName: "Default theme" });

  for (const html of [documentHtml, folderHtml]) {
    assert.match(html, /data-tunelito-theme="bns-pitaya"/);
    assert.match(html, /data-tunelito-theme-css="bns-pitaya"/);
  }
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
  const html = renderMarkdownDocument({
    markdownSource: "# Title\n\nParagraph\n\n## Section\n\nMore prose",
    themeName: "default",
  });

  assert.match(html, /aria-label="Document map"/);
  assert.match(html, /data-tunelito-document-map/);
  assert.match(html, /data-tunelito-document-map data-tunelito-comment-ignore/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /--tl-reading-measure: 760px/);
  assert.match(html, /body\.tunelito-comments-open \.tunelito-document-map/);
});

test("renderMarkdownDocument selects each bundled theme and keeps custom CSS last", () => {
  for (const themeName of ["default", "editorial", "technical", "bns-pitaya"]) {
    const html = renderMarkdownDocument({
      markdownSource: "# Themed",
      themeName,
      cssText: ".tunelito-markdown { max-width: 50rem; }",
      cssHref: "/final.css",
    });
    assert.match(html, new RegExp(`data-tunelito-theme="${themeName}"`));
    assert.match(html, new RegExp(`data-tunelito-theme-css="${themeName}"`));
    assert.match(html, /data-tunelito-config-css/);
    assert.ok(html.indexOf("data-tunelito-theme-css") < html.indexOf("data-tunelito-config-css"));
    assert.ok(html.indexOf("data-tunelito-config-css") < html.indexOf('href="/final.css"'));
  }
});

test("renderMarkdownDocument hides HTML comments without rewriting surrounding Markdown or fenced code", () => {
  const html = renderMarkdownDocument({
    markdownSource: [
      "# Visible",
      "",
      "Before <!-- inline author note --> after.",
      "",
      "<!--",
      "multiline author note",
      "-->",
      "",
      "Left<!-- adjacent note -->right.",
      "",
      "`<!-- literal inline code comment -->`",
      "",
      "```html",
      "<!-- literal code comment -->",
      "```",
    ].join("\n"),
  });

  assert.match(html, /<h1>Visible<\/h1>/);
  assert.match(html, /Before\s+after\./);
  assert.match(html, /Leftright\./);
  assert.doesNotMatch(html, /inline author note|multiline author note|adjacent note/);
  assert.match(html, /<code>&lt;!-- literal inline code comment --&gt;<\/code>/);
  assert.match(html, /&lt;!-- literal code comment --&gt;/);
});

test("renderMarkdownDocument rejects unknown themes and prevents CSS from closing its style element", () => {
  assert.throws(
    () => renderMarkdownDocument({ markdownSource: "# Notes", themeName: "neon" }),
    /Unknown theme "neon"/,
  );
  const html = renderMarkdownDocument({
    markdownSource: "# Notes",
    cssText: 'body::after { content: "</style><script>bad()</script>"; }',
  });
  assert.doesNotMatch(html, /<\/style><script>bad/);
  assert.match(html, /<\\\/style><script>bad/);
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
