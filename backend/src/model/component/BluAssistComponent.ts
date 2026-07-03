// bluassist.* — wraps GATTC.* on a Shelly BLU Assistant for scan, connect,
// discover, read/write, notify, bonding, and call. Connection tracker keeps
// a hint-cache of active slots for the UI.

import {resolveBluDeviceInfo} from '../../config/BTHomeData';
import {parseAdvData} from '../../modules/bluAssistAdvParser';
import {
    listConnections,
    MAX_PER_DEVICE,
    markDiscovered,
    recordConnect,
    recordDisconnect
} from '../../modules/bluAssistConnectionTracker';
import * as DeviceCollector from '../../modules/DeviceCollector';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BLU_ASSIST_ADDR_PARAMS_SCHEMA,
    BLU_ASSIST_BOND_EN_PARAMS_SCHEMA,
    BLU_ASSIST_CALL_PARAMS_SCHEMA,
    BLU_ASSIST_CONNECT_PARAMS_SCHEMA,
    BLU_ASSIST_CONNECTION_LIST_PARAMS_SCHEMA,
    BLU_ASSIST_DISCONNECT_PARAMS_SCHEMA,
    BLU_ASSIST_DISCOVER_PARAMS_SCHEMA,
    BLU_ASSIST_READ_PARAMS_SCHEMA,
    BLU_ASSIST_SCAN_PARAMS_SCHEMA,
    BLU_ASSIST_SET_NOTIFY_PARAMS_SCHEMA,
    BLU_ASSIST_WRITE_PARAMS_SCHEMA,
    BLUASSIST_DESCRIBE,
    type BluAssistAddrParams,
    type BluAssistBondEnParams,
    type BluAssistCallParams,
    type BluAssistConnectionListParams,
    type BluAssistConnectionListResponse,
    type BluAssistConnectParams,
    type BluAssistDisconnectParams,
    type BluAssistDiscoverParams,
    type BluAssistReadParams,
    type BluAssistScanKnown,
    type BluAssistScanParams,
    type BluAssistScanResponse,
    type BluAssistScanResult,
    type BluAssistSetNotifyParams,
    type BluAssistWriteParams
} from '../../types/api/bluassist';
import type CommandSender from '../CommandSender';
import {getDeviceOrThrow, wrapDeviceRpc} from '../deviceAdminRpc';
import Component from './Component';

const DEFAULT_SCAN = {
    active: false,
    duration_ms: 5000,
    window_ms: 95,
    interval_ms: 100,
    rssi_thr: -100
};

interface RawScanRow {
    addr?: unknown;
    rssi?: unknown;
    adv_data?: unknown;
}

function baseMac(addr: string): string {
    return addr.split(',')[0].toLowerCase();
}

function enrichParsedWithCatalog(
    raw: ReturnType<typeof parseAdvData>
): BluAssistScanResult['parsed'] {
    if (raw.modelId == null) return {...raw};
    const profile = resolveBluDeviceInfo(undefined, raw.modelId);
    return {
        ...raw,
        modelString: profile.modelId,
        productName: profile.modelId ? profile.productName : undefined
    };
}

export default class BluAssistComponent extends Component<any> {
    constructor() {
        super('bluassist', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BLUASSIST_DESCRIBE;
    }

    @Component.Expose('Scan')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcScan(
        params: unknown,
        sender: CommandSender
    ): Promise<BluAssistScanResponse> {
        const v = validateOrThrow<BluAssistScanParams>(
            params,
            BLU_ASSIST_SCAN_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        const device = getDeviceOrThrow(v.shellyID);
        const scanParams = {
            active: v.active ?? DEFAULT_SCAN.active,
            duration_ms: v.duration_ms ?? DEFAULT_SCAN.duration_ms,
            window_ms: v.window_ms ?? DEFAULT_SCAN.window_ms,
            interval_ms: v.interval_ms ?? DEFAULT_SCAN.interval_ms,
            rssi_thr: v.rssi_thr ?? DEFAULT_SCAN.rssi_thr
        };
        const scanResp = await wrapDeviceRpc('GATTC.Scan', () =>
            device.sendRPC('GATTC.Scan', scanParams)
        );
        const rawResults: RawScanRow[] = Array.isArray(
            (scanResp as {results?: unknown})?.results
        )
            ? (scanResp as {results: RawScanRow[]}).results
            : [];

        const knownByMac = await buildFleetByAddr(sender);
        const shellyOnly = v.shellyOnly ?? true;
        const enriched: BluAssistScanResult[] = [];
        for (const r of rawResults) {
            const addr = typeof r.addr === 'string' ? r.addr : null;
            const rssi = typeof r.rssi === 'number' ? r.rssi : null;
            if (!addr || rssi === null) continue;
            const advData =
                typeof r.adv_data === 'string' ? r.adv_data : undefined;
            const parsedRaw = advData ? parseAdvData(advData) : undefined;
            const parsed = parsedRaw
                ? enrichParsedWithCatalog(parsedRaw)
                : undefined;
            const known = knownByMac.get(baseMac(addr));
            if (shellyOnly && !parsed?.isShellyBlu && !known) continue;
            enriched.push({addr, rssi, advData, parsed, knownInFleet: known});
        }
        enriched.sort((a, b) => b.rssi - a.rssi);
        return {results: enriched, scanned: rawResults.length};
    }

    @Component.Expose('Connect')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcConnect(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistConnectParams>(
            params,
            BLU_ASSIST_CONNECT_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        const device = getDeviceOrThrow(v.shellyID);
        // Pool cap is enforced by firmware; the local tracker can desync if a
        // peer disconnects without notice, so don't pre-reject here.
        const args: Record<string, unknown> = {addr: v.addr};
        if (v.timeout_ms !== undefined) args.timeout = v.timeout_ms;
        const resp = (await wrapDeviceRpc('GATTC.Connect', () =>
            device.sendRPC('GATTC.Connect', args)
        )) as {conn_id?: number; mtu?: number} | undefined;
        if (resp?.conn_id === undefined) {
            throw new Error('GATTC.Connect did not return conn_id');
        }
        recordConnect(v.shellyID, {
            conn_id: resp.conn_id,
            addr: v.addr,
            mtu: resp.mtu
        });
        return {conn_id: resp.conn_id, addr: v.addr, mtu: resp.mtu};
    }

    @Component.Expose('Disconnect')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcDisconnect(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistDisconnectParams>(
            params,
            BLU_ASSIST_DISCONNECT_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        if (v.conn_id === undefined && v.addr === undefined) {
            throw new Error('conn_id or addr is required');
        }
        const device = getDeviceOrThrow(v.shellyID);
        const args: Record<string, unknown> = {};
        if (v.conn_id !== undefined) args.conn_id = v.conn_id;
        if (v.addr !== undefined) args.addr = v.addr;
        const resp = await wrapDeviceRpc('GATTC.Disconnect', () =>
            device.sendRPC('GATTC.Disconnect', args)
        );
        recordDisconnect(v.shellyID, {conn_id: v.conn_id, addr: v.addr});
        return resp ?? {};
    }

    @Component.Expose('Discover')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcDiscover(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistDiscoverParams>(
            params,
            BLU_ASSIST_DISCOVER_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        if (v.conn_id === undefined && v.addr === undefined) {
            throw new Error('conn_id or addr is required');
        }
        const device = getDeviceOrThrow(v.shellyID);
        const args: Record<string, unknown> = {};
        if (v.conn_id !== undefined) args.conn_id = v.conn_id;
        if (v.addr !== undefined) args.addr = v.addr;
        const resp = await wrapDeviceRpc('GATTC.Discover', () =>
            device.sendRPC('GATTC.Discover', args)
        );
        if (v.conn_id !== undefined) markDiscovered(v.shellyID, v.conn_id);
        return resp ?? {};
    }

    @Component.Expose('Read')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcRead(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistReadParams>(
            params,
            BLU_ASSIST_READ_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        if (v.handle === undefined && (!v.svc || !v.chr)) {
            throw new Error('handle or svc+chr are required');
        }
        const device = getDeviceOrThrow(v.shellyID);
        const args: Record<string, unknown> = {conn_id: v.conn_id};
        if (v.handle !== undefined) args.handle = v.handle;
        if (v.svc) args.svc = v.svc;
        if (v.chr) args.chr = v.chr;
        return (
            (await wrapDeviceRpc('GATTC.Read', () =>
                device.sendRPC('GATTC.Read', args)
            )) ?? {}
        );
    }

    @Component.Expose('Write')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcWrite(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistWriteParams>(
            params,
            BLU_ASSIST_WRITE_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        if (v.handle === undefined && (!v.svc || !v.chr)) {
            throw new Error('handle or svc+chr are required');
        }
        const device = getDeviceOrThrow(v.shellyID);
        const args: Record<string, unknown> = {
            conn_id: v.conn_id,
            data: v.data
        };
        if (v.handle !== undefined) args.handle = v.handle;
        if (v.svc) args.svc = v.svc;
        if (v.chr) args.chr = v.chr;
        if (v.response !== undefined) args.response = v.response;
        return (
            (await wrapDeviceRpc('GATTC.Write', () =>
                device.sendRPC('GATTC.Write', args)
            )) ?? {}
        );
    }

    @Component.Expose('SetNotify')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcSetNotify(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistSetNotifyParams>(
            params,
            BLU_ASSIST_SET_NOTIFY_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        if (v.handle === undefined && (!v.svc || !v.chr)) {
            throw new Error('handle or svc+chr are required');
        }
        const device = getDeviceOrThrow(v.shellyID);
        const args: Record<string, unknown> = {
            conn_id: v.conn_id,
            mode: v.mode
        };
        if (v.handle !== undefined) args.handle = v.handle;
        if (v.svc) args.svc = v.svc;
        if (v.chr) args.chr = v.chr;
        return (
            (await wrapDeviceRpc('GATTC.SetNotify', () =>
                device.sendRPC('GATTC.SetNotify', args)
            )) ?? {}
        );
    }

    @Component.Expose('Call')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcCall(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistCallParams>(
            params,
            BLU_ASSIST_CALL_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        const device = getDeviceOrThrow(v.shellyID);
        const args: Record<string, unknown> = {
            addr: v.addr,
            method: v.method
        };
        if (v.params) args.params = v.params;
        return (
            (await wrapDeviceRpc('GATTC.Call', () =>
                device.sendRPC('GATTC.Call', args)
            )) ?? {}
        );
    }

    @Component.Expose('Bond.Enable')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcBondEnable(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistBondEnParams>(
            params,
            BLU_ASSIST_BOND_EN_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        const device = getDeviceOrThrow(v.shellyID);
        return (
            (await wrapDeviceRpc('GATTC.BondEn', () =>
                device.sendRPC('GATTC.BondEn', {enable: v.enable})
            )) ?? {}
        );
    }

    @Component.Expose('Bond.Has')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcBondHas(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistAddrParams>(
            params,
            BLU_ASSIST_ADDR_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        const device = getDeviceOrThrow(v.shellyID);
        try {
            return (
                (await wrapDeviceRpc('GATTC.HaveBond', () =>
                    device.sendRPC('GATTC.HaveBond', {addr: v.addr})
                )) ?? {}
            );
        } catch (err) {
            // Firmware returns 404 "bond not found" when none exists. Normalize.
            const msg = err instanceof Error ? err.message : String(err);
            if (/bond not found/i.test(msg)) return {have_bond: false};
            throw err;
        }
    }

    @Component.Expose('Bond.Delete')
    @Component.CrudPermission('devices', 'update', (p) => p?.shellyID)
    async rpcBondDelete(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<BluAssistAddrParams>(
            params,
            BLU_ASSIST_ADDR_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        const device = getDeviceOrThrow(v.shellyID);
        return (
            (await wrapDeviceRpc('GATTC.DeleteBond', () =>
                device.sendRPC('GATTC.DeleteBond', {addr: v.addr})
            )) ?? {}
        );
    }

    @Component.NoAudit
    @Component.Expose('Connection.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.shellyID)
    async rpcConnectionList(
        params: unknown,
        sender: CommandSender
    ): Promise<BluAssistConnectionListResponse> {
        const v = validateOrThrow<BluAssistConnectionListParams>(
            params,
            BLU_ASSIST_CONNECTION_LIST_PARAMS_SCHEMA
        );
        requireOrganizationId(sender);
        getDeviceOrThrow(v.shellyID); // permission/existence gate only
        const slots = listConnections(v.shellyID).map((c) => ({
            conn_id: c.conn_id,
            addr: c.addr,
            openedAt: new Date(c.openedAt).toISOString(),
            discoveredAt: c.discoveredAt
                ? new Date(c.discoveredAt).toISOString()
                : undefined,
            mtu: c.mtu
        }));
        return {
            slots,
            capacity: MAX_PER_DEVICE,
            inUse: slots.length
        };
    }

    protected override getDefaultConfig() {
        return {};
    }
}

// Map of base-MAC → fleet record. Builds from in-memory device state.
async function buildFleetByAddr(
    sender: CommandSender
): Promise<Map<string, BluAssistScanKnown>> {
    const map = new Map<string, BluAssistScanKnown>();
    const devices = DeviceCollector.getAll();
    const allowed = await sender.filterAccessibleDevices(
        devices.map((d) => d.shellyID)
    );
    for (const device of devices) {
        if (!allowed.has(device.shellyID)) continue;
        const status = device.status as Record<string, unknown> | undefined;
        const config = device.config as Record<string, unknown> | undefined;
        if (!status) continue;
        for (const [key, value] of Object.entries(status)) {
            if (!key.startsWith('bthomedevice:')) continue;
            const addr = (value as {addr?: unknown})?.addr;
            if (typeof addr !== 'string') continue;
            const cfg = config?.[key] as {name?: unknown} | undefined;
            const name =
                typeof cfg?.name === 'string' && cfg.name ? cfg.name : key;
            map.set(addr.toLowerCase(), {
                externalId: `${device.shellyID}.${key}`,
                name,
                gatewayShellyId: device.shellyID
            });
        }
    }
    return map;
}
