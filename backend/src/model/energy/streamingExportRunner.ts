/**
 * DB-bound runner for the energy streaming export. Streams a validated
 * COPY TO STDOUT statement from Postgres through gzip into a file at constant
 * memory. Split from streamingExport.ts so the pure builder stays test-light.
 */

import {once} from 'node:events';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {parse as csvParse} from 'fast-csv';
import {to as copyTo} from 'pg-copy-streams';
import {withPooledClient} from '../../modules/PostgresProvider';
import {
    type GzipFileOptions,
    pipeToGzipFile,
    toCopyStatement,
    toCopyStatementNoHeader
} from './streamingExport';

const NEWLINE = 0x0a;

/**
 * COPY fast path: stream pre-formatted per-window SELECTs straight from
 * Postgres (raw CSV bytes, no parse, no per-row JS) through a single gzip
 * stream into one file. One header line, each window appended headerless, an
 * optional Totals line, then close. Constant memory, ~DB-COPY throughput.
 *
 * Each window runs on its own pooled client; for-await over the COPY source
 * propagates a cancelled/timed-out statement as a rejection (so it fails the
 * job, never an unhandled stream 'error').
 */
export async function streamFormattedReportToGzip(input: {
    filePath: string;
    headerCols: readonly string[];
    windowSqls: readonly string[];
    totalsSql?: string;
    totalsLabel?: string;
    onProgress?: (rows: number, bytes: number) => Promise<void> | void;
}): Promise<{bytesWritten: number; rowsWritten: number}> {
    const fileStream = createWriteStream(input.filePath);
    const gzip = createGzip();
    const fileDone = pipeline(gzip, fileStream);
    let rowsWritten = 0;
    const write = async (chunk: Buffer | string) => {
        if (!gzip.write(chunk)) await once(gzip, 'drain');
    };
    try {
        await write(`${input.headerCols.join(',')}\n`);
        for (const sql of input.windowSqls) {
            await withPooledClient(async (client) => {
                const source = client.query(
                    copyTo(toCopyStatementNoHeader(sql))
                );
                for await (const chunk of source as AsyncIterable<Buffer>) {
                    for (let i = 0; i < chunk.length; i++) {
                        if (chunk[i] === NEWLINE) rowsWritten++;
                    }
                    await write(chunk);
                }
            });
            if (input.onProgress) {
                await input.onProgress(rowsWritten, fileStream.bytesWritten);
            }
        }
        if (input.totalsSql) {
            const total = await withPooledClient(async (client) => {
                const res = await client.query(input.totalsSql as string);
                const row = res.rows?.[0] ?? {};
                return String(Object.values(row)[0] ?? '0');
            });
            await write(`,${input.totalsLabel ?? 'Totals'},${total}\n`);
            rowsWritten++;
        }
        gzip.end();
        await fileDone;
    } catch (error) {
        gzip.destroy(error as Error);
        fileStream.destroy(error as Error);
        throw error;
    }
    return {bytesWritten: fileStream.bytesWritten, rowsWritten};
}

/**
 * Stream a validated SELECT to a gzipped CSV file via COPY TO STDOUT at
 * constant memory. Returns the gzipped byte count.
 */
export async function streamSelectToGzipCsv(
    selectSql: string,
    filePath: string,
    options: GzipFileOptions = {}
): Promise<number> {
    const copySql = toCopyStatement(selectSql);
    return withPooledClient(async (client) => {
        const source = client.query(copyTo(copySql));
        return pipeToGzipFile(source, filePath, options);
    });
}

export async function streamSelectCsvRows(
    selectSql: string,
    onRow: (row: Record<string, string>) => Promise<void>
): Promise<void> {
    const copySql = toCopyStatement(selectSql);
    await withPooledClient(async (client) => {
        const source = client.query(copyTo(copySql));
        const parser = source.pipe(csvParse({headers: true}));
        // .pipe() does not forward source errors; route them into the parser so
        // a cancelled/timed-out COPY rejects the for-await instead of becoming
        // an unhandled 'error' that crashes the process.
        source.on('error', (err) => {
            if (!parser.destroyed) parser.destroy(err as Error);
        });
        try {
            for await (const row of parser) {
                await onRow(row as Record<string, string>);
            }
        } catch (error) {
            source.destroy(error as Error);
            parser.destroy(error as Error);
            throw error;
        }
    });
}
