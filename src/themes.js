export const THEME_NAMES = Object.freeze([
  "default",
  "editorial",
  "technical",
  "bns-pitaya",
]);

export const THEME_DETAILS = Object.freeze({
  default: {
    description: "Tunelito's neutral system-sans reading surface.",
    colorModes: ["light", "dark"],
  },
  editorial: {
    description: "A spacious serif-led theme for essays and long-form review.",
    colorModes: ["light", "dark"],
  },
  technical: {
    description: "A compact sans/mono theme for code, tables, diagrams, and dense documentation.",
    colorModes: ["light", "dark"],
  },
  "bns-pitaya": {
    description: "A dark reading theme adapted from BNS Obsidian Pitaya without bundled or network fonts.",
    colorModes: ["dark"],
  },
});

const THEMES = {
  default: `
:root[data-tunelito-theme="default"] {
  color-scheme: light dark;
  --tl-font-body: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --tl-font-display: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --tl-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  --tl-page-bg: #f7f8fb;
  --tl-paper-bg: #ffffff;
  --tl-text: #1f2937;
  --tl-muted: #566477;
  --tl-faint: #64748b;
  --tl-heading-1: #111827;
  --tl-heading-2: #111827;
  --tl-heading-3: #111827;
  --tl-heading-4: #111827;
  --tl-heading-5: #111827;
  --tl-heading-6: #334155;
  --tl-accent: #0f766e;
  --tl-accent-strong: #115e59;
  --tl-border: #dbe3ee;
  --tl-soft: #f1f5f9;
  --tl-code-bg: #111827;
  --tl-code-text: #f9fafb;
  --tl-inline-code-bg: #edf2f7;
  --tl-quote: #475569;
  --tl-quote-border: #cbd5e1;
  --tl-selection: rgba(20, 184, 166, 0.28);
  --tl-error-bg: #fff7ed;
  --tl-error-border: #e3b6a7;
  --tl-error-text: #7c2d12;
  --tl-properties-bg: #f3f5f4;
  --tl-properties-shadow: rgba(15, 23, 42, 0.08);
  --tl-pill-bg: #e8f2ef;
  --tl-pill-border: #c9ddd9;
  --tl-pill-text: #305d57;
  --tl-reading-measure: 760px;
  --tl-page-padding: 48px 24px 72px;
  --tl-line-height: 1.55;
  --tl-paragraph-rhythm: 1rem;
}
@media (prefers-color-scheme: dark) {
  :root[data-tunelito-theme="default"] {
    --tl-page-bg: #111827;
    --tl-paper-bg: #18202f;
    --tl-text: #e5e7eb;
    --tl-muted: #cbd5e1;
    --tl-faint: #94a3b8;
    --tl-heading-1: #f9fafb;
    --tl-heading-2: #f9fafb;
    --tl-heading-3: #f9fafb;
    --tl-heading-4: #f9fafb;
    --tl-heading-5: #f9fafb;
    --tl-heading-6: #cbd5e1;
    --tl-accent: #5eead4;
    --tl-accent-strong: #99f6e4;
    --tl-border: #334155;
    --tl-soft: #243044;
    --tl-inline-code-bg: #243044;
    --tl-quote: #cbd5e1;
    --tl-quote-border: #475569;
    --tl-error-bg: #351f1b;
    --tl-error-border: #9a5a42;
    --tl-error-text: #fed7aa;
    --tl-properties-bg: #151d2a;
    --tl-properties-shadow: rgba(0, 0, 0, 0.2);
    --tl-pill-bg: #183c39;
    --tl-pill-border: #285b55;
    --tl-pill-text: #99f6e4;
  }
}
`,
  editorial: `
:root[data-tunelito-theme="editorial"] {
  color-scheme: light dark;
  --tl-font-body: Iowan Old Style, Baskerville, "Times New Roman", ui-serif, Georgia, serif;
  --tl-font-display: Avenir Next, Avenir, "Helvetica Neue", ui-sans-serif, system-ui, sans-serif;
  --tl-font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --tl-page-bg: #eeeae2;
  --tl-paper-bg: #fffdf8;
  --tl-text: #2f2a24;
  --tl-muted: #70675e;
  --tl-faint: #8d8277;
  --tl-heading-1: #251f1a;
  --tl-heading-2: #3d3028;
  --tl-heading-3: #60463a;
  --tl-heading-4: #765448;
  --tl-heading-5: #87665b;
  --tl-heading-6: #8a746a;
  --tl-accent: #9c3f2f;
  --tl-accent-strong: #742b20;
  --tl-border: #d9d0c3;
  --tl-soft: #f4efe6;
  --tl-code-bg: #292521;
  --tl-code-text: #f7f0e6;
  --tl-inline-code-bg: #eee5d8;
  --tl-quote: #5f554c;
  --tl-quote-border: #b46b53;
  --tl-selection: rgba(180, 107, 83, 0.26);
  --tl-error-bg: #fff1e8;
  --tl-error-border: #d9a183;
  --tl-error-text: #7a2e22;
  --tl-properties-bg: #f4efe6;
  --tl-properties-shadow: rgba(66, 49, 37, 0.12);
  --tl-pill-bg: #eee1d3;
  --tl-pill-border: #dac5b1;
  --tl-pill-text: #684b3c;
  --tl-reading-measure: 840px;
  --tl-page-padding: 64px 40px 96px;
  --tl-line-height: 1.72;
  --tl-paragraph-rhythm: 1.25rem;
  --tl-h1-size: clamp(2.65rem, 7vw, 4.6rem);
  --tl-h2-size: 1.75rem;
  --tl-h1-weight: 800;
  --tl-h2-weight: 750;
  --tl-h3-weight: 750;
}
:root[data-tunelito-theme="editorial"] .tunelito-markdown h1 {
  letter-spacing: -0.045em;
}
:root[data-tunelito-theme="editorial"] .tunelito-markdown h2 {
  border-top: 1px solid var(--tl-border);
  padding-top: 1.25rem;
}
:root[data-tunelito-theme="editorial"] .tunelito-markdown blockquote {
  font-size: 1.08em;
  font-style: italic;
}
:root[data-tunelito-theme="editorial"] .tunelito-markdown figcaption {
  font-family: var(--tl-font-display);
  letter-spacing: 0.02em;
}
@media (prefers-color-scheme: dark) {
  :root[data-tunelito-theme="editorial"] {
    --tl-page-bg: #171411;
    --tl-paper-bg: #201c18;
    --tl-text: #eee7dc;
    --tl-muted: #b9afa2;
    --tl-faint: #998e81;
    --tl-heading-1: #fff7ea;
    --tl-heading-2: #f2d4bd;
    --tl-heading-3: #e8c0aa;
    --tl-heading-4: #dcae98;
    --tl-heading-5: #c99d8c;
    --tl-heading-6: #b9988c;
    --tl-accent: #f09a7b;
    --tl-accent-strong: #ffc0a8;
    --tl-border: #493c33;
    --tl-soft: #2b2520;
    --tl-inline-code-bg: #332b25;
    --tl-quote: #d2c4b6;
    --tl-quote-border: #d68467;
    --tl-error-bg: #3b211a;
    --tl-error-border: #965945;
    --tl-error-text: #ffd0bc;
    --tl-properties-bg: #181512;
    --tl-properties-shadow: rgba(0, 0, 0, 0.28);
    --tl-pill-bg: #3a2c24;
    --tl-pill-border: #604638;
    --tl-pill-text: #f2c6af;
  }
}
`,
  technical: `
:root[data-tunelito-theme="technical"] {
  color-scheme: light dark;
  --tl-font-body: Inter, "Helvetica Neue", ui-sans-serif, system-ui, sans-serif;
  --tl-font-display: "IBM Plex Sans", Inter, ui-sans-serif, system-ui, sans-serif;
  --tl-font-mono: "IBM Plex Mono", "SFMono-Regular", Consolas, ui-monospace, monospace;
  --tl-page-bg: #edf2f7;
  --tl-paper-bg: #fdfefe;
  --tl-text: #17202a;
  --tl-muted: #536273;
  --tl-faint: #6b7d90;
  --tl-heading-1: #0d2638;
  --tl-heading-2: #123b55;
  --tl-heading-3: #174e6f;
  --tl-heading-4: #235f7d;
  --tl-heading-5: #356d87;
  --tl-heading-6: #527b8d;
  --tl-accent: #006d8f;
  --tl-accent-strong: #004d66;
  --tl-border: #c9d5df;
  --tl-soft: #e8f0f5;
  --tl-code-bg: #10212d;
  --tl-code-text: #e8f7ff;
  --tl-inline-code-bg: #e3eef4;
  --tl-quote: #425b6b;
  --tl-quote-border: #5c91a7;
  --tl-selection: rgba(0, 141, 180, 0.24);
  --tl-error-bg: #fff2ed;
  --tl-error-border: #e2a28b;
  --tl-error-text: #852c19;
  --tl-properties-bg: #e9f0f4;
  --tl-properties-shadow: rgba(18, 59, 85, 0.11);
  --tl-pill-bg: #d9edf2;
  --tl-pill-border: #afd1da;
  --tl-pill-text: #244f5d;
  --tl-reading-measure: 1020px;
  --tl-page-padding: 36px 32px 64px;
  --tl-line-height: 1.52;
  --tl-paragraph-rhythm: 0.9rem;
  --tl-h1-size: 2rem;
  --tl-h2-size: 1.35rem;
  --tl-h3-size: 1.08rem;
  --tl-h1-weight: 760;
  --tl-h2-weight: 720;
}
:root[data-tunelito-theme="technical"] .tunelito-markdown {
  font-size: 0.96rem;
}
:root[data-tunelito-theme="technical"] .tunelito-markdown h1,
:root[data-tunelito-theme="technical"] .tunelito-markdown h2,
:root[data-tunelito-theme="technical"] .tunelito-markdown h3 {
  letter-spacing: -0.02em;
}
:root[data-tunelito-theme="technical"] .tunelito-markdown h2 {
  border-bottom: 1px solid var(--tl-border);
  padding-bottom: 0.35rem;
}
:root[data-tunelito-theme="technical"] .tunelito-markdown table {
  font-size: 0.9rem;
}
@media (prefers-color-scheme: dark) {
  :root[data-tunelito-theme="technical"] {
    --tl-page-bg: #07131b;
    --tl-paper-bg: #0d1d27;
    --tl-text: #dce9ef;
    --tl-muted: #a7bac4;
    --tl-faint: #8299a6;
    --tl-heading-1: #f0fbff;
    --tl-heading-2: #bcecff;
    --tl-heading-3: #8cdaef;
    --tl-heading-4: #72c2d7;
    --tl-heading-5: #6cafbf;
    --tl-heading-6: #83aab5;
    --tl-accent: #5dd5f2;
    --tl-accent-strong: #a6ecfb;
    --tl-border: #29414e;
    --tl-soft: #162b36;
    --tl-inline-code-bg: #18313e;
    --tl-quote: #b3c7d0;
    --tl-quote-border: #4b9ab3;
    --tl-error-bg: #3b201c;
    --tl-error-border: #985348;
    --tl-error-text: #ffc9be;
    --tl-properties-bg: #091821;
    --tl-properties-shadow: rgba(0, 0, 0, 0.28);
    --tl-pill-bg: #173b46;
    --tl-pill-border: #276070;
    --tl-pill-text: #a9e8f4;
  }
}
`,
  "bns-pitaya": `
:root[data-tunelito-theme="bns-pitaya"] {
  color-scheme: dark;
  --tl-font-body: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --tl-font-display: "Geist Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --tl-font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --tl-page-bg: #0c0c10;
  --tl-paper-bg: #121318;
  --tl-text: #dcdcdc;
  --tl-muted: #908d9e;
  --tl-faint: #7e7e90;
  --tl-heading-1: #f5d0a9;
  --tl-heading-2: #f0c0ae;
  --tl-heading-3: #ebb0b4;
  --tl-heading-4: #dca0b8;
  --tl-heading-5: #c992b5;
  --tl-heading-6: #b585ad;
  --tl-accent: #d4a574;
  --tl-accent-strong: #e0ba78;
  --tl-border: #272833;
  --tl-soft: #1a1a23;
  --tl-code-bg: #0c0c10;
  --tl-code-text: #fefeff;
  --tl-inline-code-bg: #1e1f29;
  --tl-quote: #e8e3dd;
  --tl-quote-border: rgba(212, 165, 116, 0.55);
  --tl-selection: rgba(212, 165, 116, 0.3);
  --tl-error-bg: #321d21;
  --tl-error-border: #864b55;
  --tl-error-text: #e7a1a1;
  --tl-properties-bg: #0e0e13;
  --tl-properties-shadow: rgba(0, 0, 0, 0.32);
  --tl-pill-bg: rgba(212, 165, 116, 0.1);
  --tl-pill-border: rgba(212, 165, 116, 0.28);
  --tl-pill-text: #e0ba78;
  --tl-reading-measure: 860px;
  --tl-page-padding: 56px 36px 88px;
  --tl-line-height: 1.68;
  --tl-paragraph-rhythm: 1.15rem;
  --tl-link-external: #8baa90;
  --tl-strong: #e0ba78;
  --tl-emphasis: #b898a5;
  --tl-code-keyword: #f26196;
  --tl-code-string: #8baa90;
  --tl-code-comment: #7e7e90;
  --tl-mermaid-background: #121318;
  --tl-mermaid-primary: #1e1f29;
  --tl-mermaid-primary-text: #dcdcdc;
  --tl-mermaid-border: #7e7e90;
  --tl-mermaid-secondary: #29231d;
  --tl-mermaid-tertiary: #20232a;
  --tl-mermaid-line: #908d9e;
  --tl-mermaid-edge-label: #121318;
}
:root[data-tunelito-theme="bns-pitaya"] .tunelito-markdown strong {
  color: var(--tl-strong);
}
:root[data-tunelito-theme="bns-pitaya"] .tunelito-markdown th,
:root[data-tunelito-theme="bns-pitaya"] .tunelito-markdown td {
  border-width: 0 0 1px;
}
:root[data-tunelito-theme="bns-pitaya"] .tunelito-markdown th {
  color: #908d9e;
  background: transparent;
  font-family: var(--tl-font-display);
  font-size: 0.82em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
:root[data-tunelito-theme="bns-pitaya"] .tunelito-markdown pre {
  box-shadow: inset 3px 0 #f26196;
}
`,
};

export function normalizeThemeName(value) {
  const name = String(value || "default").trim().toLowerCase();
  if (THEME_NAMES.includes(name)) return name;
  throw new Error(`Unknown theme "${value}". Available themes: ${THEME_NAMES.join(", ")}`);
}

export function themeCss(value) {
  const name = normalizeThemeName(value);
  return THEMES[name].trim();
}
