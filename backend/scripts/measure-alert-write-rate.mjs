// Measures how much of the alert-instance write load changes nothing.
//
// Samples pg_stat_all_tables and pg_stat_statements twice, two minutes apart,
// and reports mark calls, row updates, dead tuples and WAL generated. The
// "writes per call" ratio is the number that justified making the mark
// conditional: it read 97% no-ops before that change.
//
// Usage: PGPASSWORD=... node backend/scripts/measure-alert-write-rate.mjs
// Points at the local dev database (127.0.0.1:5434).

import pg from 'pg';

const c = new pg.Client({
    host: '127.0.0.1',
    port: 5434,
    user: 'postgres',
    database: 'fleet',
    password: process.env.PGPASSWORD
});
await c.connect();
const snap = async () => {
    const s =
        await c.query(`SELECT n_tup_upd, n_tup_ins, n_dead_tup FROM pg_stat_all_tables
    WHERE relid='notifications.alert_instances'::regclass`);
    const m =
        await c.query(`SELECT COALESCE(sum(calls),0) AS calls FROM pg_stat_statements
    WHERE query ILIKE '%mark_evaluation_state%'`);
    const w = await c.query(`SELECT pg_current_wal_lsn() AS lsn`);
    return {
        upd: +s.rows[0].n_tup_upd,
        ins: +s.rows[0].n_tup_ins,
        dead: +s.rows[0].n_dead_tup,
        calls: +m.rows[0].calls,
        lsn: w.rows[0].lsn
    };
};
const a = await snap();
await new Promise((r) => setTimeout(r, 120000));
const b = await snap();
const wal = await c.query(
    `SELECT pg_size_pretty(pg_wal_lsn_diff($1,$2)::bigint) AS d`,
    [b.lsn, a.lsn]
);
console.log('over 120 seconds:');
console.log('  mark calls      ', b.calls - a.calls);
console.log('  row updates     ', b.upd - a.upd);
console.log('  row inserts     ', b.ins - a.ins);
console.log('  dead tuples     ', b.dead - a.dead);
console.log('  WAL generated   ', wal.rows[0].d, '(whole database)');
const ratio =
    b.calls - a.calls > 0
        ? (((b.upd - a.upd) / (b.calls - a.calls)) * 100).toFixed(1)
        : 'n/a';
console.log('  writes per call ', ratio + '%');
await c.end();
