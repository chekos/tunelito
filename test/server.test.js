import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { connect } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OWNER_KEY_PARAM, createTunelitoServer, isIgnoredWatchFilename } from "../src/server.js";
import { AGENT_STATUS_ROUTE, CLIENT_ROUTE } from "../src/inject.js";
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
  writeFileSync(visibleAgentStatePath, "{}");
  writeFileSync(visibleAgentLogPath, "agent log");
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
    blockedPaths: [visibleAgentStatePath, visibleAgentLogPath],
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

    if (linkedEnvPath) {
      const linkedEnvFile = await fetch(new URL("/linked-env", instance.localUrl));
      assert.equal(linkedEnvFile.status, 404);
    }
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
    assert.match(clientScript, /width: 44px;\s+height: 44px;/);
    assert.doesNotMatch(clientScript, /Comments <span class="count"/);
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

test("directory mode renders a basic HTML index when no index file exists", async () => {
  const siteDir = mkdtempSync(join(tmpdir(), "tunelito-directory-index-"));
  const commentsPath = join(siteDir, "comments.html");
  writeFileSync(join(siteDir, "page.html"), "<!doctype html><html><body>Listed page</body></html>");
  writeFileSync(commentsPath, "private comments");
  writeFileSync(`${commentsPath}.tmp`, "private comments temp");
  writeFileSync(join(siteDir, "notes.txt"), "not listed");

  const instance = await createTunelitoServer({
    filePath: siteDir,
    commentsPath,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const html = await fetch(instance.localUrl).then((res) => res.text());
    assert.match(html, /page\.html/);
    assert.doesNotMatch(html, /notes\.txt/);
    assert.doesNotMatch(html, /comments\.html/);
    assert.match(html, new RegExp(CLIENT_ROUTE));

    const staticComments = await fetch(new URL("/comments.html", instance.localUrl));
    assert.equal(staticComments.status, 404);

    const tempComments = await fetch(new URL("/comments.html.tmp", instance.localUrl));
    assert.equal(tempComments.status, 404);
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

    const badCookie = await fetch(instance.originUrl, { headers: { cookie: "tunelito_key=%" } });
    assert.equal(badCookie.status, 401);
    await badCookie.text();

    const allowed = await fetch(instance.localUrl);
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /Private draft/);
    assert.match(allowed.headers.get("set-cookie"), /tunelito_key=secret/);

    const clientDenied = await fetch(new URL("/__tunelito/client.js", instance.originUrl));
    assert.equal(clientDenied.status, 401);
    await clientDenied.text();

    const clientAllowed = await fetch(new URL("/__tunelito/client.js?tunelito_key=secret", instance.originUrl));
    assert.equal(clientAllowed.status, 200);
    assert.match(await clientAllowed.text(), /WebSocket/);
  } finally {
    await instance.close();
  }
});

test("server assigns owner identity only to owner-key sessions", async () => {
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
    ownerKey: "owner-secret",
    ownerSessionId: "owner-session",
  });

  const sockets = [];
  try {
    assert.match(instance.localUrl, /tunelito_key=review-secret/);
    assert.match(instance.localUrl, new RegExp(`${OWNER_KEY_PARAM}=owner-secret`));

    const ownerHtmlResponse = await fetch(instance.localUrl);
    const ownerHtml = await ownerHtmlResponse.text();
    assert.match(ownerHtml, /data-default-author="Chekos"/);
    assert.match(ownerHtml, /data-viewer-role="owner"/);
    assert.match(ownerHtml, /data-owner-session="owner-session"/);
    assert.match(ownerHtmlResponse.headers.get("set-cookie"), /tunelito_owner_key=owner-secret/);

    const visitorUrl = new URL(instance.originUrl);
    visitorUrl.searchParams.set("tunelito_key", "review-secret");
    const visitorHtml = await fetch(visitorUrl).then((res) => res.text());
    assert.doesNotMatch(visitorHtml, /data-default-author="Chekos"/);
    assert.doesNotMatch(visitorHtml, /data-viewer-role="owner"/);

    const ownerSocketUrl = new URL("/__tunelito/ws", instance.localUrl);
    ownerSocketUrl.searchParams.set("tunelito_key", "review-secret");
    ownerSocketUrl.searchParams.set(OWNER_KEY_PARAM, "owner-secret");
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

    const visitorSocketUrl = new URL("/__tunelito/ws", instance.originUrl);
    visitorSocketUrl.searchParams.set("tunelito_key", "review-secret");
    const visitor = openJsonSocket(visitorSocketUrl);
    sockets.push(visitor.socket);
    await waitFor(visitor.socket, "open");
    await waitUntil(() => visitor.messages.some((message) => message.type === "hello"));
    const visitorHello = visitor.messages.find((message) => message.type === "hello");
    assert.equal(visitorHello.authorRole, "visitor");
    assert.equal(visitorHello.defaultAuthor, "");
    assert.equal(visitorHello.ownerSession, "");

    visitor.socket.send(JSON.stringify({
      type: "create-comment",
      comment: {
        author: "Visitor",
        authorRole: "owner",
        quote: "Owner draft",
        body: "A visitor cannot self-mark owner.",
        textStart: 0,
        textEnd: 11,
      },
    }));

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

function rawGet(baseUrl, path) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request({
      host: url.hostname,
      port: url.port,
      path,
      method: "GET",
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
