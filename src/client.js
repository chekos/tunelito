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
    showResolved: storedFlag("tunelito:show-resolved"),
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
  window.addEventListener("tunelito:source-editor-settled", flushQueuedReload);

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
        :host {
          all: initial;
          color-scheme: light;
          --ui-surface: #fff;
          --ui-surface-2: #f8fafc;
          --ui-text: #172033;
          --ui-text-2: #334155;
          --ui-muted: #5b6678;
          --ui-divider: #e5e9f0;
          --ui-border: #d7dde8;
          --ui-input-border: #8792a2;
          --ui-accent: #0f766e;
          --ui-accent-text: #0f766e;
          --ui-on-accent: #fff;
          --ui-accent-soft: #f0fdfa;
          --ui-accent-soft-2: #ccfbf1;
          --ui-accent-border: #5eead4;
          --ui-focus: #0f766e;
          --ui-ok-soft: #f3fcf6;
          --ui-ok-badge: #dcfce7;
          --ui-ok-border: #86efac;
          --ui-ok-text: #166534;
          --ui-ok-mark: #16a34a;
          --ui-warn-soft: #fefce8;
          --ui-warn-badge: #fef9c3;
          --ui-warn-border: #facc15;
          --ui-warn-text: #854d0e;
          --ui-danger-soft: #fff5f5;
          --ui-danger-badge: #fee2e2;
          --ui-danger-border: #fca5a5;
          --ui-danger-text: #991b1b;
          --ui-shadow: rgba(15, 23, 42, .25);
        }
        /* Dark tokens follow the reviewed page (dark Markdown themes, dark
           HTML pages) or the OS preference; see detectTone(). */
        :host([data-tone="dark"]) {
          color-scheme: dark;
          --ui-surface: #161b26;
          --ui-surface-2: #1c2230;
          --ui-text: #e6eaf2;
          --ui-text-2: #c5ccd8;
          --ui-muted: #9ba6b8;
          --ui-divider: #2a3242;
          --ui-border: #3a4457;
          --ui-input-border: #6f7b90;
          --ui-accent: #0f766e;
          --ui-accent-text: #5eead4;
          --ui-on-accent: #fff;
          --ui-accent-soft: rgba(45, 212, 191, .1);
          --ui-accent-soft-2: rgba(45, 212, 191, .18);
          --ui-accent-border: rgba(94, 234, 212, .5);
          --ui-focus: #5eead4;
          --ui-ok-soft: rgba(34, 197, 94, .08);
          --ui-ok-badge: rgba(34, 197, 94, .16);
          --ui-ok-border: rgba(134, 239, 172, .45);
          --ui-ok-text: #86efac;
          --ui-ok-mark: #22c55e;
          --ui-warn-soft: rgba(234, 179, 8, .08);
          --ui-warn-badge: rgba(234, 179, 8, .16);
          --ui-warn-border: rgba(250, 204, 21, .5);
          --ui-warn-text: #fcd34d;
          --ui-danger-soft: rgba(239, 68, 68, .08);
          --ui-danger-badge: rgba(239, 68, 68, .16);
          --ui-danger-border: rgba(252, 165, 165, .45);
          --ui-danger-text: #fca5a5;
          --ui-shadow: rgba(0, 0, 0, .55);
        }
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
        /* The launcher floats over arbitrary page content, so it keeps its own
           dark glass in both tones; the ring stays bright for that reason. */
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
          font: 800 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
          border: 1px solid var(--ui-border);
          border-radius: 10px;
          background: var(--ui-surface);
          color: var(--ui-text);
          box-shadow: 0 24px 70px var(--ui-shadow);
          font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .panel.open { display: grid; }
        .header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 13px 14px;
          border-bottom: 1px solid var(--ui-divider);
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
          color: var(--ui-muted);
          font-size: 12px;
        }
        .icon-button {
          width: 30px;
          height: 30px;
          border: 1px solid var(--ui-border);
          border-radius: 7px;
          background: var(--ui-surface);
          color: var(--ui-text-2);
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        .resolved-toggle {
          border: 1px solid var(--ui-border);
          border-radius: 999px;
          background: var(--ui-surface);
          color: var(--ui-text-2);
          cursor: pointer;
          font: 650 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 10px;
          white-space: nowrap;
        }
        .resolved-toggle[hidden] { display: none; }
        .resolution {
          margin: 0 0 8px;
          color: var(--ui-text-2);
          font-size: 13px;
        }
        .resolution[hidden] { display: none; }
        .identity {
          padding: 12px 14px;
          border-bottom: 1px solid var(--ui-divider);
          background: var(--ui-surface-2);
        }
        .identity-card {
          display: grid;
          gap: 8px;
          min-width: 0;
          border: 1px solid var(--ui-divider);
          border-radius: 8px;
          background: var(--ui-surface);
          padding: 10px;
        }
        .identity-label {
          color: var(--ui-muted);
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
          color: var(--ui-text);
          font: 800 15px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .identity-edit {
          flex: 0 0 auto;
          border: 1px solid var(--ui-border);
          border-radius: 7px;
          background: var(--ui-surface);
          color: var(--ui-accent-text);
          cursor: pointer;
          font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 9px;
        }
        .identity-edit:hover { border-color: var(--ui-accent-border); background: var(--ui-accent-soft); }
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
          border-bottom: 1px solid var(--ui-divider);
          background: var(--ui-surface);
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
          border-bottom: 1px solid var(--ui-divider);
          background: var(--ui-surface);
        }
        .handoff-button {
          width: 100%;
        }
        .handoff-status {
          min-height: 16px;
          color: var(--ui-muted);
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
          border-color: var(--ui-danger-border);
          background: var(--ui-danger-badge);
          color: var(--ui-danger-text);
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
          border: 1px solid var(--ui-input-border);
          border-radius: 7px;
          background: var(--ui-surface);
          color: var(--ui-text);
          font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 9px 10px;
        }
        textarea { min-height: 86px; resize: vertical; }
        .comments {
          overflow: auto;
          padding: 10px 10px 14px;
        }
        .empty {
          color: var(--ui-muted);
          padding: 22px 12px;
          text-align: center;
          font-size: 13px;
        }
        .comment {
          border: 1px solid var(--ui-divider);
          border-radius: 8px;
          padding: 10px;
          margin: 0 0 9px;
          cursor: pointer;
        }
        .comment:hover { border-color: var(--ui-input-border); }
        .comment.work-active {
          border-color: var(--ui-accent-border);
          background: var(--ui-accent-soft);
        }
        /* Done comments recede through tint and a dashed edge, never opacity,
           so their text keeps full contrast. */
        .comment.work-done {
          border-color: var(--ui-ok-border);
          border-style: dashed;
          background: var(--ui-ok-soft);
        }
        .comment.work-warning {
          border-color: var(--ui-warn-border);
          background: var(--ui-warn-soft);
        }
        .comment.work-danger {
          border-color: var(--ui-danger-border);
          background: var(--ui-danger-soft);
        }
        .comment.work-muted {
          background: var(--ui-surface-2);
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
          border: 1px solid var(--ui-border);
          border-radius: 999px;
          background: var(--ui-surface-2);
          color: var(--ui-text-2);
          font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 5px 7px;
        }
        .work-badge.active { border-color: var(--ui-accent-border); background: var(--ui-accent-soft-2); color: var(--ui-accent-text); }
        .work-badge.done { border-color: var(--ui-ok-border); background: var(--ui-ok-badge); color: var(--ui-ok-text); }
        .work-badge.warning { border-color: var(--ui-warn-border); background: var(--ui-warn-badge); color: var(--ui-warn-text); }
        .work-badge.danger { border-color: var(--ui-danger-border); background: var(--ui-danger-badge); color: var(--ui-danger-text); }
        .work {
          display: none;
          margin-top: 9px;
          border-top: 1px solid var(--ui-divider);
          padding-top: 8px;
        }
        .work.visible { display: block; }
        .approval {
          display: none;
          margin-top: 8px;
          color: var(--ui-accent-text);
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
          border: 1px solid var(--ui-accent-border);
          border-radius: 7px;
          background: var(--ui-accent-soft);
          color: var(--ui-accent-text);
          cursor: pointer;
          font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 9px;
        }
        .approve-button:hover { background: var(--ui-accent-soft-2); }
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
          color: var(--ui-text-2);
          font-size: 12px;
        }
        .work-task::before {
          content: "";
          width: 13px;
          height: 13px;
          margin-top: 2px;
          border: 1px solid var(--ui-input-border);
          border-radius: 4px;
          background: var(--ui-surface);
        }
        .work-task.done {
          color: var(--ui-muted);
          text-decoration: line-through;
          text-decoration-thickness: 1px;
        }
        .work-task.done::before {
          border-color: var(--ui-ok-mark);
          background: var(--ui-ok-mark);
          box-shadow: inset 0 0 0 3px var(--ui-surface);
        }
        .quote {
          color: var(--ui-text-2);
          font-size: 12px;
          border-left: 3px solid var(--ui-accent-border);
          padding-left: 8px;
          margin-bottom: 8px;
        }
        .quote.note {
          color: var(--ui-muted);
          border-left-color: var(--ui-border);
        }
        button.quote {
          display: block;
          width: 100%;
          border-top: 0;
          border-right: 0;
          border-bottom: 0;
          background: none;
          padding-top: 0;
          padding-bottom: 0;
          font: inherit;
          font-size: 12px;
          text-align: left;
          cursor: pointer;
        }
        button.quote:hover { text-decoration: underline; text-underline-offset: 2px; }
        .panel:focus { outline: none; }
        button:focus-visible,
        input:focus-visible,
        textarea:focus-visible,
        a:focus-visible {
          outline: 2px solid var(--ui-focus);
          outline-offset: 2px;
        }
        .anchor-status {
          display: none;
          margin: -2px 0 8px 11px;
          color: var(--ui-warn-text);
          font-size: 11px;
          font-weight: 700;
          line-height: 1.35;
        }
        .anchor-status.visible { display: block; }
        .comment.anchor-stale .quote { border-left-color: var(--ui-warn-border); }
        .meta {
          color: var(--ui-muted);
          font-size: 12px;
          margin-bottom: 4px;
          overflow-wrap: anywhere;
        }
        .meta-row .meta { margin-bottom: 0; }
        .body {
          color: var(--ui-text);
          white-space: pre-wrap;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-top: 1px solid var(--ui-divider);
          background: var(--ui-surface-2);
        }
        .link {
          display: inline-block;
          padding: 5px 0;
          color: var(--ui-accent-text);
          text-decoration: none;
          font-weight: 600;
          font-size: 12px;
        }
        .link:hover { text-decoration: underline; text-underline-offset: 2px; }
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
          border: 1px solid var(--ui-accent);
          border-radius: 999px;
          background: var(--ui-accent);
          color: var(--ui-on-accent);
          box-shadow: 0 12px 32px var(--ui-shadow);
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
          border: 1px solid var(--ui-border);
          border-radius: 10px;
          background: var(--ui-surface);
          color: var(--ui-text);
          box-shadow: 0 22px 60px var(--ui-shadow);
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
          color: var(--ui-muted);
          font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .scope-toggle {
          display: inline-flex;
          border: 1px solid var(--ui-border);
          border-radius: 7px;
          overflow: hidden;
        }
        .scope-toggle button {
          border: 0;
          border-right: 1px solid var(--ui-border);
          background: var(--ui-surface);
          color: var(--ui-text-2);
          font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 9px;
          cursor: pointer;
        }
        .scope-toggle button:last-child { border-right: 0; }
        .scope-toggle button.active {
          background: var(--ui-accent);
          color: var(--ui-on-accent);
        }
        .composer .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 9px;
        }
        button.secondary, button.primary {
          border: 1px solid var(--ui-border);
          border-radius: 7px;
          padding: 8px 10px;
          font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        button.secondary { background: var(--ui-surface); color: var(--ui-text-2); }
        button.secondary:hover { background: var(--ui-surface-2); }
        button.primary { border-color: var(--ui-accent); background: var(--ui-accent); color: var(--ui-on-accent); }
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
            max-height: min(78dvh, calc(100dvh - 18px));
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
            bottom: calc(8px + env(safe-area-inset-bottom));
            left: 8px;
            width: auto;
            max-height: calc(100dvh - 16px);
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
          .icon-button {
            width: 44px;
            height: 44px;
          }
          .resolved-toggle {
            min-height: 44px;
            padding: 10px 14px;
          }
          .scope-toggle button {
            min-height: 40px;
            padding: 10px 14px;
          }
          button.quote {
            padding-top: 6px;
            padding-bottom: 6px;
          }
          /* The composer takes the bottom of the screen on phones; hide the
             panel behind it instead of stacking two sheets. It returns when
             the composer closes. */
          .composer.open ~ .panel.open {
            display: none;
          }
        }
      </style>
      <button class="launcher" type="button" title="Tunelito comments" aria-label="Tunelito comments" aria-expanded="false" aria-controls="tunelito-panel">
        <span class="launcher-glyph" aria-hidden="true"></span>
        <span class="count" hidden>0</span>
      </button>
      <button class="selection" type="button">Comment</button>
      <div class="laser" aria-hidden="true"></div>
      <div class="composer" role="dialog" aria-label="Add comment">
        <div class="composer-meta">
          <span class="composer-scope">Page comment</span>
          <div class="scope-toggle" role="group" aria-label="Comment scope">
            <button type="button" data-scope="page" aria-pressed="false">Page</button>
            <button type="button" data-scope="site" aria-pressed="false">Site</button>
          </div>
        </div>
        <div class="quote"></div>
        <textarea aria-label="Comment" placeholder="Leave a comment on this selection"></textarea>
        <div class="actions">
          <button class="secondary" type="button" data-action="cancel">Cancel</button>
          <button class="primary" type="button" data-action="save">Add comment</button>
        </div>
      </div>
      <aside class="panel" id="tunelito-panel" aria-label="Tunelito comments" tabindex="-1">
        <div class="header">
          <div class="title">
            <strong></strong>
            <div class="status" role="status">Connecting...</div>
          </div>
          <button class="resolved-toggle" type="button" hidden>Show resolved</button>
          <button class="icon-button" type="button" title="Close comments" aria-label="Close comments"><span aria-hidden="true">×</span></button>
        </div>
        <div class="identity">
          <div class="identity-card">
            <div class="identity-label">Assigned as</div>
            <div class="identity-row">
              <strong class="identity-name"></strong>
              <button class="identity-edit" type="button" title="Edit reviewer name" aria-label="Edit reviewer name">Edit</button>
            </div>
            <form class="identity-form" hidden>
              <input class="name" autocomplete="name" aria-label="Reviewer name" placeholder="Reviewer name" />
              <div class="identity-actions">
                <button class="secondary" data-action="cancel-name" type="button">Cancel</button>
                <button class="primary" data-action="save-name" type="submit">Save</button>
              </div>
            </form>
          </div>
        </div>
        <div class="note-actions" aria-label="Add unanchored comment">
          <button class="secondary" type="button" data-action="page-note">Page note</button>
          <button class="secondary" type="button" data-action="site-note">Site note</button>
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
    applyTone(host);
    const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    darkQuery?.addEventListener?.("change", () => applyTone(host));

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

    const resolvedToggle = shadow.querySelector(".resolved-toggle");
    resolvedToggle.addEventListener("click", () => {
      state.showResolved = !state.showResolved;
      try {
        localStorage.setItem("tunelito:show-resolved", String(state.showResolved));
      } catch {}
      renderComments();
    });
    launcher.addEventListener("click", () => setPanelOpen(!panel.classList.contains("open"), { moveFocus: true }));
    shadow.querySelector(".icon-button").addEventListener("click", () => setPanelOpen(false, { restoreFocus: true }));
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setPanelOpen(false, { restoreFocus: true });
    });
    identityEdit.addEventListener("click", () => openIdentityEditor());
    identityForm.addEventListener("submit", (event) => {
      event.preventDefault();
      commitIdentityName();
    });
    identityForm.querySelector("[data-action='cancel-name']").addEventListener("click", () => closeIdentityEditor({ restoreFocus: true }));
    name.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeIdentityEditor({ restoreFocus: true });
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
    });
    // Escape anywhere in the composer (textarea, scope toggle, buttons) closes it
    // and is consumed so page-level Escape handlers do not also fire.
    composer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeComposer();
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
      resolvedToggle,
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

  // The panel matches the page under review: a dark Markdown theme or a dark
  // HTML page gets the dark tokens, a light page the light ones, and a page
  // without an opaque background follows the OS preference.
  function applyTone(host) {
    host.dataset.tone = detectTone();
  }

  function detectTone() {
    for (const element of [document.body, document.documentElement]) {
      if (!element) continue;
      const luminance = backgroundLuminance(getComputedStyle(element).backgroundColor);
      if (luminance !== null) return luminance < 0.4 ? "dark" : "light";
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function backgroundLuminance(color) {
    const match = String(color).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, a = 1] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (!(a > 0.5)) return null;
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function withAccessKey(path) {
    const url = new URL(path, location.href);
    if (accessKey) url.searchParams.set("tunelito_key", accessKey);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function setPanelOpen(open, { moveFocus = false, restoreFocus = false } = {}) {
    const wasOpen = ui.panel.classList.contains("open");
    const focusWasInside = ui.panel.contains(ui.shadow.activeElement);
    ui.panel.classList.toggle("open", open);
    ui.launcher.classList.toggle("active", open);
    ui.launcher.setAttribute("aria-expanded", String(open));
    window.dispatchEvent(new CustomEvent("tunelito:comments-panel", { detail: { open } }));
    // Opening from the launcher moves focus into the panel (on narrow screens
    // the launcher hides while the panel is open); closing returns it.
    if (open && !wasOpen && moveFocus) ui.panel.focus({ preventScroll: true });
    if (!open && wasOpen && (restoreFocus || focusWasInside)) ui.launcher.focus({ preventScroll: true });
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
    const anchors = anchorIdsFor(range);
    return {
      scope: "page",
      quote,
      prefix,
      suffix,
      anchorId: anchors.anchorId,
      sectionId: anchors.sectionId,
      textStart: Number.isFinite(offsets.start) ? offsets.start : null,
      textEnd: Number.isFinite(offsets.end) ? offsets.end : null,
      path: cssPath(closestElement(range.startContainer)),
      rect: rectSnapshot(range.getBoundingClientRect()),
    };
  }

  function openComposer() {
    if (!state.pendingSelection) return;
    // Remember where focus came from so closing the composer can return it.
    const opener = ui.shadow.activeElement;
    state.composerOpener = opener && opener !== ui.selection ? opener : null;
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
    const focusWasInside = ui.composer.contains(ui.shadow.activeElement);
    ui.composer.classList.remove("open");
    state.pendingSelection = null;
    const opener = state.composerOpener;
    state.composerOpener = null;
    if (focusWasInside) {
      const target = opener?.isConnected && !opener.hidden ? opener : ui.panel.classList.contains("open") ? ui.panel : ui.launcher;
      target.focus({ preventScroll: true });
    }
    flushQueuedReload();
  }

  function setComposerScope(scope) {
    if (!state.pendingSelection) return;
    state.pendingSelection.scope = normalizeScope(scope);
    for (const button of ui.composer.querySelectorAll("[data-scope]")) {
      const selected = button.dataset.scope === state.pendingSelection.scope;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
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
    window.dispatchEvent(new CustomEvent("tunelito:document-changed"));
    if (isDraftBlockingReload()) {
      queueReloadUntilComposerCloses();
      return;
    }
    scheduleDocumentReload();
  }

  function queueReloadUntilComposerCloses() {
    state.reloadQueued = true;
    renderStatus("Page changed; reload queued until the open draft is saved or closed.");
  }

  function flushQueuedReload() {
    if (!state.reloadQueued) return;
    if (isDraftBlockingReload()) return;
    scheduleDocumentReload();
  }

  function scheduleDocumentReload() {
    state.reloadQueued = false;
    renderStatus("Page changed; reloading...");
    if (state.reloadTimer) return;
    state.reloadTimer = setTimeout(() => {
      state.reloadTimer = null;
      if (isDraftBlockingReload()) {
        queueReloadUntilComposerCloses();
        return;
      }
      location.reload();
    }, 500);
  }

  function isComposerOpen() {
    return ui.composer.classList.contains("open");
  }

  function isDraftBlockingReload() {
    return isComposerOpen() || document.documentElement.hasAttribute("data-tunelito-source-dirty");
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
    const resolvedCount = state.comments.filter(isResolvedComment).length;
    ui.resolvedToggle.hidden = resolvedCount === 0;
    ui.resolvedToggle.textContent = state.showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`;
    ui.resolvedToggle.setAttribute("aria-pressed", String(state.showResolved));
    ui.count.textContent = count > 99 ? "99+" : String(count);
    ui.count.hidden = count === 0;
    // aria-expanded carries open/closed; the label names the control and its count.
    const launcherLabel = count ? `Tunelito comments (${count})` : "Tunelito comments";
    ui.launcher.setAttribute("aria-label", launcherLabel);
    ui.launcher.title = launcherLabel;
    const visible = state.comments.filter((comment) => state.showResolved || !isResolvedComment(comment));
    // Re-rendering replaces every card; remember which control had focus so a
    // keyboard user is not dropped to <body> when a comment or status arrives.
    const focused = ui.shadow.activeElement;
    const focusedCard = focused && ui.comments.contains(focused) ? focused.closest(".comment") : null;
    const restoreFocus = focusedCard
      ? { id: focusedCard.dataset.commentId, action: focused.dataset.action || "" }
      : null;
    if (!visible.length) {
      ui.comments.innerHTML = state.comments.length
        ? `<div class="empty">Resolved comments are hidden.</div>`
        : `<div class="empty">Select text, or add a page or site note.</div>`;
      updateHighlights();
      publishSectionCounts();
      return;
    }

    ui.comments.innerHTML = "";
    for (const comment of visible.slice().reverse()) {
      const item = document.createElement("article");
      item.className = "comment";
      item.dataset.commentId = comment.id || "";
      item.innerHTML = `
        <div class="meta-row">
          <div class="meta"></div>
          <div class="work-badge" hidden></div>
        </div>
        <div class="quote"></div>
        <div class="anchor-status"></div>
        <div class="body"></div>
        <p class="resolution" hidden></p>
        <div class="approval"></div>
        <div class="work" aria-label="Agent work status">
          <ul class="work-list"></ul>
        </div>
        <div class="comment-actions">
          <button class="approve-button" type="button" data-action="approve-agent" hidden>Approve for agent</button>
        </div>
      `;
      const scope = normalizeScope(comment.scope);
      let quote = item.querySelector(".quote");
      const hasQuote = Boolean(String(comment.quote || "").trim());
      item.querySelector(".meta").textContent = `${comment.author}${comment.authorRole === "owner" ? " (owner)" : ""} · ${scope} · ${formatTime(comment.created)}`;
      const expectedOnPage = !comment.pagePath || normalizePagePath(comment.pagePath) === normalizePagePath(state.pagePath);
      const anchorMissing = hasQuote && expectedOnPage && !findRangeForComment(comment);
      if (hasQuote && expectedOnPage && !anchorMissing) {
        // The quote is the keyboard path to the commented text; the whole card
        // stays clickable for pointer users.
        const jump = document.createElement("button");
        jump.type = "button";
        jump.className = "quote jump";
        jump.dataset.action = "jump";
        jump.setAttribute("aria-label", `Go to selection: ${compact(comment.quote, 80)}`);
        quote.replaceWith(jump);
        quote = jump;
      }
      quote.textContent = hasQuote ? compact(comment.quote, 220) : `${scopeLabel(scope)} note`;
      quote.classList.toggle("note", !hasQuote);
      if (anchorMissing) {
        item.classList.add("anchor-stale");
        const anchorStatus = item.querySelector(".anchor-status");
        anchorStatus.textContent = "Selection no longer found in this version";
        anchorStatus.classList.add("visible");
      }
      item.querySelector(".body").textContent = comment.body;
      renderCommentApproval(item, comment);
      renderCommentWorkStatus(item, comment);
      item.addEventListener("click", () => scrollToComment(comment));
      ui.comments.appendChild(item);
    }
    if (restoreFocus?.id) {
      const card = [...ui.comments.querySelectorAll(".comment")].find((node) => node.dataset.commentId === restoreFocus.id);
      const target = (restoreFocus.action && card?.querySelector(`[data-action='${restoreFocus.action}']:not([hidden])`)) || card?.querySelector("button:not([hidden])");
      (target || ui.panel).focus({ preventScroll: true });
    }
    updateHighlights();
    publishSectionCounts();
  }

  function renderCommentWorkStatus(item, comment) {
    const status = workStatusForComment(comment);
    if (!status) return;
    item.classList.add(`work-${status.tone || "pending"}`);
    const badge = item.querySelector(".work-badge");
    badge.hidden = false;
    badge.dataset.status = status.status || "";
    badge.textContent = status.label || status.status || "Queued";
    badge.classList.add(status.tone || "pending");
    const summary = String(status.summary || "").trim();
    const resolution = item.querySelector(".resolution");
    resolution.hidden = !summary;
    resolution.textContent = summary;

    const tasks = [
      ...(Array.isArray(status.done) ? status.done.map((text) => ({ text, done: true })) : []),
      ...(Array.isArray(status.todo) ? status.todo.map((text) => ({ text, done: false })) : []),
    ].filter((task) => task.text && task.text !== summary);
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
    revealCollapsedAncestors(node);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    flashRange(range);
  }

  function revealCollapsedAncestors(node) {
    let disclosure = node?.closest?.("details");
    while (disclosure) {
      disclosure.open = true;
      disclosure = disclosure.parentElement?.closest?.("details");
    }
    if (node) window.dispatchEvent(new CustomEvent("tunelito:reveal-block", { detail: { node } }));
  }

  function findRangeForComment(comment) {
    const quote = String(comment?.quote || "");
    if (!quote.trim()) return null;
    if (normalizeScope(comment.scope) === "site" && comment.pagePath && normalizePagePath(comment.pagePath) !== normalizePagePath(state.pagePath)) return null;
    const textNodes = getTextNodes(document.body);
    const fullText = textNodes.map((entry) => entry.node.textContent).join("");
    const exact = comment.prefix || comment.suffix ? `${comment.prefix}${quote}${comment.suffix}` : null;
    let start = -1;
    if (exact) {
      const exactStart = fullText.indexOf(exact);
      if (exactStart >= 0) start = exactStart + comment.prefix.length;
    }
    if (start < 0 && Number.isFinite(comment.textStart) && fullText.slice(comment.textStart, comment.textStart + quote.length) === quote) {
      start = comment.textStart;
    }
    if (start >= 0 && fullText.slice(start, start + quote.length) === quote) return rangeBetween(textNodes, start, start + quote.length);
    const anchored = quoteRangeWithin(comment.anchorId, quote) || quoteRangeWithin(comment.sectionId, quote);
    if (anchored) return anchored;
    const anchoredElement = elementRange(comment.anchorId) || elementRange(comment.sectionId);
    if (anchoredElement) return anchoredElement;
    start = fullText.indexOf(quote);
    if (start >= 0) return rangeBetween(textNodes, start, start + quote.length);
    return null;
  }

  function quoteRangeWithin(id, quote) {
    const node = document.getElementById(String(id || ""));
    if (!node) return null;
    const entries = textEntries(sectionMembers(node));
    const full = entries.map((entry) => entry.node.textContent).join("");
    const start = full.indexOf(quote);
    if (start < 0) return null;
    return rangeBetween(entries, start, start + quote.length);
  }

  function elementRange(id) {
    const node = document.getElementById(String(id || ""));
    if (!node) return null;
    const entries = textEntries([node]);
    if (!entries.length) return null;
    const last = entries[entries.length - 1];
    return rangeBetween(entries, 0, last.start + last.node.textContent.length);
  }

  function sectionMembers(node) {
    if (!/^H[1-6]$/.test(node.tagName)) return [node];
    const level = Number(node.tagName.slice(1));
    const members = [node];
    let next = node.nextElementSibling;
    while (next) {
      if (/^H[1-6]$/.test(next.tagName) && Number(next.tagName.slice(1)) <= level) break;
      members.push(next);
      next = next.nextElementSibling;
    }
    return members;
  }

  function textEntries(roots) {
    const entries = [];
    let offset = 0;
    for (const root of roots) {
      for (const entry of getTextNodes(root)) {
        entries.push({ node: entry.node, start: offset });
        offset += entry.node.textContent.length;
      }
    }
    return entries;
  }

  function rangeBetween(entries, start, end) {
    const startLoc = locate(entries, start, "start");
    const endLoc = locate(entries, end, "end");
    if (!startLoc || !endLoc) return null;
    const range = document.createRange();
    range.setStart(startLoc.node, startLoc.offset);
    range.setEnd(endLoc.node, endLoc.offset);
    return range;
  }

  function anchorIdsFor(range) {
    const start = closestElement(range.startContainer);
    const explicit = start?.closest?.("[id]");
    const explicitId = explicit && !explicit.closest("#tunelito-root, [data-tunelito-comment-ignore], h1, h2, h3, h4, h5, h6")
      ? explicit.id
      : "";
    const heading = nearestHeading(start);
    return {
      anchorId: explicitId || heading?.id || "",
      sectionId: heading?.id || "",
    };
  }

  function nearestHeading(node) {
    if (!node) return null;
    const direct = node.closest?.("h1, h2, h3, h4, h5, h6");
    if (direct) return direct;
    const article = node.closest?.(".tunelito-markdown") || document.querySelector(".tunelito-markdown") || document.body;
    let found = null;
    for (const heading of article.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      if (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = heading;
    }
    return found;
  }

  function publishSectionCounts() {
    const article = document.querySelector(".tunelito-markdown");
    if (!article) return;
    const headings = [...article.querySelectorAll(":scope > h2, :scope > h3")];
    const counts = new Map(headings.map((heading) => [heading, { open: 0, resolved: 0 }]));
    for (const comment of state.comments) {
      if (normalizeScope(comment.scope) === "site" && comment.pagePath && normalizePagePath(comment.pagePath) !== normalizePagePath(state.pagePath)) continue;
      const heading = countHeading(comment, headings);
      const bucket = counts.get(heading);
      if (!bucket) continue;
      if (isResolvedComment(comment)) bucket.resolved += 1;
      else bucket.open += 1;
    }
    for (const [heading, count] of counts) {
      heading.dataset.tunelitoOpenComments = String(count.open);
      heading.dataset.tunelitoResolvedComments = String(count.resolved);
    }
    document.documentElement.dataset.tunelitoShowResolved = state.showResolved ? "true" : "false";
    window.dispatchEvent(new CustomEvent("tunelito:section-counts"));
  }

  function countHeading(comment, headings) {
    const recorded = document.getElementById(String(comment.sectionId || ""));
    if (recorded && headings.includes(recorded)) return recorded;
    const range = findRangeForComment(comment);
    const node = range ? closestElement(range.startContainer) : null;
    if (!node) return null;
    let found = null;
    for (const heading of headings) {
      if (heading === node || heading.contains(node)) return heading;
      if (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = heading;
    }
    return found;
  }

  function isResolvedComment(comment) {
    return workStatusForComment(comment)?.tone === "done";
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

  function locate(nodes, globalOffset, boundary = "end") {
    for (let index = 0; index < nodes.length; index += 1) {
      const entry = nodes[index];
      const nodeEnd = entry.start + entry.node.textContent.length;
      const isLast = index === nodes.length - 1;
      const contains = boundary === "start" && !isLast ? globalOffset < nodeEnd : globalOffset <= nodeEnd;
      if (contains) return { node: entry.node, offset: globalOffset - entry.start };
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

  function storedFlag(key) {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  }
})();
