// IRDB CSV parser (github.com/probonopd/irdb file layout). One file = one
// remote: header `functionname,protocol,device,subdevice,function`, one
// row per button. Brand/device-type live in the IRDB directory path, not
// in the file; the importer takes them as user input.

import {type ImportSkip, IrImportParseError, type ParsedIrCode} from './types';

const IRDB_HEADER = [
    'functionname',
    'protocol',
    'device',
    'subdevice',
    'function'
] as const;

// Minimal CSV field splitter with double-quote support ("a,b" stays one
// field). IRDB rows are plain, but quoted function names must not break.
function splitCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

function isIntegerString(v: string): boolean {
    return /^-?\d+$/.test(v);
}

export function parseIrdbCsv(content: string): {
    codes: ParsedIrCode[];
    skipped: ImportSkip[];
} {
    const lines = content.split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => l.trim() !== '');
    if (headerIdx === -1) {
        throw new IrImportParseError('IRDB CSV is empty');
    }
    const header = splitCsvLine(lines[headerIdx].trim()).map((f) =>
        f.trim().toLowerCase()
    );
    const headerOk =
        header.length === IRDB_HEADER.length &&
        IRDB_HEADER.every((h, i) => header[i] === h);
    if (!headerOk) {
        throw new IrImportParseError(
            `not an IRDB CSV: expected header "${IRDB_HEADER.join(',')}", got "${lines[headerIdx].trim()}"`
        );
    }

    const codes: ParsedIrCode[] = [];
    const skipped: ImportSkip[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (raw === '') continue;
        const lineNo = i + 1;
        const fields = splitCsvLine(raw).map((f) => f.trim());
        if (fields.length !== IRDB_HEADER.length) {
            skipped.push({
                line: lineNo,
                reason: `expected ${IRDB_HEADER.length} columns, got ${fields.length}`
            });
            continue;
        }
        const [functionName, protocol, device, subdevice, fn] = fields;
        if (functionName === '') {
            skipped.push({line: lineNo, reason: 'empty functionname'});
            continue;
        }
        if (
            !isIntegerString(device) ||
            !isIntegerString(subdevice) ||
            !isIntegerString(fn)
        ) {
            skipped.push({
                line: lineNo,
                reason: 'device/subdevice/function must be integers'
            });
            continue;
        }
        codes.push({
            name: functionName,
            protocol: protocol === '' ? null : protocol,
            payload: {
                format: 'irdb',
                protocol,
                device: Number(device),
                subdevice: Number(subdevice),
                function: Number(fn)
            }
        });
    }
    return {codes, skipped};
}
