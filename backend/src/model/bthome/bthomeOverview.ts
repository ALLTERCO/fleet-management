import {
    BLU_DEVICES,
    BLU_TRV_MODEL_ID,
    type BTHomeControlKind,
    bthomeObjectInfos,
    formatBTHomeChannelLabel,
    formatBTHomeControlLabel,
    formatBTHomeEventName,
    formatBTHomeEventSummary,
    getBTHomeBinaryStateWords,
    getBTHomeControlKind,
    getBTHomeEventSourceLabel,
    isBTHomeControlObjectId,
    isBTHomeDeviceLevelObjectId,
    isBTHomeDoorLikeObjectId,
    objIdsByName,
    resolveBluDeviceName,
    resolveModelNumericId
} from '../../config/BTHomeData';

export type BTHomeActionEvent =
    | 'single_push'
    | 'double_push'
    | 'triple_push'
    | 'long_push'
    | 'long_double_push'
    | 'long_triple_push'
    | 'rotate_left'
    | 'rotate_right'
    | 'hold_press'; // BLU Wall EU/US 4-button devices, fw 1.0.23+

export type BTHomeRuntimeEvent = {
    event: BTHomeActionEvent;
    idx: number | null;
    channel: number | null;
    ts: number | null;
    activeUntilMs: number;
};

export type BTHomeOverview = {
    addr: string;
    displayName: string;
    productName: string;
    modelId: string;
    modelNumericId?: number;
    localName?: string;
    isRemote: boolean;
    kind:
        | 'door_window'
        | 'button'
        | 'remote_controller'
        | 'motion_sensor'
        | 'climate_sensor'
        | 'distance_sensor'
        | 'weather_station'
        | 'trv'
        | 'sensor';
    summary?: string;
    primaryDisplayValue?: string;
    state?: 'open' | 'closed';
    paired: boolean;
    battery?: number | null;
    rssi?: number | null;
    activeChannel?: number | null;
    activeChannelLabel?: string;
    lastEvent?: string;
    lastEventLabel?: string;
    lastEventSummary?: string;
    lastUpdatedTs?: number | null;
    childSensorCount: number;
    controls: BTHomeOverviewControl[];
    sensors: BTHomeOverviewSensor[];
};

export type BTHomeOverviewControl = {
    objId: number;
    idx: number;
    kind: BTHomeControlKind;
    label: string;
    active: boolean;
    status: string;
};

export type BTHomeOverviewSensor = {
    componentKey: string;
    id: number;
    objId: number;
    objName: string;
    label: string;
    sensorType: string;
    unit: string;
    displayValue: string;
    lastUpdatedTs: number | null;
};

export type BTHomeChildSensor = {
    key: string;
    id: number;
    objId: number;
    config: Record<string, any>;
    status: Record<string, any>;
};

export type NormalizedBTHomeControl = {
    objId: number;
    idx: number;
    kind: BTHomeControlKind;
    label: string;
};

// Presence-like binary sensors, temperature/humidity, illuminance, and distance
// obj_ids are derived from the obj_id->name catalog so a newly cataloged obj_id
// with a known name is recognized without touching this list.
export const BTHOME_MOTION_OBJ_IDS = objIdsByName(
    'motion',
    'moving',
    'occupancy',
    'presence'
);
export const BTHOME_TEMPERATURE_OBJ_IDS = objIdsByName('temperature');
export const BTHOME_HUMIDITY_OBJ_IDS = objIdsByName('humidity');
export const BTHOME_ILLUMINANCE_OBJ_IDS = objIdsByName(
    'illuminance',
    'light_level'
);
export const BTHOME_DISTANCE_OBJ_IDS = objIdsByName(
    'distance_mm',
    'distance_m'
);
// direction/precipitation derive by name; wind speed is pinned to obj 68 because
// the catalog names both obj 68 and obj 98 'speed' (BTHome v2 extended) and only
// obj 68 is the WS90 wind reading — a bare name derivation would also pull in
// obj 98 and misclassify a device reporting it as a weather station.
export const BTHOME_WEATHER_OBJ_IDS = new Set<number>([
    ...objIdsByName('direction', 'precipitation'),
    68
]);
const BTHOME_BUTTON_EVENT_OBJ_IDS = new Set([58, 60, 63, 96]);
const BUTTON_MODEL_IDS = new Set(['SBBT-002C', 'SBBT-102C']);
const TRV_MODEL_IDS = new Set([BLU_TRV_MODEL_ID]);
const REMOTE_MODEL_IDS = new Set([
    'SBRC-005B',
    'SBBT-004CEU',
    'SBBT-004CUS',
    'SBBT-104CEU',
    'SBBT-104CUS'
]);
const CLIMATE_MODEL_IDS = new Set(['SBHT-003C', 'SBHT-103C', 'SBHT-203C']);
const WEATHER_MODEL_IDS = new Set(['SBWS-90CM']);
const DISTANCE_MODEL_IDS = new Set(['SBDI-003E']);
const MOTION_MODEL_IDS = new Set(['SBMO-003Z']);
const DOOR_MODEL_IDS = new Set(['SBDW-002C']);

export function normalizeBTHomeChannel(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }

    return Math.trunc(value);
}

export function firstNonEmptyString(
    ...values: Array<string | null | undefined>
): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
}

function getBTHomeChildrenForAddr(
    allConfig: Record<string, any>,
    allStatus: Record<string, any>,
    addr: string
): BTHomeChildSensor[] {
    const children: BTHomeChildSensor[] = [];
    for (const [key, config] of Object.entries(allConfig)) {
        if (!key.startsWith('bthomesensor:')) continue;
        if (config?.addr !== addr || typeof config?.obj_id !== 'number')
            continue;
        const statusKey = `bthomesensor:${config.id}`;
        children.push({
            key,
            id: config.id,
            objId: config.obj_id,
            config,
            status: allStatus[statusKey] ?? {}
        });
    }
    return children;
}

function normalizeBTHomeControls(controls: unknown): NormalizedBTHomeControl[] {
    if (!Array.isArray(controls)) return [];

    return controls
        .flatMap((control): NormalizedBTHomeControl[] => {
            if (
                typeof control?.objId !== 'number' ||
                typeof control?.idx !== 'number' ||
                control.idx < 0
            ) {
                return [];
            }
            const kind = getBTHomeControlKind(control.objId);
            if (!kind) return [];
            const label =
                typeof control.label === 'string' && control.label.trim()
                    ? control.label
                    : formatBTHomeControlLabel(control.objId, control.idx);
            return [{objId: control.objId, idx: control.idx, kind, label}];
        })
        .sort((a, b) => a.idx - b.idx || a.objId - b.objId);
}

function buildBTHomeControlStates(
    controls: NormalizedBTHomeControl[],
    eventName?: string,
    eventIdx?: number | null,
    isActive = false
): BTHomeOverviewControl[] {
    const formattedEvent =
        typeof eventName === 'string' && eventName.trim()
            ? formatBTHomeEventName(eventName)
            : 'Ready';
    const activeKind: BTHomeControlKind =
        typeof eventName === 'string' && eventName.startsWith('rotate_')
            ? 'dimmer'
            : 'button';

    return controls.map((control) => {
        const active =
            isActive &&
            typeof eventIdx === 'number' &&
            eventIdx === control.idx &&
            control.kind === activeKind;

        return {
            objId: control.objId,
            idx: control.idx,
            kind: control.kind,
            label: control.label,
            active,
            status: active ? formattedEvent : 'Ready'
        };
    });
}

function getChildStatusTimestamp(status: Record<string, any>): number {
    const ts = status?.last_updated_ts ?? status?.last_event_ts ?? 0;
    return typeof ts === 'number' ? ts : 0;
}

function findLatestChild(
    children: BTHomeChildSensor[],
    matcher: (objId: number) => boolean
): BTHomeChildSensor | null {
    let match: BTHomeChildSensor | null = null;
    let matchTs = -1;

    for (const child of children) {
        if (!matcher(child.objId)) continue;
        const ts = getChildStatusTimestamp(child.status);
        if (ts >= matchTs) {
            match = child;
            matchTs = ts;
        }
    }

    return match;
}

function formatBTHomeMetric(objId: number, value: number): string {
    const unit = bthomeObjectInfos[objId]?.unit ?? '';
    const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit ? `${text} ${unit}` : text;
}

function formatBTHomeSensorLabel(child: BTHomeChildSensor): string {
    const customName = firstNonEmptyString(child.config?.name);
    if (customName) return customName;

    const objName = bthomeObjectInfos[child.objId]?.name;
    if (objName) return formatBTHomeEventName(objName);

    return `Sensor ${child.id}`;
}

export function formatBTHomeSensorDisplayValue(
    child: BTHomeChildSensor
): string {
    const objName = bthomeObjectInfos[child.objId]?.name ?? '';
    const eventName =
        typeof child.status?.last_event === 'string'
            ? child.status.last_event
            : undefined;
    if (eventName) {
        return formatBTHomeEventName(eventName);
    }

    const value = child.status?.value;
    if (value == null) {
        return isBTHomeControlObjectId(child.objId) ? 'No events' : '—';
    }

    if (typeof value === 'number') {
        if (child.objId === 96) {
            return formatBTHomeChannelLabel(value);
        }
        return formatBTHomeMetric(child.objId, value);
    }

    if (typeof value === 'boolean') {
        const words = getBTHomeBinaryStateWords(objName);
        if (words) {
            return value ? words.on : words.off;
        }
        return value ? 'Yes' : 'No';
    }

    if (typeof value === 'string') {
        return formatBTHomeEventName(value);
    }

    return String(value);
}

function buildBTHomeSensorOverview(
    children: BTHomeChildSensor[]
): BTHomeOverviewSensor[] {
    return children
        .filter((child) => !isBTHomeDeviceLevelObjectId(child.objId))
        .sort((a, b) => {
            const aBattery = a.objId === 1 ? 1 : 0;
            const bBattery = b.objId === 1 ? 1 : 0;
            if (aBattery !== bBattery) return aBattery - bBattery;

            const aLabel = formatBTHomeSensorLabel(a).toLowerCase();
            const bLabel = formatBTHomeSensorLabel(b).toLowerCase();
            if (aLabel !== bLabel) return aLabel.localeCompare(bLabel);

            return a.id - b.id;
        })
        .map((child) => {
            const info = bthomeObjectInfos[child.objId] ?? {};
            return {
                componentKey: child.key,
                id: child.id,
                objId: child.objId,
                objName: info.name ?? '',
                label: formatBTHomeSensorLabel(child),
                sensorType:
                    typeof info.type === 'string' && info.type
                        ? info.type
                        : 'sensor',
                unit:
                    typeof info.unit === 'string' && info.unit ? info.unit : '',
                displayValue: formatBTHomeSensorDisplayValue(child),
                lastUpdatedTs:
                    typeof child.status?.last_updated_ts === 'number'
                        ? child.status.last_updated_ts
                        : null
            };
        });
}

function inferKindFromModelId(
    modelId: string | undefined,
    isRemote: boolean
): BTHomeOverview['kind'] | undefined {
    if (!modelId) return undefined;
    if (TRV_MODEL_IDS.has(modelId)) return 'trv';
    if (DOOR_MODEL_IDS.has(modelId)) return 'door_window';
    if (MOTION_MODEL_IDS.has(modelId)) return 'motion_sensor';
    if (CLIMATE_MODEL_IDS.has(modelId)) return 'climate_sensor';
    if (DISTANCE_MODEL_IDS.has(modelId)) return 'distance_sensor';
    if (WEATHER_MODEL_IDS.has(modelId)) return 'weather_station';
    if (REMOTE_MODEL_IDS.has(modelId)) return 'remote_controller';
    if (BUTTON_MODEL_IDS.has(modelId)) return 'button';
    if (isRemote) return 'remote_controller';
    return undefined;
}

export function detectBTHomeOverviewKind(options: {
    objIds: Set<number>;
    modelId?: string;
    isRemote: boolean;
}): BTHomeOverview['kind'] {
    const {objIds, modelId, isRemote} = options;

    // TRVs use a proprietary protocol (not standard BTHome) and may report
    // temperature objects from their integrated sensor — detect by model first
    // so they don't get mis-classified as climate_sensor.
    if (modelId && TRV_MODEL_IDS.has(modelId)) {
        return 'trv';
    }
    if (modelId && BUTTON_MODEL_IDS.has(modelId)) {
        return 'button';
    }
    if (modelId && REMOTE_MODEL_IDS.has(modelId)) {
        return 'remote_controller';
    }

    if (Array.from(objIds).some((objId) => isBTHomeDoorLikeObjectId(objId))) {
        return 'door_window';
    }
    if (Array.from(objIds).some((objId) => BTHOME_MOTION_OBJ_IDS.has(objId))) {
        return 'motion_sensor';
    }
    if (
        Array.from(objIds).some((objId) => BTHOME_DISTANCE_OBJ_IDS.has(objId))
    ) {
        return 'distance_sensor';
    }
    if (Array.from(objIds).some((objId) => BTHOME_WEATHER_OBJ_IDS.has(objId))) {
        return 'weather_station';
    }
    if (
        Array.from(objIds).some(
            (objId) =>
                BTHOME_TEMPERATURE_OBJ_IDS.has(objId) ||
                BTHOME_HUMIDITY_OBJ_IDS.has(objId)
        )
    ) {
        return 'climate_sensor';
    }
    if (
        Array.from(objIds).some((objId) =>
            BTHOME_BUTTON_EVENT_OBJ_IDS.has(objId)
        )
    ) {
        if (objIds.has(63) || objIds.has(96) || isRemote) {
            return 'remote_controller';
        }
        return 'button';
    }

    return inferKindFromModelId(modelId, isRemote) ?? 'sensor';
}

export function buildBTHomeOverview(options: {
    config: Record<string, any>;
    status: Record<string, any>;
    allConfig: Record<string, any>;
    allStatus: Record<string, any>;
    runtimeEvent?: BTHomeRuntimeEvent;
}): BTHomeOverview {
    const {config, status, allConfig, allStatus, runtimeEvent} = options;
    const controls = normalizeBTHomeControls(config?.meta?.controls);
    const modelId = firstNonEmptyString(config?.meta?.modelId) ?? '';
    const modelNumericId =
        typeof config?.meta?.modelNumericId === 'number'
            ? config.meta.modelNumericId
            : resolveModelNumericId(modelId);
    const productName =
        firstNonEmptyString(
            config?.meta?.productName,
            resolveBluDeviceName(modelId || undefined, modelNumericId)
        ) ?? '';
    const localName = firstNonEmptyString(config?.meta?.localName);
    const isRemote =
        config?.meta?.isRemote === true ||
        (modelId ? (BLU_DEVICES[modelId]?.isRemote ?? false) : false);
    const displayName =
        firstNonEmptyString(
            config?.name,
            productName,
            localName,
            config?.addr
        ) ?? 'BLE Device';
    const children = getBTHomeChildrenForAddr(
        allConfig,
        allStatus,
        config.addr
    );
    const objIds = new Set(children.map((child) => child.objId));
    const eventName =
        runtimeEvent?.event ??
        (typeof status?.last_event === 'string'
            ? status.last_event
            : undefined);
    const eventIdx =
        runtimeEvent?.idx ??
        (typeof status?.last_event_idx === 'number' &&
        status.last_event_idx >= 0
            ? status.last_event_idx
            : null);
    const channelChild = findLatestChild(children, (objId) => objId === 96);
    const activeChannel =
        normalizeBTHomeChannel(channelChild?.status?.value) ??
        normalizeBTHomeChannel(status?.channel) ??
        runtimeEvent?.channel ??
        null;
    const activeChannelLabel =
        activeChannel != null
            ? formatBTHomeChannelLabel(activeChannel)
            : undefined;
    const lastEvent = eventName ? formatBTHomeEventName(eventName) : undefined;
    const lastEventLabel = eventName
        ? getBTHomeEventSourceLabel({
              event: eventName,
              idx: eventIdx,
              controls
          })
        : undefined;
    const lastEventSummary = eventName
        ? formatBTHomeEventSummary(
              eventName,
              eventIdx,
              controls,
              normalizeBTHomeChannel(status?.channel) ??
                  runtimeEvent?.channel ??
                  activeChannel
          )
        : undefined;
    const controlStates = buildBTHomeControlStates(
        controls,
        eventName,
        eventIdx,
        isActiveRuntimeEvent(runtimeEvent)
    );
    const sensors = buildBTHomeSensorOverview(children);
    const batteryChild = findLatestChild(
        children,
        (objId) => objId === 1 && typeof objId === 'number'
    );
    const battery =
        typeof batteryChild?.status?.value === 'number'
            ? batteryChild.status.value
            : typeof status?.battery === 'number'
              ? status.battery
              : null;
    const doorChild = findLatestChild(children, (objId) =>
        isBTHomeDoorLikeObjectId(objId)
    );
    const motionChild = findLatestChild(children, (objId) =>
        BTHOME_MOTION_OBJ_IDS.has(objId)
    );
    const temperatureChild = findLatestChild(children, (objId) =>
        BTHOME_TEMPERATURE_OBJ_IDS.has(objId)
    );
    const humidityChild = findLatestChild(children, (objId) =>
        BTHOME_HUMIDITY_OBJ_IDS.has(objId)
    );
    const illuminanceChild = findLatestChild(children, (objId) =>
        BTHOME_ILLUMINANCE_OBJ_IDS.has(objId)
    );
    const distanceChild = findLatestChild(children, (objId) =>
        BTHOME_DISTANCE_OBJ_IDS.has(objId)
    );
    const windChild = findLatestChild(children, (objId) => objId === 68);
    const directionChild = findLatestChild(children, (objId) => objId === 94);
    const rainChild = findLatestChild(children, (objId) => objId === 95);
    const kind = detectBTHomeOverviewKind({objIds, modelId, isRemote});

    let state: BTHomeOverview['state'];
    if (
        kind === 'door_window' &&
        typeof doorChild?.status?.value === 'boolean'
    ) {
        state = doorChild.status.value ? 'open' : 'closed';
    }
    if (
        kind === 'motion_sensor' &&
        typeof motionChild?.status?.value === 'boolean'
    ) {
        state = motionChild.status.value ? 'open' : 'closed';
    }

    const summaryParts: string[] = [];
    if (temperatureChild && typeof temperatureChild.status.value === 'number') {
        summaryParts.push(
            formatBTHomeMetric(
                temperatureChild.objId,
                temperatureChild.status.value
            )
        );
    }
    if (humidityChild && typeof humidityChild.status.value === 'number') {
        summaryParts.push(
            formatBTHomeMetric(humidityChild.objId, humidityChild.status.value)
        );
    }

    let summary: string | undefined;
    const primaryDisplayValue =
        kind === 'weather_station' && temperatureChild
            ? formatBTHomeSensorDisplayValue(temperatureChild)
            : undefined;
    switch (kind) {
        case 'climate_sensor':
            summary = summaryParts.filter(Boolean).join(' · ') || undefined;
            break;
        case 'distance_sensor':
            if (
                distanceChild &&
                typeof distanceChild.status.value === 'number'
            ) {
                summary = formatBTHomeMetric(
                    distanceChild.objId,
                    distanceChild.status.value
                );
            }
            break;
        case 'weather_station': {
            const weatherParts: string[] = [];
            if (windChild && typeof windChild.status.value === 'number') {
                weatherParts.push(
                    `Wind ${formatBTHomeMetric(windChild.objId, windChild.status.value)}`
                );
            }
            if (
                directionChild &&
                typeof directionChild.status.value === 'number'
            ) {
                weatherParts.push(
                    `Dir ${formatBTHomeMetric(directionChild.objId, directionChild.status.value)}`
                );
            }
            if (rainChild && typeof rainChild.status.value === 'number') {
                weatherParts.push(
                    `Rain ${formatBTHomeMetric(rainChild.objId, rainChild.status.value)}`
                );
            }
            summary = weatherParts.join(' · ') || undefined;
            break;
        }
        case 'motion_sensor':
            if (illuminanceChild) {
                const displayValue =
                    formatBTHomeSensorDisplayValue(illuminanceChild);
                if (displayValue !== '—') {
                    summary = `${formatBTHomeSensorLabel(illuminanceChild)} ${displayValue}`;
                }
            }
            break;
        case 'button':
            summary = 'No events';
            break;
        case 'remote_controller':
            summary =
                lastEventSummary ?? activeChannelLabel ?? 'No recent events';
            break;
        default:
            summary = undefined;
            break;
    }

    return {
        addr: config.addr,
        displayName,
        productName,
        modelId,
        ...(typeof modelNumericId === 'number' ? {modelNumericId} : {}),
        ...(localName ? {localName} : {}),
        isRemote,
        kind,
        ...(summary ? {summary} : {}),
        ...(primaryDisplayValue ? {primaryDisplayValue} : {}),
        ...(state ? {state} : {}),
        paired: status?.paired === true,
        battery,
        rssi: typeof status?.rssi === 'number' ? status.rssi : null,
        ...(activeChannel != null ? {activeChannel} : {}),
        ...(activeChannelLabel ? {activeChannelLabel} : {}),
        ...(lastEvent ? {lastEvent} : {}),
        ...(lastEventLabel ? {lastEventLabel} : {}),
        ...(lastEventSummary ? {lastEventSummary} : {}),
        lastUpdatedTs:
            typeof status?.last_updated_ts === 'number'
                ? Math.max(status.last_updated_ts, runtimeEvent?.ts ?? 0) ||
                  null
                : (runtimeEvent?.ts ?? null),
        childSensorCount: sensors.length,
        controls: controlStates,
        sensors
    };
}

function isActiveRuntimeEvent(runtimeEvent?: BTHomeRuntimeEvent): boolean {
    return (
        !!runtimeEvent &&
        typeof runtimeEvent.activeUntilMs === 'number' &&
        runtimeEvent.activeUntilMs > Date.now()
    );
}
