(() => {
  const root = document.documentElement;
  const markdown = document.querySelector(".tunelito-markdown[data-tunelito-source-type='markdown']");
  if (!markdown || root.dataset.tunelitoMarkdownUi === "ready") return;
  root.dataset.tunelitoMarkdownUi = "ready";

  setupSourceEditor();
  setupPropertiesDrawer();
  setupDocumentMap();

  function setupSourceEditor() {
    if (root.dataset.tunelitoEditable !== "true") return;

    const style = element("style", "tunelito-source-editor-style");
    style.textContent = `
      .tunelito-source-edit-trigger {
        position: fixed;
        z-index: 2147483605;
        top: 18px;
        right: 76px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border: 1px solid var(--tl-border);
        border-radius: 999px;
        background: color-mix(in srgb, var(--tl-paper-bg) 92%, transparent);
        color: var(--tl-text);
        box-shadow: 0 8px 28px var(--tl-properties-shadow);
        font: 750 0.72rem/1 var(--tl-font-body);
        letter-spacing: 0.025em;
        padding: 10px 13px;
        cursor: pointer;
        backdrop-filter: blur(14px);
      }
      .tunelito-source-edit-trigger::before { content: "✎"; color: var(--tl-accent); font-size: 1rem; }
      .tunelito-source-edit-trigger:hover { border-color: var(--tl-accent); color: var(--tl-accent-strong); }
      .tunelito-source-edit-trigger:focus-visible,
      .tunelito-source-editor button:focus-visible,
      .tunelito-source-editor textarea:focus-visible {
        outline: 3px solid var(--tl-focus-ring);
        outline-offset: 3px;
      }
      .tunelito-source-editor {
        position: fixed;
        z-index: 2147483647;
        inset: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        background:
          linear-gradient(90deg, transparent 0 47px, color-mix(in srgb, var(--tl-accent) 20%, transparent) 48px, transparent 49px),
          var(--tl-page-bg);
        color: var(--tl-text);
      }
      .tunelito-source-editor[hidden] { display: none; }
      .tunelito-source-editor-header,
      .tunelito-source-editor-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        border-color: var(--tl-border);
        background: color-mix(in srgb, var(--tl-paper-bg) 94%, transparent);
        padding: 14px clamp(18px, 4vw, 54px);
        backdrop-filter: blur(16px);
      }
      .tunelito-source-editor-header { border-bottom: 1px solid var(--tl-border); }
      .tunelito-source-editor-footer { border-top: 1px solid var(--tl-border); }
      .tunelito-source-editor-heading { min-width: 0; }
      .tunelito-source-editor-kicker {
        margin: 0 0 3px;
        color: var(--tl-accent);
        font: 800 0.65rem/1.2 var(--tl-font-body);
        letter-spacing: 0.13em;
        text-transform: uppercase;
      }
      .tunelito-source-editor-title {
        overflow: hidden;
        margin: 0;
        color: var(--tl-text);
        font: 720 clamp(1rem, 2vw, 1.25rem)/1.2 var(--tl-font-display);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tunelito-source-editor-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
      .tunelito-source-editor button {
        border: 1px solid var(--tl-border);
        border-radius: 7px;
        background: var(--tl-soft);
        color: var(--tl-text);
        font: 750 0.76rem/1 var(--tl-font-body);
        padding: 10px 12px;
        cursor: pointer;
      }
      .tunelito-source-editor button:hover { border-color: var(--tl-accent); color: var(--tl-accent-strong); }
      .tunelito-source-editor button[data-action="save"] { border-color: var(--tl-accent); background: var(--tl-accent); color: var(--tl-paper-bg); }
      .tunelito-source-editor button[data-action="save"]:hover { background: var(--tl-accent-strong); color: var(--tl-paper-bg); }
      .tunelito-source-editor button[data-action="discard"],
      .tunelito-source-editor button[data-action="reload"] { border-color: #b45309; color: #92400e; }
      .tunelito-source-editor button:disabled { cursor: wait; opacity: 0.58; }
      .tunelito-source-editor-workspace {
        min-height: 0;
        padding: clamp(14px, 3vw, 34px) clamp(16px, 6vw, 84px);
      }
      .tunelito-source-editor textarea {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-height: 260px;
        resize: none;
        border: 1px solid var(--tl-border);
        border-radius: 10px;
        background: var(--tl-paper-bg);
        color: var(--tl-text);
        caret-color: var(--tl-accent);
        box-shadow: 0 18px 55px var(--tl-properties-shadow);
        font: 500 0.92rem/1.62 var(--tl-font-mono);
        tab-size: 2;
        padding: clamp(18px, 3vw, 34px);
      }
      .tunelito-source-editor-status {
        min-width: 0;
        margin: 0;
        color: var(--tl-muted);
        font: 650 0.74rem/1.4 var(--tl-font-body);
        overflow-wrap: anywhere;
      }
      .tunelito-source-editor-status[data-tone="error"] { color: #b45309; }
      .tunelito-source-editor-stats { flex: 0 0 auto; color: var(--tl-muted); font: 600 0.7rem/1 var(--tl-font-mono); }
      body.tunelito-source-editor-open { overflow: hidden; }
      body.tunelito-source-editor-open #tunelito-root { visibility: hidden; }
      @media (max-width: 680px) {
        .tunelito-source-edit-trigger { top: 12px; right: 14px; }
        .tunelito-source-editor-header { align-items: flex-start; flex-direction: column; gap: 10px; }
        .tunelito-source-editor-actions { width: 100%; flex-wrap: wrap; }
        .tunelito-source-editor-actions button { flex: 1 1 auto; }
        .tunelito-source-editor-footer { align-items: flex-start; flex-direction: column; gap: 6px; }
        .tunelito-source-editor-workspace { padding: 10px; }
        .tunelito-source-editor textarea { border-radius: 7px; padding: 16px; }
      }
      @media (prefers-reduced-motion: no-preference) {
        .tunelito-source-edit-trigger { transition: border-color 140ms ease, color 140ms ease, transform 140ms ease; }
        .tunelito-source-edit-trigger:hover { transform: translateY(-1px); }
      }
    `;
    document.head.append(style);

    const trigger = element("button", "tunelito-source-edit-trigger", "Edit source");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("data-tunelito-comment-ignore", "");

    const editor = element("section", "tunelito-source-editor");
    editor.hidden = true;
    editor.setAttribute("role", "dialog");
    editor.setAttribute("aria-modal", "true");
    editor.setAttribute("aria-labelledby", "tunelito-source-editor-title");
    editor.setAttribute("data-tunelito-comment-ignore", "");
    editor.innerHTML = `
      <header class="tunelito-source-editor-header">
        <div class="tunelito-source-editor-heading">
          <p class="tunelito-source-editor-kicker">Local Markdown source</p>
          <h2 class="tunelito-source-editor-title" id="tunelito-source-editor-title"></h2>
        </div>
        <div class="tunelito-source-editor-actions">
          <button type="button" data-action="discard" hidden>Discard & close</button>
          <button type="button" data-action="reload" hidden>Discard draft & refresh</button>
          <button type="button" data-action="close">Close</button>
          <button type="button" data-action="save">Save & review</button>
        </div>
      </header>
      <div class="tunelito-source-editor-workspace">
        <textarea aria-label="Markdown source" aria-describedby="tunelito-source-editor-status" autocomplete="off" autocapitalize="sentences" spellcheck="true"></textarea>
      </div>
      <footer class="tunelito-source-editor-footer">
        <p class="tunelito-source-editor-status" id="tunelito-source-editor-status" aria-live="polite">Loading source…</p>
        <span class="tunelito-source-editor-stats" aria-hidden="true"></span>
      </footer>
    `;
    editor.querySelector(".tunelito-source-editor-title").textContent = document.title.replace(/ · Tunelito$/, "");
    document.body.append(trigger, editor);

    const textarea = editor.querySelector("textarea");
    const closeButton = editor.querySelector('[data-action="close"]');
    const saveButton = editor.querySelector('[data-action="save"]');
    const discardButton = editor.querySelector('[data-action="discard"]');
    const reloadButton = editor.querySelector('[data-action="reload"]');
    const status = editor.querySelector(".tunelito-source-editor-status");
    const stats = editor.querySelector(".tunelito-source-editor-stats");
    let etag = "";
    let original = "";
    let dirty = false;
    let saving = false;
    let previousFocus = null;

    trigger.addEventListener("click", openEditor);
    closeButton.addEventListener("click", requestClose);
    discardButton.addEventListener("click", () => closeEditor({ discard: true }));
    reloadButton.addEventListener("click", () => closeEditor({ discard: true, refresh: true }));
    saveButton.addEventListener("click", saveSource);
    textarea.addEventListener("input", () => {
      dirty = textarea.value !== original;
      root.toggleAttribute("data-tunelito-source-dirty", dirty);
      discardButton.hidden = true;
      if (dirty) setStatus("Unsaved local changes · Cmd/Ctrl-S to save");
      else setStatus("No unsaved changes");
      updateStats();
    });
    editor.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveSource();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key === "Tab") trapFocus(event);
    });
    window.addEventListener("beforeunload", (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("tunelito:document-changed", () => {
      if (!dirty) return;
      reloadButton.hidden = false;
      setStatus("Source changed on disk. Your browser draft is preserved and cannot overwrite it.", "error");
    });

    async function openEditor() {
      previousFocus = document.activeElement;
      editor.hidden = false;
      document.body.classList.add("tunelito-source-editor-open");
      trigger.setAttribute("aria-expanded", "true");
      textarea.disabled = true;
      saveButton.disabled = true;
      discardButton.hidden = true;
      reloadButton.hidden = true;
      setStatus("Loading source…");
      try {
        const response = await fetch(sourceUrl(), { cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response));
        original = await response.text();
        etag = response.headers.get("etag") || "";
        textarea.value = original;
        dirty = false;
        root.removeAttribute("data-tunelito-source-dirty");
        textarea.disabled = false;
        saveButton.disabled = false;
        setStatus("Local owner editor · changes stay on this machine until you save");
        updateStats();
        textarea.focus();
      } catch (error) {
        setStatus(error.message || "Could not load the Markdown source.", "error");
        closeButton.focus();
      }
    }

    async function saveSource() {
      if (saving || textarea.disabled) return;
      if (!dirty) {
        closeEditor();
        return;
      }
      saving = true;
      saveButton.disabled = true;
      closeButton.disabled = true;
      setStatus("Saving atomically…");
      try {
        const response = await fetch(sourceUrl(), {
          method: "PUT",
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "if-match": etag,
          },
          body: textarea.value,
        });
        if (!response.ok) {
          const message = await responseError(response);
          if ([409, 412].includes(response.status)) reloadButton.hidden = false;
          throw new Error(message);
        }
        const result = await response.json();
        original = textarea.value;
        etag = response.headers.get("etag") || etag;
        dirty = false;
        root.removeAttribute("data-tunelito-source-dirty");
        window.dispatchEvent(new CustomEvent("tunelito:source-editor-settled"));
        if (result.changed) {
          setStatus("Saved. Refreshing the rendered review…");
          setTimeout(() => location.reload(), 120);
        } else {
          closeEditor();
        }
      } catch (error) {
        setStatus(error.message || "Could not save the Markdown source.", "error");
      } finally {
        saving = false;
        saveButton.disabled = textarea.disabled;
        closeButton.disabled = false;
      }
    }

    function requestClose() {
      if (!dirty) {
        closeEditor();
        return;
      }
      discardButton.hidden = false;
      setStatus("Unsaved changes are preserved. Save them or choose Discard & close.", "error");
      discardButton.focus();
    }

    function closeEditor({ discard = false, refresh = false } = {}) {
      if (dirty && !discard) return;
      dirty = false;
      root.removeAttribute("data-tunelito-source-dirty");
      editor.hidden = true;
      document.body.classList.remove("tunelito-source-editor-open");
      trigger.setAttribute("aria-expanded", "false");
      window.dispatchEvent(new CustomEvent("tunelito:source-editor-settled"));
      if (refresh) {
        location.reload();
        return;
      }
      previousFocus?.focus?.({ preventScroll: true });
    }

    function trapFocus(event) {
      const focusable = Array.from(editor.querySelectorAll("button:not([disabled]):not([hidden]), textarea:not([disabled])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function setStatus(message, tone = "") {
      status.textContent = message;
      if (tone) status.dataset.tone = tone;
      else delete status.dataset.tone;
    }

    function updateStats() {
      const lines = textarea.value === "" ? 1 : textarea.value.split("\n").length;
      stats.textContent = `${lines} line${lines === 1 ? "" : "s"} · ${textarea.value.length} characters`;
    }

    function sourceUrl() {
      const url = new URL("/__tunelito/source", location.href);
      url.searchParams.set("tunelito_page", location.pathname || "/");
      const accessKey = new URLSearchParams(location.search).get("tunelito_key");
      if (accessKey) url.searchParams.set("tunelito_key", accessKey);
      return `${url.pathname}${url.search}`;
    }

    async function responseError(response) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        if (payload?.error) return payload.error;
      }
      const message = await response.text().catch(() => "");
      return message || `Source request failed (${response.status}).`;
    }
  }

  function setupPropertiesDrawer() {
    const drawer = document.querySelector(".tunelito-properties");
    const collapse = document.querySelector(".tunelito-properties-collapse");
    const tab = document.querySelector(".tunelito-properties-tab");
    if (!drawer || !collapse || !tab) return;

    const storageKey = `tunelito:properties-open:${location.pathname}`;
    const narrow = () => matchMedia("(max-width: 960px)").matches;
    let stored = null;
    try {
      stored = localStorage.getItem(storageKey);
    } catch {
      stored = null;
    }
    setOpen(stored === null ? !narrow() : stored === "true", { persist: false });

    collapse.addEventListener("click", () => setOpen(false));
    tab.addEventListener("click", () => setOpen(true, { restoreFocus: true }));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("tunelito-properties-open")) {
        setOpen(false, { restoreFocus: true });
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!narrow() || !document.body.classList.contains("tunelito-properties-open")) return;
      if (!drawer.contains(event.target) && !tab.contains(event.target)) setOpen(false);
    });

    function setOpen(open, { persist = true, restoreFocus = false } = {}) {
      const isOpen = Boolean(open);
      document.body.classList.toggle("tunelito-properties-open", isOpen);
      document.body.classList.toggle("tunelito-properties-collapsed", !isOpen);
      drawer.setAttribute("aria-hidden", String(!isOpen));
      collapse.setAttribute("aria-expanded", String(isOpen));
      tab.setAttribute("aria-expanded", String(isOpen));
      tab.hidden = isOpen;
      if (persist) {
        try {
          localStorage.setItem(storageKey, String(isOpen));
        } catch {
          // The drawer still works when storage is unavailable.
        }
      }
      if (restoreFocus) (isOpen ? collapse : tab).focus({ preventScroll: true });
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("tunelito:markdown-layout")));
    }
  }

  function setupDocumentMap() {
    const ruler = document.querySelector("[data-tunelito-document-map]");
    if (!ruler) return;

    const blocks = Array.from(markdown.querySelectorAll(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p, :scope > blockquote, :scope > pre, :scope > ul, :scope > ol, :scope > table, :scope > figure, :scope > hr"))
      .filter(isMeaningfulBlock);
    if (!blocks.length) {
      ruler.hidden = true;
      return;
    }

    ensureHeadingIds(blocks);
    const scrubber = element("div", "tunelito-ruler-scrubber");
    scrubber.tabIndex = 0;
    scrubber.setAttribute("role", "slider");
    scrubber.setAttribute("aria-label", "Document map");
    scrubber.setAttribute("aria-orientation", "vertical");
    scrubber.setAttribute("aria-valuemin", "1");
    scrubber.setAttribute("aria-valuemax", String(blocks.length));

    const track = element("div", "tunelito-document-map-track");
    const markers = blocks.map((block, index) => createMarker(block, index, blocks.length));
    track.append(...markers);
    ruler.replaceChildren(scrubber, track);

    let selectedIndex = 0;
    let measurements = [];
    let scrollFrame = 0;
    let measureFrame = 0;
    let navigationLockUntil = 0;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

    ruler.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const active = document.activeElement;
        if (active && ruler.contains(active) && typeof active.blur === "function") active.blur();
        event.preventDefault();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
      const pageStep = Math.max(5, Math.round(blocks.length / 10));
      const next = event.key === "Home" ? 0
        : event.key === "End" ? blocks.length - 1
          : event.key === "ArrowUp" ? selectedIndex - 1
            : event.key === "ArrowDown" ? selectedIndex + 1
              : event.key === "PageUp" ? selectedIndex - pageStep
                : selectedIndex + pageStep;
      navigateTo(Math.max(0, Math.min(blocks.length - 1, next)));
      event.preventDefault();
    });
    track.addEventListener("pointerdown", (event) => {
      if (event.target !== track) return;
      const bounds = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(bounds.height, 1)));
      navigateTo(Math.round(ratio * (blocks.length - 1)));
    });
    ruler.addEventListener("pointerup", () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && ruler.contains(active) && typeof active.blur === "function") active.blur();
      });
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Node && ruler.contains(event.target)) return;
      const active = document.activeElement;
      if (active && ruler.contains(active) && typeof active.blur === "function") active.blur();
    });
    window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    window.addEventListener("tunelito:markdown-layout", scheduleMeasure);
    window.addEventListener("tunelito:mermaid-rendered", scheduleMeasure);
    window.addEventListener("tunelito:comments-panel", (event) => {
      document.body.classList.toggle("tunelito-comments-open", Boolean(event.detail?.open));
      scheduleMeasure();
    });
    for (const image of markdown.querySelectorAll("img")) image.addEventListener("load", scheduleMeasure, { once: true });
    document.fonts?.ready?.then(scheduleMeasure).catch(() => {});
    if ("ResizeObserver" in window) new ResizeObserver(scheduleMeasure).observe(markdown);

    scheduleMeasure();

    function createMarker(block, index, total) {
      const heading = /^H[1-6]$/.test(block.tagName);
      const marker = element(heading ? "a" : "button", "tunelito-ruler-marker");
      const type = blockType(block);
      marker.style.setProperty("--ruler-position", total === 1 ? "0.5" : String(index / (total - 1)));
      marker.style.setProperty("--ruler-length", tickLength(block));
      marker.dataset.index = String(index);
      marker.dataset.blockType = type;
      marker.setAttribute("aria-label", heading ? `Go to ${block.textContent.trim()}` : `Go to ${type}`);
      if (heading) {
        marker.href = `#${encodeURIComponent(block.id)}`;
        const label = element("span", "tunelito-ruler-label", block.textContent.trim());
        marker.append(label);
      } else {
        marker.type = "button";
        marker.tabIndex = -1;
      }
      marker.append(element("span", "tunelito-ruler-tick"));
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        navigateTo(index, { updateHash: heading });
      });
      return marker;
    }

    function scheduleMeasure() {
      if (measureFrame) cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0;
        measurements = blocks.map((block) => block.getBoundingClientRect().top + scrollY);
        updateReadingState();
      });
    }

    function scheduleScrollUpdate() {
      if (performance.now() < navigationLockUntil) return;
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateReadingState();
      });
    }

    function updateReadingState(forcedIndex = null) {
      if (!measurements.length) return;
      const readingLine = scrollY + innerHeight * 0.34;
      const current = forcedIndex ?? measurements.reduce((found, top, index) => top <= readingLine ? index : found, 0);
      selectedIndex = Math.max(0, Math.min(blocks.length - 1, current));
      const currentHeadingIndex = blocks.reduce((found, block, index) => index <= selectedIndex && /^H[1-6]$/.test(block.tagName) ? index : found, -1);

      markers.forEach((marker, index) => {
        marker.dataset.state = index === selectedIndex ? "current" : index < selectedIndex ? "consumed" : "unread";
        if (marker.tagName === "A") {
          if (index === currentHeadingIndex) marker.setAttribute("aria-current", "location");
          else marker.removeAttribute("aria-current");
        }
      });
      const block = blocks[selectedIndex];
      scrubber.setAttribute("aria-valuenow", String(selectedIndex + 1));
      scrubber.setAttribute("aria-valuetext", `${blockType(block)} ${selectedIndex + 1} of ${blocks.length}: ${blockLabel(block)}`);
    }

    function navigateTo(index, { updateHash = /^H[1-6]$/.test(blocks[index]?.tagName || "") } = {}) {
      selectedIndex = index;
      const block = blocks[index];
      navigationLockUntil = performance.now() + (reduceMotion.matches ? 100 : 700);
      block.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
      if (updateHash && block.id) {
        const next = new URL(location.href);
        next.hash = encodeURIComponent(block.id);
        history.pushState(null, "", next);
      }
      updateReadingState(index);
    }
  }

  function ensureHeadingIds(blocks) {
    const used = new Set(Array.from(document.querySelectorAll("[id]"), (node) => node.id).filter(Boolean));
    for (const heading of blocks.filter((block) => /^H[1-6]$/.test(block.tagName))) {
      if (heading.id) continue;
      const base = slugify(heading.textContent) || "section";
      let id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      heading.id = id;
      used.add(id);
    }
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function isMeaningfulBlock(block) {
    if (block.getAttribute("aria-hidden") === "true") return false;
    if (block.tagName === "HR") return true;
    return Boolean(block.textContent.trim() || block.querySelector("img, svg, video, canvas"));
  }

  function tickLength(block) {
    return ({ H1: "36px", H2: "29px", H3: "23px", H4: "17px", H5: "14px", H6: "12px" })[block.tagName] || "10px";
  }

  function blockType(block) {
    if (/^H[1-6]$/.test(block.tagName)) return `Heading ${block.tagName.slice(1)}`;
    return ({
      P: "Paragraph", BLOCKQUOTE: "Quotation", PRE: "Code block", UL: "List", OL: "List",
      TABLE: "Table", FIGURE: "Figure", HR: "Divider",
    })[block.tagName] || "Document block";
  }

  function blockLabel(block) {
    const text = block.textContent.trim().replace(/\s+/g, " ");
    return text ? text.slice(0, 120) : blockType(block);
  }

  function element(tagName, className, text = "") {
    const node = document.createElement(tagName);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
})();
