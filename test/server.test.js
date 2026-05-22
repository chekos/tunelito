import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTunelitoServer } from "../src/server.js";
import { CLIENT_ROUTE } from "../src/inject.js";

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
