import {readdir, stat} from 'node:fs/promises';
import * as path from 'node:path';
import {
    type IntervalHistogram,
    monitorEventLoopDelay,
    PerformanceObserver
} from 'node:perf_hooks';
import * as log4js from 'log4js';
import {tuning} from '../../config/tuning';
import {safeInterval} from '../util/faultGuard';
import {liveGauge} from './processMetrics';
import type {ObsLevel} from './types';
import {percentile} from './util/percentile';
import {pushRing} from './util/ringBuffer';

const logger = log4js.getLogger('Observability');

let level: ObsLevel = 0;
let lagMs = 0;
let wsClientCount = 0;
let dbWritesDisabled = false;
let lagInterval: ReturnType<typeof setInterval> | undefined;

liveGauge('fm_ws_clients', 'Connected WebSocket clients', () => wsClientCount);
liveGauge('fm_obs_level', 'Current observability level (0-3)', () => level);
liveGauge(
    'fm_db_writes_disabled',
    'Whether hot-path DB writes are disabled (diagnostic mode)',
    () => (dbWritesDisabled ? 1 : 0)
);
liveGauge(
    'fm_redis_disabled',
    'Whether Redis adapter is the null impl (FM_REDIS_DISABLED at boot)',
    () => (tuning.redis.disabled ? 1 : 0)
);

export function getLevel(): ObsLevel {
    return level;
}

export function getLagMs(): number {
    return lagMs;
}

export function getWsClientCount(): number {
    return wsClientCount;
}

export function setWsClientCount(count: number): void {
    wsClientCount = count;
}

export function isDbWritesDisabled(): boolean {
    return dbWritesDisabled;
}

export function setDbWritesDisabled(v: boolean): void {
    dbWritesDisabled = v;
    logger.warn(
        'DB writes %s',
        v ? 'DISABLED (diagnostic mode)' : 'RE-ENABLED'
    );
}

let prevHeapUsed = 0;
let heapTrend: 'growing' | 'stable' | 'shrinking' = 'stable';

export function getHeapTrend(): 'growing' | 'stable' | 'shrinking' {
    return heapTrend;
}

let prevCpuUsage = process.cpuUsage();
let prevCpuTime = Date.now();
let cpuUserPct = 0;
let cpuSystemPct = 0;

export function getCpuUserPct(): number {
    return cpuUserPct;
}

export function getCpuSystemPct(): number {
    return cpuSystemPct;
}

let elHistogram: IntervalHistogram | undefined;

export function getEventLoopHistogram(): IntervalHistogram | undefined {
    return elHistogram;
}

let gcTotalPauseMs = 0;
let gcPauseCount = 0;
let gcMaxPauseMs = 0;
let gcObserver: PerformanceObserver | undefined;

export interface GcStats {
    totalPauseMs: number;
    pauseCount: number;
    maxPauseMs: number;
}

export function getGcStats(): GcStats {
    return {
        totalPauseMs: gcTotalPauseMs,
        pauseCount: gcPauseCount,
        maxPauseMs: gcMaxPauseMs
    };
}

const initDurations: Array<{shellyID: string; durationMs: number; ts: number}> =
    [];

export function recordInitDuration(shellyID: string, durationMs: number): void {
    if (level < 2) return;
    pushRing(
        initDurations,
        {shellyID, durationMs: Math.round(durationMs), ts: Date.now()},
        tuning.observability.initDurationRingSize
    );
}

export interface InitDurationEntry {
    shellyID: string;
    durationMs: number;
    ts: number;
}

export function getInitDurations(): InitDurationEntry[] {
    return [...initDurations];
}

export function resetInitDurations(): void {
    initDurations.length = 0;
}

export interface InitDurationStats {
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    samples: number;
}

export function getInitDurationStats(): InitDurationStats | null {
    if (initDurations.length === 0) return null;
    const values = initDurations.map((d) => d.durationMs);
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        avgMs: Math.round(sum / sorted.length),
        p95Ms: percentile(values, 0.95),
        p99Ms: percentile(values, 0.99),
        maxMs: sorted[sorted.length - 1],
        samples: sorted.length
    };
}

const metricHistory: Array<{ts: number; metrics: unknown}> = [];
let snapshotInterval: ReturnType<typeof setInterval> | undefined;

export function getMetricHistory(): Array<{ts: number; metrics: unknown}> {
    return metricHistory;
}

// Registered indirection breaks the samplers→exporter import cycle.
let snapshotProducer: () => unknown | null = () => null;

export function setSnapshotProducer(produce: () => unknown | null): void {
    snapshotProducer = produce;
}

const DISK_SAMPLE_INTERVAL_MS = 60_000;

const DISK_USAGE_DIRS: Record<string, string> = {
    uploads_backgrounds: path.join('uploads', 'backgrounds'),
    uploads_profile_pics: path.join('uploads', 'profilePics'),
    uploads_report_images: path.join('uploads', 'reportImages'),
    uploads_audit_logs: path.join('uploads', 'audit-logs'),
    data_dir: 'data'
};

const diskUsage: Record<string, number> = {};
let diskUsageInterval: ReturnType<typeof setInterval> | undefined;
let diskSampleInFlight = false;

export function getDiskUsage(): Record<string, number> {
    return diskUsage;
}

async function readDirEntries(dir: string) {
    try {
        return await readdir(dir, {withFileTypes: true});
    } catch {
        return []; // dir doesn't exist yet
    }
}

async function dirSizeBytes(dir: string): Promise<number> {
    let total = 0;
    for (const entry of await readDirEntries(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.isFile()) {
            try {
                total += (await stat(full)).size;
            } catch {
                /* file vanished between readdir and stat */
            }
        } else if (entry.isDirectory()) {
            total += await dirSizeBytes(full);
        }
    }
    return total;
}

async function sampleDiskUsage(): Promise<void> {
    if (diskSampleInFlight) return; // overlap guard: skip if prior walk still running
    diskSampleInFlight = true;
    try {
        for (const [key, rel] of Object.entries(DISK_USAGE_DIRS)) {
            diskUsage[key] = await dirSizeBytes(path.join(process.cwd(), rel));
        }
    } finally {
        diskSampleInFlight = false;
    }
}

// Seed every key at 0 so getDiskUsage() is non-empty immediately, keeping the
// fm_disk_usage_bytes HELP/TYPE in the scrape before the first async walk lands.
function seedDiskUsage(): void {
    for (const key of Object.keys(DISK_USAGE_DIRS)) {
        if (diskUsage[key] === undefined) diskUsage[key] = 0;
    }
}

function startDiskUsageSampling(): void {
    seedDiskUsage();
    void sampleDiskUsage();
    diskUsageInterval = setInterval(() => {
        void sampleDiskUsage();
    }, DISK_SAMPLE_INTERVAL_MS);
    diskUsageInterval.unref();
}

function startLagMeasurement(): void {
    let lastHr = process.hrtime.bigint();
    let tick = 0;
    lagInterval = safeInterval('obs-lag', 1000, () => {
        const now = process.hrtime.bigint();
        const elapsed = Number(now - lastHr) / 1e6;
        lagMs = Math.max(0, elapsed - 1000);
        lastHr = now;

        tick++;
        if (tick >= 30) {
            tick = 0;
            sampleHeapTrend();
            sampleCpuDelta();
        }
    });
    lagInterval.unref();

    elHistogram = monitorEventLoopDelay({resolution: 20});
    elHistogram.enable();

    startGcObserver();
}

function sampleHeapTrend(): void {
    const currentHeap = process.memoryUsage().heapUsed;
    if (prevHeapUsed > 0) {
        const diff = currentHeap - prevHeapUsed;
        const threshold = prevHeapUsed * 0.05;
        if (diff > threshold) heapTrend = 'growing';
        else if (diff < -threshold) heapTrend = 'shrinking';
        else heapTrend = 'stable';
    }
    prevHeapUsed = currentHeap;
}

function sampleCpuDelta(): void {
    const nowCpu = process.cpuUsage(prevCpuUsage);
    const nowTime = Date.now();
    const elapsedMs = nowTime - prevCpuTime;
    if (elapsedMs > 0) {
        cpuUserPct = Math.round((nowCpu.user / 1000 / elapsedMs) * 100);
        cpuSystemPct = Math.round((nowCpu.system / 1000 / elapsedMs) * 100);
    }
    prevCpuUsage = process.cpuUsage();
    prevCpuTime = nowTime;
}

function startGcObserver(): void {
    try {
        gcObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                gcPauseCount++;
                gcTotalPauseMs += entry.duration;
                if (entry.duration > gcMaxPauseMs)
                    gcMaxPauseMs = entry.duration;
            }
        });
        gcObserver.observe({entryTypes: ['gc']});
    } catch {
        // GC observation unavailable in some environments
    }
}

function stopLagMeasurement(): void {
    if (lagInterval) {
        clearInterval(lagInterval);
        lagInterval = undefined;
    }
    lagMs = 0;
    if (elHistogram) {
        elHistogram.disable();
        elHistogram = undefined;
    }
    if (gcObserver) {
        gcObserver.disconnect();
        gcObserver = undefined;
    }
    gcTotalPauseMs = 0;
    gcPauseCount = 0;
    gcMaxPauseMs = 0;
}

function startSnapshotInterval(): void {
    snapshotInterval = safeInterval('obs-snapshot', 5000, () => {
        const m = snapshotProducer();
        if (!m) return;
        pushRing(
            metricHistory,
            {ts: Date.now(), metrics: m},
            tuning.observability.historyRingSize
        );
    });
    snapshotInterval.unref();
}

function stopSnapshotInterval(): void {
    if (snapshotInterval) {
        clearInterval(snapshotInterval);
        snapshotInterval = undefined;
    }
    metricHistory.length = 0;
}

export function setLevel(l: ObsLevel): void {
    const prev = level;
    level = l;
    if (l > 0 && !lagInterval) startLagMeasurement();
    if (l === 0 && lagInterval) stopLagMeasurement();
    if (l > 0 && !snapshotInterval) startSnapshotInterval();
    if (l === 0 && snapshotInterval) stopSnapshotInterval();
    if (l > 0 && !diskUsageInterval) startDiskUsageSampling();
    if (l === 0 && diskUsageInterval) {
        clearInterval(diskUsageInterval);
        diskUsageInterval = undefined;
    }
    if (prev !== l) logger.info('Observability level changed %d → %d', prev, l);
}

export function shutdownSamplers(): void {
    setLevel(0);
    initDurations.length = 0;
}
