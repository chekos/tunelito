import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { createTunelitoServer } from "../src/server.js";
import { THEME_DETAILS, THEME_NAMES } from "../src/themes.js";

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
  "examples/markdown/html-comments.md",
  "examples/markdown/heading-ladder.md",
  "examples/markdown/kitchen-sink.md",
];

const browser = await chromium.launch({ headless: true });
try {
  for (const fixture of markerFixtures) await verifyMarkerFixture(fixture);
  for (const fixture of accessibilityFixtures) await verifyAccessibility(fixture);
  await verifyVault();
  await verifyThemesAndComments();
  await verifyResponsiveAndComments();
  process.stdout.write(`Markdown browser checks passed for ${new Set([...markerFixtures, ...accessibilityFixtures]).size} files, ${THEME_NAMES.length} themes, and the folder vault.\n`);
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
      const ruler = page.locator("[data-tunelito-document-map]");
      const rulerWidth = () => ruler.evaluate((node) => getComputedStyle(node).width);
      assert.equal(await page.locator(".tunelito-ruler-toggle").count(), 0, "the hover dial should not expose a redundant pin control");
      assert.equal(await rulerWidth(), "58px", "the resting document map should stay compact");

      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".tunelito-ruler-scrubber").evaluate((node) => node === document.activeElement), true, "Tab should enter the document map through its keyboard slider");
      assert.equal(await rulerWidth(), "300px", "visible keyboard focus should expand the document map");

      const scrubber = page.locator(".tunelito-ruler-scrubber");
      await page.keyboard.press("End");
      assert.equal(await scrubber.getAttribute("aria-valuenow"), String(mapping.blockCount));
      await page.keyboard.press("Home");
      assert.equal(await scrubber.getAttribute("aria-valuenow"), "1");
      await page.keyboard.press("ArrowDown");
      assert.equal(await scrubber.getAttribute("aria-valuenow"), "2");
      assert.match(await scrubber.getAttribute("aria-valuetext"), /^Paragraph 2 of /);
      await page.keyboard.press("Escape");
      assert.equal(await rulerWidth(), "58px", "Escape should dismiss the keyboard-expanded document map");

      await ruler.hover();
      assert.equal(await rulerWidth(), "300px", "hover should expand the document map");
      const h6 = page.locator('.tunelito-ruler-marker[data-block-type="Heading 6"]');
      await h6.click();
      assert.match(await page.evaluate(() => location.hash), /%E6%97%A5%E6%9C%AC%E8%AA%9E|日本語/);
      await page.mouse.move(100, 100);
      assert.equal(await h6.evaluate((node) => node === document.activeElement), false, "pointer navigation should release mouse focus from the ruler");
      assert.equal(await rulerWidth(), "58px", "pointer navigation must retreat when hover leaves");

      await h6.focus();
      assert.equal(await rulerWidth(), "300px", "keyboard focus should keep heading labels available");
      await page.keyboard.press("Escape");
      assert.equal(await rulerWidth(), "58px", "Escape should dismiss heading focus expansion");
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
  const sources = readMarkdownTree(filePath);
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
    assert.equal(await page.locator(".tunelito-navigation").getAttribute("data-tunelito-comment-ignore"), null, "the shared sidebar ignore boundary should own navigation");
    assert.equal(await page.locator("#tunelito-properties").getAttribute("data-tunelito-comment-ignore"), "", "the injected tree must stay outside comment anchoring");
    assert.equal(await page.locator(".tunelito-navigation").getByText("Tunelito navigation").count(), 1, "navigation must identify its injected provenance");
    assert.equal(await page.locator(".tunelito-properties-section").getByText("Source metadata").count(), 1, "properties must remain a separate source-derived section");
    await page.locator("#tunelito-navigation-title").evaluate((title) => {
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".selection").classList.contains("visible")), false, "injected navigation text must not open the comment composer");
    await page.evaluate(() => window.getSelection().removeAllRanges());

    const rootFolders = page.locator(".tunelito-navigation-list > .tunelito-navigation-item > .tunelito-navigation-folder");
    assert.equal(await rootFolders.count(), 2, "the PARA fixture should expose its two root folders");
    assert.equal(await rootFolders.evaluateAll((folders) => folders.every((folder) => !folder.open)), true, "all nested folders should start collapsed");
    assert.equal(await page.locator('.tunelito-navigation-link[href*="Reference%2001"]').isVisible(), false, "ten-note nested folders must not flood the initial sidebar");

    const projects = rootFolders.filter({ hasText: "Projects" });
    const projectsSummary = projects.locator(":scope > .tunelito-navigation-summary");
    await projectsSummary.focus();
    await page.keyboard.press("Enter");
    assert.equal(await projects.evaluate((folder) => folder.open), true, "keyboard activation should expand one folder");
    assert.equal(await projects.locator(":scope > .tunelito-navigation-children > li > .tunelito-navigation-link").count(), 2, "expansion should reveal the folder's immediate documents");
    const resources = rootFolders.filter({ hasText: "Resources" });
    assert.equal(await resources.evaluate((folder) => folder.open), false, "expanding Projects must not expand Resources");

    await resources.locator(":scope > .tunelito-navigation-summary").click();
    const referenceShelf = resources.locator(".tunelito-navigation-folder").filter({ hasText: "Reference shelf" });
    assert.equal(await referenceShelf.evaluate((folder) => folder.open), false, "deeper folders should remain independently collapsed");
    assert.equal(await referenceShelf.locator(".tunelito-navigation-link").count(), 10, "the nested stress folder should include all ten documents");
    assert.equal(await referenceShelf.locator(".tunelito-navigation-link").first().isVisible(), false);
    await referenceShelf.locator(":scope > .tunelito-navigation-summary").click();
    assert.equal(await referenceShelf.locator(".tunelito-navigation-link").first().isVisible(), true);

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertAccessible(page, `markdown vault ${colorScheme} mode`);
      await assertNoOverflow(page, `markdown vault ${colorScheme} mode`);
    }

    await page.goto(new URL("/Projects/Plain%20status.md", instance.localUrl).toString(), { waitUntil: "networkidle" });
    assert.equal(await page.locator('.tunelito-navigation-link[aria-current="page"]').getAttribute("href"), "/Projects/Plain%20status.md");
    assert.equal(await page.locator(".tunelito-properties-section").count(), 0, "a note without front matter must not get an empty Properties section");
    assert.equal(await page.locator(".tunelito-navigation").count(), 1);

    await page.goto(new URL("/Projects/", instance.localUrl).toString(), { waitUntil: "networkidle" });
    assert.equal(await page.locator(".tunelito-folder-parent").getAttribute("href"), "../");
    assert.match(await page.locator(".tunelito-folder-hero").innerText(), /Tunelito-generated navigation/i);
    assert.equal(await page.locator(".tunelito-folder-card").count(), 2);
    await assertAccessible(page, "nested generated folder landing");
    await assertNoOverflow(page, "nested generated folder landing");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await assertAccessible(page, "nested generated folder landing mobile dark");
    await assertNoOverflow(page, "nested generated folder landing mobile dark");

    for (const [name, source] of Object.entries(sources)) assert.equal(readFileSync(resolve(filePath, name), "utf8"), source, `${name} changed while serving the vault`);
  } finally {
    await context.close();
    await instance.close();
  }
}

function readMarkdownTree(root, prefix = "") {
  const sources = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      Object.assign(sources, readMarkdownTree(absolutePath, relativePath));
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      sources[relativePath] = readFileSync(absolutePath, "utf8");
    }
  }
  return sources;
}

async function verifyThemesAndComments() {
  for (const themeName of THEME_NAMES) {
    await withFixture("examples/markdown/kitchen-sink.md", async (page) => {
      assert.equal(await page.locator("html").getAttribute("data-tunelito-theme"), themeName);
      const schemes = THEME_DETAILS[themeName].colorModes;
      for (const colorScheme of schemes) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const presentation = await page.locator(".tunelito-markdown").evaluate((article) => {
          const style = getComputedStyle(article);
          return {
            background: style.backgroundColor,
            color: style.color,
            fontFamily: style.fontFamily,
            lineHeight: style.lineHeight,
            maxWidth: style.maxWidth,
          };
        });
        assert.notEqual(presentation.background, presentation.color, `${themeName} must preserve readable foreground/background separation`);
        assert.ok(presentation.fontFamily.length > 0, `${themeName} must resolve a body font stack`);
        assert.ok(Number.parseFloat(presentation.lineHeight) > 20, `${themeName} must keep a readable line height`);
        assert.notEqual(presentation.maxWidth, "none", `${themeName} must keep a bounded reading measure`);
        await assertAccessible(page, `${themeName} theme ${colorScheme} mode`);
        await assertNoOverflow(page, `${themeName} theme ${colorScheme} mode`);
      }

      await page.locator(".tunelito-markdown p").first().evaluate((paragraph) => {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await page.waitForFunction(() => document.querySelector("#tunelito-root")?.shadowRoot?.querySelector(".selection")?.classList.contains("visible"));
      assert.equal(await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".selection").classList.contains("visible")), true, `${themeName} must preserve comment selection`);
      await page.evaluate(() => window.getSelection().removeAllRanges());
    }, { serverOptions: { markdownTheme: themeName } });
  }

  await withFixture("examples/markdown/html-comments.md", async (page) => {
    const readerText = await page.locator(".tunelito-markdown").innerText();
    assert.doesNotMatch(readerText, /inline author note|This block note is for the author only|adjacent note/);
    assert.match(readerText, /Literal comment inside inline code/);
    assert.match(readerText, /Literal comment inside fenced code/);
    assert.match(readerText, /Beforeafter\./);
  });
}

async function verifyResponsiveAndComments() {
  await withFixture("examples/markdown/frontmatter-flat.md", async (page) => {
    const drawer = page.locator("#tunelito-properties");
    const collapse = page.locator(".tunelito-properties-collapse");
    const tab = page.locator(".tunelito-properties-tab");
    assert.equal(await collapse.getAttribute("aria-expanded"), "true", "desktop metadata should start open");
    assert.equal(await drawer.getAttribute("data-tunelito-comment-ignore"), "", "metadata chrome must stay outside persisted comment anchors");
    assert.equal(await page.locator(".tunelito-markdown").getAttribute("data-tunelito-comment-surface"), "", "Markdown article must own the anchorable comment text");
    await drawer.locator(".tunelito-properties-title").evaluate((title) => {
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".selection").classList.contains("visible")), false, "generated metadata text must not open the comment composer");
    await page.evaluate(() => window.getSelection().removeAllRanges());
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

async function withFixture(relativePath, callback, {
  viewport = { width: 1440, height: 1000 },
  serverOptions = {},
} = {}) {
  const filePath = resolve(repoRoot, relativePath);
  const original = readFileSync(filePath, "utf8");
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-browser-"));
  const instance = await createTunelitoServer({
    filePath,
    commentsPath: join(tempDir, "comments.md"),
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
    ...serverOptions,
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
