import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync, watch } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentStatusSnapshot, defaultAgentLogPath, fingerprintComment, loadAgentState } from "./agent-worker.js";
import { defaultCommentsPath, createCommentStore, createMemoryCommentStore, isSiteComment, normalizeReviewerId, renderCommentsMarkdown } from "./comments.js";
import { AGENT_STATUS_ROUTE, CLIENT_ROUTE, COMMENTS_ROUTE, REVIEW_EVENTS_ROUTE, WS_ROUTE, injectTunelitoClient } from "./inject.js";
import { isMarkdownPath, normalizeMarkdownCssHref, renderMarkdownDocument } from "./markdown.js";
import { contentTypeFor } from "./mime.js";
import { WebSocketHub } from "./ws.js";

const CLIENT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "client.js");
export const ACCESS_KEY_PARAM = "tunelito_key";
export const PAGE_PARAM = "tunelito_page";
const REVIEWER_ID_PARAM = "tunelito_reviewer_id";
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
  const reviewEvents = createReviewEventQueue({ now: typeof options.now === "function" ? options.now : () => new Date() });
  const agentStatePath = options.agentStatePath && !liveMode ? resolve(options.agentStatePath) : "";
  const blockedPaths = [
    ...blockedCommentPaths(commentsPath),
    ...blockedAgentPaths(agentStatePath),
    ...(options.blockedPaths || []).filter(Boolean).map((path) => resolve(path)),
  ];
  const events = new EventEmitter();
  const hub = new WebSocketHub();
  const peers = new Map();
  const accessKey = options.accessKey ? String(options.accessKey) : "";
  const ownerName = cleanOwnerName(options.ownerName);
  const ownerSessionId = String(options.ownerSessionId || randomBytes(9).toString("base64url"));
  const markdownCssHref = normalizeMarkdownCssHref(options.markdownCssHref || "");

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
      reviewEvents,
      agentStatePath,
      blockedPaths,
      liveMode,
      accessKey,
      ownerName,
      ownerSessionId,
      markdownCssHref,
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
    req.tunelitoAuthorRole = isLocalOwnerRequest(req) ? "owner" : "visitor";
    req.tunelitoPagePath = normalizePagePath(url.searchParams.get(PAGE_PARAM));
    req.tunelitoReviewerId = req.tunelitoAuthorRole === "owner"
      ? ownerSessionId
      : normalizeReviewerId(url.searchParams.get(REVIEWER_ID_PARAM));
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

  function broadcastCommentUpdate(comment) {
    const data = { type: "comment-updated", comment };
    if (!directoryMode || isSiteComment(comment)) {
      hub.broadcast(data);
      return;
    }
    broadcastToPage(normalizePagePath(comment.pagePath), data);
  }

  hub.on("connection", (client, req) => {
    const pagePath = normalizePagePath(req?.tunelitoPagePath);
    const visibleComments = commentsForPage(pagePath);
    const peerId = createPeerId();
    const peer = {
      id: peerId,
      connectedAt: new Date().toISOString(),
      pagePath,
      authorRole: req?.tunelitoAuthorRole === "owner" ? "owner" : "visitor",
      reviewerId: normalizeReviewerId(req?.tunelitoReviewerId) || reviewerIdFromPeerId(peerId),
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
      comments: visibleComments,
      commentsUrl: liveMode ? null : COMMENTS_ROUTE,
      agentStatusUrl: agentStatePath ? AGENT_STATUS_ROUTE : null,
      agentStatuses: agentStatePath ? agentStatusSnapshot({ agentStatePath, comments: visibleComments }) : null,
      viewerCount: hub.size,
      authorRole: peer.authorRole,
      defaultAuthor: peer.authorRole === "owner" ? ownerName : "",
      ownerSession: peer.authorRole === "owner" ? ownerSessionId : "",
      reviewerId: peer.reviewerId,
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
        const input = {
          ...(event.comment || {}),
          ownerApproval: null,
          authorRole: peer?.authorRole === "owner" ? "owner" : "visitor",
          reviewerId: peer?.reviewerId || normalizeReviewerId(event.comment?.reviewerId),
          pagePath: peer?.pagePath || normalizePagePath(event.comment?.pagePath),
        };
        if (input.authorRole === "owner" && ownerName && !String(input.author || "").trim()) {
          input.author = ownerName;
        }
        const comment = comments.add(input);
        events.emit("comment", comment);
        broadcastComment(comment);
      } catch (error) {
        client.send({ type: "error", message: error.message });
      }
    } else if (event.type === "rename-reviewer") {
      try {
        if (!peer) throw new Error("Reviewer connection is unavailable.");
        const author = cleanOwnerName(event.author || event.name);
        if (!author) throw new Error("Reviewer name is required.");
        const changed = comments.renameReviewer({
          reviewerId: peer.reviewerId,
          authorRole: peer.authorRole,
          author,
        });
        client.send({
          type: "reviewer-renamed",
          reviewerId: peer.reviewerId,
          authorRole: peer.authorRole,
          author,
          changedIds: changed.map((comment) => comment.id),
        });
        for (const comment of changed) {
          events.emit("comment-updated", comment);
          broadcastCommentUpdate(comment);
        }
      } catch (error) {
        client.send({ type: "error", message: error.message });
      }
    } else if (event.type === "approve-comment") {
      try {
        if (liveMode) throw new Error("Owner approval requires persistent comments.");
        if (peer?.authorRole !== "owner") throw new Error("Only the owner can approve a comment for agent work.");
        const targetId = cleanCommentId(event.id);
        if (!targetId) throw new Error("Approval requires a comment id.");
        const existing = comments.all().find((comment) => comment.id === targetId);
        if (!existing) throw new Error("Comment not found.");
        if (existing.authorRole === "owner") throw new Error("Owner-authored comments are already owner-approved.");
        const approvedBy = cleanOwnerName(event.approvedBy || ownerName || "Owner") || "Owner";
        const approved = comments.update(targetId, (comment) => ({
          ...comment,
          ownerApproval: {
            approvedBy,
            approvedAt: new Date().toISOString(),
            fingerprint: fingerprintComment(existing),
          },
        }));
        events.emit("comment-updated", approved);
        broadcastCommentUpdate(approved);
      } catch (error) {
        client.send({ type: "error", message: error.message });
      }
    } else if (event.type === "review-completed") {
      try {
        const completed = reviewEvents.push({
          targetPath,
          commentsPath,
          directoryMode,
          liveMode,
          comments: comments.all(),
          overallComment: event.overallComment,
          peer,
        });
        events.emit("review-completed", completed);
        hub.broadcast({ type: "review-completed", event: completed });
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
  let sourceFileSignature = directoryMode ? null : fileSignature(filePath);
  const watcher = createWatcher({
    path: rootDir,
    recursive: directoryMode,
    filename: directoryMode ? "" : basename(filePath),
    onChange: () => {
      if (!directoryMode) {
        const nextSignature = fileSignature(filePath);
        if (nextSignature === sourceFileSignature) return;
        sourceFileSignature = nextSignature;
      }
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        events.emit("document-changed");
        hub.broadcast({ type: "document-changed" });
      }, 120);
    },
  });

  const host = options.host || "127.0.0.1";
  const requestedPort = options.port ?? 4317;
  const { port } = await listenOnFirstAvailable(server, host, requestedPort);
  const originUrl = `http://${host}:${port}/`;
  const localUrl = withSessionKeys(originUrl, { accessKey });

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
    reviewEventsUrl: new URL(REVIEW_EVENTS_ROUTE, localUrl).toString(),
    ownerName,
    ownerSessionId,
    async close() {
      clearTimeout(watchTimer);
      reviewEvents.close();
      watcher.close();
      hub.close();
      const closing = new Promise((resolveClose) => server.close(resolveClose));
      server.closeAllConnections?.();
      await closing;
    },
  };
}

function handleRequest({ req, res, filePath, targetPath, rootDir, rootRealDir, directoryMode, sourceName, comments, commentsPath, reviewEvents, agentStatePath, blockedPaths, liveMode, accessKey, ownerName, ownerSessionId, markdownCssHref }) {
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
  const owner = isLocalOwnerRequest(req);
  const responseHeaders = auth.headers;
  const injectOptions = {
    liveMode,
    defaultAuthor: owner ? ownerName : "",
    viewerRole: owner ? "owner" : "",
    ownerSession: owner ? ownerSessionId : "",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed", "text/plain; charset=utf-8", req.method, responseHeaders);
    return;
  }

  if (pathname === CLIENT_ROUTE) {
    sendFile(res, CLIENT_PATH, "text/javascript; charset=utf-8", req.method, responseHeaders);
    return;
  }

  if (pathname === COMMENTS_ROUTE) {
    if (liveMode) {
      sendText(res, 404, "Tunelito live mode comments are ephemeral and are not written to markdown.", "text/plain; charset=utf-8", req.method, responseHeaders);
      return;
    }
    sendText(res, 200, renderCommentsMarkdown({ comments: comments.all(), sourcePath: targetPath }), "text/markdown; charset=utf-8", req.method, responseHeaders);
    return;
  }

  if (pathname === AGENT_STATUS_ROUTE) {
    if (liveMode || !agentStatePath) {
      sendText(res, 404, "Tunelito agent status is unavailable for this session.", "text/plain; charset=utf-8", req.method, responseHeaders);
      return;
    }
    const pagePath = normalizePagePath(url.searchParams.get(PAGE_PARAM));
    const visibleComments = directoryMode
      ? comments.all().filter((comment) => isSiteComment(comment) || normalizePagePath(comment.pagePath) === pagePath)
      : comments.all();
    sendJson(res, 200, agentStatusSnapshot({ agentStatePath, comments: visibleComments }), req.method, responseHeaders);
    return;
  }

  if (pathname === REVIEW_EVENTS_ROUTE) {
    if (req.method !== "GET") {
      sendText(res, 405, "Method not allowed", "text/plain; charset=utf-8", req.method, responseHeaders);
      return;
    }
    handleReviewEventsRequest({ res, url, reviewEvents, responseHeaders });
    return;
  }

  if (directoryMode) {
    const asset = resolveDirectoryRequest(rootDir, rootRealDir, pathname, { blockedPaths });
    if (!asset) {
      sendText(res, 404, "Not found", "text/plain; charset=utf-8", req.method, responseHeaders);
      return;
    }

    if (asset.redirectPath) {
      sendRedirect(res, asset.redirectPath, responseHeaders);
      return;
    }

    if (asset.generatedHtml) {
      sendText(res, 200, injectTunelitoClient(asset.generatedHtml, { sourceName: asset.sourceName, ...injectOptions }), "text/html; charset=utf-8", req.method, responseHeaders);
      return;
    }

    if (isHtmlPath(asset.path)) {
      const html = readFileSync(asset.realPath, "utf8");
      sendText(res, 200, injectTunelitoClient(html, { sourceName: relativeSourceName(rootDir, asset.path), ...injectOptions }), "text/html; charset=utf-8", req.method, responseHeaders);
      return;
    }

    if (isMarkdownPath(asset.path)) {
      const sourceName = relativeSourceName(rootDir, asset.path);
      const html = renderMarkdownFile({
        path: asset.realPath,
        sourceName,
        markdownCssHref,
      });
      sendText(res, 200, injectTunelitoClient(html, { sourceName, ...injectOptions }), "text/html; charset=utf-8", req.method, responseHeaders);
      return;
    }

    sendFile(res, asset.realPath, contentTypeFor(asset.path), req.method, responseHeaders);
    return;
  }

  if (pathname === "/" || pathname === `/${sourceName}`) {
    const html = isMarkdownPath(filePath)
      ? renderMarkdownFile({ path: filePath, sourceName, markdownCssHref })
      : readFileSync(filePath, "utf8");
    sendText(res, 200, injectTunelitoClient(html, { sourceName, ...injectOptions }), "text/html; charset=utf-8", req.method, responseHeaders);
    return;
  }

  const asset = resolveServedAsset(rootDir, rootRealDir, pathname, { blockedPaths });
  if (!asset) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8", req.method, responseHeaders);
    return;
  }

  sendFile(res, asset.realPath, contentTypeFor(asset.path), req.method, responseHeaders);
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
  const markdownIndex = resolveServedAsset(rootDir, rootRealDir, `${directoryPathname}index.md`, options);
  if (markdownIndex) return markdownIndex;

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
    .filter((entry) => entry.isDirectory() || isHtmlPath(entry.name) || isMarkdownPath(entry.name))
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
    links.length ? `  <ul>\n    ${links.join("\n    ")}\n  </ul>` : "  <p>No HTML or Markdown files found in this folder.</p>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderMarkdownFile({ path, sourceName, markdownCssHref }) {
  return renderMarkdownDocument({
    markdownSource: readFileSync(path, "utf8"),
    sourceName,
    cssHref: markdownCssHref,
  });
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

function sendJson(res, status, payload, method = "GET", extraHeaders = {}) {
  sendText(res, status, `${JSON.stringify(payload)}\n`, "application/json; charset=utf-8", method, extraHeaders);
}

function handleReviewEventsRequest({ res, url, reviewEvents, responseHeaders }) {
  let waitOptions;
  try {
    waitOptions = parseReviewWaitOptions(url, reviewEvents);
  } catch (error) {
    sendJson(res, 400, { type: "review.wait_error", message: error.message }, "GET", responseHeaders);
    return;
  }

  reviewEvents.wait(waitOptions).then((result) => {
    if (result.timeout) {
      sendJson(res, 408, {
        type: "review.timeout",
        after: waitOptions.after,
        timeoutSeconds: waitOptions.timeoutSeconds,
      }, "GET", responseHeaders);
      return;
    }
    sendJson(res, 200, result.event, "GET", responseHeaders);
  }).catch((error) => {
    sendJson(res, 500, { type: "review.wait_error", message: error.message }, "GET", responseHeaders);
  });
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
  return sessionCookie(ACCESS_KEY_COOKIE, accessKey, req);
}

function sessionCookie(name, value, req) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
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

function mergeHeaders(...headersList) {
  const merged = {};
  for (const headers of headersList) {
    for (const [name, value] of Object.entries(headers || {})) {
      if (name.toLowerCase() === "set-cookie" && merged[name]) {
        merged[name] = [merged[name]].flat().concat(value);
      } else {
        merged[name] = value;
      }
    }
  }
  return merged;
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

export function isLocalOwnerRequest(req) {
  return isLoopbackRemoteAddress(req?.socket?.remoteAddress)
    && isLoopbackHostHeader(req?.headers?.host)
    && !hasForwardingHeaders(req?.headers);
}

function isLoopbackHostHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return false;
  try {
    return isLoopbackHost(new URL(`http://${raw}`).hostname);
  } catch {
    return false;
  }
}

function isLoopbackRemoteAddress(value) {
  const address = String(value || "").toLowerCase();
  return address === "::1"
    || address.startsWith("127.")
    || address.startsWith("::ffff:127.");
}

function isLoopbackHost(value) {
  const host = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "localhost"
    || host === "::1"
    || host === "0.0.0.0"
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function hasForwardingHeaders(headers = {}) {
  return [
    "cf-connecting-ip",
    "cf-ray",
    "cf-visitor",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
  ].some((name) => Boolean(headers[name]));
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function createPeerId() {
  return `p_${randomBytes(9).toString("base64url")}`;
}

function reviewerIdFromPeerId(peerId) {
  return `r_${String(peerId || "").replace(/^p_/, "")}`;
}

function findPeerClient(peers, peerId, pagePath = "") {
  for (const [client, peer] of peers) {
    if (peer.id === peerId && (!pagePath || peer.pagePath === pagePath)) return client;
  }
  return null;
}

function createReviewEventQueue({ now = () => new Date(), limit = 100 } = {}) {
  let sequence = 0;
  const retained = [];
  const waiters = new Set();

  function push({ targetPath, commentsPath, directoryMode, liveMode, comments = [], overallComment = "", peer = null } = {}) {
    const event = {
      type: "review.completed",
      sequence: sequence + 1,
      createdAt: now().toISOString(),
      targetPath,
      commentsPath: commentsPath || null,
      directoryMode: Boolean(directoryMode),
      liveMode: Boolean(liveMode),
      summary: reviewSummary(comments),
      overallComment: cleanOverallComment(overallComment),
      reviewer: peer ? {
        id: peer.reviewerId || "",
        authorRole: peer.authorRole || "visitor",
        pagePath: peer.pagePath || "/",
      } : null,
    };
    sequence = event.sequence;
    retained.push(event);
    while (retained.length > limit) retained.shift();
    for (const waiter of Array.from(waiters)) {
      if (event.sequence <= waiter.after) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve({ event });
    }
    return event;
  }

  function wait({ after = 0, timeoutSeconds = 0 } = {}) {
    const replay = retained.find((event) => event.sequence > after);
    if (replay) return Promise.resolve({ event: replay });

    return new Promise((resolve) => {
      const waiter = {
        after,
        resolve,
        timer: null,
      };
      waiters.add(waiter);
      if (timeoutSeconds > 0) {
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          resolve({ timeout: true });
        }, timeoutSeconds * 1000);
        waiter.timer.unref?.();
      }
    });
  }

  function close() {
    for (const waiter of Array.from(waiters)) {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve({ timeout: true });
    }
  }

  return {
    push,
    wait,
    close,
    latestSequence: () => sequence,
    recent: () => retained.slice(),
  };
}

function parseReviewWaitOptions(url, reviewEvents) {
  const timeoutSeconds = parseNonNegativeSeconds(url.searchParams.get("timeout"), 0, "timeout");
  const afterParam = url.searchParams.get("after");
  const after = afterParam === "latest"
    ? reviewEvents.latestSequence()
    : parseNonNegativeSeconds(afterParam, 0, "after");
  return { after, timeoutSeconds };
}

function parseNonNegativeSeconds(value, fallback, name) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be a non-negative integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${name} is too large`);
  return number;
}

function reviewSummary(comments) {
  const summary = {
    total: 0,
    comments: 0,
    page: 0,
    site: 0,
    owner: 0,
    visitor: 0,
    ownerApproved: 0,
    pending: 0,
  };
  for (const comment of comments || []) {
    summary.total += 1;
    summary.comments += 1;
    if (comment?.scope === "site") summary.site += 1;
    else summary.page += 1;
    if (comment?.authorRole === "owner") summary.owner += 1;
    else summary.visitor += 1;
    if (comment?.ownerApproval?.approvedAt) summary.ownerApproved += 1;
    summary.pending += 1;
  }
  return summary;
}

function cleanOverallComment(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, 2000);
}

function createWatcher({ path, recursive, filename: expectedFilename, onChange }) {
  const handleChange = (_eventType, actualFilename) => {
    if (isIgnoredWatchFilename(actualFilename)) return;
    if (!isWatchedFilename(actualFilename, expectedFilename)) return;
    onChange();
  };
  try {
    return watch(path, { persistent: true, recursive }, handleChange);
  } catch (error) {
    if (!recursive) throw error;
    return watch(path, { persistent: true }, handleChange);
  }
}

function isWatchedFilename(actualFilename, expectedFilename) {
  if (!expectedFilename || !actualFilename) return true;
  const parts = String(actualFilename).split(/[\\/]+/);
  return parts[parts.length - 1] === expectedFilename;
}

function fileSignature(path) {
  try {
    const stats = statSync(path, { bigint: true });
    return `${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
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

function cleanOwnerName(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, 80);
}

function cleanCommentId(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, 160);
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

function blockedAgentPaths(agentStatePath) {
  return agentStatePath ? [agentStatePath, `${agentStatePath}.tmp`, defaultAgentLogPath(agentStatePath)] : [];
}

function agentStatusSnapshot({ agentStatePath, comments }) {
  let state;
  let stateAvailable = true;
  try {
    state = loadAgentState(agentStatePath);
  } catch {
    state = { updatedAt: null, comments: {} };
    stateAvailable = false;
  }
  return {
    enabled: true,
    stateAvailable,
    ...buildAgentStatusSnapshot({ comments, state }),
  };
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

function withSessionKeys(url, { accessKey } = {}) {
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
