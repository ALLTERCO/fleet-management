// CSS strings inlined into api.html. Two sources: SHELLY_CUSTOM_CSS is fed
// to Scalar via configuration.customCss; PAGE_CSS is the outer-page chrome.

export const SHELLY_CUSTOM_CSS = String.raw`
:root {
  --scalar-font: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --scalar-font-code: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  --scalar-radius: 8px;
  --scalar-radius-lg: 12px;
  --scalar-radius-xl: 16px;
  --scalar-border-width: 1px;
  --scalar-sidebar-padding: 18px 14px;
}
.light-mode {
  --scalar-color-1: #0F1B2D;
  --scalar-color-2: #2A3A52;
  --scalar-color-3: #6B7A91;
  --scalar-color-accent: #003C82;
  --scalar-background-1: #FFFFFF;
  --scalar-background-2: #F8FAFD;
  --scalar-background-3: #EEF3FA;
  --scalar-background-accent: #E6F0FB;
  --scalar-background-card: #FFFFFF;
  --scalar-border-color: #E3E9F2;
  --scalar-link-color: #003C82;
  --scalar-link-color-hover: #4495D1;
  --scalar-link-font-weight: 500;
  --scalar-sidebar-background-1: linear-gradient(180deg, #F5F9FE 0%, #ECF2FB 100%);
  --scalar-sidebar-color-1: #122A4F;
  --scalar-sidebar-color-2: #4F5F77;
  --scalar-sidebar-color-active: #003C82;
  --scalar-sidebar-border-color: #DCE5F0;
  --scalar-sidebar-item-hover-background: rgba(68,149,209,0.10);
  --scalar-sidebar-item-active-background: linear-gradient(90deg, rgba(68,149,209,0.18) 0%, rgba(68,149,209,0.04) 100%);
  --scalar-sidebar-search-background: #FFFFFF;
  --scalar-sidebar-search-border-color: #DCE5F0;
  --scalar-button-1-color: #FFFFFF;
  --scalar-color-green: #15803D;
  --scalar-color-red: #C8333A;
  --scalar-color-yellow: #B45309;
  --scalar-color-blue: #003C82;
}
.dark-mode {
  --scalar-color-1: #F0F4FA;
  --scalar-color-2: #C9D2DE;
  --scalar-color-3: #95A2B5;
  --scalar-color-accent: #6FB4DD;
  --scalar-background-1: #0A1426;
  --scalar-background-2: #0E1A30;
  --scalar-background-3: #142442;
  --scalar-background-accent: #1A3563;
  --scalar-background-card: #0E1A30;
  --scalar-border-color: rgba(255,255,255,0.08);
  --scalar-link-color: #6FB4DD;
  --scalar-link-color-hover: #AAE1FA;
  --scalar-sidebar-background-1: linear-gradient(180deg, #0E1A30 0%, #0A1426 100%);
  --scalar-sidebar-color-1: #E6EDF6;
  --scalar-sidebar-color-2: #95A2B5;
  --scalar-sidebar-color-active: #6FB4DD;
  --scalar-sidebar-border-color: rgba(255,255,255,0.06);
  --scalar-sidebar-item-hover-background: rgba(68,149,209,0.14);
  --scalar-sidebar-item-active-background: linear-gradient(90deg, rgba(68,149,209,0.25) 0%, rgba(68,149,209,0.06) 100%);
  --scalar-sidebar-search-background: rgba(255,255,255,0.04);
  --scalar-sidebar-search-border-color: rgba(255,255,255,0.10);
}
body, html, .scalar-app { font-family: var(--scalar-font); -webkit-font-smoothing: antialiased; }
.scalar-api-reference, .scalar-app {
  letter-spacing: -0.005em;
  font-feature-settings: 'cv02','cv03','cv04','cv11';
}
section[id^="tag/"] > div, section[id^="operation/"] {
  border-radius: var(--scalar-radius-lg) !important;
}
section[id^="operation/"] { transition: box-shadow 180ms ease; }
section[id^="operation/"]:hover {
  box-shadow: 0 1px 3px rgba(15,27,45,0.04), 0 4px 16px rgba(15,27,45,0.06);
}
.dark-mode section[id^="operation/"]:hover {
  box-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.4);
}
[class*="extension"], dl.scalar-extensions {
  background: var(--scalar-background-3);
  border-radius: var(--scalar-radius);
  padding: 12px 16px;
  border-left: 3px solid var(--scalar-color-accent);
}
.method, [class*="HttpMethod"], [class*="http-method"] {
  border-radius: 6px !important;
  font-weight: 700 !important;
  font-size: 11px !important;
  letter-spacing: 0.02em !important;
  text-transform: uppercase !important;
}
pre, .scalar-code-block, [class*="code-block"] {
  border-radius: var(--scalar-radius) !important;
  font-family: var(--scalar-font-code) !important;
  font-size: 12.5px !important;
  line-height: 1.6 !important;
}
`;

export const PAGE_CSS = String.raw`
:root {
  --fm-blue: #4495D1;
  --fm-blue-2: #003C82;
  --fm-navy: #122A4F;
  --fm-ink: #0F1B2D;
  --fm-text: #1F2937;
  --fm-muted: #5B6B82;
  --fm-line: #E5EAF1;
  --fm-bg: #FFFFFF;
  --fm-bg-soft: #F7FAFE;
  --fm-bg-deep: #0E1A30;
  --fm-radius: 12px;
  --fm-radius-lg: 18px;
  --fm-font: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --fm-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
}
html.fm-dark {
  --fm-ink: #F0F4FA;
  --fm-text: #C9D2DE;
  --fm-muted: #95A2B5;
  --fm-line: rgba(255,255,255,0.08);
  --fm-bg: #0A1426;
  --fm-bg-soft: #0E1A30;
  --fm-bg-deep: #060D1A;
}
html, body { margin: 0; padding: 0; background: var(--fm-bg); color: var(--fm-text); font-family: var(--fm-font); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
* { box-sizing: border-box; }
a { color: inherit; text-decoration: none; }
.fm-page { display: flex; flex-direction: column; min-height: 100vh; }

/* ---- Top brand bar ------------------------------------------------------ */
.fm-topbar { position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,0.85); backdrop-filter: saturate(180%) blur(14px); border-bottom: 1px solid var(--fm-line); }
html.fm-dark .fm-topbar { background: rgba(10,20,38,0.78); }
.fm-topbar-inner { max-width: 1280px; margin: 0 auto; padding: 0 28px; height: 60px; display: flex; align-items: center; gap: 28px; }
.fm-logo { display: flex; align-items: baseline; gap: 8px; font-weight: 700; font-size: 16px; color: var(--fm-ink); letter-spacing: -0.015em; }
.fm-logo .fm-logo-mark { width: 22px; height: 22px; align-self: center; }
.fm-logo .fm-logo-accent { background: linear-gradient(135deg, #4495D1 0%, #003C82 100%); -webkit-background-clip: text; background-clip: text; color: transparent; font-weight: 800; }
.fm-nav { display: flex; gap: 22px; margin-left: 16px; }
.fm-nav a { font-size: 14px; font-weight: 500; color: var(--fm-muted); transition: color 160ms ease; }
.fm-nav a:hover { color: var(--fm-ink); }
.fm-topbar-spacer { flex: 1; }
.fm-actions { display: flex; align-items: center; gap: 14px; }
.fm-version-pill { padding: 4px 10px; font-size: 11.5px; font-weight: 600; color: var(--fm-blue-2); background: rgba(68,149,209,0.10); border: 1px solid rgba(68,149,209,0.18); border-radius: 999px; letter-spacing: 0.02em; }
.fm-theme-toggle { background: transparent; border: 1px solid var(--fm-line); color: var(--fm-ink); border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; transition: background 140ms, border-color 140ms; }
.fm-theme-toggle:hover { background: var(--fm-bg-soft); border-color: rgba(68,149,209,0.30); }

/* ---- Hero --------------------------------------------------------------- */
.fm-hero { position: relative; padding: 90px 28px 100px; overflow: hidden; }
.fm-hero-bg { position: absolute; inset: 0; background:
    radial-gradient(circle at 12% 24%, rgba(68,149,209,0.20) 0%, rgba(68,149,209,0) 55%),
    radial-gradient(circle at 88% 80%, rgba(0,60,130,0.18) 0%, rgba(0,60,130,0) 55%),
    radial-gradient(circle at 50% 10%, rgba(170,225,250,0.16) 0%, rgba(170,225,250,0) 50%);
  pointer-events: none; z-index: 0;
}
html.fm-dark .fm-hero-bg { background:
    radial-gradient(circle at 12% 24%, rgba(68,149,209,0.18) 0%, rgba(68,149,209,0) 55%),
    radial-gradient(circle at 88% 80%, rgba(0,60,130,0.22) 0%, rgba(0,60,130,0) 55%),
    radial-gradient(circle at 50% 10%, rgba(68,149,209,0.10) 0%, rgba(68,149,209,0) 50%);
}
.fm-hero-grid { position: absolute; inset: 0; background-image:
    linear-gradient(rgba(15,27,45,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15,27,45,0.04) 1px, transparent 1px);
  background-size: 56px 56px; mask-image: radial-gradient(ellipse at 50% 40%, black 0%, transparent 70%);
  pointer-events: none; z-index: 0;
}
html.fm-dark .fm-hero-grid { background-image:
    linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
}
.fm-hero-inner { position: relative; max-width: 1080px; margin: 0 auto; z-index: 1; }
.fm-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: var(--fm-blue-2); background: rgba(68,149,209,0.10); border: 1px solid rgba(68,149,209,0.20); border-radius: 999px; letter-spacing: 0.04em; text-transform: uppercase; }
html.fm-dark .fm-eyebrow { color: #AAE1FA; background: rgba(68,149,209,0.14); border-color: rgba(68,149,209,0.28); }
.fm-eyebrow .fm-pulse { width: 6px; height: 6px; border-radius: 50%; background: #15803D; box-shadow: 0 0 0 0 rgba(21,128,61,0.6); animation: fm-pulse 1800ms ease-out infinite; }
@keyframes fm-pulse { 70% { box-shadow: 0 0 0 8px rgba(21,128,61,0); } 100% { box-shadow: 0 0 0 0 rgba(21,128,61,0); } }
.fm-hero-title { font-size: clamp(40px, 6.4vw, 64px); line-height: 1.04; letter-spacing: -0.03em; font-weight: 700; color: var(--fm-ink); margin: 22px 0 16px; }
.fm-hero-title .fm-hero-accent { background: linear-gradient(120deg, #4495D1 0%, #003C82 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.fm-hero-sub { font-size: 18px; line-height: 1.55; color: var(--fm-muted); max-width: 680px; margin: 0 0 36px; }
.fm-cta-row { display: flex; gap: 12px; flex-wrap: wrap; }
.fm-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; font-size: 14.5px; font-weight: 600; border-radius: 10px; transition: transform 140ms ease, box-shadow 200ms ease, background 140ms ease; cursor: pointer; border: 1px solid transparent; letter-spacing: -0.005em; }
.fm-btn-primary { color: #FFFFFF; background: linear-gradient(135deg, #4495D1 0%, #003C82 100%); box-shadow: 0 1px 2px rgba(0,60,130,0.10), 0 6px 24px rgba(68,149,209,0.35); }
.fm-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,60,130,0.15), 0 10px 28px rgba(68,149,209,0.45); }
.fm-btn-ghost { color: var(--fm-ink); background: transparent; border-color: var(--fm-line); }
.fm-btn-ghost:hover { background: var(--fm-bg-soft); border-color: rgba(68,149,209,0.30); }
.fm-btn svg { width: 16px; height: 16px; }

/* ---- Stats -------------------------------------------------------------- */
.fm-stats { max-width: 1080px; margin: -40px auto 0; padding: 0 28px; position: relative; z-index: 2; }
.fm-stats-card { background: var(--fm-bg); border: 1px solid var(--fm-line); border-radius: var(--fm-radius-lg); display: grid; grid-template-columns: repeat(4, 1fr); box-shadow: 0 1px 2px rgba(15,27,45,0.04), 0 12px 40px rgba(15,27,45,0.06); overflow: hidden; }
html.fm-dark .fm-stats-card { background: var(--fm-bg-soft); box-shadow: 0 2px 6px rgba(0,0,0,0.4), 0 16px 48px rgba(0,0,0,0.35); }
.fm-stat { padding: 24px 24px; text-align: left; border-right: 1px solid var(--fm-line); }
.fm-stat:last-child { border-right: none; }
.fm-stat-val { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-ink); line-height: 1; }
.fm-stat-val .fm-stat-accent { background: linear-gradient(120deg, #4495D1 0%, #003C82 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.fm-stat-label { margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--fm-muted); letter-spacing: 0.06em; text-transform: uppercase; }
@media (max-width: 760px) {
  .fm-stats-card { grid-template-columns: repeat(2, 1fr); }
  .fm-stat:nth-child(2) { border-right: none; } .fm-stat:nth-child(1), .fm-stat:nth-child(2) { border-bottom: 1px solid var(--fm-line); }
}

/* ---- Section heading ---------------------------------------------------- */
.fm-section { padding: 90px 28px 30px; max-width: 1080px; margin: 0 auto; }
.fm-section-title { font-size: 30px; line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-ink); margin: 0 0 10px; }
.fm-section-sub { font-size: 16px; color: var(--fm-muted); margin: 0; max-width: 640px; }

/* ---- Namespace cards ---------------------------------------------------- */
.fm-ns-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 36px; }
@media (max-width: 1000px) { .fm-ns-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .fm-ns-grid { grid-template-columns: 1fr; } }
.fm-ns-card { padding: 22px 22px 22px; background: var(--fm-bg); border: 1px solid var(--fm-line); border-radius: var(--fm-radius); transition: border-color 160ms ease, transform 160ms ease, box-shadow 200ms ease; display: flex; flex-direction: column; gap: 12px; }
html.fm-dark .fm-ns-card { background: var(--fm-bg-soft); }
.fm-ns-card:hover { transform: translateY(-2px); border-color: rgba(68,149,209,0.30); box-shadow: 0 4px 20px rgba(68,149,209,0.10); }
.fm-ns-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(68,149,209,0.15) 0%, rgba(0,60,130,0.10) 100%); color: var(--fm-blue-2); }
html.fm-dark .fm-ns-icon { color: #AAE1FA; background: linear-gradient(135deg, rgba(68,149,209,0.20) 0%, rgba(0,60,130,0.16) 100%); }
.fm-ns-icon svg { width: 22px; height: 22px; }
.fm-ns-name { font-weight: 700; font-size: 15px; color: var(--fm-ink); letter-spacing: -0.01em; }
.fm-ns-desc { font-size: 13.5px; color: var(--fm-muted); line-height: 1.5; }
.fm-ns-meta { margin-top: auto; padding-top: 12px; font-size: 12px; color: var(--fm-muted); font-weight: 500; display: flex; align-items: center; gap: 6px; }

/* ---- Browse by category ------------------------------------------------- */
.fm-cat-section { padding: 70px 28px 30px; max-width: 1280px; margin: 0 auto; }
.fm-cat-section-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-bottom: 30px; }
.fm-cat-section-head h2 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-ink); margin: 0 0 6px; }
.fm-cat-section-head p { font-size: 14px; color: var(--fm-muted); margin: 0; max-width: 640px; }
.fm-cat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (max-width: 880px) { .fm-cat-grid { grid-template-columns: 1fr; } }
.fm-cat-card { background: var(--fm-bg); border: 1px solid var(--fm-line); border-radius: var(--fm-radius-lg); padding: 22px; transition: border-color 160ms ease, box-shadow 200ms ease; display: flex; flex-direction: column; gap: 18px; }
html.fm-dark .fm-cat-card { background: var(--fm-bg-soft); }
.fm-cat-card:hover { border-color: rgba(68,149,209,0.30); box-shadow: 0 4px 22px rgba(68,149,209,0.08); }
.fm-cat-head { display: grid; grid-template-columns: 44px 1fr auto; gap: 14px; align-items: flex-start; }
.fm-cat-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(68,149,209,0.15) 0%, rgba(0,60,130,0.10) 100%); color: var(--fm-blue-2); }
html.fm-dark .fm-cat-icon { color: #AAE1FA; background: linear-gradient(135deg, rgba(68,149,209,0.20) 0%, rgba(0,60,130,0.16) 100%); }
.fm-cat-icon svg { width: 24px; height: 24px; }
.fm-cat-titles { min-width: 0; }
.fm-cat-label { margin: 0 0 4px; font-size: 16px; font-weight: 700; letter-spacing: -0.015em; color: var(--fm-ink); }
.fm-cat-blurb { margin: 0; font-size: 13.5px; color: var(--fm-muted); line-height: 1.5; }
.fm-cat-meta { text-align: right; padding-top: 4px; }
.fm-cat-meta-num { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-blue-2); line-height: 1; }
html.fm-dark .fm-cat-meta-num { color: #AAE1FA; }
.fm-cat-meta-lbl { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fm-muted); margin-top: 2px; }
.fm-cat-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 14px; border-top: 1px solid var(--fm-line); }
.fm-cat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; font-size: 12.5px; background: var(--fm-bg-soft); color: var(--fm-text); border: 1px solid var(--fm-line); border-radius: 999px; transition: background 140ms, border-color 140ms, transform 140ms; font-family: var(--fm-mono); }
.fm-cat-chip:hover { border-color: rgba(68,149,209,0.40); background: rgba(68,149,209,0.06); transform: translateY(-1px); }
.fm-cat-chip[hidden] { display: none; }
.fm-cat-chip-name { font-weight: 600; color: var(--fm-ink); }
.fm-cat-chip-count { font-variant-numeric: tabular-nums; font-size: 10.5px; font-weight: 700; padding: 1px 6px; background: rgba(68,149,209,0.12); color: var(--fm-blue-2); border-radius: 999px; }
html.fm-dark .fm-cat-chip-count { background: rgba(68,149,209,0.20); color: #AAE1FA; }
.fm-cat-card[hidden] { display: none; }

/* ---- Authentication / Transport / Resources panels --------------------- */
.fm-panel { padding: 70px 28px 30px; max-width: 1280px; margin: 0 auto; }
.fm-panel-head { margin-bottom: 28px; }
.fm-panel-eyebrow { font-size: 11.5px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--fm-blue-2); margin: 0 0 8px; }
html.fm-dark .fm-panel-eyebrow { color: #6FB4DD; }
.fm-panel-head h2 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-ink); margin: 0 0 8px; }
.fm-panel-head p { font-size: 15px; color: var(--fm-muted); margin: 0; max-width: 720px; line-height: 1.55; }
.fm-panel-split { display: grid; grid-template-columns: 1fr 1.2fr; gap: 36px; align-items: start; }
@media (max-width: 900px) { .fm-panel-split { grid-template-columns: 1fr; gap: 24px; } }
.fm-panel-body p { font-size: 14px; line-height: 1.65; color: var(--fm-text); margin: 0 0 14px; }
.fm-panel-body code { padding: 1px 6px; background: var(--fm-bg-soft); border: 1px solid var(--fm-line); border-radius: 5px; font-family: var(--fm-mono); font-size: 12.5px; color: var(--fm-ink); }
.fm-panel-body ul { margin: 10px 0 16px; padding-left: 20px; color: var(--fm-text); font-size: 14px; line-height: 1.6; }
.fm-panel-body ul li { margin-bottom: 6px; }
.fm-codeblock { background: #0A1426; color: #E6EDF6; border-radius: 12px; padding: 22px 24px; font-family: var(--fm-mono); font-size: 12.5px; line-height: 1.65; box-shadow: 0 4px 20px rgba(15,27,45,0.15), 0 12px 36px rgba(15,27,45,0.08); position: relative; overflow-x: auto; }
.fm-codeblock::before { content: ''; position: absolute; top: 14px; left: 16px; width: 10px; height: 10px; border-radius: 50%; background: #FF5F57; box-shadow: 16px 0 0 #FFBD2E, 32px 0 0 #28C840; }
.fm-codeblock pre { margin: 22px 0 0; white-space: pre; }
.fm-codeblock .fm-tok-key { color: #7CD2F2; }
.fm-codeblock .fm-tok-str { color: #ADE48E; }
.fm-codeblock .fm-tok-com { color: #6B7D99; font-style: italic; }
.fm-codeblock .fm-tok-num { color: #F2C97D; }
.fm-codeblock .fm-tok-kw { color: #C9A6F7; }
.fm-codeblock-label { display: inline-block; margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fm-muted); }
.fm-codeblock-stack { display: flex; flex-direction: column; gap: 20px; }
.fm-pill { display: inline-flex; align-items: center; padding: 3px 10px; font-size: 11px; font-weight: 600; border-radius: 999px; background: rgba(68,149,209,0.10); color: var(--fm-blue-2); border: 1px solid rgba(68,149,209,0.18); letter-spacing: 0.03em; }
html.fm-dark .fm-pill { background: rgba(68,149,209,0.16); color: #AAE1FA; border-color: rgba(68,149,209,0.30); }

/* ---- Resources grid ---------------------------------------------------- */
.fm-res-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; }
@media (max-width: 900px) { .fm-res-grid { grid-template-columns: 1fr; } }
.fm-res-card { padding: 22px; background: var(--fm-bg); border: 1px solid var(--fm-line); border-radius: var(--fm-radius); transition: border-color 160ms ease, transform 160ms ease, box-shadow 200ms ease; display: flex; flex-direction: column; gap: 10px; }
html.fm-dark .fm-res-card { background: var(--fm-bg-soft); }
.fm-res-card:hover { transform: translateY(-2px); border-color: rgba(68,149,209,0.30); box-shadow: 0 4px 20px rgba(68,149,209,0.08); }
.fm-res-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(68,149,209,0.15) 0%, rgba(0,60,130,0.10) 100%); color: var(--fm-blue-2); }
html.fm-dark .fm-res-icon { color: #AAE1FA; }
.fm-res-icon svg { width: 20px; height: 20px; }
.fm-res-title { font-weight: 700; font-size: 15px; color: var(--fm-ink); letter-spacing: -0.01em; margin-top: 4px; }
.fm-res-desc { font-size: 13.5px; color: var(--fm-muted); line-height: 1.5; }
.fm-res-link { margin-top: auto; padding-top: 8px; font-size: 13px; font-weight: 600; color: var(--fm-blue-2); display: inline-flex; align-items: center; gap: 4px; }
html.fm-dark .fm-res-link { color: #6FB4DD; }

/* ---- All-namespaces grid (chips + search) ------------------------------ */
.fm-ns-all { padding: 60px 28px 30px; max-width: 1080px; margin: 0 auto; }
.fm-ns-all-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-bottom: 22px; }
.fm-ns-all-header h2 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-ink); margin: 0 0 6px; }
.fm-ns-all-header p { font-size: 14px; color: var(--fm-muted); margin: 0; }
.fm-ns-search { position: relative; min-width: 240px; flex: 0 0 auto; }
.fm-ns-search input { width: 100%; padding: 9px 12px 9px 36px; font: inherit; font-size: 13.5px; background: var(--fm-bg); color: var(--fm-ink); border: 1px solid var(--fm-line); border-radius: 8px; outline: none; transition: border-color 140ms, box-shadow 140ms; }
.fm-ns-search input:focus { border-color: rgba(68,149,209,0.45); box-shadow: 0 0 0 3px rgba(68,149,209,0.18); }
.fm-ns-search svg { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--fm-muted); pointer-events: none; }
.fm-ns-chip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.fm-ns-chip { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 14px; font-size: 13.5px; background: var(--fm-bg); border: 1px solid var(--fm-line); border-radius: 8px; color: var(--fm-text); transition: border-color 140ms, transform 140ms, background 140ms; }
.fm-ns-chip:hover { border-color: rgba(68,149,209,0.40); background: var(--fm-bg-soft); transform: translateY(-1px); }
.fm-ns-chip-name { font-weight: 600; color: var(--fm-ink); letter-spacing: -0.005em; }
.fm-ns-chip-count { font-variant-numeric: tabular-nums; font-size: 11px; font-weight: 700; padding: 2px 7px; background: rgba(68,149,209,0.12); color: var(--fm-blue-2); border-radius: 999px; }
html.fm-dark .fm-ns-chip-count { background: rgba(68,149,209,0.20); color: #AAE1FA; }
.fm-ns-chip[hidden] { display: none; }
.fm-ns-empty { padding: 40px; text-align: center; color: var(--fm-muted); font-size: 14px; }

/* ---- Quickstart --------------------------------------------------------- */
.fm-quickstart { padding: 60px 28px; max-width: 1080px; margin: 0 auto; }
.fm-quickstart-inner { display: grid; grid-template-columns: 1fr 1.2fr; gap: 48px; align-items: center; }
@media (max-width: 900px) { .fm-quickstart-inner { grid-template-columns: 1fr; } }
.fm-qs-text h2 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-ink); margin: 0 0 12px; }
.fm-qs-text p { font-size: 15px; line-height: 1.6; color: var(--fm-muted); margin: 0 0 8px; }
.fm-qs-text code { padding: 2px 6px; background: var(--fm-bg-soft); border: 1px solid var(--fm-line); border-radius: 5px; font-family: var(--fm-mono); font-size: 12.5px; color: var(--fm-ink); }
.fm-qs-code { background: #0A1426; color: #E6EDF6; border-radius: 14px; padding: 22px 24px; font-family: var(--fm-mono); font-size: 13px; line-height: 1.65; box-shadow: 0 4px 20px rgba(15,27,45,0.18), 0 12px 36px rgba(15,27,45,0.10); position: relative; }
.fm-qs-code::before { content: ''; position: absolute; top: 14px; left: 16px; width: 12px; height: 12px; border-radius: 50%; background: #FF5F57; box-shadow: 18px 0 0 #FFBD2E, 36px 0 0 #28C840; }
.fm-qs-code pre { margin: 28px 0 0; white-space: pre; overflow-x: auto; }
.fm-qs-code .fm-tok-key { color: #7CD2F2; }
.fm-qs-code .fm-tok-str { color: #ADE48E; }
.fm-qs-code .fm-tok-com { color: #6B7D99; font-style: italic; }
.fm-qs-code .fm-tok-num { color: #F2C97D; }
.fm-qs-code .fm-tok-kw { color: #C9A6F7; }

/* ---- Reference section -------------------------------------------------- */
.fm-reference { margin-top: 30px; border-top: 1px solid var(--fm-line); }
.fm-reference-header { max-width: 1080px; margin: 0 auto; padding: 70px 28px 20px; }
.fm-reference-header h2 { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; color: var(--fm-ink); margin: 0 0 10px; }
.fm-reference-header p { font-size: 15px; color: var(--fm-muted); margin: 0; }
.fm-scalar-wrap { min-height: 100vh; }

/* ---- Footer ------------------------------------------------------------- */
.fm-footer { padding: 36px 28px; border-top: 1px solid var(--fm-line); margin-top: 60px; }
.fm-footer-inner { max-width: 1080px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 13px; color: var(--fm-muted); }
.fm-footer a { color: var(--fm-muted); border-bottom: 1px dotted var(--fm-line); padding-bottom: 1px; }
.fm-footer a:hover { color: var(--fm-blue); border-bottom-color: var(--fm-blue); }

/* ---- Loading splash ---------------------------------------------------- */
#fm-splash { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--fm-bg); z-index: 9999; transition: opacity 280ms ease-out; }
#fm-splash[hidden] { opacity: 0; pointer-events: none; }
.fm-splash-brand { font-weight: 700; font-size: 19px; color: var(--fm-ink); margin-bottom: 22px; letter-spacing: -0.01em; }
.fm-splash-brand span { background: linear-gradient(135deg, #4495D1 0%, #003C82 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.fm-splash-spinner { width: 30px; height: 30px; border: 2px solid var(--fm-line); border-top-color: #4495D1; border-radius: 50%; animation: fm-spin 720ms linear infinite; }
@keyframes fm-spin { to { transform: rotate(360deg); } }
.fm-splash-hint { margin-top: 16px; font-size: 13px; color: var(--fm-muted); }
`;
