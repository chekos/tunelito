import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createTunelitoServer } from "../src/server.js";

const repoRoot = resolve(import.meta.dirname, "..");
const fixtureFiles = [
  "examples/markdown/minimal-text.md",
  "examples/markdown/paragraphs-only.md",
  "examples/markdown/single-long-paragraph.md",
  "examples/markdown/heading-ladder.md",
  "examples/markdown/frontmatter-flat.md",
  "examples/markdown/frontmatter-nested.md",
  "examples/markdown/frontmatter-invalid.md",
  "examples/markdown/html-comments.md",
  "examples/markdown/kitchen-sink.md",
  "examples/markdown/ruler-density.md",
  "examples/markdown-vault/index.md",
  "examples/markdown-vault/Project brief.md",
  "examples/markdown-vault/Security notes.md",
  "examples/markdown-vault/Projects/Launch plan.md",
  "examples/markdown-vault/Projects/Plain status.md",
  "examples/markdown-vault/Resources/Reading list.md",
  ...Array.from({ length: 10 }, (_, index) => `examples/markdown-vault/Resources/Reference shelf/Reference ${String(index + 1).padStart(2, "0")}.md`),
];
const inventoryFiles = fixtureFiles.filter((path) => !path.startsWith("examples/markdown-vault/") || path.endsWith("index.md"));

test("Markdown fixture inventory stays complete and documented", () => {
  const publicInventory = readFileSync(resolve(repoRoot, "examples/README.md"), "utf8");
  const agentInventory = readFileSync(resolve(repoRoot, "docs/agents/EXAMPLE_FIXTURES.md"), "utf8");

  for (const fixture of fixtureFiles) assert.equal(existsSync(resolve(repoRoot, fixture)), true, `Missing ${fixture}`);
  for (const fixture of inventoryFiles) {
    assert.match(publicInventory, new RegExp(escapeRegex(fixture.replace("examples/", ""))), `${fixture} missing from examples/README.md`);
    assert.match(agentInventory, new RegExp(escapeRegex(fixture)), `${fixture} missing from EXAMPLE_FIXTURES.md`);
  }

  for (const fixture of ["minimal-text.md", "paragraphs-only.md", "single-long-paragraph.md"]) {
    const source = readFileSync(resolve(repoRoot, "examples/markdown", fixture), "utf8");
    assert.doesNotMatch(source, /^#{1,6}\s/m, `${fixture} intentionally has no heading`);
    assert.match(agentInventory, new RegExp(`${escapeRegex(fixture)}[^\n]*no h1`, "i"), `${fixture} h1 exception must stay documented`);
  }
});

test("committed Markdown fixtures serve through the production renderer without source or runtime artifacts", async () => {
  const beforeArtifacts = runtimeArtifacts();
  assert.deepEqual(beforeArtifacts, [], "examples must start without generated review artifacts");

  for (const fixture of fixtureFiles.filter((path) => path.startsWith("examples/markdown/"))) {
    const filePath = resolve(repoRoot, fixture);
    const source = readFileSync(filePath, "utf8");
    const tempDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-fixture-"));
    const instance = await createTunelitoServer({
      filePath,
      commentsPath: join(tempDir, "comments.md"),
      host: "127.0.0.1",
      port: 0,
      accessKey: "fixture-check",
    });
    try {
      const response = await fetch(instance.localUrl);
      assert.equal(response.status, 200, `${fixture} should serve successfully`);
      const html = await response.text();
      assert.match(html, /data-tunelito-source-type="markdown"/);
      assert.match(html, /data-tunelito-document-map/);
      if (fixture.endsWith("frontmatter-invalid.md")) assert.match(html, /Metadata needs attention/);
      if (fixture.endsWith("html-comments.md")) {
        assert.doesNotMatch(html, /inline author note|This block note is for the author only|adjacent note/);
        assert.match(html, /&lt;!-- Literal comment inside inline code --&gt;/);
        assert.match(html, /&lt;!-- Literal comment inside fenced code --&gt;/);
      }
      assert.equal(readFileSync(filePath, "utf8"), source, `${fixture} source changed while serving`);
    } finally {
      await instance.close();
    }
  }

  const vaultPath = resolve(repoRoot, "examples/markdown-vault");
  const vaultSources = Object.fromEntries(fixtureFiles.filter((path) => path.startsWith("examples/markdown-vault/")).map((fixture) => [fixture, readFileSync(resolve(repoRoot, fixture), "utf8")]));
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-vault-"));
  const vault = await createTunelitoServer({
    filePath: vaultPath,
    commentsPath: join(tempDir, "comments.md"),
    host: "127.0.0.1",
    port: 0,
    accessKey: "fixture-check",
  });
  try {
    for (const pathname of ["/", "/Project%20brief.md", "/Security%20notes.md", "/Projects/Launch%20plan.md", "/Projects/Plain%20status.md", "/Resources/Reference%20shelf/Reference%2010.md"]) {
      const pageUrl = new URL(vault.localUrl);
      pageUrl.pathname = pathname;
      const response = await fetch(pageUrl);
      assert.equal(response.status, 200, `Vault page ${pathname} should serve successfully`);
      assert.match(await response.text(), /data-tunelito-source-type="markdown"/);
    }
  } finally {
    await vault.close();
  }
  for (const [fixture, source] of Object.entries(vaultSources)) assert.equal(readFileSync(resolve(repoRoot, fixture), "utf8"), source);
  assert.deepEqual(runtimeArtifacts(), [], "serving fixtures must not leave comments, sessions, screenshots, or walkthrough exports in examples");
});

function runtimeArtifacts() {
  const examplesRoot = resolve(repoRoot, "examples");
  return readdirSync(examplesRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === ".tunelito" || name.endsWith(".comments.md") || /walkthrough|screenshot/i.test(name));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
