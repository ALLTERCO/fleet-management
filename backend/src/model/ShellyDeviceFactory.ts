import {getLogger} from 'log4js';
import {tuning} from '../config';
import * as Observability from '../modules/Observability';
import type {get_resp_t} from '../modules/PostgresProvider';
import * as postgres from '../modules/PostgresProvider';
import {StageTimer, type StageTiming} from '../modules/util/stageTimer';
import {
    endAccessChangeWatch,
    watchAccessChange
} from '../modules/WaitingRoom/accessChangeWatch';
import RpcError from '../rpc/RpcError';
import type {DeviceCapabilities} from '../types';
import type {LedStripCatalog, LedStripUiField} from '../types/api/ledstrip';
import {deriveCapabilities} from './deviceCapabilities';
import {buildEventCatalog, type DeviceEventCatalog} from './deviceEventCatalog';
import ShellyDevice from './ShellyDevice';
import type HttpTransport from './transport/HttpTransport';
import type RpcTransport from './transport/RpcTransport';
import type WebSocketTransport from './transport/WebsocketTransport';

const logger = getLogger('ShellyDeviceFactory');

// Every RPC issued while assembling a device gets its own bounded deadline.
// The four base probes already had this protection; metadata/pagination calls
// did not and could hold an init slot until the 60s transport sweep.
// The optional gather signal is combined in so the whole gather can be
// abandoned as one unit, not one stalled probe at a time.
function sendInitRpc(
    transport: RpcTransport,
    method: string,
    params: unknown = null,
    signal?: AbortSignal
) {
    const perCall = AbortSignal.timeout(tuning.rpc.initProbeTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, perCall]) : perCall;
    return transport.sendRPC(method, params, false, combined);
}

// Per-namespace fallback method sets for offline devices whose persisted
// snapshot predates the methods plumbing. Keys mirror Shelly.ListMethods
// names so frontend `deviceSupports()` checks resolve identically.
const FALLBACK_METHODS_BY_SETTINGS_KEY: Record<string, string[]> = {
    cloud: ['Cloud.GetConfig', 'Cloud.GetStatus', 'Cloud.SetConfig'],
    mqtt: ['Mqtt.GetConfig', 'Mqtt.GetStatus', 'Mqtt.SetConfig'],
    ble: [
        'BLE.GetConfig',
        'BLE.GetStatus',
        'BLE.SetConfig',
        'Ble.StartPairing',
        'Ble.StopPairing',
        'Ble.ListPairedDevices',
        'Ble.DeletePairedDevice'
    ],
    wifi: [
        'Wifi.GetConfig',
        'Wifi.GetStatus',
        'Wifi.SetConfig',
        'Wifi.Scan',
        'Wifi.SavedNetworks.List',
        'Wifi.SavedNetworks.Delete'
    ],
    eth: ['Eth.GetConfig', 'Eth.GetStatus', 'Eth.SetConfig', 'Eth.ListClients'],
    modbus: ['Modbus.GetConfig', 'Modbus.GetStatus', 'Modbus.SetConfig'],
    ws: ['WS.GetConfig', 'WS.GetStatus', 'WS.SetConfig'],
    serial: ['Serial.GetConfig', 'Serial.SetConfig'],
    script: ['Script.List', 'Script.GetConfig', 'Script.GetStatus'],
    ledstrip: ['LedStrip.GetConfig', 'LedStrip.SetConfig'],
    sys: ['Sys.GetConfig', 'Sys.GetStatus', 'Sys.SetConfig']
};

const EM_FALLBACK_METHODS = [
    'EM.GetConfig',
    'EM.GetStatus',
    'EM.SetConfig',
    'EM.GetCTTypes',
    'EM.PhaseToPhaseCalib',
    'EM.PhaseToPhaseCalibReset'
];
const EMDATA_FALLBACK_METHODS = [
    'EMData.GetConfig',
    'EMData.GetStatus',
    'EMData.SetConfig',
    'EMData.GetData',
    'EMData.GetRecords',
    'EMData.GetNetEnergies',
    'EMData.DeleteAllData',
    'EMData.ResetCounters'
];

/** Best-known method set for an offline device, derived from its settings shape. */
function deriveMethodsFromSettings(settings: unknown): string[] {
    if (!settings || typeof settings !== 'object') return [];
    const out = new Set<string>();
    for (const key of Object.keys(settings)) {
        const base = key.split(':')[0];
        const methods = FALLBACK_METHODS_BY_SETTINGS_KEY[base];
        if (methods) for (const m of methods) out.add(m);
        if (base === 'em') for (const m of EM_FALLBACK_METHODS) out.add(m);
        if (base === 'emdata')
            for (const m of EMDATA_FALLBACK_METHODS) out.add(m);
    }
    return Array.from(out);
}

// typeof null === 'object', so a plain typeof check lets a null snapshot through.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

// Set when an admission decision let this device in: its registration then
// needs the device row to be ALLOWED at that moment.
export interface RegistrationAdmission {
    shellyID: string;
}

// Registration refused: the device row was not ALLOWED when it registered.
export class AdmissionRevokedError extends Error {
    readonly code = 'admission_revoked';
    constructor(readonly shellyID: string) {
        super(`device ${shellyID} is no longer allowed`);
        this.name = 'AdmissionRevokedError';
    }
}

// The database decides at the latest point. Nothing awaits between this read
// and DeviceCollector.register, so a deny signal handled after it finds the
// device live and closes it; one handled while the read was in flight refuses.
// A device reporting another id is left to the identity check. Without an
// admission the device keeps id 0 when no row is ALLOWED.
async function readRegistrationRowId(
    shellyID: string,
    admission?: RegistrationAdmission
): Promise<number> {
    const watch =
        admission?.shellyID === shellyID ? watchAccessChange(shellyID) : null;
    try {
        const [dev] = await postgres.get(
            shellyID,
            postgres.ACCESS_CONTROL.ALLOWED
        );
        if (watch && (!dev || watch.changed)) {
            throw new AdmissionRevokedError(shellyID);
        }
        return dev?.id || 0;
    } finally {
        if (watch) endAccessChangeWatch(watch);
    }
}

export function shouldProbeVirtualComponents(methods: string[]): boolean {
    // Ask any device that can list its components. The advertised method list
    // is the single source of truth — no firmware-version or capability guess.
    return methods.includes('Shelly.GetComponents');
}

export default class ShellyDeviceFactory {
    static fromHttp(transport: HttpTransport, signal?: AbortSignal) {
        return ShellyDeviceFactory.fromOnlineTransport(transport, signal);
    }

    static fromWebsocket(
        transport: WebSocketTransport,
        signal?: AbortSignal,
        admission?: RegistrationAdmission
    ) {
        return ShellyDeviceFactory.fromOnlineTransport(
            transport,
            signal,
            admission
        );
    }

    static fromDatabase(entry: get_resp_t): ShellyDevice | undefined {
        // sanity check
        const {updated, jdoc, id} = entry;

        if (
            !jdoc ||
            typeof jdoc !== 'object' ||
            typeof jdoc.shellyID !== 'string' ||
            typeof id !== 'number' ||
            typeof jdoc.source !== 'string' ||
            !isRecord(jdoc.info) ||
            !isRecord(jdoc.status) ||
            !isRecord(jdoc.settings)
        ) {
            return undefined;
        }

        const {info, status, settings: config} = jdoc;

        const persistedMethods =
            Array.isArray(jdoc.methods) && jdoc.methods.length > 0
                ? jdoc.methods
                : deriveMethodsFromSettings(config);

        // updated can be null on legacy rows; fall back to now() so a
        // missing column doesn't poison the whole device load path.
        const updatedMs =
            updated instanceof Date ? updated.getTime() : Date.now();

        return new ShellyDevice(
            jdoc.shellyID,
            undefined,
            'offline',
            info,
            status,
            config,
            false,
            id,
            updatedMs,
            jdoc.capabilities,
            persistedMethods
        );
    }

    private static async getData(
        transport: RpcTransport,
        signal?: AbortSignal
    ): Promise<
        [
            info: any,
            status: any,
            config: any,
            capabilities: DeviceCapabilities,
            methods: string[]
        ]
    > {
        // Bulkhead pattern (Netflix Hystrix) — allSettled so a single hung
        // RPC can't drag the other 3 down. Per-call abort signal at 20s
        // (gRPC keepalive default) cuts hold time vs the 60s rpcTimeoutMs
        // fallback, so a slow device frees its init slot 3× faster.
        const [infoRes, statusRes, configRes, methodsRes] =
            await Promise.allSettled([
                sendInitRpc(transport, 'Shelly.GetDeviceInfo', null, signal),
                sendInitRpc(transport, 'Shelly.GetStatus', null, signal),
                sendInitRpc(transport, 'Shelly.GetConfig', null, signal),
                sendInitRpc(transport, 'Shelly.ListMethods', null, signal)
            ]);
        if (infoRes.status === 'rejected') throw infoRes.reason;
        if (statusRes.status === 'rejected') throw statusRes.reason;
        if (configRes.status === 'rejected') throw configRes.reason;
        const info = infoRes.value;
        const status = statusRes.value;
        const config = configRes.value;
        if (methodsRes.status === 'rejected') {
            logger.warn(
                'Shelly.ListMethods failed — capabilities will be derived from config fallback only:',
                methodsRes.reason
            );
        }
        const methods: string[] =
            methodsRes.status === 'fulfilled'
                ? (methodsRes.value?.methods ?? [])
                : [];
        return [info, status, config, deriveCapabilities(methods), methods];
    }

    private static async fromOnlineTransport(
        transport: RpcTransport,
        signal?: AbortSignal,
        admission?: RegistrationAdmission
    ) {
        // Per-stage timing — a device that shows up slowly after accept is slow
        // in exactly one of these probe steps; the log below names which.
        const timer = new StageTimer();
        const bundle = await ShellyDeviceFactory.gatherOverTransport(
            transport,
            timer,
            signal
        );
        return ShellyDeviceFactory.assembleOverTransport(
            transport,
            bundle,
            admission
        );
    }

    // Gather everything the build needs over the live socket — the slow part:
    // base RPCs, the paginated component load, and service/ledstrip/event
    // metadata. No device object, no DB, so it can run while a device waits and
    // be reused at accept. Marks the shared timer's probe stages.
    private static async gatherOverTransport(
        transport: RpcTransport,
        timer: StageTimer,
        signal?: AbortSignal
    ): Promise<DeviceDataBundle> {
        const [info, status, config, capabilities, methods] =
            await ShellyDeviceFactory.getData(transport, signal);
        timer.mark('probe');

        let componentPages = 0;
        if (shouldProbeVirtualComponents(methods)) {
            componentPages = await addVirtualComponents(
                transport,
                status,
                config,
                signal
            );
        }
        // The pill component is static, so the dynamic_only load above skips
        // it — but its attrs carry the firmware's supported-mode list on
        // newer builds. One extra keyed probe captures them.
        if (
            shouldProbeVirtualComponents(methods) &&
            methods.includes('Pill.GetConfig')
        ) {
            await fetchPillComponentAttrs(transport, config, signal);
        }
        timer.mark('components');

        // XT1 service devices: fetch service metadata (actions, errors, resources)
        if (capabilities.service) {
            await fetchServiceMeta(transport, config, signal);
        }
        timer.mark('service');

        // LedStrip: stash per-firmware catalogs so the UI renders dynamically.
        await fetchLedStripMeta(transport, config, signal);
        timer.mark('ledstrip');

        const eventCatalog = await fetchEventCatalog(
            transport,
            info.fw_id,
            signal
        );
        timer.mark('eventcatalog');

        // The safe* helpers swallow failures, so an abort in the last stage
        // would otherwise still hand back a bundle nobody is waiting for.
        signal?.throwIfAborted();
        return {
            info,
            status,
            config,
            capabilities,
            methods,
            eventCatalog,
            componentPages,
            gatherTiming: {
                totalMs: timer.totalMs(),
                stages: [...timer.stages()]
            }
        };
    }

    // Build the device from already-gathered data — a DB id lookup and the
    // object construction, no device RPCs. The fast half, reused at accept.
    private static async assembleOverTransport(
        transport: RpcTransport,
        bundle: DeviceDataBundle,
        admission?: RegistrationAdmission
    ): Promise<ShellyDevice> {
        const timer = new StageTimer();
        const rowId = await readRegistrationRowId(bundle.info.id, admission);
        timer.mark('db');

        const gatherTiming = bundle.gatherTiming ?? {totalMs: 0, stages: []};
        Observability.recordBuildTiming({
            shellyID: bundle.info.id,
            totalMs: gatherTiming.totalMs + timer.totalMs(),
            componentPages: bundle.componentPages,
            stages: [...gatherTiming.stages, ...timer.stages()]
        });
        const device = new ShellyDevice(
            bundle.info.id,
            transport,
            'online',
            bundle.info,
            bundle.status,
            bundle.config,
            false,
            rowId,
            undefined,
            bundle.capabilities,
            bundle.methods
        );
        if (bundle.eventCatalog) device.setEventCatalog(bundle.eventCatalog);
        return device;
    }

    // Gather device data over a live socket WITHOUT building the device, so the
    // waiting room can pre-warm the heavy fetch while a device sits idle.
    static gatherDeviceData(
        transport: RpcTransport,
        signal?: AbortSignal
    ): Promise<DeviceDataBundle> {
        return ShellyDeviceFactory.gatherOverTransport(
            transport,
            new StageTimer(),
            signal
        );
    }

    // Build a device from pre-gathered data (the accept fast path) — no device
    // RPCs, so accepting many at once doesn't re-run the heavy fetch per device.
    static assembleFromGathered(
        transport: RpcTransport,
        bundle: DeviceDataBundle,
        admission?: RegistrationAdmission
    ): Promise<ShellyDevice> {
        return ShellyDeviceFactory.assembleOverTransport(
            transport,
            bundle,
            admission
        );
    }
}

/**
 * This function modifies the parameters and creates side effects!
 * Usually not considered a good practice, but it works here 🤔
 */
// Everything the build gathers over the live socket, minus the device object
// and the DB id. Kept while a device waits so accept can assemble from it
// without re-fetching. `any` mirrors getData's shape (raw device payloads).
export interface DeviceDataBundle {
    info: any;
    status: any;
    config: any;
    capabilities: DeviceCapabilities;
    methods: string[];
    eventCatalog: Awaited<ReturnType<typeof fetchEventCatalog>>;
    componentPages: number;
    gatherTiming?: {
        totalMs: number;
        stages: readonly StageTiming[];
    };
}

// The supported-mode list rides the static pill component's attrs, which the
// dynamic_only load skips. Same _attrs merge shape as addVirtualComponents.
// Pre-normalization layer: the device-sent key is 'pill'.
async function fetchPillComponentAttrs(
    transport: RpcTransport,
    deviceConfig: Record<string, any>,
    signal?: AbortSignal
): Promise<void> {
    let pill: {config?: unknown; attrs?: unknown} | undefined;
    try {
        const result = await sendInitRpc(
            transport,
            'Shelly.GetComponents',
            {keys: ['pill']},
            signal
        );
        pill = result?.components?.find(
            (c: {key?: string}) => c?.key === 'pill'
        );
    } catch {
        // Older firmware rejects the keys filter — no list to capture.
        return;
    }
    if (!pill?.attrs) return;
    deviceConfig.pill = {
        ...(deviceConfig.pill ?? pill.config ?? {}),
        _attrs: pill.attrs
    };
}

// Hard cap protects against a buggy device whose total never converges.
const MAX_COMPONENT_PAGES = 100;

// Returns the number of GetComponents pages fetched, for build-timing visibility.
async function addVirtualComponents(
    transport: RpcTransport,
    deviceStatus: any,
    deviceConfig: any,
    signal?: AbortSignal
): Promise<number> {
    let offset = 0;
    let total = 0;
    let pages = 0;
    for (let pageIndex = 0; pageIndex < MAX_COMPONENT_PAGES; pageIndex++) {
        signal?.throwIfAborted();
        const result = await sendInitRpc(
            transport,
            'Shelly.GetComponents',
            {offset, dynamic_only: true},
            signal
        );
        pages++;
        total = result.total;
        const components = result.components;
        if (components.length === 0) break;
        for (const comp of components) {
            deviceStatus[comp.key] = comp.status;
            // Merge attrs into config so EntityComposer can access role/owner
            deviceConfig[comp.key] = comp.attrs
                ? {...comp.config, _attrs: comp.attrs}
                : comp.config;
        }
        // add newly loaded components to the offset
        offset += components.length;
        if (total <= offset) break;
    }
    if (total > offset) {
        logger.warn(
            'Shelly.GetComponents hit the %d-page cap (loaded %d of %d); components truncated',
            MAX_COMPONENT_PAGES,
            offset,
            total
        );
    }
    return pages;
}

/**
 * For XT1 service devices: fetch Service.GetInfo + ListConfigOptions for
 * every `service:N` instance the device exposes (not just service:0 — the
 * JWT and the JSON-RPC API both allow N > 0). Stored under each component's
 * own key in config so the entity composer surfaces per-service metadata.
 */
async function fetchServiceMeta(
    transport: RpcTransport,
    deviceConfig: any,
    signal?: AbortSignal
) {
    for (const id of listServiceIds(deviceConfig)) {
        // The safe* helpers below swallow failures, so the loop itself has to
        // see the abort or it keeps probing a gather nobody owns any more.
        signal?.throwIfAborted();
        await fetchOneServiceMeta(transport, deviceConfig, id, signal);
    }
}

function listServiceIds(deviceConfig: Record<string, unknown>): number[] {
    const ids: number[] = [];
    for (const key of Object.keys(deviceConfig)) {
        if (!key.startsWith('service:')) continue;
        const n = Number.parseInt(key.slice('service:'.length), 10);
        if (Number.isFinite(n)) ids.push(n);
    }
    return ids.length > 0 ? ids.sort((a, b) => a - b) : [0];
}

async function fetchOneServiceMeta(
    transport: RpcTransport,
    deviceConfig: any,
    id: number,
    signal?: AbortSignal
): Promise<void> {
    const svcKey = `service:${id}`;
    await safeFetchServiceInfo(transport, deviceConfig, svcKey, id, signal);
    await safeFetchServiceConfigOptions(
        transport,
        deviceConfig,
        svcKey,
        id,
        signal
    );
}

async function safeFetchServiceInfo(
    transport: RpcTransport,
    deviceConfig: any,
    svcKey: string,
    id: number,
    signal?: AbortSignal
): Promise<void> {
    try {
        const info = await sendInitRpc(
            transport,
            'Service.GetInfo',
            {id},
            signal
        );
        if (!info || typeof info !== 'object') return;
        if (!deviceConfig[svcKey] || typeof deviceConfig[svcKey] !== 'object') {
            return;
        }
        deviceConfig[svcKey]._meta = {
            type: info.type,
            ver: info.ver,
            label: info.meta?.ui?.label ?? info.meta?.ui?.title,
            actions: info.meta?.ui?.actions ?? [],
            conditions: info.meta?.ui?.conditions ?? {},
            errors: info.meta?.ui?.svc_errors ?? {}
        };
    } catch (err) {
        warnIfUnexpected('Service.GetInfo', id, err, signal);
    }
}

async function safeFetchServiceConfigOptions(
    transport: RpcTransport,
    deviceConfig: any,
    svcKey: string,
    id: number,
    signal?: AbortSignal
): Promise<void> {
    try {
        const opts = await sendInitRpc(
            transport,
            'Service.ListConfigOptions',
            {id},
            signal
        );
        if (!opts?.props || !Array.isArray(opts.props)) return;
        if (!deviceConfig[svcKey] || typeof deviceConfig[svcKey] !== 'object') {
            return;
        }
        deviceConfig[svcKey]._configOptions = opts.props;
    } catch (err) {
        warnIfUnexpected('Service.ListConfigOptions', id, err, signal);
    }
}

// Method-not-supported is the expected null path, and an abandoned gather is an
// operator decision, not a device fault; surface anything else.
function warnIfUnexpected(
    method: string,
    id: number,
    err: unknown,
    signal?: AbortSignal
): void {
    if (signal?.aborted) return;
    if (isMethodNotSupportedError(err)) return;
    logger.warn('%s for id=%d failed: %s', method, id, errorMessage(err));
}

// Runtime control surface — LedStrip.Set targets.
const LEDSTRIP_UI_RUNTIME_FIELDS: LedStripUiField[] = [
    {key: 'on', kind: 'toggle'},
    {key: 'brightness', kind: 'slider', min: 0, max: 100, unit: '%'},
    {
        key: 'effect',
        kind: 'enum',
        catalogKey: 'effects',
        allowlistKey: 'effects'
    },
    {key: 'rgb', kind: 'color', requiresMod: 'rgb'},
    {
        key: 'palette',
        kind: 'enum',
        catalogKey: 'palettes',
        requiresMod: 'palette'
    },
    {
        key: 'intensity',
        kind: 'slider',
        min: 0,
        max: 100,
        unit: '%',
        requiresMod: 'intensity'
    },
    {key: 'speed', kind: 'slider', min: 0, max: 100, unit: '%'}
];

// Config surface (LedStrip.SetConfig targets).
const LEDSTRIP_UI_CONFIG_FIELDS: LedStripUiField[] = [
    {key: 'name', kind: 'text'},
    {key: 'num_leds', kind: 'number', min: 1},
    {key: 'protocol', kind: 'enum', catalogKey: 'protocols'},
    {key: 'effects', kind: 'multiEnum', catalogKey: 'effects'},
    {key: 'initial_state', kind: 'number', min: 0, max: 2}
];

// Catalog comes from the device. UI descriptor lives here so adding a new firmware field is a one-line edit.
// Paginates Webhook.ListAllSupported and builds the per-device event
// catalog. Returns undefined for firmware that doesn't expose the method.
// Hard cap protects against buggy paginators that never converge.
const MAX_CATALOG_PAGES = 100;

// Exported for tests only.
export {MAX_CATALOG_PAGES};

// Exported for tests only.
export async function fetchEventCatalog(
    transport: RpcTransport,
    fwId: string | undefined,
    signal?: AbortSignal
): Promise<DeviceEventCatalog | undefined> {
    const pages = [];
    let offset = 0;
    for (let pageIndex = 0; pageIndex < MAX_CATALOG_PAGES; pageIndex++) {
        // safeFetchCatalogPage swallows the abort as "no page", so the loop
        // itself has to see it or it paginates on past the gather's deadline.
        signal?.throwIfAborted();
        const page = await safeFetchCatalogPage(transport, offset, signal);
        if (!page) {
            return pages.length > 0
                ? buildEventCatalog({pages, nowMs: Date.now(), fwId})
                : undefined;
        }
        pages.push(page);
        const pageRowCount = page.types?.length ?? 0;
        if (pageRowCount === 0) {
            warnPartialCatalogIfShort(page, offset);
            break;
        }
        const fetched = pageRowCount + offset;
        if (!page.total || fetched >= page.total) break;
        offset = fetched;
    }
    return buildEventCatalog({pages, nowMs: Date.now(), fwId});
}

function warnPartialCatalogIfShort(
    page: {total?: number},
    offset: number
): void {
    if (page.total && page.total > offset) {
        logger.warn(
            'Webhook.ListAllSupported returned empty page at offset=%d but total=%d — accepting partial catalog',
            offset,
            page.total
        );
    }
}

async function safeFetchCatalogPage(
    transport: RpcTransport,
    offset: number,
    signal?: AbortSignal
): Promise<{types?: ReadonlyArray<any>; total?: number} | null> {
    try {
        const resp = await sendInitRpc(
            transport,
            'Webhook.ListAllSupported',
            {offset},
            signal
        );
        if (!resp || typeof resp !== 'object') return null;
        return resp as {types?: ReadonlyArray<any>; total?: number};
    } catch (err) {
        if (isMethodNotSupportedError(err)) return null;
        logger.warn(
            'Webhook.ListAllSupported failed at offset=%d: %s',
            offset,
            errorMessage(err)
        );
        return null;
    }
}

// Single source: RpcError.isMethodNotFound (404/-32601 code or the explicit
// "method not found|not supported|unknown method" message). Exported for tests.
export function isMethodNotSupportedError(err: unknown): boolean {
    return RpcError.isMethodNotFound(err);
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

async function fetchLedStripMeta(
    transport: RpcTransport,
    deviceConfig: Record<string, any>,
    signal?: AbortSignal
): Promise<void> {
    for (const key of ledStripKeys(deviceConfig)) {
        // The safe* fetchers below swallow the abort, so the loop has to check
        // it or one dead socket costs a full catalog sweep per strip.
        signal?.throwIfAborted();
        await loadCatalogForLedStrip(
            transport,
            {config: deviceConfig, key},
            signal
        );
    }
}

export function ledStripKeys(deviceConfig: Record<string, unknown>): string[] {
    return Object.keys(deviceConfig).filter((k) => k.startsWith('ledstrip:'));
}

export function parseComponentId(key: string): number | null {
    const n = Number(key.split(':')[1]);
    return Number.isFinite(n) ? n : null;
}

interface LedStripTarget {
    config: Record<string, any>;
    key: string;
    id: number;
}

interface LedStripFieldSets {
    runtime: LedStripUiField[];
    config: LedStripUiField[];
}

interface ArrayFetchSpec {
    method: string;
    field: string;
    id: number;
}

async function loadCatalogForLedStrip(
    transport: RpcTransport,
    target: Omit<LedStripTarget, 'id'>,
    signal?: AbortSignal
): Promise<void> {
    const id = parseComponentId(target.key);
    if (id === null) return;
    const fullTarget: LedStripTarget = {...target, id};
    const catalog = await fetchLedStripCatalog(transport, id, signal);
    if (catalogIsEmpty(catalog)) return;
    stashCatalogOnConfig(fullTarget, catalog);
    stashUiFieldsOnConfig(fullTarget, {
        runtime: LEDSTRIP_UI_RUNTIME_FIELDS,
        config: LEDSTRIP_UI_CONFIG_FIELDS
    });
}

async function fetchLedStripCatalog(
    transport: RpcTransport,
    id: number,
    signal?: AbortSignal
): Promise<LedStripCatalog> {
    const [protocols, palettes, effects] = await Promise.all([
        safeFetchArrayField(
            transport,
            {
                id,
                method: 'LedStrip.ListAllProtocols',
                field: 'protocols'
            },
            signal
        ),
        safeFetchArrayField(
            transport,
            {
                id,
                method: 'LedStrip.ListAllPalettes',
                field: 'palettes'
            },
            signal
        ),
        safeFetchAllEffects(transport, id, signal)
    ]);
    return {
        protocols: protocols as string[] | undefined,
        palettes: palettes as LedStripCatalog['palettes'],
        effects: effects as LedStripCatalog['effects']
    };
}

export async function safeFetchArrayField(
    transport: RpcTransport,
    spec: ArrayFetchSpec,
    signal?: AbortSignal
): Promise<unknown[] | undefined> {
    try {
        const r = await sendInitRpc(
            transport,
            spec.method,
            {id: spec.id},
            signal
        );
        const value = (r as Record<string, unknown>)?.[spec.field];
        return Array.isArray(value) ? value : undefined;
    } catch (err) {
        warnIfUnexpected(spec.method, spec.id, err, signal);
        return undefined;
    }
}

async function safeFetchAllEffects(
    transport: RpcTransport,
    id: number,
    signal?: AbortSignal
): Promise<unknown[] | undefined> {
    try {
        return await paginateEffects(transport, id, signal);
    } catch (err) {
        warnIfUnexpected('LedStrip.ListAllEffects', id, err, signal);
        return undefined;
    }
}

// Hard cap protects against buggy paginators that never converge.
// Exported for tests only.
export const MAX_EFFECT_PAGES = 100;

export async function paginateEffects(
    transport: RpcTransport,
    id: number,
    signal?: AbortSignal
): Promise<unknown[]> {
    const collected: unknown[] = [];
    let offset = 0;
    for (let pageIndex = 0; pageIndex < MAX_EFFECT_PAGES; pageIndex++) {
        // The caller swallows failures, so the loop has to see the abort or it
        // keeps paging an effect list the gather already gave up on.
        signal?.throwIfAborted();
        const page = await fetchEffectPage(transport, {id, offset}, signal);
        if (page.length === 0) return collected;
        collected.push(...page);
        offset += page.length;
    }
    // Fell through without an empty page: the cap truncated the list. Don't
    // drop it silently.
    logger.warn(
        'LedStrip.ListAllEffects hit the %d-page cap for id=%d; effect list truncated',
        MAX_EFFECT_PAGES,
        id
    );
    return collected;
}

async function fetchEffectPage(
    transport: RpcTransport,
    page: {id: number; offset: number},
    signal?: AbortSignal
): Promise<unknown[]> {
    const r = await sendInitRpc(
        transport,
        'LedStrip.ListAllEffects',
        page,
        signal
    );
    const effects = (r as {effects?: unknown})?.effects;
    return Array.isArray(effects) ? effects : [];
}

export function catalogIsEmpty(catalog: LedStripCatalog): boolean {
    return !catalog.protocols && !catalog.palettes && !catalog.effects;
}

function stashCatalogOnConfig(
    target: LedStripTarget,
    catalog: LedStripCatalog
): void {
    const componentConfig = target.config[target.key];
    if (componentConfig && typeof componentConfig === 'object') {
        componentConfig._catalog = catalog;
    }
}

function stashUiFieldsOnConfig(
    target: LedStripTarget,
    fields: LedStripFieldSets
): void {
    const componentConfig = target.config[target.key];
    if (!componentConfig || typeof componentConfig !== 'object') return;
    if (!componentConfig._meta || typeof componentConfig._meta !== 'object') {
        componentConfig._meta = {};
    }
    if (
        !componentConfig._meta.ui ||
        typeof componentConfig._meta.ui !== 'object'
    ) {
        componentConfig._meta.ui = {};
    }
    componentConfig._meta.ui.fields = fields.runtime;
    componentConfig._meta.ui.configFields = fields.config;
}
