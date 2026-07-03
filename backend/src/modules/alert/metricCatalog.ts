/** Metric discovery — scan live device.status + BLU entities for numeric fields a rule can watch. */

import {bthomeObjectInfos} from '../../config/BTHomeData';
import type AbstractDevice from '../../model/AbstractDevice';
import type {bthomesensor_entity, entity_t} from '../../types';
import {
    type AlertDeviceClass,
    inferDeviceClass
} from '../../types/api/alertTaxonomy';
import type {BluetoothDeviceDto} from '../../types/api/virtualdevice';

export interface MetricPath {
    /** Dot-path root, e.g. `temperature:0`, `em:0`, `devicepower:0.battery`. */
    component: string;
    /** Leaf numeric field under the component, e.g. `tC`, `voltage`, `percent`. */
    field: string;
    /** Friendly label for pickers. */
    label?: string;
    /** Semantic class for icons, operators, units, and grouping. */
    deviceClass?: AlertDeviceClass;
    /** Display unit if the status object carries one (device-reported). */
    unit?: string;
}

export interface ComponentPath extends MetricPath {
    kind: 'metric' | 'state';
    valueType: 'number' | 'boolean' | 'string';
    values?: Array<number | string | boolean>;
}

type FieldMeta = {label: string; unit?: string; deviceClass: AlertDeviceClass};

// Field-name catalog. This is intentionally additive: unknown numeric fields
// still surface, just with a plain generated label.
const FIELD_META: Readonly<Record<string, FieldMeta>> = Object.freeze({
    tC: {label: 'Temperature', unit: '°C', deviceClass: 'temperature'},
    tF: {label: 'Temperature', unit: '°F', deviceClass: 'temperature'},
    rh: {label: 'Humidity', unit: '%', deviceClass: 'humidity'},
    lux: {label: 'Illuminance', unit: 'lx', deviceClass: 'illuminance'},
    illuminance: {
        label: 'Illuminance',
        unit: 'lx',
        deviceClass: 'illuminance'
    },
    pressure: {label: 'Pressure', unit: 'hPa', deviceClass: 'pressure'},
    co2: {label: 'CO2', unit: 'ppm', deviceClass: 'co2'},
    tvoc: {label: 'TVOC', unit: 'ug/m3', deviceClass: 'tvoc'},
    pm2_5: {label: 'PM2.5', unit: 'ug/m3', deviceClass: 'other'},
    pm10: {label: 'PM10', unit: 'ug/m3', deviceClass: 'other'},
    voltage: {label: 'Voltage', unit: 'V', deviceClass: 'voltage'},
    V: {label: 'Voltage', unit: 'V', deviceClass: 'voltage'},
    current: {label: 'Current', unit: 'A', deviceClass: 'current'},
    act_current: {label: 'Current', unit: 'A', deviceClass: 'current'},
    act_power: {label: 'Power', unit: 'W', deviceClass: 'power'},
    apower: {label: 'Power', unit: 'W', deviceClass: 'power'},
    power: {label: 'Power', unit: 'W', deviceClass: 'power'},
    total_act_power: {label: 'Total power', unit: 'W', deviceClass: 'power'},
    aenergy: {label: 'Energy', unit: 'Wh', deviceClass: 'energy'},
    energy: {label: 'Energy', unit: 'kWh', deviceClass: 'energy'},
    freq: {label: 'Frequency', unit: 'Hz', deviceClass: 'other'},
    frequency: {label: 'Frequency', unit: 'Hz', deviceClass: 'other'},
    percent: {label: 'Battery', unit: '%', deviceClass: 'battery'},
    battery_percent: {label: 'Battery', unit: '%', deviceClass: 'battery'},
    value: {label: 'Sensor value', deviceClass: 'other'}
});

const OBJ_NAME_TO_CLASS: Readonly<Record<string, AlertDeviceClass>> =
    Object.freeze({
        battery: 'battery',
        temperature: 'temperature',
        humidity: 'humidity',
        pressure: 'pressure',
        illuminance: 'illuminance',
        power: 'power',
        voltage: 'voltage',
        current: 'current',
        energy: 'energy',
        co2: 'co2',
        tvoc: 'tvoc',
        carbon_monoxide: 'carbon_monoxide',
        gas: 'gas',
        moisture: 'moisture',
        flood: 'moisture',
        motion: 'motion',
        moving: 'motion',
        opening: 'opening',
        door: 'opening',
        window: 'opening',
        presence: 'presence',
        occupancy: 'occupancy',
        tamper: 'tamper',
        vibration: 'vibration',
        garage_door: 'garage_door',
        lock: 'lock',
        sound: 'sound',
        smoke: 'smoke'
    });

function titleCase(s: string): string {
    return s
        .replace(/[_:.]+/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
        .trim();
}

function metricMeta(component: string, field: string): FieldMeta {
    const meta = FIELD_META[field];
    if (meta) return meta;
    const inferred = inferDeviceClass(component);
    return {label: titleCase(field), deviceClass: inferred};
}

function metricPath(component: string, field: string): MetricPath {
    const meta = metricMeta(component, field);
    return {
        component,
        field,
        label: `${titleCase(component)} ${meta.label}`,
        deviceClass: meta.deviceClass,
        unit: meta.unit
    };
}

function statePath(
    component: string,
    field: string,
    leaf: string | boolean
): ComponentPath {
    const meta = metricMeta(component, field);
    const valueType = typeof leaf === 'boolean' ? 'boolean' : 'string';
    const values =
        typeof leaf === 'boolean'
            ? [true, false]
            : field === 'state'
              ? Array.from(new Set([leaf, 'open', 'closed']))
              : [leaf];
    return {
        component,
        field,
        kind: 'state',
        valueType,
        label: `${titleCase(component)} ${meta.label}`,
        deviceClass: meta.deviceClass,
        unit: meta.unit,
        values
    };
}

/**
 * Walk a status object two levels deep (component → scalar field OR
 * component → sub-object → scalar field) and collect numeric leaves.
 * Two levels covers every current Shelly shape including devicepower's
 * nested `battery.percent`. Add a third level if a future device needs it.
 */
export function scanStatusMetrics(
    status: Record<string, unknown> | undefined
): MetricPath[] {
    if (!status) return [];
    const out: MetricPath[] = [];
    for (const [component, value] of Object.entries(status)) {
        if (!value || typeof value !== 'object') continue;
        for (const [field, leaf] of Object.entries(
            value as Record<string, unknown>
        )) {
            if (typeof leaf === 'number') {
                out.push(metricPath(component, field));
                continue;
            }
            if (leaf && typeof leaf === 'object' && !Array.isArray(leaf)) {
                for (const [sub, inner] of Object.entries(
                    leaf as Record<string, unknown>
                )) {
                    if (typeof inner === 'number') {
                        out.push(metricPath(`${component}.${field}`, sub));
                    }
                }
            }
        }
    }
    return out;
}

/** Discrete status leaves a component_state rule can watch. */
export function scanStatusStates(
    status: Record<string, unknown> | undefined
): ComponentPath[] {
    if (!status) return [];
    const out: ComponentPath[] = [];
    for (const [component, value] of Object.entries(status)) {
        if (!value || typeof value !== 'object') continue;
        for (const [field, leaf] of Object.entries(
            value as Record<string, unknown>
        )) {
            if (typeof leaf === 'boolean' || typeof leaf === 'string') {
                out.push(statePath(component, field, leaf));
            }
        }
    }
    return out;
}

function isBthomeSensor(e: entity_t): e is bthomesensor_entity {
    return e.type === 'bthomesensor';
}

/** BLU sensors expose a logical target that reads bthomesensor:N.value. */
function bluSensorMetric(
    device: AbstractDevice,
    entity: bthomesensor_entity
): MetricPath | null {
    const status = device.status as Record<string, unknown> | undefined;
    const component = status?.[`bthomesensor:${entity.properties.id}`] as
        | {value?: unknown}
        | undefined;
    if (typeof component?.value !== 'number') return null;
    const objName = entity.properties.objName?.toLowerCase();
    const deviceClass =
        (objName ? OBJ_NAME_TO_CLASS[objName] : undefined) ?? 'other';
    const label =
        entity.properties.bleDisplayName ??
        entity.properties.bleProductName ??
        entity.name ??
        titleCase(objName ?? entity.id);
    return {
        component: `component:${entity.id}`,
        field: 'value',
        label,
        deviceClass,
        unit: entity.properties.unit
    };
}

/** BLU sensors can also be boolean/string state targets. */
function bluSensorState(
    device: AbstractDevice,
    entity: bthomesensor_entity
): ComponentPath | null {
    const status = device.status as Record<string, unknown> | undefined;
    const component = status?.[`bthomesensor:${entity.properties.id}`] as
        | {value?: unknown}
        | undefined;
    const value = component?.value;
    if (typeof value !== 'boolean' && typeof value !== 'string') return null;
    const objName = entity.properties.objName?.toLowerCase();
    const deviceClass =
        (objName ? OBJ_NAME_TO_CLASS[objName] : undefined) ?? 'other';
    const label =
        entity.properties.bleDisplayName ??
        entity.properties.bleProductName ??
        entity.name ??
        titleCase(objName ?? entity.id);
    const valueType = typeof value === 'boolean' ? 'boolean' : 'string';
    return {
        component: `component:${entity.id}`,
        field: 'value',
        kind: 'state',
        valueType,
        values: typeof value === 'boolean' ? [true, false] : [value],
        label,
        deviceClass,
        unit: entity.properties.unit
    };
}

function bluetoothComponentMeta(
    component: BluetoothDeviceDto['components'][number]
): {label: string; deviceClass: AlertDeviceClass; unit?: string} {
    const info =
        component.objectId != null
            ? bthomeObjectInfos[component.objectId]
            : undefined;
    const objName = info?.name?.toLowerCase();
    const deviceClass =
        (objName ? OBJ_NAME_TO_CLASS[objName] : undefined) ??
        inferDeviceClass(component.componentKey);
    return {
        label:
            component.name ?? titleCase(info?.name ?? component.componentKey),
        deviceClass,
        unit: info?.unit
    };
}

function bluetoothComponentValue(
    status: Record<string, unknown>,
    componentKey: string,
    field: 'value' | 'state'
): unknown {
    const component = status[componentKey];
    if (!component || typeof component !== 'object') return undefined;
    return (component as Record<string, unknown>)[field];
}

export function collectBluetoothMetrics(
    device: BluetoothDeviceDto,
    status: Record<string, unknown>
): MetricPath[] {
    return device.components.flatMap((component) => {
        if (component.role === 'identity') return [];
        const value = bluetoothComponentValue(
            status,
            component.componentKey,
            'value'
        );
        if (typeof value !== 'number') return [];
        const meta = bluetoothComponentMeta(component);
        return [
            {
                component: component.componentKey,
                field: 'value',
                label: meta.label,
                deviceClass: meta.deviceClass,
                unit: meta.unit
            }
        ];
    });
}

export function collectBluetoothComponentPaths(
    device: BluetoothDeviceDto,
    status: Record<string, unknown>
): ComponentPath[] {
    const out: ComponentPath[] = collectBluetoothMetrics(device, status).map(
        (metric) => ({...metric, kind: 'metric', valueType: 'number'})
    );
    for (const component of device.components) {
        if (component.role === 'identity') continue;
        const meta = bluetoothComponentMeta(component);
        const value = bluetoothComponentValue(
            status,
            component.componentKey,
            'value'
        );
        if (typeof value === 'boolean' || typeof value === 'string') {
            out.push({
                component: component.componentKey,
                field: 'value',
                kind: 'state',
                valueType: typeof value === 'boolean' ? 'boolean' : 'string',
                values: typeof value === 'boolean' ? [true, false] : [value],
                label: meta.label,
                deviceClass: meta.deviceClass,
                unit: meta.unit
            });
        }
        const state = bluetoothComponentValue(
            status,
            component.componentKey,
            'state'
        );
        if (typeof state === 'string') {
            out.push({
                component: component.componentKey,
                field: 'state',
                kind: 'state',
                valueType: 'string',
                values: Array.from(new Set([state, 'open', 'closed'])),
                label: meta.label,
                deviceClass: meta.deviceClass,
                unit: meta.unit
            });
        }
    }
    return out.sort(
        (a, b) =>
            a.kind.localeCompare(b.kind) ||
            a.component.localeCompare(b.component) ||
            a.field.localeCompare(b.field)
    );
}

/** Metrics for one device (or the org-wide union) including BLU entities. */
export function collectMetrics(
    devices: readonly AbstractDevice[]
): MetricPath[] {
    const seen = new Set<string>();
    const out: MetricPath[] = [];
    const track = (m: MetricPath) => {
        const key = `${m.component}\0${m.field}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(m);
    };
    for (const device of devices) {
        for (const m of scanStatusMetrics(
            device.status as Record<string, unknown> | undefined
        )) {
            track(m);
        }
        for (const entity of device.entities ?? []) {
            if (!isBthomeSensor(entity)) continue;
            const m = bluSensorMetric(device, entity);
            if (m) track(m);
        }
    }
    out.sort(
        (a, b) =>
            a.component.localeCompare(b.component) ||
            a.field.localeCompare(b.field)
    );
    return out;
}

export function collectComponentPaths(
    devices: readonly AbstractDevice[]
): ComponentPath[] {
    const seen = new Set<string>();
    const out: ComponentPath[] = [];
    const track = (path: ComponentPath) => {
        const key = `${path.kind}\0${path.component}\0${path.field}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(path);
    };
    for (const metric of collectMetrics(devices)) {
        track({...metric, kind: 'metric', valueType: 'number'});
    }
    for (const device of devices) {
        for (const state of scanStatusStates(
            device.status as Record<string, unknown> | undefined
        )) {
            track(state);
        }
        for (const entity of device.entities ?? []) {
            if (!isBthomeSensor(entity)) continue;
            const state = bluSensorState(device, entity);
            if (state) track(state);
        }
    }
    out.sort(
        (a, b) =>
            a.kind.localeCompare(b.kind) ||
            a.component.localeCompare(b.component) ||
            a.field.localeCompare(b.field)
    );
    return out;
}
