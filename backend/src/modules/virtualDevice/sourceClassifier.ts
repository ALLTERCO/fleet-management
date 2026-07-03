// Single source of truth for classifying a device source component as a
// candidate role for virtual-device bindings and extractions. Replaces the
// duplicate helpers that used to live in bindingRepository + extractionRepository
// and disagreed on basic facts (button=boolean vs event, light=json fallback,
// bthomesensor unremapped).
//
// Callers project the classification onto their own DTO field names — the DTO
// surfaces (`dynamicCategory`, `valueType`, `writable`) stay unchanged.

import {bthomeObjectInfos} from '../../config/BTHomeData';
import type {VirtualDeviceRoleValueType} from '../../types/api/virtualdevice';
import {canonicalBTHomeComponentType} from './bthomeRemap';
import {
    connectorCandidateMetadata,
    connectorComponentKeys
} from './connectorSourceAdapters';
import {recordAt, stringValue} from './recordHelpers';

export type SourceFamily =
    | 'Virtual'
    | 'BTHome'
    | 'LNM'
    | 'Physical'
    | 'Connector'
    | null;

export interface SourceComponentClassification {
    componentKey: string;
    componentType: string;
    rawComponentType: string;
    sourceFamily: SourceFamily;
    roleValueType: VirtualDeviceRoleValueType;
    writable: boolean;
    label: string | null;
    unit?: string;
    objectId?: number | null;
    sourceHints: Record<string, unknown>;
}

export interface ClassifySourceComponentInput {
    deviceExternalId: string;
    deviceKind?: string | null;
    jdoc: Record<string, unknown>;
    componentKey: string;
}

export interface CollectBindableComponentKeysInput {
    jdoc: Record<string, unknown>;
    includeGroups?: boolean;
    includeConnectors?: boolean;
}

export function classifySourceComponent(
    input: ClassifySourceComponentInput
): SourceComponentClassification {
    const {componentKey, jdoc} = input;
    const rawComponentType = componentTypeFromKey(componentKey);
    const config = recordAt(recordAt(jdoc, 'settings'), componentKey);
    const status = recordAt(recordAt(jdoc, 'status'), componentKey);
    const connector = connectorCandidateMetadata(jdoc, componentKey);

    if (connector) {
        return {
            componentKey,
            componentType: rawComponentType,
            rawComponentType,
            sourceFamily: 'Connector',
            roleValueType: connector.valueType,
            writable: connector.writable,
            label: connector.label,
            objectId: null,
            sourceHints: {
                connector: connector.connector
            }
        };
    }

    if (rawComponentType === 'blutrv') {
        return classifyBluTrv(componentKey, config);
    }

    if (rawComponentType.startsWith('bthome')) {
        return classifyBTHome(componentKey, rawComponentType, config, status);
    }

    if (VIRTUAL_COMPONENT_TYPES.has(rawComponentType)) {
        return classifyVirtual(componentKey, rawComponentType, config);
    }

    return classifyPhysical(componentKey, rawComponentType, config);
}

export function collectBindableComponentKeys(
    input: CollectBindableComponentKeysInput
): string[] {
    const {jdoc, includeGroups = false, includeConnectors = true} = input;
    const keys = new Set<string>();
    for (const sectionName of ['settings', 'status']) {
        const section = recordAt(jdoc, sectionName);
        for (const key of Object.keys(section)) {
            if (!isComponentKey(key)) continue;
            if (!includeGroups && componentTypeFromKey(key) === 'group') {
                continue;
            }
            keys.add(key);
        }
    }
    if (includeConnectors) {
        for (const key of connectorComponentKeys(jdoc)) keys.add(key);
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
}

// --- internal classifiers ------------------------------------------------

const VIRTUAL_COMPONENT_TYPES = new Set([
    'boolean',
    'number',
    'text',
    'enum',
    'button',
    'group',
    'object'
]);

const VIRTUAL_VALUE_TYPES: Record<string, VirtualDeviceRoleValueType> = {
    boolean: 'boolean',
    number: 'number',
    text: 'string',
    enum: 'string',
    button: 'event',
    group: 'json',
    object: 'json'
};

// Writable Virtual components — group/object are containers, not directly set.
const VIRTUAL_WRITABLE = new Set([
    'boolean',
    'number',
    'text',
    'enum',
    'button'
]);

// Physical sensors expose a single numeric measurement, read-only.
const PHYSICAL_NUMERIC_SENSORS = new Set([
    'temperature',
    'humidity',
    'illuminance',
    'voltmeter',
    'currentmonitor',
    'pm1',
    'em',
    'em1'
]);

// Physical actuators with a clean on/off semantic.
const PHYSICAL_BOOLEAN_ACTUATORS = new Set(['switch']);

// Physical read-only boolean (no action endpoint by default).
const PHYSICAL_BOOLEAN_INPUTS = new Set(['input']);

// Rich actuators — multi-action surfaces; roleValueType stays 'json' until a
// caller pins it via profile/role metadata. sourceHints.actions lets the UI
// expose supported actions without pretending the component is a simple bool.
const PHYSICAL_RICH_ACTUATORS: Record<string, readonly string[]> = {
    light: ['Set', 'Toggle'],
    cover: ['Open', 'Close', 'Stop', 'GoToPosition'],
    rgb: ['Set', 'Toggle'],
    rgbw: ['Set', 'Toggle'],
    cct: ['Set', 'Toggle'],
    rgbcct: ['Set', 'Toggle']
};

function classifyVirtual(
    componentKey: string,
    rawComponentType: string,
    config: Record<string, unknown>
): SourceComponentClassification {
    return {
        componentKey,
        componentType: rawComponentType,
        rawComponentType,
        sourceFamily: 'Virtual',
        roleValueType: VIRTUAL_VALUE_TYPES[rawComponentType] ?? 'json',
        writable: VIRTUAL_WRITABLE.has(rawComponentType),
        label: stringValue(config.name),
        objectId: null,
        sourceHints: {}
    };
}

function classifyPhysical(
    componentKey: string,
    rawComponentType: string,
    config: Record<string, unknown>
): SourceComponentClassification {
    const label = stringValue(config.name);
    const richActions = PHYSICAL_RICH_ACTUATORS[rawComponentType];
    if (richActions) {
        return {
            componentKey,
            componentType: rawComponentType,
            rawComponentType,
            sourceFamily: 'Physical',
            roleValueType: 'json',
            writable: true,
            label,
            objectId: null,
            sourceHints: {actions: [...richActions]}
        };
    }
    if (PHYSICAL_BOOLEAN_ACTUATORS.has(rawComponentType)) {
        return {
            componentKey,
            componentType: rawComponentType,
            rawComponentType,
            sourceFamily: 'Physical',
            roleValueType: 'boolean',
            writable: true,
            label,
            objectId: null,
            sourceHints: {}
        };
    }
    if (PHYSICAL_BOOLEAN_INPUTS.has(rawComponentType)) {
        return {
            componentKey,
            componentType: rawComponentType,
            rawComponentType,
            sourceFamily: 'Physical',
            roleValueType: 'boolean',
            writable: false,
            label,
            objectId: null,
            sourceHints: {}
        };
    }
    if (PHYSICAL_NUMERIC_SENSORS.has(rawComponentType)) {
        return {
            componentKey,
            componentType: rawComponentType,
            rawComponentType,
            sourceFamily: 'Physical',
            roleValueType: 'number',
            writable: false,
            label,
            objectId: null,
            sourceHints: {}
        };
    }
    return {
        componentKey,
        componentType: rawComponentType,
        rawComponentType,
        sourceFamily: rawComponentType === 'lnm' ? 'LNM' : null,
        roleValueType: 'json',
        writable: false,
        label,
        objectId: null,
        sourceHints: {}
    };
}

function classifyBluTrv(
    componentKey: string,
    config: Record<string, unknown>
): SourceComponentClassification {
    return {
        componentKey,
        componentType: 'blutrv',
        rawComponentType: 'blutrv',
        sourceFamily: 'BTHome',
        roleValueType: 'json',
        writable: true,
        label: stringValue(config.name),
        objectId: null,
        sourceHints: {
            actions: ['setTarget', 'setEnabled', 'startBoost', 'clearBoost']
        }
    };
}

// --- BTHome ---------------------------------------------------------------

const BTHOME_VALUE_TYPE_BY_TARGET: Record<string, VirtualDeviceRoleValueType> =
    {
        temperature: 'number',
        humidity: 'number',
        illuminance: 'number',
        voltage: 'number',
        current: 'number',
        power: 'number',
        energy: 'number',
        rain: 'number',
        battery: 'number',
        pressure: 'number',
        co2: 'number',
        tvoc: 'number',
        motion: 'boolean',
        flood: 'boolean',
        door: 'boolean',
        smoke: 'boolean',
        gas: 'boolean',
        carbon_monoxide: 'boolean',
        tamper: 'boolean',
        vibration: 'boolean',
        presence: 'boolean',
        garage_door: 'boolean',
        lock: 'boolean',
        sound: 'boolean',
        button: 'event'
    };

function classifyBTHome(
    componentKey: string,
    rawComponentType: string,
    config: Record<string, unknown>,
    status: Record<string, unknown>
): SourceComponentClassification {
    if (rawComponentType === 'bthomedevice') {
        return {
            componentKey,
            componentType: 'bthomedevice',
            rawComponentType,
            sourceFamily: 'BTHome',
            roleValueType: 'json',
            writable: false,
            label: stringValue(config.name),
            objectId: null,
            sourceHints: {role: 'identity'}
        };
    }

    if (rawComponentType === 'bthomecontrol') {
        const meta = readBTHomeObjectMeta(config, status);
        return {
            componentKey,
            componentType: 'bthomecontrol',
            rawComponentType,
            sourceFamily: 'BTHome',
            // Controls are event-shaped (button/dimmer); UI treats them as
            // triggerable rather than settable.
            roleValueType: meta?.type === 'dimmer' ? 'number' : 'event',
            writable: sourceDeclaresWritable(config, status),
            label: stringValue(config.name) ?? meta?.objName ?? null,
            unit: meta?.unit || undefined,
            objectId: meta?.objId ?? null,
            sourceHints: {
                ...(meta?.objName ? {objName: meta.objName} : {}),
                ...(meta?.rawType ? {rawType: meta.rawType} : {})
            }
        };
    }

    // bthomesensor:N (and any future bthome* sensor variants)
    const meta = readBTHomeObjectMeta(config, status);
    const target = meta?.objName
        ? canonicalBTHomeComponentType(meta.objName)
        : null;
    const componentType = target ?? rawComponentType;
    const roleValueType: VirtualDeviceRoleValueType = target
        ? (BTHOME_VALUE_TYPE_BY_TARGET[target] ?? 'number')
        : meta?.type === 'binary_sensor'
          ? 'boolean'
          : 'number';
    return {
        componentKey,
        componentType,
        rawComponentType,
        sourceFamily: 'BTHome',
        roleValueType,
        writable: false,
        label: stringValue(config.name) ?? meta?.objName ?? null,
        unit: meta?.unit || undefined,
        objectId: meta?.objId ?? null,
        sourceHints: {
            ...(meta?.objName ? {objName: meta.objName} : {}),
            ...(meta?.rawType ? {rawType: meta.rawType} : {})
        }
    };
}

function sourceDeclaresWritable(
    config: Record<string, unknown>,
    status: Record<string, unknown>
): boolean {
    return (
        config.can_write === true ||
        config.writable === true ||
        status.can_write === true ||
        status.writable === true
    );
}

interface BTHomeObjectMeta {
    objId: number | null;
    objName: string;
    rawType: string;
    unit: string;
    type: 'sensor' | 'binary_sensor' | 'button' | 'dimmer' | null;
}

// Read BTHome obj metadata from settings/status with priority: explicit
// _attrs > config fields > static table by obj_id.
function readBTHomeObjectMeta(
    config: Record<string, unknown>,
    status: Record<string, unknown>
): BTHomeObjectMeta | null {
    const attrs = recordAt(config, '_attrs');
    const objId = numberValue(
        attrs.obj_id ?? config.obj_id ?? status.obj_id ?? attrs.objId
    );
    const staticInfo = objId !== null ? bthomeObjectInfos[objId] : undefined;
    const objName =
        stringValue(attrs.obj_name) ??
        stringValue(config.obj_name) ??
        stringValue(status.obj_name) ??
        staticInfo?.name ??
        null;
    const rawType =
        stringValue(attrs.type) ??
        stringValue(config.type) ??
        staticInfo?.type ??
        null;
    const unit =
        stringValue(attrs.unit) ??
        stringValue(config.unit) ??
        staticInfo?.unit ??
        null;
    if (objId === null && !objName) return null;
    return {
        objId,
        objName: objName ?? '',
        rawType: rawType ?? '',
        unit: unit ?? '',
        type:
            rawType === 'sensor' ||
            rawType === 'binary_sensor' ||
            rawType === 'button' ||
            rawType === 'dimmer'
                ? rawType
                : null
    };
}

// --- helpers --------------------------------------------------------------

function componentTypeFromKey(componentKey: string): string {
    return componentKey.split(':')[0] ?? 'component';
}

function isComponentKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z][a-z0-9_]*:\d+$/.test(value);
}

function numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}
