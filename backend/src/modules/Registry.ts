import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import log4js from 'log4js';
import {tuning} from '../config';
import {dashboardDefaults} from '../config/dashboardDefaults';
import {BoundedMap} from './boundedMap';
import * as Observability from './Observability';
import {callMethod} from './PostgresProvider';
import {withTimeout} from './util/withTimeout';

const logger = log4js.getLogger('registry');

// ── In-memory caches ──────────────────────────────────────────────────
// Bounded so a multi-tenant SaaS instance does not leak cache entries
// forever. LRU evicts oldest; TTL is a safety net for missed invalidation.
const FILE_CACHE_MAX = 64;
const DB_RESULT_CACHE_MAX = 10_000;
const DB_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;

const fileCache = new BoundedMap<string, Record<string, any>>({
    maxSize: FILE_CACHE_MAX
});
const fileRegistryWriteQueues = new Map<string, Promise<void>>();
// Keyed by "<registry>.<key>" for org-independent actions, or
// "<registry>.<key>:<organizationId>" for org-scoped fetches. The org
// suffix prevents one tenant's data leaking into the next tenant's read.
const dbResultCache = new BoundedMap<string, any>({
    maxSize: DB_RESULT_CACHE_MAX,
    ttlMs: DB_RESULT_CACHE_TTL_MS
});

function cacheKey(cc: string, organizationId?: string): string {
    return organizationId ? `${cc}:${organizationId}` : cc;
}

// Cross-module cache invalidation. When organizationId is provided,
// drops the matching per-tenant entry only. When omitted, drops the
// legacy un-keyed entry plus every per-tenant entry under that base.
export function invalidateDbCache(key: string, organizationId?: string): void {
    if (organizationId) {
        dbResultCache.delete(cacheKey(key, organizationId));
        return;
    }
    dbResultCache.delete(key);
    const prefix = `${key}:`;
    for (const k of dbResultCache.keys()) {
        if (k.startsWith(prefix)) dbResultCache.delete(k);
    }
}

const actions = {
    // ui.dashboards block removed — see DashboardComponent / DashboardRegistry.
    'ui.menuItems': {
        async fetch() {
            const {rows} = await callMethod('ui.fn_menuitem_fetch', {});
            return rows.map(
                (r: {
                    id: number;
                    name: string;
                    url: string;
                    icon_path: string;
                }) => ({
                    id: r.id.toString(),
                    name: r.name,
                    link: r.url,
                    icon: r.icon_path
                })
            );
        },

        async add({
            name,
            link,
            icon
        }: {
            name: string;
            link: string;
            icon: string;
        }) {
            await callMethod('ui.fn_menuitem_add', {
                p_name: name,
                p_url: link,
                p_icon_path: icon
            });
            return this.fetch();
        },

        async update({
            id,
            name,
            link,
            icon
        }: {
            id: number;
            name: string;
            link: string;
            icon: string;
        }) {
            await callMethod('ui.fn_menuitem_update', {
                p_id: id,
                p_name: name,
                p_url: link,
                p_icon_path: icon
            });
            return this.fetch();
        },

        async remove({link}: {link: string}) {
            await callMethod('ui.fn_menuitem_remove', {p_url: link});
            return this.fetch();
        }
    },
    'ui.config': {
        async fetch() {
            const {rows} = await callMethod('ui.fn_config_fetch', {});
            return rows;
        }
    },

    'ui.dashboardSettings': {
        async fetch({dashboardId}: {dashboardId: number}) {
            const {rows} = await callMethod('ui.fn_dashboard_settings_fetch', {
                p_dashboard_id: dashboardId
            });
            const settings = rows?.[0];
            if (!settings) {
                const d = dashboardDefaults();
                return {
                    dashboardId,
                    tariff: d.tariff,
                    currency: d.currency,
                    defaultRange: d.defaultRange,
                    refreshInterval: d.refreshIntervalMs,
                    enabledMetrics: [...d.enabledMetrics],
                    chartSettings: {}
                };
            }
            return {
                dashboardId,
                tariff: settings.tariff,
                currency: settings.currency,
                defaultRange: settings.default_range,
                refreshInterval: settings.refresh_interval,
                enabledMetrics: settings.enabled_metrics,
                chartSettings: settings.chart_settings
            };
        },

        async update({
            dashboardId,
            tariff,
            currency,
            defaultRange,
            refreshInterval,
            enabledMetrics,
            chartSettings
        }: {
            dashboardId: number;
            tariff?: number;
            currency?: string;
            defaultRange?: string;
            refreshInterval?: number;
            enabledMetrics?: string[];
            chartSettings?: Record<string, any>;
        }) {
            await callMethod('ui.fn_dashboard_settings_update', {
                p_dashboard_id: dashboardId,
                p_tariff: tariff ?? null,
                p_currency: currency ?? null,
                p_default_range: defaultRange ?? null,
                p_refresh_interval: refreshInterval ?? null,
                p_enabled_metrics: enabledMetrics
                    ? JSON.stringify(enabledMetrics)
                    : null,
                p_chart_settings: chartSettings
                    ? JSON.stringify(chartSettings)
                    : null
            });
            return this.fetch({dashboardId});
        }
    },

    'actions.rpc': {
        async fetch(opts?: {organizationId?: string}) {
            const {rows} = await callMethod(
                'ui.fn_dashboard_item_action_fetch',
                {p_organization_id: opts?.organizationId ?? null}
            );
            return rows.map((r: {id: number; name: string; udf: any}) => {
                // Support both old format (udf is actions array) and
                // new format (udf is {actions, icon} wrapper)
                const udf = r.udf;
                if (Array.isArray(udf)) {
                    return {
                        id: r.id.toString(),
                        name: r.name,
                        type: 'action' as const,
                        actions: udf
                    };
                }
                return {
                    id: r.id.toString(),
                    name: r.name,
                    type: 'action' as const,
                    actions: udf?.actions ?? [],
                    icon: udf?.icon ?? undefined
                };
            });
        },
        async add({
            organizationId,
            name,
            actions,
            icon
        }: {
            organizationId: string;
            name: string;
            actions: any;
            icon?: string;
        }) {
            let parsed: any;
            try {
                parsed =
                    typeof actions === 'string' ? JSON.parse(actions) : actions;
            } catch {
                throw new Error('Invalid actions JSON');
            }
            const udf = icon ? {actions: parsed, icon} : parsed;
            await callMethod('ui.fn_dashboard_item_action_add', {
                p_organization_id: organizationId,
                p_name: name,
                p_udf: udf
            });
            return this.fetch({organizationId});
        },
        async update({
            organizationId,
            id,
            name,
            actions,
            icon
        }: {
            organizationId: string;
            id: number;
            name: string;
            actions: any;
            icon?: string;
        }) {
            let parsed: any;
            try {
                parsed =
                    typeof actions === 'string' ? JSON.parse(actions) : actions;
            } catch {
                throw new Error('Invalid actions JSON');
            }
            const udf = icon ? {actions: parsed, icon} : parsed;
            await callMethod('ui.fn_dashboard_item_action_update', {
                p_organization_id: organizationId,
                p_id: id,
                p_name: name,
                p_udf: udf
            });
            return this.fetch({organizationId});
        },
        async remove({
            organizationId,
            id
        }: {
            organizationId: string;
            id: number;
        }) {
            await callMethod('ui.fn_dashboard_item_action_remove', {
                p_organization_id: organizationId,
                p_id: id
            });
            return this.fetch({organizationId});
        }
    }
} as Record<string, any>;

export const REGISTRY_FOLDER = path.join(__dirname, '../../cfg/registry');
const UNSAFE_REGISTRY_PATH_CHARS = /[:/\\]/g;

function getRegistryPath(name: string) {
    const safe = name.replace(UNSAFE_REGISTRY_PATH_CHARS, '_');
    return path.join(REGISTRY_FOLDER, `${safe}.json`);
}

function registryExists(path: string) {
    return (
        fs.existsSync(REGISTRY_FOLDER) &&
        fs.statSync(REGISTRY_FOLDER).isDirectory() &&
        fs.existsSync(path)
    );
}

async function loadRegistry(name: string): Promise<Record<string, any>> {
    // Check in-memory cache first (avoids disk I/O)
    const cached = fileCache.get(name);
    if (cached) return cached;

    const registryPath = getRegistryPath(name);
    if (!registryExists(registryPath)) {
        logger.debug('registry %s not found, returning empty', name);
        const empty = {};
        fileCache.set(name, empty);
        return empty;
    }
    try {
        const contents = await fsPromises.readFile(registryPath, 'utf-8');
        const registry = JSON.parse(contents);
        if (typeof registry === 'object') {
            fileCache.set(name, registry);
            return registry;
        }
    } catch (error) {
        logger.warn('registry %s cannot be parsed', name, error);
        try {
            await saveRegistry(name, {}, true);
        } catch (_e) {
            logger.warn('registry %s cannot be parsed', name, error);
        }
        return {};
    }

    logger.warn('registry %s is of the wrong format', name);
    return {};
}

async function saveRegistry(name: string, content: any, backupFirst = false) {
    const registryPath = getRegistryPath(name);
    const tempPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
    await fsPromises.mkdir(REGISTRY_FOLDER, {recursive: true});
    if (backupFirst) {
        try {
            await fsPromises.rename(
                registryPath,
                `${registryPath}.${Date.now()}.back`
            );
        } catch (error) {
            logger.warn('failed to rename registry %s', name, error);
        }
    }
    try {
        await fsPromises.writeFile(
            tempPath,
            JSON.stringify(content, undefined, 4),
            'utf-8'
        );
        await fsPromises.rename(tempPath, registryPath);
        fileCache.set(name, content);
    } catch (error) {
        await deleteRegistryTempFile(tempPath);
        throw error;
    }
}

async function deleteRegistryTempFile(tempPath: string): Promise<void> {
    try {
        await fsPromises.unlink(tempPath);
    } catch (error) {
        logger.debug('failed to remove temp registry file %s', tempPath, error);
    }
}

async function withFileRegistryWriteLock<T>(
    name: string,
    task: () => Promise<T>
): Promise<T> {
    const previous = fileRegistryWriteQueues.get(name) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
    });
    const tail = previous.then(
        () => current,
        () => current
    );
    fileRegistryWriteQueues.set(name, tail);

    await waitForPreviousRegistryWrite(name, previous);

    try {
        return await task();
    } finally {
        releaseCurrent();
        if (fileRegistryWriteQueues.get(name) === tail) {
            fileRegistryWriteQueues.delete(name);
        }
    }
}

async function waitForPreviousRegistryWrite(
    name: string,
    previous: Promise<void>
): Promise<void> {
    try {
        await previous;
    } catch (error) {
        logger.debug(
            'previous registry write for %s finished with error before queue continued',
            name,
            error
        );
    }
}

export async function mutateRegistry<T>(
    name: string,
    mutator: (draft: Record<string, any>) => T | Promise<T>
): Promise<T> {
    return withFileRegistryWriteLock(name, async () => {
        const current = await loadRegistry(name);
        const draft = JSON.parse(JSON.stringify(current)) as Record<
            string,
            any
        >;
        const result = await mutator(draft);
        await saveRegistry(name, draft);
        return result;
    });
}

export async function addToRegistry(
    name: string,
    key: string,
    value: NonNullable<any>,
    organizationId?: string
) {
    const cc: string = `${name}.${key}`;
    if (actions[cc]) {
        const act = actions[cc];
        const ck = cacheKey(cc, organizationId);
        dbResultCache.delete(ck);
        const payload = {...value, organizationId};
        const result =
            value.id !== undefined && value.id !== null
                ? await act.update(payload)
                : await act.add(payload);
        dbResultCache.set(ck, result);
        return result;
    }
    return withFileRegistryWriteLock(name, async () => {
        const data = JSON.parse(
            JSON.stringify(await loadRegistry(name))
        ) as Record<string, any>;
        data[key] = value;
        await saveRegistry(name, data);
        return data;
    });
}

export async function removeFromRegistry(
    name: string,
    key: string,
    value?: unknown,
    organizationId?: string
) {
    const cc: string = `${name}.${key}`;

    if (actions[cc]) {
        if (!value) throw new Error('Missing arguments');
        const ck = cacheKey(cc, organizationId);
        dbResultCache.delete(ck);
        const payload = {...(value as Record<string, unknown>), organizationId};
        const rr = await actions[cc].remove(payload);
        dbResultCache.set(ck, rr);
        return rr;
    }
    return withFileRegistryWriteLock(name, async () => {
        const data = JSON.parse(
            JSON.stringify(await loadRegistry(name))
        ) as Record<string, any>;
        delete data[key];
        await saveRegistry(name, data);
        return data;
    });
}

export async function getFromRegistry(
    name: string,
    key: string,
    organizationId?: string
) {
    const cc: string = `${name}.${key}`;

    if (actions[cc]) {
        const ck = cacheKey(cc, organizationId);
        const cached = dbResultCache.get(ck);
        if (cached !== undefined) return cached;
        const rr = await actions[cc].fetch({organizationId});
        dbResultCache.set(ck, rr);
        return rr;
    }
    const data = await loadRegistry(name);
    return data[key] ?? null;
}

export async function getRegistryKeys(name: string) {
    const registry = await loadRegistry(name);
    return Object.keys(registry);
}

export async function getAll(name: string) {
    return await loadRegistry(name);
}

/**
 * Pre-warm all DB-backed registry caches on startup.
 * Ensures the first client request is a cache hit (no DB query latency).
 */
export async function warmCache(): Promise<void> {
    for (const key of Object.keys(actions)) {
        // Skip actions whose fetch requires arguments (e.g. dashboardSettings
        // needs a dashboardId) — they are per-record lookups, not global lists.
        if (actions[key].fetch.length > 0) {
            logger.debug(
                'skipping cache warm for %s (fetch requires args)',
                key
            );
            continue;
        }
        try {
            // Per-step timeout so a single hung registry fetch can't stall boot.
            const result = await withTimeout(
                () => actions[key].fetch(),
                tuning.redis.warmCacheStepTimeoutMs,
                `registry-warm:${key}`
            );
            dbResultCache.set(key, result);
            logger.info('pre-warmed cache: %s', key);
        } catch (e) {
            logger.warn('failed to pre-warm cache for %s: %s', key, e);
        }
    }
}

Observability.registerModule('registry', {
    stats: () => ({
        fileCacheSize: fileCache.size,
        dbCacheSize: dbResultCache.size
    }),
    topology: {
        role: 'transform',
        cluster: 'ingest',
        zone: 'device_admission',
        upstreams: ['deviceInit'],
        downstreams: [
            'statusQueue',
            'wsCommands',
            'events',
            'emSync',
            'shellyEvents'
        ],
        label: 'Registry',
        description: 'Device registry cache',
        route: '/monitoring/services'
    }
});
