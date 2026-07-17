(() => {
  const MAX_TEXT_SIZE = 50_000;
  const figures = Array.from(document.querySelectorAll("[data-tunelito-mermaid]"))
    .filter((figure) => figure.dataset.mermaidState === "source");

  if (figures.length === 0) return;

  const mermaid = globalThis.mermaid;
  if (!mermaid?.initialize || !mermaid?.parse || !mermaid?.render) {
    for (const figure of figures) showError(figure, "Mermaid could not load. Review the source below.");
    window.dispatchEvent(new CustomEvent("tunelito:mermaid-rendered"));
    return;
  }

  const themeVariables = mermaidThemeVariables();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    theme: "base",
    themeVariables,
    suppressErrorRendering: true,
    maxTextSize: MAX_TEXT_SIZE,
    maxEdges: 500,
    secure: ["secure", "securityLevel", "startOnLoad", "htmlLabels", "maxTextSize", "suppressErrorRendering", "maxEdges"],
  });

  renderFigures(mermaid, figures, MAX_TEXT_SIZE)
    .finally(() => window.dispatchEvent(new CustomEvent("tunelito:mermaid-rendered")));
})();

function mermaidThemeVariables() {
  const styles = getComputedStyle(document.documentElement);
  const value = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const text = value("--tl-mermaid-primary-text", "#111827");
  return {
    background: value("--tl-mermaid-background", "#ffffff"),
    primaryColor: value("--tl-mermaid-primary", "#e2e8f0"),
    primaryTextColor: text,
    primaryBorderColor: value("--tl-mermaid-border", "#64748b"),
    secondaryColor: value("--tl-mermaid-secondary", "#ccfbf1"),
    secondaryTextColor: text,
    tertiaryColor: value("--tl-mermaid-tertiary", "#f1f5f9"),
    tertiaryTextColor: text,
    lineColor: value("--tl-mermaid-line", "#475569"),
    textColor: text,
    edgeLabelBackground: value("--tl-mermaid-edge-label", "#ffffff"),
  };
}

async function renderFigures(mermaid, figures, maxTextSize) {
  let sequence = 0;
  for (const figure of figures) {
    if (figure.dataset.mermaidState !== "source") continue;
    figure.dataset.mermaidState = "rendering";
    const status = figure.querySelector(".tunelito-mermaid-status");
    if (status) status.textContent = "Rendering Mermaid diagram…";

    const source = figure.querySelector("code.language-mermaid")?.textContent?.replace(/\n$/, "") || "";
    if (source.length > maxTextSize) {
      showError(figure, "Mermaid diagram is too large to render safely. Review the source below.");
      continue;
    }

    try {
      await mermaid.parse(source);
      sequence += 1;
      const canvas = figure.querySelector(".tunelito-mermaid-canvas");
      const id = `tunelito-mermaid-${sequence}`;
      const { svg, bindFunctions } = await mermaid.render(id, source, canvas);
      canvas.innerHTML = svg;
      canvas.removeAttribute("aria-hidden");
      bindFunctions?.(canvas);
      figure.dataset.mermaidState = "rendered";
      if (status) status.textContent = "Rendered Mermaid diagram.";
      figure.querySelector("details")?.removeAttribute("open");
    } catch {
      showError(figure, "Could not render Mermaid diagram. Review the source below.");
    }
  }
}

function showError(figure, message) {
  const canvas = figure.querySelector(".tunelito-mermaid-canvas");
  if (canvas) {
    canvas.replaceChildren();
    canvas.setAttribute("aria-hidden", "true");
  }
  figure.dataset.mermaidState = "error";
  const status = figure.querySelector(".tunelito-mermaid-status");
  if (status) {
    status.textContent = message;
    status.setAttribute("role", "alert");
  }
  figure.querySelector("details")?.setAttribute("open", "");
}
