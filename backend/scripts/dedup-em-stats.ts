// One-time dedup of device_em.stats so the unique index (migration 6746) can be
// added on an install that already holds duplicate readings (from past
// live + emSync overlap, before idempotent ingest). Fresh installs have none.
//
// Duplicates are decided by the same key as the index:
// (device, tag, phase, channel, ts). One row per key is kept (the first by
// ctid); the rest are deleted. Compressed chunks are decompressed first
// (DELETE cannot touch compressed rows); the compression policy recompresses
// them later. Dry run by default.
//
// Usage:
//   DATABASE_URL=postgres://… npx tsx scripts/dedup-em-stats.ts [--apply]

import {Client} from 'pg';

const DUP_COUNT_SQL = `
    SELECT COALESCE(SUM(extra), 0)::bigint AS extra_rows
    FROM (
        SELECT count(*) - 1 AS extra
        FROM device_em.stats
        GROUP BY device, tag, phase, channel, ts
        HAVING count(*) > 1
    ) g`;

// Keep the first row per key (min ctid); delete the rest. NOT DISTINCT FROM so
// NULL phase/channel compare equal, matching the NULLS NOT DISTINCT index.
const DEDUP_SQL = `
    DELETE FROM device_em.stats a
    USING device_em.stats b
    WHERE a.ctid > b.ctid
      AND a.device = b.device
      AND a.tag = b.tag
      AND a.ts = b.ts
      AND a.phase IS NOT DISTINCT FROM b.phase
      AND a.channel IS NOT DISTINCT FROM b.channel`;

async function countDuplicates(client: Client): Promise<number> {
    const {rows} = await client.query<{extra_rows: string}>(DUP_COUNT_SQL);
    return Number(rows[0]?.extra_rows ?? 0);
}

async function decompressAllChunks(client: Client): Promise<number> {
    const {rows} = await client.query<{chunk: string}>(
        `SELECT format('%I.%I', chunk_schema, chunk_name) AS chunk
         FROM timescaledb_information.chunks
         WHERE hypertable_schema = 'device_em' AND hypertable_name = 'stats'
           AND is_compressed`
    );
    for (const r of rows) {
        await client.query('SELECT decompress_chunk($1::regclass)', [r.chunk]);
    }
    return rows.length;
}

async function main(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const apply = process.argv.includes('--apply');

    const client = new Client({connectionString: url});
    await client.connect();
    try {
        const extra = await countDuplicates(client);
        if (extra === 0) {
            console.log('No duplicates in device_em.stats — nothing to do.');
            return;
        }
        console.log(
            `${apply ? 'Removing' : '[dry run] would remove'} ${extra} duplicate row(s).`
        );
        if (!apply) {
            console.log('Re-run with --apply to execute.');
            return;
        }
        const decompressed = await decompressAllChunks(client);
        console.log(`Decompressed ${decompressed} chunk(s) for dedup.`);
        const res = await client.query(DEDUP_SQL);
        console.log(
            `Removed ${res.rowCount ?? 0} duplicate row(s). Compression policy will recompress chunks.`
        );
    } finally {
        await client.end();
    }
}

if (process.argv[1]?.endsWith('dedup-em-stats.ts')) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
