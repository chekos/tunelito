import { Marked, Renderer } from "marked";
import markedFootnote from "marked-footnote";
import { extractFrontMatter, propertyDisplay } from "./frontmatter.js";
import { DEFAULT_THEME_NAME, normalizeThemeName, themeCss } from "./themes.js";

export const MERMAID_LIBRARY_ROUTE = "/__tunelito/mermaid.js";
export const MERMAID_CLIENT_ROUTE = "/__tunelito/mermaid-client.js";
export const MARKDOWN_CLIENT_ROUTE = "/__tunelito/markdown-client.js";

const DEFAULT_MARKDOWN_CSS = `
:root {
  color-scheme: light dark;
  --tl-heading-line-height: 1.2;
  --tl-h1-size: 2.25rem;
  --tl-h2-size: 1.45rem;
  --tl-h3-size: 1.15rem;
  --tl-h4-size: 1rem;
  --tl-h5-size: 0.9rem;
  --tl-h6-size: 0.9rem;
  --tl-h1-weight: 750;
  --tl-h2-weight: 700;
  --tl-h3-weight: 700;
  --tl-h4-weight: 700;
  --tl-h5-weight: 700;
  --tl-h6-weight: 700;
  --tl-h1-margin: 0 0 1.5rem;
  --tl-h2-margin: 2rem 0 0.8rem;
  --tl-h3-margin: 1.6rem 0 0.6rem;
  --tl-h4-margin: 1.35rem 0 0.5rem;
  --tl-h5-margin: 1.15rem 0 0.45rem;
  --tl-h6-margin: 1.15rem 0 0.45rem;
  --tl-link: var(--tl-accent);
  --tl-link-external: var(--tl-accent);
  --tl-link-hover: var(--tl-accent-strong);
  --tl-wikilink: var(--tl-accent);
  --tl-wikilink-hover: var(--tl-accent-strong);
  --tl-strong: var(--tl-heading-3);
  --tl-emphasis: var(--tl-muted);
  --tl-list-marker: var(--tl-muted);
  --tl-focus-ring: var(--tl-selection);
  --tl-ruler-unread: var(--tl-faint);
  --tl-ruler-consumed: var(--tl-border);
  --tl-ruler-current: var(--tl-accent);
  --tl-mermaid-background: var(--tl-paper-bg);
  --tl-mermaid-primary: var(--tl-soft);
  --tl-mermaid-primary-text: var(--tl-text);
  --tl-mermaid-border: var(--tl-muted);
  --tl-mermaid-secondary: var(--tl-pill-bg);
  --tl-mermaid-tertiary: var(--tl-inline-code-bg);
  --tl-mermaid-line: var(--tl-muted);
  --tl-mermaid-edge-label: var(--tl-paper-bg);
  --tl-code-keyword: var(--tl-accent);
  --tl-code-string: var(--tl-heading-3);
  --tl-code-comment: var(--tl-muted);
  font-family: var(--tl-font-body);
  line-height: var(--tl-line-height);
  background: var(--tl-page-bg);
  color: var(--tl-text);
}
body {
  margin: 0;
  overflow-x: hidden;
  background: var(--tl-page-bg);
  color: var(--tl-text);
}
::selection {
  background: var(--tl-selection);
}
.tunelito-page-frame {
  box-sizing: border-box;
  min-height: 100vh;
  transition: padding-left 180ms ease;
}
.tunelito-has-sidebar.tunelito-properties-open .tunelito-page-frame {
  padding-left: 288px;
}
.tunelito-markdown {
  box-sizing: border-box;
  max-width: var(--tl-reading-measure);
  min-height: 100vh;
  margin: 0 auto;
  padding: var(--tl-page-padding);
  background: var(--tl-paper-bg);
  color: var(--tl-text);
  font-family: var(--tl-font-body);
}
.tunelito-markdown > :first-child {
  margin-top: 0;
}
.tunelito-markdown > * {
  scroll-margin-top: 24px;
}
.tunelito-markdown h1,
.tunelito-markdown h2,
.tunelito-markdown h3,
.tunelito-markdown h4,
.tunelito-markdown h5,
.tunelito-markdown h6 {
  font-family: var(--tl-font-display);
  line-height: var(--tl-heading-line-height);
  letter-spacing: 0;
}
.tunelito-markdown h1 { color: var(--tl-heading-1); }
.tunelito-markdown h2 { color: var(--tl-heading-2); }
.tunelito-markdown h3 { color: var(--tl-heading-3); }
.tunelito-markdown h4 { color: var(--tl-heading-4); }
.tunelito-markdown h5 { color: var(--tl-heading-5); }
.tunelito-markdown h6 { color: var(--tl-heading-6); }
.tunelito-markdown h1 {
  margin: var(--tl-h1-margin);
  font-size: var(--tl-h1-size);
  font-weight: var(--tl-h1-weight);
}
.tunelito-markdown h2 {
  margin: var(--tl-h2-margin);
  font-size: var(--tl-h2-size);
  font-weight: var(--tl-h2-weight);
}
.tunelito-markdown h3 {
  margin: var(--tl-h3-margin);
  font-size: var(--tl-h3-size);
  font-weight: var(--tl-h3-weight);
}
.tunelito-markdown h4 {
  margin: var(--tl-h4-margin);
  font-size: var(--tl-h4-size);
  font-weight: var(--tl-h4-weight);
}
.tunelito-markdown h5 {
  margin: var(--tl-h5-margin);
  font-size: var(--tl-h5-size);
  font-weight: var(--tl-h5-weight);
}
.tunelito-markdown h6 {
  margin: var(--tl-h6-margin);
  font-size: var(--tl-h6-size);
  font-weight: var(--tl-h6-weight);
  letter-spacing: 0.02em;
}
.tunelito-markdown p,
.tunelito-markdown ul,
.tunelito-markdown ol,
.tunelito-markdown blockquote,
.tunelito-markdown pre,
.tunelito-markdown table {
  margin: 0 0 var(--tl-paragraph-rhythm);
}
.tunelito-markdown a {
  color: var(--tl-link);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}
.tunelito-markdown a[href^="http://"],
.tunelito-markdown a[href^="https://"] {
  color: var(--tl-link-external);
}
.tunelito-markdown a:hover,
.tunelito-markdown a:focus-visible {
  color: var(--tl-link-hover);
}
.tunelito-wikilink {
  color: var(--tl-wikilink);
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
  cursor: text;
}
.tunelito-wikilink:hover {
  color: var(--tl-wikilink-hover);
  text-decoration-style: solid;
}
.tunelito-properties {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 2147483600;
  box-sizing: border-box;
  width: 272px;
  overflow: auto;
  border-right: 1px solid var(--tl-border);
  background: var(--tl-properties-bg);
  color: var(--tl-text);
  box-shadow: 12px 0 36px var(--tl-properties-shadow);
  transition: transform 180ms ease, visibility 180ms ease;
}
.tunelito-properties-header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 24px 20px 16px;
  border-bottom: 1px solid var(--tl-border);
  background: color-mix(in srgb, var(--tl-properties-bg) 92%, transparent);
  backdrop-filter: blur(12px);
}
.tunelito-properties-kicker {
  margin: 0 0 3px;
  color: var(--tl-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.tunelito-properties-title {
  margin: 0;
  color: var(--tl-text);
  font-family: var(--tl-font-display);
  font-size: 1.05rem;
  font-weight: 650;
}
.tunelito-sidebar-section {
  padding: 20px;
}
.tunelito-sidebar-section + .tunelito-sidebar-section {
  border-top: 1px solid var(--tl-border);
}
.tunelito-sidebar-section-header {
  margin-bottom: 12px;
}
.tunelito-sidebar-section-title {
  margin: 0;
  color: var(--tl-text);
  font-family: var(--tl-font-display);
  font-size: 0.92rem;
  font-weight: 700;
}
.tunelito-navigation-list,
.tunelito-navigation-children {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tunelito-navigation-children {
  margin: 4px 0 4px 13px;
  border-left: 1px solid var(--tl-border);
  padding-left: 10px;
}
.tunelito-navigation-link,
.tunelito-navigation-folder-link,
.tunelito-navigation-summary {
  box-sizing: border-box;
  color: var(--tl-text);
  font: 600 0.8rem/1.35 var(--tl-font-body);
}
.tunelito-navigation-link,
.tunelito-navigation-folder-link {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  border-radius: 6px;
  padding: 7px 8px;
  text-decoration: none;
}
.tunelito-navigation-link:hover,
.tunelito-navigation-folder-link:hover,
.tunelito-navigation-link:focus-visible,
.tunelito-navigation-folder-link:focus-visible {
  background: var(--tl-soft);
  color: var(--tl-accent);
}
.tunelito-navigation-link:focus-visible,
.tunelito-navigation-folder-link:focus-visible,
.tunelito-navigation-summary:focus-visible {
  outline: 3px solid var(--tl-selection);
  outline-offset: 2px;
}
.tunelito-navigation-link[aria-current="page"] {
  border: 1px solid var(--tl-accent);
  background: var(--tl-soft);
  color: var(--tl-accent-strong);
  font-weight: 750;
}
.tunelito-navigation-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tunelito-navigation-kind {
  flex: 0 0 auto;
  color: var(--tl-muted);
  font-size: 0.72rem;
}
.tunelito-navigation-current {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--tl-muted);
  font-size: 0.64rem;
  font-weight: 750;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.tunelito-navigation-folder {
  min-width: 0;
}
.tunelito-navigation-summary {
  display: flex;
  min-height: 34px;
  min-width: 0;
  align-items: center;
  gap: 7px;
  border-radius: 6px;
  padding: 7px 8px;
  cursor: pointer;
  list-style: none;
}
.tunelito-navigation-summary::-webkit-details-marker {
  display: none;
}
.tunelito-navigation-summary::before {
  flex: 0 0 auto;
  width: 0.8rem;
  color: var(--tl-muted);
  content: "›";
  font-size: 1rem;
  line-height: 1;
  transform-origin: center;
  transition: transform 120ms ease;
}
.tunelito-navigation-folder[open] > .tunelito-navigation-summary::before {
  transform: rotate(90deg);
}
.tunelito-navigation-summary:hover {
  background: var(--tl-soft);
  color: var(--tl-accent);
}
.tunelito-navigation-empty {
  margin: 0;
  color: var(--tl-muted);
  font-size: 0.8rem;
}
.tunelito-properties-collapse,
.tunelito-properties-tab {
  border: 1px solid var(--tl-border);
  background: var(--tl-paper-bg);
  color: var(--tl-muted);
  cursor: pointer;
  font: 700 0.75rem/1 var(--tl-font-display);
}
.tunelito-properties-collapse {
  width: 34px;
  height: 34px;
  border-radius: 999px;
}
.tunelito-properties-collapse:hover,
.tunelito-properties-tab:hover {
  border-color: var(--tl-accent);
  color: var(--tl-accent);
}
.tunelito-properties-collapse:focus-visible,
.tunelito-properties-tab:focus-visible {
  outline: 3px solid var(--tl-selection);
  outline-offset: 3px;
}
.tunelito-properties-list {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 0;
}
.tunelito-property {
  display: grid;
  gap: 5px;
}
.tunelito-property dt {
  color: var(--tl-muted);
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tunelito-property dd {
  min-width: 0;
  margin: 0;
  color: var(--tl-text);
  font-size: 0.86rem;
  overflow-wrap: anywhere;
}
.tunelito-property-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.tunelito-property-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border: 1px solid var(--tl-pill-border);
  border-radius: 999px;
  background: var(--tl-pill-bg);
  color: var(--tl-pill-text);
  padding: 2px 8px;
  font-size: 0.76rem;
}
.tunelito-property-complex {
  margin: 0;
  white-space: pre-wrap;
  font: 0.72rem/1.45 var(--tl-font-mono);
}
.tunelito-properties-error {
  margin: 20px;
  border: 1px solid var(--tl-error-border);
  border-radius: 8px;
  background: var(--tl-error-bg);
  padding: 14px;
  color: var(--tl-error-text);
  font-size: 0.82rem;
}
.tunelito-properties-error p {
  margin: 0 0 10px;
}
.tunelito-properties-error details pre {
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 0.7rem;
}
.tunelito-properties-tab {
  position: fixed;
  top: 32px;
  left: 0;
  z-index: 2147483601;
  min-height: 42px;
  border-left: 0;
  border-radius: 0 999px 999px 0;
  box-shadow: 6px 8px 22px rgba(15, 23, 42, 0.12);
  padding: 0 14px 0 11px;
}
.tunelito-properties-collapsed .tunelito-properties {
  visibility: hidden;
  transform: translateX(-100%);
}
.tunelito-properties-open .tunelito-properties-tab {
  display: none;
}
.tunelito-document-map {
  --ruler-unread: var(--tl-ruler-unread);
  --ruler-consumed: var(--tl-ruler-consumed);
  --ruler-accent: var(--tl-ruler-current);
  --ruler-track-height: min(500px, calc(100vh - 120px));
  position: fixed;
  top: 50%;
  right: 0;
  bottom: auto;
  z-index: 2147483598;
  width: 58px;
  height: var(--ruler-track-height);
  color: var(--tl-muted);
  transform: translateY(-50%);
  transition: width 160ms ease, right 160ms ease, opacity 160ms ease;
}
.tunelito-document-map:hover,
.tunelito-document-map:focus-within {
  width: min(300px, 40vw);
}
.tunelito-document-map-track {
  position: absolute;
  inset: 0;
}
.tunelito-ruler-marker {
  position: absolute;
  top: calc(var(--ruler-position) * 100%);
  right: 12px;
  display: block;
  width: var(--ruler-length);
  height: 16px;
  margin: -8px 0 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}
.tunelito-document-map:hover .tunelito-ruler-marker,
.tunelito-document-map:focus-within .tunelito-ruler-marker {
  width: calc(var(--ruler-length) + 190px);
}
.tunelito-ruler-tick {
  position: absolute;
  top: 7px;
  right: 0;
  width: var(--ruler-length);
  height: 1px;
  background: var(--ruler-unread);
  transition: width 120ms ease, background 120ms ease, height 120ms ease;
}
.tunelito-ruler-marker[data-state="consumed"] .tunelito-ruler-tick {
  background: var(--ruler-consumed);
}
.tunelito-ruler-marker[data-state="current"] .tunelito-ruler-tick,
.tunelito-ruler-marker:hover .tunelito-ruler-tick,
.tunelito-ruler-marker:focus-visible .tunelito-ruler-tick {
  width: 38px;
  height: 2px;
  background: var(--ruler-accent);
}
.tunelito-ruler-label {
  position: absolute;
  top: 50%;
  right: 48px;
  max-width: 205px;
  overflow: hidden;
  color: var(--tl-muted);
  font: 650 0.73rem/1.2 var(--tl-font-display);
  opacity: 0;
  pointer-events: none;
  text-align: right;
  text-overflow: ellipsis;
  transform: translate(8px, -50%);
  transition: opacity 120ms ease, transform 120ms ease;
  white-space: nowrap;
}
.tunelito-document-map:hover .tunelito-ruler-label,
.tunelito-document-map:focus-within .tunelito-ruler-label {
  opacity: 1;
  pointer-events: auto;
  transform: translate(0, -50%);
}
.tunelito-ruler-marker[data-state="current"] .tunelito-ruler-label,
.tunelito-ruler-marker:hover .tunelito-ruler-label,
.tunelito-ruler-marker:focus-visible .tunelito-ruler-label {
  color: var(--ruler-accent);
}
.tunelito-ruler-marker:focus-visible {
  outline: 2px solid var(--tl-selection);
  outline-offset: 2px;
}
.tunelito-ruler-scrubber {
  position: absolute;
  top: 0;
  right: 10px;
  bottom: 0;
  width: 40px;
  height: auto;
  border: 0;
  padding: 0;
  background: transparent;
  pointer-events: none;
}
.tunelito-ruler-scrubber:focus-visible {
  outline: 2px solid var(--ruler-accent);
  outline-offset: 4px;
}
body.tunelito-comments-open .tunelito-document-map {
  right: 396px;
}
@media (max-width: 1180px) {
  body.tunelito-comments-open .tunelito-document-map {
    opacity: 0;
    pointer-events: none;
  }
}
@media (max-width: 960px) {
  .tunelito-has-sidebar.tunelito-properties-open .tunelito-page-frame {
    padding-left: 0;
  }
  .tunelito-properties {
    width: min(320px, calc(100vw - 28px));
    box-shadow: 18px 0 50px rgba(15, 23, 42, 0.2);
  }
}
@media (max-width: 760px) {
  .tunelito-document-map {
    display: none;
  }
  .tunelito-markdown {
    padding: 34px 20px 64px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tunelito-page-frame,
  .tunelito-properties,
  .tunelito-document-map,
  .tunelito-navigation-summary::before,
  .tunelito-ruler-tick,
  .tunelito-ruler-label {
    scroll-behavior: auto;
    transition: none;
  }
}
.tunelito-badge {
  display: inline-flex;
  align-items: center;
  margin: 0 0.15rem;
  border: 1px solid var(--tl-border);
  border-radius: 999px;
  background: var(--tl-soft);
  color: var(--tl-text);
  padding: 0.05rem 0.45rem;
  font: 700 0.72rem/1.4 var(--tl-font-body);
  letter-spacing: 0.02em;
  vertical-align: 0.08em;
}
.tunelito-badge[data-tone="active"] { border-color: #5eead4; }
.tunelito-badge[data-tone="done"] { border-color: #86efac; }
.tunelito-badge[data-tone="warning"] { border-color: #facc15; }
.tunelito-badge[data-tone="danger"] { border-color: #fca5a5; }
.tunelito-fold {
  float: right;
  margin: 0.2rem 0 0 10px;
  border: 1px solid var(--tl-border);
  border-radius: 999px;
  background: var(--tl-soft);
  color: var(--tl-text);
  cursor: pointer;
  font: 700 0.68rem/1 var(--tl-font-body);
  padding: 5px 8px;
}
.tunelito-section-count {
  margin-left: 6px;
}
.tunelito-section-count[hidden] { display: none; }
.tunelito-section-index {
  position: fixed;
  z-index: 4;
  top: 18px;
  left: 16px;
  width: min(200px, 22vw);
  max-height: calc(100vh - 36px);
  overflow: auto;
  border: 1px solid var(--tl-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--tl-paper-bg) 92%, transparent);
  color: var(--tl-text);
  padding: 10px 12px;
  font: 650 0.78rem/1.35 var(--tl-font-body);
}
.tunelito-section-index ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.tunelito-section-index a {
  display: block;
  color: inherit;
  text-decoration: none;
  padding: 3px 0;
}
.tunelito-section-index a[data-level="3"] { padding-left: 12px; }
.tunelito-section-index a[aria-current="location"] { font-weight: 750; }
.tunelito-section-count-inline {
  margin-left: 6px;
  color: var(--tl-quote);
}
.tunelito-link-card {
  position: fixed;
  z-index: 30;
  max-width: 280px;
  padding: 8px 10px;
  border: 1px solid var(--tl-border);
  border-radius: 8px;
  background: var(--tl-paper-bg);
  color: var(--tl-text);
  box-shadow: 0 8px 28px var(--tl-properties-shadow);
  font: 650 0.78rem/1.35 var(--tl-font-body);
  pointer-events: none;
}
.tunelito-link-card p { margin: 0; }
.tunelito-link-card .meta { color: var(--tl-quote); }
@media (max-width: 1100px) {
  .tunelito-section-index { display: none; }
}
.tunelito-has-sidebar .tunelito-section-index { display: none; }
.tunelito-markdown blockquote {
  border-left: 4px solid var(--tl-quote-border);
  padding-left: 1rem;
  color: var(--tl-quote);
}
.tunelito-markdown code,
.tunelito-markdown pre {
  font-family: var(--tl-font-mono);
}
.tunelito-markdown code {
  border-radius: 4px;
  padding: 0.1rem 0.28rem;
  background: var(--tl-inline-code-bg);
}
.tunelito-markdown pre {
  overflow-x: auto;
  border: 1px solid var(--tl-border);
  border-radius: 8px;
  padding: 1rem;
  background: var(--tl-code-bg);
  color: var(--tl-code-text);
}
.tunelito-markdown pre code {
  padding: 0;
  background: transparent;
  color: inherit;
}
.tunelito-mermaid {
  margin: 0 0 var(--tl-paragraph-rhythm);
  border: 1px solid var(--tl-border);
  border-radius: 8px;
  padding: 1rem;
  background: var(--tl-soft);
}
.tunelito-mermaid-canvas {
  overflow-x: auto;
  text-align: center;
}
.tunelito-mermaid-canvas svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.tunelito-mermaid-status {
  margin: 0.75rem 0 0;
  color: var(--tl-muted);
  font-size: 0.9rem;
}
.tunelito-mermaid[data-mermaid-state="rendered"] .tunelito-mermaid-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.tunelito-mermaid[data-mermaid-state="error"] {
  border-color: var(--tl-error-border);
  background: var(--tl-error-bg);
}
.tunelito-mermaid[data-mermaid-state="error"] .tunelito-mermaid-status {
  color: var(--tl-error-text);
  font-weight: 600;
}
.tunelito-mermaid details {
  margin-top: 0.75rem;
}
.tunelito-mermaid details pre {
  margin: 0.75rem 0 0;
}
.tunelito-markdown [data-footnote-ref] {
  margin-left: 0.08em;
  font-size: 0.9em;
  font-weight: 750;
  text-decoration: none;
}
.tunelito-markdown [data-footnotes] {
  margin-top: var(--tl-section-rhythm);
  border-top: 1px solid var(--tl-border);
  padding-top: var(--tl-paragraph-rhythm);
  color: var(--tl-muted);
  font-size: 0.9rem;
}
.tunelito-markdown [data-footnotes] ol {
  margin-bottom: 0;
  padding-left: 1.5rem;
}
.tunelito-markdown [data-footnotes] li {
  scroll-margin-top: 24px;
  padding-left: 0.25rem;
}
.tunelito-markdown [data-footnotes] li:last-child > :last-child {
  margin-bottom: 0;
}
.tunelito-markdown [data-footnote-backref] {
  display: inline-block;
  margin-inline-start: 0.22em;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
.tunelito-markdown [data-footnote-ref]:target,
.tunelito-markdown [data-footnotes] li:target {
  border-radius: 3px;
  outline: 3px solid var(--tl-focus-ring);
  outline-offset: 3px;
}
.tunelito-footnotes-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.tunelito-markdown table {
  width: 100%;
  border-collapse: collapse;
}
.tunelito-markdown th,
.tunelito-markdown td {
  border: 1px solid var(--tl-border);
  padding: 0.5rem 0.65rem;
  text-align: left;
}
.tunelito-markdown th {
  background: var(--tl-soft);
  font-family: var(--tl-font-display);
}
.tunelito-markdown img {
  max-width: 100%;
  height: auto;
}
.tunelito-markdown strong {
  color: var(--tl-strong);
}
.tunelito-markdown em,
.tunelito-markdown figcaption {
  color: var(--tl-emphasis);
}
.tunelito-markdown li::marker {
  color: var(--tl-list-marker);
}
.tunelito-markdown figcaption {
  font-size: 0.88rem;
}
.tunelito-markdown hr {
  border: 0;
  border-top: 1px solid var(--tl-border);
}
.tunelito-markdown :focus-visible {
  outline: 3px solid var(--tl-focus-ring);
  outline-offset: 3px;
}
`;

function createMarkdownParser() {
  let hasMermaid = false;
  const defaultRenderer = new Renderer();
  const parser = new Marked(markedFootnote({
    headingClass: "tunelito-footnotes-label",
    backRefLabel: "Back to footnote reference",
  }), {
    gfm: true,
    extensions: [
      {
        name: "escaped-inline-html",
        level: "inline",
        start(source) {
          return source.indexOf("<");
        },
        tokenizer(source) {
          const match = /^<([A-Za-z][A-Za-z0-9-]*)\b[^<>]*>[\s\S]*?<\/\1\s*>/i.exec(source);
          if (!match) return undefined;
          return { type: "escaped-inline-html", raw: match[0] };
        },
        renderer(token) {
          return renderSafeMarkdownHtml(token.raw);
        },
      },
      {
        name: "obsidian-embed",
        level: "inline",
        start(source) {
          return source.indexOf("![[");
        },
        tokenizer(source) {
          const match = /^!\[\[([^\]\n]*)\]\]/.exec(source);
          if (!match) return undefined;
          return { type: "obsidian-embed", raw: match[0] };
        },
        renderer(token) {
          return escapeHtml(token.raw);
        },
      },
      {
        name: "wikilink",
        level: "inline",
        start(source) {
          return source.indexOf("[[");
        },
        tokenizer(source) {
          const match = /^\[\[([^\]\n]+)\]\]/.exec(source);
          if (!match) return undefined;
          const parsed = parseWikiLink(match[1]);
          if (!parsed) return undefined;
          return { type: "wikilink", raw: match[0], ...parsed };
        },
        renderer(token) {
          const normalizedTarget = token.target && token.heading ? `${token.target}#${token.heading}` : token.target || `#${token.heading}`;
          const targetAttribute = ` data-tunelito-wikilink="${escapeAttribute(normalizedTarget)}"`;
          const headingAttribute = token.heading ? ` data-tunelito-wikilink-heading="${escapeAttribute(token.heading)}"` : "";
          return `<span class="tunelito-wikilink"${targetAttribute}${headingAttribute}>${escapeHtml(token.label)}</span>`;
        },
      },
    ],
    renderer: {
      html(token) {
        const raw = token?.raw || token?.text || "";
        return renderSafeMarkdownHtml(raw);
      },
      link(token) {
        const href = safeHref(token?.href, { media: false });
        const text = this.parser.parseInline(token?.tokens || []);
        if (!href) return text;
        const title = token?.title ? ` title="${escapeAttribute(token.title)}"` : "";
        return `<a href="${escapeAttribute(href)}"${title}>${text}</a>`;
      },
      image(token) {
        const src = safeHref(token?.href, { media: true });
        const alt = escapeAttribute(token?.text || "");
        if (!src) return alt;
        const title = token?.title ? ` title="${escapeAttribute(token.title)}"` : "";
        return `<img src="${escapeAttribute(src)}" alt="${alt}"${title}>`;
      },
      code(token) {
        if (String(token?.lang || "").trim().toLowerCase() !== "mermaid") {
          return defaultRenderer.code.call(this, token);
        }
        hasMermaid = true;
        return renderMermaidFigure(token?.text || "");
      },
    },
  });
  return { parser, hasMermaid: () => hasMermaid };
}

function renderSafeMarkdownHtml(value) {
  const source = String(value || "");
  const tokens = /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/g;
  const parts = [];
  let offset = 0;
  let match;
  while ((match = tokens.exec(source))) {
    parts.push(escapeHtml(source.slice(offset, match.index)));
    if (!match[0].startsWith("<!--")) {
      parts.push(renderAllowedMarkdownTag(match[0]) ?? escapeHtml(match[0]));
    }
    offset = match.index + match[0].length;
  }
  parts.push(escapeHtml(source.slice(offset)));
  return parts.join("");
}

function renderAllowedMarkdownTag(value) {
  const match = /^<\s*(\/?)\s*(details|summary)\b([\s\S]*?)>$/i.exec(value);
  if (!match) return null;
  const [, closing, rawName, rawAttributes] = match;
  const name = rawName.toLowerCase();
  const attributes = rawAttributes.trim();
  if (closing) return attributes ? null : `</${name}>`;
  if (/\/\s*$/.test(attributes)) return null;
  if (name === "summary") return "<summary>";
  return `<details${hasOpenAttribute(attributes) ? " open" : ""}>`;
}

function hasOpenAttribute(value) {
  let offset = 0;
  let foundOpen = false;
  while (offset < value.length) {
    while (/\s/.test(value[offset] || "")) offset += 1;
    if (offset >= value.length) break;
    const name = /^[^\s"'<>/=]+/.exec(value.slice(offset))?.[0];
    if (!name) return false;
    offset += name.length;
    while (/\s/.test(value[offset] || "")) offset += 1;
    if (value[offset] === "=") {
      offset += 1;
      while (/\s/.test(value[offset] || "")) offset += 1;
      const quote = value[offset] === '"' || value[offset] === "'" ? value[offset] : "";
      if (quote) {
        const end = value.indexOf(quote, offset + 1);
        if (end < 0) return false;
        offset = end + 1;
      } else {
        const attributeValue = /^[^\s"'=<>`]+/.exec(value.slice(offset))?.[0];
        if (!attributeValue) return false;
        offset += attributeValue.length;
      }
    }
    if (name.toLowerCase() === "open") foundOpen = true;
  }
  return foundOpen;
}

export function isMarkdownPath(pathname) {
  return /\.md$/i.test(String(pathname || ""));
}

const REVIEW_BADGES = {
  todo: "pending",
  in_progress: "active",
  blocked: "danger",
  done: "done",
  resolved: "done",
  high: "warning",
  critical: "danger",
  medium: "pending",
  low: "muted",
};

function stampExplicitAnchors(html) {
  return String(html || "").replace(/<(h[1-6]|li|p)(\s[^>]*)?>((?:(?!<\1\b)[\s\S])*?)\{#([A-Za-z][\w:-]*)\}<\/\1>/g, (_, tag, attrs = "", inner, id) => {
    const body = inner.replace(/\s+$/, "");
    if (/\sid\s*=/i.test(attrs)) return `<${tag}${attrs}>${body}</${tag}>`;
    return `<${tag}${attrs} id="${escapeAttribute(id)}">${body}</${tag}>`;
  });
}

function stampReviewTokens(html) {
  return String(html || "").split(/(<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>)/gi).map((part) => {
    if (/^<(pre|code)\b/i.test(part)) return part;
    return part.split(/(<[^>]+>)/g).map((slice) => slice.startsWith("<") ? slice : replaceReviewTokens(slice)).join("");
  }).join("");
}

function replaceReviewTokens(text) {
  return text.replace(/\{([A-Za-z][\w-]*)\}/g, (match, token) => {
    const tone = REVIEW_BADGES[token.toLowerCase()];
    if (!tone) return match;
    return `<span class="tunelito-badge" data-tone="${tone}">${escapeHtml(token.replace(/_/g, " "))}</span>`;
  });
}

export function renderMarkdownDocument({
  markdownSource,
  sourceName = "Markdown page",
  cssHref = "",
  cssText = "",
  themeName = DEFAULT_THEME_NAME,
  navigation = null,
  editable = false,
  sectionIndex = false,
} = {}) {
  const title = String(sourceName || "Markdown page");
  const theme = normalizeThemeName(themeName);
  const frontMatter = extractFrontMatter(markdownSource);
  const markdown = createMarkdownParser();
  const body = stampReviewTokens(stampExplicitAnchors(markdown.parser.parse(frontMatter.body)));
  const customCssHref = normalizeMarkdownCssHref(cssHref, { throwOnUnsafe: false });
  const customCss = customCssHref ? `  <link rel="stylesheet" href="${escapeAttribute(customCssHref)}">\n` : "";
  const configCss = String(cssText || "").trim()
    ? `  <style data-tunelito-config-css>\n${escapeStyleText(cssText).trim()}\n  </style>`
    : "";
  const sidebar = renderSidebar(frontMatter, navigation);
  const bodyClassNames = [];
  if (frontMatter.kind !== "none") bodyClassNames.push("tunelito-has-properties");
  if (sidebar) bodyClassNames.push("tunelito-has-sidebar", "tunelito-properties-open");
  const bodyClasses = bodyClassNames.length ? ` class="${bodyClassNames.join(" ")}"` : "";
  const mermaidScripts = markdown.hasMermaid()
    ? [
        `  <script src="${MERMAID_LIBRARY_ROUTE}" defer></script>`,
        `  <script src="${MERMAID_CLIENT_ROUTE}" defer></script>`,
      ]
    : [];

  return [
    "<!doctype html>",
    `<html lang="en" data-tunelito-theme="${escapeAttribute(theme)}"${editable ? ' data-tunelito-editable="true"' : ""}${sectionIndex ? ' data-tunelito-section-index="true"' : ""}>`,
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    DEFAULT_MARKDOWN_CSS.trim(),
    "  </style>",
    `  <style data-tunelito-theme-css="${escapeAttribute(theme)}">`,
    themeCss(theme),
    "  </style>",
    configCss,
    customCss.trimEnd(),
    ...mermaidScripts,
    `  <script src="${MARKDOWN_CLIENT_ROUTE}" defer></script>`,
    "</head>",
    `<body${bodyClasses}>`,
    '  <div class="tunelito-page-frame">',
    sidebar,
    `    <main class="tunelito-markdown" data-tunelito-source-type="markdown" data-tunelito-comment-surface>\n${body.trimEnd()}\n    </main>`,
    '    <nav class="tunelito-document-map" aria-label="Document map" data-tunelito-document-map data-tunelito-comment-ignore></nav>',
    "  </div>",
    "</body>",
    "</html>",
  ].filter((line) => line !== "").join("\n");
}

export function renderFolderLandingDocument({
  folderName = "Folder",
  pagePath = "/",
  entries = [],
  parentHref = "",
  cssHref = "",
  cssText = "",
  themeName = DEFAULT_THEME_NAME,
} = {}) {
  const theme = normalizeThemeName(themeName);
  const customCssHref = normalizeMarkdownCssHref(cssHref, { throwOnUnsafe: false });
  const customCss = customCssHref ? `  <link rel="stylesheet" href="${escapeAttribute(customCssHref)}">\n` : "";
  const configCss = String(cssText || "").trim()
    ? `  <style data-tunelito-config-css>\n${escapeStyleText(cssText).trim()}\n  </style>`
    : "";
  const cards = entries.map((entry) => {
    const kind = entry.type === "directory" ? "Folder" : entry.extension === ".md" ? "Markdown" : "HTML";
    const icon = entry.type === "directory" ? "↳" : "•";
    return [
      '        <li class="tunelito-folder-entry">',
      `          <a class="tunelito-folder-card tunelito-folder-card-${escapeAttribute(entry.type)}" href="${escapeAttribute(entry.href)}">`,
      `            <span class="tunelito-folder-card-icon" aria-hidden="true">${icon}</span>`,
      '            <span class="tunelito-folder-card-copy">',
      `              <strong>${escapeHtml(entry.name)}</strong>`,
      `              <span>${kind}</span>`,
      "            </span>",
      "          </a>",
      "        </li>",
    ].join("\n");
  });
  const contents = cards.length
    ? `<ul class="tunelito-folder-grid">\n${cards.join("\n")}\n      </ul>`
    : '<div class="tunelito-folder-empty"><h2>This folder is empty</h2><p>No served Markdown, HTML, or child folders are available here yet.</p></div>';
  const parent = parentHref
    ? `      <a class="tunelito-folder-parent" href="${escapeAttribute(parentHref)}">← Parent folder</a>`
    : "";

  return [
    "<!doctype html>",
    `<html lang="en" data-tunelito-theme="${escapeAttribute(theme)}">`,
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(folderName)} · Tunelito folder</title>`,
    "  <style>",
    DEFAULT_MARKDOWN_CSS.trim(),
    `
.tunelito-folder-landing {
  max-width: min(980px, calc(100% - 32px));
}
.tunelito-folder-hero {
  margin-bottom: 32px;
  border-bottom: 1px solid var(--tl-border);
  padding-bottom: 24px;
}
.tunelito-folder-eyebrow {
  margin: 0 0 8px;
  color: var(--tl-accent);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.tunelito-folder-path {
  margin: 10px 0 0;
  color: var(--tl-muted);
  font: 0.8rem/1.5 var(--tl-font-mono);
  overflow-wrap: anywhere;
}
.tunelito-folder-parent {
  display: inline-flex;
  margin-bottom: 20px;
  border-radius: 6px;
  color: var(--tl-accent);
  font-weight: 700;
  text-underline-offset: 0.16em;
}
.tunelito-folder-parent:focus-visible,
.tunelito-folder-card:focus-visible {
  outline: 3px solid var(--tl-selection);
  outline-offset: 3px;
}
.tunelito-folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tunelito-folder-card {
  display: flex;
  min-height: 78px;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--tl-border);
  border-radius: 10px;
  background: var(--tl-soft);
  color: var(--tl-text);
  padding: 14px;
  text-decoration: none;
}
.tunelito-folder-card-directory {
  border-style: dashed;
  background: var(--tl-properties-bg);
}
.tunelito-folder-card:hover {
  border-color: var(--tl-accent);
  color: var(--tl-accent-strong);
}
.tunelito-folder-card-icon {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
  background: var(--tl-paper-bg);
  color: var(--tl-accent);
  font-size: 1.2rem;
}
.tunelito-folder-card-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.tunelito-folder-card-copy strong {
  overflow-wrap: anywhere;
}
.tunelito-folder-card-copy span {
  color: var(--tl-muted);
  font-size: 0.75rem;
}
.tunelito-folder-empty {
  border: 1px dashed var(--tl-border);
  border-radius: 10px;
  background: var(--tl-soft);
  padding: 28px;
}
.tunelito-folder-empty h2 {
  margin-top: 0;
}
@media (max-width: 600px) {
  .tunelito-folder-landing {
    max-width: 100%;
  }
}`,
    "  </style>",
    `  <style data-tunelito-theme-css="${escapeAttribute(theme)}">`,
    themeCss(theme),
    "  </style>",
    configCss,
    customCss.trimEnd(),
    "</head>",
    "<body>",
    '  <main class="tunelito-markdown tunelito-folder-landing" data-tunelito-source-type="folder" data-tunelito-comment-surface>',
    parent,
    '    <header class="tunelito-folder-hero">',
    '      <p class="tunelito-folder-eyebrow">Tunelito-generated navigation</p>',
    `      <h1>${escapeHtml(folderName)}</h1>`,
    "      <p>This folder has no authored index, so Tunelito assembled this landing page from the documents it can safely serve.</p>",
    `      <p class="tunelito-folder-path">${escapeHtml(pagePath)}</p>`,
    "    </header>",
    `    <section aria-label="Folder contents">\n      ${contents}\n    </section>`,
    "  </main>",
    "</body>",
    "</html>",
  ].filter((line) => line !== "").join("\n");
}

function parseWikiLink(value) {
  const source = String(value || "");
  const pipeIndex = source.indexOf("|");
  const reference = (pipeIndex >= 0 ? source.slice(0, pipeIndex) : source).trim();
  const alias = pipeIndex >= 0 ? source.slice(pipeIndex + 1).trim() : "";
  if (!reference || (pipeIndex >= 0 && !alias) || reference.includes("[") || reference.includes("]")) return null;

  const hashIndex = reference.indexOf("#");
  const target = (hashIndex >= 0 ? reference.slice(0, hashIndex) : reference).trim();
  const heading = (hashIndex >= 0 ? reference.slice(hashIndex + 1) : "").trim();
  if (!target && !heading) return null;
  if (hashIndex >= 0 && !heading) return null;

  return {
    target,
    heading,
    alias,
    label: alias || (target && heading ? `${target} › ${heading}` : target || heading),
  };
}

function renderSidebar(frontMatter, navigation) {
  const hasProperties = frontMatter.kind !== "none";
  const hasNavigation = Array.isArray(navigation?.entries);
  if (!hasProperties && !hasNavigation) return "";
  const count = frontMatter.properties.length;
  const countLabel = frontMatter.kind === "error" ? "issue" : String(count);
  const propertyContent = frontMatter.kind === "error"
    ? renderPropertiesError(frontMatter)
    : `<dl class="tunelito-properties-list">\n${frontMatter.properties.map(renderProperty).join("\n")}\n      </dl>`;
  const navigationContent = hasNavigation ? renderNavigation(navigation.entries) : "";
  const tabLabel = hasNavigation && hasProperties
    ? "Review context"
    : hasNavigation ? "Served documents" : `Properties · ${countLabel}`;

  return [
    '    <button class="tunelito-properties-tab" type="button" aria-controls="tunelito-properties" aria-expanded="true" data-tunelito-comment-ignore hidden>',
    `      ${escapeHtml(tabLabel)}`,
    "    </button>",
    '    <aside class="tunelito-properties" id="tunelito-properties" aria-label="Tunelito document sidebar" data-tunelito-comment-ignore>',
    '      <header class="tunelito-properties-header">',
    "        <div>",
    '          <p class="tunelito-properties-kicker">Tunelito review</p>',
    '          <h2 class="tunelito-properties-title">Document sidebar</h2>',
    "        </div>",
    '        <button class="tunelito-properties-collapse" type="button" aria-controls="tunelito-properties" aria-expanded="true" aria-label="Collapse document sidebar">←</button>',
    "      </header>",
    navigationContent,
    hasProperties ? [
      '      <section class="tunelito-sidebar-section tunelito-properties-section" aria-labelledby="tunelito-properties-title">',
      '        <header class="tunelito-sidebar-section-header">',
      '          <p class="tunelito-properties-kicker">Source metadata</p>',
      `          <h3 class="tunelito-sidebar-section-title" id="tunelito-properties-title">Properties · ${escapeHtml(countLabel)}</h3>`,
      "        </header>",
      propertyContent,
      "      </section>",
    ].join("\n") : "",
    "    </aside>",
  ].filter(Boolean).join("\n");
}

function renderNavigation(entries) {
  const content = entries.length
    ? `<ul class="tunelito-navigation-list">\n${entries.map(renderNavigationEntry).join("\n")}\n        </ul>`
    : '<p class="tunelito-navigation-empty">No served documents are available.</p>';
  return [
    '      <nav class="tunelito-sidebar-section tunelito-navigation" aria-labelledby="tunelito-navigation-title">',
    '        <header class="tunelito-sidebar-section-header">',
    '          <p class="tunelito-properties-kicker">Tunelito navigation</p>',
    '          <h3 class="tunelito-sidebar-section-title" id="tunelito-navigation-title">Served documents</h3>',
    "        </header>",
    content,
    "      </nav>",
  ].join("\n");
}

function renderNavigationEntry(entry) {
  if (entry.type === "directory") {
    const children = entry.children.length
      ? `<ul class="tunelito-navigation-children">\n${entry.children.map(renderNavigationEntry).join("\n")}\n          </ul>`
      : '<p class="tunelito-navigation-empty">No served documents</p>';
    return [
      '          <li class="tunelito-navigation-item">',
      '            <details class="tunelito-navigation-folder">',
      `              <summary class="tunelito-navigation-summary"><span class="tunelito-navigation-label">${escapeHtml(entry.name)}</span></summary>`,
      `              <a class="tunelito-navigation-folder-link" href="${escapeAttribute(entry.href)}" aria-label="Open ${escapeAttribute(entry.name)} folder"><span class="tunelito-navigation-kind" aria-hidden="true">↳</span><span class="tunelito-navigation-label">Open folder</span></a>`,
      children,
      "            </details>",
      "          </li>",
    ].join("\n");
  }
  const current = entry.current
    ? ' aria-current="page"'
    : "";
  const currentLabel = entry.current
    ? '<span class="tunelito-navigation-current">Current</span>'
    : "";
  return [
    '          <li class="tunelito-navigation-item">',
    `            <a class="tunelito-navigation-link" href="${escapeAttribute(entry.href)}"${current}>`,
    '              <span class="tunelito-navigation-kind" aria-hidden="true">•</span>',
    `              <span class="tunelito-navigation-label">${escapeHtml(entry.name)}</span>`,
    currentLabel ? `              ${currentLabel}` : "",
    "            </a>",
    "          </li>",
  ].filter(Boolean).join("\n");
}

function renderProperty({ key, value }) {
  const display = propertyDisplay(value);
  let renderedValue;
  if (display.kind === "pills") {
    renderedValue = `<span class="tunelito-property-pills">${display.values.map((item) => `<span class="tunelito-property-pill">${escapeHtml(item)}</span>`).join("")}</span>`;
  } else if (display.kind === "complex") {
    renderedValue = `<pre class="tunelito-property-complex">${escapeHtml(display.text)}</pre>`;
  } else {
    renderedValue = escapeHtml(display.text);
  }
  return `        <div class="tunelito-property"><dt>${escapeHtml(key)}</dt><dd>${renderedValue}</dd></div>`;
}

function renderPropertiesError(frontMatter) {
  return [
    '      <div class="tunelito-properties-error" role="status">',
    `        <p><strong>Metadata needs attention.</strong> ${escapeHtml(frontMatter.error)}</p>`,
    "        <details>",
    "          <summary>View front matter source</summary>",
    `          <pre>${escapeHtml(frontMatter.originalSource)}</pre>`,
    "        </details>",
    "      </div>",
  ].join("\n");
}

function renderMermaidFigure(source) {
  const escapedSource = escapeHtml(source);
  return [
    '<figure class="tunelito-mermaid" data-tunelito-mermaid data-mermaid-state="source">',
    '  <div class="tunelito-mermaid-canvas" aria-hidden="true"></div>',
    '  <figcaption class="tunelito-mermaid-status">Mermaid diagram source. Diagram rendering requires JavaScript.</figcaption>',
    "  <details open>",
    "    <summary>View Mermaid source</summary>",
    `    <pre><code class="language-mermaid">${escapedSource}\n</code></pre>`,
    "  </details>",
    "</figure>",
  ].join("\n");
}

export function normalizeMarkdownCssHref(value, { throwOnUnsafe = true } = {}) {
  const href = String(value || "").replace(/\u0000/g, "").trim().slice(0, 2000);
  if (!href) return "";
  if (isSafeHref(href, { media: false, allowMailto: false })) return href;
  if (!throwOnUnsafe) return "";
  throw new Error("--markdown-css must be a relative path, root-relative path, http URL, or https URL");
}

function safeHref(value, { media }) {
  const href = String(value || "").replace(/\u0000/g, "").trim();
  return isSafeHref(href, { media, allowMailto: !media }) ? href : "";
}

function isSafeHref(href, { media, allowMailto }) {
  if (!href) return false;
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) return true;
  if (/^[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:[/?#]|$)/.test(href) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)) return true;
  try {
    const protocol = new URL(href).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" || (allowMailto && protocol === "mailto:");
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeStyleText(value) {
  return String(value).replace(/<\/style/gi, "<\\/style");
}
