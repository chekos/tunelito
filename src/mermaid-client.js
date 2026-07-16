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

  const darkMode = matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    theme: "base",
    themeVariables: darkMode ? {
      background: "#18202f",
      primaryColor: "#243044",
      primaryTextColor: "#f8fafc",
      primaryBorderColor: "#94a3b8",
      secondaryColor: "#134e4a",
      secondaryTextColor: "#f8fafc",
      tertiaryColor: "#1e293b",
      tertiaryTextColor: "#f8fafc",
      lineColor: "#cbd5e1",
      textColor: "#f8fafc",
      edgeLabelBackground: "#18202f",
    } : {
      background: "#ffffff",
      primaryColor: "#e2e8f0",
      primaryTextColor: "#111827",
      primaryBorderColor: "#64748b",
      secondaryColor: "#ccfbf1",
      secondaryTextColor: "#111827",
      tertiaryColor: "#f1f5f9",
      tertiaryTextColor: "#111827",
      lineColor: "#475569",
      textColor: "#111827",
      edgeLabelBackground: "#ffffff",
    },
    suppressErrorRendering: true,
    maxTextSize: MAX_TEXT_SIZE,
    maxEdges: 500,
    secure: ["secure", "securityLevel", "startOnLoad", "htmlLabels", "maxTextSize", "suppressErrorRendering", "maxEdges"],
  });

  renderFigures(mermaid, figures, MAX_TEXT_SIZE)
    .finally(() => window.dispatchEvent(new CustomEvent("tunelito:mermaid-rendered")));
})();

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
