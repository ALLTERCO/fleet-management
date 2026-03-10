import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

// ---------------------------------------------------------------------------
// Tests for device.list performance optimizations (Phase 12C).
//
// We replicate the cache logic inline (same pattern as heartbeatChunking.test.ts)
// to avoid pulling in ShellyEvents / Commander / PostgresProvider dependencies.
// ---------------------------------------------------------------------------

// ── Mock device matching AbstractDevice.toJSON shape ──────────────────────

interface MockDeviceExternal {
    shellyID: string;
    id: number;
    source: string | null;
    info: Record<string, any>;
    status: Record<string, any>;
    presence: 'online' | 'offline';
    settings: Record<string, any>;
    entities: string[];
    meta: Record<string, any>;
}

class MockDevice {
    shellyID: string;
    id: number;
    presence: 'online' | 'offline';
    source: string | null;
    info: Record<string, any>;
    status: Record<string, any>;
    config: Record<string, any>;

    // toJSON cache — mirrors AbstractDevice
    #jsonCache: MockDeviceExternal | null = null;
    #jsonVersion = 0;
    #currentVersion = 1;

    constructor(shellyID: string, id: number) {
        this.shellyID = shellyID;
        this.id = id;
        this.presence = 'online';
        this.source = 'ws';
        this.info = {
            id: shellyID,
            mac: 'AABBCCDDEEFF',
            model: 'SHSW-25',
            gen: 2,
            fw_id: '20240101-000000/1.0.0',
            ver: '1.0.0',
            app: 'Pro2PM'
        };
        this.status = {
            'switch:0': {output: true, apower: 100, voltage: 230},
            'switch:1': {output: false, apower: 0, voltage: 230},
            sys: {uptime: 12345, ram_free: 50000}
        };
        this.config = {
            'switch:0': {name: 'Light', auto_off: true},
            'switch:1': {name: 'Fan', auto_off: false}
        };
    }

    setStatus(status: Record<string, any>) {
        Object.assign(this.status, status);
        this.#currentVersion++;
    }

    setPresence(presence: 'online' | 'offline') {
        this.presence = presence;
        this.#currentVersion++;
    }

    toJSON(): MockDeviceExternal {
        if (this.#jsonCache && this.#jsonVersion === this.#currentVersion) {
            return this.#jsonCache;
        }

        const result: MockDeviceExternal = {
            shellyID: this.shellyID,
            id: this.id,
            source: this.source,
            info: this.info,
            status: this.status,
            presence: this.presence,
            settings: this.config,
            entities: [],
            meta: {lastReportTs: Date.now()}
        };

        this.#jsonCache = result;
        this.#jsonVersion = this.#currentVersion;
        return result;
    }
}

function createDevices(count: number): MockDevice[] {
    return Array.from(
        {length: count},
        (_, i) =>
            new MockDevice(`shellyplus2pm-${String(i).padStart(6, '0')}`, i)
    );
}

// ── toJSON cache tests ────────────────────────────────────────────────────

describe('toJSON cache', () => {
    it('returns the same reference on cache hit', () => {
        const device = new MockDevice('shelly-test', 1);
        const first = device.toJSON();
        const second = device.toJSON();
        assert.equal(
            first,
            second,
            'should return exact same object reference'
        );
    });

    it('returns a new object after mutation', () => {
        const device = new MockDevice('shelly-test', 1);
        const first = device.toJSON();

        device.setStatus({'switch:0': {output: false}});
        const second = device.toJSON();

        assert.notEqual(
            first,
            second,
            'should return different object after mutation'
        );
        assert.equal(
            first.shellyID,
            second.shellyID,
            'shellyID should be unchanged'
        );
    });

    it('invalidates on presence change', () => {
        const device = new MockDevice('shelly-test', 1);
        const first = device.toJSON();

        device.setPresence('offline');
        const second = device.toJSON();

        assert.notEqual(first, second);
        assert.equal(second.presence, 'offline');
    });

    it('cache hit is faster than cache miss', () => {
        const device = new MockDevice('shelly-test', 1);
        // Warm cache
        device.toJSON();

        // Measure cache hit (1000 calls)
        const t0 = performance.now();
        for (let i = 0; i < 1000; i++) {
            device.toJSON();
        }
        const cacheHitMs = performance.now() - t0;

        // Measure cache miss (1000 calls with invalidation each time)
        const t1 = performance.now();
        for (let i = 0; i < 1000; i++) {
            device.setStatus({'switch:0': {apower: i}});
            device.toJSON();
        }
        const cacheMissMs = performance.now() - t1;

        // Cache hits should be significantly faster
        assert.ok(
            cacheHitMs < cacheMissMs,
            `cache hit (${cacheHitMs.toFixed(2)}ms) should be faster than miss (${cacheMissMs.toFixed(2)}ms)`
        );
    });
});

// ── Bulk toJSON + stringify tests ─────────────────────────────────────────

describe('bulk toJSON + JSON.stringify performance', () => {
    it('1000 devices toJSON (cache hit) under 5ms', () => {
        const devices = createDevices(1000);
        // Warm all caches
        for (const d of devices) d.toJSON();

        const t0 = performance.now();
        for (const d of devices) d.toJSON();
        const elapsed = performance.now() - t0;

        assert.ok(
            elapsed < 5,
            `1000 cached toJSON calls took ${elapsed.toFixed(2)}ms (expected <5ms)`
        );
    });

    it('1000 devices toJSON (cache miss) under 50ms', () => {
        const devices = createDevices(1000);
        // Invalidate all caches
        for (const d of devices) d.setStatus({'switch:0': {apower: 99}});

        const t0 = performance.now();
        const results = devices.map((d) => d.toJSON());
        const elapsed = performance.now() - t0;

        assert.equal(results.length, 1000);
        assert.ok(
            elapsed < 50,
            `1000 uncached toJSON calls took ${elapsed.toFixed(2)}ms (expected <50ms)`
        );
    });

    it('1000 devices JSON.stringify on cached objects under 100ms', () => {
        const devices = createDevices(1000);
        const jsons = devices.map((d) => d.toJSON());

        const t0 = performance.now();
        const strings = jsons.map((j) => JSON.stringify(j));
        const elapsed = performance.now() - t0;

        assert.equal(strings.length, 1000);
        assert.ok(
            elapsed < 100,
            `1000 JSON.stringify calls took ${elapsed.toFixed(2)}ms (expected <100ms)`
        );
    });
});

// ── Per-user filtered device cache tests ──────────────────────────────────

describe('per-user filtered device cache (device.list)', () => {
    const CACHE_TTL_MS = 5_000;

    it('second page reuses cached filtered list', () => {
        const cache = new Map<string, {devices: MockDevice[]; ts: number}>();
        const allDevices = createDevices(5000);
        const username = 'testuser';

        // Simulate filterAccessibleDevices (allow odd IDs only)
        function filterDevices(devices: MockDevice[]): MockDevice[] {
            return devices.filter((d) => d.id % 2 === 1);
        }

        // Page 1: cache miss
        const t0 = performance.now();
        let filtered: MockDevice[];
        const cached = cache.get(username);
        const now = Date.now();
        if (cached && now - cached.ts < CACHE_TTL_MS) {
            filtered = cached.devices;
        } else {
            filtered = filterDevices(allDevices);
            cache.set(username, {devices: filtered, ts: now});
        }
        const page1 = filtered.slice(0, 1000).map((d) => d.toJSON());
        const firstPageMs = performance.now() - t0;

        // Page 2: cache hit
        const t1 = performance.now();
        const cached2 = cache.get(username);
        const now2 = Date.now();
        let filtered2: MockDevice[];
        if (cached2 && now2 - cached2.ts < CACHE_TTL_MS) {
            filtered2 = cached2.devices;
        } else {
            filtered2 = filterDevices(allDevices);
            cache.set(username, {devices: filtered2, ts: now2});
        }
        const page2 = filtered2.slice(1000, 2000).map((d) => d.toJSON());
        const secondPageMs = performance.now() - t1;

        assert.equal(page1.length, 1000);
        assert.equal(page2.length, 1000);
        // Cache hit should skip filterDevices entirely
        assert.equal(
            filtered,
            filtered2,
            'should reuse the same array reference'
        );
    });

    it('cache expires after TTL', () => {
        const cache = new Map<string, {devices: MockDevice[]; ts: number}>();
        const devices = createDevices(100);
        const username = 'testuser';

        // Populate cache with a stale timestamp
        cache.set(username, {devices, ts: Date.now() - CACHE_TTL_MS - 1});

        const cached = cache.get(username);
        const now = Date.now();
        const isStale = !cached || now - cached.ts >= CACHE_TTL_MS;

        assert.ok(isStale, 'cache entry should be considered stale after TTL');
    });

    it('stale entries are evicted on access', () => {
        const cache = new Map<string, {devices: MockDevice[]; ts: number}>();

        // Add entries — some stale, some fresh
        cache.set('stale1', {
            devices: [],
            ts: Date.now() - CACHE_TTL_MS - 1000
        });
        cache.set('stale2', {devices: [], ts: Date.now() - CACHE_TTL_MS - 500});
        cache.set('fresh', {devices: [], ts: Date.now()});

        assert.equal(cache.size, 3);

        // Eviction logic (mirrors DeviceComponent.ts)
        const now = Date.now();
        for (const [k, v] of cache) {
            if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
        }

        assert.equal(cache.size, 1, 'only fresh entry should remain');
        assert.ok(cache.has('fresh'));
    });

    it('different users get separate cache entries', () => {
        const cache = new Map<string, {devices: MockDevice[]; ts: number}>();
        const allDevices = createDevices(100);

        // User A can see odd devices
        const userADevices = allDevices.filter((d) => d.id % 2 === 1);
        cache.set('userA', {devices: userADevices, ts: Date.now()});

        // User B can see even devices
        const userBDevices = allDevices.filter((d) => d.id % 2 === 0);
        cache.set('userB', {devices: userBDevices, ts: Date.now()});

        assert.equal(cache.get('userA')!.devices.length, 50);
        assert.equal(cache.get('userB')!.devices.length, 50);
        assert.notEqual(
            cache.get('userA')!.devices,
            cache.get('userB')!.devices
        );
    });
});

// ── Hierarchical log level filter tests ───────────────────────────────────

describe('hierarchical log level filter', () => {
    type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'FATAL' | 'MARK';
    type LogFilter = LogLevel | 'ALL';

    const LEVEL_SEVERITY: Record<LogLevel, number> = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        FATAL: 4,
        MARK: 5
    };

    interface LogEntry {
        level: LogLevel;
        message: string;
    }

    function filterLogs(logs: LogEntry[], filter: LogFilter): LogEntry[] {
        if (filter === 'ALL') return logs;
        const minSeverity = LEVEL_SEVERITY[filter as LogLevel] ?? 0;
        return logs.filter((log) => LEVEL_SEVERITY[log.level] >= minSeverity);
    }

    const testLogs: LogEntry[] = [
        {level: 'DEBUG', message: 'debug msg'},
        {level: 'INFO', message: 'info msg'},
        {level: 'WARN', message: 'warn msg'},
        {level: 'ERROR', message: 'error msg'},
        {level: 'FATAL', message: 'fatal msg'}
    ];

    it('ALL returns all logs', () => {
        assert.equal(filterLogs(testLogs, 'ALL').length, 5);
    });

    it('DEBUG returns all logs (severity >= 0)', () => {
        const result = filterLogs(testLogs, 'DEBUG');
        assert.equal(result.length, 5);
    });

    it('INFO filters out DEBUG', () => {
        const result = filterLogs(testLogs, 'INFO');
        assert.equal(result.length, 4);
        assert.ok(result.every((l) => l.level !== 'DEBUG'));
    });

    it('WARN shows WARN + ERROR + FATAL', () => {
        const result = filterLogs(testLogs, 'WARN');
        assert.equal(result.length, 3);
        const levels = result.map((l) => l.level);
        assert.deepEqual(levels, ['WARN', 'ERROR', 'FATAL']);
    });

    it('ERROR shows ERROR + FATAL', () => {
        const result = filterLogs(testLogs, 'ERROR');
        assert.equal(result.length, 2);
        const levels = result.map((l) => l.level);
        assert.deepEqual(levels, ['ERROR', 'FATAL']);
    });

    it('FATAL shows only FATAL', () => {
        const result = filterLogs(testLogs, 'FATAL');
        assert.equal(result.length, 1);
        assert.equal(result[0].level, 'FATAL');
    });
});
