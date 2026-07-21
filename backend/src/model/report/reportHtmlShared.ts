// Shared, print-friendly HTML report scaffolding. Both the energy and the
// environment report renderers build on this so the brand theme, section-table
// builder, KPI cards, and HTML escaping live in exactly one place (SSOT).
//
// A renderer supplies its own column map (which fields become table columns and
// which are right-aligned numerics) and its own KPI cards; everything else —
// the document shell, header, footer, section grouping, table markup, and the
// light print theme — is shared here.

export interface ReportHtmlMeta {
    readonly title: string;
    readonly subtitle: string;
    readonly generatedAt: string;
    readonly dataDownloadUrl?: string;
    readonly rowsShown?: number;
    readonly totalRows?: number;
}

// Column key -> header label. Order is the render order within a section table.
export type ReportColumn<T> = readonly [keyof T, string];

export interface HtmlSection<T> {
    readonly name: string;
    readonly rows: T[];
}

// Full standalone document: doctype -> head -> header -> KPIs -> sections ->
// footer. `kpis` and `sections` are pre-rendered HTML fragments (each may be '').
export function renderReportDocument(
    meta: ReportHtmlMeta,
    kpis: string,
    sections: string
): string {
    return `<!doctype html>
<html lang="en">
${buildHead(meta.title)}
<body>
<main class="rpt">
${buildHeader(meta)}
${kpis}
${sections}
${buildFooter(meta)}
</main>
</body>
</html>`;
}

// Keep sections in first-seen order; rows before any section header fall under
// a leading untitled group so nothing is dropped.
export function groupBySection<T extends {section?: unknown}>(
    rows: readonly T[]
): HtmlSection<T>[] {
    const out: HtmlSection<T>[] = [];
    let current: HtmlSection<T> | null = null;
    for (const r of rows) {
        const name = cell(r.section);
        if (name || !current) {
            current = {name, rows: []};
            out.push(current);
        }
        current.rows.push(r);
    }
    return out;
}

// One card per section: only the columns that section actually fills are drawn.
export function buildSectionTable<T>(
    section: HtmlSection<T>,
    columns: ReadonlyArray<ReportColumn<T>>,
    numeric: ReadonlySet<keyof T>
): string {
    const used = columns.filter(([key]) =>
        section.rows.some((r) => cell(r[key]) !== '')
    );
    if (used.length === 0) return '';
    const title = section.name
        ? `<h2 class="rpt-sec-title">${escapeHtml(prettySection(section.name))}</h2>`
        : '';
    const head = used
        .map(
            ([key, label]) =>
                `<th class="${numeric.has(key) ? 'rpt-num' : ''}">${escapeHtml(label)}</th>`
        )
        .join('');
    const body = section.rows
        .map(
            (r) =>
                `<tr>${used
                    .map(
                        ([key]) =>
                            `<td class="${numeric.has(key) ? 'rpt-num' : ''}">${escapeHtml(cell(r[key]))}</td>`
                    )
                    .join('')}</tr>`
        )
        .join('');
    return `<section class="rpt-card">
  ${title}
  <table class="rpt-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</section>`;
}

// One KPI card. Empty value -> '' so callers can filter unset headline numbers.
export function kpiCard(label: string, value: unknown, unit: string): string {
    const v = cell(value);
    if (v === '') return '';
    const u = unit
        ? `<span class="rpt-kpi-unit">${escapeHtml(unit)}</span>`
        : '';
    return `<div class="rpt-kpi"><div class="rpt-kpi-val">${escapeHtml(v)}${u}</div><div class="rpt-kpi-label">${escapeHtml(label)}</div></div>`;
}

// Wrap the filled KPI cards in the strip; '' when none are filled.
export function kpiSection(cards: readonly string[]): string {
    const filled = cards.filter((c) => c !== '');
    return filled.length
        ? `<section class="rpt-kpis">${filled.join('')}</section>`
        : '';
}

function buildHead(title: string): string {
    return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>`;
}

function buildHeader(meta: ReportHtmlMeta): string {
    const link = meta.dataDownloadUrl
        ? `<a class="rpt-cta" href="${escapeHtml(meta.dataDownloadUrl)}">Download full CSV</a>`
        : '';
    const note =
        typeof meta.rowsShown === 'number' &&
        typeof meta.totalRows === 'number' &&
        meta.rowsShown < meta.totalRows
            ? `<span class="rpt-note">Showing ${meta.rowsShown} of ${meta.totalRows} rows</span>`
            : '';
    return `<header class="rpt-head">
  <div class="rpt-head-main">
    <h1>${escapeHtml(meta.title)}</h1>
    <p class="rpt-sub">${escapeHtml(meta.subtitle)}</p>
    <p class="rpt-stamp">Generated ${escapeHtml(meta.generatedAt)} ${note}</p>
  </div>
  ${link}
</header>`;
}

function buildFooter(meta: ReportHtmlMeta): string {
    return `<footer class="rpt-foot">Shelly Fleet Manager · ${escapeHtml(meta.generatedAt)}</footer>`;
}

// 'WEEKDAY/WEEKEND' -> 'Weekday/Weekend', 'DATA_QUALITY' -> 'Data Quality'.
export function prettySection(name: string): string {
    return name
        .toLowerCase()
        .replace(/[_/]+/g, (m) => (m.includes('/') ? ' / ' : ' '))
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function cell(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    return String(value);
}

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Shelly brand palette: #4495D1 blue, #003C82 medium, #122A4F dark, #AAE1FA light.
const STYLES = `
:root{color-scheme:light;--brand:#4495D1;--brand-dk:#003C82;--ink:#122A4F;--line:#e3e7ee;--muted:#5b6b82;--bg:#f4f7fb}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:var(--bg);margin:0}
.rpt{max-width:1100px;margin:0 auto;padding:24px}
.rpt-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;background:linear-gradient(135deg,var(--ink),var(--brand-dk));color:#fff;border-radius:14px;padding:22px 24px;margin-bottom:18px}
.rpt-head h1{margin:0 0 4px;font-size:22px;font-weight:700}
.rpt-sub{margin:0 0 4px;font-size:14px;color:#cfe3f6}
.rpt-stamp{margin:0;font-size:12px;color:#9fc3e6}
.rpt-note{margin-left:8px}
.rpt-cta{flex:none;background:var(--brand);color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 14px;border-radius:8px}
.rpt-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.rpt-kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}
.rpt-kpi-val{font-size:22px;font-weight:700;color:var(--brand-dk)}
.rpt-kpi-unit{font-size:12px;font-weight:600;color:var(--muted);margin-left:4px}
.rpt-kpi-label{font-size:12px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:.04em}
.rpt-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px;overflow-x:auto}
.rpt-sec-title{margin:0 0 12px;font-size:15px;font-weight:700;color:var(--brand-dk);border-left:3px solid var(--brand);padding-left:9px}
.rpt-table{width:100%;border-collapse:collapse;font-size:12.5px}
.rpt-table th,.rpt-table td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}
.rpt-table th{background:#eef4fb;font-weight:600;color:var(--brand-dk)}
.rpt-table td.rpt-num,.rpt-table th.rpt-num{text-align:right;font-variant-numeric:tabular-nums}
.rpt-table tbody tr:nth-child(even) td{background:#fafcff}
.rpt-foot{text-align:center;color:var(--muted);font-size:11px;padding:14px 0}
@media print{
  @page{size:A4 portrait;margin:12mm 10mm}
  body{background:#fff}
  .rpt{padding:0;max-width:none}
  .rpt-head{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .rpt-card,.rpt-kpi{break-inside:avoid}
  .rpt-table tr{break-inside:avoid}
  .rpt-cta{display:none}
}
`;
