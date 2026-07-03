/** KPI metric definition for DashKpiStrip. */
export interface DashKpiMetric {
    key: string;
    label: string;
    value: number | string | null;
    unit?: string;
    delta?: string | null;
    subtitle?: string;
    live?: boolean;
    decimals?: number;
    sparkline?: number[];
    sparkColor?: string;
    threshold?: {warning?: number; danger?: number};
    updatedAt?: number;
    expectedIntervalMs?: number;
}

/** Insight pill for DashInsights */
export interface DashInsight {
    key: string;
    color: 'blue' | 'warning' | 'danger' | 'success';
    text: string;
}

/** Time-series data point — shared by all charts */
export interface TimePoint {
    bucket: string;
    value: number;
}

/** Per-device time-series point — for stacked charts */
export interface DeviceTimePoint {
    bucket: string;
    deviceId: number;
    value: number;
}

/** Column definition for DashDeviceList and DashMeterTable */
export interface DashColumnDef {
    key: string;
    label: string;
    align?: 'left' | 'right';
    format?: (value: any, row?: any) => string;
    sortable?: boolean;
    width?: string;
}

/** Generic device row — each dashboard maps its data to this */
export interface DashDeviceRow {
    id: number;
    shellyId: string;
    name: string;
    online: boolean;
    type?: 'switch' | '3ph_em' | 'mono_em' | 'pm' | 'sensor';
    groupName?: string;
    [key: string]: any;
}

/** Panel scope — stored in chart_settings JSONB */
export interface PanelScope {
    scope: 'fleet' | 'group' | 'location' | 'tag' | 'devices';
    groupId?: number;
    locationId?: number;
    tagId?: number;
    deviceIds?: string[];
    aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'latest';
}

// One device-bubble for DashFleetBubbles.
export interface DashFleetBubbleDevice {
    id: number | string;
    name: string;
    metric: number;
    status: 'online' | 'offline' | 'alarm';
}

/** Gauge config */
export interface DashGaugeConfig {
    value: number;
    min: number;
    max: number;
    unit: string;
    label: string;
    color?: string;
    thresholds?: {value: number; color: string}[];
}
