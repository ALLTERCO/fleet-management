import {formatCurrency} from './format';

export const RECORDED_BILL_IMPORT_LIMIT = 500;
export const RECORDED_BILL_FILE_LIMIT_BYTES = 1_000_000;

export interface RecordedBillIdentity {
    utilityAccountId?: string | null;
    meterIdentifier?: string | null;
    servicePointIdentifier?: string | null;
}

export interface RecordedBillInput extends RecordedBillIdentity {
    periodStart: string;
    periodEnd: string;
    actualCost: number;
    currency: string;
}

export interface RecordedBillRow extends RecordedBillInput {
    id: number;
    currency: string;
}

export interface BillImportIssue {
    row: number;
    message: string;
}

export interface BillImportParseResult {
    rows: RecordedBillInput[];
    issues: BillImportIssue[];
}

const REQUIRED_BILL_HEADERS = [
    'periodStart',
    'periodEnd',
    'actualCost',
    'currency'
] as const;
const OPTIONAL_BILL_HEADERS = [
    'utilityAccountId',
    'meterIdentifier',
    'servicePointIdentifier'
] as const;
const KNOWN_BILL_HEADERS = new Set<string>([
    ...REQUIRED_BILL_HEADERS,
    ...OPTIONAL_BILL_HEADERS
]);

export function parseRecordedBillCsv(text: string): BillImportParseResult {
    const parsed = parseCsv(text.replace(/^\uFEFF/, ''));
    if (parsed.issue) {
        return {rows: [], issues: [parsed.issue]};
    }
    if (parsed.rows.length === 0) {
        return {
            rows: [],
            issues: [{row: 1, message: 'The CSV file is empty.'}]
        };
    }

    const headers = parsed.rows[0].map((header) => header.trim());
    const issues: BillImportIssue[] = [];
    for (const required of REQUIRED_BILL_HEADERS) {
        if (!headers.includes(required)) {
            issues.push({
                row: 1,
                message: `Missing required column “${required}”.`
            });
        }
    }
    const duplicate = headers.find(
        (header, index) => header && headers.indexOf(header) !== index
    );
    if (duplicate) {
        issues.push({row: 1, message: `Column “${duplicate}” appears twice.`});
    }
    const unknown = headers.find((header) => !KNOWN_BILL_HEADERS.has(header));
    if (unknown) {
        issues.push({row: 1, message: `Unknown column “${unknown}”.`});
    }
    if (issues.length > 0) return {rows: [], issues};

    const dataRows = parsed.rows
        .slice(1)
        .filter((row) => row.some((cell) => cell.trim().length > 0));
    if (dataRows.length > RECORDED_BILL_IMPORT_LIMIT) {
        return {
            rows: [],
            issues: [
                {
                    row: 1,
                    message: `A file can contain at most ${RECORDED_BILL_IMPORT_LIMIT} bills.`
                }
            ]
        };
    }

    const rows: RecordedBillInput[] = [];
    const identityRows = new Map<string, number>();
    for (const [index, cells] of dataRows.entries()) {
        const rowNumber = index + 2;
        if (cells.length > headers.length) {
            issues.push({
                row: rowNumber,
                message: `Row has ${cells.length} values but the header has ${headers.length} columns.`
            });
            continue;
        }
        const value = Object.fromEntries(
            headers.map((header, cellIndex) => [
                header,
                (cells[cellIndex] ?? '').trim()
            ])
        );
        const error = validateRecordedBillInput({
            periodStart: value.periodStart,
            periodEnd: value.periodEnd,
            actualCost: Number(value.actualCost),
            currency: value.currency,
            utilityAccountId: value.utilityAccountId || undefined,
            meterIdentifier: value.meterIdentifier || undefined,
            servicePointIdentifier: value.servicePointIdentifier || undefined
        });
        if (error) {
            issues.push({row: rowNumber, message: error});
            continue;
        }
        const bill: RecordedBillInput = {
            periodStart: value.periodStart,
            periodEnd: value.periodEnd,
            actualCost: Number(value.actualCost),
            currency: value.currency.toUpperCase(),
            ...(value.utilityAccountId
                ? {utilityAccountId: value.utilityAccountId}
                : {}),
            ...(value.meterIdentifier
                ? {meterIdentifier: value.meterIdentifier}
                : {}),
            ...(value.servicePointIdentifier
                ? {servicePointIdentifier: value.servicePointIdentifier}
                : {})
        };
        const duplicateKey = billIdentityKey(bill);
        const firstRow = identityRows.get(duplicateKey);
        if (firstRow !== undefined) {
            issues.push({
                row: rowNumber,
                message: `Duplicates row ${firstRow} for the same period and recorded identity.`
            });
            continue;
        }
        identityRows.set(duplicateKey, rowNumber);
        rows.push(bill);
    }
    return {rows, issues};
}

export function validateRecordedBillInput(
    input: RecordedBillInput
): string | null {
    if (!isCalendarDate(input.periodStart)) {
        return 'Start date must be a real date in YYYY-MM-DD format.';
    }
    if (!isCalendarDate(input.periodEnd)) {
        return 'End date must be a real date in YYYY-MM-DD format.';
    }
    if (input.periodEnd < input.periodStart) {
        return 'End date must be on or after the start date.';
    }
    if (!Number.isFinite(input.actualCost) || input.actualCost < 0) {
        return 'Actual cost must be zero or greater.';
    }
    if (!/^[A-Za-z]{3}$/.test(input.currency)) {
        return 'Currency must be a three-letter ISO 4217 code.';
    }
    for (const [label, value] of [
        ['Utility account ID', input.utilityAccountId],
        ['Meter identifier', input.meterIdentifier],
        ['Service-point identifier', input.servicePointIdentifier]
    ] as const) {
        if (value && value.length > 120) return `${label} is too long.`;
    }
    return null;
}

function billIdentityKey(input: RecordedBillInput): string {
    return [
        input.periodStart,
        input.periodEnd,
        input.utilityAccountId ?? '',
        input.meterIdentifier ?? '',
        input.servicePointIdentifier ?? ''
    ].join('\u0000');
}

export function billCoverageLabel(identity: RecordedBillIdentity): string {
    const count = [
        identity.utilityAccountId,
        identity.meterIdentifier,
        identity.servicePointIdentifier
    ].filter(Boolean).length;
    if (count === 3) return 'Exact account + meter + service point';
    if (count === 0) return 'Period only';
    return `Exact match on ${count} identifier${count === 1 ? '' : 's'}`;
}

export function recordedBillFileSizeIssue(size: number): string | null {
    return size > RECORDED_BILL_FILE_LIMIT_BYTES
        ? 'The CSV file is larger than 1 MB.'
        : null;
}

/** One home for accounting money text. The code, not the symbol, so a reader
 *  never has to guess which dollar or krone a bill is written in. Region-aware
 *  (helpers/format.ts) for the separators; the code itself never changes. */
export function formatMoney(value: number, currency: string): string {
    return formatCurrency(value, currency, {currencyDisplay: 'code'});
}

/** Channel indexes a device reports, read from its own status keys. The device
 *  is the truth about how many channels it has; Fleet keeps no table. */
export function deviceChannelNumbers(
    status: Record<string, unknown> | undefined | null
): number[] {
    const channels = new Set<number>();
    for (const key of Object.keys(status ?? {})) {
        const separator = key.lastIndexOf(':');
        if (separator < 0) continue;
        const channel = Number(key.slice(separator + 1));
        if (Number.isInteger(channel) && channel >= 0) channels.add(channel);
    }
    return [...channels].sort((a, b) => a - b);
}

function isCalendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

function parseCsv(text: string): {
    rows: string[][];
    issue: BillImportIssue | null;
} {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    let rowNumber = 1;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            row.push(cell);
            cell = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            rowNumber += 1;
        } else {
            cell += char;
        }
    }
    if (quoted) {
        return {
            rows: [],
            issue: {
                row: rowNumber,
                message:
                    'Quoted value is not closed before the end of the file.'
            }
        };
    }
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return {rows, issue: null};
}
