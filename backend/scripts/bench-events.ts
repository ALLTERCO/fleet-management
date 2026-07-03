/**
 * Event-system stress bench.
 *
 * Measures the perf wins this session shipped:
 *   - mergeStatusAndDiff (Phase 2.2a)
 *   - per-subscriber path filter (Phase 2.3)
 *   - reverse path index in EventDistributor
 *   - lazy serialization
 *
 * Spins up N virtual ShellyDevices and S subscribers (a mix of
 * unfiltered and path-filtered listeners), pumps M NotifyStatus
 * deltas per device, then reports throughput + the relevant
 * observability counters.
 *
 * Usage:
 *   npx tsx backend/scripts/bench-events.ts
 *   npx tsx backend/scripts/bench-events.ts --devices=500 --subs=50 --ticks=200 \
 *       --path-filtered-pct=80
 *
 * Sanity numbers on dev laptop (M3 Pro, 2026-05-13):
 *   --devices=500 --subs=50 --ticks=100 --path-filtered-pct=80
 *   throughput:        ~50k events/sec
 *   path-skipped:      ~95% of listener iterations avoided
 *   serialize-skipped: ~95% of stringify calls avoided
 *
 * This is a single-process bench — no WS overhead, no auth, no DB.
 * It measures the EventDistributor + AbstractDevice merge hot path.
 * For full end-to-end stress (multiple WS clients hitting /shelly),
 * the proper rig (per docs/plans/2026-05-07-redis-hot-path-plan.md
 * §1) is still pending.
 */

import './bench-events-env';
import CommandSender from '../src/model/CommandSender';
import ShellyDevice from '../src/model/ShellyDevice';
import RpcTransport from '../src/model/transport/RpcTransport';
import * as EventDistributor from '../src/modules/EventDistributor';
import * as Observability from '../src/modules/Observability';

const argv = process.argv.slice(2);
function arg(name: string, def: number): number {
    const m = argv.find((a) => a.startsWith(`--${name}=`));
    return m ? Number.parseInt(m.split('=')[1], 10) : def;
}

const N_DEVICES = arg('devices', 500);
const N_SUBS = arg('subs', 50);
const N_TICKS = arg('ticks', 100);
const PATH_FILTERED_PCT = arg('path-filtered-pct', 80);

class SilentTransport extends RpcTransport {
    readonly name = 'websocket';
    protected _sendRPC(): void {}
}

function makeDevice(i: number): ShellyDevice {
    return new ShellyDevice(
        `bench-${i}`,
        new SilentTransport(),
        'online',
        {
            id: `bench-${i}`,
            mac: `AA${i.toString(16).padStart(10, '0').toUpperCase()}`,
            model: 'SNSW-001X16EU',
            gen: 2,
            fw_id: '20260429/shelly-os',
            ver: '1.0.0',
            app: 'Plus1PM'
        },
        {'switch:0': {output: false, apower: 0, voltage: 230}},
        {},
        false,
        100_000 + i
    );
}

/** Component keys a subscriber might care about. Mirrors what a
 *  dashboard tile would declare. */
const PATH_OPTIONS = [
    ['switch:0.output'],
    ['switch:0.apower'],
    ['em:0.apower'],
    ['wifi.rssi'],
    ['sys.unixtime'],
    ['switch:0'], // whole-component shorthand
    ['switch:0.output', 'switch:0.apower']
];

function readCounters() {
    // Application counters surface in Prometheus as either the bare
    // metric name (fm_events_broadcast) or the generic prefixed form
    // (fm_counter_<name>) depending on the module's registration path.
    // Capture both so we don't miss the ones we just added.
    const metrics = Observability.getPrometheusMetrics();
    const out: Record<string, number> = {};
    for (const line of metrics.split('\n')) {
        const m = line.match(
            /^(fm_(?:counter_)?(?:events_[a-z_]+|events_broadcast|events_path_dispatch_[a-z_]+|events_serialized|events_path_filtered))\b\s+(\d+(?:\.\d+)?)/
        );
        if (m) out[m[1]] = Number(m[2]);
    }
    return out;
}

async function main() {
    console.log(
        `bench-events: devices=${N_DEVICES} subs=${N_SUBS} ticks=${N_TICKS} path-filtered-pct=${PATH_FILTERED_PCT}`
    );
    // Counters are only accumulated at observability level >= 2 —
    // turn it on for the bench so the metrics surface in the snapshot.
    Observability.setLevel(2);

    // 1. Spin up virtual devices.
    const devices: ShellyDevice[] = [];
    for (let i = 0; i < N_DEVICES; i++) devices.push(makeDevice(i));

    // 2. Spin up subscribers. Mix of unfiltered + path-filtered per
    //    PATH_FILTERED_PCT.
    const listenerIds: number[] = [];
    for (let i = 0; i < N_SUBS; i++) {
        const isFiltered = Math.random() * 100 < PATH_FILTERED_PCT;
        const opts = isFiltered
            ? {paths: PATH_OPTIONS[i % PATH_OPTIONS.length]}
            : {};
        const id = EventDistributor.addEventListener(
            CommandSender.INTERNAL,
            'Shelly.Status',
            opts,
            () => {
                // Drain only — the wire-write is what the WS sender
                // would do; we measure fanout cost, not send cost.
            }
        );
        listenerIds.push(id);
    }

    // 3. Baseline counters.
    const before = readCounters();

    // 4. Tick loop — each tick mutates every device's switch:0.apower
    //    by ±1W. The merge produces one PathChange per device per tick.
    const t0 = performance.now();
    for (let tick = 0; tick < N_TICKS; tick++) {
        const v = 10 + (tick % 100) * 0.5;
        for (const d of devices) {
            d.batchSetComponentStatus({
                'switch:0': {apower: v}
            });
        }
    }
    // Let any microtask-deferred listener work finish.
    await new Promise((r) => setImmediate(r));
    const elapsedMs = performance.now() - t0;

    // 5. Snapshot counters, compute deltas.
    const after = readCounters();
    const delta = (k: string) => (after[k] ?? 0) - (before[k] ?? 0);

    const totalEvents = N_DEVICES * N_TICKS;
    const throughput = (totalEvents / elapsedMs) * 1000;
    const candidates =
        delta('fm_events_path_dispatch_candidates') +
        delta('fm_counter_events_path_dispatch_candidates');
    const skipped =
        delta('fm_events_path_dispatch_skipped') +
        delta('fm_counter_events_path_dispatch_skipped');
    const serialized =
        delta('fm_events_serialized') + delta('fm_counter_events_serialized');
    const broadcast =
        delta('fm_events_broadcast') + delta('fm_counter_events_broadcast');
    const totalListenerIterations = candidates + skipped;

    console.log('');
    console.log(`elapsed:           ${elapsedMs.toFixed(0)} ms`);
    console.log(
        `throughput:        ${throughput.toFixed(0).padStart(8)} events/sec`
    );
    console.log('');
    console.log('--- EventDistributor ---');
    console.log(`broadcasts:        ${broadcast.toString().padStart(8)}`);
    console.log(
        `path-skipped:      ${skipped.toString().padStart(8)}  ` +
            `(${totalListenerIterations > 0 ? ((skipped / totalListenerIterations) * 100).toFixed(1) : '0'}% of would-be iterations)`
    );
    console.log(
        `serialized:        ${serialized.toString().padStart(8)}  ` +
            `(${broadcast > 0 ? ((serialized / broadcast) * 100).toFixed(1) : '0'}% of broadcasts triggered stringify)`
    );

    // Cleanup — keep the listener tear-down so a future caller
    // running this bench twice from the same process doesn't accumulate.
    for (const id of listenerIds) {
        EventDistributor.removeEventListener(id, 'Shelly.Status');
    }
    for (const d of devices) d.destroy({skipDeleteEvent: true});
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
