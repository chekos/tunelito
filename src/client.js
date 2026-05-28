(function () {
  const script = document.currentScript;
  const sourceName = script?.dataset?.sourceName || document.title || "HTML page";
  const configuredLiveMode = script?.dataset?.liveMode === "true";
  const endpointBase = "/__tunelito";
  const accessKey = new URLSearchParams(location.search).get("tunelito_key") || "";
  const pagePath = script?.dataset?.pagePath || location.pathname || "/";
  const state = {
    socket: null,
    pagePath,
    connected: false,
    liveMode: configuredLiveMode,
    peerId: "",
    peers: new Map(),
    peerConnections: new Map(),
    dataChannels: new Map(),
    pendingIceCandidates: new Map(),
    peerCursors: new Map(),
    peerSelections: new Map(),
    viewerCount: null,
    author: localStorage.getItem("tunelito:author") || "",
    comments: [],
    pendingSelection: null,
    highlights: [],
    selectionTimer: null,
    cursorTimer: null,
    pendingCursor: null,
    sharedSelectionActive: false,
  };

  addDocumentHighlightStyle();
  const ui = mountUi();
  connect();
  bindSelection();

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socketUrl = new URL(`${protocol}//${location.host}${endpointBase}/ws`);
    if (accessKey) socketUrl.searchParams.set("tunelito_key", accessKey);
    socketUrl.searchParams.set("tunelito_page", state.pagePath);
    const socket = new WebSocket(socketUrl);
    state.socket = socket;

    socket.addEventListener("open", () => {
      state.connected = true;
      renderStatus();
    });
    socket.addEventListener("close", () => {
      state.connected = false;
      renderStatus("Reconnecting...");
      setTimeout(connect, 1000);
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "hello") {
        resetPeerConnections();
        state.liveMode = Boolean(message.liveMode);
        state.pagePath = message.pagePath || state.pagePath;
        state.peerId = message.peerId || "";
        state.viewerCount = message.viewerCount;
        state.comments = message.comments || [];
        state.peers = new Map((message.peers || []).map((peer) => [peer.id, peer]));
        updateCommentsLink(message.commentsUrl);
        renderComments();
        renderStatus(null, message.viewerCount);
        if (state.liveMode) connectToExistingPeers(message.peers || []);
      } else if (message.type === "comment") {
        addComment(message.comment);
      } else if (message.type === "viewer-count") {
        renderStatus(null, message.count);
      } else if (message.type === "document-changed") {
        renderStatus("Page changed; reloading...");
        setTimeout(() => location.reload(), 500);
      } else if (message.type === "peer-joined") {
        handlePeerJoined(message.peer);
      } else if (message.type === "peer-left") {
        handlePeerLeft(message.peerId);
      } else if (message.type === "signal") {
        handleSignal(message.from, message.signal);
      } else if (message.type === "live-event") {
        if (message.from !== state.peerId) handleLiveEvent(message.from, message.event);
      } else if (message.type === "error") {
        renderStatus(message.message);
      }
    });
  }

  function mountUi() {
    const host = document.createElement("div");
    host.id = "tunelito-root";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; color-scheme: light; }
        *, *::before, *::after { box-sizing: border-box; }
        .launcher {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #0f766e;
          border-radius: 999px;
          background: #0f766e;
          color: #fff;
          font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 10px 13px;
          box-shadow: 0 12px 32px rgba(15, 23, 42, .2);
          cursor: pointer;
        }
        .launcher span {
          min-width: 18px;
          height: 18px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(255,255,255,.2);
          font-size: 11px;
        }
        .panel {
          position: fixed;
          top: 16px;
          right: 16px;
          width: min(380px, calc(100vw - 32px));
          max-height: calc(100vh - 32px);
          z-index: 2147483646;
          display: none;
          grid-template-rows: auto auto auto 1fr auto;
          overflow: hidden;
          border: 1px solid rgba(15, 23, 42, .14);
          border-radius: 10px;
          background: #fff;
          color: #172033;
          box-shadow: 0 24px 70px rgba(15, 23, 42, .25);
          font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .panel.open { display: grid; }
        .header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 13px 14px;
          border-bottom: 1px solid #e5e7eb;
        }
        .title { flex: 1; min-width: 0; }
        .title strong {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 14px;
        }
        .status {
          color: #64748b;
          font-size: 12px;
        }
        .icon-button {
          width: 30px;
          height: 30px;
          border: 1px solid #d7dde8;
          border-radius: 7px;
          background: #fff;
          color: #334155;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        .identity {
          display: flex;
          gap: 8px;
          padding: 12px 14px;
          border-bottom: 1px solid #eef2f7;
          background: #f8fafc;
        }
        .note-actions {
          display: flex;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid #eef2f7;
          background: #fff;
        }
        .note-actions button {
          flex: 1;
        }
        input, textarea {
          width: 100%;
          border: 1px solid #d7dde8;
          border-radius: 7px;
          background: #fff;
          color: #172033;
          font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 9px 10px;
        }
        textarea { min-height: 86px; resize: vertical; }
        .comments {
          overflow: auto;
          padding: 10px 10px 14px;
        }
        .empty {
          color: #64748b;
          padding: 22px 12px;
          text-align: center;
          font-size: 13px;
        }
        .comment {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px;
          margin: 0 0 9px;
          cursor: pointer;
        }
        .comment:hover { border-color: #94a3b8; }
        .quote {
          color: #334155;
          font-size: 12px;
          border-left: 3px solid #99f6e4;
          padding-left: 8px;
          margin-bottom: 8px;
        }
        .quote.note {
          color: #64748b;
          border-left-color: #cbd5e1;
        }
        .meta {
          color: #64748b;
          font-size: 12px;
          margin-bottom: 4px;
        }
        .body {
          color: #172033;
          white-space: pre-wrap;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-top: 1px solid #e5e7eb;
          background: #f8fafc;
        }
        .link {
          color: #0f766e;
          text-decoration: none;
          font-weight: 600;
          font-size: 12px;
        }
        .link[hidden] { display: none; }
        .peer-cursor {
          position: fixed;
          left: 0;
          top: 0;
          z-index: 2147483644;
          pointer-events: none;
          transform: translate3d(-999px, -999px, 0);
          transition: transform .08s linear, opacity .18s ease;
        }
        .peer-cursor .dot {
          width: 10px;
          height: 10px;
          border: 2px solid #fff;
          border-radius: 999px;
          background: #f59e0b;
          box-shadow: 0 2px 8px rgba(15, 23, 42, .28);
        }
        .peer-cursor .label {
          display: inline-block;
          margin: 5px 0 0 8px;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border-radius: 999px;
          background: #111827;
          color: #fff;
          font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 5px 7px;
          box-shadow: 0 6px 18px rgba(15, 23, 42, .2);
        }
        .selection {
          position: fixed;
          z-index: 2147483647;
          display: none;
          border: 1px solid #0f766e;
          border-radius: 999px;
          background: #0f766e;
          color: #fff;
          box-shadow: 0 12px 32px rgba(15, 23, 42, .22);
          font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 9px 12px;
          cursor: pointer;
        }
        .selection.visible { display: block; }
        .composer {
          position: fixed;
          z-index: 2147483647;
          display: none;
          width: min(360px, calc(100vw - 24px));
          border: 1px solid rgba(15, 23, 42, .16);
          border-radius: 10px;
          background: #fff;
          box-shadow: 0 22px 60px rgba(15, 23, 42, .24);
          padding: 12px;
        }
        .composer.open { display: block; }
        .composer-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 9px;
        }
        .composer-scope {
          color: #64748b;
          font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .scope-toggle {
          display: inline-flex;
          border: 1px solid #d7dde8;
          border-radius: 7px;
          overflow: hidden;
        }
        .scope-toggle button {
          border: 0;
          border-right: 1px solid #d7dde8;
          background: #fff;
          color: #334155;
          font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 9px;
          cursor: pointer;
        }
        .scope-toggle button:last-child { border-right: 0; }
        .scope-toggle button.active {
          background: #0f766e;
          color: #fff;
        }
        .composer .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 9px;
        }
        button.secondary, button.primary {
          border: 1px solid #d7dde8;
          border-radius: 7px;
          padding: 8px 10px;
          font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        button.secondary { background: #fff; color: #334155; }
        button.primary { border-color: #0f766e; background: #0f766e; color: #fff; }
        @media (max-width: 640px) {
          .launcher {
            right: max(12px, env(safe-area-inset-right));
            bottom: max(12px, env(safe-area-inset-bottom));
            min-height: 44px;
            padding: 12px 14px;
          }
          .panel {
            top: auto;
            right: 0;
            bottom: 0;
            left: 0;
            width: 100vw;
            max-height: min(78vh, calc(100vh - 18px));
            border-right: 0;
            border-bottom: 0;
            border-left: 0;
            border-radius: 14px 14px 0 0;
          }
          .selection {
            right: auto;
            bottom: calc(70px + env(safe-area-inset-bottom));
            left: 50%;
            min-height: 44px;
            min-width: 156px;
            padding: 13px 18px;
            text-align: center;
            transform: translateX(-50%);
          }
          .composer {
            right: 8px;
            bottom: 8px;
            left: 8px;
            width: auto;
            max-height: calc(100vh - 16px);
            border-radius: 12px;
          }
          .composer textarea {
            min-height: 118px;
            font-size: 16px;
          }
          input {
            font-size: 16px;
          }
          button.secondary, button.primary {
            min-height: 42px;
            padding: 10px 12px;
          }
        }
      </style>
      <button class="launcher" title="Open Tunelito comments">Comments <span class="count">0</span></button>
      <button class="selection">Comment</button>
      <div class="composer" role="dialog" aria-label="Add comment">
        <div class="composer-meta">
          <span class="composer-scope">Page comment</span>
          <div class="scope-toggle" role="group" aria-label="Comment scope">
            <button type="button" data-scope="page">Page</button>
            <button type="button" data-scope="site">Site</button>
          </div>
        </div>
        <div class="quote"></div>
        <textarea placeholder="Leave a comment on this selection"></textarea>
        <div class="actions">
          <button class="secondary" data-action="cancel">Cancel</button>
          <button class="primary" data-action="save">Add comment</button>
        </div>
      </div>
      <aside class="panel" aria-label="Tunelito comments">
        <div class="header">
          <div class="title">
            <strong></strong>
            <div class="status">Connecting...</div>
          </div>
          <button class="icon-button" title="Close">×</button>
        </div>
        <div class="identity">
          <input class="name" autocomplete="name" placeholder="Your name" />
        </div>
        <div class="note-actions" aria-label="Add unanchored comment">
          <button class="secondary" data-action="page-note">Page note</button>
          <button class="secondary" data-action="site-note">Site note</button>
        </div>
        <div class="comments"></div>
        <div class="footer">
          <a class="link" href="/__tunelito/comments.md" target="_blank" rel="noreferrer">Open markdown</a>
          <span class="status mini"></span>
        </div>
      </aside>
    `;
    document.documentElement.appendChild(host);

    const panel = shadow.querySelector(".panel");
    const launcher = shadow.querySelector(".launcher");
    const composer = shadow.querySelector(".composer");
    const selection = shadow.querySelector(".selection");
    const name = shadow.querySelector(".name");
    const markdownLink = shadow.querySelector(".link");
    shadow.querySelector(".title strong").textContent = sourceName;
    markdownLink.href = withAccessKey(`${endpointBase}/comments.md`);
    markdownLink.hidden = configuredLiveMode;
    name.value = state.author;

    launcher.addEventListener("click", () => panel.classList.toggle("open"));
    shadow.querySelector(".icon-button").addEventListener("click", () => panel.classList.remove("open"));
    name.addEventListener("input", () => {
      state.author = name.value.trim();
      localStorage.setItem("tunelito:author", state.author);
    });
    selection.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    selection.addEventListener("click", (event) => {
      event.preventDefault();
      openComposer();
    });
    shadow.querySelector("[data-action='page-note']").addEventListener("click", () => openNoteComposer("page"));
    shadow.querySelector("[data-action='site-note']").addEventListener("click", () => openNoteComposer("site"));
    for (const button of composer.querySelectorAll("[data-scope]")) {
      button.addEventListener("click", () => setComposerScope(button.dataset.scope));
    }
    composer.querySelector("[data-action='cancel']").addEventListener("click", closeComposer);
    composer.querySelector("[data-action='save']").addEventListener("click", submitComment);
    composer.querySelector("textarea").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitComment();
      if (event.key === "Escape") closeComposer();
    });

    return {
      shadow,
      panel,
      launcher,
      selection,
      composer,
      count: shadow.querySelector(".count"),
      comments: shadow.querySelector(".comments"),
      status: shadow.querySelector(".status"),
      mini: shadow.querySelector(".mini"),
      markdownLink,
      name,
    };
  }

  function withAccessKey(path) {
    const url = new URL(path, location.href);
    if (accessKey) url.searchParams.set("tunelito_key", accessKey);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function bindSelection() {
    document.addEventListener("pointermove", sharePointerPosition, { passive: true });
    document.addEventListener("mouseup", scheduleSelectionCapture);
    document.addEventListener("keyup", scheduleSelectionCapture);
    document.addEventListener("selectionchange", scheduleSelectionCapture);
    document.addEventListener("touchend", scheduleSelectionCapture, { passive: true });

    document.addEventListener("mousedown", (event) => {
      if (event.composedPath().includes(ui.selection) || event.composedPath().includes(ui.composer)) return;
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) hideSelectionButton();
      }, 0);
    });
    document.addEventListener("touchstart", (event) => {
      if (event.composedPath().includes(ui.selection) || event.composedPath().includes(ui.composer)) return;
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) hideSelectionButton();
      }, 0);
    }, { passive: true });
  }

  function scheduleSelectionCapture() {
    clearTimeout(state.selectionTimer);
    state.selectionTimer = setTimeout(captureCurrentSelection, isMobileViewport() ? 220 : 0);
  }

  function captureCurrentSelection() {
    if (ui.composer.classList.contains("open")) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      hideSelectionButton();
      return;
    }
    if (isSelectionInsideTunelito(selection)) {
      hideSelectionButton();
      return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    state.pendingSelection = captureSelection(range);
    shareSelection(state.pendingSelection);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideSelectionButton();
      return;
    }
    positionSelectionButton(rect);
    ui.selection.classList.add("visible");
  }

  function captureSelection(range) {
    const quote = range.toString();
    const offsets = rangeTextOffsets(range);
    const bodyText = readableText(document.body);
    let prefix = "";
    let suffix = "";
    if (Number.isFinite(offsets.start)) {
      prefix = bodyText.slice(Math.max(0, offsets.start - 80), offsets.start);
      suffix = bodyText.slice(offsets.end, offsets.end + 80);
    } else {
      const idx = bodyText.indexOf(quote);
      if (idx >= 0) {
        prefix = bodyText.slice(Math.max(0, idx - 80), idx);
        suffix = bodyText.slice(idx + quote.length, idx + quote.length + 80);
      }
    }
    return {
      scope: "page",
      quote,
      prefix,
      suffix,
      textStart: Number.isFinite(offsets.start) ? offsets.start : null,
      textEnd: Number.isFinite(offsets.end) ? offsets.end : null,
      path: cssPath(closestElement(range.startContainer)),
      rect: rectSnapshot(range.getBoundingClientRect()),
    };
  }

  function openComposer() {
    if (!state.pendingSelection) return;
    hideSelectionButton();
    const rect = state.pendingSelection.rect || (window.getSelection()?.rangeCount ? rectSnapshot(window.getSelection().getRangeAt(0).getBoundingClientRect()) : null);
    state.pendingSelection.scope = normalizeScope(state.pendingSelection.scope);
    setComposerScope(state.pendingSelection.scope);
    ui.composer.querySelector("textarea").value = "";
    if (isMobileViewport()) {
      ui.composer.style.left = "";
      ui.composer.style.top = "";
    } else {
      ui.composer.style.left = `${Math.max(8, Math.min(window.innerWidth - 370, rect?.left || 16))}px`;
      ui.composer.style.top = `${Math.min(window.innerHeight - 180, Math.max(8, (rect?.bottom || 80) + 8))}px`;
    }
    ui.composer.classList.add("open");
    ui.composer.querySelector("textarea").focus();
  }

  function openNoteComposer(scope) {
    ui.panel.classList.add("open");
    hideSelectionButton();
    window.getSelection()?.removeAllRanges();
    state.pendingSelection = {
      scope: normalizeScope(scope),
      quote: "",
      prefix: "",
      suffix: "",
      path: "",
      textStart: null,
      textEnd: null,
      rect: null,
    };
    openComposer();
  }

  function closeComposer() {
    ui.composer.classList.remove("open");
    state.pendingSelection = null;
  }

  function setComposerScope(scope) {
    if (!state.pendingSelection) return;
    state.pendingSelection.scope = normalizeScope(scope);
    for (const button of ui.composer.querySelectorAll("[data-scope]")) {
      button.classList.toggle("active", button.dataset.scope === state.pendingSelection.scope);
    }
    ui.composer.querySelector(".composer-scope").textContent = `${scopeLabel(state.pendingSelection.scope)} comment`;
    const textarea = ui.composer.querySelector("textarea");
    textarea.placeholder = state.pendingSelection.quote.trim()
      ? "Leave a comment on this selection"
      : `Leave a ${state.pendingSelection.scope} note`;
    updateComposerPreview();
  }

  function updateComposerPreview() {
    if (!state.pendingSelection) return;
    const quote = ui.composer.querySelector(".quote");
    const hasQuote = Boolean(state.pendingSelection.quote.trim());
    quote.textContent = hasQuote
      ? state.pendingSelection.quote.slice(0, 260)
      : `${scopeLabel(state.pendingSelection.scope)} note (no selected text)`;
    quote.classList.toggle("note", !hasQuote);
  }

  function submitComment() {
    const body = ui.composer.querySelector("textarea").value.trim();
    if (!body || !state.pendingSelection) return;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      renderStatus("Still connecting; try again in a moment.");
      return;
    }
    const author = state.author || ui.name.value.trim() || "Anonymous";
    state.author = author;
    localStorage.setItem("tunelito:author", author);
    const comment = {
      ...(state.liveMode ? { id: createEventId("c"), created: new Date().toISOString() } : {}),
      ...state.pendingSelection,
      scope: normalizeScope(state.pendingSelection.scope),
      body,
      author,
      pagePath: state.pagePath,
    };
    if (state.liveMode) {
      addComment(comment);
      broadcastLiveEvent({ type: "comment", id: comment.id, comment });
    }
    state.socket?.send(JSON.stringify({
      type: "create-comment",
      comment,
    }));
    closeComposer();
    window.getSelection()?.removeAllRanges();
  }

  function addComment(comment) {
    if (!comment) return;
    if (comment.id && state.comments.some((existing) => existing.id === comment.id)) return;
    state.comments.push(comment);
    renderComments();
  }

  function renderComments() {
    ui.count.textContent = String(state.comments.length);
    if (!state.comments.length) {
      ui.comments.innerHTML = `<div class="empty">Select text, or add a page or site note.</div>`;
      updateHighlights();
      return;
    }

    ui.comments.innerHTML = "";
    for (const comment of state.comments.slice().reverse()) {
      const item = document.createElement("article");
      item.className = "comment";
      item.innerHTML = `
        <div class="meta"></div>
        <div class="quote"></div>
        <div class="body"></div>
      `;
      const scope = normalizeScope(comment.scope);
      const quote = item.querySelector(".quote");
      const hasQuote = Boolean(String(comment.quote || "").trim());
      item.querySelector(".meta").textContent = `${comment.author} · ${scope} · ${formatTime(comment.created)}`;
      quote.textContent = hasQuote ? compact(comment.quote, 220) : `${scopeLabel(scope)} note`;
      quote.classList.toggle("note", !hasQuote);
      item.querySelector(".body").textContent = comment.body;
      item.addEventListener("click", () => scrollToComment(comment));
      ui.comments.appendChild(item);
    }
    updateHighlights();
  }

  function renderStatus(message, viewerCount) {
    if (Number.isFinite(viewerCount)) state.viewerCount = viewerCount;
    const connection = state.connected ? "Connected" : "Offline";
    const count = Number.isFinite(state.viewerCount) ? state.viewerCount : null;
    const viewers = Number.isFinite(count) ? ` · ${count} viewer${count === 1 ? "" : "s"}` : "";
    const transport = state.liveMode && state.connected ? ` · ${openDataChannelCount() > 0 ? "P2P" : "relay"}` : "";
    ui.status.textContent = message || `${connection}${viewers}`;
    ui.status.textContent += message ? "" : transport;
    ui.mini.textContent = state.connected ? (state.liveMode ? (openDataChannelCount() > 0 ? "Live P2P" : "Live relay") : "Live") : "Offline";
  }

  function updateCommentsLink(commentsUrl) {
    const url = commentsUrl ? withAccessKey(commentsUrl) : "";
    ui.markdownLink.href = url || "#";
    ui.markdownLink.hidden = !url;
  }

  function connectToExistingPeers(peers) {
    if (!webRtcAvailable()) return;
    for (const peer of peers) {
      if (peer?.id) connectToPeer(peer.id, true);
    }
  }

  function handlePeerJoined(peer) {
    if (!state.liveMode || !peer?.id || peer.id === state.peerId) return;
    state.peers.set(peer.id, peer);
    if (webRtcAvailable()) connectToPeer(peer.id, false);
  }

  function handlePeerLeft(peerId) {
    if (!peerId) return;
    state.peers.delete(peerId);
    closePeerConnection(peerId);
    state.peerSelections.delete(peerId);
    removePeerCursor(peerId);
    updatePeerHighlights();
  }

  async function connectToPeer(peerId, initiator) {
    if (!state.liveMode || !peerId || peerId === state.peerId || !webRtcAvailable()) return null;
    const existing = state.peerConnections.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: [] });
    state.peerConnections.set(peerId, pc);

    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) sendSignal(peerId, { candidate: event.candidate });
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        closePeerConnection(peerId);
      }
      renderStatus();
    });
    pc.addEventListener("datachannel", (event) => {
      setupDataChannel(peerId, event.channel);
    });

    if (initiator) {
      setupDataChannel(peerId, pc.createDataChannel("tunelito-live"));
      try {
        await pc.setLocalDescription(await pc.createOffer());
        sendSignal(peerId, { description: pc.localDescription });
      } catch {
        closePeerConnection(peerId);
      }
    }

    return pc;
  }

  function setupDataChannel(peerId, channel) {
    state.dataChannels.set(peerId, channel);
    channel.addEventListener("open", () => renderStatus());
    channel.addEventListener("close", () => {
      if (state.dataChannels.get(peerId) === channel) state.dataChannels.delete(peerId);
      renderStatus();
    });
    channel.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type === "live-event") handleLiveEvent(peerId, message.event);
      } catch {
        // Ignore malformed peer messages; the WebSocket relay remains the fallback.
      }
    });
  }

  async function handleSignal(peerId, signal) {
    if (!state.liveMode || !peerId || !signal || !webRtcAvailable()) return;
    const pc = await connectToPeer(peerId, false);
    if (!pc) return;
    try {
      if (signal.description) {
        await pc.setRemoteDescription(signal.description);
        await flushPendingIceCandidates(peerId, pc);
        if (signal.description.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          sendSignal(peerId, { description: pc.localDescription });
        }
      }
      if (signal.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(signal.candidate);
        } else {
          const pending = state.pendingIceCandidates.get(peerId) || [];
          pending.push(signal.candidate);
          state.pendingIceCandidates.set(peerId, pending);
        }
      }
    } catch {
      closePeerConnection(peerId);
    }
  }

  async function flushPendingIceCandidates(peerId, pc) {
    const pending = state.pendingIceCandidates.get(peerId) || [];
    state.pendingIceCandidates.delete(peerId);
    for (const candidate of pending) {
      await pc.addIceCandidate(candidate);
    }
  }

  function sendSignal(peerId, signal) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    state.socket.send(JSON.stringify({ type: "signal", to: peerId, signal }));
  }

  function broadcastLiveEvent(event) {
    if (!state.liveMode || !event) return;
    const payload = JSON.stringify({ type: "live-event", event });
    for (const channel of state.dataChannels.values()) {
      if (channel.readyState === "open") channel.send(payload);
    }
    if (event.type !== "comment" && state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(payload);
    }
  }

  function handleLiveEvent(peerId, event) {
    if (!state.liveMode || !peerId || peerId === state.peerId || !event) return;
    if (event.type === "comment") {
      addComment(event.comment);
    } else if (event.type === "cursor") {
      renderPeerCursor(peerId, event);
    } else if (event.type === "selection") {
      state.peerSelections.set(peerId, event.selection);
      updatePeerHighlights();
    } else if (event.type === "selection-clear") {
      state.peerSelections.delete(peerId);
      updatePeerHighlights();
    }
  }

  function sharePointerPosition(event) {
    if (!state.liveMode || !state.connected) return;
    state.pendingCursor = {
      x: event.pageX,
      y: event.pageY,
      author: state.author || ui.name.value.trim() || "Guest",
    };
    if (state.cursorTimer) return;
    state.cursorTimer = setTimeout(() => {
      state.cursorTimer = null;
      if (state.pendingCursor) broadcastLiveEvent({ type: "cursor", ...state.pendingCursor });
      state.pendingCursor = null;
    }, 50);
  }

  function shareSelection(selection) {
    if (!state.liveMode || !selection?.quote) return;
    state.sharedSelectionActive = true;
    broadcastLiveEvent({
      type: "selection",
      selection: {
        quote: selection.quote,
        prefix: selection.prefix,
        suffix: selection.suffix,
        textStart: selection.textStart,
        textEnd: selection.textEnd,
        path: selection.path,
        author: state.author || ui.name.value.trim() || "Guest",
      },
    });
  }

  function clearSharedSelection() {
    if (!state.liveMode || !state.sharedSelectionActive) return;
    state.sharedSelectionActive = false;
    broadcastLiveEvent({ type: "selection-clear" });
  }

  function renderPeerCursor(peerId, event) {
    let entry = state.peerCursors.get(peerId);
    if (!entry) {
      const element = document.createElement("div");
      element.className = "peer-cursor";
      element.innerHTML = `<div class="dot"></div><div class="label"></div>`;
      ui.shadow.appendChild(element);
      entry = { element, timer: null };
      state.peerCursors.set(peerId, entry);
    }

    entry.element.querySelector(".label").textContent = event.author || "Guest";
    entry.element.style.opacity = "1";
    entry.element.style.transform = `translate3d(${Math.round(event.x - window.scrollX)}px, ${Math.round(event.y - window.scrollY)}px, 0)`;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.element.style.opacity = "0";
    }, 2400);
  }

  function removePeerCursor(peerId) {
    const entry = state.peerCursors.get(peerId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.element.remove();
    state.peerCursors.delete(peerId);
  }

  function resetPeerConnections() {
    for (const peerId of Array.from(state.peerConnections.keys())) closePeerConnection(peerId);
    state.peerConnections.clear();
    state.dataChannels.clear();
    state.pendingIceCandidates.clear();
    state.peerSelections.clear();
    for (const peerId of Array.from(state.peerCursors.keys())) removePeerCursor(peerId);
    updatePeerHighlights();
  }

  function closePeerConnection(peerId) {
    const channel = state.dataChannels.get(peerId);
    if (channel) channel.close();
    state.dataChannels.delete(peerId);
    const pc = state.peerConnections.get(peerId);
    if (pc) pc.close();
    state.peerConnections.delete(peerId);
    state.pendingIceCandidates.delete(peerId);
  }

  function openDataChannelCount() {
    let count = 0;
    for (const channel of state.dataChannels.values()) {
      if (channel.readyState === "open") count += 1;
    }
    return count;
  }

  function webRtcAvailable() {
    return typeof RTCPeerConnection !== "undefined";
  }

  function hideSelectionButton() {
    ui.selection.classList.remove("visible");
    clearSharedSelection();
  }

  function positionSelectionButton(rect) {
    if (isMobileViewport()) {
      ui.selection.style.left = "";
      ui.selection.style.top = "";
      return;
    }
    ui.selection.style.left = `${Math.max(8, Math.min(window.innerWidth - 110, rect.left))}px`;
    ui.selection.style.top = `${Math.max(8, rect.top - 42)}px`;
  }

  function updateHighlights() {
    state.highlights = [];
    if (!("CSS" in window) || !CSS.highlights || typeof Highlight === "undefined") return;
    for (const comment of state.comments) {
      const range = findRangeForComment(comment);
      if (range) state.highlights.push(range);
    }
    CSS.highlights.set("tunelito-comments", new Highlight(...state.highlights));
    updatePeerHighlights();
  }

  function updatePeerHighlights() {
    if (!("CSS" in window) || !CSS.highlights || typeof Highlight === "undefined") return;
    const ranges = [];
    for (const selection of state.peerSelections.values()) {
      const range = findRangeForComment(selection);
      if (range) ranges.push(range);
    }
    if (ranges.length) {
      CSS.highlights.set("tunelito-peer-selections", new Highlight(...ranges));
    } else {
      CSS.highlights.delete("tunelito-peer-selections");
    }
  }

  function scrollToComment(comment) {
    const range = findRangeForComment(comment);
    if (!range) return;
    const node = closestElement(range.startContainer);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    flashRange(range);
  }

  function findRangeForComment(comment) {
    if (!String(comment?.quote || "").trim()) return null;
    if (normalizeScope(comment.scope) === "site" && comment.pagePath && normalizePagePath(comment.pagePath) !== normalizePagePath(state.pagePath)) return null;
    const textNodes = getTextNodes(document.body);
    const fullText = textNodes.map((entry) => entry.node.textContent).join("");
    const exact = comment.prefix || comment.suffix ? `${comment.prefix}${comment.quote}${comment.suffix}` : null;
    let start = -1;
    if (exact) {
      const exactStart = fullText.indexOf(exact);
      if (exactStart >= 0) start = exactStart + comment.prefix.length;
    }
    if (start < 0 && Number.isFinite(comment.textStart)) start = comment.textStart;
    if (start < 0 || fullText.slice(start, start + comment.quote.length) !== comment.quote) {
      start = fullText.indexOf(comment.quote);
    }
    if (start < 0) return null;
    const end = start + comment.quote.length;
    const startLoc = locate(textNodes, start);
    const endLoc = locate(textNodes, end);
    if (!startLoc || !endLoc) return null;
    const range = document.createRange();
    range.setStart(startLoc.node, startLoc.offset);
    range.setEnd(endLoc.node, endLoc.offset);
    return range;
  }

  function flashRange(range) {
    const rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const marker = document.createElement("div");
    marker.style.cssText = `
      position: fixed;
      z-index: 2147483645;
      pointer-events: none;
      left: ${rect.left - 3}px;
      top: ${rect.top - 3}px;
      width: ${rect.width + 6}px;
      height: ${rect.height + 6}px;
      border: 2px solid #0f766e;
      border-radius: 5px;
      background: rgba(45, 212, 191, .16);
      transition: opacity .5s ease;
    `;
    document.body.appendChild(marker);
    setTimeout(() => marker.style.opacity = "0", 700);
    setTimeout(() => marker.remove(), 1300);
  }

  function addDocumentHighlightStyle() {
    const style = document.createElement("style");
    style.id = "tunelito-document-highlight-style";
    style.textContent = `
      ::highlight(tunelito-comments) { background: rgba(45, 212, 191, .28); }
      ::highlight(tunelito-peer-selections) { background: rgba(245, 158, 11, .26); }
    `;
    document.head.appendChild(style);
  }

  function getTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("#tunelito-root")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script, style, noscript, textarea, input")) return NodeFilter.FILTER_REJECT;
        if (!node.textContent) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: offset });
      offset += node.textContent.length;
    }
    return nodes;
  }

  function readableText(root) {
    return getTextNodes(root).map((entry) => entry.node.textContent).join("");
  }

  function rangeTextOffsets(range) {
    const nodes = getTextNodes(document.body);
    const start = offsetForBoundary(nodes, range.startContainer, range.startOffset);
    const end = offsetForBoundary(nodes, range.endContainer, range.endOffset);
    return { start, end };
  }

  function offsetForBoundary(nodes, target, localOffset) {
    for (const entry of nodes) {
      if (entry.node === target) return entry.start + localOffset;
    }
    return null;
  }

  function locate(nodes, globalOffset) {
    for (const entry of nodes) {
      const end = entry.start + entry.node.textContent.length;
      if (globalOffset <= end) return { node: entry.node, offset: globalOffset - entry.start };
    }
    return null;
  }

  function isSelectionInsideTunelito(selection) {
    const node = selection.anchorNode;
    return Boolean(node && closestElement(node)?.closest?.("#tunelito-root"));
  }

  function closestElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function cssPath(element) {
    if (!element || element === document.body) return "body";
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.localName;
      if (current.id && current.id !== "tunelito-root") {
        part += `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        break;
      }
      const siblings = Array.from(current.parentElement?.children || []).filter((sibling) => sibling.localName === current.localName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return ["body", ...parts].join(" > ");
  }

  function rectSnapshot(rect) {
    if (!rect) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 640px)").matches;
  }

  function compact(value, length) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function normalizeScope(scope) {
    return String(scope || "").toLowerCase() === "site" ? "site" : "page";
  }

  function scopeLabel(scope) {
    return normalizeScope(scope) === "site" ? "Site" : "Page";
  }

  function normalizePagePath(path) {
    const value = String(path || "/");
    return value.startsWith("/") ? value : `/${value}`;
  }

  function createEventId(prefix) {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
})();
