import Log4js from 'log4js';
import {
    bthomeObjectInfos,
    isBTHomeDeviceLevelObjectId
} from '../config/BTHomeData';
import {isWallDisplayInfo} from '../model/deviceCapabilities';
import {getServiceClaim} from '../model/deviceInfo';
import {extractComponentTypes} from '../model/deviceProfile';
import {NON_COMPONENT_KEYS} from '../model/deviceStatusKeys';
import {
    partitionServiceOwnedComponents,
    projectOwnership,
    type ServiceGroup,
    serviceOwnedKeys
} from '../model/entity/composerOwnership';
import type ShellyDevice from '../model/ShellyDevice';
import type {
    blutrv_entity,
    bthomecontrol_entity,
    bthomedevice_entity,
    bthomesensor_entity,
    camerazone_entity,
    cover_entity,
    cury_entity,
    entity_t,
    matter_entity,
    media_entity,
    presence_entity,
    presencezone_entity,
    schedule_entity,
    service_entity,
    switch_entity,
    ui_entity,
    virtual_boolean_entity,
    virtual_button_entity,
    virtual_group_entity,
    virtual_number_entity,
    virtual_text_entity
} from '../types';
import {UNKNOWN_COMPONENT_TYPE_COUNTER} from './coverageConstants';
import {incrementLabeledCounter} from './Observability';
import {isPlainObject} from './util/isPlainObject';

const logger = Log4js.getLogger('ShellyComponents');

/**
 * Wall Display devices have non-standard component patterns
 * (singleton keys without instance suffix, config-only components).
 * Gate Wall Display-specific logic on app/model to avoid collisions
 * with standard devices.
 */
function isWallDisplay(shelly: ShellyDevice): boolean {
    return isWallDisplayInfo(shelly.info);
}

/** Resolve a service entity label, preferring whatever the device shipped
 *  in Service.GetInfo. Falls back to a keyword heuristic for legacy XT1
 *  firmware that doesn't return a label; final fallback title-cases the
 *  service-type string. Device-supplied label wins so future firmware doesn't
 *  need a code change here. */
function serviceLabel(svcType: string, serviceMeta: unknown): string {
    const fromDevice = readLabelFromMeta(serviceMeta);
    if (fromDevice) return fromDevice;
    return heuristicServiceLabel(svcType);
}

function readLabelFromMeta(meta: unknown): string | undefined {
    if (!meta || typeof meta !== 'object') return undefined;
    const candidate = meta as {
        label?: unknown;
        title?: unknown;
        name?: unknown;
    };
    for (const v of [candidate.label, candidate.title, candidate.name]) {
        if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return undefined;
}

function heuristicServiceLabel(svcType: string): string {
    const lower = svcType.toLowerCase();
    if (lower.includes('hvac') || lower.includes('thermostat'))
        return 'HVAC Control';
    if (lower.includes('heating')) return 'Heating Control';
    if (lower.includes('valve')) return 'Valve Control';
    if (lower.includes('charger') || lower.includes('evse'))
        return 'EV Charger';
    if (lower.includes('irrigation')) return 'Irrigation Control';
    return (
        svcType.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ||
        'Service Control'
    );
}

export type ServiceCategory =
    | 'hvac'
    | 'valve'
    | 'ev_charger'
    | 'irrigation'
    | 'generic';

// Category is the machine-readable sibling of the label heuristic above —
// the frontend picks a card by category instead of regexing serviceType.
function serviceCategory(svcType: string): ServiceCategory {
    const lower = svcType.toLowerCase();
    if (/hvac|thermostat|heat/.test(lower)) return 'hvac';
    if (lower.includes('valve')) return 'valve';
    if (lower.includes('charger') || lower.includes('evse'))
        return 'ev_charger';
    if (lower.includes('irrigation')) return 'irrigation';
    return 'generic';
}

// Addon = component id ≥ 100 AND device sets sys.device.addon_type.
function isAddonComponent(status: any, shelly?: ShellyDevice): boolean {
    return status?.id >= 100 && !!shelly?.config.sys?.device?.addon_type;
}

// Mutates the entity's properties to add parent+role when the underlying
// component carries an _attrs.owner claim. Used by the virtual-component
// emit path; composeComponents projects ownership inline at construct time.
function annotateOwnership(
    entity: entity_t,
    componentConfig: unknown,
    deviceEntityPrefix: string
): void {
    const ownership = projectOwnership({
        componentConfig,
        deviceShellyID: deviceEntityPrefix
    });
    if (ownership.parent) {
        (entity.properties as Record<string, unknown>).parent =
            ownership.parent;
    }
    if (ownership.role) {
        (entity.properties as Record<string, unknown>).role = ownership.role;
    }
}

// Builds the per-service entity from a single ServiceGroup. Pulled out of
// the main proposeEntities loop so the loop reads top-down.
function serviceEntityFromGroup(
    group: ServiceGroup,
    shelly: ShellyDevice,
    deviceName: string
): service_entity {
    const svcIndex = group.serviceKey.split(':')[1] ?? '0';
    const jwtKey = `svc${svcIndex}`;
    const svcType: string =
        shelly.info.jwt?.xt1?.[jwtKey]?.type ??
        getServiceClaim(shelly.info, svcIndex)?.type ??
        '';
    const productName: string =
        shelly.info.jwt?.n ?? deviceName ?? 'Service Device';
    const serviceMeta = (
        shelly.config[group.serviceKey] as {_meta?: unknown} | undefined
    )?._meta;
    return {
        name: serviceLabel(svcType, serviceMeta),
        id: `${shelly.id}_${svcIndex}:service`,
        type: 'service',
        source: shelly.shellyID,
        properties: {
            id: Number.parseInt(svcIndex, 10) || 0,
            serviceType: svcType,
            category: serviceCategory(svcType),
            serviceKey: group.serviceKey,
            productName,
            components: group.components
        }
    };
}

// Constants

const VIRTUAL_TYPES = [
    'boolean',
    'number',
    'text',
    'enum',
    'presencezone',
    'camerazone',
    'button',
    'bthomesensor',
    'bthomedevice',
    'bthomecontrol',
    'group',
    'object'
];

// Union keys across multiple sources (status + config). Virtual components
// stay out of Status until first write, but live in Config from creation —
// without the union, fresh virtuals never compose into entities.
function getAllInstancesKeys(type: string, ...sources: any[]): string[] {
    const seen = new Set<string>();
    for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        for (const key of Object.keys(src)) {
            if (key.startsWith(type)) seen.add(key);
        }
    }
    return [...seen];
}

// ----------------------------------------------------------------------------------
// BTHome Controls (learned BLE remote buttons/dimmers)
// ----------------------------------------------------------------------------------

export function composeBTHomeControl(
    config: any,
    _deviceName: string,
    deviceId: number,
    shellyID?: string
): bthomecontrol_entity | null {
    const componentId = config.id;
    if (typeof componentId !== 'number' || typeof config?.addr !== 'string') {
        return null;
    }

    const id = `${deviceId}_${componentId}:bthomecontrol`;
    const name = config?.name ?? `BLE Control ${componentId}`;

    return {
        name,
        id,
        type: 'bthomecontrol',
        source: shellyID ?? String(deviceId),
        properties: {
            id: componentId,
            addr: config?.addr
        }
    };
}

// ----------------------------------------------------------------------------------
// BTHome Devices (physical BLE devices)
// ----------------------------------------------------------------------------------

export function getBTHomeGatewayEventObjIds(gwVer: string): number[] {
    // `ver` is typed string but comes straight from device firmware; a
    // non-string value would make .split throw and abort device admission.
    const gwVerParts =
        typeof gwVer === 'string'
            ? gwVer.split('.').map((s: string) => Number.parseInt(s, 10) || 0)
            : [];
    while (gwVerParts.length < 3) gwVerParts.push(0);
    const gwSupportsDeviceEvents =
        gwVerParts[0] > 1 || (gwVerParts[0] === 1 && gwVerParts[1] >= 6);

    return gwSupportsDeviceEvents
        ? Object.entries(bthomeObjectInfos)
              .filter(([id]) =>
                  isBTHomeDeviceLevelObjectId(Number.parseInt(id, 10))
              )
              .map(([id]) => Number.parseInt(id, 10))
        : [];
}

export function collectBTHomeChildSensorIds(
    deviceConfig: Record<string, any>,
    addr: string,
    deviceId: number
): string[] {
    const childIds: string[] = [];
    for (const sKey of Object.keys(deviceConfig)) {
        if (!sKey.startsWith('bthomesensor:')) continue;
        const sensorConfig = deviceConfig[sKey];
        if (
            sensorConfig?.addr === addr &&
            !isBTHomeDeviceLevelObjectId(sensorConfig?.obj_id)
        ) {
            const sId = sensorConfig?.id;
            if (sId != null) childIds.push(`${deviceId}_${sId}:bthomesensor`);
        }
    }
    return childIds;
}

export function composeBthomeDevice(
    config: any,
    status: any,
    _deviceName: string,
    deviceId: number,
    shellyID: string,
    childSensorIds: string[],
    eventObjIds: number[] = []
): bthomedevice_entity {
    const componentId = config.id;
    const productName = config.meta?.productName ?? '';
    const modelId = config.meta?.modelId ?? '';
    // Forward any well-shaped control entry — `kind` authority lives in
    // getBTHomeControlKind(). Listing specific kinds here duplicates that
    // registry and forces this filter to be updated whenever a new BTHome
    // control type ships.
    const controls = Array.isArray(config.meta?.controls)
        ? config.meta.controls.filter(
              (control: any) =>
                  typeof control?.objId === 'number' &&
                  typeof control?.idx === 'number' &&
                  typeof control?.label === 'string' &&
                  typeof control?.kind === 'string'
          )
        : [];
    const displayName =
        config.name || productName || `BLE Device ${componentId}`;
    const errors: string[] = Array.isArray(status?.errors) ? status.errors : [];

    return {
        name: displayName,
        id: `${deviceId}_${componentId}:bthomedevice`,
        type: 'bthomedevice',
        source: shellyID,
        properties: {
            id: componentId,
            addr: config.addr,
            productName,
            modelId,
            paired: !!status?.paired,
            controls,
            childSensorIds,
            eventObjIds,
            errors
        }
    };
}

// ----------------------------------------------------------------------------------
// BTHome Sensors
// ----------------------------------------------------------------------------------

export function composeBTHomeSensor(
    config: any,
    bleDeviceName: string,
    deviceId: number,
    shellyID?: string
): bthomesensor_entity | null {
    const objId = config.obj_id;
    if (isBTHomeDeviceLevelObjectId(objId)) {
        return null;
    }
    const info = bthomeObjectInfos[objId] ?? {};

    const objName = info?.name ?? '';
    const unit = info?.unit ?? '';
    const sensorType = info?.type ?? '';

    const componentId = config.id;

    const id = `${deviceId}_${componentId}:bthomesensor`;

    // Capitalize first letter of object name for display
    const displayObjName = objName
        ? objName.charAt(0).toUpperCase() + objName.slice(1).replace(/_/g, ' ')
        : `Sensor ${objId}`;

    // Priority: user-set name > "BleDeviceName SensorType" > "SensorType"
    const name =
        config?.name ??
        (bleDeviceName ? `${bleDeviceName} ${displayObjName}` : displayObjName);

    return {
        name,
        id,
        type: 'bthomesensor',
        source: shellyID ?? String(deviceId),
        properties: {
            id: componentId,
            unit,
            sensorType,
            objName,
            addr: config?.addr
        }
    };
}

// ----------------------------------------------------------------------------------
// Virtual Components
// ----------------------------------------------------------------------------------

function composeVirtualComponent(
    config: any,
    deviceName: string,
    deviceId: number,
    displayName: string,
    type: string,
    restProps?: any,
    shellyID?: string
) {
    const name = config?.name ?? (deviceName || displayName);

    const componentId = config.id; // important

    const id = `${deviceId}_${componentId}:${type}`;
    const view = config.meta?.ui?.view ?? null;

    return {
        name,
        id,
        source: shellyID ?? String(deviceId),
        type,
        properties: {
            id: componentId,
            view,
            ...(typeof restProps === 'object' ? restProps : {})
        }
    };
}

function composeVirtualBoolean(
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): virtual_boolean_entity {
    const labels = config.meta?.ui?.titles;

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Boolean',
        'boolean',
        {
            labelFalse: labels?.[0] || 'Off',
            labelTrue: labels?.[1] || 'On'
        },
        shellyID
    );
}

function composeVirtualNumber(
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): virtual_number_entity {
    const min = config.min;
    const max = config.max;
    const unit = config.meta?.ui?.unit;
    const step = config?.meta?.ui?.step ?? 1;

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Number',
        'number',
        {
            unit,
            min,
            max,
            step
        },
        shellyID
    );
}

function composeVirtualText(
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): virtual_text_entity {
    const maxLength = config.max_len;

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Text',
        'text',
        {
            maxLength
        },
        shellyID
    );
}

function composeVirtualEnum(
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): virtual_text_entity {
    // options may be absent on a partially-fetched enum; an empty list yields
    // empty options rather than throwing and failing composition.
    const values: string[] = Array.isArray(config.options)
        ? config.options
        : [];
    const labels = config.meta?.ui?.titles ?? {};

    const options: Record<string, string> = {};

    for (const value of values) {
        const label = labels[value] || value;
        options[value] = label;
    }

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Enum',
        'enum',
        {
            options
        },
        shellyID
    );
}

function composeVirtualButton(
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): virtual_button_entity {
    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Button',
        'button',
        undefined,
        shellyID
    );
}

function composeVirtualGroup(
    config: any,
    status: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): virtual_group_entity {
    const members: string[] = Array.isArray(status?.value) ? status.value : [];

    return composeVirtualComponent(
        config,
        deviceName,
        deviceId,
        'Group',
        'group',
        {members},
        shellyID
    ) as virtual_group_entity;
}

export function composeDynamicComponent(
    type:
        | 'button'
        | 'boolean'
        | 'number'
        | 'text'
        | 'enum'
        | 'group'
        | 'bthomesensor'
        | string,
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string,
    status?: any
): entity_t | null {
    switch (type) {
        case 'boolean':
            return composeVirtualBoolean(
                config,
                deviceName,
                deviceId,
                shellyID
            );

        case 'number':
            return composeVirtualNumber(config, deviceName, deviceId, shellyID);

        case 'text':
            return composeVirtualText(config, deviceName, deviceId, shellyID);

        case 'enum':
            return composeVirtualEnum(config, deviceName, deviceId, shellyID);

        case 'button':
            return composeVirtualButton(config, deviceName, deviceId, shellyID);

        case 'bthomesensor':
            return composeBTHomeSensor(config, deviceName, deviceId, shellyID);

        case 'bthomecontrol':
            return composeBTHomeControl(config, deviceName, deviceId, shellyID);

        case 'bthomedevice':
            // bthomedevice composed separately in composeVirtualComponents (needs child sensor lookup)
            // This case handles component_added events for new devices
            return composeBthomeDevice(
                config,
                status,
                deviceName,
                deviceId,
                shellyID ?? String(deviceId),
                []
            );

        case 'group':
            return composeVirtualGroup(
                config,
                status,
                deviceName,
                deviceId,
                shellyID
            );

        case 'presencezone':
            return composePresenceZone(config, deviceName, deviceId, shellyID);

        case 'camerazone':
            return composeCameraZone(config, deviceName, deviceId, shellyID);

        case 'object':
            // Object components (XT1 service devices, e.g. EV charger phase_info)
            return composeVirtualComponent(
                config,
                deviceName,
                deviceId,
                'Object',
                'object',
                undefined,
                shellyID
            );

        default:
            logger.debug(
                'No dynamic virtual/BTHome composer for type: %s',
                type
            );
            return null;
    }
}

function composeVirtualComponents(shelly: ShellyDevice): entity_t[] {
    const deviceStatus = shelly.status;
    const deviceConfig = shelly.config;
    const deviceName = shelly.info.name as string;
    const deviceId = shelly.id;

    // Build BLE device name lookup: addr → name
    // enrichBTHomeDeviceMeta() runs on connect and persists productName in meta,
    // so meta.productName is always available for known devices.
    const bleDeviceNames: Record<string, string> = {};
    const bleDeviceInfo: Record<
        string,
        {productName?: string; modelId?: string; displayName?: string}
    > = {};
    for (const key of Object.keys(deviceConfig)) {
        if (key.startsWith('bthomedevice:')) {
            const cfg = deviceConfig[key];
            if (!cfg?.addr) continue;
            const name = cfg.name || cfg.meta?.productName;
            if (name) bleDeviceNames[cfg.addr] = name;
            bleDeviceInfo[cfg.addr] = {
                productName: cfg.meta?.productName,
                modelId: cfg.meta?.modelId,
                displayName: name // user-set name takes priority over productName
            };
        }
    }

    // BLE addresses owned by BluTrv — skip their bthomesensor entities
    // (blutrv:N already exposes target_C/current_C, the bthomesensor temps are redundant)
    const trvAddrs = new Set<string>();
    for (const key of Object.keys(deviceConfig)) {
        if (key.startsWith('blutrv:') && deviceConfig[key]?.addr) {
            trvAddrs.add(deviceConfig[key].addr);
        }
    }

    const entities: entity_t[] = [];

    // BTHome devices: create entity per physical BLE device (skip BluTrv addrs)
    // Build addr → bthomedevice key mapping for child sensor tagging
    const addrToDeviceKey: Record<string, string> = {};

    // Gateway firmware >= 1.6.0: event-based objects (button, dimmer) handled at device level
    const eventObjIds = getBTHomeGatewayEventObjIds(shelly.info.ver as string);

    for (const key of Object.keys(deviceConfig)) {
        if (!key.startsWith('bthomedevice:')) continue;
        const cfg = deviceConfig[key];
        if (!cfg?.addr || trvAddrs.has(cfg.addr)) continue;
        addrToDeviceKey[cfg.addr] = key;

        const childIds = collectBTHomeChildSensorIds(
            deviceConfig,
            cfg.addr,
            deviceId
        );

        entities.push(
            composeBthomeDevice(
                cfg,
                deviceStatus[key],
                deviceName,
                deviceId,
                shelly.shellyID,
                childIds,
                eventObjIds
            )
        );
    }

    // XT1 / PLC devices: enumerate every service:N and emit one service
    // entity per service. Multi-service devices stop collapsing into one bag.
    const serviceGroups = partitionServiceOwnedComponents({
        deviceStatus,
        deviceConfig,
        deviceShellyID: shelly.shellyID
    });
    const ownedKeys = serviceOwnedKeys(serviceGroups);
    for (const group of serviceGroups) {
        entities.push(serviceEntityFromGroup(group, shelly, deviceName));
    }

    for (const type of VIRTUAL_TYPES) {
        const allVirtualComponentsKeys = getAllInstancesKeys(
            type,
            deviceStatus,
            deviceConfig
        );

        for (const key of allVirtualComponentsKeys) {
            const config = deviceConfig[key];

            if (!config || typeof config !== 'object') {
                logger.warn(
                    'Skipping virtual component %s on %s: missing config',
                    key,
                    shelly.shellyID
                );
                continue;
            }

            // Skip service-owned virtual components — already grouped into
            // the service entity above. Real I/O entities are NOT skipped
            // (they keep composing as standalone with parent+role attached
            // so the flat list still works).
            if (ownedKeys.has(key)) continue;

            // Skip bthomedevice — already composed above with child sensor linkage
            if (type === 'bthomedevice') continue;

            // Skip bthomesensor entities that belong to a BluTrv device
            // (blutrv entity already shows target_C/current_C/battery)
            if (
                type === 'bthomesensor' &&
                config.addr &&
                trvAddrs.has(config.addr)
            ) {
                continue;
            }

            // For BTHome sensors, use the BLE device name instead of host device name
            const nameForComponent =
                type === 'bthomesensor' && config.addr
                    ? (bleDeviceNames[config.addr] ?? '')
                    : deviceName;

            try {
                const entity: entity_t | null = composeDynamicComponent(
                    type,
                    config,
                    nameForComponent,
                    deviceId,
                    shelly.shellyID,
                    deviceStatus[key]
                );

                if (entity) {
                    if (
                        entity.type === 'bthomesensor' &&
                        typeof config.addr === 'string'
                    ) {
                        const props = (entity as bthomesensor_entity)
                            .properties;
                        const info = bleDeviceInfo[config.addr];
                        if (info?.productName)
                            props.bleProductName = info.productName;
                        if (info?.modelId) props.bleModelId = info.modelId;
                        if (info?.displayName)
                            props.bleDisplayName = info.displayName;
                        const parentKey = addrToDeviceKey[config.addr];
                        if (parentKey) props.parentDeviceKey = parentKey;
                    }
                    annotateOwnership(entity, config, String(shelly.id));
                    entities.push(entity);
                }
            } catch (err) {
                logger.warn(
                    'Failed to compose virtual component %s on %s: %s',
                    key,
                    shelly.shellyID,
                    err instanceof Error ? err.message : String(err)
                );
            }
        }
    }

    return entities;
}

// ----------------------------------------------------------------------------------
// Build-in Components
// ----------------------------------------------------------------------------------

function composeComponents(
    shelly: ShellyDevice,
    type: string,
    title: string,
    parser?: (
        config: any,
        status: any,
        shelly?: ShellyDevice
    ) => Record<string, any>,
    idSuffix?: string
): entity_t[] {
    const keys = Object.keys(shelly.status).filter((key) => {
        if (!key.startsWith(`${type}:`)) return false;
        // A device may report a non-object component value; skip it so it
        // never becomes an entity with an undefined-keyed id.
        if (!isPlainObject(shelly.status[key])) {
            logger.warn(
                '%s: %s status is not a component object, skipping',
                shelly.shellyID,
                key
            );
            return false;
        }
        // Non-numeric id would key a malformed entity id.
        if (typeof shelly.status[key].id !== 'number') {
            logger.warn(
                '%s: %s status has non-numeric id, skipping',
                shelly.shellyID,
                key
            );
            return false;
        }
        return true;
    });

    const suffix = idSuffix || type;

    return keys.map((key) => {
        const entity_status = shelly.status[key];
        const entity_config = shelly.config[key];
        const device_name = shelly.info.name;

        const hasMultiple = keys.length > 1;
        const prefix = hasMultiple ? `${entity_status.id}) ` : '';
        const name =
            typeof entity_config?.name === 'string' && entity_config.name
                ? entity_config.name
                : hasMultiple
                  ? `${prefix}${title || type}`
                  : device_name || title || type;

        // Pass device-reported errors through to the frontend. The field is
        // spec'd as string[], but coerce a bare value so one malformed device
        // report can't throw here and unwind the whole device's admission.
        const rawErrors = entity_status?.errors;
        const errors: string[] = Array.isArray(rawErrors)
            ? rawErrors
            : rawErrors
              ? [String(rawErrors)]
              : [];
        if (errors.length) {
            logger.warn(
                '%s: %s has errors: %s',
                shelly.shellyID,
                key,
                errors.join('; ')
            );
        }

        let restProps = null;
        try {
            if (typeof parser === 'function') {
                restProps = parser(entity_config, entity_status, shelly) ?? {};
            }
        } catch (e) {
            logger.error(`Error parsing ${key}`, e);
        }

        const ownership = projectOwnership({
            componentConfig: entity_config,
            deviceShellyID: String(shelly.id)
        });

        // Generic factory across all native component types — variant fields
        // come from the optional `parser`. Returning as entity_t and letting
        // callers narrow on `type` keeps the union check at the use site.
        return {
            name,
            id: `${shelly.id}_${entity_status.id}:${suffix}`,
            type,
            source: shelly.shellyID,
            properties: {
                id: entity_status.id,
                ...(restProps ?? {}),
                ...(errors.length ? {errors} : {}),
                ...(ownership.parent ? {parent: ownership.parent} : {}),
                ...(ownership.role ? {role: ownership.role} : {})
            }
        } as entity_t;
    });
}

function composeCovers(shelly: ShellyDevice): cover_entity[] {
    const covers = composeComponents(
        shelly,
        'cover',
        'Cover'
    ) as cover_entity[];

    const sysConfig = shelly.config.sys;

    covers.forEach((cover) => {
        const key =
            cover.properties.id === 0 ? 'cover' : `cover${cover.properties.id}`;
        // Optional chaining guards null/undefined but not a non-string value —
        // a device reporting a numeric ui_data entry would make .split throw
        // and abort the whole device's admission, so require a string first.
        const raw = sysConfig?.ui_data?.[key];
        const favorites =
            typeof raw === 'string'
                ? raw
                      .split(',')
                      .map(Number)
                      .filter((x: number) => x >= 0 && x <= 100)
                      .sort((a: number, b: number) => a - b)
                : [];

        cover.properties.favorites = [...new Set<number>(favorites)];
    });

    return covers;
}

// ----------------------------------------------------------------------------------
// Cury (Scent Diffuser) Component
// ----------------------------------------------------------------------------------

function composeCury(shelly: ShellyDevice): cury_entity[] {
    const curyKeys = Object.keys(shelly.status).filter((key) => {
        if (!key.startsWith('cury:')) return false;
        if (typeof shelly.status[key]?.id !== 'number') {
            logger.warn(
                '%s: %s status has non-numeric id, skipping',
                shelly.shellyID,
                key
            );
            return false;
        }
        return true;
    });
    return curyKeys.map((key) => {
        const entityStatus = shelly.status[key];
        const entityConfig = shelly.config[key];
        const deviceName = shelly.info.name;

        return {
            name:
                entityConfig?.name ||
                (curyKeys.length > 1 ? `${entityStatus.id}) ` : '') +
                    (deviceName || 'Scent Diffuser'),
            id: `${shelly.id}_${entityStatus.id}:cury`,
            type: 'cury' as const,
            source: shelly.shellyID,
            properties: {
                id: entityStatus.id,
                mode: entityStatus.mode,
                awayMode: entityStatus.away_mode
            }
        };
    });
}

// ----------------------------------------------------------------------------------
// Media Component (Wall Display player/radio)
// Wall Display only — singleton key "media" (no instance suffix, no id field)
// ----------------------------------------------------------------------------------

function composeMedia(shelly: ShellyDevice): media_entity[] {
    if (!isWallDisplay(shelly)) return [];

    const mediaStatus = shelly.status['media:0'] ?? shelly.status.media;
    if (!mediaStatus || typeof mediaStatus !== 'object') return [];

    const deviceName = shelly.info.name as string;

    return [
        {
            name: deviceName || 'Media',
            id: `${shelly.id}_0:media`,
            type: 'media' as const,
            source: shelly.shellyID,
            properties: {
                id: 0
            }
        }
    ];
}

// ----------------------------------------------------------------------------------
// UI Component (Wall Display screen)
// Wall Display only — singleton key "ui" in config (not in status, no instance suffix)
// ----------------------------------------------------------------------------------

function composeUi(shelly: ShellyDevice): ui_entity[] {
    if (!isWallDisplay(shelly)) return [];

    const uiConfig = shelly.config['ui:0'] ?? shelly.config.ui;
    if (!uiConfig || typeof uiConfig !== 'object') return [];

    const deviceName = shelly.info.name as string;

    return [
        {
            name: deviceName || 'Display',
            id: `${shelly.id}_0:ui`,
            type: 'ui' as const,
            source: shelly.shellyID,
            properties: {
                id: 0
            }
        }
    ];
}

// ----------------------------------------------------------------------------------
// DevicePower Component
// Wall Display: skip devicepower:0 (always AC, useless) — only show :1+ (BLU HNT battery)
// ----------------------------------------------------------------------------------

function composeDevicepower(shelly: ShellyDevice): entity_t[] {
    const wallDisplay = isWallDisplay(shelly);
    const keys = Object.keys(shelly.status).filter((key) =>
        key.startsWith('devicepower:')
    );

    const extSensorId = wallDisplay
        ? (shelly.config.sys?.ext_sensor_id as string | undefined)
        : undefined;

    return keys
        .filter((key) => {
            // Wall Display devicepower:0 is always AC external — skip it
            if (wallDisplay && key === 'devicepower:0') return false;
            if (typeof shelly.status[key]?.id !== 'number') {
                logger.warn(
                    '%s: %s status has non-numeric id, skipping',
                    shelly.shellyID,
                    key
                );
                return false;
            }
            return true;
        })
        .map((key) => {
            const entity_status = shelly.status[key];
            const entity_config = shelly.config[key];
            const deviceName = shelly.info.name as string;

            const name =
                typeof entity_config?.name === 'string' && entity_config.name
                    ? entity_config.name
                    : deviceName || 'Battery';

            const errors: string[] = entity_status?.errors ?? [];

            // Determine sensor source
            const sensorSource = isAddonComponent(entity_status, shelly)
                ? 'addon'
                : extSensorId
                  ? 'blu'
                  : undefined;

            return {
                name,
                id: `${shelly.id}_${entity_status.id}:devicepower`,
                type: 'devicepower' as const,
                source: shelly.shellyID,
                properties: {
                    id: entity_status.id,
                    ...(errors.length ? {errors} : {}),
                    ...(extSensorId ? {extSensorId} : {}),
                    ...(sensorSource ? {sensorSource} : {})
                }
            };
        });
}

// ----------------------------------------------------------------------------------
// Matter Component
// Singleton key "matter" — only present on devices with Matter support
// ----------------------------------------------------------------------------------

function composeMatter(shelly: ShellyDevice): matter_entity[] {
    const matterConfig = shelly.config['matter:0'] ?? shelly.config.matter;
    if (!matterConfig || typeof matterConfig !== 'object') return [];

    const deviceName = shelly.info.name as string;

    return [
        {
            name: deviceName || 'Matter',
            id: `${shelly.id}_0:matter`,
            type: 'matter' as const,
            source: shelly.shellyID,
            properties: {
                id: 0
            }
        }
    ];
}

// ----------------------------------------------------------------------------------
// Schedule — synthetic entity (not a component in device status)
// Every Gen2+ device supports Schedule.List/Create/Update/Delete.
// One schedule entity per device.
// ----------------------------------------------------------------------------------

function composeCameraZone(
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): camerazone_entity {
    const componentId = config.id;
    const name = config?.name ?? deviceName ?? 'Zone';
    return {
        name,
        id: `${deviceId}_${componentId}:camerazone`,
        type: 'camerazone' as const,
        source: shellyID ?? String(deviceId),
        properties: {
            id: componentId
        }
    };
}

function composePresenceZone(
    config: any,
    deviceName: string,
    deviceId: number,
    shellyID?: string
): presencezone_entity {
    const componentId = config.id;
    const name = config?.name ?? deviceName ?? 'Zone';
    const src = shellyID ?? String(deviceId);
    return {
        name,
        id: `${deviceId}_${componentId}:presencezone`,
        type: 'presencezone' as const,
        source: src,
        properties: {
            id: componentId
        }
    };
}

// ----------------------------------------------------------------------------------
// Presence Component
// Singleton key "presence" — gets normalized to "presence:0" by normalizeComponentKeys.
// ----------------------------------------------------------------------------------

function composePresence(shelly: ShellyDevice): presence_entity[] {
    const presenceStatus =
        shelly.status['presence:0'] ?? shelly.status.presence;
    if (!presenceStatus || typeof presenceStatus !== 'object') return [];

    const deviceName = shelly.info.name as string;

    return [
        {
            name: deviceName || 'Presence',
            id: `${shelly.id}_0:presence`,
            type: 'presence' as const,
            source: shelly.shellyID,
            properties: {
                id: 0
            }
        }
    ];
}

function numberOrNull(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Compose BluTrv entity from device `blutrv:N` status — fields match the
 * firmware API exactly, no fallbacks:
 *   target_C, current_C: number (°C)
 *   connected: boolean (BLE link state)
 *   pos: number (valve position 0-100)
 *   battery: number (percent)
 *   rssi: number (dBm)
 *   last_updated_ts: number (unix seconds)
 */
function composeBluTrv(shelly: ShellyDevice): blutrv_entity[] {
    const entities: blutrv_entity[] = [];
    for (const key of Object.keys(shelly.status)) {
        if (!key.startsWith('blutrv:')) continue;
        const id = Number(key.split(':')[1]);
        if (Number.isNaN(id)) continue;
        const cfg = shelly.config[key] ?? {};
        const status = shelly.status[key] ?? {};
        const addr = cfg.addr ?? '';
        const shortAddr = addr.slice(-5).replace(':', '');
        const deviceName = cfg.name || `BLU TRV ${shortAddr}`;

        entities.push({
            name: deviceName,
            id: `${shelly.id}_${id}:blutrv`,
            type: 'blutrv' as const,
            source: shelly.shellyID,
            properties: {
                id,
                addr,
                gatewayId: shelly.shellyID,
                connected: status.connected === true,
                target_C: numberOrNull(status.target_C),
                current_C: numberOrNull(status.current_C),
                pos: numberOrNull(status.pos),
                battery: numberOrNull(status.battery),
                rssi: numberOrNull(status.rssi),
                lastUpdatedTs: numberOrNull(status.last_updated_ts)
            }
        });
    }
    return entities;
}

function composeSchedule(shelly: ShellyDevice): schedule_entity {
    const deviceName = shelly.info.name as string;
    return {
        name: deviceName || 'Schedules',
        id: `${shelly.id}_0:schedule`,
        type: 'schedule' as const,
        source: shelly.shellyID,
        properties: {
            id: 0
        }
    };
}

// ----------------------------------------------------------------------------------
// Component Registry
// ----------------------------------------------------------------------------------

interface ComponentDef {
    /** Component key prefix in device status (e.g. 'switch', 'cover') */
    key: string;
    /** Human-readable label for auto-naming */
    title: string;
    /** ID suffix for entity ID (defaults to key). Backwards compat: switch='out', temperature='temp' */
    idSuffix?: string;
    /** Optional parser to extract extra properties from config/status */
    parser?: (
        config: any,
        status: any,
        shelly?: ShellyDevice
    ) => Record<string, any>;
    /** Custom compose function for complex types that can't use the generic loop */
    custom?: (shelly: ShellyDevice) => entity_t[];
}

// Shared source detection for standalone temperature/humidity sensors: BLU
// (Wall Display ext_sensor_id) or a hardware add-on. Regular gateways create
// bthomesensor:N entities instead.
function bluAndAddonSensorSource(
    _config: any,
    status: any,
    shelly?: ShellyDevice
): Record<string, any> {
    const props: Record<string, any> = {};
    if (shelly && isWallDisplay(shelly)) {
        const extId = shelly.config.sys?.ext_sensor_id;
        if (extId) {
            props.extSensorId = extId;
            props.sensorSource = 'blu';
        }
    }
    if (isAddonComponent(status, shelly)) {
        props.sensorSource = 'addon';
    }
    return props;
}

const COMPONENT_REGISTRY: ComponentDef[] = [
    // Standard components (use generic composeComponents loop)
    {
        key: 'input',
        title: 'Input',
        parser: (config) => {
            const type = config.type;
            let unit = '';
            if (type === 'analog') {
                unit = config?.xpercent?.unit || '%';
            }
            return {type, unit};
        }
    },
    {
        key: 'switch',
        title: 'Relay',
        idSuffix: 'out',
        parser: (_config, status, shelly) => {
            if (isAddonComponent(status, shelly)) {
                return {sensorSource: 'addon'};
            }
            return {};
        }
    },
    {
        key: 'temperature',
        title: 'Temperature',
        idSuffix: 'temp',
        parser: bluAndAddonSensorSource
    },
    {key: 'em1', title: 'Energy Meter'},
    {key: 'em', title: 'Energy Meter'},
    {
        key: 'light',
        title: 'Light',
        parser: (_config, _status, shelly) => {
            // DALI detection: device has a dali component in status
            if (shelly && shelly.status.dali !== undefined) {
                return {deviceProfile: 'dali'};
            }
            return {};
        }
    },
    {key: 'rgbw', title: 'RGBW'},
    {key: 'rgb', title: 'RGB'},
    {key: 'cct', title: 'CCT Light'},
    {key: 'rgbcct', title: 'RGBCCT Light'},
    {key: 'ledstrip', title: 'LED Strip'},
    {key: 'pm1', title: 'Power Meter'},
    {
        key: 'humidity',
        title: 'Humidity',
        parser: bluAndAddonSensorSource
    },
    {key: 'voltmeter', title: 'Voltmeter'},
    {
        key: 'flood',
        title: 'Flood Sensor',
        parser: (config, status) => ({
            alarm_mode: config?.alarm_mode ?? 'normal',
            mute: status?.mute ?? false
        })
    },
    {key: 'smoke', title: 'Smoke Sensor'},
    {key: 'devicepower', title: 'Battery', custom: composeDevicepower},
    {key: 'illuminance', title: 'Illuminance'},
    {key: 'occupancy', title: 'Occupancy'},
    {
        key: 'thermostat',
        title: 'Thermostat',
        parser: (_config, _status, shelly) => {
            if (shelly && isWallDisplay(shelly))
                return {deviceType: 'walldisplay'};
            return {};
        }
    },

    // Custom components (need their own compose function)
    {key: 'cover', title: 'Cover', custom: composeCovers},
    {key: 'cury', title: 'Scent Diffuser', custom: composeCury},
    {key: 'media', title: 'Media', custom: composeMedia},
    {key: 'ui', title: 'Display', custom: composeUi},
    {key: 'matter', title: 'Matter', custom: composeMatter},
    {key: 'presence', title: 'Presence', custom: composePresence},
    {key: 'camera', title: 'Camera'},
    {key: 'blutrv', title: 'BLU TRV', custom: composeBluTrv},
    {key: 'blugw', title: 'BLU Gateway'},

    // Generic pass-through composers. Match the `:N` instance form only;
    // bare device-singleton keys (sys/wifi/dali/modbus/...) stay in
    // NON_COMPONENT_KEYS and are not seen here. `object` is intentionally
    // absent — it dispatches through composeVirtualComponents already.
    {key: 'bm', title: 'Battery Monitor'},
    {
        key: 'cb',
        title: 'Circuit Breaker',
        // Thresholds let the card flag each pole voltage against its limits.
        // `poles` is structural: count voltmeter components from the full device
        // so the card never guesses it from streaming live status.
        parser: (config, _status, shelly) => ({
            undervoltageLimit: config?.undervoltage_limit,
            voltageLimit: config?.voltage_limit,
            voltageThr: config?.voltage_thr,
            poles: shelly
                ? new Set(
                      [
                          ...Object.keys(shelly.config),
                          ...Object.keys(shelly.status)
                      ].filter((k) => /^voltmeter:\d+$/.test(k))
                  ).size || undefined
                : undefined
        })
    },
    {key: 'fan', title: 'Fan'},
    {key: 'lnm', title: 'Local Network Messaging'},
    {key: 'zigbee', title: 'Zigbee Bridge'},
    {key: 'pill', title: 'The Pill'},
    {key: 'dali', title: 'DALI Fixture'},
    {key: 'modbus', title: 'Modbus'},
    {key: 'script', title: 'Script'},
    {key: 'emdata', title: 'Energy Archive'},
    {key: 'em1data', title: 'Energy Archive (single phase)'}
];

// Snapshot of registry keys for the coverage endpoint and unknown-type
// counter — single source of truth for "component types that compose".
export function composerRegistryKeys(): ReadonlySet<string> {
    return new Set(COMPONENT_REGISTRY.map((d) => d.key));
}

// ----------------------------------------------------------------------------------
// Collector function
// ----------------------------------------------------------------------------------

export function proposeEntities(shelly: ShellyDevice): entity_t[] {
    const entities: entity_t[] = [];

    // Debug: log all status keys to help identify component types
    logger.info(
        'Composing entities for %s, status keys: %s',
        shelly.shellyID,
        Object.keys(shelly.status).join(', ')
    );

    // Detect thermostat actuator switches — tag them instead of suppressing
    // When a thermostat controls a switch (e.g. Wall Display, Lingo HVAC),
    // the switch should show relay state but redirect toggle to thermostat enable.
    // Map switch key → thermostat ID (e.g. "switch:0" → 0)
    const thermostatActuatorSwitches = new Map<string, number>();
    for (const key of Object.keys(shelly.config)) {
        if (key.startsWith('thermostat:')) {
            const actuator = shelly.config[key]?.actuator;
            if (typeof actuator === 'string') {
                const match = actuator.match(/\/c\/(switch:\d+)$/);
                if (match) {
                    const thermostatId = Number.parseInt(key.split(':')[1], 10);
                    thermostatActuatorSwitches.set(match[1], thermostatId);
                }
            }
        }
    }

    for (const def of COMPONENT_REGISTRY) {
        if (def.custom) {
            entities.push(...def.custom(shelly));
        } else {
            const composed = composeComponents(
                shelly,
                def.key,
                def.title,
                def.parser,
                def.idSuffix
            );
            // Tag switches that are thermostat actuators
            if (def.key === 'switch' && thermostatActuatorSwitches.size > 0) {
                for (const e of composed) {
                    if (e.type !== 'switch') continue;
                    const sw = e as switch_entity;
                    const switchKey = `switch:${sw.properties.id}`;
                    const actuatorId =
                        thermostatActuatorSwitches.get(switchKey);
                    if (actuatorId !== undefined) {
                        sw.properties.thermostatActuator = actuatorId;
                    }
                }
            }
            entities.push(...composed);
        }
    }

    // Synthetic temperature entities from components that embed temperature
    // (e.g. light:0.temperature.tC on dimmers, switch:0.temperature.tC on relays)
    // Only if the device doesn't already have standalone temperature:N components.
    const hasStandaloneTemp = Object.keys(shelly.status).some((k) =>
        k.startsWith('temperature:')
    );
    if (!hasStandaloneTemp) {
        for (const key of Object.keys(shelly.status)) {
            if (
                (key.startsWith('light:') || key.startsWith('switch:')) &&
                shelly.status[key]?.temperature?.tC != null
            ) {
                const id = shelly.status[key].id ?? 0;
                const device_name = shelly.info.name;
                entities.push({
                    name: String(device_name || 'Temperature'),
                    id: `${shelly.id}_${id}:temp`,
                    type: 'temperature',
                    source: shelly.shellyID,
                    properties: {
                        id,
                        embeddedIn: key
                    }
                });
                // One synthetic temp entity per device is enough
                break;
            }
        }
    }

    // Virtual components (separate system)
    entities.push(...composeVirtualComponents(shelly));

    // Schedule — synthetic entity, every Gen2+ device supports it
    entities.push(composeSchedule(shelly));

    // Debug: log created entities
    logger.info(
        'Created %d entities for %s: %s',
        entities.length,
        shelly.shellyID,
        entities.map((e) => `${e.type}:${e.properties.id}`).join(', ')
    );

    countUnknownComponentTypes(shelly);

    return entities;
}

// Requires FM_OBSERVABILITY=true (obsLevel ≥ 2); see scaling.md.
function countUnknownComponentTypes(shelly: ShellyDevice): void {
    const known = composerRegistryKeys();
    for (const type of extractComponentTypes(shelly.status)) {
        if (known.has(type) || NON_COMPONENT_KEYS.has(type)) continue;
        incrementLabeledCounter(UNKNOWN_COMPONENT_TYPE_COUNTER, {type});
    }
}
