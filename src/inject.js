export const CLIENT_ROUTE = "/__tunelito/client.js";
export const COMMENTS_ROUTE = "/__tunelito/comments.md";
export const AGENT_STATUS_ROUTE = "/__tunelito/agent-status.json";
export const REVIEW_EVENTS_ROUTE = "/__tunelito/review-events";
export const WS_ROUTE = "/__tunelito/ws";
export const TUNELITO_RESPONSE_HEADER = "x-tunelito-review";

export function injectTunelitoClient(html, { sourceName, liveMode = false, defaultAuthor = "", viewerRole = "", ownerSession = "" } = {}) {
  const liveAttribute = liveMode ? ` data-live-mode="true"` : "";
  const authorAttribute = defaultAuthor ? ` data-default-author="${escapeAttribute(defaultAuthor)}"` : "";
  const roleAttribute = viewerRole ? ` data-viewer-role="${escapeAttribute(viewerRole)}"` : "";
  const ownerSessionAttribute = ownerSession ? ` data-owner-session="${escapeAttribute(ownerSession)}"` : "";
  const script = `<script src="${CLIENT_ROUTE}" data-source-name="${escapeAttribute(sourceName || "HTML page")}"${liveAttribute}${authorAttribute}${roleAttribute}${ownerSessionAttribute}></script>`;
  let output = stripMetaCsp(String(html));

  if (hasTunelitoClientScript(output)) return output;

  if (/<\/body\s*>/i.test(output)) {
    return output.replace(/<\/body\s*>/i, `${script}\n</body>`);
  }

  if (/<\/html\s*>/i.test(output)) {
    return output.replace(/<\/html\s*>/i, `${script}\n</html>`);
  }

  return `${output}\n${script}\n`;
}

export function stripMetaCsp(html) {
  return html.replace(
    /<meta\b(?=[^>]*http-equiv\s*=\s*["']?content-security-policy["']?)[^>]*>/gi,
    "",
  );
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hasTunelitoClientScript(html) {
  const scriptTags = String(html).matchAll(/<script\b[^>]*>/gi);
  for (const match of scriptTags) {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
    const value = src?.[1] ?? src?.[2] ?? src?.[3] ?? "";
    if (value.split(/[?#]/, 1)[0] === CLIENT_ROUTE) return true;
  }
  return false;
}
