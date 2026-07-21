// Pure: builds a standalone, branded HTML environment report from the same row
// array the CSV writer consumes. Mirrors renderEnergyReportHtml — same light
// print theme, header, KPI cards, one card per section, footer — sharing all of
// that through reportHtmlShared. This file owns only what is environment-
// specific: the column map and the fleet-summary KPI selection.

import {
    ENVIRONMENT_NUMERIC_COLUMNS,
    ENVIRONMENT_REPORT_COLUMNS,
    type EnvironmentReportRow
} from './environmentReportRow';
import {
    buildSectionTable,
    cell,
    groupBySection,
    kpiCard,
    kpiSection,
    type ReportHtmlMeta,
    renderReportDocument
} from './reportHtmlShared';

export type {ReportHtmlMeta} from './reportHtmlShared';

export function renderEnvironmentReportHtml(
    rows: readonly EnvironmentReportRow[],
    meta: ReportHtmlMeta
): string {
    const sections = groupBySection(rows)
        .map((section) =>
            buildSectionTable(
                section,
                ENVIRONMENT_REPORT_COLUMNS,
                ENVIRONMENT_NUMERIC_COLUMNS
            )
        )
        .join('\n');
    return renderReportDocument(meta, buildKpis(rows), sections);
}

// Headline cards from the SUMMARY rows — avg temperature/humidity, comfort %,
// and sensor count. Each is a single SUMMARY row keyed by `kind`. Omitted when
// the matching row is absent.
function buildKpis(rows: readonly EnvironmentReportRow[]): string {
    const summary = (kind: string): EnvironmentReportRow | undefined =>
        rows.find(
            (r) => cell(r.section) === 'SUMMARY' && cell(r.kind) === kind
        );
    const temp = summary('temperature');
    const hum = summary('humidity');
    const comfort = summary('comfort');
    const sensors = summary('sensors');
    // Present only when safety sensors reported; omitted otherwise.
    const alarms = summary('alarms');
    return kpiSection([
        kpiCard('Avg temperature', temp?.avg, cell(temp?.unit)),
        kpiCard('Avg humidity', hum?.avg, cell(hum?.unit)),
        kpiCard('Comfort', comfort?.in_band_pct, '%'),
        kpiCard('Sensors', sensors?.samples, ''),
        kpiCard('Active alarms', alarms?.samples, '')
    ]);
}
