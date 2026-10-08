// Format detection + dispatch for IR library file imports. Extension is
// the declared intent; the format parser then verifies the content and
// throws IrImportParseError when it does not match. Unknown extensions
// are rejected loudly, with no sniffing and no silent fallback.

import {parseFlipperIr} from './flipperIr';
import {parseIrdbCsv} from './irdbCsv';
import {IrImportParseError, type ParsedImport} from './types';

export function parseImportFile(
    filename: string,
    content: string
): ParsedImport {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.csv')) {
        return {format: 'irdb_csv', ...parseIrdbCsv(content)};
    }
    if (lower.endsWith('.ir')) {
        return {format: 'flipper_ir', ...parseFlipperIr(content)};
    }
    throw new IrImportParseError(
        `unsupported file "${filename}": expected .csv (IRDB) or .ir (Flipper)`
    );
}
