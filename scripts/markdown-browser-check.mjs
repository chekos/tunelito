import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { createTunelitoServer } from "../src/server.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const blockSelector = ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p, :scope > blockquote, :scope > pre, :scope > ul, :scope > ol, :scope > table, :scope > figure, :scope > hr";
const markerFixtures = [
  "examples/markdown/minimal-text.md",
  "examples/markdown/paragraphs-only.md",
  "examples/markdown/heading-ladder.md",
  "examples/markdown/single-long-paragraph.md",
  "examples/markdown/kitchen-sink.md",
  "examples/markdown/ruler-density.md",
];
const accessibilityFixtures = [
  "examples/markdown/frontmatter-flat.md",
  "examples/markdown/frontmatter-nested.md",
  "examples/markdown/frontmatter-invalid.md",
  "examples/markdown/heading-ladder.md",
  "examples/markdown/kitchen-sink.md",
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const fixture of markerFixtures) await verifyMarkerFixture(fixture);
  for (const fixture of accessibilityFixtures) await verifyAccessibility(fixture);
  await verifyVault();
  await verifyResponsiveAndComments();
  process.stdout.write(`Markdown browser checks passed in light and dark mode for ${new Set([...markerFixtures, ...accessibilityFixtures]).size} files plus the folder vault.\n`);
} finally {
  await browser.close();
}

async function verifyMarkerFixture(relativePath) {
  await withFixture(relativePath, async (page) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.waitForFunction(() => document.querySelectorAll(".tunelito-ruler-marker").length > 0);
    const mapping = await page.locator(".tunelito-markdown").evaluate((article, selector) => {
      const blocks = Array.from(article.querySelectorAll(selector)).filter((block) => {
        if (block.getAttribute("aria-hidden") === "true") return false;
        if (block.tagName === "HR") return true;
        return Boolean(block.textContent.trim() || block.querySelector("img, svg, video, canvas"));
      });
      const markers = Array.from(document.querySelectorAll(".tunelito-ruler-marker"));
      return {
        blockCount: blocks.length,
        markerCount: markers.length,
        sequential: markers.every((marker, index) => marker.dataset.index === String(index)),
        blockTypes: markers.map((marker) => marker.dataset.blockType),
        headingLevels: blocks.filter((block) => /^H[1-6]$/.test(block.tagName)).map((block) => ({
          tagName: block.tagName,
          id: block.id,
          label: block.textContent.trim(),
          length: markers[blocks.indexOf(block)]?.style.getPropertyValue("--ruler-length"),
        })),
      };
    }, blockSelector);

    assert.equal(mapping.markerCount, mapping.blockCount, `${relativePath} must map one marker to every meaningful block`);
    assert.equal(mapping.sequential, true, `${relativePath} marker indexes must follow DOM order`);

    if (relativePath.endsWith("paragraphs-only.md")) {
      assert.equal(mapping.headingLevels.length, 0);
      const hash = await page.evaluate(() => location.hash);
      await page.locator(".tunelito-ruler-marker").last().click();
      assert.equal(await page.evaluate(() => location.hash), hash, "paragraph navigation must not add a hash");
      const lastCurrent = Number(await page.locator('.tunelito-ruler-marker[data-state="current"]').getAttribute("data-index"));
      assert.equal(lastCurrent, mapping.blockCount - 1);
      assert.ok(await page.locator('.tunelito-ruler-marker[data-state="consumed"]').count() > 0, "later navigation should mark prior blocks consumed");
      await page.locator(".tunelito-ruler-marker").first().click();
      assert.equal(await page.locator('.tunelito-ruler-marker[data-state="current"]').getAttribute("data-index"), "0");
      assert.equal(await page.locator(".tunelito-ruler-marker").last().getAttribute("data-state"), "unread", "navigating upward should restore unread state");
    }
    if (relativePath.endsWith("heading-ladder.md")) {
      assert.deepEqual(mapping.headingLevels.slice(0, 6).map(({ tagName }) => tagName), ["H1", "H3", "H2", "H3", "H4", "H5"]);
      assert.deepEqual(Object.fromEntries(mapping.headingLevels.map(({ tagName, length }) => [tagName, length])), {
        H1: "36px", H2: "29px", H3: "23px", H4: "17px", H5: "14px", H6: "12px",
      });
      assert.equal(new Set(mapping.headingLevels.map(({ id }) => id)).size, mapping.headingLevels.length, "heading ids must be unique");
      const dialGeometry = await page.locator("[data-tunelito-document-map]").evaluate((ruler) => {
        const track = ruler.querySelector(".tunelito-document-map-track");
        const bounds = track.getBoundingClientRect();
        return {
          height: bounds.height,
          centerDelta: Math.abs((bounds.top + bounds.bottom) / 2 - innerHeight / 2),
        };
      });
      assert.equal(Math.round(dialGeometry.height), 500, "desktop document map should use the compact 500px dial height");
      assert.ok(dialGeometry.centerDelta <= 1, "document map dial should be vertically centered");
      const h6 = page.locator('.tunelito-ruler-marker[data-block-type="Heading 6"]');
      await h6.click();
      assert.match(await page.evaluate(() => location.hash), /%E6%97%A5%E6%9C%AC%E8%AA%9E|日本語/);

      const toggle = page.locator(".tunelito-ruler-toggle");
      await toggle.click();
      assert.equal(await page.locator("[data-tunelito-document-map]").getAttribute("data-pinned"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("[data-tunelito-document-map]").getAttribute("data-pinned"), "false");

      const scrubber = page.locator(".tunelito-ruler-scrubber");
      await scrubber.focus();
      await page.keyboard.press("End");
      assert.equal(await scrubber.getAttribute("aria-valuenow"), String(mapping.blockCount));
      await page.keyboard.press("Home");
      assert.equal(await scrubber.getAttribute("aria-valuenow"), "1");
      await page.keyboard.press("ArrowDown");
      assert.equal(await scrubber.getAttribute("aria-valuenow"), "2");
      assert.match(await scrubber.getAttribute("aria-valuetext"), /^Paragraph 2 of /);
    }
    if (relativePath.endsWith("single-long-paragraph.md")) assert.equal(mapping.markerCount, 1);
    if (relativePath.endsWith("minimal-text.md")) assert.equal(mapping.markerCount, 1);
    if (relativePath.endsWith("ruler-density.md")) assert.ok(mapping.markerCount >= 150, "density fixture must expose at least 150 real blocks");
    if (relativePath.endsWith("kitchen-sink.md")) {
      for (const expected of ["List", "Quotation", "Table", "Code block", "Figure", "Divider"]) {
        assert.ok(mapping.blockTypes.includes(expected), `kitchen sink must include ${expected}`);
      }
    }

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertNoOverflow(page, `${relativePath} dark mode`);
  });
}

async function verifyAccessibility(relativePath) {
  await withFixture(relativePath, async (page) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    if (relativePath.endsWith("kitchen-sink.md")) {
      await page.waitForFunction(() => !document.querySelector('[data-tunelito-mermaid][data-mermaid-state="rendering"]'));
    }
    await assertAccessible(page, `${relativePath} light mode`);
    await assertNoOverflow(page, `${relativePath} light mode`);

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertAccessible(page, `${relativePath} dark mode`);
    await assertNoOverflow(page, `${relativePath} dark mode`);
  });
}

async function verifyVault() {
  const filePath = resolve(repoRoot, "examples/markdown-vault");
  const sources = ["index.md", "Project brief.md", "Security notes.md"].map((name) => [name, readFileSync(resolve(filePath, name), "utf8")]);
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-vault-browser-"));
  const instance = await createTunelitoServer({
    filePath,
    commentsPath: join(tempDir, "comments.md"),
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".tunelito-wikilink").count(), 5, "vault should expose every supported wiki reference");
    assert.match(await page.locator(".tunelito-markdown").innerText(), /!\[\[architecture\.png\]\]/, "unsupported embeds must stay literal");
    assert.match(await page.locator("code").first().innerText(), /\[\[Project brief\]\]/, "inline-code wiki syntax must stay literal");

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertAccessible(page, `markdown vault ${colorScheme} mode`);
      await assertNoOverflow(page, `markdown vault ${colorScheme} mode`);
    }

    for (const [name, source] of sources) assert.equal(readFileSync(resolve(filePath, name), "utf8"), source, `${name} changed while serving the vault`);
  } finally {
    await context.close();
    await instance.close();
  }
}

async function verifyResponsiveAndComments() {
  await withFixture("examples/markdown/frontmatter-flat.md", async (page) => {
    const drawer = page.locator("#tunelito-properties");
    const collapse = page.locator(".tunelito-properties-collapse");
    const tab = page.locator(".tunelito-properties-tab");
    assert.equal(await collapse.getAttribute("aria-expanded"), "true", "desktop metadata should start open");
    await collapse.click();
    assert.equal(await drawer.getAttribute("aria-hidden"), "true");
    await tab.click();
    assert.equal(await drawer.getAttribute("aria-hidden"), "false");

    const ruler = page.locator("[data-tunelito-document-map]");
    const markerCount = await page.locator(".tunelito-ruler-marker").count();
    await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".launcher").click());
    await page.waitForFunction(() => document.body.classList.contains("tunelito-comments-open"));
    assert.equal(await ruler.evaluate((node) => getComputedStyle(node).right), "396px", "wide comments panel should shift the ruler left");

    await page.setViewportSize({ width: 1100, height: 900 });
    assert.equal(await ruler.evaluate((node) => getComputedStyle(node).opacity), "0", "narrow desktop comments panel should hide the ruler");
    await windowDispatches(page);
    assert.equal(await page.locator(".tunelito-ruler-marker").count(), markerCount, "layout events must not duplicate markers");
  });

  await withFixture("examples/markdown/frontmatter-flat.md", async (page) => {
    assert.equal(await page.locator("#tunelito-properties").getAttribute("aria-hidden"), "true", "narrow metadata should start collapsed");
    assert.equal(await page.locator("[data-tunelito-document-map]").evaluate((node) => getComputedStyle(node).display), "none", "mobile should hide the desktop ruler");
  }, { viewport: { width: 720, height: 900 } });

  await withFixture("examples/markdown/heading-ladder.md", async (page) => {
    const geometry = await page.locator(".tunelito-document-map-track").evaluate((track) => {
      const bounds = track.getBoundingClientRect();
      return {
        height: bounds.height,
        centerDelta: Math.abs((bounds.top + bounds.bottom) / 2 - innerHeight / 2),
      };
    });
    assert.equal(Math.round(geometry.height), 440, "short desktop viewports should preserve 60px breathing room above and below the dial");
    assert.ok(geometry.centerDelta <= 1, "short-viewport dial should remain vertically centered");
  }, { viewport: { width: 900, height: 560 } });
}

async function windowDispatches(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("tunelito:markdown-layout"));
    window.dispatchEvent(new CustomEvent("tunelito:mermaid-rendered"));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function withFixture(relativePath, callback, { viewport = { width: 1440, height: 1000 } } = {}) {
  const filePath = resolve(repoRoot, relativePath);
  const original = readFileSync(filePath, "utf8");
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-browser-"));
  const instance = await createTunelitoServer({
    filePath,
    commentsPath: join(tempDir, "comments.md"),
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
  });
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    await callback(page);
    assert.equal(readFileSync(filePath, "utf8"), original, `${relativePath} changed while being served`);
    await assertNoOverflow(page, relativePath);
  } finally {
    await context.close();
    await instance.close();
  }
}

async function assertAccessible(page, label) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  assert.deepEqual(results.violations, [], `${label} accessibility violations:\n${formatViolations(results.violations)}`);
}

async function assertNoOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${label} must not overflow horizontally`);
}

function formatViolations(violations) {
  return violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`).join("\n");
}
