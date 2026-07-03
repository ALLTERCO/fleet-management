/** Grafana JSON ↔ FM Dashboard codec. Pure; floor schemaVersion via tuning. */

import * as log4js from 'log4js';
import {tuning} from '../config/tuning';
import RpcError from '../rpc/RpcError';
import type {
    Dashboard,
    DashboardItem,
    DashboardItemKind,
    DashboardItemMobileLayout,
    DashboardItemSize,
    DashboardSettings,
    DashboardType
} from '../types/api/dashboard';
import * as Observability from './Observability';

const logger = log4js.getLogger('dashboard-grafana-codec');

// FM size → Grafana grid (24-col). Inverse map below.
const SIZE_TO_GRID: Record<DashboardItemSize, {w: number; h: number}> = {
    '1x1': {w: 6, h: 4},
    '2x1': {w: 12, h: 4},
    '1x2': {w: 6, h: 8},
    '2x2': {w: 12, h: 8},
    '4x1': {w: 24, h: 4},
    '4x2': {w: 24, h: 8},
    '4x4': {w: 24, h: 16}
};

function gridToSize(w: number, h: number): DashboardItemSize {
    if (w >= 20) return h >= 12 ? '4x4' : h >= 6 ? '4x2' : '4x1';
    if (w >= 9) return h >= 6 ? '2x2' : '2x1';
    return h >= 6 ? '1x2' : '1x1';
}

const KIND_TO_GRAFANA: Record<DashboardItemKind, string> = {
    device: 'text',
    entity: 'stat',
    group: 'row',
    location: 'row',
    tag: 'row',
    action: 'text',
    widget: 'text'
};

function grafanaTypeToKind(t: string): DashboardItemKind {
    if (t === 'stat' || t === 'gauge' || t === 'graph' || t === 'timeseries') {
        return 'entity';
    }
    if (t === 'row') return 'group';
    return 'widget';
}

interface GrafanaPanel {
    id: number;
    title: string;
    type: string;
    gridPos: {x: number; y: number; w: number; h: number};
    targets?: Array<{refId?: string; fmRefId?: number; fmKind?: string}>;
    fmSubItem?: string | null;
    fmMobileLayout?: DashboardItemMobileLayout | null;
}

interface GrafanaTemplatingVar {
    name: string;
    type: string;
    current?: {value: number | string};
}

interface GrafanaDashboard {
    schemaVersion: number;
    title: string;
    tags?: string[];
    panels: GrafanaPanel[];
    templating?: {list: GrafanaTemplatingVar[]};
    time?: {from: string; to: string};
    refresh?: string;
    annotations?: {list?: Array<{name: string; query?: unknown}>};
    __fm_settings?: DashboardSettings;
    __fm_dashboardType?: DashboardType;
    uid?: string;
}

function refreshIntervalToGrafana(ms: number): string {
    if (ms <= 0) return '';
    if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
    return `${Math.round(ms / 1_000)}s`;
}

// Inverse of itemToGrafanaRef — Grafana panel back into a typed item.
function grafanaRefToItem(
    kind: DashboardItemKind,
    refId: number,
    subItem: string | null,
    order: number,
    size: DashboardItemSize,
    mobileLayout: DashboardItemMobileLayout | null
): Omit<DashboardItem, 'id'> {
    const base = {
        kind,
        deviceId: null,
        entitySubId: null,
        groupId: null,
        locationId: null,
        tagId: null,
        actionId: null,
        widgetKind: null,
        widgetConfig: null,
        order,
        size,
        mobileLayout
    } as Omit<DashboardItem, 'id'>;
    switch (kind) {
        case 'device':
            return {...base, deviceId: refId || null};
        case 'entity':
            return {...base, deviceId: refId || null, entitySubId: subItem};
        case 'group':
            return {...base, groupId: refId || null};
        case 'location':
            return {...base, locationId: refId || null};
        case 'tag':
            return {...base, tagId: refId || null};
        case 'action':
            return {...base, actionId: refId || null};
        default: {
            let cfg: Record<string, unknown> | null = null;
            if (subItem) {
                try {
                    const parsed = JSON.parse(subItem);
                    if (parsed && typeof parsed === 'object') cfg = parsed;
                } catch (err) {
                    // Poison widget config — count + drop so ops sees
                    // recurring grafana imports with malformed payload.
                    Observability.incrementCounter(
                        'dashboard_grafana_widget_parse_errors'
                    );
                    logger.debug('grafana widget parse failed: %s', err);
                }
            }
            return {
                ...base,
                widgetKind: (cfg?.id as string | undefined) ?? null,
                widgetConfig: cfg
            };
        }
    }
}

// Reduce a typed item to the legacy {refId, subItem} pair Grafana panels
// carry. Pure projection — no DB lookups, no FE catalog assumptions.
function itemToGrafanaRef(it: DashboardItem): {
    refId: number;
    subItem: string | null;
} {
    switch (it.kind) {
        case 'device':
        case 'entity':
            return {refId: it.deviceId ?? 0, subItem: it.entitySubId ?? null};
        case 'group':
            return {refId: it.groupId ?? 0, subItem: null};
        case 'location':
            return {refId: it.locationId ?? 0, subItem: null};
        case 'tag':
            return {refId: it.tagId ?? 0, subItem: null};
        case 'action':
            return {refId: it.actionId ?? 0, subItem: null};
        default:
            return {
                refId: 0,
                subItem: it.widgetConfig
                    ? JSON.stringify(it.widgetConfig)
                    : null
            };
    }
}

export function toGrafana(dash: Dashboard): GrafanaDashboard {
    const panels: GrafanaPanel[] = dash.items.map((it, idx) => {
        const grid = SIZE_TO_GRID[it.size] ?? SIZE_TO_GRID['1x1'];
        const x = (idx * grid.w) % 24;
        const y = Math.floor((idx * grid.w) / 24) * grid.h;
        const {refId, subItem} = itemToGrafanaRef(it);
        return {
            id: it.id,
            title: `${it.kind}:${refId}`,
            type: KIND_TO_GRAFANA[it.kind],
            gridPos: {x, y, w: grid.w, h: grid.h},
            targets: [{fmRefId: refId, fmKind: it.kind, refId: 'A'}],
            fmSubItem: subItem,
            fmMobileLayout: it.mobileLayout
        };
    });

    const tags: string[] = [`fm:${dash.dashboardType}`];
    if (dash.scope.groupId) tags.push(`fm:groupId:${dash.scope.groupId}`);
    if (dash.scope.locationId) {
        tags.push(`fm:locationId:${dash.scope.locationId}`);
    }
    if (dash.scope.tagId) tags.push(`fm:tagId:${dash.scope.tagId}`);

    return {
        schemaVersion: tuning.dashboard.grafanaSchemaVersionWrite,
        title: dash.name,
        tags,
        panels,
        templating: {list: []},
        time: {from: 'now-7d', to: 'now'},
        refresh: refreshIntervalToGrafana(dash.settings.refreshInterval),
        annotations: {list: []},
        __fm_settings: dash.settings,
        __fm_dashboardType: dash.dashboardType,
        uid: `fm-${dash.id}`
    };
}

export interface ImportedDashboard {
    name: string;
    dashboardType: DashboardType;
    scope: {groupId?: number; locationId?: number; tagId?: number};
    settings?: Partial<DashboardSettings>;
    items: Array<Omit<DashboardItem, 'id'>>;
}

export function fromGrafana(raw: unknown): ImportedDashboard {
    if (!raw || typeof raw !== 'object') {
        throw RpcError.Domain('DashboardImportSchemaMismatch');
    }
    const j = raw as GrafanaDashboard;
    if (
        typeof j.schemaVersion !== 'number' ||
        j.schemaVersion < tuning.dashboard.grafanaSchemaVersionFloor
    ) {
        throw RpcError.Domain('DashboardImportUnsupportedGrafanaVersion');
    }
    if (typeof j.title !== 'string' || !Array.isArray(j.panels)) {
        throw RpcError.Domain('DashboardImportSchemaMismatch');
    }

    // Pull dashboardType + scope from FM-emitted tags or annotations.
    const tags = Array.isArray(j.tags) ? j.tags : [];
    const dashboardType: DashboardType =
        j.__fm_dashboardType ??
        (tags
            .map((t) =>
                /^fm:(classic|analytics|overview|energy|environment|control|safety)$/.exec(
                    t
                )
            )
            .find((m) => m !== null)?.[1] as DashboardType | undefined) ??
        'classic';
    const scope: ImportedDashboard['scope'] = {};
    for (const t of tags) {
        const m = /^fm:(group|location|tag)Id:(\d+)$/.exec(t);
        if (!m) continue;
        const v = +m[2];
        if (m[1] === 'group') scope.groupId = v;
        if (m[1] === 'location') scope.locationId = v;
        if (m[1] === 'tag') scope.tagId = v;
    }

    const items: ImportedDashboard['items'] = [];
    for (let i = 0; i < j.panels.length; i++) {
        const p = j.panels[i];
        const kind: DashboardItemKind =
            (p.targets?.[0]?.fmKind as DashboardItemKind | undefined) ??
            grafanaTypeToKind(p.type);
        const refId =
            typeof p.targets?.[0]?.fmRefId === 'number'
                ? p.targets[0].fmRefId
                : 0;
        const size = gridToSize(p.gridPos?.w ?? 6, p.gridPos?.h ?? 4);
        items.push(
            grafanaRefToItem(
                kind,
                refId,
                p.fmSubItem ?? null,
                i,
                size,
                p.fmMobileLayout ?? null
            )
        );
    }

    return {
        name: j.title,
        dashboardType,
        scope,
        settings: j.__fm_settings,
        items
    };
}

// FM-native format = the Dashboard shape itself.
export function fromFmJson(raw: unknown): ImportedDashboard {
    if (!raw || typeof raw !== 'object') {
        throw RpcError.Domain('DashboardImportSchemaMismatch');
    }
    const j = raw as Partial<Dashboard>;
    if (typeof j.name !== 'string' || typeof j.dashboardType !== 'string') {
        throw RpcError.Domain('DashboardImportSchemaMismatch');
    }
    const items = Array.isArray(j.items) ? j.items : [];
    return {
        name: j.name,
        dashboardType: j.dashboardType as DashboardType,
        scope: j.scope ?? {},
        settings: j.settings,
        items: items.map((it, idx) => ({
            kind: it.kind,
            deviceId: it.deviceId ?? null,
            entitySubId: it.entitySubId ?? null,
            groupId: it.groupId ?? null,
            locationId: it.locationId ?? null,
            tagId: it.tagId ?? null,
            actionId: it.actionId ?? null,
            widgetKind: it.widgetKind ?? null,
            widgetConfig: it.widgetConfig ?? null,
            order: typeof it.order === 'number' ? it.order : idx,
            size: it.size,
            mobileLayout: it.mobileLayout ?? null,
            gridX: it.gridX ?? null,
            gridY: it.gridY ?? null,
            gridW: it.gridW ?? null,
            gridH: it.gridH ?? null
        }))
    };
}
