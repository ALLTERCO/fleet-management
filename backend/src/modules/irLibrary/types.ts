// Shared shapes for the IR import parsers. Parsers are pure: text in,
// parsed codes + per-line skips out; a file that is not the expected
// format at all throws IrImportParseError (fail loud, never guess).

export interface ParsedIrCode {
    name: string;
    protocol: string | null;
    /** Faithful record of the source row/signal; nothing renamed or dropped. */
    payload: Record<string, unknown>;
}

export interface ImportSkip {
    line: number;
    reason: string;
}

export type IrImportFormat = 'irdb_csv' | 'flipper_ir';

export interface ParsedImport {
    format: IrImportFormat;
    codes: ParsedIrCode[];
    skipped: ImportSkip[];
}

/** The file is not parseable as any supported IR format. */
export class IrImportParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IrImportParseError';
    }
}
