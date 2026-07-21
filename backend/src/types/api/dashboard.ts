/** Public API types for the `Dashboard.*` namespace — Describe() contract. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import {INT4_MAX, type JsonSchema, NON_NEGATIVE_INT4_SCHEMA} from './_schema';
import {NAME_SCHEMA, ORG_ID_SCHEMA} from './_shared';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';

export {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';

const DASHBOARD_ID_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1,
    description: 'Dashboard id'
};

// A chosen PV meter: a whole device or one channel of it.
export const PV_METER_REF_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['device'],
    properties: {
        device: {type: 'string', minLength: 1},
        channel: {type: ['integer', 'null'], minimum: 0}
    }
};

// PV config fields shared by the settings schemas.
const PV_SETTINGS_PROPS: Record<string, JsonSchema> = {
    pvMode: {
        type: ['string', 'null'],
        enum: ['parallel', 'backup', 'balcony', null]
    },
    pvGridRefs: {type: ['array', 'null'], items: PV_METER_REF_SCHEMA},
    pvGenerationRefs: {type: ['array', 'null'], items: PV_METER_REF_SCHEMA}
};

// =====================================================================
// LEGACY (kept for Phase 1 — Phase 2 drops these handlers + describes)
// =====================================================================

const TARIFF_WINDOW_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to', 'rate', 'label'],
    properties: {
        from: {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'},
        to: {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'},
        rate: {type: 'number', minimum: 0},
        label: {type: 'string', minLength: 1, maxLength: 32}
    }
};

const TARIFF_WINDOWS_ARRAY_SCHEMA: JsonSchema = {
    type: ['array', 'null'],
    items: TARIFF_WINDOW_SCHEMA,
    minItems: 1,
    maxItems: 8
};

const TARIFF_HOLIDAYS_SCHEMA: JsonSchema = {
    type: ['array', 'null'],
    items: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
    maxItems: 50
};

const DASHBOARD_SETTINGS_SCHEMA_LEGACY: JsonSchema = {
    type: 'object',
    required: ['dashboardId'],
    properties: {
        dashboardId: {type: 'integer'},
        tariff: {type: ['number', 'null']},
        currency: {type: ['string', 'null']},
        defaultRange: {type: ['string', 'null']},
        refreshInterval: {type: ['integer', 'null']},
        enabledMetrics: {type: 'array', items: {type: 'string'}},
        chartSettings: {type: 'object', additionalProperties: true},
        tariffMode: {type: 'string', enum: ['single', 'day_night', 'tou']},
        dayRate: {type: ['number', 'null']},
        nightRate: {type: ['number', 'null']},
        dayStart: {type: 'string'},
        dayEnd: {type: 'string'},
        tariffTimezone: {type: ['string', 'null'], minLength: 1, maxLength: 64},
        tariffWindows: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffWeekendOverride: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffHolidays: TARIFF_HOLIDAYS_SCHEMA,
        emissionFactorGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        emissionFactorMbmGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        co2BudgetKg: {
            type: ['number', 'null'],
            minimum: 0
        },
        tariffId: {type: ['integer', 'null']},
        peakDeviceIds: {type: ['array', 'null'], items: {type: 'string'}},
        ...PV_SETTINGS_PROPS
    },
    additionalProperties: true
};

export const DASHBOARD_GET_SETTINGS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId'],
    properties: {dashboardId: DASHBOARD_ID_SCHEMA}
};

export const DASHBOARD_SET_SETTINGS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId'],
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        tariff: {type: 'number'},
        tariffId: {type: ['integer', 'null']},
        currency: {type: 'string'},
        defaultRange: {type: 'string'},
        refreshInterval: {type: 'integer'},
        enabledMetrics: {type: 'array', items: {type: 'string'}},
        chartSettings: {type: 'object', additionalProperties: true},
        tariffMode: {type: 'string', enum: ['single', 'day_night', 'tou']},
        dayRate: {type: ['number', 'null']},
        nightRate: {type: ['number', 'null']},
        dayStart: {type: 'string'},
        dayEnd: {type: 'string'},
        tariffTimezone: {type: ['string', 'null'], minLength: 1, maxLength: 64},
        tariffWindows: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffWeekendOverride: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffHolidays: TARIFF_HOLIDAYS_SCHEMA,
        emissionFactorGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        emissionFactorMbmGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        co2BudgetKg: {
            type: ['number', 'null'],
            minimum: 0
        },
        peakDeviceIds: {type: ['array', 'null'], items: {type: 'string'}},
        ...PV_SETTINGS_PROPS
    }
};

export const DASHBOARD_SET_SETTINGS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['success', 'dashboardId'],
    properties: {
        success: {type: 'boolean', const: true},
        dashboardId: {type: 'integer'}
    }
};

// Single source of truth; DashboardComponent imports from here.
// Must match ui.dashboard.dashboard_type CHECK in 2102_dashboard_type_extension.sql.
export const DASHBOARD_TYPES = [
    'classic',
    'analytics',
    'overview',
    'energy',
    'environment',
    'control',
    'safety',
    'map'
] as const;
export type DashboardType = (typeof DASHBOARD_TYPES)[number];

export const DASHBOARD_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name', 'dashboardType'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        scope: {
            type: 'object',
            additionalProperties: false,
            maxProperties: 1,
            properties: {
                locationId: {type: 'integer', minimum: 1},
                groupId: {type: 'integer', minimum: 1},
                tagId: {type: 'integer', minimum: 1}
            }
        }
    }
};

export const DASHBOARD_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: DASHBOARD_ID_SCHEMA,
        name: NAME_SCHEMA,
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        scope: {
            oneOf: [
                {type: 'null'},
                {
                    type: 'object',
                    additionalProperties: false,
                    maxProperties: 1,
                    properties: {
                        locationId: {type: 'integer', minimum: 1},
                        groupId: {type: 'integer', minimum: 1},
                        tagId: {type: 'integer', minimum: 1}
                    }
                }
            ]
        }
    },
    minProperties: 2
};

export const DASHBOARD_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: DASHBOARD_ID_SCHEMA}
};

export const DASHBOARD_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted'],
    properties: {deleted: {type: 'integer'}}
};

export const DASHBOARD_DELETE_BULK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ids'],
    additionalProperties: false,
    properties: {
        ids: {type: 'array', minItems: 1, items: DASHBOARD_ID_SCHEMA}
    }
};

export const DASHBOARD_DELETE_BULK_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted'],
    properties: {deleted: {type: 'array', items: {type: 'integer'}}}
};

export const DASHBOARD_ADD_ITEM_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboard', 'type', 'item'],
    properties: {
        dashboard: DASHBOARD_ID_SCHEMA,
        type: {type: 'integer'},
        item: {type: 'integer'},
        order: NON_NEGATIVE_INT4_SCHEMA,
        sub_item: {type: ['string', 'null']},
        size: {type: 'string', description: 'Widget size, e.g. "1x1", "2x1"'}
    }
};

export const DASHBOARD_ADD_ITEM_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'integer'}}
};

export const DASHBOARD_UPDATE_ITEM_SIZE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboard', 'itemId', 'size'],
    properties: {
        dashboard: DASHBOARD_ID_SCHEMA,
        itemId: {type: 'integer', minimum: 1},
        size: {type: 'string'}
    }
};

export const DASHBOARD_UPDATE_ITEM_SIZE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['updated', 'size'],
    properties: {updated: {type: 'integer'}, size: {type: 'string'}}
};

export const DASHBOARD_REMOVE_ITEM_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboard', 'itemId'],
    properties: {
        dashboard: DASHBOARD_ID_SCHEMA,
        itemId: {type: 'integer', minimum: 1}
    }
};

export const DASHBOARD_REMOVE_ITEM_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['removed'],
    properties: {removed: {type: 'integer'}}
};

export const DASHBOARD_REORDER_ITEMS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboard', 'itemIds'],
    properties: {
        dashboard: DASHBOARD_ID_SCHEMA,
        itemIds: {type: 'array', items: {type: 'integer', minimum: 1}}
    }
};

export const DASHBOARD_REORDER_ITEMS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['reordered'],
    properties: {reordered: {type: 'integer', minimum: 0}}
};

// Per-user dashboard ordering. The full visible-id list is the input;
// server filters to ids the caller can see and appends any visible
// dashboards omitted by the caller, then persists positions 0..N-1.
export const DASHBOARD_REORDER_MAX_IDS = 200;
export const DASHBOARD_REORDER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ids'],
    properties: {
        ids: {
            type: 'array',
            items: {type: 'integer', minimum: 1},
            maxItems: DASHBOARD_REORDER_MAX_IDS
        }
    }
};

export const DASHBOARD_REORDER_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ok', 'ids'],
    properties: {
        ok: {type: 'boolean'},
        ids: {type: 'array', items: {type: 'integer', minimum: 1}}
    }
};

export const DASHBOARD_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA
    }
};

export const DASHBOARD_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: DASHBOARD_ID_SCHEMA
    }
};

export const DASHBOARD_GET_UI_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {}
};

export const DASHBOARD_GET_UI_CONFIG_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    description:
        'UI registry snapshot (widgets, menu items, dashboard descriptors).',
    additionalProperties: true
};

// =====================================================================
// PHASE 1 NEW TYPES — used by Phase 2 handlers
// =====================================================================

export const DASHBOARD_ITEM_KINDS = [
    'device',
    'entity',
    'group',
    'location',
    'tag',
    'action',
    'widget'
] as const;
export type DashboardItemKind = (typeof DASHBOARD_ITEM_KINDS)[number];

export const DASHBOARD_ITEM_SIZES = [
    '1x1',
    '2x1',
    '2x2',
    '1x2',
    '4x1',
    '4x2',
    '4x4'
] as const;
export type DashboardItemSize = (typeof DASHBOARD_ITEM_SIZES)[number];

// Phones don't fit 4-wide layouts.
export const DASHBOARD_ITEM_MOBILE_SIZES = [
    '1x1',
    '2x1',
    '1x2',
    '2x2'
] as const;
export type DashboardItemMobileSize =
    (typeof DASHBOARD_ITEM_MOBILE_SIZES)[number];

export interface DashboardItemMobileLayout {
    hidden?: boolean;
    size?: DashboardItemMobileSize;
    order?: number;
}

export interface DashboardItem {
    id: number;
    kind: DashboardItemKind;
    deviceId: number | null;
    entitySubId: string | null;
    groupId: number | null;
    locationId: number | null;
    tagId: number | null;
    actionId: number | null;
    widgetKind: string | null;
    widgetConfig: Record<string, unknown> | null;
    order: number;
    size: DashboardItemSize;
    mobileLayout: DashboardItemMobileLayout | null;
    gridX: number | null;
    gridY: number | null;
    gridW: number | null;
    gridH: number | null;
}

export type TariffMode = 'single' | 'day_night' | 'tou';

export interface TariffWindow {
    from: string;
    to: string;
    rate: number;
    label: string;
}

export interface DashboardSettings {
    tariff: number | null;
    currency: string | null;
    defaultRange: string;
    refreshInterval: number;
    enabledMetrics: string[];
    chartSettings: Record<string, unknown>;
    tariffMode: TariffMode;
    dayRate: number | null;
    nightRate: number | null;
    dayStart: string;
    dayEnd: string;
    /** IANA TZ for day_start/day_end and tariffWindows. null = UTC backfill. */
    tariffTimezone: string | null;
    /** Populated only when tariffMode='tou'; stripped on other modes. */
    tariffWindows: TariffWindow[] | null;
    /** Optional weekend schedule; same shape as tariffWindows. */
    tariffWeekendOverride: TariffWindow[] | null;
    /** ISO date strings; on these dates the weekend override applies. */
    tariffHolidays: string[] | null;
    // Location-based (LBM) g CO₂e/kWh. null → env default.
    emissionFactorGPerKWh: number | null;
    // Market-based (MBM) g CO₂e/kWh — for green-PPA/REC reporting. null → MBM row omitted.
    emissionFactorMbmGPerKWh: number | null;
    // Monthly CO₂ budget in kg. null → no budget tracking.
    co2BudgetKg: number | null;
    // Org tariff library reference. null = inline rates on this dashboard.
    tariffId: number | null;
    // Devices counted toward peak-power figure. null = all devices in scope.
    peakDeviceIds: string[] | null;
    // PV setup: mode + which meters are grid vs generation. null = no PV.
    pvMode: 'parallel' | 'backup' | 'balcony' | null;
    pvGridRefs: PvMeterRef[] | null;
    pvGenerationRefs: PvMeterRef[] | null;
}

export interface PvMeterRef {
    device: string;
    channel: number | null;
}

export interface Dashboard {
    id: number;
    organizationId: string;
    name: string;
    dashboardType: DashboardType;
    scope: DashboardScope;
    isDefault: boolean;
    isPinned: boolean;
    /** Caller-specific position (0-based). null = caller has not reordered yet. */
    displayOrder: number | null;
    settings: DashboardSettings;
    items: DashboardItem[];
    createdAt: string;
    updatedAt: string | null;
}

export interface DashboardTemplateSeed {
    detectsEntityTypes?: string[];
    staticItems?: Array<Omit<DashboardItem, 'id'>>;
    settings?: Partial<DashboardSettings>;
}

export interface DashboardTemplate {
    key: string;
    label: string;
    description: string | null;
    dashboardType: DashboardType;
    organizationId: string | null;
    isBuiltin: boolean;
    seed: DashboardTemplateSeed;
    createdAt: string;
    updatedAt: string | null;
}

// --- Phase 1 schemas (exported, registered by Phase 2) ---------------

const DASHBOARD_ITEM_KIND_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DASHBOARD_ITEM_KINDS]
};

const DASHBOARD_ITEM_SIZE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DASHBOARD_ITEM_SIZES]
};

const DASHBOARD_ITEM_MOBILE_SIZE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DASHBOARD_ITEM_MOBILE_SIZES]
};

export const DASHBOARD_ITEM_MOBILE_LAYOUT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        hidden: {type: 'boolean'},
        size: DASHBOARD_ITEM_MOBILE_SIZE_SCHEMA,
        order: NON_NEGATIVE_INT4_SCHEMA
    }
};

export const DASHBOARD_ITEM_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'kind', 'order', 'size', 'mobileLayout'],
    properties: {
        id: {type: 'integer'},
        kind: DASHBOARD_ITEM_KIND_SCHEMA,
        deviceId: {type: ['integer', 'null']},
        entitySubId: {type: ['string', 'null']},
        groupId: {type: ['integer', 'null']},
        locationId: {type: ['integer', 'null']},
        tagId: {type: ['integer', 'null']},
        actionId: {type: ['integer', 'null']},
        widgetKind: {type: ['string', 'null']},
        widgetConfig: {type: ['object', 'null']},
        order: NON_NEGATIVE_INT4_SCHEMA,
        size: DASHBOARD_ITEM_SIZE_SCHEMA,
        mobileLayout: {
            oneOf: [{type: 'null'}, DASHBOARD_ITEM_MOBILE_LAYOUT_SCHEMA]
        },
        gridX: {type: ['integer', 'null']},
        gridY: {type: ['integer', 'null']},
        gridW: {type: ['integer', 'null']},
        gridH: {type: ['integer', 'null']}
    }
};

export const DASHBOARD_SETTINGS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'tariff',
        'currency',
        'defaultRange',
        'refreshInterval',
        'enabledMetrics',
        'chartSettings',
        'tariffMode',
        'dayRate',
        'nightRate',
        'dayStart',
        'dayEnd',
        'tariffTimezone',
        'tariffWindows',
        'tariffWeekendOverride',
        'tariffHolidays',
        'emissionFactorGPerKWh',
        'emissionFactorMbmGPerKWh'
    ],
    properties: {
        tariff: {type: ['number', 'null']},
        currency: {type: ['string', 'null']},
        defaultRange: {type: 'string'},
        refreshInterval: {type: 'integer'},
        enabledMetrics: {type: 'array', items: {type: 'string'}},
        chartSettings: {type: 'object', additionalProperties: true},
        tariffMode: {type: 'string', enum: ['single', 'day_night', 'tou']},
        dayRate: {type: ['number', 'null']},
        nightRate: {type: ['number', 'null']},
        dayStart: {type: 'string'},
        dayEnd: {type: 'string'},
        tariffTimezone: {type: ['string', 'null'], minLength: 1, maxLength: 64},
        tariffWindows: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffWeekendOverride: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffHolidays: TARIFF_HOLIDAYS_SCHEMA,
        emissionFactorGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        emissionFactorMbmGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        co2BudgetKg: {
            type: ['number', 'null'],
            minimum: 0
        },
        tariffId: {type: ['integer', 'null']},
        peakDeviceIds: {type: ['array', 'null'], items: {type: 'string'}},
        ...PV_SETTINGS_PROPS
    }
};

export const DASHBOARD_SETTINGS_PATCH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        tariff: {type: ['number', 'null']},
        currency: {type: ['string', 'null']},
        defaultRange: {type: 'string'},
        refreshInterval: {type: 'integer'},
        enabledMetrics: {type: 'array', items: {type: 'string'}},
        chartSettings: {type: 'object', additionalProperties: true},
        tariffMode: {type: 'string', enum: ['single', 'day_night', 'tou']},
        dayRate: {type: ['number', 'null']},
        nightRate: {type: ['number', 'null']},
        dayStart: {type: 'string'},
        dayEnd: {type: 'string'},
        tariffTimezone: {type: ['string', 'null'], minLength: 1, maxLength: 64},
        tariffWindows: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffWeekendOverride: TARIFF_WINDOWS_ARRAY_SCHEMA,
        tariffHolidays: TARIFF_HOLIDAYS_SCHEMA,
        emissionFactorGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        emissionFactorMbmGPerKWh: {
            type: ['number', 'null'],
            minimum: 0,
            maximum: 5000
        },
        co2BudgetKg: {
            type: ['number', 'null'],
            minimum: 0
        },
        peakDeviceIds: {type: ['array', 'null'], items: {type: 'string'}},
        ...PV_SETTINGS_PROPS
    }
};

export const DASHBOARD_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'name',
        'dashboardType',
        'scope',
        'isDefault',
        'isPinned',
        'displayOrder',
        'settings',
        'items',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: {type: 'string'},
        name: {type: 'string'},
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        scope: DASHBOARD_SCOPE_SCHEMA,
        isDefault: {type: 'boolean'},
        isPinned: {type: 'boolean'},
        displayOrder: {type: ['integer', 'null'], minimum: 0},
        settings: DASHBOARD_SETTINGS_SCHEMA,
        items: {type: 'array', items: DASHBOARD_ITEM_SCHEMA},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

export const DASHBOARD_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total'],
    properties: {
        items: {type: 'array', items: DASHBOARD_SCHEMA},
        total: {type: 'integer'}
    }
};

const DASHBOARD_TEMPLATE_KEY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    pattern: '^[a-z0-9][a-z0-9_-]{0,119}$'
};

// Typed item-input shape; CHECK constraint in DB enforces kind ↔ field set.
const DASHBOARD_ITEM_INPUT_PROPERTIES = {
    kind: DASHBOARD_ITEM_KIND_SCHEMA,
    deviceId: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    entitySubId: {type: ['string', 'null'] as ('string' | 'null')[]},
    groupId: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    locationId: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    tagId: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    actionId: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    widgetKind: {
        type: ['string', 'null'] as ('string' | 'null')[],
        description:
            "For kind='widget' items a missing or empty widgetKind " +
            "defaults to 'clock_widget' (DB-side, fn_dashboard_item_add_v3)."
    },
    widgetConfig: {type: ['object', 'null'] as ('object' | 'null')[]},
    order: {type: 'integer' as const, minimum: 0, maximum: INT4_MAX},
    size: DASHBOARD_ITEM_SIZE_SCHEMA,
    mobileLayout: {
        oneOf: [{type: 'null' as const}, DASHBOARD_ITEM_MOBILE_LAYOUT_SCHEMA]
    },
    gridX: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    gridY: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    gridW: {type: ['integer', 'null'] as ('integer' | 'null')[]},
    gridH: {type: ['integer', 'null'] as ('integer' | 'null')[]}
};

const DASHBOARD_TEMPLATE_SEED_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        detectsEntityTypes: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        staticItems: {
            type: 'array',
            items: {
                type: 'object',
                required: ['kind'],
                additionalProperties: false,
                properties: DASHBOARD_ITEM_INPUT_PROPERTIES
            }
        },
        settings: DASHBOARD_SETTINGS_PATCH_SCHEMA
    }
};

export const DASHBOARD_TEMPLATE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'key',
        'label',
        'dashboardType',
        'organizationId',
        'isBuiltin',
        'seed',
        'createdAt'
    ],
    properties: {
        key: DASHBOARD_TEMPLATE_KEY_SCHEMA,
        label: {type: 'string', minLength: 1, maxLength: 200},
        description: {type: ['string', 'null']},
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        organizationId: {type: ['string', 'null']},
        isBuiltin: {type: 'boolean'},
        seed: DASHBOARD_TEMPLATE_SEED_SCHEMA,
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

// --- Item op schemas (Phase 2 wires) ---------------------------------

export const DASHBOARD_ITEM_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId'],
    additionalProperties: false,
    properties: {dashboardId: DASHBOARD_ID_SCHEMA}
};

export const DASHBOARD_ITEM_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items'],
    properties: {items: {type: 'array', items: DASHBOARD_ITEM_SCHEMA}}
};

export const DASHBOARD_ITEM_ADD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId', 'kind'],
    additionalProperties: false,
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        ...DASHBOARD_ITEM_INPUT_PROPERTIES
    }
};

export const DASHBOARD_ITEM_ADD_BULK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId', 'items'],
    additionalProperties: false,
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['kind'],
                additionalProperties: false,
                properties: DASHBOARD_ITEM_INPUT_PROPERTIES
            }
        }
    }
};

export const DASHBOARD_ITEM_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId', 'itemId'],
    additionalProperties: false,
    minProperties: 3,
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        itemId: {type: 'integer', minimum: 1},
        size: DASHBOARD_ITEM_SIZE_SCHEMA,
        entitySubId: {type: ['string', 'null']},
        widgetConfig: {type: ['object', 'null']},
        order: NON_NEGATIVE_INT4_SCHEMA,
        mobileLayout: {
            oneOf: [{type: 'null'}, DASHBOARD_ITEM_MOBILE_LAYOUT_SCHEMA]
        }
    }
};

export const DASHBOARD_ITEM_REMOVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId', 'itemId'],
    additionalProperties: false,
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        itemId: {type: 'integer', minimum: 1}
    }
};

export const DASHBOARD_ITEM_REORDER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId', 'itemIds'],
    additionalProperties: false,
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        itemIds: {type: 'array', items: {type: 'integer', minimum: 1}}
    }
};

export const DASHBOARD_ITEM_SET_ALL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dashboardId', 'items'],
    additionalProperties: false,
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['kind'],
                additionalProperties: false,
                properties: DASHBOARD_ITEM_INPUT_PROPERTIES
            }
        }
    }
};

// --- Default/Pin/Clone schemas ---------------------------------------

export const DASHBOARD_GET_DEFAULT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {organizationId: ORG_ID_SCHEMA}
};

export const DASHBOARD_GET_DEFAULT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {id: {type: ['integer', 'null']}}
};

export const DASHBOARD_SET_DEFAULT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: DASHBOARD_ID_SCHEMA, organizationId: ORG_ID_SCHEMA}
};

export const DASHBOARD_CLEAR_DEFAULT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {organizationId: ORG_ID_SCHEMA}
};

export const DASHBOARD_PIN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: DASHBOARD_ID_SCHEMA,
        sortOrder: {type: 'integer', minimum: 0}
    }
};

export const DASHBOARD_UNPIN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: DASHBOARD_ID_SCHEMA}
};

export const DASHBOARD_LIST_PINNED_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const DASHBOARD_LIST_PINNED_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['dashboardId', 'sortOrder', 'pinnedAt'],
                properties: {
                    dashboardId: {type: 'integer'},
                    sortOrder: {type: 'integer'},
                    pinnedAt: {type: 'string'}
                }
            }
        }
    }
};

export const DASHBOARD_REORDER_PINS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ids'],
    additionalProperties: false,
    properties: {
        ids: {type: 'array', items: {type: 'integer', minimum: 1}}
    }
};

export const DASHBOARD_CLONE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'name'],
    additionalProperties: false,
    properties: {
        id: DASHBOARD_ID_SCHEMA,
        name: NAME_SCHEMA,
        scope: DASHBOARD_SCOPE_SCHEMA
    }
};

// --- V2 List/Get/Create/Update with the new shape --------------------

export const DASHBOARD_LIST_V2_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        groupId: {type: 'integer', minimum: 1},
        locationId: {type: 'integer', minimum: 1},
        tagId: {type: 'integer', minimum: 1},
        q: {type: 'string', minLength: 1, maxLength: 200},
        limit: {type: 'integer', minimum: 0, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

export const DASHBOARD_LIST_V2_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: DASHBOARD_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const DASHBOARD_GET_V2_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: DASHBOARD_ID_SCHEMA,
        includeItems: {type: 'boolean'},
        includeSettings: {type: 'boolean'}
    }
};

export const DASHBOARD_CREATE_V2_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name', 'dashboardType'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        scope: DASHBOARD_SCOPE_SCHEMA,
        template: DASHBOARD_TEMPLATE_KEY_SCHEMA,
        settings: DASHBOARD_SETTINGS_PATCH_SCHEMA,
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['kind'],
                additionalProperties: false,
                properties: DASHBOARD_ITEM_INPUT_PROPERTIES
            }
        }
    }
};

export const DASHBOARD_UPDATE_V2_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    minProperties: 2,
    properties: {
        id: DASHBOARD_ID_SCHEMA,
        name: NAME_SCHEMA,
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        scope: {oneOf: [{type: 'null'}, DASHBOARD_SCOPE_SCHEMA]},
        settings: DASHBOARD_SETTINGS_PATCH_SCHEMA
    }
};

// --- Template op schemas ---------------------------------------------

export const DASHBOARD_TEMPLATE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        includeBuiltin: {type: 'boolean'},
        organizationId: ORG_ID_SCHEMA
    }
};

export const DASHBOARD_TEMPLATE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items'],
    properties: {
        items: {type: 'array', items: DASHBOARD_TEMPLATE_SCHEMA}
    }
};

export const DASHBOARD_TEMPLATE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key'],
    additionalProperties: false,
    properties: {
        key: DASHBOARD_TEMPLATE_KEY_SCHEMA,
        organizationId: ORG_ID_SCHEMA
    }
};

export const DASHBOARD_TEMPLATE_PREVIEW_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key'],
    additionalProperties: false,
    properties: {
        key: DASHBOARD_TEMPLATE_KEY_SCHEMA,
        scope: DASHBOARD_SCOPE_SCHEMA,
        organizationId: ORG_ID_SCHEMA
    }
};

export const DASHBOARD_TEMPLATE_PREVIEW_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'missingDevices'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['kind'],
                properties: DASHBOARD_ITEM_INPUT_PROPERTIES
            }
        },
        missingDevices: {
            type: 'number',
            description:
                'In-scope devices that could not be expanded into entity ' +
                'items because they are not currently registered. Non-zero ' +
                'means the preview is partial.'
        }
    }
};

export const DASHBOARD_TEMPLATE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key', 'label', 'dashboardType', 'seed'],
    additionalProperties: false,
    properties: {
        key: DASHBOARD_TEMPLATE_KEY_SCHEMA,
        label: {type: 'string', minLength: 1, maxLength: 200},
        description: {type: ['string', 'null']},
        dashboardType: {type: 'string', enum: [...DASHBOARD_TYPES]},
        seed: DASHBOARD_TEMPLATE_SEED_SCHEMA,
        organizationId: ORG_ID_SCHEMA
    }
};

export const DASHBOARD_TEMPLATE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key'],
    additionalProperties: false,
    minProperties: 2,
    properties: {
        key: DASHBOARD_TEMPLATE_KEY_SCHEMA,
        label: {type: 'string', minLength: 1, maxLength: 200},
        description: {type: ['string', 'null']},
        seed: DASHBOARD_TEMPLATE_SEED_SCHEMA,
        organizationId: ORG_ID_SCHEMA
    }
};

export const DASHBOARD_TEMPLATE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key'],
    additionalProperties: false,
    properties: {
        key: DASHBOARD_TEMPLATE_KEY_SCHEMA,
        organizationId: ORG_ID_SCHEMA
    }
};

export const DASHBOARD_TEMPLATE_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted'],
    properties: {deleted: {type: 'string'}}
};

export const DASHBOARD_TEMPLATE_SAVE_FROM_DASHBOARD_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['dashboardId', 'key', 'label'],
        additionalProperties: false,
        properties: {
            dashboardId: DASHBOARD_ID_SCHEMA,
            key: DASHBOARD_TEMPLATE_KEY_SCHEMA,
            label: {type: 'string', minLength: 1, maxLength: 200},
            description: {type: ['string', 'null']},
            organizationId: ORG_ID_SCHEMA
        }
    };

// --- Export / Import schemas (Phase 6) -------------------------------

export const DASHBOARD_EXPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: DASHBOARD_ID_SCHEMA,
        format: {type: 'string', enum: ['fm', 'grafana']}
    }
};

export const DASHBOARD_EXPORT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['format', 'json'],
    properties: {
        format: {type: 'string', enum: ['fm', 'grafana']},
        json: {type: 'object', additionalProperties: true}
    }
};

export const DASHBOARD_IMPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['json'],
    additionalProperties: false,
    properties: {
        json: {type: 'object', additionalProperties: true},
        format: {type: 'string', enum: ['fm', 'grafana']},
        name: NAME_SCHEMA,
        scope: DASHBOARD_SCOPE_SCHEMA,
        organizationId: ORG_ID_SCHEMA
    }
};

// =====================================================================
// Activity log — read-only RPC for the share/detail drawer to surface
// who-changed-what-when on a dashboard.
// =====================================================================

export const DASHBOARD_ACTIVITY_KINDS = [
    'created',
    'updated',
    'shared',
    'unshared',
    'cloned',
    'pinned',
    'unpinned',
    'owner_changed',
    'item_added',
    'item_removed'
] as const;

export type DashboardActivityKind = (typeof DASHBOARD_ACTIVITY_KINDS)[number];

export interface DashboardActivityEntry {
    id: number;
    dashboardId: number;
    organizationId: string;
    actorUserId: string | null;
    eventKind: DashboardActivityKind;
    detail: Record<string, unknown>;
    occurredAt: string;
}

export const DASHBOARD_ACTIVITY_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['dashboardId'],
    properties: {
        dashboardId: DASHBOARD_ID_SCHEMA,
        // Backend clamps to [1, 200] regardless.
        limit: {type: 'integer', minimum: 1, maximum: 200, default: 20}
    }
};

export const DASHBOARD_ACTIVITY_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'dashboardId',
        'organizationId',
        'actorUserId',
        'eventKind',
        'detail',
        'occurredAt'
    ],
    properties: {
        id: {type: 'integer', minimum: 1},
        dashboardId: DASHBOARD_ID_SCHEMA,
        organizationId: ORG_ID_SCHEMA,
        actorUserId: {type: ['string', 'null'], minLength: 1, maxLength: 120},
        eventKind: {type: 'string', enum: [...DASHBOARD_ACTIVITY_KINDS]},
        detail: {type: 'object', additionalProperties: true},
        occurredAt: {type: 'string'}
    }
};

export const DASHBOARD_ACTIVITY_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {type: 'array', items: DASHBOARD_ACTIVITY_ENTRY_SCHEMA}
    }
};

// =====================================================================
// PHASE 1 DESCRIBE (legacy registrations preserved — Phase 2 swaps)
// =====================================================================

export const DASHBOARD_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'dashboard',
    {
        kind: 'fleet-manager',
        description:
            'Manage and serve device dashboards, their items, templates, and pins.'
    }
)
    .registerMethod('List', {
        params: DASHBOARD_LIST_PARAMS_SCHEMA,
        response: DASHBOARD_LIST_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'List dashboards scoped to the caller organization. Trusted senders may pass organizationId to override.'
    })
    .registerMethod('Get', {
        params: DASHBOARD_GET_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description: 'Fetch a single dashboard by id.'
    })
    .registerMethod('GetSettings', {
        params: DASHBOARD_GET_SETTINGS_PARAMS_SCHEMA,
        response: DASHBOARD_SETTINGS_SCHEMA_LEGACY,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Fetch per-dashboard user preferences (tariff, currency, default range, enabled metrics, ...). Returns defaults when unset.'
    })
    .registerMethod('SetSettings', {
        params: DASHBOARD_SET_SETTINGS_PARAMS_SCHEMA,
        response: DASHBOARD_SET_SETTINGS_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description: 'Upsert any subset of the dashboard settings fields.'
    })
    .registerMethod('Create', {
        params: DASHBOARD_CREATE_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'create'},
        description: `Create a dashboard. dashboardType: ${DASHBOARD_TYPES.join(' / ')}. Optional scope axis: locationId, groupId, or tagId (mutually exclusive).`
    })
    .registerMethod('Update', {
        params: DASHBOARD_UPDATE_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Patch name / dashboardType / scope. scope: null clears every axis; scope: { locationId | groupId | tagId } (exactly one) replaces the current axis. Cross-org refs rejected with DomainError CrossOrgReference.'
    })
    .registerMethod('Delete', {
        params: DASHBOARD_DELETE_PARAMS_SCHEMA,
        response: DASHBOARD_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'delete'},
        description: 'Delete a dashboard and all its items.'
    })
    .registerMethod('DeleteBulk', {
        params: DASHBOARD_DELETE_BULK_PARAMS_SCHEMA,
        response: DASHBOARD_DELETE_BULK_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'delete'},
        description:
            'Delete multiple dashboards and all their items in one call. Org-scoped: only the caller org’s dashboards are removed; returns the ids actually deleted.'
    })
    .registerMethod('AddItem', {
        params: DASHBOARD_ADD_ITEM_PARAMS_SCHEMA,
        response: DASHBOARD_ADD_ITEM_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description: 'Add a widget to a dashboard. Returns the new item id.'
    })
    .registerMethod('UpdateItemSize', {
        params: DASHBOARD_UPDATE_ITEM_SIZE_PARAMS_SCHEMA,
        response: DASHBOARD_UPDATE_ITEM_SIZE_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description: 'Resize a widget in-place.'
    })
    .registerMethod('RemoveItem', {
        params: DASHBOARD_REMOVE_ITEM_PARAMS_SCHEMA,
        response: DASHBOARD_REMOVE_ITEM_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description: 'Remove a widget from a dashboard.'
    })
    .registerMethod('ReorderItems', {
        params: DASHBOARD_REORDER_ITEMS_PARAMS_SCHEMA,
        response: DASHBOARD_REORDER_ITEMS_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description: 'Reorder widgets by passing the new itemId sequence.'
    })
    .registerMethod('Reorder', {
        params: DASHBOARD_REORDER_PARAMS_SCHEMA,
        response: DASHBOARD_REORDER_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Persist per-user dashboard ordering. Server filters unknown ids and appends visible ids the caller omitted.'
    })
    .registerMethod('GetUIConfig', {
        safety: {operation: 'read'},
        params: DASHBOARD_GET_UI_CONFIG_PARAMS_SCHEMA,
        response: DASHBOARD_GET_UI_CONFIG_RESPONSE_SCHEMA,
        permission: {
            note: 'no-permission — UI registry is non-sensitive metadata'
        },
        description:
            'Return the UI registry snapshot (widgets, menu items, available dashboard types).'
    })
    .registerMethod('Item.List', {
        params: DASHBOARD_ITEM_LIST_PARAMS_SCHEMA,
        response: DASHBOARD_ITEM_LIST_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description: 'List items on a dashboard (new structured shape).'
    })
    .registerMethod('Item.Add', {
        params: DASHBOARD_ITEM_ADD_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Add a single item by {kind, deviceId|groupId|locationId|tagId|actionId|widgetKind, ...}. Returns updated dashboard.'
    })
    .registerMethod('Item.AddBulk', {
        params: DASHBOARD_ITEM_ADD_BULK_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Insert N items in one call. Returns the updated dashboard.'
    })
    .registerMethod('Item.Update', {
        params: DASHBOARD_ITEM_UPDATE_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Patch size / entitySubId / widgetConfig / order / mobileLayout. Returns updated dashboard.'
    })
    .registerMethod('Item.Remove', {
        params: DASHBOARD_ITEM_REMOVE_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description: 'Remove a single item. Returns updated dashboard.'
    })
    .registerMethod('Item.Reorder', {
        params: DASHBOARD_ITEM_REORDER_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Atomically set item order from the supplied id sequence. Returns updated dashboard.'
    })
    .registerMethod('Item.SetAll', {
        params: DASHBOARD_ITEM_SET_ALL_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Replace all items in one transaction. Returns updated dashboard.'
    })
    .registerMethod('Template.List', {
        params: DASHBOARD_TEMPLATE_LIST_PARAMS_SCHEMA,
        response: DASHBOARD_TEMPLATE_LIST_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'List templates available to the org (org-scoped + builtins; org overrides shadow).'
    })
    .registerMethod('Template.Get', {
        params: DASHBOARD_TEMPLATE_GET_PARAMS_SCHEMA,
        response: DASHBOARD_TEMPLATE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Resolve a template by key (org-scoped first, then builtin).'
    })
    .registerMethod('Template.Preview', {
        params: DASHBOARD_TEMPLATE_PREVIEW_PARAMS_SCHEMA,
        response: DASHBOARD_TEMPLATE_PREVIEW_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Show what items the template would materialize against the given scope (without creating).'
    })
    .registerMethod('Template.Create', {
        params: DASHBOARD_TEMPLATE_CREATE_PARAMS_SCHEMA,
        response: DASHBOARD_TEMPLATE_SCHEMA,
        permission: {component: 'dashboards', operation: 'create'},
        description:
            'Create an org-scoped template. Cannot create builtins via API.'
    })
    .registerMethod('Template.Update', {
        params: DASHBOARD_TEMPLATE_UPDATE_PARAMS_SCHEMA,
        response: DASHBOARD_TEMPLATE_SCHEMA,
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Patch label / description / seed of an org-scoped template. Builtins are read-only.'
    })
    .registerMethod('Template.Delete', {
        params: DASHBOARD_TEMPLATE_DELETE_PARAMS_SCHEMA,
        response: DASHBOARD_TEMPLATE_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'delete'},
        description: 'Delete an org-scoped template. Builtins are read-only.'
    })
    .registerMethod('Template.SaveFromDashboard', {
        params: DASHBOARD_TEMPLATE_SAVE_FROM_DASHBOARD_PARAMS_SCHEMA,
        response: DASHBOARD_TEMPLATE_SCHEMA,
        permission: {component: 'dashboards', operation: 'create'},
        description:
            "Capture a dashboard's items + settings as a new org-scoped template."
    })
    .registerMethod('GetDefault', {
        params: DASHBOARD_GET_DEFAULT_PARAMS_SCHEMA,
        response: DASHBOARD_GET_DEFAULT_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            "Returns the org's current default dashboard id, or null if none set."
    })
    .registerMethod('SetDefault', {
        params: DASHBOARD_SET_DEFAULT_PARAMS_SCHEMA,
        response: {
            type: 'object',
            required: ['id'],
            properties: {id: DASHBOARD_ID_SCHEMA}
        },
        permission: {component: 'dashboards', operation: 'update'},
        description:
            'Marks one dashboard as default; clears any other default for this org atomically.'
    })
    .registerMethod('ClearDefault', {
        params: DASHBOARD_CLEAR_DEFAULT_PARAMS_SCHEMA,
        response: {type: 'object', additionalProperties: false, properties: {}},
        permission: {component: 'dashboards', operation: 'update'},
        description: 'Clear the org default dashboard.'
    })
    .registerMethod('ListPinned', {
        params: DASHBOARD_LIST_PINNED_PARAMS_SCHEMA,
        response: DASHBOARD_LIST_PINNED_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Per-user pinned dashboards (sortOrder, pinnedAt). Survives across devices.'
    })
    .registerMethod('Pin', {
        params: DASHBOARD_PIN_PARAMS_SCHEMA,
        response: {
            type: 'object',
            required: ['pinned'],
            properties: {pinned: {type: 'boolean', const: true}}
        },
        permission: {component: 'dashboards', operation: 'read'},
        description: 'Pin a dashboard for the calling user.'
    })
    .registerMethod('Unpin', {
        params: DASHBOARD_UNPIN_PARAMS_SCHEMA,
        response: {
            type: 'object',
            required: ['unpinned'],
            properties: {unpinned: {type: 'boolean', const: true}}
        },
        permission: {component: 'dashboards', operation: 'read'},
        description: 'Unpin a dashboard for the calling user.'
    })
    .registerMethod('ReorderPins', {
        params: DASHBOARD_REORDER_PINS_PARAMS_SCHEMA,
        response: {type: 'object', additionalProperties: false, properties: {}},
        permission: {component: 'dashboards', operation: 'read'},
        description: 'Reorder pinned dashboards by passing the new id sequence.'
    })
    .registerMethod('Clone', {
        params: DASHBOARD_CLONE_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'create'},
        description:
            'Deep-copy a dashboard within the same org. Optional scope override.'
    })
    .registerMethod('Export', {
        params: DASHBOARD_EXPORT_PARAMS_SCHEMA,
        response: DASHBOARD_EXPORT_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            "Export a dashboard. format: 'fm' (default) returns the Dashboard shape; 'grafana' returns Grafana JSON (schemaVersion 39)."
    })
    .registerMethod('Import', {
        params: DASHBOARD_IMPORT_PARAMS_SCHEMA,
        response: DASHBOARD_SCHEMA,
        permission: {component: 'dashboards', operation: 'create'},
        description:
            "Import a dashboard. format: 'fm' (default) accepts the Dashboard shape; 'grafana' accepts Grafana JSON (schemaVersion ≥ 39)."
    })
    .registerMethod('Activity.List', {
        params: DASHBOARD_ACTIVITY_LIST_PARAMS_SCHEMA,
        response: DASHBOARD_ACTIVITY_LIST_RESPONSE_SCHEMA,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'List recent activity for one dashboard (create, update, share, etc.). Newest first; clamped to 200 entries.'
    })
    .build();
