export const CLIENT_ROUTE = "/__tunelito/client.js";
export const COMMENTS_ROUTE = "/__tunelito/comments.md";
export const WS_ROUTE = "/__tunelito/ws";

export function injectTunelitoClient(html, { sourceName, liveMode = false } = {}) {
  const liveAttribute = liveMode ? ` data-live-mode="true"` : "";
  const script = `<script src="${CLIENT_ROUTE}" data-source-name="${escapeAttribute(sourceName || "HTML page")}"${liveAttribute}></script>`;
  let output = stripMetaCsp(String(html));

  if (output.includes(CLIENT_ROUTE)) return output;

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
