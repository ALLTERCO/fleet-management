// Curated device namespace as a factory over injected RPC access.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {toHostDevice} from '../device-mapper';
import {namespaceCaller} from '../namespace-caller';
import type {DeviceCapabilities, FleetRpcAccess, HostDevice} from '../types';

type DeviceMethod = Extract<HostMethod, `device.${string}`>;

function toHostDevices(items: readonly unknown[] | undefined): HostDevice[] {
    return (items ?? []).map(toHostDevice);
}

export type HostDeviceListPage = {
    items: HostDevice[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    /** Pass as `cursor` for the next page; null on the last page. */
    next_cursor: string | null;
};

/** Older Fleet versions answer without a cursor; their pages end the walk. */
function nextCursorOf(envelope: object): string | null {
    return 'next_cursor' in envelope && typeof envelope.next_cursor === 'string'
        ? envelope.next_cursor
        : null;
}

export type FleetDeviceDomain = {
    /**
     * `params` is the generated contract's own shape, not `object`. A template
     * asking for `locationId` should be told at build time whether the backend
     * can answer it — the untyped version is how a filter the list did not
     * implement reached production and quietly returned nothing.
     */
    list(params?: HostParams<'device.list'>): Promise<HostDevice[]>;
    listPage(params?: HostParams<'device.list'>): Promise<HostDeviceListPage>;
    get(shellyID: string): Promise<HostDevice>;
    fullStatus(shellyID: string): Promise<HostResult<'device.get'>>;
    renamePhysical(input: {
        shellyID: string;
        name: string;
    }): Promise<HostResult<'sys.setconfig'>>;
    reboot(shellyID: string): Promise<HostResult<'shelly.reboot'>>;
    delete(shellyID: string): Promise<HostResult<'device.delete'>>;
    retire(shellyID: string): Promise<HostResult<'device.retire'>>;
    restore(shellyID: string): Promise<HostResult<'device.restore'>>;
    listRetired(): Promise<HostResult<'device.listretired'>>;
    checkReplacement(
        input: HostParams<'device.checkreplacement'>
    ): Promise<HostResult<'device.checkreplacement'>>;
    replaceHardware(
        input: HostParams<'device.replacehardware'>
    ): Promise<HostResult<'device.replacehardware'>>;
    setKind(
        input: HostParams<'device.setkind'>
    ): Promise<HostResult<'device.setkind'>>;
    getKind(shellyID: string): Promise<HostResult<'device.getkind'>>;
    setImage(
        input: HostParams<'device.setimage'>
    ): Promise<HostResult<'device.setimage'>>;
    getImage(
        input: HostParams<'device.getimage'>
    ): Promise<HostResult<'device.getimage'>>;
    statusTimeline(
        input: HostParams<'device.getstatustimeline'>
    ): Promise<HostResult<'device.getstatustimeline'>>;
    /** A whole `device.get` per call. Read `.capabilities` off a device you
     *  already have rather than calling this once per row. */
    fetchCapabilities(shellyID: string): Promise<DeviceCapabilities>;
    /** @deprecated Reads like a field; it is a network round trip.
     *  Use `fetchCapabilities`. Removed in Fleet 2.0.0. */
    capabilities(shellyID: string): Promise<DeviceCapabilities>;
    // Stays `unknown`, not the contract's `Record<string, unknown>`: plenty of
    // firmware methods answer `null`, so the contract overpromises here.
    call(
        shellyID: string,
        method: string,
        params?: Record<string, unknown>
    ): Promise<unknown>;
    /** One method across many devices in one round trip. */
    callMany(
        input: HostParams<'device.callmany'>
    ): Promise<HostResult<'device.callmany'>>;
    getInfo(shellyID: string): Promise<HostResult<'device.getinfo'>>;
    getSetup(
        input?: HostParams<'device.getsetup'>
    ): Promise<HostResult<'device.getsetup'>>;
    getDeviceChannels(
        shellyID: string
    ): Promise<HostResult<'device.getdevicechannels'>>;
    /** Bucketed history for one status field — not the current value. */
    getStatusHistory(
        input: HostParams<'device.getstatushistory'>
    ): Promise<HostResult<'device.getstatushistory'>>;
    topology(
        input?: HostParams<'device.topology'>
    ): Promise<HostResult<'device.topology'>>;
    relationships: {
        get(
            input: HostParams<'device.relationships.get'>
        ): Promise<HostResult<'device.relationships.get'>>;
        query(
            input?: HostParams<'device.relationships.query'>
        ): Promise<HostResult<'device.relationships.query'>>;
    };
};

export function createDeviceDomain(access: FleetRpcAccess): FleetDeviceDomain {
    const call = namespaceCaller<DeviceMethod>(access);
    const domain: FleetDeviceDomain = {
        async listPage(
            params: HostParams<'device.list'> = {}
        ): Promise<HostDeviceListPage> {
            const res = await call('device.list', params);
            if (
                !Array.isArray(res.items) ||
                typeof res.total !== 'number' ||
                typeof res.limit !== 'number' ||
                typeof res.offset !== 'number' ||
                typeof res.has_more !== 'boolean'
            ) {
                throw new TypeError(
                    'device.list returned an invalid pagination envelope'
                );
            }
            return {
                items: toHostDevices(res.items),
                total: res.total,
                limit: res.limit,
                offset: res.offset,
                has_more: res.has_more,
                next_cursor: nextCursorOf(res)
            };
        },
        async list(
            params: HostParams<'device.list'> = {}
        ): Promise<HostDevice[]> {
            const res = await call('device.list', params);
            return toHostDevices(res.items);
        },
        async get(shellyID: string): Promise<HostDevice> {
            return toHostDevice(await call('device.get', {shellyID}));
        },
        fullStatus(shellyID: string) {
            return call('device.get', {shellyID});
        },
        renamePhysical({shellyID, name}) {
            return access.rpc<HostResult<'sys.setconfig'>>('sys.setconfig', {
                shellyID,
                config: {device: {name}}
            });
        },
        reboot(shellyID: string) {
            return access.rpc<HostResult<'shelly.reboot'>>('shelly.reboot', {
                shellyID
            });
        },
        delete(shellyID: string) {
            return call('device.delete', {shellyID});
        },
        // Soft delete: hides the device but keeps its id and history.
        retire(shellyID: string) {
            return call('device.retire', {shellyID});
        },
        restore(shellyID: string) {
            return call('device.restore', {shellyID});
        },
        listRetired() {
            return call('device.listretired', {});
        },
        // Hardware swap keeps id + history: checkReplacement, then replace.
        checkReplacement(input) {
            return call('device.checkreplacement', input);
        },
        replaceHardware(input) {
            return call('device.replacehardware', input);
        },
        setKind(input) {
            return call('device.setkind', input);
        },
        getKind(shellyID: string) {
            return call('device.getkind', {shellyID});
        },
        setImage(input) {
            return call('device.setimage', input);
        },
        getImage(input) {
            return call('device.getimage', input);
        },
        statusTimeline(input) {
            return call('device.getstatustimeline', input);
        },
        async fetchCapabilities(shellyID: string): Promise<DeviceCapabilities> {
            return (await domain.get(shellyID)).capabilities ?? {};
        },
        capabilities(shellyID: string): Promise<DeviceCapabilities> {
            return domain.fetchCapabilities(shellyID);
        },
        call(
            shellyID: string,
            method: string,
            params: Record<string, unknown> = {}
        ) {
            return call('device.call', {shellyID, method, params});
        },
        // One relayed call per device in a loop is what melts a big fleet.
        callMany(input) {
            return call('device.callmany', input);
        },
        getInfo(shellyID: string) {
            return call('device.getinfo', {shellyID});
        },
        getSetup(input: HostParams<'device.getsetup'> = {}) {
            return call('device.getsetup', input);
        },
        getDeviceChannels(shellyID: string) {
            return call('device.getdevicechannels', {shellyID});
        },
        // History, not live: rendering it as the current value shows a value
        // that is hours old.
        getStatusHistory(input) {
            return call('device.getstatushistory', input);
        },
        topology(input: HostParams<'device.topology'> = {}) {
            return call('device.topology', input);
        },
        relationships: {
            get(input) {
                return call('device.relationships.get', input);
            },
            query(input: HostParams<'device.relationships.query'> = {}) {
                return call('device.relationships.query', input);
            }
        }
    };
    return domain;
}
