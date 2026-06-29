// Regenerate the self-hosted woff2 files referenced by the compositions.
// Fonts come from the soyserg.io "México Noir" design system:
//   Source Serif 4 (variable) — display + body
//   Kalam 300/400/700        — handwritten margin notes
//   JetBrains Mono 400/700    — the "system monospace" role (build stats, terminals)
// Run: node build-fonts.mjs   (requires network access to fonts.gstatic.com)
import fs from "node:fs";
import https from "node:https";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function get(url) {
  return new Promise((res, rej) => {
    https
      .get(url, { headers: { "User-Agent": UA } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400) return get(r.headers.location).then(res, rej);
        const ch = [];
        r.on("data", (d) => ch.push(d));
        r.on("end", () => res(Buffer.concat(ch)));
      })
      .on("error", rej);
  });
}

const fams = [
  {
    q: "Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900",
    name: (style, w) => `sourceserif-${style}-${w.replace(/\s+/g, "_")}.woff2`,
  },
  { q: "Kalam:wght@300;400;700", name: (style, w) => `kalam-${style}-${w}.woff2` },
  { q: "JetBrains+Mono:wght@400;700", name: (style, w) => `jbmono-${w}.woff2` },
];

let css = "";
for (const f of fams) {
  const sheet = (await get("https://fonts.googleapis.com/css2?family=" + f.q + "&display=swap")).toString();
  for (const b of sheet.split("@font-face").slice(1)) {
    if (!/unicode-range:\s*U\+0000/i.test(b)) continue; // latin-basic subset only
    const fam = (b.match(/font-family:\s*'([^']+)'/) || [])[1];
    const style = /font-style:\s*italic/i.test(b) ? "italic" : "normal";
    const w = (b.match(/font-weight:\s*([0-9 ]+);/) || [])[1].trim();
    const url = (b.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
    if (!url || !fam) continue;
    const fn = "fonts/" + f.name(style, w);
    fs.writeFileSync(fn, await get(url));
    css += `@font-face{font-family:'${fam}';font-style:${style};font-weight:${w};font-display:swap;src:url('${fn}') format('woff2');}\n`;
    console.log("wrote", fn);
  }
}
console.log("\n" + css);
