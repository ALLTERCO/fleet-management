import type {ApiLocation} from '@/stores/locations';
import type {ShellyDeviceExternal} from '@/types';
import type {LocationKpiSnapshot} from '@/types/focusCard';

/** Empty subtree → real zeros for counts; null for fields without a data
 *  source. Callers MUST render null as "—" so users never see fake
 *  confident zeros for metrics the backend cannot supply yet. */
const EMPTY_SNAPSHOT: LocationKpiSnapshot = Object.freeze({
    total: 0,
    on: 0,
    off: 0,
    warn: 0,
    powerKW: 0,
    todayKWh: null,
    alerts: null,
    lastSeenTs: 0,
    savingsPotentialPct: 0,
    firmwareHealthPct: 0,
    signalHealthPct: 0
});

const SEMVER_FLOOR = '0.0.0';
const HEALTHY_RSSI_DBM = -75;

/** Fields the rollup actually reads. The internal device shape from the
 *  store (`shelly_device_t`) carries all of them with the same names, so
 *  callers can pass either without a cast. */
export type RollupDevice = Pick<
    ShellyDeviceExternal,
    'id' | 'presence' | 'status' | 'info' | 'locationId' | '_statusTs'
>;

export interface RollupInput {
    readonly location: ApiLocation;
    readonly devicesIndex: Readonly<Record<string, RollupDevice>>;
    readonly descendantLocationIds: ReadonlySet<number>;
}

export interface MemoisedRollupInput extends RollupInput {
    readonly devicesRevision: number;
}

function collectDevicesInSubtree(
    devicesIndex: Readonly<Record<string, RollupDevice>>,
    descendantLocationIds: ReadonlySet<number>
): RollupDevice[] {
    return Object.values(devicesIndex).filter(
        (d) => d.locationId != null && descendantLocationIds.has(d.locationId)
    );
}

function isOnline(device: RollupDevice): boolean {
    return device.presence === 'online';
}

function hasWarning(device: RollupDevice): boolean {
    // Devices with pending presence are in an uncertain state
    return device.presence === 'pending';
}

function deviceStatus(device: RollupDevice): Record<string, unknown> | null {
    const s = (device as {status?: unknown}).status;
    return s && typeof s === 'object' && !Array.isArray(s)
        ? (s as Record<string, unknown>)
        : null;
}

function componentPowerW(component: unknown): number {
    if (!component || typeof component !== 'object') return 0;
    const c = component as Record<string, unknown>;
    if (typeof c.apower === 'number' && Number.isFinite(c.apower))
        return c.apower;
    if (
        typeof c.total_act_power === 'number' &&
        Number.isFinite(c.total_act_power)
    )
        return c.total_act_power;
    return 0;
}

function devicePowerW(device: RollupDevice): number {
    const status = deviceStatus(device);
    if (!status) return 0;
    return Object.values(status).reduce<number>(
        (sum, v) => sum + componentPowerW(v),
        0
    );
}

function sumPowerKW(devices: RollupDevice[]): number {
    let total = 0;
    for (const d of devices) total += devicePowerW(d);
    return total / 1000;
}

function deviceLastSeenTsMs(device: RollupDevice): number {
    const status = deviceStatus(device);
    const direct = (device as {_statusTs?: unknown})._statusTs;
    // _statusTs is already in ms
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
    const sys = status?.sys;
    if (sys && typeof sys === 'object') {
        const ts = (sys as Record<string, unknown>).unixtime;
        if (typeof ts === 'number' && Number.isFinite(ts)) return ts * 1000;
    }
    return 0;
}

function maxLastSeen(devices: RollupDevice[]): number {
    return devices.reduce((max, d) => Math.max(max, deviceLastSeenTsMs(d)), 0);
}

/** Parse a semver string into a numeric tuple for comparison. */
function parseSemver(ver: string): [number, number, number] {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(ver);
    if (!m) return [0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 when a < b, 0 when equal, 1 when a > b */
function compareSemver(a: string, b: string): number {
    const [aMaj, aMin, aPatch] = parseSemver(a);
    const [bMaj, bMin, bPatch] = parseSemver(b);
    if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
    if (aMin !== bMin) return aMin > bMin ? 1 : -1;
    if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
    return 0;
}

function latestFirmwareVersion(devices: RollupDevice[]): string {
    let latest = SEMVER_FLOOR;
    for (const d of devices) {
        const ver: unknown = d.info?.ver;
        if (typeof ver !== 'string' || !ver) continue;
        if (compareSemver(ver, latest) > 0) latest = ver;
    }
    return latest;
}

function firmwareHealthPct(devices: RollupDevice[]): number {
    if (devices.length === 0) return 0;
    const latest = latestFirmwareVersion(devices);
    let count = 0;
    for (const d of devices) {
        const ver: unknown = d.info?.ver;
        if (typeof ver === 'string' && ver && compareSemver(ver, latest) === 0)
            count += 1;
    }
    return (count / devices.length) * 100;
}

function deviceRssi(device: RollupDevice): number | null {
    const wifi = deviceStatus(device)?.wifi;
    if (!wifi || typeof wifi !== 'object') return null;
    const rssi = (wifi as Record<string, unknown>).rssi;
    return typeof rssi === 'number' && Number.isFinite(rssi) ? rssi : null;
}

function signalHealthPct(devices: RollupDevice[]): number {
    if (devices.length === 0) return 0;
    let healthy = 0;
    for (const d of devices) {
        const rssi = deviceRssi(d);
        if (rssi != null && rssi >= HEALTHY_RSSI_DBM) healthy += 1;
    }
    return (healthy / devices.length) * 100;
}

/** Backend ships AI-savings hints under `statusSummary.savingsPotentialPct`.
 *  The shared device type doesn't declare the field yet (Agent 1 territory),
 *  so we narrow defensively through a single typed accessor — no `as any`. */
interface DeviceWithSavingsSummary {
    readonly statusSummary?: {
        readonly savingsPotentialPct?: number;
    };
}

function deviceSavingsPotentialPct(device: RollupDevice): number {
    const summary = (device as RollupDevice & DeviceWithSavingsSummary)
        .statusSummary;
    const pct = summary?.savingsPotentialPct;
    return typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
}

function weightedSavingsPotentialPct(devices: RollupDevice[]): number {
    if (devices.length === 0) return 0;
    let weightedSum = 0;
    let totalWeight = 0;
    for (const d of devices) {
        const power = devicePowerW(d);
        const weight = power > 0 ? power : 1;
        weightedSum += deviceSavingsPotentialPct(d) * weight;
        totalWeight += weight;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

export function rollupLocationKpis(input: RollupInput): LocationKpiSnapshot {
    const devices = collectDevicesInSubtree(
        input.devicesIndex,
        input.descendantLocationIds
    );
    if (devices.length === 0) return EMPTY_SNAPSHOT;
    return {
        total: devices.length,
        on: devices.filter(isOnline).length,
        off: devices.filter((d) => !isOnline(d)).length,
        warn: devices.filter(hasWarning).length,
        powerKW: sumPowerKW(devices),
        todayKWh: null,
        alerts: null,
        lastSeenTs: maxLastSeen(devices),
        savingsPotentialPct: weightedSavingsPotentialPct(devices),
        firmwareHealthPct: firmwareHealthPct(devices),
        signalHealthPct: signalHealthPct(devices)
    };
}

/** Long-lived SPAs can focus thousands of distinct locations across a
 *  session. Bound the cache to the most recently used N so memory stays
 *  flat — `Map` preserves insertion order, which is good enough LRU for
 *  our needs. */
const MEMO_CACHE_MAX = 100;
const memoCache = new Map<number, {key: string; value: LocationKpiSnapshot}>();

interface MemoEntry {
    readonly key: string;
    readonly value: LocationKpiSnapshot;
}

/** Read without mutation. ANSWER-only — does not bump recency. */
function peekMemo(locationId: number, key: string): MemoEntry | null {
    const hit = memoCache.get(locationId);
    return hit && hit.key === key ? hit : null;
}

/** Insert or refresh, evicting the oldest entries when over capacity. */
function writeMemo(locationId: number, entry: MemoEntry): void {
    memoCache.delete(locationId);
    memoCache.set(locationId, entry);
    if (memoCache.size > MEMO_CACHE_MAX) evictOldest();
}

function evictOldest(): void {
    while (memoCache.size > MEMO_CACHE_MAX) {
        const oldest = memoCache.keys().next().value;
        if (oldest === undefined) return;
        memoCache.delete(oldest);
    }
}

export function rollupLocationKpisMemoised(input: {
    readonly location: ApiLocation;
    readonly devicesIndex: Readonly<Record<string, RollupDevice>>;
    readonly descendantLocationIds: ReadonlySet<number>;
    readonly devicesRevision: number;
}): LocationKpiSnapshot {
    const key = [
        Object.keys(input.devicesIndex).length,
        input.descendantLocationIds.size,
        input.devicesRevision
    ].join(':');
    const hit = peekMemo(input.location.id, key);
    if (hit) {
        writeMemo(input.location.id, hit); // bump recency on cache hit
        return hit.value;
    }
    const value = rollupLocationKpis({
        location: input.location,
        devicesIndex: input.devicesIndex,
        descendantLocationIds: input.descendantLocationIds
    });
    writeMemo(input.location.id, {key, value});
    return value;
}

/** Test-only: drop the memoisation cache. Production code never needs this. */
export function clearLocationKpiRollupCache(): void {
    memoCache.clear();
}
