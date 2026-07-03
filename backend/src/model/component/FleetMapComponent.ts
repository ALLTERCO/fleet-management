/** fleetMap.* — per-location pin snapshots for map overlays. Cached ~5s. */

import * as log4js from 'log4js';
import * as DeviceCollector from '../../modules/DeviceCollector';
import {callMethod} from '../../modules/PostgresProvider';
import {resolveLocationShellyIDs} from '../../modules/scopeResolver';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {AlertSeverity} from '../../types/api/alert';
import {
    FLEET_MAP_DESCRIBE,
    FLEET_MAP_PARAMS,
    type FleetMapAlertPin,
    type FleetMapAlertSnapshot,
    type FleetMapEnergyPin,
    type FleetMapEnergySnapshot,
    type FleetMapSignalPin,
    type FleetMapSignalSnapshot
} from '../../types/api/fleetMap';
import type AbstractDevice from '../AbstractDevice';
import type CommandSender from '../CommandSender';
import {sumLiveLoad} from '../energy/liveLoad';
import Component from './Component';

const logger = log4js.getLogger('fleetMap');

const CACHE_TTL_MS = 5_000;
const RSSI_GOOD_DBM = -55;
const RSSI_FLOOR_DBM = -90;
const LOCATION_LIST_LIMIT = 10_000;
const ALERT_LIST_LIMIT = 10_000;

type Snapshot =
    | FleetMapEnergySnapshot
    | FleetMapSignalSnapshot
    | FleetMapAlertSnapshot;

interface CacheEntry<T extends Snapshot> {
    value: T;
    expiresAt: number;
}

interface MapParams {
    organizationId?: string;
}

export default class FleetMapComponent extends Component {
    static get describe(): DescribeOutput {
        return FLEET_MAP_DESCRIBE;
    }

    readonly #energyCache = new Map<
        string,
        CacheEntry<FleetMapEnergySnapshot>
    >();
    readonly #signalCache = new Map<
        string,
        CacheEntry<FleetMapSignalSnapshot>
    >();
    readonly #alertCache = new Map<string, CacheEntry<FleetMapAlertSnapshot>>();

    constructor() {
        super('fleetMap', {viewer_visible: true});
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.Expose('GetEnergySnapshot')
    @Component.NoAudit
    @Component.CrudPermission('dashboards', 'read')
    async getEnergySnapshot(
        params: unknown,
        sender: CommandSender
    ): Promise<FleetMapEnergySnapshot> {
        const p = validateOrThrow<MapParams>(params, FLEET_MAP_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const cached = readCache(this.#energyCache, orgId);
        if (cached) return cached;

        const locations = await listLocations(orgId);
        const devicesByLocation = await devicesForLocations(orgId, locations);
        const pins: FleetMapEnergyPin[] = locations.map((loc) => ({
            locationId: loc.id,
            currentLoadWatts: sumLiveLoad(devicesByLocation.get(loc.id) ?? []),
            baselineWatts: null
        }));
        return writeCache(this.#energyCache, orgId, {pins, asOf: nowIso()});
    }

    @Component.Expose('GetSignalSnapshot')
    @Component.NoAudit
    @Component.CrudPermission('dashboards', 'read')
    async getSignalSnapshot(
        params: unknown,
        sender: CommandSender
    ): Promise<FleetMapSignalSnapshot> {
        const p = validateOrThrow<MapParams>(params, FLEET_MAP_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const cached = readCache(this.#signalCache, orgId);
        if (cached) return cached;

        const locations = await listLocations(orgId);
        const devicesByLocation = await devicesForLocations(orgId, locations);
        const pins: FleetMapSignalPin[] = locations.map((loc) => {
            const devices = devicesByLocation.get(loc.id) ?? [];
            return {
                locationId: loc.id,
                signalHealth: avgSignalHealth(devices),
                deviceCount: devices.length
            };
        });
        return writeCache(this.#signalCache, orgId, {pins, asOf: nowIso()});
    }

    @Component.Expose('GetAlertSnapshot')
    @Component.NoAudit
    @Component.CrudPermission('dashboards', 'read')
    async getAlertSnapshot(
        params: unknown,
        sender: CommandSender
    ): Promise<FleetMapAlertSnapshot> {
        const p = validateOrThrow<MapParams>(params, FLEET_MAP_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const cached = readCache(this.#alertCache, orgId);
        if (cached) return cached;

        const pins = await aggregateAlertsByLocation(orgId);
        return writeCache(this.#alertCache, orgId, {pins, asOf: nowIso()});
    }
}

// ── helpers ───────────────────────────────────────────────────

function readCache<T extends Snapshot>(
    cache: Map<string, CacheEntry<T>>,
    orgId: string
): T | null {
    const e = cache.get(orgId);
    return e && e.expiresAt > Date.now() ? e.value : null;
}

function writeCache<T extends Snapshot>(
    cache: Map<string, CacheEntry<T>>,
    orgId: string,
    value: T
): T {
    cache.set(orgId, {value, expiresAt: Date.now() + CACHE_TTL_MS});
    return value;
}

function nowIso(): string {
    return new Date().toISOString();
}

interface LocationRow {
    id: number;
}

async function listLocations(orgId: string): Promise<LocationRow[]> {
    const {rows} = await callMethod('organization.fn_location_list', {
        p_organization_id: orgId,
        p_include_summary: false,
        p_limit: LOCATION_LIST_LIMIT,
        p_offset: 0
    });
    const list = (rows ?? []) as Array<{id?: number}>;
    if (list.length >= LOCATION_LIST_LIMIT) {
        logger.warn(
            'listLocations hit limit=%d for org %s — map data may be incomplete',
            LOCATION_LIST_LIMIT,
            orgId
        );
    }
    return list
        .map((r) => ({id: r.id}))
        .filter((r): r is LocationRow => typeof r.id === 'number');
}

async function devicesForLocations(
    orgId: string,
    locations: readonly LocationRow[]
): Promise<Map<number, AbstractDevice[]>> {
    const shellyIDsByLocation = await resolveLocationShellyIDs(
        orgId,
        locations.map((l) => l.id)
    );
    const devicesByLocation = new Map<number, AbstractDevice[]>();
    for (const loc of locations) {
        const shellyIDs = shellyIDsByLocation.get(loc.id) ?? [];
        devicesByLocation.set(loc.id, liveDevices(shellyIDs));
    }
    return devicesByLocation;
}

function liveDevices(shellyIDs: readonly string[]): AbstractDevice[] {
    return shellyIDs
        .map((s) => DeviceCollector.getDevice(s))
        .filter((d): d is AbstractDevice => d != null);
}

function avgSignalHealth(devices: readonly AbstractDevice[]): number {
    let sum = 0;
    let n = 0;
    for (const dev of devices) {
        if (!dev.online) continue;
        const status = (dev.status ?? {}) as Record<string, unknown>;
        const wifi = status.wifi as {rssi?: number} | undefined;
        if (!wifi || typeof wifi.rssi !== 'number') continue;
        sum += rssiToHealth(wifi.rssi);
        n += 1;
    }
    return n === 0 ? 0 : sum / n;
}

function rssiToHealth(rssi: number): number {
    if (rssi >= RSSI_GOOD_DBM) return 100;
    if (rssi <= RSSI_FLOOR_DBM) return 0;
    return ((rssi - RSSI_FLOOR_DBM) / (RSSI_GOOD_DBM - RSSI_FLOOR_DBM)) * 100;
}

interface AlertRow {
    state?: string;
    severity?: string;
    active_since?: string | null;
    source_subject_type?: string;
    source_subject_id?: string;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
    critical: 3,
    warning: 2,
    info: 1
};

interface OpenAlertBucket {
    count: number;
    top: AlertSeverity | null;
    oldest: string | null;
}

async function aggregateAlertsByLocation(
    orgId: string
): Promise<FleetMapAlertPin[]> {
    const {rows} = await callMethod('notifications.fn_alert_instance_list', {
        p_organization_id: orgId,
        p_state: null,
        p_severity: null,
        p_rule_id: null,
        p_source_type: null,
        p_source_id: null,
        p_location_ids: null,
        p_group_ids: null,
        p_tag_ids: null,
        p_query: null,
        p_limit: ALERT_LIST_LIMIT,
        p_offset: 0
    });
    const alertRows = rows ?? [];
    if (alertRows.length >= ALERT_LIST_LIMIT) {
        logger.warn(
            'aggregateAlertsByLocation hit limit=%d for org %s — alert map may be incomplete',
            ALERT_LIST_LIMIT,
            orgId
        );
    }

    const openByDevice = new Map<string, OpenAlertBucket>();
    for (const raw of alertRows) {
        const r = raw as AlertRow;
        if (!isOpenState(r.state)) continue;
        if (r.source_subject_type !== 'device') continue;
        if (!r.source_subject_id) continue;
        const sev = isSeverity(r.severity) ? r.severity : null;
        const bucket = openByDevice.get(r.source_subject_id) ?? {
            count: 0,
            top: null,
            oldest: null
        };
        bucket.count += 1;
        if (
            sev &&
            (!bucket.top || SEVERITY_RANK[sev] > SEVERITY_RANK[bucket.top])
        ) {
            bucket.top = sev;
        }
        if (
            r.active_since &&
            (!bucket.oldest || r.active_since < bucket.oldest)
        ) {
            bucket.oldest = r.active_since;
        }
        openByDevice.set(r.source_subject_id, bucket);
    }

    const locations = await listLocations(orgId);
    const shellyIDsByLocation = await resolveLocationShellyIDs(
        orgId,
        locations.map((l) => l.id)
    );
    return locations.map((loc) =>
        rollUpLocationAlerts(
            loc.id,
            shellyIDsByLocation.get(loc.id) ?? [],
            openByDevice
        )
    );
}

function rollUpLocationAlerts(
    locationId: number,
    shellyIDs: readonly string[],
    openByDevice: ReadonlyMap<string, OpenAlertBucket>
): FleetMapAlertPin {
    let count = 0;
    let top: AlertSeverity | null = null;
    let oldest: string | null = null;
    for (const sid of shellyIDs) {
        const b = openByDevice.get(sid);
        if (!b) continue;
        count += b.count;
        if (b.top && (!top || SEVERITY_RANK[b.top] > SEVERITY_RANK[top])) {
            top = b.top;
        }
        if (b.oldest && (!oldest || b.oldest < oldest)) {
            oldest = b.oldest;
        }
    }
    return {
        locationId,
        openAlertCount: count,
        topSeverity: top,
        oldestActiveSince: oldest
    };
}

function isOpenState(state: string | undefined): boolean {
    return (
        state === 'active' ||
        state === 'acknowledged' ||
        state === 'cleared_unack'
    );
}

function isSeverity(v: string | undefined): v is AlertSeverity {
    return v === 'critical' || v === 'warning' || v === 'info';
}
