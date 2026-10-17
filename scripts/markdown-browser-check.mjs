import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { saveAgentState } from "../src/agent-worker.js";
import { loadCommentsFromMarkdown, renderCommentsMarkdown } from "../src/comments.js";
import { normalizeLinkPreviewRules } from "../src/link-preview.js";
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
  "examples/markdown/footnotes.md",
  "examples/markdown/details-summary.md",
  "examples/markdown/heading-ladder.md",
  "examples/markdown/kitchen-sink.md",
];
const codeCopySql = `SELECT id, name\n  FROM accounts\n WHERE plan = 'pro';  \n-- ${"wide ".repeat(40)}`;
const codeCopyShell = "$ npm run ci\n# trailing prompt-like text stays literal";

const browser = await chromium.launch({ headless: true });
try {
  for (const fixture of markerFixtures) await verifyMarkerFixture(fixture);
  for (const fixture of accessibilityFixtures) await verifyAccessibility(fixture);
  await verifyVault();
  await verifyThemesAndComments();
  await verifyFootnotesAndCommentAnchoring();
  await verifyDetailsAndCollapsedCommentTarget();
  await verifyReviewRoom();
  await verifyLinkTargetsAndTitles();
  await verifyLinkPreviewResolver();
  await verifyResponsiveAndComments();
  await verifyEditableSource();
  await verifyCodeCopy();
  await verifyHtmlPageHasNoCodeCopy();
  process.stdout.write(`Markdown browser checks passed for ${new Set([...markerFixtures, ...accessibilityFixtures]).size} files, ${THEME_NAMES.length} themes, the folder vault, and local source editing.\n`);
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
      assert.equal(await page.locator(".tunelito-fold").first().evaluate((node) => node === document.activeElement), true, "Tab should reach a section fold before the document map");
      const foldCount = await page.locator(".tunelito-fold").count();
      for (let index = 1; index < foldCount; index += 1) await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".tunelito-ruler-scrubber").evaluate((node) => node === document.activeElement), true, "Tab should reach the document map after the section folds");
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

async function verifyDetailsAndCollapsedCommentTarget() {
  await withFixture("examples/markdown/details-summary.md", async (page) => {
    const disclosures = page.locator(".tunelito-markdown details");
    assert.equal(await disclosures.count(), 3, "block and inline details elements should render natively");
    assert.equal(await disclosures.nth(0).evaluate((details) => details.open), false, "the first disclosure should start collapsed");
    assert.equal(await disclosures.nth(1).evaluate((details) => details.open), true, "the safe open attribute should survive");
    assert.equal(await disclosures.nth(2).evaluate((details) => details.open), true, "inline details should use the same allowlist");
    assert.deepEqual(
      await disclosures.evaluateAll((elements) => elements.map((element) => element.getAttributeNames())),
      [[], ["open"], ["open"]],
      "details should strip every attribute except normalized open",
    );
    assert.equal(
      await page.locator(".tunelito-markdown summary").evaluateAll((elements) => elements.every((element) => element.getAttributeNames().length === 0)),
      true,
      "summary should strip every attribute",
    );
    assert.equal(await page.locator(".tunelito-markdown script, .tunelito-markdown iframe, .tunelito-markdown img").count(), 0, "hostile nested HTML must stay escaped");
    assert.doesNotMatch(await page.locator(".tunelito-markdown").innerText(), /This private note must stay hidden/);
    assert.match(
      await page.locator(".tunelito-markdown code").filter({ hasText: "Inline code stays literal" }).innerText(),
      /onclick="literal\(\)"/,
      "inline code should preserve literal details syntax",
    );
    assert.match(
      await page.locator(".tunelito-markdown pre code").filter({ hasText: "Fenced code stays literal" }).innerText(),
      /onclick="literal\(\)"/,
      "fenced code should preserve literal details syntax",
    );

    await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".launcher").click());
    await page.waitForFunction(() => document.body.classList.contains("tunelito-comments-open"));
    await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".comment").click());
    assert.equal(await disclosures.nth(0).evaluate((details) => details.open), true, "targeting a comment should reveal its collapsed details ancestors");
    assert.equal(
      await page.locator(".tunelito-markdown p").filter({ hasText: "Targeted review note inside a collapsed section." }).isVisible(),
      true,
    );
  }, {
    comments: [{
      id: "c_details_target",
      author: "Browser check",
      authorRole: "owner",
      reviewerId: "r_browser_check",
      scope: "page",
      quote: "Targeted review note inside a collapsed section.",
      body: "Reveal this anchored note.",
      prefix: "",
      suffix: "",
      path: "body > main > details > p",
      pagePath: "/",
      textStart: null,
      textEnd: null,
      created: "2026-07-24T00:00:00.000Z",
    }],
  });
}

async function verifyFootnotesAndCommentAnchoring() {
  await withFixture("examples/markdown/footnotes.md", async (page) => {
    assert.equal(await page.locator("[data-footnote-ref]").count(), 4, "every defined reference should render as a footnote link");
    assert.equal(await page.locator("[data-footnotes] > ol > li").count(), 3, "referenced definitions should render once at the end");
    assert.equal(await page.locator("[data-footnote-backref]").count(), 4, "every reference should receive a matching back-link");
    assert.match(await page.locator(".tunelito-markdown").innerText(), /\[\^not-defined\]/, "undefined references must stay literal");
    assert.match(await page.locator("code").filter({ hasText: "do not render" }).innerText(), /\[\^overview\]/, "inline-code references must stay literal");
    assert.equal(await page.locator(".tunelito-markdown script").count(), 0, "footnote definitions must preserve raw-HTML escaping");

    const firstReference = page.locator("[data-footnote-ref]").first();
    assert.equal(await firstReference.getAttribute("href"), "#footnote-overview");
    await firstReference.click();
    assert.equal(await page.evaluate(() => location.hash), "#footnote-overview", "reference links should navigate to definitions");
    await page.locator("#footnote-overview [data-footnote-backref]").click();
    assert.equal(await page.evaluate(() => location.hash), "#footnote-ref-overview", "definition links should navigate back to references");

    await page.waitForFunction(() => {
      const highlights = CSS.highlights?.get("tunelito-comments");
      return highlights && Array.from(highlights).some((range) => range.toString() === "The procurement decision remains pending after the table.");
    });
    assert.deepEqual(
      await page.evaluate(() => Array.from(CSS.highlights.get("tunelito-comments") || []).map((range) => range.toString())),
      ["The procurement decision remains pending after the table."],
      "a persisted comment should reattach by quote when footnote rendering invalidates legacy offsets",
    );

    await page.locator("#footnote-overview p").evaluate((paragraph) => {
      const text = Array.from(paragraph.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes("definition text"));
      const start = text.textContent.indexOf("definition text");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "definition text".length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForFunction(() => document.querySelector("#tunelito-root")?.shadowRoot?.querySelector(".selection")?.classList.contains("visible"));
    assert.equal(
      await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".selection").classList.contains("visible")),
      true,
      "footnote definition text should remain selectable and commentable",
    );
    await page.evaluate(() => window.getSelection().removeAllRanges());
  }, {
    comments: [{
      id: "c_footnote_reattach",
      author: "Browser check",
      authorRole: "owner",
      reviewerId: "r_browser_check",
      scope: "page",
      quote: "The procurement decision remains pending after the table.",
      body: "This persisted comment should survive the renderer upgrade.",
      prefix: "Legacy literal marker [^42-1] before ",
      suffix: " and stale context",
      path: "body > main > table > tbody > tr > td",
      pagePath: "/",
      textStart: 0,
      textEnd: 57,
      created: "2026-07-30T00:00:00.000Z",
    }],
  });
}

async function verifyEditableSource() {
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-editable-browser-"));
  const filePath = join(tempDir, "editable.md");
  const commentsPath = join(tempDir, "editable.comments.md");
  writeFileSync(filePath, "# Editable note\n\nOriginal anchored phrase.\n", "utf8");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: filePath,
    comments: [{
      id: "c_editable_stale",
      author: "Browser check",
      authorRole: "owner",
      reviewerId: "r_browser_check",
      scope: "page",
      quote: "Original anchored phrase.",
      body: "This comment should remain readable after the source changes.",
      prefix: "",
      suffix: "",
      path: "body > main > p",
      pagePath: "/",
      textStart: null,
      textEnd: null,
      created: "2026-07-31T00:00:00.000Z",
    }],
  }), "utf8");
  const instance = await createTunelitoServer({
    filePath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
    editable: true,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    const trigger = page.locator(".tunelito-source-edit-trigger");
    assert.equal(await trigger.isVisible(), true, "the direct local owner should see Edit source");
    await trigger.click();
    const editor = page.locator(".tunelito-source-editor");
    const textarea = editor.locator("textarea");
    await textarea.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const source = document.querySelector(".tunelito-source-editor textarea");
      return source && !source.disabled && source.value === "# Editable note\n\nOriginal anchored phrase.\n";
    });
    assert.equal(await textarea.inputValue(), "# Editable note\n\nOriginal anchored phrase.\n");
    assert.equal(await editor.getAttribute("data-tunelito-comment-ignore"), "", "editor UI must stay outside comment anchoring");
    await assertAccessible(page, "editable Markdown editor");

    const draft = "# Browser draft\n\nUnsaved browser wording.\n";
    await textarea.fill(draft);
    assert.equal(await page.locator("html").getAttribute("data-tunelito-source-dirty"), "", "editing should mark the browser draft dirty");
    await page.keyboard.press("Escape");
    assert.equal(await editor.isVisible(), true, "Escape must not discard a dirty draft");
    assert.equal(await editor.locator('[data-action="discard"]').isVisible(), true, "dirty close should require an explicit discard action");

    writeFileSync(filePath, "# External edit\n\nChanged outside the browser.\n", "utf8");
    await page.waitForFunction(() => document.querySelector(".tunelito-source-editor-status")?.textContent.includes("changed on disk"));
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(await textarea.inputValue(), draft, "an external change must preserve the dirty browser buffer");
    assert.equal(await editor.isVisible(), true, "an external change must not reload over the dirty editor");

    await editor.locator('[data-action="reload"]').click();
    await page.waitForFunction(() => document.querySelector(".tunelito-markdown")?.textContent.includes("Changed outside the browser"));
    await trigger.click();
    await textarea.waitFor({ state: "visible" });
    await textarea.fill("# Final browser edit\n\nSaved from Tunelito.\n");
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page, "editable Markdown editor mobile dark mode");
    await assertAccessible(page, "editable Markdown editor mobile dark mode");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await page.waitForFunction(() => document.querySelector(".tunelito-markdown")?.textContent.includes("Saved from Tunelito"));
    assert.equal(readFileSync(filePath, "utf8"), "# Final browser edit\n\nSaved from Tunelito.\n");

    await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".launcher").click());
    await page.waitForFunction(() => document.querySelector("#tunelito-root")?.shadowRoot?.querySelector(".anchor-status.visible"));
    assert.equal(
      await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".anchor-status.visible").textContent),
      "Selection no longer found in this version",
      "comments whose quote was edited away should remain visible with a stale-anchor label",
    );
  } finally {
    await context.close();
    await instance.close();
  }
}

function codeCopySource() {
  return [
    "# Run of show",
    "",
    "## Query",
    "",
    "Paste this into Snowsight.",
    "",
    "```sql",
    codeCopySql,
    "```",
    "",
    "## Steps",
    "",
    "1. Run the gate:",
    "",
    "   ```bash",
    ...codeCopyShell.split("\n").map((line) => `   ${line}`),
    "   ```",
    "",
    "```mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
    "",
  ].join("\n");
}

async function verifyCodeCopy() {
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-code-copy-"));
  const filePath = join(tempDir, "run-of-show.md");
  const source = codeCopySource();
  writeFileSync(filePath, source, "utf8");
  const commentsPath = join(tempDir, "run-of-show.comments.md");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: filePath,
    comments: [{
      id: "c_code_persisted",
      author: "Browser check",
      authorRole: "owner",
      reviewerId: "r_browser_check",
      scope: "page",
      quote: "FROM accounts",
      body: "A persisted comment inside a code block.",
      anchorId: "query",
      sectionId: "query",
      prefix: "SELECT id, name\n  ",
      suffix: "\n WHERE plan",
      path: "body > main > pre > code",
      pagePath: "/",
      textStart: null,
      textEnd: null,
      created: "2026-10-17T00:00:00.000Z",
    }],
  }), "utf8");
  const instance = await createTunelitoServer({
    filePath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(instance.localUrl).origin });
  const page = await context.newPage();
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".tunelito-code-copy").length > 0);

    const buttons = page.locator(".tunelito-markdown .tunelito-code-copy");
    assert.equal(await buttons.count(), 2, "every fenced code block except the Mermaid diagram gets a copy button");
    assert.equal(await page.locator("[data-tunelito-mermaid] .tunelito-code-copy").count(), 0, "Mermaid diagrams must not get a copy button");
    assert.equal(await page.getByRole("button", { name: "Copy sql code" }).count(), 1, "the button names the code language");
    assert.equal(await page.getByRole("button", { name: "Copy bash code" }).count(), 1, "nested list code blocks are enhanced too");
    const buttonShape = await buttons.first().evaluate((button) => ({
      tagName: button.tagName,
      type: button.type,
      tabIndex: button.tabIndex,
      ignored: button.hasAttribute("data-tunelito-comment-ignore"),
      textNodes: Array.from(button.querySelectorAll("*")).concat(button).some((node) => Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim())),
      opacity: getComputedStyle(button).opacity,
    }));
    assert.deepEqual(buttonShape, { tagName: "BUTTON", type: "button", tabIndex: 0, ignored: true, textNodes: false, opacity: "0" }, "the copy button is a hidden-until-hover native button with no anchorable text");

    const sqlPre = page.locator(".tunelito-markdown > pre").first();
    assert.equal(
      await sqlPre.evaluate((pre) => pre.textContent.replace(/\n$/, "")),
      codeCopySql,
      "the button must not add text to the code block that comments anchor against",
    );
    await sqlPre.hover();
    assert.equal(await buttons.first().evaluate((button) => getComputedStyle(button).opacity), "1", "hovering a code block reveals its copy button");
    const scrolledGeometry = await sqlPre.evaluate((pre) => {
      const code = pre.querySelector("code");
      code.scrollLeft = code.scrollWidth;
      const button = pre.querySelector(".tunelito-code-copy").getBoundingClientRect();
      const box = pre.getBoundingClientRect();
      const text = Array.from(code.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).at(-1);
      const end = text.textContent.replace(/\n$/, "").length;
      const lastCharacter = document.createRange();
      lastCharacter.setStart(text, end - 1);
      lastCharacter.setEnd(text, end);
      return {
        scrolls: code.scrollLeft > 0,
        pinned: button.right <= box.right && button.left >= box.left,
        lineEndClear: lastCharacter.getBoundingClientRect().right <= button.left,
      };
    });
    assert.deepEqual(scrolledGeometry, { scrolls: true, pinned: true, lineEndClear: true }, "wide code scrolls inside the block, the copy button stays pinned, and the line end scrolls clear of it");
    await sqlPre.evaluate((pre) => { pre.querySelector("code").scrollLeft = 0; });

    await page.waitForFunction(() => {
      const highlights = CSS.highlights?.get("tunelito-comments");
      return highlights && Array.from(highlights).some((range) => range.toString() === "FROM accounts");
    });

    await page.getByRole("button", { name: "Copy sql code" }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), codeCopySql, "copy writes the raw code exactly");
    await page.waitForFunction(() => document.querySelector(".tunelito-code-copy-status")?.textContent === "Copied code to clipboard");
    assert.equal(await page.locator(".tunelito-code-copy-status").getAttribute("aria-live"), "polite");
    assert.equal(await buttons.first().getAttribute("data-state"), "copied");

    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      document.activeElement?.blur();
      document.querySelector(".tunelito-markdown ol p").setAttribute("tabindex", "-1");
      document.querySelector(".tunelito-markdown ol p").focus();
    });
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Copy bash code", "the copy button is reachable by keyboard");
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).opacity), "1", "keyboard focus reveals the copy button");
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
    });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".tunelito-code-copy-status")?.textContent);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Copy bash code", "the fallback copy keeps focus on the button");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), codeCopyShell, "the fallback copy path keeps prompts and indentation literal");

    await page.waitForFunction(() => document.querySelector("#tunelito-root")?.shadowRoot?.querySelector(".status")?.textContent.startsWith("Connected"));
    await sqlPre.evaluate((pre) => {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const commentButton = page.getByRole("button", { name: "Comment", exact: true });
    await commentButton.waitFor({ state: "visible" });
    await commentButton.click();
    const dialog = page.getByRole("dialog", { name: "Add comment" });
    await dialog.getByRole("textbox").fill("Anchored on the whole code block.");
    await dialog.getByRole("button", { name: "Add comment" }).click();
    let saved;
    const deadline = Date.now() + 5000;
    while (!saved && Date.now() < deadline) {
      saved = loadCommentsFromMarkdown(commentsPath).find((comment) => comment.body === "Anchored on the whole code block.");
      if (!saved) await page.waitForTimeout(50);
    }
    assert.ok(saved, "a comment on a code block selection must persist");
    assert.equal(saved.quote.replace(/\n$/, ""), codeCopySql, "the selected quote must exclude the copy button");
    assert.equal(saved.sectionId, "query", "the code block comment keeps its section mapping");
    await page.waitForFunction(() => Array.from(CSS.highlights.get("tunelito-comments") || []).some((range) => range.toString().startsWith("SELECT id, name")));
    await assertAccessible(page, "code copy buttons");
    await assertNoOverflow(page, "code copy buttons");
    assert.equal(readFileSync(filePath, "utf8"), source, "copy buttons must not change the Markdown source");
  } finally {
    await context.close();
    await instance.close();
  }
}

async function verifyHtmlPageHasNoCodeCopy() {
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-html-code-"));
  const filePath = join(tempDir, "page.html");
  const source = "<!doctype html><html lang=\"en\"><head><title>HTML code</title></head><body><main><h1>HTML code</h1><pre><code>echo user-authored</code></pre></main></body></html>\n";
  writeFileSync(filePath, source, "utf8");
  const instance = await createTunelitoServer({
    filePath,
    commentsPath: join(tempDir, "page.comments.md"),
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    await page.locator("#tunelito-root").waitFor({ state: "attached" });
    assert.equal(await page.locator(".tunelito-code-copy").count(), 0, "user-authored HTML pages must not get code copy buttons");
    assert.equal(await page.locator("pre").evaluate((pre) => pre.outerHTML), "<pre><code>echo user-authored</code></pre>");
    assert.equal(readFileSync(filePath, "utf8"), source);
  } finally {
    await context.close();
    await instance.close();
  }
}

async function windowDispatches(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("tunelito:markdown-layout"));
    window.dispatchEvent(new CustomEvent("tunelito:mermaid-rendered"));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function verifyReviewRoom() {
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-review-room-"));
  const filePath = join(tempDir, "notes.md");
  const source = reviewRoomSource();
  writeFileSync(filePath, source);
  const commentsPath = join(tempDir, "notes.comments.md");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: filePath,
    comments: [{
      id: "c_open",
      author: "Browser check",
      authorRole: "owner",
      scope: "page",
      quote: "The launch copy stays here.",
      body: "Please keep the launch copy.",
      anchorId: "tll-563",
      sectionId: "tll-563",
      prefix: "",
      suffix: "",
      path: "",
      pagePath: "/",
      textStart: null,
      textEnd: null,
      created: "2026-09-30T00:00:00.000Z",
    }, {
      id: "c_resolved",
      author: "Browser check",
      authorRole: "owner",
      scope: "page",
      quote: "This sentence was deleted.",
      body: "The old launch line is gone.",
      anchorId: "tll-563",
      sectionId: "tll-563",
      prefix: "",
      suffix: "",
      path: "",
      pagePath: "/",
      textStart: null,
      textEnd: null,
      created: "2026-09-30T00:01:00.000Z",
    }],
  }));
  const agentStatePath = join(tempDir, "agent-state.json");
  saveAgentState(agentStatePath, {
    comments: {
      c_resolved: { status: "resolved", summary: "Updated the launch line." },
      c_open: { status: "pending", summary: "" },
    },
  });
  const instance = await createTunelitoServer({
    filePath,
    commentsPath,
    agentStatePath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
    sectionIndex: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".tunelito-ruler-marker").length > 0);
    assert.equal(await page.locator(".tunelito-badge[data-tone='pending']").innerText(), "todo");
    assert.equal(await page.locator(".tunelito-badge[data-tone='warning']").innerText(), "high");
    assert.match(await page.locator(".tunelito-markdown").innerText(), /\{nope\}/);
    assert.equal(await page.locator("#tll-563").count(), 1);
    await page.locator("a", { hasText: "Tracker" }).hover();
    await page.waitForFunction(() => {
      const card = document.querySelector(".tunelito-link-card");
      return card && !card.hidden && card.textContent.includes("high");
    });
    assert.equal(await page.locator(".tunelito-section-index a").first().getAttribute("href"), "#tll-563");

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => {
      const current = document.querySelector('.tunelito-ruler-marker[data-state="current"]');
      const markers = document.querySelectorAll(".tunelito-ruler-marker");
      return current?.dataset.index === String(markers.length - 1);
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('.tunelito-ruler-marker[data-state="current"]')?.dataset.index === "0");
    assert.equal(await page.locator('.tunelito-section-index a[aria-current="location"]').getAttribute("href"), "#tll-563");

    await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".launcher").click());
    await page.waitForFunction(() => !document.querySelector("#tunelito-root")?.shadowRoot?.querySelector(".resolved-toggle")?.hidden);
    assert.equal(await page.locator("#tll-563").getAttribute("data-tunelito-open-comments"), "1");
    assert.equal(await page.locator("#tll-563").getAttribute("data-tunelito-resolved-comments"), "1");
    assert.equal(
      await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.textContent.includes("Updated the launch line.")),
      false,
    );
    await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.querySelector(".resolved-toggle").click());
    await page.waitForFunction(() => document.querySelector("#tunelito-root")?.shadowRoot?.textContent.includes("Updated the launch line."));
    assert.equal(
      await page.locator("#tunelito-root").evaluate((host) => host.shadowRoot.textContent.includes("Selection no longer found")),
      false,
    );
    const highlights = await page.evaluate(() => Array.from(CSS.highlights.get("tunelito-comments") || []).map((range) => range.toString()));
    assert.ok(highlights.includes("The launch copy stays here."), `the live quote stays highlighted, saw ${JSON.stringify(highlights)}`);
    assert.ok(highlights.includes("Launch"), "a missing quote stays on its heading when that heading still exists");
    assert.equal(highlights.some((text) => text.includes("This sentence was deleted.")), false, "a repeated quote outside the anchor must not steal the comment");

    await page.locator("#section-1 .tunelito-fold").click();
    await page.locator("#section-2 .tunelito-fold").click();
    await page.locator('.tunelito-section-index a[href="#section-2-child"]').click();
    assert.equal(await page.locator("#section-1 + p").isHidden(), true, "opening one subsection must leave earlier folded sections folded");
    assert.equal(await page.locator("#section-2-child").isHidden(), false);

    const launchCopy = page.locator(".tunelito-markdown p", { hasText: "The launch copy stays here." });
    await page.locator("#tll-563 .tunelito-fold").click();
    assert.equal(await launchCopy.isHidden(), true);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#tll-563 .tunelito-fold"));
    assert.equal(await page.locator(".tunelito-markdown p", { hasText: "The launch copy stays here." }).isHidden(), true);
    assert.equal(readFileSync(filePath, "utf8"), source);
  } finally {
    await context.close();
    await instance.close();
  }
}

async function verifyLinkTargetsAndTitles() {
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-links-browser-"));
  const siteDir = join(tempDir, "site");
  mkdirSync(join(siteDir, "notes"), { recursive: true });
  writeFileSync(join(siteDir, "workflow-final.md"), "# Workflow final\n\nRelative target.\n");
  writeFileSync(join(siteDir, "notes", "next.md"), "# Next\n\nRoot-relative target.\n");
  const indexPath = join(siteDir, "index.md");
  writeFileSync(indexPath, "# Links\n");
  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath: join(tempDir, "site.comments.md"),
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
  });
  const origin = new URL(instance.localUrl).origin;
  const source = [
    "# Links",
    "",
    "Read the [external report](https://example.com/report.pdf) before the call.",
    "",
    '[TLL-1](https://tracker.example/TLL/issues/TLL-1 "Fix login redirect · todo · medium")',
    "",
    `[Same origin](${origin}/notes/next.md) [Relative](workflow-final.md) [Root relative](/notes/next.md) [Fragment](#verification) [Protocol relative](//example.org/brief) [Mail](mailto:team@example.com)`,
    "",
    "Footnote reference.[^1]",
    "",
    "## Verification",
    "",
    "Checked.",
    "",
    "[^1]: Footnote body.",
    "",
  ].join("\n");
  writeFileSync(indexPath, source);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.route(/^https:\/\/(example\.com|example\.org|tracker\.example)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>External</title>" }));
  const page = await context.newPage();
  const link = (name) => page.locator(".tunelito-markdown").getByRole("link", { name, exact: true });
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.tunelitoMarkdownUi === "ready");
    const reviewUrl = page.url();

    for (const name of ["external report", "TLL-1", "Protocol relative"]) {
      assert.equal(await link(name).getAttribute("target"), "_blank", `${name} must open in a new tab`);
      assert.equal(await link(name).getAttribute("rel"), "noopener noreferrer", `${name} must carry noopener protection`);
    }
    for (const name of ["Same origin", "Relative", "Root relative", "Fragment", "Mail"]) {
      assert.equal(await link(name).getAttribute("target"), null, `${name} must stay in the current tab`);
      assert.equal(await link(name).getAttribute("rel"), null, `${name} must keep its plain anchor`);
    }
    assert.equal(await page.locator("[data-footnote-ref], [data-footnote-backref]").evaluateAll((links) => links.every((anchor) => !anchor.hasAttribute("target"))), true, "footnote links must stay in the current tab");
    assert.equal(await page.locator(".tunelito-navigation a[target]").count(), 0, "folder navigation must stay in the current tab");

    const [popup] = await Promise.all([context.waitForEvent("page"), link("external report").click()]);
    await popup.waitForLoadState();
    assert.equal(popup.url(), "https://example.com/report.pdf");
    assert.equal(await popup.evaluate(() => window.opener), null, "the external tab must not keep an opener");
    assert.equal(page.url(), reviewUrl, "the review room must stay open in its original tab");
    await popup.close();

    const [modifierTab] = await Promise.all([context.waitForEvent("page"), link("Relative").click({ modifiers: ["ControlOrMeta"] })]);
    await modifierTab.close();
    const [middleTab] = await Promise.all([context.waitForEvent("page"), link("Root relative").click({ button: "middle" })]);
    await middleTab.close();
    assert.equal(page.url(), reviewUrl, "modifier and middle clicks must stay with the browser");

    await link("Fragment").click();
    assert.equal(new URL(page.url()).hash, "#verification");
    await page.locator("[data-footnote-ref]").click();
    assert.equal(new URL(page.url()).hash, "#footnote-1");
    await page.locator("[data-footnote-backref]").click();
    assert.equal(new URL(page.url()).hash, "#footnote-ref-1");

    const tracker = link("TLL-1");
    assert.equal(await tracker.getAttribute("title"), "Fix login redirect · todo · medium");
    await tracker.hover();
    await page.waitForFunction(() => !document.querySelector(".tunelito-link-card")?.hidden);
    assert.equal(await tracker.getAttribute("title"), "Fix login redirect · todo · medium", "hover UI must leave the native title tooltip in place");
    assert.equal(await tracker.evaluate((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return anchor.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }), true, "injected UI must not cover a titled link");

    await link("external report").evaluate((anchor) => {
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForFunction(() => document.querySelector("#tunelito-root")?.shadowRoot?.querySelector(".selection")?.classList.contains("visible"));
    await page.evaluate(() => window.getSelection().removeAllRanges());

    await link("Same origin").click();
    await page.waitForURL(/\/notes\/next\.md/);
    await page.goBack({ waitUntil: "networkidle" });
    await link("Relative").click();
    await page.waitForURL(/\/workflow-final\.md/);
    await page.goBack({ waitUntil: "networkidle" });
    await link("Root relative").click();
    await page.waitForURL(/\/notes\/next\.md/);
    assert.equal(context.pages().length, 1, "same-origin links must not open new tabs");
    assert.equal(readFileSync(indexPath, "utf8"), source);
  } finally {
    await context.close();
    await instance.close();
  }
}

// #135: resolver-backed hover cards. A local fake resolver stands in for the tracker; the
// browser must only ever call Tunelito's same-origin route, never the resolver origin.
async function verifyLinkPreviewResolver() {
  const resolverHits = [];
  const resolver = createHttpServer((req, res) => {
    resolverHits.push(req.url);
    const id = decodeURIComponent(req.url.split("/").pop());
    const payload = id === "TLL-666"
      ? { title: '<img src=x onerror="window.__tunelitoXss=1">Escaped', state: { name: "blocked" } }
      : { title: `Resolved ${id}`, state: { name: "todo" }, priority: { label: "high" } };
    const body = JSON.stringify(payload);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolveListen) => resolver.listen(0, "127.0.0.1", resolveListen));
  const resolverOrigin = `http://127.0.0.1:${resolver.address().port}`;
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-link-preview-browser-"));
  const notePath = join(tempDir, "briefing.md");
  const issue = (id) => `${resolverOrigin}/TLL/issues/${id}`;
  writeFileSync(notePath, [
    "# Briefing",
    "",
    `Bare [TLL-563](${issue("TLL-563")}) and [TLL-666](${issue("TLL-666")}).`,
    "",
    `Authored [TLL-700](${issue("TLL-700")} "Authored title · done · low") and [plain](https://example.com/x).`,
    "",
  ].join("\n"));
  const rules = normalizeLinkPreviewRules([{
    match: `^${resolverOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?<team>[A-Z]+)/issues/(?<id>[A-Z]+-\\d+)$`,
    resolver: `${resolverOrigin}/api/{team}/{id}`,
    fields: { title: "title", status: "state.name", priority: "priority.label" },
  }]);
  const instance = await createTunelitoServer({
    filePath: notePath,
    commentsPath: join(tempDir, "briefing.comments.md"),
    host: "127.0.0.1",
    port: 0,
    accessKey: "browser-check",
    linkPreviewRules: rules,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const browserRequests = [];
  context.on("request", (request) => browserRequests.push(request.url()));
  const page = await context.newPage();
  const link = (name) => page.locator(".tunelito-markdown").getByRole("link", { name, exact: true });
  const cardText = () => page.locator(".tunelito-link-card").evaluate((card) => (card.hidden ? "" : card.innerText.replace(/\s+/g, " ").trim()));
  try {
    await page.goto(instance.localUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.tunelitoMarkdownUi === "ready");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.tunelitoLinkPreviews), "on");

    await link("TLL-563").hover();
    await page.waitForFunction(() => /Resolved TLL-563/.test(document.querySelector(".tunelito-link-card:not([hidden])")?.textContent || ""));
    assert.equal(await cardText(), "Resolved TLL-563 todo · high");
    assert.equal(await link("TLL-563").getAttribute("title"), null, "resolved previews must not inject a title attribute");

    await page.mouse.move(5, 5);
    await page.waitForFunction(() => document.querySelector(".tunelito-link-card")?.hidden);
    await link("TLL-666").focus();
    await page.waitForFunction(() => /Escaped/.test(document.querySelector(".tunelito-link-card:not([hidden])")?.textContent || ""));
    assert.equal(await page.locator(".tunelito-link-card img").count(), 0, "resolver fields must render as text");
    assert.equal(await page.evaluate(() => window.__tunelitoXss), undefined);
    assert.match(await cardText(), /^<img src=x onerror="window.__tunelitoXss=1">Escaped blocked$/);
    await link("TLL-666").blur();

    await link("TLL-700").hover();
    await page.waitForFunction(() => /Authored title/.test(document.querySelector(".tunelito-link-card:not([hidden])")?.textContent || ""));
    assert.equal(await cardText(), "Authored title done · low", "an authored title keeps priority over the resolver");
    await link("plain").hover();
    await page.waitForTimeout(150);
    await link("TLL-563").hover();
    await page.waitForFunction(() => /Resolved TLL-563/.test(document.querySelector(".tunelito-link-card:not([hidden])")?.textContent || ""));

    assert.deepEqual([...new Set(resolverHits)].sort(), ["/api/TLL/TLL-563", "/api/TLL/TLL-666"], "only bare matching links reach the resolver, once each");
    assert.equal(resolverHits.length, 2, "repeat hovers are served from cache");
    assert.equal(browserRequests.some((url) => url.startsWith(resolverOrigin)), false, "the browser must never fetch the resolver origin");
    assert.equal(browserRequests.filter((url) => url.includes("/__tunelito/link-preview")).length, 3, "the browser asks Tunelito once per distinct bare link");

    const visitor = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.10" } });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(instance.localUrl, { waitUntil: "networkidle" });
    assert.equal(await visitorPage.evaluate(() => document.documentElement.dataset.tunelitoLinkPreviews), undefined, "tunnel visitors get no resolver previews by default");
    await visitor.close();
  } finally {
    await context.close();
    await instance.close();
    await new Promise((resolveClose) => resolver.close(resolveClose));
  }
}

function reviewRoomSource() {
  const head = [
    "## Launch {#tll-563}",
    "",
    "The launch copy stays here.",
    "",
    "Ship {todo} {high} {nope}.",
    "",
    '[Tracker](https://example.com/issues/1 "Open · high")',
    "",
  ];
  const middle = Array.from({ length: 12 }, (_, index) => {
    const child = index === 1 ? "\n### Child {#section-2-child}\n\nNested.\n" : "";
    return `## Section ${index + 1}\n\n${"Review paragraph. ".repeat(36)}\n${child}`;
  });
  const tail = Array.from({ length: 4 }, (_, index) => {
    const body = index === 0 ? "This sentence was deleted." : "Short.";
    return `## Tail ${index + 1}\n\n${body}\n`;
  });
  return [...head, ...middle, ...tail].join("\n");
}

async function withFixture(relativePath, callback, {
  viewport = { width: 1440, height: 1000 },
  serverOptions = {},
  comments = [],
} = {}) {
  const filePath = resolve(repoRoot, relativePath);
  const original = readFileSync(filePath, "utf8");
  const tempDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-browser-"));
  const commentsPath = join(tempDir, "comments.md");
  if (comments.length) writeFileSync(commentsPath, renderCommentsMarkdown({ comments, sourcePath: filePath }), "utf8");
  const instance = await createTunelitoServer({
    filePath,
    commentsPath,
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
