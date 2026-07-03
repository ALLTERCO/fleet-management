// Single source of truth for alert-rule kind metadata on the frontend.
// The backend descriptor at @api/alert ALERT_RULE_KIND_DESCRIPTORS is the
// authoritative shape; this module enriches each kind with the design-system
// metadata (icon, color token, category) needed to render pickers and badges.

import type {AlertRuleKind, AlertScopeType} from '@api/alert';

export type RuleCategory =
    | 'connectivity'
    | 'safety'
    | 'measurement'
    | 'operation';

export interface RuleKindMeta {
    readonly key: AlertRuleKind;
    readonly label: string;
    readonly description: string;
    readonly icon: string;
    readonly colorToken: string;
    readonly category: RuleCategory;
    readonly supportedScopeTypes: readonly AlertScopeType[];
}

const RULE_KIND_META: Readonly<Record<AlertRuleKind, RuleKindMeta>> = {
    device_offline: {
        key: 'device_offline',
        label: 'Device offline',
        description:
            'Fires when a device stops reporting for longer than the configured grace period.',
        icon: 'fa-solid fa-plug-circle-xmark',
        colorToken: '--rule-color-connectivity',
        category: 'connectivity',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    device_back_online: {
        key: 'device_back_online',
        label: 'Device back online',
        description:
            'Fires the moment a previously offline device starts reporting again.',
        icon: 'fa-solid fa-plug-circle-check',
        colorToken: '--rule-color-connectivity',
        category: 'connectivity',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    battery_below: {
        key: 'battery_below',
        label: 'Battery below threshold',
        description:
            'Fires when a battery-powered device drops under a chosen percentage.',
        icon: 'fa-solid fa-battery-quarter',
        colorToken: '--rule-color-measurement',
        category: 'measurement',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    smoke_alarm: {
        key: 'smoke_alarm',
        label: 'Smoke alarm',
        description: 'Fires the instant a smoke sensor enters alarm state.',
        icon: 'fa-solid fa-fire-flame-curved',
        colorToken: '--rule-color-safety',
        category: 'safety',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    flood_alarm: {
        key: 'flood_alarm',
        label: 'Flood alarm',
        description: 'Fires the instant a water leak sensor detects flooding.',
        icon: 'fa-solid fa-droplet',
        colorToken: '--rule-color-safety',
        category: 'safety',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    motion_detected: {
        key: 'motion_detected',
        label: 'Motion detected',
        description: 'Fires when a motion sensor reports movement.',
        icon: 'fa-solid fa-person-walking',
        colorToken: '--rule-color-safety',
        category: 'safety',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    component_threshold: {
        key: 'component_threshold',
        label: 'Sensor threshold',
        description:
            'Fires when a sensor or component value crosses a chosen value (e.g. power above 5 kW).',
        icon: 'fa-solid fa-chart-line',
        colorToken: '--rule-color-measurement',
        category: 'measurement',
        supportedScopeTypes: ['component', 'group', 'location', 'tag']
    },
    component_state: {
        key: 'component_state',
        label: 'Sensor state',
        description:
            'Fires when a sensor or component enters a chosen state (e.g. a relay turns on).',
        icon: 'fa-solid fa-toggle-on',
        colorToken: '--rule-color-measurement',
        category: 'measurement',
        supportedScopeTypes: ['component', 'group', 'location', 'tag']
    },
    firmware_operation_failed: {
        key: 'firmware_operation_failed',
        label: 'Firmware update failed',
        description:
            'Fires when a firmware operation reports a terminal failure.',
        icon: 'fa-solid fa-microchip',
        colorToken: '--rule-color-operation',
        category: 'operation',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    backup_operation_failed: {
        key: 'backup_operation_failed',
        label: 'Backup failed',
        description:
            'Fires when a backup operation reports a terminal failure.',
        icon: 'fa-solid fa-database',
        colorToken: '--rule-color-operation',
        category: 'operation',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    automation_run_failed: {
        key: 'automation_run_failed',
        label: 'Automation failed',
        description: 'Fires when an automation run ends in error.',
        icon: 'fa-solid fa-robot',
        colorToken: '--rule-color-operation',
        category: 'operation',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    grafana_alert: {
        key: 'grafana_alert',
        label: 'Grafana alert',
        description:
            'Fires when an alert from Grafana arrives via its webhook; auto-resolves when Grafana clears it.',
        icon: 'fa-solid fa-chart-line',
        colorToken: '--rule-color-operation',
        category: 'operation',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    heartbeat: {
        key: 'heartbeat',
        label: 'Heartbeat missed',
        description:
            'Deadman switch: fires when a device stops reporting telemetry within the expected interval.',
        icon: 'fa-solid fa-heart-pulse',
        colorToken: '--rule-color-connectivity',
        category: 'connectivity',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    energy_consumption_threshold: {
        key: 'energy_consumption_threshold',
        label: 'Energy consumption',
        description:
            'Fires when stored energy use over a time window crosses a chosen kWh threshold.',
        icon: 'fa-solid fa-bolt',
        colorToken: '--rule-color-measurement',
        category: 'measurement',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    },
    rate_of_change: {
        key: 'rate_of_change',
        label: 'Rate of change',
        description:
            'Fires when a metric changes faster than the configured per-second rate.',
        icon: 'fa-solid fa-arrow-trend-up',
        colorToken: '--rule-color-measurement',
        category: 'measurement',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    stuck_sensor: {
        key: 'stuck_sensor',
        label: 'Stuck sensor',
        description:
            'Fires when a sensor reading does not change for longer than the configured window.',
        icon: 'fa-solid fa-circle-pause',
        colorToken: '--rule-color-measurement',
        category: 'measurement',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    composite: {
        key: 'composite',
        label: 'Composite (AND/OR/NOT)',
        description:
            'Combines other rules with boolean logic and optional sliding window.',
        icon: 'fa-solid fa-diagram-project',
        colorToken: '--rule-color-operation',
        category: 'operation',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    anomaly_band: {
        key: 'anomaly_band',
        label: 'Anomaly band (mean ± k·σ)',
        description:
            'Fires when a metric falls outside the learned mean ± k·stddev band.',
        icon: 'fa-solid fa-wave-square',
        colorToken: '--rule-color-measurement',
        category: 'measurement',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    change_event: {
        key: 'change_event',
        label: 'Categorical change',
        description:
            'Fires when a categorical/state field transitions between specified values.',
        icon: 'fa-solid fa-arrow-right-arrow-left',
        colorToken: '--rule-color-operation',
        category: 'operation',
        supportedScopeTypes: ['device', 'component', 'group', 'location', 'tag']
    },
    device_event: {
        key: 'device_event',
        label: 'Device pushes event',
        description:
            'Fires when a device emits a runtime event (button push, sensor trip, script log, etc.).',
        icon: 'fa-solid fa-tower-broadcast',
        colorToken: '--rule-color-operation',
        category: 'operation',
        supportedScopeTypes: ['device', 'group', 'location', 'tag']
    }
};

const CATEGORY_LABELS: Readonly<Record<RuleCategory, string>> = {
    connectivity: 'Connectivity',
    safety: 'Safety',
    measurement: 'Measurement',
    operation: 'Operations'
};

const CATEGORY_ORDER: readonly RuleCategory[] = [
    'safety',
    'connectivity',
    'measurement',
    'operation'
];

/** Answer: every rule kind known to the frontend, in stable insertion order. */
export function listAllRuleKinds(): readonly RuleKindMeta[] {
    return Object.values(RULE_KIND_META);
}

/** Answer: the metadata for a specific rule kind. Throws on unknown input. */
export function describeRuleKind(key: AlertRuleKind): RuleKindMeta {
    const meta = RULE_KIND_META[key];
    if (!meta) throw new Error(`Unknown rule kind: ${key as string}`);
    return meta;
}

/** Answer: is this string a known rule kind? */
export function isRuleKind(value: string): value is AlertRuleKind {
    return value in RULE_KIND_META;
}

/** Answer: display label for any string, falling back to the input. */
export function labelForRuleKind(value: string): string {
    if (isRuleKind(value)) return RULE_KIND_META[value].label;
    return value;
}

/** Answer: human label for a category code. */
export function labelForCategory(category: RuleCategory): string {
    return CATEGORY_LABELS[category];
}

/** Answer: rule kinds grouped by category, in canonical display order. */
export function groupRuleKindsByCategory(): ReadonlyArray<{
    category: RuleCategory;
    label: string;
    kinds: readonly RuleKindMeta[];
}> {
    return CATEGORY_ORDER.map((category) => ({
        category,
        label: CATEGORY_LABELS[category],
        kinds: listAllRuleKinds().filter((meta) => meta.category === category)
    }));
}
