import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { connect } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTunelitoServer, isIgnoredWatchFilename, isLocalOwnerRequest } from "../src/server.js";
import { AGENT_STATUS_ROUTE, CLIENT_ROUTE, REVIEW_EVENTS_ROUTE } from "../src/inject.js";
import { MARKDOWN_CLIENT_ROUTE, MERMAID_CLIENT_ROUTE, MERMAID_LIBRARY_ROUTE } from "../src/markdown.js";
import { renderCommentsMarkdown } from "../src/comments.js";

test("server serves injected HTML, sibling assets, and live WebSocket comments", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-server-"));
  const htmlPath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  writeFileSync(htmlPath, "<!doctype html><html><head><link rel='stylesheet' href='/style.css'></head><body><main>Review me</main></body></html>");
  writeFileSync(join(dir, "style.css"), "body { color: red; }");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const html = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(html, new RegExp(CLIENT_ROUTE));

    const asset = await fetch(new URL("/style.css", instance.localUrl)).then((res) => res.text());
    assert.equal(asset, "body { color: red; }");

    const wsUrl = new URL("/__tunelito/ws", instance.localUrl);
    wsUrl.protocol = "ws:";
    const socket = new WebSocket(wsUrl);
    const messages = [];
    socket.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
    await waitFor(socket, "open");
    await waitUntil(() => messages.some((message) => message.type === "hello"));

    socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Sam",
        quote: "Review me",
        body: "This line needs a stronger verb.",
        textStart: 0,
        textEnd: 9,
      },
    }));

    await waitUntil(() => messages.some((message) => message.type === "comment"));
    const commentEvent = messages.find((message) => message.type === "comment");
    assert.equal(commentEvent.comment.author, "Sam");
    assert.equal(commentEvent.comment.quote, "Review me");

    const markdown = readFileSync(commentsPath, "utf8");
    assert.match(markdown, /This line needs a stronger verb\./);

    const servedMarkdown = await fetch(new URL("/__tunelito/comments.md", instance.localUrl)).then((res) => res.text());
    assert.match(servedMarkdown, /Review me/);

    socket.close();
  } finally {
    await instance.close();
  }
});

test("server renders a Markdown file as an injected commentable page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-markdown-file-"));
  const markdownPath = join(dir, "notes.md");
  const commentsPath = join(dir, "notes.comments.md");
  writeFileSync(markdownPath, [
    "---",
    "status: active",
    "tags: [review, markdown]",
    "---",
    "",
    "# Morning notes",
    "",
    "Review **this memo** before standup.",
    "See [[Project brief|the project brief]] for context.",
    "",
    "<script>alert('raw html should be escaped')</script>",
    "",
    "[unsafe](javascript:alert(1))",
    "",
    "```mermaid",
    "flowchart LR",
    "  Draft --> Review",
    "```",
    "",
    "```js",
    "const ordinary = true;",
    "```",
  ].join("\n"));
  const originalMarkdown = readFileSync(markdownPath, "utf8");

  const instance = await createTunelitoServer({
    filePath: markdownPath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    markdownCssHref: "/brand.css",
    markdownCssText: ".tunelito-markdown { outline: 1px solid rebeccapurple; }",
    markdownTheme: "editorial",
  });

  let socket = null;
  try {
    const html = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(html, /<h1>Morning notes<\/h1>/);
    assert.match(html, /<strong>this memo<\/strong>/);
    assert.match(html, /data-tunelito-source-type="markdown"/);
    assert.match(html, /id="tunelito-properties"/);
    assert.match(html, /Properties · 2/);
    assert.match(html, /data-tunelito-wikilink="Project brief">the project brief/);
    assert.doesNotMatch(html, /<p>status: active/);
    assert.match(html, /aria-label="Document map"/);
    assert.match(html, /data-tunelito-theme="editorial"/);
    assert.match(html, /data-tunelito-config-css/);
    assert.match(html, /outline: 1px solid rebeccapurple/);
    assert.match(html, /<link rel="stylesheet" href="\/brand\.css">/);
    assert.ok(html.indexOf("data-tunelito-theme-css") < html.indexOf("data-tunelito-config-css"));
    assert.ok(html.indexOf("data-tunelito-config-css") < html.indexOf('href="/brand.css"'));
    assert.match(html, new RegExp(CLIENT_ROUTE));
    assert.match(html, /&lt;script&gt;alert/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.match(html, /data-tunelito-mermaid/);
    assert.match(html, /flowchart LR/);
    assert.match(html, /<pre><code class="language-js">/);
    assert.match(html, new RegExp(MERMAID_LIBRARY_ROUTE));
    assert.match(html, new RegExp(MERMAID_CLIENT_ROUTE));
    assert.match(html, new RegExp(MARKDOWN_CLIENT_ROUTE));

    const markdownClient = await fetch(new URL(MARKDOWN_CLIENT_ROUTE, instance.localUrl));
    assert.equal(markdownClient.headers.get("content-type"), "text/javascript; charset=utf-8");
    const markdownClientSource = await markdownClient.text();
    assert.match(markdownClientSource, /aria-current/);
    assert.match(markdownClientSource, /ArrowDown/);
    assert.match(markdownClientSource, /prefers-reduced-motion/);
    assert.match(markdownClientSource, /tunelito:comments-panel/);
    assert.match(markdownClientSource, /H5: "14px"/);
    assert.match(markdownClientSource, /H6: "12px"/);

    const mermaidLibrary = await fetch(new URL(MERMAID_LIBRARY_ROUTE, instance.localUrl));
    assert.equal(mermaidLibrary.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.match(await mermaidLibrary.text(), /mermaid/);

    const mermaidClient = await fetch(new URL(MERMAID_CLIENT_ROUTE, instance.localUrl));
    assert.equal(mermaidClient.headers.get("content-type"), "text/javascript; charset=utf-8");
    const mermaidClientSource = await mermaidClient.text();
    assert.match(mermaidClientSource, /securityLevel: "strict"/);
    assert.match(mermaidClientSource, /startOnLoad: false/);
    assert.match(mermaidClientSource, /themeVariables/);
    assert.match(mermaidClientSource, /primaryTextColor/);
    assert.match(mermaidClientSource, /Could not render Mermaid diagram/);

    const named = await fetch(new URL("/notes.md", instance.localUrl));
    assert.equal(named.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await named.text(), /Morning notes/);

    socket = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
    await waitFor(socket.socket, "open");
    await waitUntil(() => socket.messages.some((message) => message.type === "hello"));
    socket.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Sam",
        quote: "this memo",
        body: "Tighten this before sharing.",
        textStart: 7,
        textEnd: 16,
      },
    }));
    await waitUntil(() => socket.messages.some((message) => message.type === "comment"));
    assert.match(readFileSync(commentsPath, "utf8"), /Tighten this before sharing\./);
    assert.equal(readFileSync(markdownPath, "utf8"), originalMarkdown);
  } finally {
    socket?.socket.close();
    await instance.close();
  }
});

test("directory mode injects HTML pages and keeps comments page-specific", async () => {
  const parentDir = mkdtempSync(join(tmpdir(), "tunelito-directory-"));
  const siteDir = join(parentDir, "site");
  mkdirSync(siteDir);
  const commentsPath = join(siteDir, "review.md");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><main>Home page</main><a href='/about.html'>About</a></body></html>");
  writeFileSync(join(siteDir, "about.html"), "<!doctype html><html><head><link rel='stylesheet' href='/style.css'></head><body><main>About page</main></body></html>");
  writeFileSync(join(siteDir, "style.css"), "body { color: blue; }");
  writeFileSync(join(siteDir, ".env"), "SECRET=1");
  mkdirSync(join(siteDir, ".git"));
  writeFileSync(join(siteDir, ".git", "config"), "private repo metadata");
  mkdirSync(join(siteDir, ".tunelito", "agent"), { recursive: true });
  writeFileSync(join(siteDir, ".tunelito", "agent", "state.json"), "{}");
  const visibleAgentStatePath = join(siteDir, "agent-state.json");
  const visibleAgentLogPath = join(siteDir, "log.md");
  const projectConfigPath = join(siteDir, "tunelito.config.json");
  writeFileSync(visibleAgentStatePath, "{}");
  writeFileSync(visibleAgentLogPath, "agent log");
  writeFileSync(projectConfigPath, JSON.stringify({ theme: "technical" }));
  let linkedEnvPath = null;
  try {
    linkedEnvPath = join(siteDir, "linked-env");
    symlinkSync(join(siteDir, ".env"), linkedEnvPath, "file");
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }

  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    blockedPaths: [visibleAgentStatePath, visibleAgentLogPath, projectConfigPath],
  });

  const sockets = [];
  try {
    assert.equal(instance.directoryMode, true);

    const indexHtml = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(indexHtml, /Home page/);
    assert.match(indexHtml, new RegExp(CLIENT_ROUTE));

    const aboutHtml = await fetch(new URL("/about.html", instance.localUrl)).then((res) => res.text());
    assert.match(aboutHtml, /About page/);
    assert.match(aboutHtml, new RegExp(CLIENT_ROUTE));

    const asset = await fetch(new URL("/style.css", instance.localUrl)).then((res) => res.text());
    assert.equal(asset, "body { color: blue; }");

    const aboutSocketUrl = new URL("/__tunelito/ws", instance.localUrl);
    aboutSocketUrl.searchParams.set("tunelito_page", "/about.html");
    const about = openJsonSocket(aboutSocketUrl);
    sockets.push(about.socket);
    await waitFor(about.socket, "open");
    await waitUntil(() => about.messages.some((message) => message.type === "hello"));
    const aboutHello = about.messages.find((message) => message.type === "hello");
    assert.equal(aboutHello.pagePath, "/about.html");
    assert.deepEqual(aboutHello.comments, []);

    about.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Rae",
        quote: "About page",
        body: "Make this more specific.",
        pagePath: "/wrong.html",
        textStart: 0,
        textEnd: 10,
      },
    }));

    await waitUntil(() => about.messages.some((message) => message.type === "comment"));
    const commentEvent = about.messages.find((message) => message.type === "comment");
    assert.equal(commentEvent.comment.pagePath, "/about.html");

    const root = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
    sockets.push(root.socket);
    await waitFor(root.socket, "open");
    await waitUntil(() => root.messages.some((message) => message.type === "hello"));
    const rootHello = root.messages.find((message) => message.type === "hello");
    assert.equal(rootHello.pagePath, "/");
    assert.deepEqual(rootHello.comments, []);

    const nextAboutSocketUrl = new URL("/__tunelito/ws", instance.localUrl);
    nextAboutSocketUrl.searchParams.set("tunelito_page", "/about.html");
    const nextAbout = openJsonSocket(nextAboutSocketUrl);
    sockets.push(nextAbout.socket);
    await waitFor(nextAbout.socket, "open");
    await waitUntil(() => nextAbout.messages.some((message) => message.type === "hello"));
    const nextAboutHello = nextAbout.messages.find((message) => message.type === "hello");
    assert.equal(nextAboutHello.comments.length, 1);
    assert.equal(nextAboutHello.comments[0].body, "Make this more specific.");

    const markdown = readFileSync(commentsPath, "utf8");
    assert.match(markdown, /page: `\/about\.html`/);
    assert.match(markdown, /id: `c_/);

    const staticComments = await fetch(new URL("/review.md", instance.localUrl));
    assert.equal(staticComments.status, 404);

    const envFile = await fetch(new URL("/.env", instance.localUrl));
    assert.equal(envFile.status, 404);

    const gitFile = await fetch(new URL("/.git/config", instance.localUrl));
    assert.equal(gitFile.status, 404);

    const agentState = await fetch(new URL("/.tunelito/agent/state.json", instance.localUrl));
    assert.equal(agentState.status, 404);

    const visibleAgentState = await fetch(new URL("/agent-state.json", instance.localUrl));
    assert.equal(visibleAgentState.status, 404);

    const visibleAgentLog = await fetch(new URL("/log.md", instance.localUrl));
    assert.equal(visibleAgentLog.status, 404);

    const projectConfig = await fetch(new URL("/tunelito.config.json", instance.localUrl));
    assert.equal(projectConfig.status, 404);

    if (linkedEnvPath) {
      const linkedEnvFile = await fetch(new URL("/linked-env", instance.localUrl));
      assert.equal(linkedEnvFile.status, 404);
    }
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("directory mode renders Markdown pages and lists them in generated indexes", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "tunelito-markdown-directory-"));
  const commentsPath = join(siteDir, "site.comments.md");
  writeFileSync(join(siteDir, "index.md"), "# Home memo\n\nStart here.");
  writeFileSync(join(siteDir, "brief.md"), "# Project brief\n\nPlain prose.\n\n```mermaid\nsequenceDiagram\n  Author->>Reviewer: Share\n```");
  writeFileSync(join(siteDir, "style.css"), "main { max-width: 50rem; }");

  const nestedDir = join(siteDir, "notes");
  mkdirSync(nestedDir);
  writeFileSync(join(nestedDir, "daily.md"), "# Daily note\n\nNested memo.");

  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    markdownTheme: "technical",
  });

  const sockets = [];
  try {
    const root = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(root, /Home memo/);
    assert.match(root, new RegExp(CLIENT_ROUTE));
    assert.match(root, /data-tunelito-theme="technical"/);

    const brief = await fetch(new URL("/brief.md", instance.localUrl));
    assert.equal(brief.headers.get("content-type"), "text/html; charset=utf-8");
    const briefHtml = await brief.text();
    assert.match(briefHtml, /Project brief/);
    assert.match(briefHtml, /data-tunelito-theme="technical"/);
    assert.match(briefHtml, /data-tunelito-mermaid/);
    assert.match(briefHtml, new RegExp(MERMAID_LIBRARY_ROUTE));

    const notesIndex = await fetch(new URL("/notes/", instance.localUrl)).then((res) => res.text());
    assert.match(notesIndex, /daily\.md/);

    const briefSocketUrl = new URL("/__tunelito/ws", instance.localUrl);
    briefSocketUrl.searchParams.set("tunelito_page", "/brief.md");
    const briefSocket = openJsonSocket(briefSocketUrl);
    sockets.push(briefSocket.socket);
    await waitFor(briefSocket.socket, "open");
    await waitUntil(() => briefSocket.messages.some((message) => message.type === "hello"));

    briefSocket.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Rae",
        quote: "Plain prose.",
        body: "Make this memo more concrete.",
      },
    }));
    await waitUntil(() => briefSocket.messages.some((message) => message.type === "comment"));
    const comment = briefSocket.messages.find((message) => message.type === "comment").comment;
    assert.equal(comment.pagePath, "/brief.md");
    assert.match(readFileSync(commentsPath, "utf8"), /page: `\/brief\.md`/);
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("directory mode supports page notes and site-wide comments", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "tunelito-comment-scopes-"));
  const commentsPath = join(siteDir, "site.comments.md");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><main>Home page</main></body></html>");
  writeFileSync(join(siteDir, "about.html"), "<!doctype html><html><body><main>About page</main></body></html>");

  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
  });

  const sockets = [];
  try {
    const root = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
    sockets.push(root.socket);
    await waitFor(root.socket, "open");
    await waitUntil(() => root.messages.some((message) => message.type === "hello"));

    const aboutSocketUrl = new URL("/__tunelito/ws", instance.localUrl);
    aboutSocketUrl.searchParams.set("tunelito_page", "/about.html");
    const about = openJsonSocket(aboutSocketUrl);
    sockets.push(about.socket);
    await waitFor(about.socket, "open");
    await waitUntil(() => about.messages.some((message) => message.type === "hello"));

    about.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Aki",
        scope: "page",
        quote: "",
        body: "Add opening hours to this page.",
      },
    }));
    await waitUntil(() => about.messages.some((message) => message.type === "comment" && message.comment.body === "Add opening hours to this page."));

    about.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Aki",
        scope: "site",
        quote: "",
        body: "Use the same heading rhythm across every itinerary page.",
      },
    }));
    await waitUntil(() => root.messages.some((message) => message.type === "comment" && message.comment.body === "Use the same heading rhythm across every itinerary page."));

    const rootCommentEvents = root.messages.filter((message) => message.type === "comment");
    assert.deepEqual(rootCommentEvents.map((message) => message.comment.body), ["Use the same heading rhythm across every itinerary page."]);
    assert.equal(rootCommentEvents[0].comment.scope, "site");
    assert.equal(rootCommentEvents[0].comment.pagePath, "/about.html");

    const freshRoot = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
    sockets.push(freshRoot.socket);
    await waitFor(freshRoot.socket, "open");
    await waitUntil(() => freshRoot.messages.some((message) => message.type === "hello"));
    const freshRootHello = freshRoot.messages.find((message) => message.type === "hello");
    assert.deepEqual(freshRootHello.comments.map((comment) => comment.body), ["Use the same heading rhythm across every itinerary page."]);

    const freshAboutSocketUrl = new URL("/__tunelito/ws", instance.localUrl);
    freshAboutSocketUrl.searchParams.set("tunelito_page", "/about.html");
    const freshAbout = openJsonSocket(freshAboutSocketUrl);
    sockets.push(freshAbout.socket);
    await waitFor(freshAbout.socket, "open");
    await waitUntil(() => freshAbout.messages.some((message) => message.type === "hello"));
    const freshAboutHello = freshAbout.messages.find((message) => message.type === "hello");
    assert.deepEqual(freshAboutHello.comments.map((comment) => comment.body), [
      "Add opening hours to this page.",
      "Use the same heading rhythm across every itinerary page.",
    ]);

    const markdown = readFileSync(commentsPath, "utf8");
    assert.match(markdown, /scope: `page`/);
    assert.match(markdown, /scope: `site`/);
    assert.match(markdown, /_Page note \(no selected text\)\._/);
    assert.match(markdown, /_Site note \(no selected text\)\._/);

    const clientScript = await fetch(new URL("/__tunelito/client.js", instance.localUrl)).then((res) => res.text());
    assert.match(clientScript, /Page note/);
    assert.match(clientScript, /Site note/);
    assert.match(clientScript, /data-scope="site"/);
    assert.match(clientScript, /class="launcher-glyph"/);
    assert.match(clientScript, /aria-label="Open Tunelito comments"/);
    assert.match(clientScript, /work-badge/);
    assert.match(clientScript, /Agent work status/);
    assert.match(clientScript, /Assigned as/);
    assert.match(clientScript, /identity-card/);
    assert.match(clientScript, /friendlyReviewerName/);
    assert.match(clientScript, /rename-reviewer/);
    assert.match(clientScript, /pendingReviewerRename/);
    assert.match(clientScript, /queueCurrentAuthorRenameIfNeeded/);
    assert.match(clientScript, /Toggle laser pointer/);
    assert.match(clientScript, /laser-pointer/);
    assert.match(clientScript, /\.laser,\s+\.peer-laser \{/);
    assert.match(clientScript, /pointer-events: none/);
    assert.match(clientScript, /Done Reviewing/);
    assert.match(clientScript, /review-completed/);
    assert.match(clientScript, /handoff-status/);
    assert.match(clientScript, /hasFinePointer/);
    assert.match(clientScript, /width: 44px;\s+height: 44px;/);
    assert.match(clientScript, /button\.secondary, button\.primary \{\s+min-height: 44px;/);
    assert.doesNotMatch(clientScript, /Comments <span class="count"/);
    assert.doesNotMatch(clientScript, /Guest [A-Z0-9]/);
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("server exposes agent work status for browser comment cards", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "tunelito-agent-status-"));
  const commentsPath = join(siteDir, "site.comments.md");
  const statePath = join(siteDir, "agent-state.json");
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><html><body><main>Home page</main></body></html>");
  writeFileSync(commentsPath, renderCommentsMarkdown({
    sourcePath: siteDir,
    comments: [
      {
        id: "c_done",
        author: "Dana",
        authorRole: "visitor",
        scope: "page",
        quote: "",
        body: "Make the hero specific.",
        prefix: "",
        suffix: "",
        path: "",
        pagePath: "/",
        textStart: null,
        textEnd: null,
        created: "2026-06-10T00:00:00.000Z",
      },
      {
        id: "c_waiting",
        author: "Rae",
        authorRole: "visitor",
        scope: "page",
        quote: "",
        body: "Tighten the footer.",
        prefix: "",
        suffix: "",
        path: "",
        pagePath: "/",
        textStart: null,
        textEnd: null,
        created: "2026-06-10T00:01:00.000Z",
      },
    ],
  }));
  writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    updatedAt: "2026-06-10T00:02:00.000Z",
    comments: {
      c_done: {
        id: "c_done",
        status: "resolved",
        summary: "Made the hero specific.",
        completedTasks: ["Make the hero specific"],
        filesChanged: ["index.html"],
        updatedAt: "2026-06-10T00:02:00.000Z",
        completedAt: "2026-06-10T00:02:00.000Z",
      },
    },
  }, null, 2)}\n`);

  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath,
    agentStatePath: statePath,
    host: "127.0.0.1",
    port: 0,
  });

  const sockets = [];
  try {
    const root = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
    sockets.push(root.socket);
    await waitFor(root.socket, "open");
    await waitUntil(() => root.messages.some((message) => message.type === "hello"));
    const hello = root.messages.find((message) => message.type === "hello");
    assert.equal(hello.agentStatusUrl, AGENT_STATUS_ROUTE);
    assert.equal(hello.agentStatuses.comments.c_done.label, "Integrated");
    assert.deepEqual(hello.agentStatuses.comments.c_done.done, ["Make the hero specific"]);
    assert.equal(hello.agentStatuses.comments.c_waiting.label, "Queued");

    const status = await fetch(new URL(AGENT_STATUS_ROUTE, instance.localUrl)).then((res) => res.json());
    assert.equal(status.comments.c_done.tone, "done");
    assert.equal(status.comments.c_waiting.tone, "pending");

    const rawState = await fetch(new URL("/agent-state.json", instance.localUrl));
    assert.equal(rawState.status, 404);
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("server emits Done Reviewing handoff events and replays them to waiters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-review-handoff-"));
  const htmlPath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  const sourceHtml = "<!doctype html><html><body><main>Handoff draft</main></body></html>";
  writeFileSync(htmlPath, sourceHtml);

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    now: () => new Date("2026-06-17T12:00:00.000Z"),
  });

  const socket = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
  try {
    await waitFor(socket.socket, "open");
    await waitUntil(() => socket.messages.some((message) => message.type === "hello"));

    socket.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Dana",
        scope: "page",
        quote: "Handoff draft",
        body: "Tighten the headline.",
        textStart: 0,
        textEnd: 13,
      },
    }));
    await waitUntil(() => socket.messages.some((message) => message.type === "comment"));

    socket.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Dana",
        scope: "site",
        quote: "",
        body: "Use a consistent CTA label.",
      },
    }));
    await waitUntil(() => socket.messages.filter((message) => message.type === "comment").length >= 2);

    const waitUrl = new URL(REVIEW_EVENTS_ROUTE, instance.localUrl);
    waitUrl.searchParams.set("timeout", "2");
    const waiting = fetch(waitUrl);

    socket.socket.send(JSON.stringify({
      type: "review-completed",
      overallComment: "Start with the homepage copy.",
    }));

    const waitResponse = await waiting;
    assert.equal(waitResponse.status, 200);
    const event = await waitResponse.json();
    assert.equal(event.type, "review.completed");
    assert.equal(event.sequence, 1);
    assert.equal(event.createdAt, "2026-06-17T12:00:00.000Z");
    assert.equal(event.targetPath, htmlPath);
    assert.equal(event.commentsPath, commentsPath);
    assert.equal(event.summary.comments, 2);
    assert.equal(event.summary.page, 1);
    assert.equal(event.summary.site, 1);
    assert.equal(event.summary.owner, 2);
    assert.equal(event.summary.visitor, 0);
    assert.equal(event.summary.pending, 2);
    assert.equal(event.overallComment, "Start with the homepage copy.");

    await waitUntil(() => socket.messages.some((message) => message.type === "review-completed"));
    const browserAck = socket.messages.find((message) => message.type === "review-completed").event;
    assert.equal(browserAck.sequence, 1);

    socket.socket.send(JSON.stringify({ type: "review-completed" }));
    await waitUntil(() => socket.messages.filter((message) => message.type === "review-completed").length >= 2);
    const secondAck = socket.messages.filter((message) => message.type === "review-completed")[1].event;
    assert.equal(secondAck.sequence, 2);

    const replayUrl = new URL(REVIEW_EVENTS_ROUTE, instance.localUrl);
    replayUrl.searchParams.set("after", "1");
    const replay = await fetch(replayUrl).then((res) => res.json());
    assert.equal(replay.sequence, 2);

    const markdown = readFileSync(commentsPath, "utf8");
    assert.match(markdown, /Tighten the headline\./);
    assert.match(markdown, /Use a consistent CTA label\./);
    assert.doesNotMatch(markdown, /review\.completed/);
    assert.equal(readFileSync(htmlPath, "utf8"), sourceHtml);
  } finally {
    socket.socket.close();
    await instance.close();
  }
});

test("review handoff wait route times out cleanly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-review-timeout-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body><main>No handoff yet</main></body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const waitUrl = new URL(REVIEW_EVENTS_ROUTE, instance.localUrl);
    waitUrl.searchParams.set("after", "latest");
    waitUrl.searchParams.set("timeout", "1");
    const response = await fetch(waitUrl);
    const payload = await response.json();
    assert.equal(response.status, 408);
    assert.equal(payload.type, "review.timeout");
    assert.equal(payload.timeoutSeconds, 1);
  } finally {
    await instance.close();
  }
});

test("watcher ignores local agent ledger paths", () => {
  assert.equal(isIgnoredWatchFilename(".tunelito/agent/state.json"), true);
  assert.equal(isIgnoredWatchFilename("nested/.tunelito/agent/log.md"), true);
  assert.equal(isIgnoredWatchFilename("index.html"), false);
});

test("single-file watcher survives repeated atomic saves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-atomic-watch-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body>First version</body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
  });

  const socket = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
  try {
    await waitFor(socket.socket, "open");
    await waitUntil(() => socket.messages.some((message) => message.type === "hello"));
    await delay(450);
    assert.equal(messageCount(socket.messages, "document-changed"), 0);

    atomicReplace(htmlPath, "<!doctype html><html><body>Second version</body></html>");
    await waitUntil(() => messageCount(socket.messages, "document-changed") >= 1, 3000);

    atomicReplace(htmlPath, "<!doctype html><html><body>Third version</body></html>");
    await waitUntil(() => messageCount(socket.messages, "document-changed") >= 2, 3000);
  } finally {
    socket.socket.close();
    await instance.close();
  }
});

test("directory mode renders intentional root, nested, and empty folder landing pages", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "tunelito-directory-index-"));
  const commentsPath = join(siteDir, "comments.html");
  writeFileSync(join(siteDir, "zeta.html"), "<!doctype html><html><body>Listed page</body></html>");
  writeFileSync(join(siteDir, "Alpha notes.md"), "# Listed notes");
  writeFileSync(join(siteDir, "<unsafe>.md"), "# Escaped filename");
  writeFileSync(commentsPath, "private comments");
  writeFileSync(`${commentsPath}.tmp`, "private comments temp");
  writeFileSync(join(siteDir, "notes.txt"), "not listed");
  writeFileSync(join(siteDir, "tunelito.config.json"), "{}");
  mkdirSync(join(siteDir, ".tunelito"));
  writeFileSync(join(siteDir, ".tunelito", "session.json"), "{}");
  const nestedDir = join(siteDir, "Projects");
  const emptyDir = join(siteDir, "Empty");
  mkdirSync(nestedDir);
  mkdirSync(emptyDir);
  writeFileSync(join(nestedDir, "brief.md"), "# Brief");

  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const html = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(html, /Tunelito-generated navigation/);
    assert.match(html, /data-tunelito-theme="bns-pitaya"/);
    assert.match(html, /has no authored index/);
    assert.match(html, /tunelito-folder-card-directory/);
    assert.match(html, /Projects/);
    assert.match(html, /Empty/);
    assert.match(html, /zeta\.html/);
    assert.match(html, /Alpha notes\.md/);
    assert.match(html, /&lt;unsafe&gt;\.md/);
    assert.doesNotMatch(html, /<unsafe>/);
    assert.doesNotMatch(html, /<a class="tunelito-folder-parent"/);
    assert.ok(html.indexOf("Empty") < html.indexOf("Alpha notes.md"), "folders should be grouped before documents");
    assert.doesNotMatch(html, /notes\.txt/);
    assert.doesNotMatch(html, /comments\.html/);
    assert.doesNotMatch(html, /tunelito\.config\.json/);
    assert.doesNotMatch(html, /session\.json/);
    assert.match(html, new RegExp(CLIENT_ROUTE));

    const nested = await fetch(new URL("/Projects/", instance.localUrl)).then((res) => res.text());
    assert.match(nested, /data-tunelito-theme="bns-pitaya"/);
    assert.match(nested, /href="\.\.\/">← Parent folder/);
    assert.match(nested, /brief\.md/);
    assert.doesNotMatch(nested, /href="\.\.\/\.\.\//);

    const empty = await fetch(new URL("/Empty/", instance.localUrl)).then((res) => res.text());
    assert.match(empty, /This folder is empty/);
    assert.match(empty, /No served Markdown, HTML, or child folders/);

    const staticComments = await fetch(new URL("/comments.html", instance.localUrl));
    assert.equal(staticComments.status, 404);

    const tempComments = await fetch(new URL("/comments.html.tmp", instance.localUrl));
    assert.equal(tempComments.status, 404);
  } finally {
    await instance.close();
  }
});

test("directory Markdown pages receive a collapsed, filtered navigation tree", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "tunelito-directory-navigation-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "tunelito-directory-navigation-outside-"));
  const commentsPath = join(siteDir, "vault.comments.md");
  writeFileSync(join(siteDir, "index.md"), "---\nstatus: active\n---\n\n# Home");
  writeFileSync(join(siteDir, "No front matter.md"), "# Plain note");
  writeFileSync(join(siteDir, "Overview.html"), "<h1>Overview</h1>");
  writeFileSync(join(siteDir, "asset.txt"), "not served");
  writeFileSync(commentsPath, "private comments");
  writeFileSync(join(siteDir, "tunelito.config.json"), "{}");
  mkdirSync(join(siteDir, ".tunelito"));
  writeFileSync(join(siteDir, ".tunelito", "session.json"), "{}");

  const projectDir = join(siteDir, "Projects & café");
  const deeperDir = join(projectDir, "Deep plans");
  mkdirSync(projectDir);
  mkdirSync(deeperDir);
  for (let index = 1; index <= 10; index += 1) {
    writeFileSync(join(projectDir, `Note ${index}.md`), `# Note ${index}`);
  }
  writeFileSync(join(deeperDir, "Now.md"), "# Current deep note");
  writeFileSync(join(outsideDir, "outside.md"), "# Outside");
  let linkedOutside = false;
  try {
    symlinkSync(join(outsideDir, "outside.md"), join(siteDir, "escaped.md"));
    symlinkSync(outsideDir, join(siteDir, "escaped-folder"));
    linkedOutside = true;
  } catch {
    // Symlink creation may be unavailable in restricted environments.
  }

  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const plainHtml = await fetch(new URL("/No%20front%20matter.md", instance.localUrl)).then((res) => res.text());
    assert.match(plainHtml, /data-tunelito-theme="bns-pitaya"/);
    assert.match(plainHtml, /Tunelito navigation/);
    assert.match(plainHtml, /Served documents/);
    assert.doesNotMatch(plainHtml, /Source metadata/);
    assert.match(plainHtml, /href="\/No%20front%20matter\.md" aria-current="page"/);
    assert.match(plainHtml, /href="\/Projects%20%26%20caf%C3%A9\/"/);
    assert.match(plainHtml, /<details class="tunelito-navigation-folder">/);
    assert.doesNotMatch(plainHtml, /<details class="tunelito-navigation-folder" open/);
    assert.match(plainHtml, /Note 10\.md/);
    assert.match(plainHtml, /Deep plans/);
    assert.doesNotMatch(plainHtml, /asset\.txt|vault\.comments\.md|tunelito\.config\.json|session\.json/);
    if (linkedOutside) assert.doesNotMatch(plainHtml, /escaped\.md|escaped-folder/);

    const homeHtml = await fetch(new URL("/index.md", instance.localUrl)).then((res) => res.text());
    assert.match(homeHtml, /Tunelito navigation/);
    assert.match(homeHtml, /Source metadata/);
    assert.match(homeHtml, /Properties · 1/);

    const deepHtml = await fetch(new URL("/Projects%20%26%20caf%C3%A9/Deep%20plans/Now.md", instance.localUrl)).then((res) => res.text());
    assert.match(deepHtml, /href="\/Projects%20%26%20caf%C3%A9\/Deep%20plans\/Now\.md" aria-current="page"/);

    const firstFolder = plainHtml.indexOf('href="/Projects%20%26%20caf%C3%A9/"');
    const firstDocument = plainHtml.indexOf('href="/No%20front%20matter.md"');
    assert.ok(firstFolder >= 0 && firstFolder < firstDocument, "root folders should precede root documents");

    writeFileSync(join(projectDir, "Added later.md"), "# Added after startup");
    const refreshedHtml = await fetch(new URL("/No%20front%20matter.md", instance.localUrl)).then((res) => res.text());
    assert.match(refreshedHtml, /href="\/Projects%20%26%20caf%C3%A9\/Added%20later\.md"/);
  } finally {
    await instance.close();
  }
});

test("live mode keeps comments in memory and relays peer signaling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-live-"));
  const htmlPath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  writeFileSync(htmlPath, "<!doctype html><html><body><main>Review me live</main></body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    liveMode: true,
  });

  const sockets = [];
  try {
    assert.equal(instance.liveMode, true);
    assert.equal(instance.commentsPath, null);

    const html = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(html, /data-live-mode="true"/);

    const commentsResponse = await fetch(new URL("/__tunelito/comments.md", instance.localUrl));
    assert.equal(commentsResponse.status, 404);
    assert.match(await commentsResponse.text(), /ephemeral/);

    const first = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
    sockets.push(first.socket);
    await waitFor(first.socket, "open");
    await waitUntil(() => first.messages.some((message) => message.type === "hello"));
    const firstHello = first.messages.find((message) => message.type === "hello");
    assert.equal(firstHello.liveMode, true);
    assert.equal(firstHello.commentsUrl, null);
    assert.match(firstHello.peerId, /^p_/);

    first.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        id: "c_live_1",
        author: "Ada",
        quote: "Review me live",
        body: "This should stay in memory.",
        textStart: 0,
        textEnd: 14,
        created: "2026-05-23T12:00:00.000Z",
      },
    }));

    await waitUntil(() => first.messages.some((message) => message.type === "comment"));
    assert.equal(existsSync(commentsPath), false);

    const second = openJsonSocket(new URL("/__tunelito/ws", instance.localUrl));
    sockets.push(second.socket);
    await waitFor(second.socket, "open");
    await waitUntil(() => second.messages.some((message) => message.type === "hello"));
    const secondHello = second.messages.find((message) => message.type === "hello");
    assert.equal(secondHello.comments.length, 1);
    assert.equal(secondHello.comments[0].id, "c_live_1");
    assert.deepEqual(secondHello.peers.map((peer) => peer.id), [firstHello.peerId]);

    await waitUntil(() => first.messages.some((message) => message.type === "peer-joined"));
    assert.equal(first.messages.find((message) => message.type === "peer-joined").peer.id, secondHello.peerId);

    second.socket.send(JSON.stringify({
      type: "signal",
      to: firstHello.peerId,
      signal: { description: { type: "offer", sdp: "v=0\r\n" } },
    }));
    await waitUntil(() => first.messages.some((message) => message.type === "signal"));
    const signal = first.messages.find((message) => message.type === "signal");
    assert.equal(signal.from, secondHello.peerId);
    assert.equal(signal.signal.description.type, "offer");

    first.socket.send(JSON.stringify({
      type: "live-event",
      event: { type: "cursor", x: 12, y: 34, author: "Ada" },
    }));
    await waitUntil(() => second.messages.some((message) => message.type === "live-event"));
    const liveEvent = second.messages.find((message) => message.type === "live-event");
    assert.equal(liveEvent.from, firstHello.peerId);
    assert.equal(liveEvent.event.type, "cursor");

    first.socket.send(JSON.stringify({
      type: "live-event",
      event: { type: "laser-pointer", active: true, x: 24, y: 48, pressed: false, author: "Ada" },
    }));
    await waitUntil(() => second.messages.some((message) => message.type === "live-event" && message.event.type === "laser-pointer"));
    const laserEvent = second.messages.find((message) => message.type === "live-event" && message.event.type === "laser-pointer");
    assert.equal(laserEvent.from, firstHello.peerId);
    assert.equal(laserEvent.event.active, true);
    assert.equal(existsSync(commentsPath), false);

    first.socket.send(JSON.stringify({
      type: "rename-reviewer",
      author: "Ada Lovelace",
    }));
    await waitUntil(() => second.messages.some((message) => message.type === "comment-updated" && message.comment.id === "c_live_1"));
    const renameUpdate = second.messages.find((message) => message.type === "comment-updated" && message.comment.id === "c_live_1").comment;
    assert.equal(renameUpdate.author, "Ada Lovelace");
    assert.equal(renameUpdate.reviewerId, firstHello.reviewerId);
    assert.equal(existsSync(commentsPath), false);

    first.socket.send(JSON.stringify({ type: "review-completed" }));
    await waitUntil(() => first.messages.some((message) => message.type === "review-completed"));
    const handoff = first.messages.find((message) => message.type === "review-completed").event;
    assert.equal(handoff.type, "review.completed");
    assert.equal(handoff.commentsPath, null);
    assert.equal(handoff.liveMode, true);
    assert.equal(handoff.summary.comments, 1);
    assert.equal(existsSync(commentsPath), false);
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("server returns 400 for malformed URL escapes without exiting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-bad-path-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body>Still here</body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const badResponse = await rawGet(instance.localUrl, "/%E0%A4%A");
    assert.equal(badResponse.statusCode, 400);
    assert.equal(badResponse.body, "Bad request");

    const html = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(html, /Still here/);
  } finally {
    await instance.close();
  }
});

test("server serves normal sibling assets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-asset-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body><img src='/image.txt'></body></html>");
  writeFileSync(join(dir, "image.txt"), "sibling asset");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const response = await fetch(new URL("/image.txt", instance.localUrl));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "sibling asset");
  } finally {
    await instance.close();
  }
});

test("server denies path traversal requests for assets", async () => {
  const parentDir = mkdtempSync(join(tmpdir(), "tunelito-traversal-"));
  const pageDir = join(parentDir, "page");
  mkdirSync(pageDir);
  const htmlPath = join(pageDir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body>Traversal check</body></html>");
  writeFileSync(join(parentDir, "secret.txt"), "outside root");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const plainTraversal = await rawGet(instance.localUrl, "/../secret.txt");
    assert.equal(plainTraversal.statusCode, 404);
    assert.equal(plainTraversal.body, "Not found");

    const encodedTraversal = await rawGet(instance.localUrl, "/%2e%2e%2fsecret.txt");
    assert.equal(encodedTraversal.statusCode, 404);
    assert.equal(encodedTraversal.body, "Not found");
  } finally {
    await instance.close();
  }
});

test("server denies symlinked assets that resolve outside the page directory", async (t) => {
  const parentDir = mkdtempSync(join(tmpdir(), "tunelito-symlink-"));
  const pageDir = join(parentDir, "page");
  mkdirSync(pageDir);
  const htmlPath = join(pageDir, "page.html");
  const outsidePath = join(parentDir, "outside.txt");
  const linkPath = join(pageDir, "outside-link.txt");
  writeFileSync(htmlPath, "<!doctype html><html><body>Symlink check</body></html>");
  writeFileSync(outsidePath, "outside root");
  try {
    symlinkSync(outsidePath, linkPath, "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip("filesystem does not allow symlink creation");
      return;
    }
    throw error;
  }

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const response = await fetch(new URL("/outside-link.txt", instance.localUrl));
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
  } finally {
    await instance.close();
  }
});

test("server can require a review access key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-auth-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body>Private draft</body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "secret",
  });

  try {
    assert.match(instance.localUrl, /tunelito_key=secret/);

    const denied = await fetch(instance.originUrl);
    assert.equal(denied.status, 401);
    assert.equal(await denied.text(), "Tunelito review link is missing or invalid.");
    assert.equal(denied.headers.get("x-tunelito-review"), null);

    const badCookie = await fetch(instance.originUrl, { headers: { cookie: "tunelito_key=%" } });
    assert.equal(badCookie.status, 401);
    await badCookie.text();

    const allowed = await fetch(instance.localUrl);
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /Private draft/);
    assert.match(allowed.headers.get("set-cookie"), /tunelito_key=secret/);
    assert.equal(allowed.headers.get("x-tunelito-review"), "1");

    const readiness = await fetch(instance.localUrl, { method: "HEAD" });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.headers.get("x-tunelito-review"), "1");
    assert.equal(await readiness.text(), "");

    const clientDenied = await fetch(new URL("/__tunelito/client.js", instance.originUrl));
    assert.equal(clientDenied.status, 401);
    await clientDenied.text();

    const markdownClientDenied = await fetch(new URL(MARKDOWN_CLIENT_ROUTE, instance.originUrl));
    assert.equal(markdownClientDenied.status, 401);
    await markdownClientDenied.text();

    const mermaidDenied = await fetch(new URL(MERMAID_LIBRARY_ROUTE, instance.originUrl));
    assert.equal(mermaidDenied.status, 401);
    await mermaidDenied.text();

    const mermaidClientDenied = await fetch(new URL(MERMAID_CLIENT_ROUTE, instance.originUrl));
    assert.equal(mermaidClientDenied.status, 401);
    await mermaidClientDenied.text();

    const clientAllowed = await fetch(new URL("/__tunelito/client.js?tunelito_key=secret", instance.originUrl));
    assert.equal(clientAllowed.status, 200);
    assert.match(await clientAllowed.text(), /WebSocket/);

    const markdownClientAllowed = await fetch(new URL(`${MARKDOWN_CLIENT_ROUTE}?tunelito_key=secret`, instance.originUrl));
    assert.equal(markdownClientAllowed.status, 200);
    assert.match(await markdownClientAllowed.text(), /Document map/);

    const mermaidAllowed = await fetch(new URL(`${MERMAID_LIBRARY_ROUTE}?tunelito_key=secret`, instance.originUrl));
    assert.equal(mermaidAllowed.status, 200);
    assert.equal(mermaidAllowed.headers.get("x-content-type-options"), "nosniff");
    await mermaidAllowed.body.cancel();
  } finally {
    await instance.close();
  }
});

test("server assigns owner identity to direct local sessions and visitor identity to tunnel-shaped sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-owner-"));
  const htmlPath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  writeFileSync(htmlPath, "<!doctype html><html><body><main>Owner draft</main></body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "review-secret",
    ownerName: "Chekos",
    ownerSessionId: "owner-session",
  });

  const sockets = [];
  try {
    assert.match(instance.localUrl, /tunelito_key=review-secret/);
    assert.doesNotMatch(instance.localUrl, /tunelito_owner_key=/);

    const ownerHtmlResponse = await fetch(instance.localUrl);
    const ownerHtml = await ownerHtmlResponse.text();
    assert.match(ownerHtml, /data-default-author="Chekos"/);
    assert.match(ownerHtml, /data-viewer-role="owner"/);
    assert.match(ownerHtml, /data-owner-session="owner-session"/);

    const visitorHtml = await rawGet(instance.originUrl, "/?tunelito_key=review-secret", {
      host: "shared.trycloudflare.com",
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-proto": "https",
    });
    assert.equal(visitorHtml.statusCode, 200);
    assert.doesNotMatch(visitorHtml.body, /data-default-author="Chekos"/);
    assert.doesNotMatch(visitorHtml.body, /data-viewer-role="owner"/);

    const ownerSocketUrl = new URL("/__tunelito/ws", instance.localUrl);
    ownerSocketUrl.searchParams.set("tunelito_key", "review-secret");
    const owner = openJsonSocket(ownerSocketUrl);
    sockets.push(owner.socket);
    await waitFor(owner.socket, "open");
    await waitUntil(() => owner.messages.some((message) => message.type === "hello"));
    const ownerHello = owner.messages.find((message) => message.type === "hello");
    assert.equal(ownerHello.authorRole, "owner");
    assert.equal(ownerHello.defaultAuthor, "Chekos");
    assert.equal(ownerHello.ownerSession, "owner-session");

    owner.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Edited Owner",
        authorRole: "visitor",
        quote: "Owner draft",
        body: "Only the server can mark this as owner-authored.",
        textStart: 0,
        textEnd: 11,
      },
    }));

    await waitUntil(() => owner.messages.some((message) => message.type === "comment"));
    const ownerComment = owner.messages.find((message) => message.type === "comment").comment;
    assert.equal(ownerComment.author, "Edited Owner");
    assert.equal(ownerComment.authorRole, "owner");

    const visitorSocketUrl = new URL("/__tunelito/ws?tunelito_key=review-secret", instance.originUrl);
    const visitor = await openRawJsonSocket(visitorSocketUrl, {
      host: "shared.trycloudflare.com",
      headers: {
        "CF-Connecting-IP": "203.0.113.10",
        "X-Forwarded-For": "203.0.113.10",
        "X-Forwarded-Proto": "https",
      },
    });
    sockets.push(visitor.socket);
    await waitUntil(() => visitor.messages.some((message) => message.type === "hello"));
    const visitorHello = visitor.messages.find((message) => message.type === "hello");
    assert.equal(visitorHello.authorRole, "visitor");
    assert.equal(visitorHello.defaultAuthor, "");
    assert.equal(visitorHello.ownerSession, "");

    visitor.send({
      type: "create-comment",
      comment: {
        author: "Visitor",
        authorRole: "owner",
        quote: "Owner draft",
        body: "A visitor cannot self-mark owner.",
        textStart: 0,
        textEnd: 11,
      },
    });

    await waitUntil(() => visitor.messages.some((message) => message.type === "comment" && message.comment.body === "A visitor cannot self-mark owner."));
    const visitorComment = visitor.messages.find((message) => message.type === "comment" && message.comment.body === "A visitor cannot self-mark owner.").comment;
    assert.equal(visitorComment.authorRole, "visitor");

    const markdown = readFileSync(commentsPath, "utf8");
    assert.match(markdown, /## Edited Owner \(owner\) at /);
    assert.match(markdown, /author role: `owner`/);
    assert.match(markdown, /## Visitor at /);
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("local owner classification requires loopback access without forwarding headers", () => {
  assert.equal(isLocalOwnerRequest({
    headers: { host: "127.0.0.1:4317" },
    socket: { remoteAddress: "::ffff:127.0.0.1" },
  }), true);
  assert.equal(isLocalOwnerRequest({
    headers: { host: "localhost:4317" },
    socket: { remoteAddress: "::1" },
  }), true);
  assert.equal(isLocalOwnerRequest({
    headers: {
      host: "shared.trycloudflare.com",
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10",
    },
    socket: { remoteAddress: "127.0.0.1" },
  }), false);
  assert.equal(isLocalOwnerRequest({
    headers: {
      host: "127.0.0.1:4317",
      "x-forwarded-proto": "https",
    },
    socket: { remoteAddress: "127.0.0.1" },
  }), false);
  assert.equal(isLocalOwnerRequest({
    headers: { host: "127.0.0.1:4317" },
    socket: { remoteAddress: "192.168.1.22" },
  }), false);
});

test("server renames prior comments by reviewer identity instead of display name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-reviewer-rename-server-"));
  const htmlPath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  const sourceHtml = "<!doctype html><html><body><main>Rename draft</main></body></html>";
  writeFileSync(htmlPath, sourceHtml);

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
  });

  const sockets = [];
  try {
    const firstSocketUrl = new URL("/__tunelito/ws", instance.originUrl);
    firstSocketUrl.searchParams.set("tunelito_reviewer_id", "r_first");
    const first = await openRawJsonSocket(firstSocketUrl, {
      host: "shared.trycloudflare.com",
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });
    sockets.push(first.socket);
    await waitUntil(() => first.messages.some((message) => message.type === "hello"));
    const firstHello = first.messages.find((message) => message.type === "hello");
    assert.equal(firstHello.reviewerId, "r_first");

    const secondSocketUrl = new URL("/__tunelito/ws", instance.originUrl);
    secondSocketUrl.searchParams.set("tunelito_reviewer_id", "r_second");
    const second = await openRawJsonSocket(secondSocketUrl, {
      host: "shared.trycloudflare.com",
      headers: { "CF-Connecting-IP": "203.0.113.11" },
    });
    sockets.push(second.socket);
    await waitUntil(() => second.messages.some((message) => message.type === "hello"));

    first.send({
      type: "create-comment",
      comment: {
        author: "Clear Harbor",
        quote: "Rename draft",
        body: "First reviewer feedback.",
        reviewerId: "r_second",
        textStart: 0,
        textEnd: 12,
      },
    });
    await waitUntil(() => first.messages.some((message) => message.type === "comment" && message.comment.body === "First reviewer feedback."));
    const firstComment = first.messages.find((message) => message.type === "comment" && message.comment.body === "First reviewer feedback.").comment;
    assert.equal(firstComment.reviewerId, "r_first");

    second.send({
      type: "create-comment",
      comment: {
        author: "Clear Harbor",
        quote: "Rename draft",
        body: "Second reviewer feedback.",
        textStart: 0,
        textEnd: 12,
      },
    });
    await waitUntil(() => second.messages.some((message) => message.type === "comment" && message.comment.body === "Second reviewer feedback."));
    const secondComment = second.messages.find((message) => message.type === "comment" && message.comment.body === "Second reviewer feedback.").comment;
    assert.equal(secondComment.reviewerId, "r_second");

    first.send({
      type: "rename-reviewer",
      reviewerId: "r_second",
      author: "chekos",
    });

    await waitUntil(() => first.messages.some((message) => message.type === "reviewer-renamed" && message.author === "chekos"));
    await waitUntil(() => first.messages.some((message) => message.type === "comment-updated" && message.comment.id === firstComment.id));
    await waitUntil(() => second.messages.some((message) => message.type === "comment-updated" && message.comment.id === firstComment.id));
    const updated = first.messages.find((message) => message.type === "comment-updated" && message.comment.id === firstComment.id).comment;
    assert.equal(updated.author, "chekos");
    assert.equal(updated.reviewerId, "r_first");
    assert.equal(second.messages.some((message) => message.type === "comment-updated" && message.comment.id === secondComment.id), false);

    const markdown = readFileSync(commentsPath, "utf8");
    assert.match(markdown, /## chekos at /);
    assert.match(markdown, /First reviewer feedback\./);
    assert.match(markdown, /## Clear Harbor at /);
    assert.match(markdown, /Second reviewer feedback\./);
    assert.match(markdown, /reviewer: `r_first`/);
    assert.match(markdown, /reviewer: `r_second`/);

    const fresh = await openRawJsonSocket(firstSocketUrl, {
      host: "shared.trycloudflare.com",
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });
    sockets.push(fresh.socket);
    await waitUntil(() => fresh.messages.some((message) => message.type === "hello"));
    const restored = fresh.messages.find((message) => message.type === "hello").comments;
    assert.equal(restored.find((comment) => comment.id === firstComment.id).author, "chekos");
    assert.equal(restored.find((comment) => comment.id === secondComment.id).author, "Clear Harbor");
    assert.equal(readFileSync(htmlPath, "utf8"), sourceHtml);
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("server lets owner approve visitor comments for agent work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-owner-approval-"));
  const htmlPath = join(dir, "page.html");
  const commentsPath = join(dir, "page.comments.md");
  writeFileSync(htmlPath, "<!doctype html><html><body><main>Approval draft</main></body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "review-secret",
    ownerName: "Chekos",
  });

  const sockets = [];
  try {
    const ownerSocketUrl = new URL(instance.localUrl);
    ownerSocketUrl.pathname = "/__tunelito/ws";
    const owner = openJsonSocket(ownerSocketUrl);
    sockets.push(owner.socket);
    await waitFor(owner.socket, "open");
    await waitUntil(() => owner.messages.some((message) => message.type === "hello"));

    const visitorSocketUrl = new URL("/__tunelito/ws", instance.originUrl);
    visitorSocketUrl.searchParams.set("tunelito_key", "review-secret");
    const visitor = await openRawJsonSocket(visitorSocketUrl, {
      host: "shared.trycloudflare.com",
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });
    sockets.push(visitor.socket);
    await waitUntil(() => visitor.messages.some((message) => message.type === "hello"));

    visitor.send({
      type: "create-comment",
      comment: {
        author: "Visitor",
        quote: "Approval draft",
        body: "This should be owner-approved before the agent handles it.",
        textStart: 0,
        textEnd: 14,
        ownerApproval: {
          approvedBy: "Mallory",
          approvedAt: "2026-06-16T23:00:00.000Z",
          fingerprint: "forged",
        },
      },
    });

    await waitUntil(() => visitor.messages.some((message) => message.type === "comment"));
    const created = visitor.messages.find((message) => message.type === "comment").comment;
    assert.equal(created.authorRole, "visitor");
    assert.equal(created.ownerApproval, undefined);

    visitor.send({
      type: "approve-comment",
      id: created.id,
      approvedBy: "Visitor",
    });
    await waitUntil(() => visitor.messages.some((message) => message.type === "error" && /Only the owner/.test(message.message)));
    assert.equal(visitor.messages.some((message) => message.type === "comment-updated"), false);

    owner.socket.send(JSON.stringify({
      type: "approve-comment",
      id: created.id,
      approvedBy: "Lead Reviewer",
    }));

    await waitUntil(() => owner.messages.some((message) => message.type === "comment-updated"));
    await waitUntil(() => visitor.messages.some((message) => message.type === "comment-updated"));
    const ownerUpdate = owner.messages.find((message) => message.type === "comment-updated").comment;
    const visitorUpdate = visitor.messages.find((message) => message.type === "comment-updated").comment;
    assert.equal(ownerUpdate.id, created.id);
    assert.equal(visitorUpdate.ownerApproval.approvedBy, "Lead Reviewer");
    assert.match(visitorUpdate.ownerApproval.approvedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(visitorUpdate.ownerApproval.fingerprint, /^[a-f0-9]{64}$/);

    const markdown = readFileSync(commentsPath, "utf8");
    assert.match(markdown, /approved by owner: `Lead Reviewer`/);
    assert.match(markdown, /This should be owner-approved before the agent handles it\./);

    const fresh = openJsonSocket(visitorSocketUrl);
    sockets.push(fresh.socket);
    await waitFor(fresh.socket, "open");
    await waitUntil(() => fresh.messages.some((message) => message.type === "hello"));
    const restored = fresh.messages.find((message) => message.type === "hello").comments.find((comment) => comment.id === created.id);
    assert.equal(restored.ownerApproval.approvedBy, "Lead Reviewer");

    const clientScript = await fetch(new URL("/__tunelito/client.js?tunelito_key=review-secret", instance.originUrl)).then((res) => res.text());
    assert.match(clientScript, /Approve for agent/);
    assert.match(clientScript, /comment-updated/);
  } finally {
    for (const socket of sockets) socket.close();
    await instance.close();
  }
});

test("server rejects owner approval in live mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-live-owner-approval-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body><main>Live approval draft</main></body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "review-secret",
    ownerName: "Chekos",
    liveMode: true,
  });

  const ownerSocketUrl = new URL(instance.localUrl);
  ownerSocketUrl.pathname = "/__tunelito/ws";
  const owner = openJsonSocket(ownerSocketUrl);
  try {
    await waitFor(owner.socket, "open");
    await waitUntil(() => owner.messages.some((message) => message.type === "hello"));

    owner.socket.send(JSON.stringify({
      type: "approve-comment",
      id: "c_live",
      approvedBy: "Chekos",
    }));

    await waitUntil(() => owner.messages.some((message) => message.type === "error" && /persistent comments/.test(message.message)));
  } finally {
    owner.socket.close();
    await instance.close();
  }
});

test("server closes malformed WebSocket frames without exiting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-ws-malformed-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body>WebSocket still running</body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const socket = await rawWebSocket(instance.originUrl);
    socket.write(Buffer.from([
      0x81,
      0x7f,
      0x20,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]));
    await waitForNodeEvent(socket, "close");

    const response = await fetch(instance.localUrl);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /WebSocket still running/);
  } finally {
    await instance.close();
  }
});

test("server returns 405 for unsupported methods and preserves auth headers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-method-"));
  const htmlPath = join(dir, "page.html");
  writeFileSync(htmlPath, "<!doctype html><html><body>Method check</body></html>");

  const instance = await createTunelitoServer({
    filePath: htmlPath,
    host: "127.0.0.1",
    port: 0,
    accessKey: "secret",
  });

  try {
    const response = await fetch(instance.localUrl, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(await response.text(), "Method not allowed");
    assert.match(response.headers.get("set-cookie"), /tunelito_key=secret/);
  } finally {
    await instance.close();
  }
});

function openJsonSocket(url) {
  url.protocol = "ws:";
  const socket = new WebSocket(url);
  const messages = [];
  socket.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  return { socket, messages };
}

function atomicReplace(path, contents) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, contents);
  renameSync(tempPath, path);
}

function messageCount(messages, type) {
  return messages.filter((message) => message.type === type).length;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(target, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 1000);
    target.addEventListener(event, () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function waitUntil(predicate, timeout = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

function rawGet(baseUrl, path, headers = {}) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request({
      host: url.hostname,
      port: url.port,
      path,
      method: "GET",
      headers,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function openRawJsonSocket(baseUrl, { host, headers = {} } = {}) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname);
    const messages = [];
    let buffer = Buffer.alloc(0);
    let connected = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for raw WebSocket upgrade"));
    }, 1000);
    socket.close = () => socket.end();

    socket.on("connect", () => {
      socket.write([
        `GET ${url.pathname}${url.search} HTTP/1.1`,
        `Host: ${host || url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!connected) {
        const split = buffer.indexOf("\r\n\r\n");
        if (split === -1) return;
        const response = buffer.subarray(0, split).toString("utf8");
        if (!response.startsWith("HTTP/1.1 101")) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`Unexpected WebSocket upgrade response: ${response.split(/\r?\n/, 1)[0]}`));
          return;
        }
        connected = true;
        clearTimeout(timer);
        buffer = buffer.subarray(split + 4);
        resolve({
          socket,
          messages,
          send(data) {
            socket.write(encodeClientTextFrame(JSON.stringify(data)));
          },
        });
      }
      buffer = consumeServerTextFrames(buffer, messages);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function encodeClientTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % mask.length];
  return Buffer.concat([header, mask, masked]);
}

function consumeServerTextFrames(buffer, messages) {
  let remaining = buffer;
  while (remaining.length >= 2) {
    const opcode = remaining[0] & 0x0f;
    let length = remaining[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (remaining.length < 4) return remaining;
      length = remaining.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (remaining.length < 10) return remaining;
      const bigLength = remaining.readBigUInt64BE(2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Server WebSocket frame too large");
      length = Number(bigLength);
      offset = 10;
    }
    if (remaining.length < offset + length) return remaining;
    const payload = remaining.subarray(offset, offset + length);
    remaining = remaining.subarray(offset + length);
    if (opcode === 0x1) messages.push(JSON.parse(payload.toString("utf8")));
  }
  return remaining;
}

function rawWebSocket(baseUrl) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname);
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for WebSocket upgrade"));
    }, 1000);

    socket.setEncoding("binary");
    socket.on("connect", () => {
      socket.write([
        "GET /__tunelito/ws HTTP/1.1",
        `Host: ${url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\r\n\r\n")) {
        clearTimeout(timer);
        if (response.startsWith("HTTP/1.1 101")) resolve(socket);
        else {
          socket.destroy();
          reject(new Error(`Unexpected WebSocket upgrade response: ${response.split(/\r?\n/, 1)[0]}`));
        }
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForNodeEvent(target, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 1000);
    target.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
