// Pure: builds a standalone, branded HTML energy report from the same row array
// the CSV writer consumes. No external assets, no JS. Screen- and print-friendly.
//
// Layout: branded header -> KPI cards (fleet headline numbers) -> one card per
// report section, each a table of only the columns that section actually fills.
// The document shell, section-table builder, KPI cards, and theme are shared
// with the environment report (reportHtmlShared) — this file owns only what is
// energy-specific: the column map and the fleet-total KPI selection.

import type {EnergyReportRow} from './energyEngineHelpers';
import {
    buildSectionTable,
    cell,
    groupBySection,
    kpiCard,
    kpiSection,
    type ReportColumn,
    type ReportHtmlMeta,
    renderReportDocument
} from './reportHtmlShared';

export type {ReportHtmlMeta} from './reportHtmlShared';

// Column key -> header label. Order is the render order within a section table.
const COLUMNS: ReadonlyArray<ReportColumn<EnergyReportRow>> = [
    ['date', 'Date'],
    ['device', 'Device'],
    ['phase', 'Phase'],
    ['consumption_kwh', 'kWh'],
    ['returned_kwh', 'Returned'],
    ['net_kwh', 'Net'],
    ['cost', 'Cost'],
    ['power_w', 'Power (W)'],
    ['voltage_v', 'V'],
    ['voltage_min_v', 'V min'],
    ['voltage_max_v', 'V max'],
    ['current_a', 'A'],
    ['current_max_a', 'A max'],
    ['share_pct', 'Share %'],
    ['imbalance_pct', 'Imbalance %'],
    ['delta_pct', 'Δ %'],
    ['notes', 'Notes']
];

// Right-align numeric-ish columns for a clean ledger look.
const NUMERIC = new Set<keyof EnergyReportRow>([
    'consumption_kwh',
    'returned_kwh',
    'net_kwh',
    'cost',
    'power_w',
    'voltage_v',
    'voltage_min_v',
    'voltage_max_v',
    'current_a',
    'current_max_a',
    'share_pct',
    'imbalance_pct',
    'delta_pct'
]);

export function renderEnergyReportHtml(
    rows: readonly EnergyReportRow[],
    meta: ReportHtmlMeta
): string {
    const sections = groupBySection(rows)
        .map((section) => buildSectionTable(section, COLUMNS, NUMERIC))
        .join('\n');
    return renderReportDocument(meta, buildKpis(rows), sections);
}

// Headline cards from the SUMMARY "Fleet total" row — the numbers a reader wants
// at a glance. Omitted entirely when that row is absent.
function buildKpis(rows: readonly EnergyReportRow[]): string {
    const fleet = rows.find(
        (r) => cell(r.section) === 'SUMMARY' && cell(r.device) === 'Fleet total'
    );
    if (!fleet) return '';
    return kpiSection([
        kpiCard('Consumption', fleet.consumption_kwh, 'kWh'),
        kpiCard('Returned', fleet.returned_kwh, 'kWh'),
        kpiCard('Net', fleet.net_kwh, 'kWh'),
        kpiCard('Cost', fleet.cost, ''),
        kpiCard('Peak power', fleet.power_w, 'W')
    ]);
}
