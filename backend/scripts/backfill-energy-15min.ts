// Backfill device_em.energy_15min from existing raw device_em.stats.
//
// Window-by-window and resumable (the TimescaleDB refresh_continuous_aggregate
// / AWS Timestream scheduled-query pattern): each window is a bounded,
// authoritative INSERT…SELECT…ON CONFLICT DO UPDATE (overwrite from raw),
// committed on its own. No single giant statement, so it is safe at fleet
// scale. Idempotent — re-running recomputes the same buckets. Window
// boundaries are 15-minute aligned so no rollup bucket is split across two
// windows (which would make overwrite drop the earlier half).
//
// Usage:
//   DATABASE_URL=postgres://… npx tsx scripts/backfill-energy-15min.ts [--apply] [--window-days N] [--from ISO]
//   Default is a dry run (prints the plan). --from resumes after an interruption.

import {Client} from 'pg';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Window {
    start: Date;
    end: Date;
}

/** Bounded [start,end) windows, each 15-min aligned, oldest first. */
export function planWindows(
    fromMs: number,
    toMs: number,
    windowMs: number
): Window[] {
    const alignedFrom = Math.floor(fromMs / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
    const windows: Window[] = [];
    for (let s = alignedFrom; s < toMs; s += windowMs) {
        windows.push({
            start: new Date(s),
            end: new Date(Math.min(s + windowMs, toMs))
        });
    }
    return windows;
}

const BACKFILL_SQL = `
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, sum_val, sample_count, min_val, max_val)
    SELECT time_bucket(INTERVAL '15 min', ts), device, phase, channel, tag,
           SUM(val::DOUBLE PRECISION), COUNT(*),
           MIN(val::DOUBLE PRECISION), MAX(val::DOUBLE PRECISION)
    FROM device_em.stats
    WHERE ts >= $1 AND ts < $2
    GROUP BY 1, device, phase, channel, tag
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = EXCLUDED.sum_val,
        sample_count = EXCLUDED.sample_count,
        min_val      = EXCLUDED.min_val,
        max_val      = EXCLUDED.max_val`;

async function backfillWindow(client: Client, w: Window): Promise<number> {
    const res = await client.query(BACKFILL_SQL, [
        w.start.toISOString(),
        w.end.toISOString()
    ]);
    return res.rowCount ?? 0;
}

/** Raw range to backfill: oldest raw row → start of the current 15-min bucket. */
async function rawRange(
    client: Client,
    fromOverride?: string
): Promise<{fromMs: number; toMs: number} | null> {
    const {rows} = await client.query<{min_ts: Date | null}>(
        'SELECT min(ts) AS min_ts FROM device_em.stats'
    );
    const minTs = rows[0]?.min_ts;
    if (!minTs) return null;
    const fromMs = fromOverride ? Date.parse(fromOverride) : minTs.getTime();
    const nowBucketMs =
        Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
    if (fromMs >= nowBucketMs) return null;
    return {fromMs, toMs: nowBucketMs};
}

function parseArgs(argv: string[]): {
    apply: boolean;
    windowMs: number;
    from?: string;
} {
    const apply = argv.includes('--apply');
    const windowDays = Number(argValue(argv, '--window-days') ?? '1');
    const from = argValue(argv, '--from');
    return {apply, windowMs: Math.max(1, windowDays) * DAY_MS, from};
}

function argValue(argv: string[], flag: string): string | undefined {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const {apply, windowMs, from} = parseArgs(process.argv.slice(2));

    const client = new Client({connectionString: url});
    await client.connect();
    try {
        const range = await rawRange(client, from);
        if (!range) {
            console.log('Nothing to backfill (no raw rows in range).');
            return;
        }
        const windows = planWindows(range.fromMs, range.toMs, windowMs);
        console.log(
            `${apply ? 'Backfilling' : '[dry run] would backfill'} ${windows.length} window(s) ` +
                `from ${new Date(range.fromMs).toISOString()} to ${new Date(range.toMs).toISOString()}`
        );
        if (!apply) {
            console.log('Re-run with --apply to execute.');
            return;
        }
        let total = 0;
        for (const w of windows) {
            const rows = await backfillWindow(client, w);
            total += rows;
            console.log(
                `  ${w.start.toISOString()} → ${w.end.toISOString()}: ${rows} rollup rows`
            );
        }
        console.log(
            `Done. ${total} rollup rows written across ${windows.length} window(s).`
        );
    } finally {
        await client.end();
    }
}

// Run only when invoked directly, so the pure helpers stay unit-testable.
if (process.argv[1]?.endsWith('backfill-energy-15min.ts')) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
