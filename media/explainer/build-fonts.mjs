import fs from "node:fs";
import https from "node:https";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function get(url) {
  return new Promise((res, rej) => {
    https
      .get(url, { headers: { "User-Agent": UA } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400) {
          return get(r.headers.location).then(res, rej);
        }
        const ch = [];
        r.on("data", (d) => ch.push(d));
        r.on("end", () => res(Buffer.concat(ch)));
      })
      .on("error", rej);
  });
}

const fams = [
  { q: "Space+Grotesk:wght@500;700", slug: "spacegrotesk" },
  { q: "JetBrains+Mono:wght@400;700", slug: "jbmono" },
];

let css = "";
for (const f of fams) {
  const sheet = (
    await get("https://fonts.googleapis.com/css2?family=" + f.q + "&display=swap")
  ).toString();
  const blocks = sheet.split("@font-face").slice(1);
  let i = 0;
  for (const b of blocks) {
    if (!/unicode-range:\s*U\+0000/i.test(b)) continue; // latin-basic subset only
    const fam = (b.match(/font-family:\s*'([^']+)'/) || [])[1];
    const wght = (b.match(/font-weight:\s*(\d+)/) || [])[1];
    const url = (b.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
    if (!url || !fam || !wght) continue;
    const fn = "fonts/" + f.slug + "-" + wght + ".woff2";
    fs.writeFileSync(fn, await get(url));
    css +=
      "@font-face{font-family:'" +
      fam +
      "';font-style:normal;font-weight:" +
      wght +
      ";font-display:swap;src:url('" +
      fn +
      "') format('woff2');}\n";
    i++;
  }
  console.log(f.slug, "->", i, "face(s)");
}
fs.writeFileSync("fonts/fonts.generated.css", css);
console.log("\n" + css);
