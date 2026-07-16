(function () {
  const script = document.currentScript;
  const sourceName = script?.dataset?.sourceName || document.title || "HTML page";
  const configuredLiveMode = script?.dataset?.liveMode === "true";
  const configuredDefaultAuthor = script?.dataset?.defaultAuthor || "";
  const configuredViewerRole = script?.dataset?.viewerRole === "owner" ? "owner" : "visitor";
  const configuredOwnerSession = script?.dataset?.ownerSession || "";
  const endpointBase = "/__tunelito";
  const locationParams = new URLSearchParams(location.search);
  const accessKey = locationParams.get("tunelito_key") || "";
  const pagePath = script?.dataset?.pagePath || location.pathname || "/";
  const initialIdentity = createInitialIdentity(configuredDefaultAuthor, configuredViewerRole, configuredOwnerSession);
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
    peerLasers: new Map(),
    peerSelections: new Map(),
    viewerCount: null,
    viewerRole: configuredViewerRole,
    ownerSession: configuredOwnerSession,
    reviewerId: initialIdentity.reviewerId,
    author: initialIdentity.author,
    pendingReviewerRename: null,
    laserPointerEnabled: false,
    laserPointerAvailable: hasFinePointer(),
    laserPointerPressed: false,
    laserPointerVisible: false,
    pendingLaserPointer: null,
    laserPointerTimer: null,
    comments: [],
    handoffPending: false,
    reviewCompleted: null,
    agentStatusUrl: "",
    agentStatuses: {},
    agentStatusFingerprint: "",
    agentStatusTimer: null,
    pendingSelection: null,
    reloadQueued: false,
    reloadTimer: null,
    highlights: [],
    selectionTimer: null,
    cursorTimer: null,
    pendingCursor: null,
    sharedSelectionActive: false,
  };

  addDocumentHighlightStyle();
  persistIdentity();
  const ui = mountUi();
  updateIdentityUi();
  updateLaserToggle();
  connect();
  bindSelection();

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socketUrl = new URL(`${protocol}//${location.host}${endpointBase}/ws`);
    if (accessKey) socketUrl.searchParams.set("tunelito_key", accessKey);
    socketUrl.searchParams.set("tunelito_page", state.pagePath);
    if (state.reviewerId) socketUrl.searchParams.set("tunelito_reviewer_id", state.reviewerId);
    const socket = new WebSocket(socketUrl);
    state.socket = socket;

    socket.addEventListener("open", () => {
      state.connected = true;
      sendPendingReviewerRename();
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
        state.viewerRole = message.authorRole === "owner" ? "owner" : "visitor";
        state.ownerSession = message.ownerSession || state.ownerSession;
        state.reviewerId = message.reviewerId || state.reviewerId;
        if (state.viewerRole === "owner" && message.defaultAuthor && !state.author) {
          state.author = message.defaultAuthor;
        }
        persistIdentity();
        updateIdentityUi();
        state.viewerCount = message.viewerCount;
        state.comments = message.comments || [];
        queueCurrentAuthorRenameIfNeeded();
        applyPendingReviewerRename();
        state.agentStatusUrl = message.agentStatusUrl || "";
        setAgentStatuses(message.agentStatuses);
        scheduleAgentStatusPoll(2500);
        state.peers = new Map((message.peers || []).map((peer) => [peer.id, peer]));
        updateCommentsLink(message.commentsUrl);
        renderComments();
        renderStatus(null, message.viewerCount);
        if (state.liveMode) connectToExistingPeers(message.peers || []);
      } else if (message.type === "comment") {
        addComment(message.comment);
        fetchAgentStatuses();
      } else if (message.type === "comment-updated") {
        updateComment(message.comment);
        fetchAgentStatuses();
      } else if (message.type === "reviewer-renamed") {
        handleReviewerRenamed(message);
      } else if (message.type === "review-completed") {
        handleReviewCompleted(message.event);
      } else if (message.type === "viewer-count") {
        renderStatus(null, message.count);
      } else if (message.type === "document-changed") {
        handleDocumentChanged();
      } else if (message.type === "peer-joined") {
        handlePeerJoined(message.peer);
      } else if (message.type === "peer-left") {
        handlePeerLeft(message.peerId);
      } else if (message.type === "signal") {
        handleSignal(message.from, message.signal);
      } else if (message.type === "live-event") {
        if (message.from !== state.peerId) handleLiveEvent(message.from, message.event);
      } else if (message.type === "error") {
        state.handoffPending = false;
        updateHandoffUi();
        renderStatus(message.message);
      }
    });
  }

  function mountUi() {
    const host = document.createElement("div");
    host.id = "tunelito-root";
    host.toggleAttribute("data-markdown", Boolean(document.querySelector(".tunelito-markdown[data-tunelito-source-type='markdown']")));
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
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(148, 163, 184, .36);
          border-radius: 999px;
          background: rgba(15, 23, 42, .66);
          color: #fff;
          padding: 0;
          box-shadow: 0 10px 28px rgba(15, 23, 42, .22);
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
          backdrop-filter: blur(14px) saturate(1.2);
          -webkit-backdrop-filter: blur(14px) saturate(1.2);
          transition: background .16s ease, border-color .16s ease, transform .16s ease;
        }
        :host([data-markdown]) .launcher {
          right: 72px;
        }
        .launcher:hover,
        .launcher.active {
          border-color: rgba(45, 212, 191, .72);
          background: rgba(15, 118, 110, .88);
          transform: translateY(-1px);
        }
        .launcher:focus-visible {
          outline: 2px solid #2dd4bf;
          outline-offset: 3px;
        }
        .launcher-glyph {
          position: relative;
          display: block;
          width: 18px;
          height: 14px;
          border: 2px solid currentColor;
          border-radius: 5px;
        }
        .launcher-glyph::before {
          content: "";
          position: absolute;
          left: 4px;
          right: 4px;
          top: 3px;
          height: 2px;
          border-radius: 999px;
          background: currentColor;
          box-shadow: 0 4px 0 currentColor;
          opacity: .86;
        }
        .launcher-glyph::after {
          content: "";
          position: absolute;
          left: 4px;
          bottom: -6px;
          width: 7px;
          height: 7px;
          border-left: 2px solid currentColor;
          border-bottom: 2px solid currentColor;
          transform: skew(-28deg);
        }
        .count {
          position: absolute;
          top: -6px;
          right: -6px;
          min-width: 18px;
          height: 18px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          border: 2px solid #fff;
          background: #0f766e;
          color: #fff;
          font: 800 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 0 4px;
        }
        .count[hidden] {
          display: none;
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
          padding: 12px 14px;
          border-bottom: 1px solid #eef2f7;
          background: #f8fafc;
        }
        .identity-card {
          display: grid;
          gap: 8px;
          min-width: 0;
          border: 1px solid #dbe5ef;
          border-radius: 8px;
          background: #fff;
          padding: 10px;
        }
        .identity-label {
          color: #64748b;
          font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          text-transform: uppercase;
          letter-spacing: 0;
        }
        .identity-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .identity-name {
          flex: 1;
          min-width: 0;
          overflow-wrap: anywhere;
          color: #172033;
          font: 800 15px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .identity-edit {
          flex: 0 0 auto;
          border: 1px solid #d7dde8;
          border-radius: 7px;
          background: #fff;
          color: #0f766e;
          cursor: pointer;
          font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 9px;
        }
        .identity-edit:hover { border-color: #99f6e4; background: #f0fdfa; }
        .identity-edit:focus-visible {
          outline: 2px solid #2dd4bf;
          outline-offset: 2px;
        }
        .identity-form {
          display: grid;
          gap: 8px;
        }
        .identity-form[hidden] { display: none; }
        .identity-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
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
        .note-actions button[hidden] {
          display: none;
        }
        .handoff {
          display: grid;
          gap: 6px;
          padding: 10px 14px;
          border-bottom: 1px solid #eef2f7;
          background: #fff;
        }
        .handoff-button {
          width: 100%;
        }
        .handoff-status {
          min-height: 16px;
          color: #64748b;
          font: 600 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow-wrap: anywhere;
        }
        .pointer-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .pointer-button[aria-pressed="true"] {
          border-color: #f87171;
          background: #fff1f2;
          color: #991b1b;
        }
        .pointer-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          border: 1px solid #fecaca;
          background: #ef4444;
          box-shadow: 0 0 0 3px rgba(239, 68, 68, .14);
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
        .comment.work-active {
          border-color: #5eead4;
          background: #f0fdfa;
        }
        .comment.work-done {
          border-color: #86efac;
          background: #f7fef9;
        }
        .comment.work-warning {
          border-color: #facc15;
          background: #fefce8;
        }
        .comment.work-danger {
          border-color: #fca5a5;
          background: #fff7f7;
        }
        .comment.work-muted {
          background: #f8fafc;
        }
        .meta-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
        }
        .meta-row .meta {
          min-width: 0;
          margin-bottom: 0;
        }
        .work-badge {
          flex: 0 0 auto;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border: 1px solid #cbd5e1;
          border-radius: 999px;
          background: #f8fafc;
          color: #475569;
          font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 5px 7px;
        }
        .work-badge.active { border-color: #2dd4bf; background: #ccfbf1; color: #115e59; }
        .work-badge.done { border-color: #86efac; background: #dcfce7; color: #166534; }
        .work-badge.warning { border-color: #fde047; background: #fef9c3; color: #854d0e; }
        .work-badge.danger { border-color: #fca5a5; background: #fee2e2; color: #991b1b; }
        .work {
          display: none;
          margin-top: 9px;
          border-top: 1px solid rgba(148, 163, 184, .28);
          padding-top: 8px;
        }
        .work.visible { display: block; }
        .approval {
          display: none;
          margin-top: 8px;
          color: #0f766e;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        .approval.visible { display: block; }
        .comment-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 9px;
        }
        .approve-button {
          border: 1px solid #99f6e4;
          border-radius: 7px;
          background: #f0fdfa;
          color: #0f766e;
          cursor: pointer;
          font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 9px;
        }
        .approve-button:hover { border-color: #2dd4bf; background: #ccfbf1; }
        .approve-button:focus-visible {
          outline: 2px solid #2dd4bf;
          outline-offset: 2px;
        }
        .work-list {
          display: grid;
          gap: 5px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .work-task {
          display: grid;
          grid-template-columns: 16px 1fr;
          gap: 6px;
          align-items: start;
          color: #334155;
          font-size: 12px;
        }
        .work-task::before {
          content: "";
          width: 13px;
          height: 13px;
          margin-top: 2px;
          border: 1px solid #94a3b8;
          border-radius: 4px;
          background: #fff;
        }
        .work-task.done {
          color: #64748b;
          text-decoration: line-through;
          text-decoration-thickness: 1px;
        }
        .work-task.done::before {
          border-color: #16a34a;
          background: #16a34a;
          box-shadow: inset 0 0 0 3px #fff;
        }
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
          overflow-wrap: anywhere;
        }
        .meta-row .meta { margin-bottom: 0; }
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
        .laser,
        .peer-laser {
          position: fixed;
          left: 0;
          top: 0;
          z-index: 2147483643;
          width: 32px;
          height: 32px;
          border: 2px solid rgba(255, 241, 242, .9);
          border-radius: 999px;
          background: rgba(239, 68, 68, .38);
          box-shadow: 0 0 0 1px rgba(127, 29, 29, .18), 0 0 22px rgba(239, 68, 68, .38);
          opacity: 0;
          pointer-events: none;
          transform: translate3d(var(--laser-x, -999px), var(--laser-y, -999px), 0) translate(-50%, -50%) scale(var(--laser-scale, 1));
          transition: opacity .12s ease, transform .05s linear;
        }
        .laser.visible,
        .peer-laser.visible {
          opacity: .88;
        }
        .laser.pressed,
        .peer-laser.pressed {
          --laser-scale: .58;
        }
        .peer-laser {
          width: 28px;
          height: 28px;
          border-color: rgba(255, 251, 235, .95);
          background: rgba(245, 158, 11, .36);
          box-shadow: 0 0 0 1px rgba(146, 64, 14, .18), 0 0 20px rgba(245, 158, 11, .34);
        }
        .composer {
          position: fixed;
          z-index: 2147483647;
          display: none;
          width: min(360px, calc(100vw - 24px));
          max-height: calc(100vh - 16px);
          overflow: auto;
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
            right: max(10px, env(safe-area-inset-right));
            bottom: calc(80px + env(safe-area-inset-bottom));
            width: 44px;
            height: 44px;
            box-shadow: 0 8px 22px rgba(15, 23, 42, .2);
          }
          :host([data-markdown]) .launcher {
            right: max(10px, env(safe-area-inset-right));
          }
          .launcher.active {
            display: none;
          }
          .launcher-glyph {
            transform: scale(.88);
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
            min-height: 44px;
            padding: 10px 12px;
          }
          .identity-edit {
            min-height: 44px;
            padding: 10px 12px;
          }
          .approve-button {
            min-height: 44px;
            padding: 10px 12px;
          }
        }
      </style>
      <button class="launcher" type="button" title="Open Tunelito comments" aria-label="Open Tunelito comments" aria-expanded="false">
        <span class="launcher-glyph" aria-hidden="true"></span>
        <span class="count" hidden>0</span>
      </button>
      <button class="selection">Comment</button>
      <div class="laser" aria-hidden="true"></div>
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
          <div class="identity-card">
            <div class="identity-label">Assigned as</div>
            <div class="identity-row">
              <strong class="identity-name"></strong>
              <button class="identity-edit" type="button" title="Edit reviewer name" aria-label="Edit reviewer name">Edit</button>
            </div>
            <form class="identity-form" hidden>
              <input class="name" autocomplete="name" placeholder="Reviewer name" />
              <div class="identity-actions">
                <button class="secondary" data-action="cancel-name" type="button">Cancel</button>
                <button class="primary" data-action="save-name" type="submit">Save</button>
              </div>
            </form>
          </div>
        </div>
        <div class="note-actions" aria-label="Add unanchored comment">
          <button class="secondary" data-action="page-note">Page note</button>
          <button class="secondary" data-action="site-note">Site note</button>
          <button class="secondary pointer-button" data-action="laser-pointer" type="button" aria-pressed="false" title="Toggle laser pointer">
            <span class="pointer-dot" aria-hidden="true"></span>
            <span>Pointer</span>
          </button>
        </div>
        <div class="handoff">
          <button class="primary handoff-button" data-action="done-reviewing" type="button">Done Reviewing</button>
          <span class="handoff-status" aria-live="polite"></span>
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
    const laser = shadow.querySelector(".laser");
    const identityCard = shadow.querySelector(".identity-card");
    const identityName = shadow.querySelector(".identity-name");
    const identityEdit = shadow.querySelector(".identity-edit");
    const identityForm = shadow.querySelector(".identity-form");
    const name = shadow.querySelector(".name");
    const laserToggle = shadow.querySelector("[data-action='laser-pointer']");
    const handoffButton = shadow.querySelector("[data-action='done-reviewing']");
    const markdownLink = shadow.querySelector(".link");
    shadow.querySelector(".title strong").textContent = sourceName;
    markdownLink.href = withAccessKey(`${endpointBase}/comments.md`);
    markdownLink.hidden = configuredLiveMode;

    launcher.addEventListener("click", () => setPanelOpen(!panel.classList.contains("open")));
    shadow.querySelector(".icon-button").addEventListener("click", () => setPanelOpen(false));
    identityEdit.addEventListener("click", () => openIdentityEditor());
    identityForm.addEventListener("submit", (event) => {
      event.preventDefault();
      commitIdentityName();
    });
    identityForm.querySelector("[data-action='cancel-name']").addEventListener("click", () => closeIdentityEditor({ restoreFocus: true }));
    name.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeIdentityEditor({ restoreFocus: true });
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
    handoffButton.addEventListener("click", sendReviewCompleted);
    laserToggle.addEventListener("click", () => setLaserPointerEnabled(!state.laserPointerEnabled));
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
      laser,
      composer,
      count: shadow.querySelector(".count"),
      comments: shadow.querySelector(".comments"),
      status: shadow.querySelector(".status"),
      mini: shadow.querySelector(".mini"),
      markdownLink,
      identityCard,
      identityName,
      identityEdit,
      identityForm,
      name,
      laserToggle,
      handoffButton,
      handoffStatus: shadow.querySelector(".handoff-status"),
    };
  }

  function withAccessKey(path) {
    const url = new URL(path, location.href);
    if (accessKey) url.searchParams.set("tunelito_key", accessKey);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function setPanelOpen(open) {
    ui.panel.classList.toggle("open", open);
    ui.launcher.classList.toggle("active", open);
    ui.launcher.setAttribute("aria-expanded", String(open));
    window.dispatchEvent(new CustomEvent("tunelito:comments-panel", { detail: { open } }));
  }

  function setLaserPointerEnabled(enabled) {
    state.laserPointerAvailable = hasFinePointer();
    state.laserPointerEnabled = Boolean(enabled && state.laserPointerAvailable);
    if (!state.laserPointerEnabled) {
      hideLaserPointer({ broadcast: true });
    }
    updateLaserToggle();
  }

  function updateLaserToggle() {
    state.laserPointerAvailable = hasFinePointer();
    if (!state.laserPointerAvailable && state.laserPointerEnabled) {
      state.laserPointerEnabled = false;
      hideLaserPointer({ broadcast: true });
    }
    ui.laserToggle.hidden = !state.laserPointerAvailable;
    ui.laserToggle.setAttribute("aria-pressed", String(state.laserPointerEnabled));
    ui.laserToggle.classList.toggle("active", state.laserPointerEnabled);
  }

  function updateIdentityUi() {
    const author = state.author || (state.viewerRole === "owner" ? (configuredDefaultAuthor || "Owner") : "Reviewer");
    ui.identityName.textContent = author;
    ui.name.value = author;
  }

  function openIdentityEditor() {
    ui.identityForm.hidden = false;
    ui.identityCard.classList.add("editing");
    ui.name.value = state.author || "";
    ui.name.focus();
    ui.name.select();
  }

  function closeIdentityEditor({ restoreFocus = false } = {}) {
    ui.identityForm.hidden = true;
    ui.identityCard.classList.remove("editing");
    ui.name.value = state.author || "";
    if (restoreFocus) ui.identityEdit.focus({ preventScroll: true });
  }

  function commitIdentityName() {
    const author = ui.name.value.trim();
    if (!author) {
      renderStatus("Reviewer name is required.");
      ui.name.focus();
      return;
    }

    renameCurrentReviewer(author);
    closeIdentityEditor({ restoreFocus: true });
  }

  function renameCurrentReviewer(author) {
    if (state.author === author) return;
    state.author = author;
    persistIdentity();
    state.pendingReviewerRename = {
      reviewerId: state.reviewerId,
      authorRole: state.viewerRole,
      author,
    };
    renameVisibleComments(state.reviewerId, state.viewerRole, author);
    updateIdentityUi();
    sendPendingReviewerRename();
  }

  function applyPendingReviewerRename() {
    const pending = state.pendingReviewerRename;
    if (!pending) return;
    renameVisibleComments(pending.reviewerId, pending.authorRole, pending.author);
    sendPendingReviewerRename();
  }

  function queueCurrentAuthorRenameIfNeeded() {
    const author = currentAuthor("");
    if (!author || !state.reviewerId) return;
    const hasOlderCommentAuthor = state.comments.some((comment) => (
      comment?.reviewerId === state.reviewerId
      && normalizeAuthorRole(comment.authorRole) === normalizeAuthorRole(state.viewerRole)
      && comment.author !== author
    ));
    if (!hasOlderCommentAuthor) return;
    state.pendingReviewerRename = {
      reviewerId: state.reviewerId,
      authorRole: state.viewerRole,
      author,
    };
  }

  function sendPendingReviewerRename() {
    const pending = state.pendingReviewerRename;
    if (!pending || state.socket?.readyState !== WebSocket.OPEN) return;
    state.socket.send(JSON.stringify({
      type: "rename-reviewer",
      author: pending.author,
    }));
  }

  function sendReviewCompleted() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      renderStatus("Still connecting; try again in a moment.");
      return;
    }
    state.handoffPending = true;
    updateHandoffUi();
    state.socket.send(JSON.stringify({
      type: "review-completed",
      overallComment: "",
    }));
  }

  function handleReviewCompleted(event) {
    state.handoffPending = false;
    state.reviewCompleted = event || null;
    updateHandoffUi();
    if (event?.sequence) renderStatus(`Review sent #${event.sequence}`);
  }

  function updateHandoffUi() {
    ui.handoffButton.disabled = state.handoffPending;
    ui.handoffButton.textContent = state.handoffPending ? "Sending..." : "Done Reviewing";
    ui.handoffStatus.textContent = state.reviewCompleted?.sequence
      ? `Sent #${state.reviewCompleted.sequence}`
      : "";
  }

  function handleReviewerRenamed(message) {
    if (message?.author) {
      renameVisibleComments(message.reviewerId, message.authorRole, message.author);
    }
    const pending = state.pendingReviewerRename;
    if (
      pending
      && message?.author === pending.author
      && message?.reviewerId === pending.reviewerId
      && normalizeAuthorRole(message?.authorRole) === normalizeAuthorRole(pending.authorRole)
    ) {
      state.pendingReviewerRename = null;
    }
  }

  function renameVisibleComments(reviewerId, authorRole, author) {
    if (!reviewerId) return;
    let changed = false;
    state.comments = state.comments.map((comment) => {
      if (comment?.reviewerId !== reviewerId || normalizeAuthorRole(comment.authorRole) !== normalizeAuthorRole(authorRole) || comment.author === author) {
        return comment;
      }
      changed = true;
      return { ...comment, author };
    });
    if (changed) renderComments();
  }

  function bindSelection() {
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerdown", handleLaserPointerDown, { passive: true });
    document.addEventListener("pointerup", handleLaserPointerUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => hideLaserPointer({ broadcast: true }));
    document.addEventListener("mouseup", scheduleSelectionCapture);
    document.addEventListener("keyup", scheduleSelectionCapture);
    document.addEventListener("selectionchange", scheduleSelectionCapture);
    document.addEventListener("touchend", scheduleSelectionCapture, { passive: true });
    window.addEventListener("resize", () => {
      if (ui.composer.classList.contains("open")) positionComposer(state.pendingSelection?.rect || null);
      updateLaserToggle();
    });

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

  function handlePointerMove(event) {
    sharePointerPosition(event);
    updateLaserPointer(event);
  }

  function handleLaserPointerDown(event) {
    if (!state.laserPointerEnabled || isEventInsideTunelito(event)) return;
    state.laserPointerPressed = true;
    updateLaserPointer(event);
  }

  function handleLaserPointerUp(event) {
    if (!state.laserPointerEnabled) return;
    state.laserPointerPressed = false;
    updateLaserPointer(event);
  }

  function updateLaserPointer(event) {
    if (!state.laserPointerEnabled || !state.laserPointerAvailable) return;
    if (isEventInsideTunelito(event)) {
      hideLaserPointer({ broadcast: true });
      return;
    }

    showLaserPointer(event.pageX, event.pageY, state.laserPointerPressed);
    queueLaserPointerBroadcast({
      active: true,
      x: event.pageX,
      y: event.pageY,
      pressed: state.laserPointerPressed,
      author: currentAuthor("Reviewer"),
    });
  }

  function showLaserPointer(pageX, pageY, pressed = false) {
    positionLaserElement(ui.laser, pageX, pageY, pressed);
    ui.laser.classList.add("visible");
    state.laserPointerVisible = true;
  }

  function hideLaserPointer({ broadcast = false } = {}) {
    if (!state.laserPointerVisible && !broadcast) return;
    ui.laser.classList.remove("visible", "pressed");
    state.laserPointerVisible = false;
    state.laserPointerPressed = false;
    if (broadcast) {
      queueLaserPointerBroadcast({
        active: false,
        author: currentAuthor("Reviewer"),
      });
    }
  }

  function positionLaserElement(element, pageX, pageY, pressed = false) {
    element.style.setProperty("--laser-x", `${Math.round(pageX - window.scrollX)}px`);
    element.style.setProperty("--laser-y", `${Math.round(pageY - window.scrollY)}px`);
    element.classList.toggle("pressed", Boolean(pressed));
  }

  function queueLaserPointerBroadcast(event) {
    if (!state.liveMode || !event) return;
    state.pendingLaserPointer = event;
    if (state.laserPointerTimer) return;
    state.laserPointerTimer = setTimeout(() => {
      state.laserPointerTimer = null;
      if (state.pendingLaserPointer) {
        broadcastLiveEvent({ type: "laser-pointer", ...state.pendingLaserPointer });
      }
      state.pendingLaserPointer = null;
    }, 40);
  }

  function isEventInsideTunelito(event) {
    return event.composedPath().includes(ui.shadow.host);
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
    ui.composer.classList.add("open");
    positionComposer(rect);
    ui.composer.querySelector("textarea").focus();
  }

  function openNoteComposer(scope) {
    setPanelOpen(true);
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
    flushQueuedReload();
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
    const author = currentAuthor("Anonymous");
    state.author = author;
    persistIdentity();
    const comment = {
      ...(state.liveMode ? { id: createEventId("c"), created: new Date().toISOString() } : {}),
      ...state.pendingSelection,
      scope: normalizeScope(state.pendingSelection.scope),
      body,
      author,
      authorRole: state.viewerRole,
      reviewerId: state.reviewerId,
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

  function handleDocumentChanged() {
    if (isComposerOpen()) {
      queueReloadUntilComposerCloses();
      return;
    }
    scheduleDocumentReload();
  }

  function queueReloadUntilComposerCloses() {
    state.reloadQueued = true;
    renderStatus("Page changed; reload queued until this comment is submitted or closed.");
  }

  function flushQueuedReload() {
    if (!state.reloadQueued) return;
    if (isComposerOpen()) return;
    scheduleDocumentReload();
  }

  function scheduleDocumentReload() {
    state.reloadQueued = false;
    renderStatus("Page changed; reloading...");
    if (state.reloadTimer) return;
    state.reloadTimer = setTimeout(() => {
      state.reloadTimer = null;
      if (isComposerOpen()) {
        queueReloadUntilComposerCloses();
        return;
      }
      location.reload();
    }, 500);
  }

  function isComposerOpen() {
    return ui.composer.classList.contains("open");
  }

  function addComment(comment) {
    if (!comment) return;
    if (comment.id && state.comments.some((existing) => existing.id === comment.id)) return;
    state.comments.push(comment);
    renderComments();
  }

  function updateComment(comment) {
    if (!comment?.id) return;
    const index = state.comments.findIndex((existing) => existing.id === comment.id);
    if (index >= 0) {
      state.comments[index] = comment;
    } else {
      state.comments.push(comment);
    }
    renderComments();
  }

  function renderComments() {
    const count = state.comments.length;
    ui.count.textContent = count > 99 ? "99+" : String(count);
    ui.count.hidden = count === 0;
    const launcherLabel = count ? `Open Tunelito comments (${count})` : "Open Tunelito comments";
    ui.launcher.setAttribute("aria-label", launcherLabel);
    ui.launcher.title = launcherLabel;
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
        <div class="meta-row">
          <div class="meta"></div>
          <div class="work-badge" hidden></div>
        </div>
        <div class="quote"></div>
        <div class="body"></div>
        <div class="approval"></div>
        <div class="work" aria-label="Agent work status">
          <ul class="work-list"></ul>
        </div>
        <div class="comment-actions">
          <button class="approve-button" type="button" data-action="approve-agent" hidden>Approve for agent</button>
        </div>
      `;
      const scope = normalizeScope(comment.scope);
      const quote = item.querySelector(".quote");
      const hasQuote = Boolean(String(comment.quote || "").trim());
      item.querySelector(".meta").textContent = `${comment.author}${comment.authorRole === "owner" ? " (owner)" : ""} · ${scope} · ${formatTime(comment.created)}`;
      quote.textContent = hasQuote ? compact(comment.quote, 220) : `${scopeLabel(scope)} note`;
      quote.classList.toggle("note", !hasQuote);
      item.querySelector(".body").textContent = comment.body;
      renderCommentApproval(item, comment);
      renderCommentWorkStatus(item, comment);
      item.addEventListener("click", () => scrollToComment(comment));
      ui.comments.appendChild(item);
    }
    updateHighlights();
  }

  function renderCommentWorkStatus(item, comment) {
    const status = workStatusForComment(comment);
    if (!status) return;
    item.classList.add(`work-${status.tone || "pending"}`);
    const badge = item.querySelector(".work-badge");
    badge.hidden = false;
    badge.textContent = status.label || status.status || "Queued";
    badge.classList.add(status.tone || "pending");

    const tasks = [
      ...(Array.isArray(status.done) ? status.done.map((text) => ({ text, done: true })) : []),
      ...(Array.isArray(status.todo) ? status.todo.map((text) => ({ text, done: false })) : []),
    ].filter((task) => task.text);
    if (!tasks.length) return;

    const work = item.querySelector(".work");
    const list = item.querySelector(".work-list");
    for (const task of tasks.slice(0, 4)) {
      const row = document.createElement("li");
      row.className = `work-task${task.done ? " done" : ""}`;
      row.textContent = task.text;
      list.appendChild(row);
    }
    work.classList.add("visible");
  }

  function renderCommentApproval(item, comment) {
    const approval = ownerApprovalForComment(comment);
    const approvalLabel = item.querySelector(".approval");
    if (approval) {
      approvalLabel.textContent = `Approved for agent by ${approval.approvedBy || "owner"}`;
      approvalLabel.classList.add("visible");
    }

    const approveButton = item.querySelector("[data-action='approve-agent']");
    const canApprove = state.viewerRole === "owner"
      && !state.liveMode
      && comment?.authorRole !== "owner"
      && !approval;
    item.querySelector(".comment-actions").hidden = !canApprove;
    approveButton.hidden = !canApprove;
    approveButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      approveCommentForAgent(comment);
    });
  }

  function approveCommentForAgent(comment) {
    if (!comment?.id) return;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      renderStatus("Still connecting; try again in a moment.");
      return;
    }
    state.socket.send(JSON.stringify({
      type: "approve-comment",
      id: comment.id,
      approvedBy: currentAuthor(configuredDefaultAuthor || "Owner"),
    }));
  }

  function ownerApprovalForComment(comment) {
    const approval = comment?.ownerApproval;
    return approval?.approvedAt ? approval : null;
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

  function setAgentStatuses(payload) {
    const comments = payload && typeof payload === "object" && payload.comments && typeof payload.comments === "object"
      ? payload.comments
      : {};
    state.agentStatuses = comments;
    state.agentStatusFingerprint = JSON.stringify(comments);
  }

  async function fetchAgentStatuses() {
    if (!state.agentStatusUrl) return;
    try {
      const response = await fetch(agentStatusFetchPath(), { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const comments = payload?.comments && typeof payload.comments === "object" ? payload.comments : {};
      const fingerprint = JSON.stringify(comments);
      if (fingerprint === state.agentStatusFingerprint) return;
      state.agentStatuses = comments;
      state.agentStatusFingerprint = fingerprint;
      renderComments();
    } catch {
      // Status badges are best-effort; comments still work if the tracker is unavailable.
    }
  }

  function scheduleAgentStatusPoll(delayMs) {
    if (state.agentStatusTimer) {
      clearTimeout(state.agentStatusTimer);
      state.agentStatusTimer = null;
    }
    if (!state.agentStatusUrl) return;
    state.agentStatusTimer = setTimeout(async () => {
      state.agentStatusTimer = null;
      await fetchAgentStatuses();
      scheduleAgentStatusPoll(2500);
    }, delayMs);
  }

  function agentStatusFetchPath() {
    const url = new URL(state.agentStatusUrl, location.href);
    url.searchParams.set("tunelito_page", state.pagePath);
    if (accessKey) url.searchParams.set("tunelito_key", accessKey);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function workStatusForComment(comment) {
    if (!state.agentStatusUrl || !comment?.id) return null;
    return state.agentStatuses[comment.id] || {
      id: comment.id,
      status: "pending",
      label: "Queued",
      tone: "pending",
      done: [],
      todo: [compact(comment.body || comment.quote || "Waiting for agent review", 160)],
    };
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
    removePeerLaser(peerId);
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
    } else if (event.type === "laser-pointer") {
      renderPeerLaser(peerId, event);
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
      author: currentAuthor("Reviewer"),
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
        author: currentAuthor("Reviewer"),
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

    entry.element.querySelector(".label").textContent = event.author || "Reviewer";
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

  function renderPeerLaser(peerId, event) {
    if (!event?.active) {
      removePeerLaser(peerId);
      return;
    }

    let entry = state.peerLasers.get(peerId);
    if (!entry) {
      const element = document.createElement("div");
      element.className = "peer-laser";
      element.setAttribute("aria-hidden", "true");
      ui.shadow.appendChild(element);
      entry = { element, timer: null };
      state.peerLasers.set(peerId, entry);
    }

    positionLaserElement(entry.element, Number(event.x) || 0, Number(event.y) || 0, event.pressed);
    entry.element.classList.add("visible");
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => removePeerLaser(peerId), 1600);
  }

  function removePeerLaser(peerId) {
    const entry = state.peerLasers.get(peerId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.element.remove();
    state.peerLasers.delete(peerId);
  }

  function resetPeerConnections() {
    for (const peerId of Array.from(state.peerConnections.keys())) closePeerConnection(peerId);
    state.peerConnections.clear();
    state.dataChannels.clear();
    state.pendingIceCandidates.clear();
    state.peerSelections.clear();
    for (const peerId of Array.from(state.peerCursors.keys())) removePeerCursor(peerId);
    for (const peerId of Array.from(state.peerLasers.keys())) removePeerLaser(peerId);
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

  function positionComposer(anchorRect) {
    if (isMobileViewport()) {
      ui.composer.style.left = "";
      ui.composer.style.top = "";
      return;
    }

    const margin = 8;
    const composerRect = ui.composer.getBoundingClientRect();
    const width = composerRect.width || Math.min(360, window.innerWidth - 24);
    const height = composerRect.height || 180;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const anchorLeft = Number.isFinite(anchorRect?.left) ? anchorRect.left : 16;
    const anchorTop = Number.isFinite(anchorRect?.top) ? anchorRect.top : 80;
    const anchorBottom = Number.isFinite(anchorRect?.bottom) ? anchorRect.bottom : anchorTop;
    const belowTop = anchorBottom + margin;
    const aboveTop = anchorTop - height - margin;
    const fitsBelow = belowTop + height <= window.innerHeight - margin;
    const fitsAbove = aboveTop >= margin;
    const preferredTop = fitsBelow || !fitsAbove ? belowTop : aboveTop;

    ui.composer.style.left = `${clamp(anchorLeft, margin, maxLeft)}px`;
    ui.composer.style.top = `${clamp(preferredTop, margin, maxTop)}px`;
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
    const commentSurface = root === document.body
      ? document.querySelector("[data-tunelito-comment-surface]") || root
      : root;
    const nodes = [];
    const walker = document.createTreeWalker(commentSurface, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("#tunelito-root")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("[data-tunelito-comment-ignore]")) return NodeFilter.FILTER_REJECT;
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
    const boundaries = [selection.anchorNode, selection.focusNode].filter(Boolean);
    if (boundaries.some((node) => closestElement(node)?.closest?.("#tunelito-root, [data-tunelito-comment-ignore]"))) return true;
    const commentSurface = document.querySelector("[data-tunelito-comment-surface]");
    return Boolean(commentSurface && boundaries.some((node) => !commentSurface.contains(node)));
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

  function hasFinePointer() {
    const query = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    return query ? query.matches : true;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function compact(value, length) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function createInitialIdentity(defaultAuthor, viewerRole, ownerSession) {
    const storedAuthor = storedValue("tunelito:author");
    const storedRole = storedValue("tunelito:authorRole");
    const storedOwnerSession = storedValue("tunelito:ownerSession");
    const storedReviewerId = normalizeReviewerId(storedValue("tunelito:reviewerId"));
    if (viewerRole === "owner") {
      const reviewerId = normalizeReviewerId(ownerSession) || storedReviewerId || createReviewerId();
      const author = storedRole === "owner" && storedOwnerSession === ownerSession && storedAuthor
        ? storedAuthor
        : (defaultAuthor || friendlyReviewerName(reviewerId));
      return { reviewerId, author };
    }
    const reviewerId = storedRole !== "owner" && storedReviewerId ? storedReviewerId : createReviewerId();
    const author = storedRole !== "owner" && storedAuthor ? storedAuthor : friendlyReviewerName(reviewerId);
    return { reviewerId, author };
  }

  function currentAuthor(fallback) {
    return state.author || ui?.name?.value.trim() || fallback;
  }

  function persistIdentity() {
    storeValue("tunelito:author", state.author);
    storeValue("tunelito:authorRole", state.viewerRole);
    storeValue("tunelito:ownerSession", state.ownerSession);
    storeValue("tunelito:reviewerId", state.reviewerId);
  }

  function storedValue(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function storeValue(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Keep the review UI usable when browser storage is disabled.
    }
  }

  function createReviewerId() {
    const bytes = new Uint8Array(9);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    return `r_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function friendlyReviewerName(reviewerId) {
    const adjectives = ["Bright", "Clear", "Steady", "Fresh", "Kind", "Open", "True", "Calm", "Sharp", "Warm", "Quick", "Solid"];
    const nouns = ["Harbor", "Signal", "Cedar", "Bridge", "Canvas", "Field", "Anchor", "Ledger", "Beacon", "Marker", "Summit", "Compass"];
    let hash = 0;
    for (const char of String(reviewerId || "")) {
      hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    }
    return `${adjectives[hash % adjectives.length]} ${nouns[Math.floor(hash / adjectives.length) % nouns.length]}`;
  }

  function normalizeReviewerId(value) {
    return String(value || "")
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, 160)
      .replace(/[^A-Za-z0-9_-]/g, "");
  }

  function normalizeScope(scope) {
    return String(scope || "").toLowerCase() === "site" ? "site" : "page";
  }

  function normalizeAuthorRole(role) {
    return String(role || "").toLowerCase() === "owner" ? "owner" : "visitor";
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
