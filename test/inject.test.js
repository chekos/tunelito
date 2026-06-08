import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_ROUTE, injectTunelitoClient, stripMetaCsp } from "../src/inject.js";

test("injectTunelitoClient injects before the closing body", () => {
  const html = "<!doctype html><html><body><main>Hello</main></body></html>";
  const injected = injectTunelitoClient(html, { sourceName: "demo.html" });

  assert.match(injected, new RegExp(`<script src="${CLIENT_ROUTE}"`));
  assert.ok(injected.indexOf(CLIENT_ROUTE) < injected.indexOf("</body>"));
  assert.match(injected, /data-source-name="demo\.html"/);
});

test("injectTunelitoClient marks live-mode responses", () => {
  const html = "<!doctype html><html><body><main>Hello</main></body></html>";
  const injected = injectTunelitoClient(html, { sourceName: "demo.html", liveMode: true });

  assert.match(injected, /data-live-mode="true"/);
});

test("injectTunelitoClient can seed an owner identity", () => {
  const html = "<!doctype html><html><body><main>Hello</main></body></html>";
  const injected = injectTunelitoClient(html, {
    sourceName: "demo.html",
    defaultAuthor: "Chekos & Co",
    viewerRole: "owner",
    ownerSession: "owner-session",
  });

  assert.match(injected, /data-default-author="Chekos &amp; Co"/);
  assert.match(injected, /data-viewer-role="owner"/);
  assert.match(injected, /data-owner-session="owner-session"/);
});

test("injectTunelitoClient strips CSP meta tags and avoids duplicate injection", () => {
  const html = `
    <html>
      <head><meta http-equiv="Content-Security-Policy" content="script-src 'none'"></head>
      <body><p>Hi</p></body>
    </html>
  `;
  const injected = injectTunelitoClient(html, { sourceName: "demo.html" });
  const reinjected = injectTunelitoClient(injected, { sourceName: "demo.html" });

  assert.doesNotMatch(injected, /Content-Security-Policy/i);
  assert.equal(reinjected.match(new RegExp(CLIENT_ROUTE, "g")).length, 1);
});

test("injectTunelitoClient ignores literal route text when checking for duplicates", () => {
  const html = `<!doctype html><html><body><p>Literal ${CLIENT_ROUTE} text only.</p></body></html>`;
  const injected = injectTunelitoClient(html, { sourceName: "demo.html" });

  assert.match(injected, new RegExp(`<script src="${CLIENT_ROUTE.replace(".", "\\.")}"`));
  assert.equal((injected.match(/<script\b/g) || []).length, 1);
});

test("injectTunelitoClient recognizes unquoted existing client script sources", () => {
  const html = `<!doctype html><html><body><script src=${CLIENT_ROUTE}></script><main>Hello</main></body></html>`;
  const injected = injectTunelitoClient(html, { sourceName: "demo.html" });

  assert.equal((injected.match(new RegExp(CLIENT_ROUTE, "g")) || []).length, 1);
});

test("stripMetaCsp removes case-insensitive CSP meta tags", () => {
  const stripped = stripMetaCsp(`<meta HTTP-EQUIV='content-security-policy' content="default-src 'self'"><p>x</p>`);
  assert.equal(stripped, "<p>x</p>");
});
