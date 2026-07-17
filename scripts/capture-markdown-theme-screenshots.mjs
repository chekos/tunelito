#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createTunelitoServer } from "../src/server.js";
import { THEME_DETAILS, THEME_NAMES } from "../src/themes.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "examples/markdown/kitchen-sink.md");
const original = readFileSync(fixturePath, "utf8");
const outputDir = resolve(process.argv[2] || process.env.TUNELITO_SCREENSHOT_DIR || join(tmpdir(), "tunelito-markdown-themes"));
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const themeName of THEME_NAMES) {
    const tempDir = mkdtempSync(join(tmpdir(), `tunelito-theme-${themeName}-`));
    const instance = await createTunelitoServer({
      filePath: fixturePath,
      commentsPath: join(tempDir, "comments.md"),
      host: "127.0.0.1",
      port: 0,
      accessKey: "theme-screenshot",
      markdownTheme: themeName,
    });
    try {
      for (const colorMode of THEME_DETAILS[themeName].colorModes) {
        const context = await browser.newContext({
          colorScheme: colorMode,
          reducedMotion: "reduce",
          viewport: { width: 1440, height: 1000 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        try {
          await page.goto(instance.localUrl, { waitUntil: "networkidle" });
          await page.waitForFunction(() => !document.querySelector('[data-tunelito-mermaid][data-mermaid-state="rendering"]'));
          const screenshotPath = join(outputDir, `${themeName}-${colorMode}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          process.stdout.write(`${themeName} (${colorMode}): ${screenshotPath}\n`);

          if ((themeName === "editorial" && colorMode === "light") || themeName === "bns-pitaya") {
            const focusPath = join(outputDir, `${themeName}-${colorMode}-focus.png`);
            await page.screenshot({ path: focusPath, fullPage: false });
            process.stdout.write(`${themeName} (${colorMode}, focus): ${focusPath}\n`);
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await instance.close();
    }
  }
} finally {
  await browser.close();
}

if (readFileSync(fixturePath, "utf8") !== original) {
  throw new Error("Theme screenshot capture changed the Markdown fixture");
}
