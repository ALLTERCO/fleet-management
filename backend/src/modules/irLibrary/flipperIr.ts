// Flipper Zero .ir parser. Key-value text format: a `Filetype: IR
// signals/library file` header, then one record per signal starting at
// each `name:` key. `type: parsed` signals carry protocol/address/command;
// `type: raw` signals carry frequency/duty_cycle/data. Values are kept
// verbatim in the payload; the on-wire push shape is hardware-pending.

import {type ImportSkip, IrImportParseError, type ParsedIrCode} from './types';

const FILETYPE_RE = /^Filetype:\s*IR\s+(signals|library)\s+file$/i;

interface RawRecord {
    line: number;
    fields: Record<string, string>;
}

function splitRecords(lines: string[]): RawRecord[] {
    const records: RawRecord[] = [];
    let current: RawRecord | null = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '' || line.startsWith('#')) continue;
        const sep = line.indexOf(':');
        if (sep === -1) continue;
        const key = line.slice(0, sep).trim().toLowerCase();
        const value = line.slice(sep + 1).trim();
        if (key === 'filetype' || key === 'version') continue;
        if (key === 'name') {
            current = {line: i + 1, fields: {name: value}};
            records.push(current);
            continue;
        }
        if (current) current.fields[key] = value;
    }
    return records;
}

function parsedSignalPayload(
    fields: Record<string, string>
): Record<string, unknown> | string {
    const missing = ['protocol', 'address', 'command'].filter(
        (k) => !fields[k]
    );
    if (missing.length > 0) {
        return `parsed signal missing ${missing.join(', ')}`;
    }
    return {
        format: 'flipper',
        type: 'parsed',
        protocol: fields.protocol,
        address: fields.address,
        command: fields.command
    };
}

function rawSignalPayload(
    fields: Record<string, string>
): Record<string, unknown> | string {
    const missing = ['frequency', 'duty_cycle', 'data'].filter(
        (k) => !fields[k]
    );
    if (missing.length > 0) {
        return `raw signal missing ${missing.join(', ')}`;
    }
    const frequency = Number(fields.frequency);
    const dutyCycle = Number(fields.duty_cycle);
    if (!Number.isFinite(frequency) || !Number.isFinite(dutyCycle)) {
        return 'raw signal frequency/duty_cycle must be numeric';
    }
    if (!/^\d+(\s+\d+)*$/.test(fields.data)) {
        return 'raw signal data must be space-separated integers';
    }
    return {
        format: 'flipper',
        type: 'raw',
        frequency,
        duty_cycle: dutyCycle,
        data: fields.data
    };
}

export function parseFlipperIr(content: string): {
    codes: ParsedIrCode[];
    skipped: ImportSkip[];
} {
    const lines = content.split(/\r?\n/);
    const firstLine = lines.find((l) => l.trim() !== '');
    if (!firstLine || !FILETYPE_RE.test(firstLine.trim())) {
        throw new IrImportParseError(
            'not a Flipper .ir file: missing "Filetype: IR signals file" header'
        );
    }

    const codes: ParsedIrCode[] = [];
    const skipped: ImportSkip[] = [];
    for (const record of splitRecords(lines)) {
        const {name, type} = record.fields;
        if (!name) {
            skipped.push({line: record.line, reason: 'signal has no name'});
            continue;
        }
        if (type !== 'parsed' && type !== 'raw') {
            skipped.push({
                line: record.line,
                reason: `unknown signal type "${type ?? ''}" (expected parsed or raw)`
            });
            continue;
        }
        const payload =
            type === 'parsed'
                ? parsedSignalPayload(record.fields)
                : rawSignalPayload(record.fields);
        if (typeof payload === 'string') {
            skipped.push({line: record.line, reason: payload});
            continue;
        }
        codes.push({
            name,
            protocol:
                type === 'parsed' ? (record.fields.protocol ?? null) : 'raw',
            payload
        });
    }
    return {codes, skipped};
}
