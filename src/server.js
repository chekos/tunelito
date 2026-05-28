import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync, watch } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCommentsPath, createCommentStore, createMemoryCommentStore, isSiteComment, renderCommentsMarkdown } from "./comments.js";
import { CLIENT_ROUTE, COMMENTS_ROUTE, WS_ROUTE, injectTunelitoClient } from "./inject.js";
import { contentTypeFor } from "./mime.js";
import { WebSocketHub } from "./ws.js";

const CLIENT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "client.js");
export const ACCESS_KEY_PARAM = "tunelito_key";
export const PAGE_PARAM = "tunelito_page";
const ACCESS_KEY_COOKIE = "tunelito_key";

export async function createTunelitoServer(options) {
  const targetPath = resolve(options.filePath);
  const targetStat = statSync(targetPath);
  const directoryMode = targetStat.isDirectory();
  const filePath = directoryMode ? null : targetPath;
  const rootDir = directoryMode ? targetPath : dirname(targetPath);
  const rootRealDir = realpathSync.native(rootDir);
  const sourceName = basename(targetPath);
  const liveMode = Boolean(options.liveMode || options.live);
  const commentsPath = liveMode ? null : resolve(options.commentsPath || defaultCommentsPath(targetPath));
  const comments = liveMode ? createMemoryCommentStore() : createCommentStore({ commentsPath, sourcePath: targetPath });
  const blockedPaths = [
    ...blockedCommentPaths(commentsPath),
    ...(options.blockedPaths || []).filter(Boolean).map((path) => resolve(path)),
  ];
  const events = new EventEmitter();
  const hub = new WebSocketHub();
  const peers = new Map();
  const accessKey = options.accessKey ? String(options.accessKey) : "";

  const server = createServer((req, res) => {
    handleRequest({
      req,
      res,
      filePath,
      targetPath,
      rootDir,
      rootRealDir,
      directoryMode,
      sourceName,
      comments,
      commentsPath,
      blockedPaths,
      liveMode,
      accessKey,
    });
  });

  server.on("upgrade", (req, socket) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    if (url.pathname !== WS_ROUTE) {
      socket.destroy();
      return;
    }
    if (!isTrustedOrigin(req)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (!authorizeRequest(req, url, accessKey).ok) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    req.tunelitoPagePath = normalizePagePath(url.searchParams.get(PAGE_PARAM));
    hub.handleUpgrade(req, socket);
  });

  function publishViewerCount() {
    events.emit("viewer-count", hub.size);
    hub.broadcast({ type: "viewer-count", count: hub.size });
  }

  function commentsForPage(pagePath) {
    if (!directoryMode) return comments.all();
    return comments.all().filter((comment) => isSiteComment(comment) || normalizePagePath(comment.pagePath) === pagePath);
  }

  function peerListForPage(pagePath, exceptId = "") {
    return Array.from(peers.values())
      .filter((candidate) => candidate.id !== exceptId)
      .filter((candidate) => !directoryMode || candidate.pagePath === pagePath);
  }

  function broadcastToPage(pagePath, data, { except = null } = {}) {
    if (!directoryMode) {
      hub.broadcast(data, { except });
      return;
    }

    for (const client of hub.clients) {
      if (client === except) continue;
      const peer = peers.get(client);
      if (peer?.pagePath === pagePath) client.send(data);
    }
  }

  function broadcastComment(comment) {
    const data = { type: "comment", comment };
    if (!directoryMode || isSiteComment(comment)) {
      hub.broadcast(data);
      return;
    }
    broadcastToPage(normalizePagePath(comment.pagePath), data);
  }

  hub.on("connection", (client, req) => {
    const pagePath = normalizePagePath(req?.tunelitoPagePath);
    const peer = {
      id: createPeerId(),
      connectedAt: new Date().toISOString(),
      pagePath,
    };
    peers.set(client, peer);
    client.send({
      type: "hello",
      mode: liveMode ? "live" : "persistent",
      liveMode,
      peerId: peer.id,
      pagePath,
      peers: peerListForPage(pagePath, peer.id),
      sourceName: directoryMode ? pagePath : sourceName,
      comments: commentsForPage(pagePath),
      commentsUrl: liveMode ? null : COMMENTS_ROUTE,
      viewerCount: hub.size,
    });
    if (liveMode) {
      broadcastToPage(pagePath, { type: "peer-joined", peer }, { except: client });
    }
    publishViewerCount();
  });

  hub.on("close", (client) => {
    const peer = peers.get(client);
    peers.delete(client);
    if (liveMode && peer) {
      broadcastToPage(peer.pagePath, { type: "peer-left", peerId: peer.id });
    }
    publishViewerCount();
  });
  hub.on("message", (client, message) => {
    const peer = peers.get(client);
    let event;
    try {
      event = JSON.parse(message);
    } catch {
      client.send({ type: "error", message: "Invalid JSON message" });
      return;
    }

    if (event.type === "create-comment") {
      try {
        const comment = comments.add({ ...(event.comment || {}), pagePath: peer?.pagePath || normalizePagePath(event.comment?.pagePath) });
        events.emit("comment", comment);
        broadcastComment(comment);
      } catch (error) {
        client.send({ type: "error", message: error.message });
      }
    } else if (liveMode && event.type === "signal") {
      const target = findPeerClient(peers, event.to, peer?.pagePath);
      if (target && peer) {
        target.send({ type: "signal", from: peer.id, signal: event.signal || {} });
      }
    } else if (liveMode && event.type === "live-event") {
      if (peer && event.event && typeof event.event === "object") {
        broadcastToPage(peer.pagePath, { type: "live-event", from: peer.id, event: event.event }, { except: client });
      }
    }
  });

  let watchTimer = null;
  const watcher = createWatcher(directoryMode ? rootDir : filePath, directoryMode, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      events.emit("document-changed");
      hub.broadcast({ type: "document-changed" });
    }, 120);
  });

  const host = options.host || "127.0.0.1";
  const requestedPort = options.port ?? 4317;
  const { port } = await listenOnFirstAvailable(server, host, requestedPort);
  const originUrl = `http://${host}:${port}/`;
  const localUrl = withAccessKey(originUrl, accessKey);

  return {
    server,
    events,
    hub,
    commentsPath,
    filePath: targetPath,
    directoryMode,
    liveMode,
    originUrl,
    localUrl,
    async close() {
      clearTimeout(watchTimer);
      watcher.close();
      hub.close();
      const closing = new Promise((resolveClose) => server.close(resolveClose));
      server.closeAllConnections?.();
      await closing;
    },
  };
}

function handleRequest({ req, res, filePath, targetPath, rootDir, rootRealDir, directoryMode, sourceName, comments, commentsPath, blockedPaths, liveMode, accessKey }) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }

  const auth = authorizeRequest(req, url, accessKey);
  if (!auth.ok) {
    sendText(res, 401, "Tunelito review link is missing or invalid.", "text/plain; charset=utf-8", req.method);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed", "text/plain; charset=utf-8", req.method, auth.headers);
    return;
  }

  if (pathname === CLIENT_ROUTE) {
    sendFile(res, CLIENT_PATH, "text/javascript; charset=utf-8", req.method, auth.headers);
    return;
  }

  if (pathname === COMMENTS_ROUTE) {
    if (liveMode) {
      sendText(res, 404, "Tunelito live mode comments are ephemeral and are not written to markdown.", "text/plain; charset=utf-8", req.method, auth.headers);
      return;
    }
    sendText(res, 200, renderCommentsMarkdown({ comments: comments.all(), sourcePath: targetPath }), "text/markdown; charset=utf-8", req.method, auth.headers);
    return;
  }

  if (directoryMode) {
    const asset = resolveDirectoryRequest(rootDir, rootRealDir, pathname, { blockedPaths });
    if (!asset) {
      sendText(res, 404, "Not found", "text/plain; charset=utf-8", req.method, auth.headers);
      return;
    }

    if (asset.redirectPath) {
      sendRedirect(res, asset.redirectPath, auth.headers);
      return;
    }

    if (asset.generatedHtml) {
      sendText(res, 200, injectTunelitoClient(asset.generatedHtml, { sourceName: asset.sourceName, liveMode }), "text/html; charset=utf-8", req.method, auth.headers);
      return;
    }

    if (isHtmlPath(asset.path)) {
      const html = readFileSync(asset.realPath, "utf8");
      sendText(res, 200, injectTunelitoClient(html, { sourceName: relativeSourceName(rootDir, asset.path), liveMode }), "text/html; charset=utf-8", req.method, auth.headers);
      return;
    }

    sendFile(res, asset.realPath, contentTypeFor(asset.path), req.method, auth.headers);
    return;
  }

  if (pathname === "/" || pathname === `/${sourceName}`) {
    const html = readFileSync(filePath, "utf8");
    sendText(res, 200, injectTunelitoClient(html, { sourceName, liveMode }), "text/html; charset=utf-8", req.method, auth.headers);
    return;
  }

  const asset = resolveServedAsset(rootDir, rootRealDir, pathname, { blockedPaths });
  if (!asset) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8", req.method, auth.headers);
    return;
  }

  sendFile(res, asset.realPath, contentTypeFor(asset.path), req.method, auth.headers);
}

function resolveDirectoryRequest(rootDir, rootRealDir, pathname, options = {}) {
  const assetPathname = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const asset = resolveServedAsset(rootDir, rootRealDir, assetPathname, options);
  if (asset) return asset;

  const directory = resolveServedDirectory(rootDir, rootRealDir, pathname);
  if (!directory) return null;

  if (pathname !== "/" && !pathname.endsWith("/")) {
    return { redirectPath: `${pathname}/` };
  }

  const directoryPathname = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const index = resolveServedAsset(rootDir, rootRealDir, `${directoryPathname}index.html`, options);
  if (index) return index;

  return {
    generatedHtml: renderDirectoryIndex({ directoryPath: directory.realPath, pagePath: directoryPathname, blockedPaths: options.blockedPaths || [] }),
    path: directory.path,
    realPath: directory.realPath,
    sourceName: `${relativeSourceName(rootDir, directory.path) || basename(rootDir)} index`,
  };
}

function resolveServedAsset(rootDir, rootRealDir, pathname, { blockedPaths = [] } = {}) {
  if (hasHiddenPathSegment(pathname)) return null;
  const assetPath = resolve(rootDir, `.${pathname}`);
  try {
    const assetRealPath = realpathSync.native(assetPath);
    if (
      !isInside(rootRealDir, assetRealPath) ||
      hasHiddenRealPathSegment(rootRealDir, assetRealPath) ||
      isBlockedPath(assetRealPath, blockedPaths) ||
      !statSync(assetRealPath).isFile()
    ) {
      return null;
    }

    return { path: assetPath, realPath: assetRealPath };
  } catch {
    return null;
  }
}

function resolveServedDirectory(rootDir, rootRealDir, pathname) {
  if (hasHiddenPathSegment(pathname)) return null;
  const directoryPath = resolve(rootDir, `.${pathname}`);
  try {
    const directoryRealPath = realpathSync.native(directoryPath);
    if (!isInside(rootRealDir, directoryRealPath) || hasHiddenRealPathSegment(rootRealDir, directoryRealPath) || !statSync(directoryRealPath).isDirectory()) {
      return null;
    }

    return { path: directoryPath, realPath: directoryRealPath };
  } catch {
    return null;
  }
}

function renderDirectoryIndex({ directoryPath, pagePath, blockedPaths = [] }) {
  const entries = readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.isDirectory() || isHtmlPath(entry.name))
    .filter((entry) => !isBlockedDirectoryEntry(directoryPath, entry.name, blockedPaths))
    .sort((left, right) => left.name.localeCompare(right.name));
  const basePath = pagePath.endsWith("/") ? pagePath : `${pagePath}/`;
  const links = entries.map((entry) => {
    const href = `${basePath}${encodePathSegment(entry.name)}${entry.isDirectory() ? "/" : ""}`.replace(/\/{2,}/g, "/");
    const label = `${entry.name}${entry.isDirectory() ? "/" : ""}`;
    return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
  });

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '  <meta charset="utf-8">',
    `  <title>Tunelito folder: ${escapeHtml(pagePath)}</title>`,
    "</head>",
    "<body>",
    `  <h1>${escapeHtml(pagePath)}</h1>`,
    links.length ? `  <ul>\n    ${links.join("\n    ")}\n  </ul>` : "  <p>No HTML files found in this folder.</p>",
    "</body>",
    "</html>",
  ].join("\n");
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8", method = "GET", extraHeaders = {}) {
  const buffer = Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buffer.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders,
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(buffer);
}

function sendRedirect(res, location, extraHeaders = {}) {
  res.writeHead(302, {
    location,
    "content-length": 0,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders,
  });
  res.end();
}

function sendFile(res, path, contentType, method, extraHeaders = {}) {
  const stat = statSync(path);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders,
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}

function authorizeRequest(req, url, accessKey) {
  if (!accessKey) return { ok: true, headers: {} };

  const queryKey = url.searchParams.get(ACCESS_KEY_PARAM);
  if (sameSecret(queryKey, accessKey)) {
    return {
      ok: true,
      headers: {
        "set-cookie": accessCookie(accessKey, req),
      },
    };
  }

  if (sameSecret(readCookie(req.headers.cookie, ACCESS_KEY_COOKIE), accessKey)) {
    return { ok: true, headers: {} };
  }

  return { ok: false, headers: {} };
}

function accessCookie(accessKey, req) {
  const parts = [
    `${ACCESS_KEY_COOKIE}=${encodeURIComponent(accessKey)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=86400",
  ];
  if (String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return "";
  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

function sameSecret(input, expected) {
  if (typeof input !== "string" || input.length === 0) return false;
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isTrustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function createPeerId() {
  return `p_${randomBytes(9).toString("base64url")}`;
}

function findPeerClient(peers, peerId, pagePath = "") {
  for (const [client, peer] of peers) {
    if (peer.id === peerId && (!pagePath || peer.pagePath === pagePath)) return client;
  }
  return null;
}

function createWatcher(path, recursive, onChange) {
  const handleChange = (_eventType, filename) => {
    if (isIgnoredWatchFilename(filename)) return;
    onChange();
  };
  try {
    return watch(path, { persistent: true, recursive }, handleChange);
  } catch (error) {
    if (!recursive) throw error;
    return watch(path, { persistent: true }, handleChange);
  }
}

export function isIgnoredWatchFilename(filename) {
  if (!filename) return false;
  return String(filename).split(/[\\/]+/).includes(".tunelito");
}

function isHtmlPath(pathname) {
  return [".html", ".htm"].includes(extname(pathname).toLowerCase());
}

function relativeSourceName(rootDir, filePath) {
  const relativePath = relative(rootDir, filePath).split(sep).join("/");
  return relativePath === "" ? basename(filePath) : relativePath;
}

function encodePathSegment(segment) {
  return segment.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizePagePath(value) {
  const raw = String(value || "/").slice(0, 1000);
  const withoutQuery = raw.split(/[?#]/, 1)[0] || "/";
  const prefixed = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return prefixed.replace(/\/{2,}/g, "/");
}

function hasHiddenPathSegment(pathname) {
  return String(pathname)
    .split("/")
    .some((segment) => segment.startsWith("."));
}

function hasHiddenRealPathSegment(rootRealDir, realPath) {
  return relative(rootRealDir, realPath)
    .split(sep)
    .some((segment) => segment.startsWith("."));
}

function isBlockedDirectoryEntry(directoryPath, entryName, blockedPaths) {
  const entryPath = resolve(directoryPath, entryName);
  try {
    return isBlockedPath(realpathSync.native(entryPath), blockedPaths);
  } catch {
    return isBlockedPath(entryPath, blockedPaths);
  }
}

function blockedCommentPaths(commentsPath) {
  return commentsPath ? [commentsPath, `${commentsPath}.tmp`] : [];
}

function isBlockedPath(realPath, blockedPaths) {
  for (const blockedPath of blockedPaths) {
    if (!blockedPath) continue;
    let blockedRealPath;
    try {
      blockedRealPath = existsSync(blockedPath) ? realpathSync.native(blockedPath) : resolve(blockedPath);
    } catch {
      blockedRealPath = resolve(blockedPath);
    }
    if (resolve(realPath) === resolve(blockedRealPath)) return true;
  }
  return false;
}

function withAccessKey(url, accessKey) {
  const parsed = new URL(url);
  if (accessKey) parsed.searchParams.set(ACCESS_KEY_PARAM, accessKey);
  return parsed.toString();
}

function isInside(root, candidate) {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + sep);
}

async function listenOnFirstAvailable(server, host, startPort) {
  let port = startPort;
  while (port < startPort + 100) {
    try {
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => {
          server.off("listening", onListening);
          rejectListen(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolveListen();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      const address = server.address();
      return { port: typeof address === "object" && address ? address.port : port };
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      port += 1;
    }
  }
  throw new Error(`No open port found from ${startPort} to ${port - 1}`);
}
