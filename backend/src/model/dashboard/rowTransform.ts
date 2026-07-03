/** Pure row → API shape transforms for Dashboard. No side-effect imports. */

import {dashboardDefaults} from '../../config/dashboardDefaults';
import {toIso} from '../../rpc/pgRows';
import type {
    Dashboard,
    DashboardItem,
    DashboardItemKind,
    DashboardItemMobileLayout,
    DashboardItemSize,
    DashboardScope,
    DashboardSettings,
    DashboardTemplate,
    DashboardTemplateSeed,
    DashboardType,
    TariffMode,
    TariffWindow
} from '../../types/api/dashboard';

// All defaults pulled from ENV via dashboardDefaults(); never hardcode here.
function defaultSettings(): DashboardSettings {
    const d = dashboardDefaults();
    return {
        tariff: null,
        currency: null,
        defaultRange: d.defaultRange,
        refreshInterval: d.refreshIntervalMs,
        enabledMetrics: [...d.enabledMetrics],
        chartSettings: {},
        tariffMode: d.tariffMode,
        dayRate: d.dayRate,
        nightRate: d.nightRate,
        dayStart: d.dayStart,
        dayEnd: d.dayEnd,
        tariffTimezone: d.tariffTimezone,
        tariffWindows: null,
        tariffWeekendOverride: null,
        tariffHolidays: null,
        emissionFactorGPerKWh: null,
        emissionFactorMbmGPerKWh: null,
        co2BudgetKg: null,
        tariffId: null,
        peakDeviceIds: null,
        pvMode: null,
        pvGridRefs: null,
        pvGenerationRefs: null
    };
}

function normaliseTariffMode(raw: unknown): TariffMode {
    if (raw === 'day_night') return 'day_night';
    if (raw === 'tou') return 'tou';
    return 'single';
}

function tariffWindowArray(raw: unknown): TariffWindow[] | null {
    if (!Array.isArray(raw)) return null;
    const out: TariffWindow[] = [];
    for (const w of raw) {
        if (!w || typeof w !== 'object') continue;
        const r = w as Record<string, unknown>;
        if (typeof r.from !== 'string') continue;
        if (typeof r.to !== 'string') continue;
        if (typeof r.rate !== 'number') continue;
        if (typeof r.label !== 'string') continue;
        out.push({from: r.from, to: r.to, rate: r.rate, label: r.label});
    }
    return out.length > 0 ? out : null;
}

function isoDateArray(raw: unknown): string[] | null {
    if (!Array.isArray(raw)) return null;
    const out = raw.filter(
        (s): s is string =>
            typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    );
    return out.length > 0 ? out : null;
}

function rowToScope(row: any): DashboardScope {
    const scope: DashboardScope = {};
    if (typeof row.group_id === 'number') scope.groupId = row.group_id;
    if (typeof row.location_id === 'number') scope.locationId = row.location_id;
    if (typeof row.tag_id === 'number') scope.tagId = row.tag_id;
    return scope;
}

function rowToSettings(raw: unknown): DashboardSettings {
    const def = defaultSettings();
    if (!raw || typeof raw !== 'object') return def;
    const r = raw as Record<string, unknown>;
    const num = (k: string): number | null => {
        const v = r[k];
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(+v)) {
            return +v;
        }
        return null;
    };
    const str = (k: string, d: string): string => {
        const v = r[k];
        return typeof v === 'string' ? v : d;
    };
    const arrStr = (k: string): string[] => {
        const v = r[k];
        if (Array.isArray(v))
            return v.filter((x): x is string => typeof x === 'string');
        return [];
    };
    const obj = (k: string): Record<string, unknown> => {
        const v = r[k];
        return v && typeof v === 'object' && !Array.isArray(v)
            ? (v as Record<string, unknown>)
            : {};
    };
    return {
        tariff: num('tariff'),
        currency: typeof r.currency === 'string' ? r.currency : null,
        defaultRange: str('default_range', def.defaultRange),
        refreshInterval:
            typeof r.refresh_interval === 'number'
                ? r.refresh_interval
                : def.refreshInterval,
        enabledMetrics: arrStr('enabled_metrics'),
        chartSettings: obj('chart_settings'),
        tariffMode: normaliseTariffMode(r.tariff_mode),
        dayRate: num('day_rate'),
        nightRate: num('night_rate'),
        dayStart: str('day_start', def.dayStart),
        dayEnd: str('day_end', def.dayEnd),
        tariffTimezone:
            typeof r.tariff_timezone === 'string' &&
            r.tariff_timezone.length > 0
                ? r.tariff_timezone
                : null,
        tariffWindows: tariffWindowArray(r.tariff_windows),
        tariffWeekendOverride: tariffWindowArray(r.tariff_weekend_override),
        tariffHolidays: isoDateArray(r.tariff_holidays),
        emissionFactorGPerKWh: num('emission_factor_g_per_kwh'),
        emissionFactorMbmGPerKWh: num('emission_factor_mbm_g_per_kwh'),
        co2BudgetKg: num('co2_budget_kg'),
        tariffId: typeof r.tariff_id === 'number' ? r.tariff_id : null,
        peakDeviceIds: Array.isArray(r.peak_device_ids)
            ? r.peak_device_ids
            : null,
        pvMode:
            r.pv_mode === 'parallel' ||
            r.pv_mode === 'backup' ||
            r.pv_mode === 'balcony'
                ? r.pv_mode
                : null,
        pvGridRefs: Array.isArray(r.pv_grid_refs) ? r.pv_grid_refs : null,
        pvGenerationRefs: Array.isArray(r.pv_generation_refs)
            ? r.pv_generation_refs
            : null
    };
}

export function rowToDashboardItem(row: any): DashboardItem {
    return {
        id: row.id,
        kind: row.kind as DashboardItemKind,
        deviceId: row.deviceId ?? null,
        entitySubId: row.entitySubId ?? null,
        groupId: row.groupId ?? null,
        locationId: row.locationId ?? null,
        tagId: row.tagId ?? null,
        actionId: row.actionId ?? null,
        widgetKind: row.widgetKind ?? null,
        widgetConfig: row.widgetConfig ?? null,
        order: row.order ?? 0,
        size: (row.size ?? '1x1') as DashboardItemSize,
        mobileLayout: (row.mobileLayout ??
            null) as DashboardItemMobileLayout | null,
        gridX: row.gridX ?? null,
        gridY: row.gridY ?? null,
        gridW: row.gridW ?? null,
        gridH: row.gridH ?? null
    };
}

export function rowToDashboardTemplate(row: any): DashboardTemplate {
    const seed: DashboardTemplateSeed =
        row.seed && typeof row.seed === 'object' ? row.seed : {};
    return {
        key: row.key,
        label: row.label,
        description: row.description ?? null,
        dashboardType: (row.dashboard_type ?? 'classic') as DashboardType,
        organizationId: row.organization_id ?? null,
        isBuiltin: !!row.is_builtin,
        seed,
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at)
    };
}

export function rowToDashboard(row: any, isPinnedFallback = false): Dashboard {
    const rawItems = Array.isArray(row.items) ? row.items : [];
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        dashboardType: (row.dashboard_type ?? 'classic') as DashboardType,
        scope: rowToScope(row),
        isDefault: !!row.is_default,
        isPinned: row.is_pinned ?? isPinnedFallback,
        displayOrder:
            typeof row.display_order === 'number' ? row.display_order : null,
        settings: rowToSettings(row.settings),
        items: rawItems.map(rowToDashboardItem),
        createdAt: toIso(row.created) ?? '',
        updatedAt: toIso(row.updated)
    };
}
