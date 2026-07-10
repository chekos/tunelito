import test from "node:test";
import assert from "node:assert/strict";
import {
  MERMAID_CLIENT_ROUTE,
  MERMAID_LIBRARY_ROUTE,
  renderMarkdownDocument,
} from "../src/markdown.js";

test("renderMarkdownDocument turns Mermaid fences into source-preserving diagram figures", () => {
  const html = renderMarkdownDocument({
    sourceName: "architecture.md",
    markdownSource: [
      "# Architecture",
      "",
      "```MeRmAiD",
      "flowchart LR",
      "  A[Source <script>] --> B[Review]",
      "```",
    ].join("\n"),
  });

  assert.match(html, /data-tunelito-mermaid/);
  assert.match(html, /data-mermaid-state="source"/);
  assert.match(html, /class="language-mermaid"/);
  assert.match(html, /A\[Source &lt;script&gt;\]/);
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
