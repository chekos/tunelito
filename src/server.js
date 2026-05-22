import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { createReadStream, existsSync, readFileSync, statSync, watch } from "node:fs";
import { dirname, basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCommentsPath, createCommentStore, renderCommentsMarkdown } from "./comments.js";
import { CLIENT_ROUTE, COMMENTS_ROUTE, WS_ROUTE, injectTunelitoClient } from "./inject.js";
import { contentTypeFor } from "./mime.js";
import { WebSocketHub } from "./ws.js";

const CLIENT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "client.js");

export async function createTunelitoServer(options) {
  const filePath = resolve(options.filePath);
  const rootDir = dirname(filePath);
  const sourceName = basename(filePath);
  const commentsPath = resolve(options.commentsPath || defaultCommentsPath(filePath));
  const comments = createCommentStore({ commentsPath, sourcePath: filePath });
  const events = new EventEmitter();
  const hub = new WebSocketHub();

  const server = createServer((req, res) => {
    handleRequest({
      req,
      res,
      filePath,
      rootDir,
      sourceName,
      comments,
    });
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== WS_ROUTE) {
      socket.destroy();
      return;
    }
    hub.handleUpgrade(req, socket);
  });

  function publishViewerCount() {
    events.emit("viewer-count", hub.size);
    hub.broadcast({ type: "viewer-count", count: hub.size });
  }

  hub.on("connection", (client) => {
    client.send({
      type: "hello",
      sourceName,
      comments: comments.all(),
      commentsUrl: COMMENTS_ROUTE,
      viewerCount: hub.size,
    });
    publishViewerCount();
  });

  hub.on("close", publishViewerCount);
  hub.on("message", (client, message) => {
    let event;
    try {
      event = JSON.parse(message);
    } catch {
      client.send({ type: "error", message: "Invalid JSON message" });
      return;
    }

    if (event.type === "create-comment") {
      try {
        const comment = comments.add(event.comment || {});
        events.emit("comment", comment);
        hub.broadcast({ type: "comment", comment });
      } catch (error) {
        client.send({ type: "error", message: error.message });
      }
    }
  });

  let watchTimer = null;
  const watcher = watch(filePath, { persistent: true }, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      events.emit("document-changed");
      hub.broadcast({ type: "document-changed" });
    }, 120);
  });

  const host = options.host || "127.0.0.1";
  const requestedPort = options.port ?? 4317;
  const { port } = await listenOnFirstAvailable(server, host, requestedPort);
  const localUrl = `http://${host}:${port}/`;

  return {
    server,
    events,
    hub,
    commentsPath,
    filePath,
    localUrl,
    async close() {
      clearTimeout(watchTimer);
      watcher.close();
      hub.close();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

function handleRequest({ req, res, filePath, rootDir, sourceName, comments }) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  if (pathname === CLIENT_ROUTE) {
    sendFile(res, CLIENT_PATH, "text/javascript; charset=utf-8", req.method);
    return;
  }

  if (pathname === COMMENTS_ROUTE) {
    sendText(res, 200, renderCommentsMarkdown({ comments: comments.all(), sourcePath: filePath }), "text/markdown; charset=utf-8");
    return;
  }

  if (pathname === "/" || pathname === `/${sourceName}`) {
    const html = readFileSync(filePath, "utf8");
    sendText(res, 200, injectTunelitoClient(html, { sourceName }), "text/html; charset=utf-8");
    return;
  }

  const assetPath = resolve(rootDir, `.${pathname}`);
  if (!isInside(rootDir, assetPath) || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  sendFile(res, assetPath, contentTypeFor(assetPath), req.method);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  const buffer = Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buffer.length,
    "cache-control": "no-store",
  });
  res.end(buffer);
}

function sendFile(res, path, contentType, method) {
  const stat = statSync(path);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "cache-control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
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
