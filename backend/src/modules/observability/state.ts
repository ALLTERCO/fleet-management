import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import {BoundedMap} from '../boundedMap';
import type {EdgeCounter, ModuleRegistration, RpcMethodStats} from './types';

const logger = getLogger('observability');
const METRIC_KEY_LIMIT = tuning.observability.metricKeyLimit;

export interface LabeledSeries {
    name: string;
    labels: Record<string, string>;
    value: number;
}

interface LabeledSeriesMapOptions {
    /** Max distinct label-sets retained per metric name. */
    perNameMax: number;
    /** Max distinct metric names tracked, LRU. */
    nameMax: number;
    /** Counters: fold label-sets beyond the cap into one `overflow="other"`
     *  bucket so the series stays monotonic. Gauges: false (can't be summed),
     *  so excess is LRU-evicted within its own name group. */
    overflowExcess: boolean;
}

// Per-metric-name bounded store: isolating each name's label-sets stops a
// high-cardinality series from evicting core series or breaking rate().
export class LabeledSeriesMap {
    readonly #perNameMax: number;
    readonly #overflowExcess: boolean;
    readonly #groups: BoundedMap<string, BoundedMap<string, LabeledSeries>>;

    constructor(options: LabeledSeriesMapOptions) {
        this.#perNameMax = Math.max(2, options.perNameMax);
        this.#overflowExcess = options.overflowExcess;
        this.#groups = new BoundedMap({maxSize: options.nameMax});
    }

    get(key: string): LabeledSeries | undefined {
        const name = nameOfKey(key);
        if (name === undefined) return undefined;
        return this.#groups.get(name)?.get(key);
    }

    set(key: string, series: LabeledSeries): void {
        let group = this.#groups.get(series.name);
        if (!group) {
            // +1 reserves a slot for the overflow bucket so it never evicts a
            // real series; real-series admission is still gated at perNameMax.
            group = new BoundedMap({maxSize: this.#perNameMax + 1});
            this.#groups.set(series.name, group);
        }
        // Known key updates in place; never trips the cap.
        if (group.has(key)) {
            group.set(key, series);
            return;
        }
        if (group.size >= this.#perNameMax) {
            this.#admitBeyondCap(group, series);
            return;
        }
        group.set(key, series);
    }

    readonly #cappedNames = new Set<string>();

    #admitBeyondCap(
        group: BoundedMap<string, LabeledSeries>,
        series: LabeledSeries
    ): void {
        if (!this.#overflowExcess) {
            // Gauges can't fold into an overflow bucket, so excess label-sets
            // are LRU-evicted. Warn once per name so the drop isn't silent.
            if (!this.#cappedNames.has(series.name)) {
                this.#cappedNames.add(series.name);
                logger.warn(
                    'metric %s exceeded its %d label-set cap; oldest label-sets dropped',
                    series.name,
                    this.#perNameMax
                );
            }
            group.set(makeKey(series.name, series.labels), series);
            return;
        }
        const overflowLabels = {overflow: 'other'};
        const overflowKey = makeKey(series.name, overflowLabels);
        const existing = group.get(overflowKey);
        group.set(overflowKey, {
            name: series.name,
            labels: overflowLabels,
            value: (existing?.value ?? 0) + series.value
        });
    }

    *values(): IterableIterator<LabeledSeries> {
        for (const group of this.#groups.values())
            for (const series of group.values()) yield series;
    }

    *entries(): IterableIterator<[string, LabeledSeries]> {
        for (const group of this.#groups.values())
            for (const [key, series] of group.entries()) yield [key, series];
    }

    clear(): void {
        this.#groups.clear();
    }

    get size(): number {
        let total = 0;
        for (const group of this.#groups.values()) total += group.size;
        return total;
    }
}

// Keys are JSON.stringify({name, labels}); recover the name for group lookup.
function nameOfKey(key: string): string | undefined {
    try {
        const parsed = JSON.parse(key) as {name?: unknown};
        return typeof parsed.name === 'string' ? parsed.name : undefined;
    } catch {
        return undefined;
    }
}

function makeKey(name: string, labels: Record<string, string>): string {
    return JSON.stringify({name, labels});
}

// Metric maps — bounded to cap cardinality under dynamic method names.
export const rpcTimings = new BoundedMap<string, RpcMethodStats>({
    maxSize: METRIC_KEY_LIMIT
});
export const dbTimings = new BoundedMap<string, RpcMethodStats>({
    maxSize: METRIC_KEY_LIMIT
});
export const counters = new BoundedMap<string, number>({
    maxSize: METRIC_KEY_LIMIT
});
// Label values are device-influenced; excess label-sets fold into an overflow
// bucket so the counter stays monotonic for rate().
export const labeledCounters = new LabeledSeriesMap({
    perNameMax: tuning.observability.labeledSeriesPerNameMax,
    nameMax: tuning.observability.labeledNameMax,
    overflowExcess: true
});
export const gauges = new BoundedMap<string, number>({
    maxSize: METRIC_KEY_LIMIT
});
// Gauges can't be summed, so excess label-sets are LRU-evicted within their
// own name group rather than folded; isolation still protects core series.
export const labeledGauges = new LabeledSeriesMap({
    perNameMax: tuning.observability.labeledSeriesPerNameMax,
    nameMax: tuning.observability.labeledNameMax,
    overflowExcess: false
});
export const modules = new Map<string, ModuleRegistration>();
export const edgeCounters: EdgeCounter[] = [];
