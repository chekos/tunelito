#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(skillDir, "../../..");
const runsDir = join(skillDir, "runs");
const statePath = join(runsDir, "current.json");
const evidenceRoot = join(skillDir, "evidence");
const binPath = join(repoRoot, "bin/tunelito.js");
const anchoredBody = "Selection stays anchored.";
const anchoredQuote = "Select this sentence";

const command = process.argv[2];
const argument = process.argv[3];

try {
  if (command === "launch") await launch(argument);
  else if (command === "doctor") await doctor();
  else if (command === "show") show();
  else if (command === "drive") await drive(argument);
  else if (command === "cleanup") await cleanup();
  else {
    process.stderr.write("usage: verify-tunelito.mjs <launch|doctor|show|drive|cleanup>\n");
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function launch(fixtureRel) {
  if (!fixtureRel) throw new Error("launch requires a repo-relative fixture, such as examples/simple-review.html");
  const existing = readState();
  if (existing && isAlive(existing.pid)) {
    throw new Error(`pid ${existing.pid} already serves ${originOf(existing.localUrl)}; run cleanup before launch`);
  }
  if (existing) rmSync(existing.runDir, { recursive: true, force: true });

  const fixtureAbs = resolve(repoRoot, fixtureRel);
  assertInsideRepo(fixtureAbs);
  if (!existsSync(fixtureAbs)) throw new Error(`fixture not found: ${fixtureRel}`);

  const runDir = join(runsDir, Date.now().toString(36));
  const workspace = join(runDir, "workspace");
  mkdirSync(workspace, { recursive: true });
  const targetCopy = join(workspace, basename(fixtureAbs));
  cpSync(fixtureAbs, targetCopy, { recursive: true });
  const commentsPath = join(runDir, "comments.md");
  const logPath = join(runDir, "server.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [
    binPath,
    targetCopy,
    "--no-tunnel",
    "--port",
    "0",
    "--out",
    commentsPath,
  ], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  let localUrl;
  try {
    localUrl = await waitForLocalUrl(logPath, child.pid);
  } catch (error) {
    if (isAlive(child.pid)) process.kill(child.pid, "SIGTERM");
    throw error;
  }

  const state = {
    pid: child.pid,
    localUrl,
    port: Number(new URL(localUrl).port),
    commentsPath,
    runDir,
    targetCopy,
    fixture: relative(repoRoot, fixtureAbs),
    sourceHash: hashFile(fixtureAbs),
    logPath,
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function doctor() {
  const state = requireState();
  const alive = isAlive(state.pid);
  const listeners = listenerPids(state.port);
  const portOwned = listeners === null ? null : listeners.includes(String(state.pid));
  let pageStatus = 0;
  let clientInjected = false;
  let commentsHeader = false;
  if (alive) {
    const page = await fetch(state.localUrl);
    pageStatus = page.status;
    const html = await page.text();
    clientInjected = html.includes("/__tunelito/client.js");
    const comments = await fetch(keyed(state.localUrl, "/__tunelito/comments.md"));
    const text = await comments.text();
    commentsHeader = comments.status === 200 && text.startsWith("# Tunelito comments");
  }
  const report = {
    ok: alive && portOwned !== false && pageStatus === 200 && clientInjected && commentsHeader,
    alive,
    portOwned,
    pageStatus,
    clientInjected,
    commentsHeader,
    pid: state.pid,
    port: state.port,
    origin: originOf(state.localUrl),
    fixture: state.fixture,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

function show() {
  process.stdout.write(`${JSON.stringify(requireState(), null, 2)}\n`);
}

async function drive(feature) {
  if (feature !== "anchored-comment") {
    throw new Error("drive currently proves anchored-comment; other features stay in features/");
  }
  const state = requireState();
  if (!state.sourceHash) throw new Error("anchored-comment requires a file fixture, not a folder");
  if (hashFile(state.targetCopy) !== state.sourceHash) {
    throw new Error("copied fixture already differs from the repo file before driving");
  }

  const evidenceDir = join(evidenceRoot, "anchored-comment");
  mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(state.localUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#tunelito-root").waitFor({ state: "attached" });
    await page.getByText(/^Connected\b/).first().waitFor({ state: "attached", timeout: 8000 });
    await page.screenshot({ path: join(evidenceDir, "before.png") });

    const paragraph = page.getByText(anchoredQuote, { exact: false });
    await paragraph.click({ clickCount: 3 });
    const commentButton = page.getByRole("button", { name: "Comment", exact: true });
    await commentButton.waitFor({ state: "visible", timeout: 5000 });
    await commentButton.click();
    const dialog = page.getByRole("dialog", { name: "Add comment" });
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("textbox").fill(anchoredBody);
    await page.screenshot({ path: join(evidenceDir, "composer.png") });
    await dialog.getByRole("button", { name: "Add comment" }).click();

    await page.getByRole("button", { name: /Open Tunelito comments/ }).click();
    await page.getByText(anchoredBody, { exact: true }).waitFor({ state: "visible", timeout: 8000 });
    await page.screenshot({ path: join(evidenceDir, "after.png") });
    const aria = redactKey(await page.getByRole("complementary", { name: "Tunelito comments" }).ariaSnapshot());
    if (!aria.includes(anchoredBody)) throw new Error("accessibility snapshot is missing the comment body");
    writeFileSync(join(evidenceDir, "panel.aria.txt"), `${aria}\n`);
  } finally {
    await browser.close();
  }

  const comments = readFileSync(state.commentsPath, "utf8");
  if (!comments.includes(anchoredBody)) throw new Error("comments file is missing the comment body");
  if (!comments.includes(anchoredQuote)) throw new Error("comments file is missing the selected quote");
  if (hashFile(state.targetCopy) !== state.sourceHash) throw new Error("served HTML copy changed");
  writeFileSync(join(evidenceDir, "comments.md"), comments);
  const proof = {
    feature: "anchored-comment",
    fixture: state.fixture,
    origin: originOf(state.localUrl),
    body: anchoredBody,
    quote: anchoredQuote,
    sourceUnchanged: true,
    commentsIncludeBody: true,
    commentsIncludeQuote: true,
  };
  writeFileSync(join(evidenceDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
}

async function cleanup() {
  const state = readState();
  if (!state) {
    process.stdout.write("no instance\n");
    return;
  }
  if (isAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
    const deadline = Date.now() + 1500;
    while (isAlive(state.pid) && Date.now() < deadline) await sleep(50);
    if (isAlive(state.pid)) process.kill(state.pid, "SIGKILL");
  }
  rmSync(state.runDir, { recursive: true, force: true });
  rmSync(statePath, { force: true });
  process.stdout.write(`cleaned pid ${state.pid}; evidence kept in ${evidenceRoot}\n`);
}

function requireState() {
  const state = readState();
  if (!state) throw new Error("no verification instance; run launch first");
  return state;
}

function readState() {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listenerPids(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 1) return [];
    return null;
  }
}

async function waitForLocalUrl(logPath, pid) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    const match = text.match(/^Local:\s+(\S+)/m);
    if (match) return match[1];
    if (!isAlive(pid)) throw new Error(`tunelito exited before printing Local:\n${text.trim()}`);
    await sleep(50);
  }
  const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  throw new Error(`timed out waiting for Local:\n${text.trim()}`);
}

function keyed(localUrl, pathname) {
  const base = new URL(localUrl);
  const endpoint = new URL(pathname, base);
  endpoint.search = base.search;
  return endpoint;
}

function originOf(localUrl) {
  return new URL(localUrl).origin;
}

function redactKey(text) {
  return text.replace(/tunelito_key=[^)\s]+/g, "tunelito_key=redacted");
}

function hashFile(path) {
  if (statSync(path).isDirectory()) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertInsideRepo(absPath) {
  const rel = relative(repoRoot, absPath);
  if (!rel || rel.startsWith("..")) throw new Error(`fixture must stay inside the repo: ${absPath}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
