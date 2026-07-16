(() => {
  const root = document.documentElement;
  const markdown = document.querySelector(".tunelito-markdown[data-tunelito-source-type='markdown']");
  if (!markdown || root.dataset.tunelitoMarkdownUi === "ready") return;
  root.dataset.tunelitoMarkdownUi = "ready";

  setupPropertiesDrawer();
  setupDocumentMap();

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
