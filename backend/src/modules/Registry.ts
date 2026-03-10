import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import log4js from 'log4js';
const logger = log4js.getLogger('registry');
import * as Observability from './Observability';
import {callMethod} from './PostgresProvider';

// ── In-memory caches ──────────────────────────────────────────────────
// File registry cache: avoids fsPromises.readFile on every call
const fileCache = new Map<string, Record<string, any>>();
// DB-backed result cache: avoids redundant PostgreSQL queries
// Keyed by "registry:key" (e.g. "actions:rpc", "ui:dashboards")
const dbResultCache = new Map<string, any>();

const actions = {
    'ui.dashboards': {
        async add({
            name,
            items,
            groupId,
            dashboardType = 'classic'
        }: {
            name: string;
            items?: string[];
            groupId?: number;
            dashboardType?: 'classic' | 'analytics';
        }) {
            const {
                rows: [{fn_dashboard_add: dash}]
            } = await callMethod('ui.fn_dashboard_add', {
                p_name: name,
                p_group_id: groupId ?? null,
                p_dashboard_type: dashboardType
            });
            if (items?.length) {
                await callMethod('ui.fn_dashboard_item_add', {
                    p_dashboard: dash,
                    p_type: 0,
                    p_item: 0,
                    p_order: 0,
                    p_sub_item: 0
                });
            }
            return await actions['ui.dashboards'].fetch();
        },
        async update({
            name,
            items,
            id,
            groupId,
            dashboardType
        }: {
            name: string;
            items?: string[];
            id: number;
            groupId?: number;
            dashboardType?: 'classic' | 'analytics';
        }) {
            await callMethod('ui.fn_dashboard_update', {
                p_name: name,
                p_id: id,
                p_group_id: groupId ?? null,
                p_dashboard_type: dashboardType ?? null
            });
            if (items?.length) {
                await callMethod('ui.fn_dashboard_item_update', {
                    p_dashboard: id,
                    p_type: 0,
                    p_item: 0,
                    p_order: 0,
                    p_sub_item: 0
                });
            }
            return await actions['ui.dashboards'].fetch();
        },
        async remove({id}: {id: number}) {
            await callMethod('ui.fn_dashboard_remove', {p_id: id});
            return await actions['ui.dashboards'].fetch();
        },
        async fetch() {
            const {rows} = await callMethod('ui.fn_dashboard_fetch', {});
            return Promise.all(
                rows.map(
                    async (d: {
                        name: string;
                        id: number;
                        group_id: number | null;
                        dashboard_type: string;
                        items: {type: string; id: number}[];
                    }) => {
                        const {rows: items} = await callMethod(
                            'ui.fn_dashboard_item_fetch',
                            {p_id: d.id}
                        );
                        d.items = items;
                        return d;
                    }
                )
            );
        }
    },
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
            const {
                rows: [{fn_menuitem_add: newId}]
            } = await callMethod('ui.fn_menuitem_add', {
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
                return {
                    dashboardId,
                    tariff: 0,
                    currency: 'EUR',
                    defaultRange: 'last_7_days',
                    refreshInterval: 60000,
                    enabledMetrics: [
                        'voltage',
                        'current',
                        'power',
                        'consumption',
                        'temperature',
                        'humidity',
                        'luminance'
                    ],
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
        async fetch() {
            const {rows} = await callMethod(
                'ui.fn_dashboard_item_action_fetch',
                {}
            );
            return rows.map((r: {id: number; name: string; udf: any}) => ({
                id: r.id.toString(),
                name: r.name,
                type: 'action' as const,
                actions: r.udf
            }));
        },
        async add({name, actions: udf}: {name: string; actions: any[]}) {
            await callMethod('ui.fn_dashboard_item_action_add', {
                p_name: name,
                p_udf: udf
            });
            return this.fetch();
        },
        async update({
            id,
            name,
            actions: udf
        }: {
            id: number;
            name: string;
            actions: any[];
        }) {
            await callMethod('ui.fn_dashboard_item_action_update', {
                p_id: id,
                p_name: name,
                p_udf: udf
            });
            return this.fetch();
        },
        async remove({id}: {id: number}) {
            await callMethod('ui.fn_dashboard_item_action_remove', {p_id: id});
            return this.fetch();
        }
    }
} as Record<string, any>;

export const REGISTRY_FOLDER = path.join(__dirname, '../../cfg/registry');

function getRegistryPath(name: string) {
    // eslint-disable-next-line no-useless-escape
    const safe = name.replace(/[:\/\\]/g, '_');
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
        } catch (e) {
            logger.warn('registry %s cannot be parsed', name, error);
        }
        return {};
    }

    logger.warn('registry %s is of the wrong format', name);
    return {};
}

async function saveRegistry(name: string, content: any, backupFirst = false) {
    // Update file cache immediately (write-through)
    fileCache.set(name, content);

    const registryPath = getRegistryPath(name);
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
    return await fsPromises.writeFile(
        registryPath,
        JSON.stringify(content, undefined, 4),
        'utf-8'
    );
}

export async function addToRegistry(
    name: string,
    key: string,
    value: NonNullable<any>
) {
    const cc: string = `${name}.${key}`;
    if (actions[cc]) {
        const act = actions[cc];
        // Invalidate cache before DB write
        dbResultCache.delete(cc);
        const result = value.id
            ? await act.update(value)
            : await act.add(value);
        // Cache the fresh result (add/update call fetch() internally)
        dbResultCache.set(cc, result);
        return result;
    }
    const data = await loadRegistry(name);
    data[key] = value;
    await saveRegistry(name, data);
    return data;
}

export async function removeFromRegistry(
    name: string,
    key: string,
    value: NonNullable<any>
) {
    const cc: string = `${name}.${key}`;

    if (actions[cc]) {
        if (!value) throw new Error('Missing arguments');
        // Invalidate cache before DB write
        dbResultCache.delete(cc);
        const rr = await actions[cc].remove(value);
        // Cache the fresh result (remove calls fetch() internally)
        dbResultCache.set(cc, rr);
        return rr;
    }
    const data = await loadRegistry(name);
    delete data[key];
    await saveRegistry(name, data);
    return data;
}

export async function getFromRegistry(name: string, key: string) {
    const cc: string = `${name}.${key}`;

    if (actions[cc]) {
        // DB-backed: check result cache first
        const cached = dbResultCache.get(cc);
        if (cached !== undefined) return cached;
        const rr = await actions[cc].fetch();
        dbResultCache.set(cc, rr);
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

export async function addDashboardItem(
    dashboard: number,
    type: number,
    item: number,
    order = 0,
    sub_item: string | null = null
): Promise<number> {
    const {
        rows: [{fn_dashboard_item_add: id}]
    } = await callMethod('ui.fn_dashboard_item_add', {
        p_dashboard: dashboard,
        p_type: type,
        p_item: item,
        p_order: order,
        p_sub_item: sub_item
    });
    return id;
}

export async function removeDashboardWidget(
    dashboard: number,
    itemId: number
): Promise<void> {
    await callMethod('ui.fn_dashboard_item_remove', {
        p_dashboard: dashboard,
        p_dashboard_item: itemId
    });
}

export async function getUIConfig(): Promise<any[]> {
    const config = await actions['ui.config'].fetch();
    return config;
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
            const result = await actions[key].fetch();
            dbResultCache.set(key, result);
            logger.info('pre-warmed cache: %s', key);
        } catch (e) {
            logger.warn('failed to pre-warm cache for %s: %s', key, e);
        }
    }
}

Observability.registerModule('registry', () => ({
    fileCacheSize: fileCache.size,
    dbCacheSize: dbResultCache.size
}));
