(function () {
  const script = document.currentScript;
  const sourceName = script?.dataset?.sourceName || document.title || "HTML page";
  const endpointBase = "/__tunelito";
  const state = {
    socket: null,
    connected: false,
    author: localStorage.getItem("tunelito:author") || "",
    comments: [],
    pendingSelection: null,
    highlights: [],
  };

  addDocumentHighlightStyle();
  const ui = mountUi();
  connect();
  bindSelection();

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}${endpointBase}/ws`);
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
        state.comments = message.comments || [];
        renderComments();
        renderStatus(null, message.viewerCount);
      } else if (message.type === "comment") {
        state.comments.push(message.comment);
        renderComments();
      } else if (message.type === "viewer-count") {
        renderStatus(null, message.count);
      } else if (message.type === "document-changed") {
        renderStatus("Page changed; reloading...");
        setTimeout(() => location.reload(), 500);
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
          grid-template-rows: auto auto 1fr auto;
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
      </style>
      <button class="launcher" title="Open Tunelito comments">Comments <span class="count">0</span></button>
      <button class="selection">Comment</button>
      <div class="composer" role="dialog" aria-label="Add comment">
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
    shadow.querySelector(".title strong").textContent = sourceName;
    name.value = state.author;

    launcher.addEventListener("click", () => panel.classList.toggle("open"));
    shadow.querySelector(".icon-button").addEventListener("click", () => panel.classList.remove("open"));
    name.addEventListener("input", () => {
      state.author = name.value.trim();
      localStorage.setItem("tunelito:author", state.author);
    });
    selection.addEventListener("mousedown", (event) => {
      event.preventDefault();
      openComposer();
    });
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
      name,
    };
  }

  function bindSelection() {
    document.addEventListener("mouseup", () => {
      setTimeout(() => {
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
        const rect = range.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          hideSelectionButton();
          return;
        }
        ui.selection.style.left = `${Math.max(8, Math.min(window.innerWidth - 110, rect.left))}px`;
        ui.selection.style.top = `${Math.max(8, rect.top - 42)}px`;
        ui.selection.classList.add("visible");
      }, 0);
    });

    document.addEventListener("mousedown", (event) => {
      if (event.composedPath().includes(ui.selection) || event.composedPath().includes(ui.composer)) return;
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) hideSelectionButton();
      }, 0);
    });
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
      quote,
      prefix,
      suffix,
      textStart: Number.isFinite(offsets.start) ? offsets.start : null,
      textEnd: Number.isFinite(offsets.end) ? offsets.end : null,
      path: cssPath(closestElement(range.startContainer)),
    };
  }

  function openComposer() {
    if (!state.pendingSelection) return;
    hideSelectionButton();
    const rect = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0).getBoundingClientRect() : null;
    ui.composer.querySelector(".quote").textContent = state.pendingSelection.quote.slice(0, 260);
    ui.composer.querySelector("textarea").value = "";
    ui.composer.style.left = `${Math.max(8, Math.min(window.innerWidth - 370, rect?.left || 16))}px`;
    ui.composer.style.top = `${Math.min(window.innerHeight - 180, Math.max(8, (rect?.bottom || 80) + 8))}px`;
    ui.composer.classList.add("open");
    ui.composer.querySelector("textarea").focus();
  }

  function closeComposer() {
    ui.composer.classList.remove("open");
    state.pendingSelection = null;
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
    state.socket?.send(JSON.stringify({
      type: "create-comment",
      comment: {
        ...state.pendingSelection,
        body,
        author,
        pagePath: location.pathname,
      },
    }));
    closeComposer();
    window.getSelection()?.removeAllRanges();
  }

  function renderComments() {
    ui.count.textContent = String(state.comments.length);
    if (!state.comments.length) {
      ui.comments.innerHTML = `<div class="empty">Select text on the page to leave the first comment.</div>`;
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
      item.querySelector(".meta").textContent = `${comment.author} · ${formatTime(comment.created)}`;
      item.querySelector(".quote").textContent = compact(comment.quote, 220);
      item.querySelector(".body").textContent = comment.body;
      item.addEventListener("click", () => scrollToComment(comment));
      ui.comments.appendChild(item);
    }
    updateHighlights();
  }

  function renderStatus(message, viewerCount) {
    const connection = state.connected ? "Connected" : "Offline";
    const viewers = Number.isFinite(viewerCount) ? ` · ${viewerCount} viewer${viewerCount === 1 ? "" : "s"}` : "";
    ui.status.textContent = message || `${connection}${viewers}`;
    ui.mini.textContent = state.connected ? "Live" : "Offline";
  }

  function hideSelectionButton() {
    ui.selection.classList.remove("visible");
  }

  function updateHighlights() {
    state.highlights = [];
    if (!("CSS" in window) || !CSS.highlights || typeof Highlight === "undefined") return;
    for (const comment of state.comments) {
      const range = findRangeForComment(comment);
      if (range) state.highlights.push(range);
    }
    CSS.highlights.set("tunelito-comments", new Highlight(...state.highlights));
  }

  function scrollToComment(comment) {
    const range = findRangeForComment(comment);
    if (!range) return;
    const node = closestElement(range.startContainer);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    flashRange(range);
  }

  function findRangeForComment(comment) {
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
    style.textContent = `::highlight(tunelito-comments) { background: rgba(45, 212, 191, .28); }`;
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

  function compact(value, length) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
})();
