// Row shape for the environment report — the analogue of energyRow. Every row
// carries the same columns so the CSV header is stable (fast-csv derives headers
// from the first row) and the HTML renderer can pick per-section which columns
// to draw. `section` groups rows into cards; it is not itself a table column.

import type {ReportColumn} from './reportHtmlShared';

export interface EnvironmentReportRow {
    section: string;
    kind: unknown;
    sensor: unknown;
    source: unknown;
    unit: unknown;
    avg: unknown;
    min: unknown;
    max: unknown;
    samples: unknown;
    in_band_pct: unknown;
    breaches: unknown;
    notes: unknown;
}

// Named-column row builder; unset columns render as empty cells. Named (not
// positional) so a caller cannot silently swap two columns.
export function envRow(
    cells: Partial<EnvironmentReportRow>
): EnvironmentReportRow {
    return {
        section: '',
        kind: '',
        sensor: '',
        source: '',
        unit: '',
        avg: '',
        min: '',
        max: '',
        samples: '',
        in_band_pct: '',
        breaches: '',
        notes: '',
        ...cells
    };
}

// Blank row — visible separator between CSV sections.
export function envRowBlank(): EnvironmentReportRow {
    return envRow({});
}

// Column key -> header label. Order is the render order within a section table.
export const ENVIRONMENT_REPORT_COLUMNS: ReadonlyArray<
    ReportColumn<EnvironmentReportRow>
> = [
    ['kind', 'Kind'],
    ['sensor', 'Sensor'],
    ['source', 'Source'],
    ['unit', 'Unit'],
    ['avg', 'Avg'],
    ['min', 'Min'],
    ['max', 'Max'],
    ['samples', 'Samples'],
    ['in_band_pct', 'In band %'],
    ['breaches', 'Breaches'],
    ['notes', 'Notes']
];

// Right-align numeric columns for a clean ledger look.
export const ENVIRONMENT_NUMERIC_COLUMNS = new Set<keyof EnvironmentReportRow>([
    'avg',
    'min',
    'max',
    'samples',
    'in_band_pct',
    'breaches'
]);
