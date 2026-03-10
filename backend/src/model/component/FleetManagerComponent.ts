import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {format as csvFormat} from 'fast-csv';
import {DEV_MODE} from '../../config';
import {PLUGINS_FOLDER} from '../../config';
import * as Commander from '../../modules/Commander';
import * as DeviceCollector from '../../modules/DeviceCollector';
import * as EventDistributor from '../../modules/EventDistributor';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {PluginLoader} from '../../modules/plugins';
import RpcError from '../../rpc/RpcError';
import type {PluginData, event_data_t, json_rpc_event} from '../../types';
import type {FleetManager} from '../../validations/params';
import type CommandSender from '../CommandSender';
import Component from './Component';

const PLUGIN_UPLOADS = path.join(__dirname, '../../../uploads/reports');
if (!fsSync.existsSync(PLUGIN_UPLOADS)) {
    fsSync.mkdirSync(PLUGIN_UPLOADS, {recursive: true});
}
const WS_BUFFER_WARN = 1_048_576; // 1MB — log warning, never drop
const deviceNameCache = new Map<number, string>();

async function resolveDeviceIds(
    shellyIDs: string[]
): Promise<{internalIds: number[]; idMap: Record<number, string>}> {
    const rows = await PostgresProvider.getBatch(shellyIDs);
    const internalIds: number[] = [];
    const idMap: Record<number, string> = {};
    for (const row of rows) {
        internalIds.push(row.id);
        idMap[row.id] = row.external_id;
    }
    return {internalIds, idMap};
}

const REPORT_TYPES: Record<
    string,
    {
        tags: string[];
        columns: Record<string, string>;
        unit: string;
        divisor: number;
        precision: number;
    }
> = {
    consumption: {
        tags: ['total_act_energy'],
        columns: {total_act_energy: 'energy_kwh'},
        unit: 'kWh',
        divisor: 1000,
        precision: 3
    },
    returned_energy: {
        tags: ['total_act_ret_energy'],
        columns: {total_act_ret_energy: 'returned_energy_kwh'},
        unit: 'kWh',
        divisor: 1000,
        precision: 3
    },
    voltage: {
        tags: ['voltage', 'min_voltage', 'max_voltage'],
        columns: {
            voltage: 'avg_voltage_v',
            min_voltage: 'min_voltage_v',
            max_voltage: 'max_voltage_v'
        },
        unit: 'V',
        divisor: 1,
        precision: 2
    },
    current: {
        tags: ['current', 'min_current', 'max_current'],
        columns: {
            current: 'avg_current_a',
            min_current: 'min_current_a',
            max_current: 'max_current_a'
        },
        unit: 'A',
        divisor: 1,
        precision: 3
    },
    power: {
        tags: ['power'],
        columns: {power: 'avg_power_w'},
        unit: 'W',
        divisor: 1,
        precision: 1
    }
};

const GRANULARITY_MAP: Record<string, string> = {
    minute: '1 minute',
    hour: '1 hour',
    day: '1 day',
    month: '1 month'
};

interface StatRow {
    ts: Date;
    channel: number;
    val: number;
    phase: string;
    device: number;
    tag: string;
}

interface tDeviceReport {
    device: string;
    recordDate?: string;
    totalEnergyKw?: number;
    price?: number;
    [x: string]: any;
}

async function persistInstance(file: string, report_config_id: number) {
    if (!report_config_id) return null;
    const r = await PostgresProvider.callMethod('logging.add_report_instance', {
        p_file_path: file,
        p_report_config_id: report_config_id,
        p_timestamp: null
    });
    return r?.rows?.[0]?.id ?? null;
}

async function writeCsvAndReturnMeta(
    rows: Record<string, any>[],
    name: string,
    extraMeta: Record<string, any> = {}
) {
    const safeName = sanitizeFileName(name);

    const filePath = path.join(PLUGIN_UPLOADS, `${safeName}.csv`);

    await new Promise<void>((resolve, reject) => {
        const ws = fsSync.createWriteStream(filePath);
        ws.on('finish', resolve);
        ws.on('error', reject);

        const csvStream = csvFormat({headers: true});
        csvStream.on('error', reject);
        csvStream.pipe(ws);
        for (const row of rows) csvStream.write(row);
        csvStream.end();
    });

    return {
        id: safeName,
        file: `uploads/reports/${safeName}.csv`,
        name: safeName,
        generated: new Date().toISOString(),
        size: (await fs.stat(filePath)).size,
        ...extraMeta
    };
}

function sanitizeFileName(
    input: string,
    opts: {maxLength?: number} = {}
): string {
    const maxLength = opts.maxLength ?? 120;

    let s = String(input || '')
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '');

    s = s.replace(/[<>:"/\\|?*]/g, '-');

    {
        let out = '';
        for (const ch of s) {
            const code = ch.charCodeAt(0);
            out += code < 32 || code === 127 ? '-' : ch;
        }
        s = out;
    }

    s = s.trim().replace(/\s+/g, '-');

    s = s.replace(/^\.+/, '');
    s = s.replace(/[ .]+$/g, '');

    s = s.replace(/[-_]{2,}/g, '-');

    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    if (reserved.test(s)) s = `_${s}`;

    if (s.length > maxLength) {
        s = s.slice(0, maxLength).replace(/[ .]+$/g, '');
    }

    if (!s) s = 'report';

    return s;
}

async function deviceId2DeviceName(
    rows: tDeviceReport[],
    idMap: Record<number, string>
): Promise<tDeviceReport[]> {
    // Batch-fetch all uncached device names in a single query
    const uncachedShellyIDs: string[] = [];
    for (const r of rows) {
        const iid = Number(r.device);
        if (!deviceNameCache.has(iid) && idMap[iid]) {
            uncachedShellyIDs.push(idMap[iid]);
        }
    }
    if (uncachedShellyIDs.length > 0) {
        try {
            const batchRows =
                await PostgresProvider.getBatch(uncachedShellyIDs);
            for (const row of batchRows) {
                deviceNameCache.set(row.id, row.jdoc?.name || row.external_id);
            }
        } catch {
            // Fallback: use shellyIDs as names
            for (const r of rows) {
                const iid = Number(r.device);
                if (!deviceNameCache.has(iid)) {
                    deviceNameCache.set(iid, idMap[iid] || String(iid));
                }
            }
        }
    }

    return rows.map((r) => {
        const iid = Number(r.device);
        const name = deviceNameCache.get(iid) || idMap[iid] || String(iid);
        return {...r, device: name};
    });
}

async function getShellyIDsFromConfig(
    report_config_id?: number
): Promise<string[]> {
    if (!report_config_id) return [];
    const res = await PostgresProvider.callMethod('logging.get_report_config', {
        p_id: report_config_id
    });
    const row = res?.rows?.[0];
    const params = row?.params || {};
    const devices = Array.isArray(params.devices) ? params.devices : [];
    return devices;
}

export default class FleetManagerComponent extends Component<any> {
    constructor() {
        super('fleetmanager', {auto_apply_config: false});
        this.methods.delete('setconfig');
    }

    @Component.Expose('GetVariables')
    @Component.NoPermissions
    getVariables() {
        const variables: Record<string, any> = {
            'login-strategy': DEV_MODE ? 'local' : 'zitadel-introspection',
            'dev-mode': DEV_MODE
        };
        return variables;
    }

    @Component.Expose('Subscribe')
    @Component.ReadOnly
    subscribe(
        params: {events: string[]; options: Record<string, any>},
        sender: CommandSender
    ) {
        const {events, options} = params;
        const subscribedEvents: [string, number][] = [];

        const socket = sender.getSocket();
        if (!socket) {
            throw RpcError.Server('No websocket found');
        }
        for (const event of events) {
            const eventOptions = options?.events?.[event];
            const shellyIDs = options?.shellyIDs;
            const event_id = EventDistributor.addEventListener(
                sender,
                event,
                {...eventOptions, shellyIDs},
                (evt: json_rpc_event, eventData: event_data_t) => {
                    if (socket.readyState === 1) {
                        if (socket.bufferedAmount > WS_BUFFER_WARN) {
                            this.logger.warn(
                                'WS client buffer high: %d bytes',
                                socket.bufferedAmount
                            );
                        }
                        socket.send(
                            eventData?.serialized || JSON.stringify(evt)
                        );
                    }
                }
            );
            subscribedEvents.push([event, event_id]);
            this.logger.mark(
                'added event event_name:[%s] event_id:[%s] options:[%s]',
                event,
                event_id,
                eventOptions
            );
        }

        socket.on('close', () => {
            subscribedEvents.forEach(([eventName, id]) =>
                EventDistributor.removeEventListener(id, eventName)
            );
        });

        // Pre-warm device access cache (fire-and-forget, non-blocking)
        // Eliminates async DB fallback in EventDistributor hot loop for first events
        if (!sender.isAdmin()) {
            const allIds = Array.from(DeviceCollector.getAllShellyIDs());
            sender.filterAccessibleDevices(allIds).catch(() => {});
        }

        return Promise.resolve({ids: subscribedEvents.map(([, id]) => id)});
    }

    @Component.Expose('Unsubscribe')
    @Component.ReadOnly
    unsubscribe(params: FleetManager.Unsubscribe) {
        const {ids} = params;
        this.logger.debug('unsubscribing', ids.join(','));
        ids.forEach((id) => EventDistributor.removeEventListener(id, ''));
    }

    @Component.Expose('ListPlugins')
    listPlugins() {
        const plugins = PluginLoader.listPlugins() as Record<
            string,
            PluginData & {config?: any}
        >;
        for (const name in plugins) {
            plugins[name].config = Commander.getComponent(
                `plugin:${name}`
            )?.getConfig();
        }
        return plugins;
    }

    @Component.Expose('UploadPlugin')
    async uploadPlugin(params: {data: string}) {
        const fileData = Buffer.from(params.data, 'base64');
        const filePath = path.join(PLUGINS_FOLDER, 'upload.zip');
        await fs.writeFile(filePath, fileData);
        return null;
    }

    @Component.Expose('RemovePlugin')
    @Component.CheckParams((p: any) => typeof p.name === 'string')
    async removePlugin(params: {name: string}) {
        await PluginLoader.disablePlugin(params.name);
        const dir = path.join(PLUGINS_FOLDER, params.name);
        try {
            await fs.rm(dir, {recursive: true, force: true});
            this.logger.mark(`Deleted plugin folder: ${dir}`);
        } catch (err) {
            this.logger.error(`Failed to delete plugin folder ${dir}`, err);
            throw err;
        }
        return {removed: params.name};
    }

    @Component.Expose('ListCommands')
    listCommands() {
        return Commander.listCommands();
    }

    @Component.Expose('FetchMonthlyReport')
    @Component.NoPermissions
    async fetchReports(
        params: {date: number; tariff: number; report_config_id: number},
        sender: CommandSender
    ) {
        deviceNameCache.clear();
        const {date, tariff, report_config_id} = params;

        if (
            typeof report_config_id !== 'number' ||
            typeof date !== 'number' ||
            date < 1 ||
            date > 28 ||
            typeof tariff !== 'number' ||
            tariff < 0
        ) {
            throw RpcError.InvalidParams('Invalid parameters for FetchReports');
        }

        const cfgRes = await PostgresProvider.callMethod(
            'logging.get_report_config',
            {
                p_id: report_config_id
            }
        );
        const cfgRow = cfgRes?.rows?.[0];
        if (!cfgRow) throw RpcError.Server('Report config not found');
        const shellyIDs: string[] = Array.isArray(cfgRow?.params?.devices)
            ? cfgRow.params.devices
            : [];
        if (!shellyIDs.length)
            throw RpcError.Server('No devices in report config');

        const {internalIds, idMap} = await resolveDeviceIds(shellyIDs);
        if (!internalIds.length) throw RpcError.Server('No device IDs found');

        const rep = await PostgresProvider.callMethod(
            'device_em.fn_report_mount_diff',
            {
                p_devices: internalIds,
                p_period: 'month',
                p_period_look_back: 1,
                p_end_period_day: date
            }
        );

        let sumEnergy = 0;
        let sumPrice = 0;
        const rawRows = rep.rows.map((r: any) => {
            const energy = r.total_energy_kw;
            const price = +(energy * tariff).toFixed(2);
            sumEnergy += energy;
            sumPrice += price;
            return {
                device: String(r.device),
                recordDate: r.record_date,
                totalEnergyKw: +energy.toFixed(3),
                price: +price.toFixed(2)
            };
        });

        const namedRows = await deviceId2DeviceName(rawRows as any, idMap);
        namedRows.push({
            device: 'Totals',
            recordDate: '',
            totalEnergyKw: +sumEnergy.toFixed(3),
            price: +sumPrice.toFixed(2)
        });

        const ts = Date.now();
        const meta = await writeCsvAndReturnMeta(namedRows, `monthly_${ts}`, {
            devices: shellyIDs,
            period: 'month',
            date,
            tariff,
            rows: namedRows.length
        });
        await persistInstance(meta.file, report_config_id);
        return meta;
    }

    @Component.Expose('FetchCustomRangeReport')
    @Component.NoPermissions
    async fetchRange(
        params: {
            from: string;
            to: string;
            tariff: number;
            report_config_id: number;
        },
        sender: CommandSender
    ) {
        deviceNameCache.clear();
        const {from, to, tariff, report_config_id} = params;

        if (
            typeof report_config_id !== 'number' ||
            typeof from !== 'string' ||
            !from ||
            typeof to !== 'string' ||
            !to ||
            typeof tariff !== 'number'
        ) {
            throw RpcError.InvalidParams('Invalid parameters for FetchRange');
        }

        const cfgRes = await PostgresProvider.callMethod(
            'logging.get_report_config',
            {
                p_id: report_config_id
            }
        );
        const cfgRow = cfgRes?.rows?.[0];
        if (!cfgRow) throw RpcError.Server('Report config not found');
        const shellyIDs: string[] = Array.isArray(cfgRow?.params?.devices)
            ? cfgRow.params.devices
            : [];
        if (!shellyIDs.length)
            throw RpcError.Server('No devices in report config');

        const {internalIds, idMap} = await resolveDeviceIds(shellyIDs);
        if (!internalIds.length) throw RpcError.Server('No device IDs found');

        const rep = await PostgresProvider.callMethod(
            'device_em.fn_report_diff',
            {
                p_devices: internalIds,
                p_from: new Date(from),
                p_to: new Date(to),
                p_period: 'day'
            }
        );

        let sumEnergy = 0;
        let sumPrice = 0;
        const rawRows = rep.rows.map((r: any) => {
            const energy = r.total_energy_kw;
            const price = +(energy * tariff).toFixed(2);
            sumEnergy += energy;
            sumPrice += price;
            return {
                recordDate: r.record_date,
                device: String(r.device),
                totalEnergyKw: +energy.toFixed(3),
                price: +price.toFixed(2)
            };
        });

        const namedRows = await deviceId2DeviceName(
            rawRows.map((x: any) => ({...x, device: String(x.device)})),
            idMap
        );
        namedRows.push({
            recordDate: '',
            device: 'Totals',
            totalEnergyKw: +sumEnergy.toFixed(3),
            price: +sumPrice.toFixed(2)
        });

        const ts = Date.now();
        const meta = await writeCsvAndReturnMeta(namedRows, `range_${ts}`, {
            devices: shellyIDs,
            from,
            to,
            tariff,
            rows: namedRows.length
        });
        await persistInstance(meta.file, report_config_id);
        return meta;
    }

    @Component.Expose('FetchDBDump')
    @Component.NoPermissions
    async dumpStatsToFile(
        params: {from: string; to: string; report_config_id: number},
        sender: CommandSender
    ) {
        deviceNameCache.clear();
        const {from, to, report_config_id} = params;

        if (
            typeof report_config_id !== 'number' ||
            typeof from !== 'string' ||
            !from ||
            typeof to !== 'string' ||
            !to
        ) {
            throw RpcError.InvalidParams(
                'Invalid parameters for DumpStatsToFile'
            );
        }

        const cfgRes = await PostgresProvider.callMethod(
            'logging.get_report_config',
            {
                p_id: report_config_id
            }
        );
        const cfgRow = cfgRes?.rows?.[0];
        if (!cfgRow) throw RpcError.Server('Report config not found');
        const shellyIDs: string[] = Array.isArray(cfgRow?.params?.devices)
            ? cfgRow.params.devices
            : [];
        if (!shellyIDs.length)
            throw RpcError.Server('No devices in report config');

        const {internalIds, idMap} = await resolveDeviceIds(shellyIDs);
        if (!internalIds.length) {
            throw RpcError.Server('No device IDs found');
        }

        const qr = (await PostgresProvider.callMethod(
            'device_em.fn_dump_stats',
            {
                p_devices: internalIds,
                p_start: new Date(from),
                p_end: new Date(to)
            }
        )) as {rows: StatRow[]};

        const uniqueIds = Array.from(
            new Set(qr.rows.map((r: any) => Number(r.device)))
        );
        // Batch-fetch uncached device names
        const uncachedShellyIDs = uniqueIds
            .filter((iid) => !deviceNameCache.has(iid) && idMap[iid])
            .map((iid) => idMap[iid]);
        if (uncachedShellyIDs.length > 0) {
            try {
                const batchRows =
                    await PostgresProvider.getBatch(uncachedShellyIDs);
                for (const row of batchRows) {
                    deviceNameCache.set(
                        row.id,
                        row.jdoc?.name || row.external_id
                    );
                }
            } catch {
                for (const iid of uniqueIds) {
                    if (!deviceNameCache.has(iid)) {
                        deviceNameCache.set(iid, idMap[iid]);
                    }
                }
            }
        }

        const csvRows = qr.rows.map((r: any) => {
            const iid = Number(r.device);
            const name = deviceNameCache.get(iid)!;
            return {
                ts: r.ts,
                channel: r.channel,
                val: r.val,
                phase: r.phase,
                device: name,
                tag: r.tag
            };
        });

        const ts = Date.now();
        const meta = await writeCsvAndReturnMeta(csvRows, `dump_${ts}`, {
            devices: shellyIDs,
            from,
            to
        });
        await persistInstance(meta.file, report_config_id);
        return meta;
    }

    @Component.Expose('ListReportConfigs')
    @Component.NoPermissions
    async listReportConfigs() {
        const res = await PostgresProvider.callMethod(
            'logging.get_report_configs',
            {}
        );
        return res.rows;
    }

    @Component.Expose('ListReports')
    @Component.NoPermissions
    async listReports() {
        const res = await PostgresProvider.callMethod(
            'logging.get_report_instances',
            {}
        );
        return res.rows;
    }

    @Component.Expose('AddReportConfig')
    @Component.NoPermissions
    async addReportConfig(params: {
        report_type: 'monthly' | 'custom' | 'dump' | string;
        config: any;
    }) {
        const {report_type, config} = params || ({} as any);
        if (!report_type || typeof config !== 'object') {
            throw RpcError.InvalidParams('report_type and config are required');
        }
        const res = await PostgresProvider.callMethod(
            'logging.add_report_config',
            {
                p_report_type: report_type,
                p_params: config
            }
        );
        const row = res?.rows?.[0];
        const id =
            typeof row === 'object' && row !== null
                ? (row.id ?? row.add_report_config ?? Object.values(row)[0])
                : row;
        return {id};
    }

    @Component.Expose('DeleteReportConfig')
    @Component.NoPermissions
    async deleteReportConfig(params: {id: number}) {
        const {id} = params || ({} as any);

        if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {
            throw RpcError.InvalidParams('id must be a positive number');
        }

        await PostgresProvider.callMethod('logging.delete_report_config', {
            p_id: id
        });

        return {deleted: id};
    }

    @Component.Expose('GenerateReport')
    @Component.NoPermissions
    async generateReport(
        params: {
            report_config_id?: number;
            group_id?: number;
            report_type: string;
            from: string;
            to: string;
            granularity: string;
            per_device: boolean;
            tariff?: number;
        },
        sender: CommandSender
    ) {
        deviceNameCache.clear();
        const {
            report_config_id,
            group_id,
            report_type,
            from,
            to,
            granularity,
            per_device,
            tariff
        } = params;

        const reportDef = REPORT_TYPES[report_type];
        if (!reportDef) {
            throw RpcError.InvalidParams(
                `Invalid report_type "${report_type}". Valid types: ${Object.keys(REPORT_TYPES).join(', ')}`
            );
        }
        const bucket = GRANULARITY_MAP[granularity];
        if (!bucket) {
            throw RpcError.InvalidParams(
                `Invalid granularity "${granularity}". Valid options: ${Object.keys(GRANULARITY_MAP).join(', ')}`
            );
        }
        if (
            typeof from !== 'string' ||
            !from ||
            typeof to !== 'string' ||
            !to
        ) {
            throw RpcError.InvalidParams(
                'from (string) and to (string) are required'
            );
        }
        if (
            typeof report_config_id !== 'number' &&
            typeof group_id !== 'number'
        ) {
            throw RpcError.InvalidParams(
                'Either report_config_id or group_id is required'
            );
        }

        // Get device list from report config or group
        let shellyIDs: string[];
        if (typeof report_config_id === 'number') {
            const cfgRes = await PostgresProvider.callMethod(
                'logging.get_report_config',
                {p_id: report_config_id}
            );
            const cfgRow = cfgRes?.rows?.[0];
            if (!cfgRow) throw RpcError.Server('Report config not found');
            shellyIDs = Array.isArray(cfgRow?.params?.devices)
                ? cfgRow.params.devices
                : [];
        } else {
            const groupRes = await PostgresProvider.callMethod(
                'device.fn_groups_get',
                {p_id: group_id}
            );
            const group = groupRes?.rows?.[0];
            if (!group) throw RpcError.Server('Group not found');
            shellyIDs = group.devices || [];
        }
        if (!shellyIDs.length) throw RpcError.Server('No devices found');

        // Resolve shelly IDs to internal IDs (batch)
        const {internalIds, idMap} = await resolveDeviceIds(shellyIDs);
        if (!internalIds.length) throw RpcError.Server('No device IDs found');

        // Call the generic report stats function
        const rep = await PostgresProvider.callMethod(
            'device_em.fn_report_stats',
            {
                p_devices: internalIds,
                p_from: new Date(from),
                p_to: new Date(to),
                p_tags: reportDef.tags,
                p_bucket: bucket,
                p_per_device: per_device !== false
            }
        );

        if (rep.rows.length > 2_000_000) {
            throw RpcError.Server(
                `Result too large (${rep.rows.length} rows). Use a coarser granularity or shorter date range.`
            );
        }

        const isEnergy =
            report_type === 'consumption' || report_type === 'returned_energy';
        const hasTariff = isEnergy && typeof tariff === 'number' && tariff > 0;

        // Build CSV rows — merge multiple tags per bucket+device into one row
        let sumValue = 0;
        let sumCost = 0;
        const isMultiTag = reportDef.tags.length > 1;
        const mergedMap = new Map<string, Record<string, any>>();
        const rawRows: Record<string, any>[] = [];

        for (const r of rep.rows) {
            const value = +(r.agg_value / reportDef.divisor).toFixed(
                reportDef.precision
            );
            const colName = reportDef.columns[r.tag] || r.tag;

            if (isMultiTag) {
                // Merge rows with same bucket+device
                const key = `${r.bucket}::${r.device}`;
                let row = mergedMap.get(key);
                if (!row) {
                    row = {bucket: r.bucket, device: String(r.device)};
                    mergedMap.set(key, row);
                }
                row[colName] = value;
            } else {
                const row: Record<string, any> = {
                    bucket: r.bucket,
                    device: String(r.device),
                    [colName]: value
                };
                if (isEnergy) {
                    sumValue += value;
                    if (hasTariff) {
                        const cost = +(value * tariff!).toFixed(2);
                        row.cost = cost;
                        sumCost += cost;
                    }
                }
                rawRows.push(row);
            }
        }

        if (isMultiTag) {
            // Ensure all rows have all columns (fill missing with empty string)
            const allCols = Object.values(reportDef.columns);
            for (const row of mergedMap.values()) {
                for (const col of allCols) {
                    if (row[col] === undefined) row[col] = '';
                }
                rawRows.push(row);
            }
        }

        // Resolve device names if per-device
        let finalRows: Record<string, any>[];
        if (per_device !== false) {
            finalRows = await deviceId2DeviceName(
                rawRows as tDeviceReport[],
                idMap
            );
        } else {
            finalRows = rawRows.map((r) => ({...r, device: 'All Devices'}));
        }

        // Add totals row for energy types
        if (isEnergy && finalRows.length > 0) {
            const colName = Object.values(reportDef.columns)[0];
            const totalsRow: Record<string, any> = {
                bucket: '',
                device: 'Totals',
                [colName]: +sumValue.toFixed(reportDef.precision)
            };
            if (hasTariff) {
                totalsRow.cost = +sumCost.toFixed(2);
            }
            finalRows.push(totalsRow);
        }

        const ts = Date.now();
        const perDeviceLabel = per_device !== false ? 'per_device' : 'group';
        const meta = await writeCsvAndReturnMeta(
            finalRows,
            `${report_type}_${granularity}_${perDeviceLabel}_${ts}`,
            {
                devices: shellyIDs,
                report_type,
                granularity,
                per_device: per_device !== false,
                from,
                to,
                tariff: hasTariff ? tariff : undefined,
                rows: finalRows.length
            }
        );
        if (typeof report_config_id === 'number') {
            await persistInstance(meta.file, report_config_id);
        }
        return meta;
    }

    @Component.Expose('PurgeReports')
    @Component.NoPermissions
    async purgeReports() {
        try {
            const files = await fs.readdir(PLUGIN_UPLOADS);
            const csvs = files.filter((f) => f.toLowerCase().endsWith('.csv'));

            let deletedFiles = 0;
            await Promise.all(
                csvs.map(async (fname) => {
                    try {
                        await fs.unlink(path.join(PLUGIN_UPLOADS, fname));
                        deletedFiles++;
                    } catch {
                        this.logger.error(`Failed to delete file: ${fname}`);
                    }
                })
            );

            await PostgresProvider.callMethod(
                'logging.delete_all_report_instances',
                {}
            );

            return {success: true, deletedFiles, deletedDb: true};
        } catch (err) {
            throw RpcError.Server(`Failed to purge reports: ${String(err)}`);
        }
    }

    @Component.Expose('SendRPC')
    async sendRpc(
        params: {
            dst: string | string[];
            method: string;
            params?: any;
            silent?: boolean;
        },
        sender: CommandSender
    ) {
        const {method, silent} = params || ({} as any);
        if (!method || typeof method !== 'string') {
            throw RpcError.InvalidParams('SendRPC: "method" is required');
        }

        const dsts = Array.isArray(params.dst) ? params.dst : [params.dst];
        const results: Record<string, any> = {};

        await Promise.allSettled(
            dsts.map(async (sid) => {
                const shellyID = String(sid);

                // Check execute permission for each device
                if (!sender.canPerformOnItem('devices', 'execute', shellyID)) {
                    results[shellyID] = {
                        code: -32001,
                        message: 'Permission denied: execute not allowed'
                    };
                    return;
                }

                const dev = DeviceCollector.getDevice(shellyID);
                if (!dev) {
                    results[shellyID] = {
                        code: -32002,
                        message: 'Device offline or not found'
                    };
                    return;
                }
                try {
                    const res = await dev.sendRPC(
                        method,
                        params?.params ?? {},
                        silent
                    );
                    results[shellyID] = res;
                } catch (err: any) {
                    results[shellyID] =
                        err && typeof err === 'object' && 'code' in err
                            ? err
                            : {code: -32603, message: String(err)};
                }
            })
        );

        return results;
    }

    @Component.Expose('PostgresProviderCallMethod')
    @Component.NoPermissions
    async postgresProviderCallMethod(params: {
        name: string;
        args?: any;
        txId?: number;
    }) {
        const {name, args, txId} = params || ({} as any);

        if (typeof name !== 'string' || name.length === 0) {
            throw RpcError.InvalidParams(
                'PostgresProviderCallMethod: "name" must be a non-empty string'
            );
        }

        try {
            const raw = await PostgresProvider.callMethod(
                name,
                args ?? {},
                txId
            );
            const rows = Array.isArray(raw?.rows) ? raw.rows : raw;
            const safeRows = JSON.parse(JSON.stringify(rows));

            return {rows: safeRows};
        } catch (err: any) {
            const message = err?.message ?? String(err);
            throw RpcError.Server(
                `PostgresProviderCallMethod failed for "${name}": ${message}`
            );
        }
    }

    @Component.Expose('SubscribeToNotifications')
    @Component.NoPermissions
    async notificationsSubscribe(params: {token?: string}) {
        const token = (params?.token ?? '').trim();

        if (!token || typeof token !== 'string') {
            throw RpcError.InvalidParams(
                'NotificationsSubscribe: "token" must be a non-empty string'
            );
        }

        try {
            const res = await PostgresProvider.callMethod(
                'notifications.add_token',
                {
                    p_token: token
                }
            );

            const row =
                Array.isArray(res?.rows) && res.rows.length > 0
                    ? res.rows[0]
                    : {token};

            return {
                id: row.id ?? null,
                token: row.token ?? token
            };
        } catch (err: any) {
            const message = err?.message ?? String(err);
            throw RpcError.Server(`NotificationsSubscribe failed: ${message}`);
        }
    }

    @Component.Expose('ListNotificationTokens')
    @Component.NoPermissions
    async listNotificationTokens() {
        try {
            const res = await PostgresProvider.callMethod(
                'notifications.get_all_tokens',
                {}
            );
            const rows = Array.isArray(res?.rows) ? res.rows : [];

            return rows.map((r: any) => ({
                id: r.id ?? null,
                token: r.token ?? null,
                created: r.created ?? null,
                updated: r.updated ?? null,
                ...(r && typeof r === 'object' && 'platform' in r
                    ? {platform: r.platform}
                    : {}), //potentially to be added
                ...(r && typeof r === 'object' && 'user_id' in r
                    ? {user_id: r.user_id}
                    : {}) //potentially to be added
            }));
        } catch (err: any) {
            const message = err?.message ?? String(err);
            throw RpcError.Server(`ListNotificationTokens failed: ${message}`);
        }
    }

    // ==================== ANALYTICS DASHBOARD METHODS ====================

    @Component.Expose('GetGroupMetrics')
    @Component.NoPermissions
    async getGroupMetrics(params: {groupId: number}) {
        const {groupId} = params || ({} as any);

        if (typeof groupId !== 'number' || groupId <= 0) {
            throw RpcError.InvalidParams('groupId must be a positive number');
        }

        // Get group with its devices array (shelly IDs)
        const groupRes = await PostgresProvider.callMethod(
            'device.fn_groups_get',
            {p_id: groupId}
        );
        const group = groupRes?.rows?.[0];
        const shellyIds: string[] = group?.devices || [];

        if (shellyIds.length === 0) {
            return {groupId, devices: [], metrics: {}};
        }

        // Get device info and current status for all devices
        const devicesInfo: any[] = [];
        const metrics: Record<string, any> = {
            uptime: {avg: 0, min: 0, max: 0, values: []},
            voltage: {avg: 0, min: 0, max: 0, values: []},
            current: {avg: 0, min: 0, max: 0, values: []},
            power: {total: 0, values: []},
            consumption: {total: 0, values: []},
            returned_energy: {total: 0, values: []},
            temperature: {avg: 0, min: 0, max: 0, values: []},
            humidity: {avg: 0, min: 0, max: 0, values: []},
            luminance: {avg: 0, values: []}
        };

        for (const shellyId of shellyIds) {
            try {
                const device = DeviceCollector.getDevice(shellyId);
                if (!device) continue;

                const deviceId = device.id;
                const status = device.status || {};
                const deviceName = (device.info?.name as string) || shellyId;

                devicesInfo.push({
                    id: deviceId,
                    shellyID: shellyId,
                    name: deviceName
                });

                // Uptime from sys.uptime (include device name for table display)
                if (status.sys?.uptime) {
                    const uptime = status.sys.uptime;
                    metrics.uptime.values.push({
                        deviceId,
                        deviceName,
                        value: uptime
                    });
                }

                // EM devices (em:0, em:1, etc.) - voltage, current, power
                for (let i = 0; i < 3; i++) {
                    const em = status[`em:${i}`];
                    if (em) {
                        if (typeof em.voltage === 'number') {
                            metrics.voltage.values.push({
                                deviceId,
                                value: em.voltage
                            });
                        }
                        if (typeof em.current === 'number') {
                            metrics.current.values.push({
                                deviceId,
                                value: em.current
                            });
                        }
                        if (typeof em.act_power === 'number') {
                            metrics.power.values.push({
                                deviceId,
                                value: em.act_power
                            });
                        }
                    }
                }

                // EM1 devices (em1:0, em1:1, etc.)
                for (let i = 0; i < 3; i++) {
                    const em1 = status[`em1:${i}`];
                    if (em1) {
                        if (typeof em1.voltage === 'number') {
                            metrics.voltage.values.push({
                                deviceId,
                                value: em1.voltage
                            });
                        }
                        if (typeof em1.current === 'number') {
                            metrics.current.values.push({
                                deviceId,
                                value: em1.current
                            });
                        }
                        if (typeof em1.act_power === 'number') {
                            metrics.power.values.push({
                                deviceId,
                                value: em1.act_power
                            });
                        }
                    }
                }

                // EM data for consumption (em1data, emdata)
                for (let i = 0; i < 3; i++) {
                    const em1data = status[`em1data:${i}`];
                    if (em1data) {
                        if (typeof em1data.total_act_energy === 'number') {
                            metrics.consumption.values.push({
                                deviceId,
                                value: em1data.total_act_energy / 1000
                            }); // Convert Wh to kWh
                        }
                        if (typeof em1data.total_act_ret_energy === 'number') {
                            metrics.returned_energy.values.push({
                                deviceId,
                                value: em1data.total_act_ret_energy / 1000
                            });
                        }
                    }
                    const emdata = status[`emdata:${i}`];
                    if (emdata) {
                        if (typeof emdata.total_act === 'number') {
                            metrics.consumption.values.push({
                                deviceId,
                                value: emdata.total_act / 1000
                            });
                        }
                        if (typeof emdata.total_act_ret === 'number') {
                            metrics.returned_energy.values.push({
                                deviceId,
                                value: emdata.total_act_ret / 1000
                            });
                        }
                    }
                }

                // Switch devices (switch:0, switch:1, etc.)
                for (let i = 0; i < 5; i++) {
                    const sw = status[`switch:${i}`];
                    if (sw) {
                        if (typeof sw.voltage === 'number') {
                            metrics.voltage.values.push({
                                deviceId,
                                value: sw.voltage
                            });
                        }
                        if (typeof sw.current === 'number') {
                            metrics.current.values.push({
                                deviceId,
                                value: sw.current
                            });
                        }
                        if (typeof sw.apower === 'number') {
                            metrics.power.values.push({
                                deviceId,
                                value: sw.apower
                            });
                        }
                        if (sw.aenergy?.total !== undefined) {
                            metrics.consumption.values.push({
                                deviceId,
                                value: sw.aenergy.total / 1000
                            });
                        }
                        if (sw.ret_aenergy?.total !== undefined) {
                            metrics.returned_energy.values.push({
                                deviceId,
                                value: sw.ret_aenergy.total / 1000
                            });
                        }
                    }
                }

                // PM1 (Power Meter) devices (pm1:0, pm1:1, etc.)
                for (let i = 0; i < 5; i++) {
                    const pm = status[`pm1:${i}`];
                    if (pm) {
                        if (typeof pm.voltage === 'number') {
                            metrics.voltage.values.push({
                                deviceId,
                                value: pm.voltage
                            });
                        }
                        if (typeof pm.current === 'number') {
                            metrics.current.values.push({
                                deviceId,
                                value: pm.current
                            });
                        }
                        if (typeof pm.apower === 'number') {
                            metrics.power.values.push({
                                deviceId,
                                value: pm.apower
                            });
                        }
                        if (pm.aenergy?.total !== undefined) {
                            metrics.consumption.values.push({
                                deviceId,
                                value: pm.aenergy.total / 1000
                            });
                        }
                        if (pm.ret_aenergy?.total !== undefined) {
                            metrics.returned_energy.values.push({
                                deviceId,
                                value: pm.ret_aenergy.total / 1000
                            });
                        }
                    }
                }

                // Temperature sensors (temperature:0, temperature:100, etc.)
                for (const key of Object.keys(status)) {
                    if (key.startsWith('temperature:')) {
                        const temp = status[key];
                        if (typeof temp?.tC === 'number') {
                            metrics.temperature.values.push({
                                deviceId,
                                value: temp.tC
                            });
                        }
                    }
                }

                // Humidity sensors
                for (const key of Object.keys(status)) {
                    if (key.startsWith('humidity:')) {
                        const hum = status[key];
                        if (typeof hum?.rh === 'number') {
                            metrics.humidity.values.push({
                                deviceId,
                                value: hum.rh
                            });
                        }
                    }
                }

                // Illuminance/Luminance sensors
                for (const key of Object.keys(status)) {
                    if (key.startsWith('illuminance:')) {
                        const lux = status[key];
                        if (typeof lux?.lux === 'number') {
                            metrics.luminance.values.push({
                                deviceId,
                                value: lux.lux
                            });
                        }
                    }
                }
            } catch {
                // Skip devices that can't be fetched
            }
        }

        // Calculate aggregates
        const calcStats = (values: {deviceId: number; value: number}[]) => {
            if (values.length === 0) return {avg: 0, min: 0, max: 0};
            const nums = values.map((v) => v.value);
            return {
                avg: nums.reduce((a, b) => a + b, 0) / nums.length,
                min: Math.min(...nums),
                max: Math.max(...nums)
            };
        };

        const calcTotal = (values: {deviceId: number; value: number}[]) => {
            if (values.length === 0) return 0;
            return values.reduce((a, b) => a + b.value, 0);
        };

        // Update aggregates
        const uptimeStats = calcStats(metrics.uptime.values);
        metrics.uptime.avg = uptimeStats.avg;
        metrics.uptime.min = uptimeStats.min;
        metrics.uptime.max = uptimeStats.max;

        const voltageStats = calcStats(metrics.voltage.values);
        metrics.voltage.avg = voltageStats.avg;
        metrics.voltage.min = voltageStats.min;
        metrics.voltage.max = voltageStats.max;

        const currentStats = calcStats(metrics.current.values);
        metrics.current.avg = currentStats.avg;
        metrics.current.min = currentStats.min;
        metrics.current.max = currentStats.max;

        metrics.power.total = calcTotal(metrics.power.values);
        metrics.consumption.total = calcTotal(metrics.consumption.values);
        metrics.returned_energy.total = calcTotal(
            metrics.returned_energy.values
        );

        const tempStats = calcStats(metrics.temperature.values);
        metrics.temperature.avg = tempStats.avg;
        metrics.temperature.min = tempStats.min;
        metrics.temperature.max = tempStats.max;

        const humStats = calcStats(metrics.humidity.values);
        metrics.humidity.avg = humStats.avg;
        metrics.humidity.min = humStats.min;
        metrics.humidity.max = humStats.max;

        metrics.luminance.avg =
            metrics.luminance.values.length > 0
                ? metrics.luminance.values.reduce(
                      (a: number, b: {value: number}) => a + b.value,
                      0
                  ) / metrics.luminance.values.length
                : 0;

        return {groupId, devices: devicesInfo, metrics};
    }

    @Component.Expose('GetConsumptionHistory')
    @Component.NoPermissions
    async getConsumptionHistory(params: {
        groupId: number;
        from: string;
        to: string;
        granularity?: 'hour' | 'day' | 'month';
    }) {
        const {groupId, from, to, granularity = 'day'} = params || ({} as any);

        if (typeof groupId !== 'number' || groupId <= 0) {
            throw RpcError.InvalidParams('groupId must be a positive number');
        }
        if (!from || !to) {
            throw RpcError.InvalidParams('from and to dates are required');
        }

        // Get group with its devices array (shelly IDs)
        const groupRes = await PostgresProvider.callMethod(
            'device.fn_groups_get',
            {p_id: groupId}
        );
        const group = groupRes?.rows?.[0];
        const shellyIds: string[] = group?.devices || [];

        if (shellyIds.length === 0) {
            return {groupId, data: [], total: 0};
        }

        // Batch-convert shelly IDs to internal device IDs
        const {internalIds, idMap: deviceIdMap} =
            await resolveDeviceIds(shellyIds);
        const deviceMap = new Map<number, string>();
        for (const [id, shellyId] of Object.entries(deviceIdMap)) {
            deviceMap.set(Number(id), shellyId);
        }

        if (internalIds.length === 0) {
            return {groupId, data: [], total: 0, devices: {}};
        }

        // Limit date range to prevent excessive data (max 1 year)
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const maxRangeMs = 365 * 24 * 60 * 60 * 1000; // 1 year
        if (toDate.getTime() - fromDate.getTime() > maxRangeMs) {
            fromDate.setTime(toDate.getTime() - maxRangeMs);
        }

        // Query consumption from device_em.stats for all device types
        const emResult = await PostgresProvider.callMethod(
            'device_em.fn_report_diff',
            {
                p_devices: internalIds,
                p_from: fromDate,
                p_to: toDate,
                p_period: granularity === 'hour' ? 'day' : granularity
            }
        ).catch(() => ({rows: []}));

        const data = (emResult?.rows || []).map((r: any) => ({
            bucket: r.record_date,
            deviceId: r.device,
            value: r.total_energy_kw || 0,
            shellyId: deviceMap.get(r.device) || null
        }));
        const total = data.reduce(
            (sum: number, r: any) => sum + (r.value || 0),
            0
        );

        // Convert device map to object for JSON serialization
        const devices: Record<number, string> = {};
        deviceMap.forEach((shellyId, id) => {
            devices[id] = shellyId;
        });

        return {groupId, data, total, from, to, granularity, devices};
    }

    @Component.Expose('GetMetricHistory')
    @Component.NoPermissions
    async getMetricHistory(params: {
        groupId: number;
        from: string;
        to: string;
        metric:
            | 'consumption'
            | 'returned_energy'
            | 'voltage'
            | 'current'
            | 'power';
        granularity?: 'hour' | 'day' | 'month';
    }) {
        const {
            groupId,
            from,
            to,
            metric,
            granularity = 'day'
        } = params || ({} as any);

        if (typeof groupId !== 'number' || groupId <= 0) {
            throw RpcError.InvalidParams('groupId must be a positive number');
        }
        if (!from || !to) {
            throw RpcError.InvalidParams('from and to dates are required');
        }
        const reportDef = REPORT_TYPES[metric];
        if (!reportDef) {
            throw RpcError.InvalidParams(
                `Invalid metric "${metric}". Valid: ${Object.keys(REPORT_TYPES).join(', ')}`
            );
        }
        const bucket = GRANULARITY_MAP[granularity];
        if (!bucket) {
            throw RpcError.InvalidParams('Invalid granularity');
        }

        const groupRes = await PostgresProvider.callMethod(
            'device.fn_groups_get',
            {p_id: groupId}
        );
        const group = groupRes?.rows?.[0];
        const shellyIds: string[] = group?.devices || [];
        if (shellyIds.length === 0) {
            return {groupId, data: [], total: 0};
        }

        const {internalIds, idMap} = await resolveDeviceIds(shellyIds);
        const deviceMap = new Map(
            Object.entries(idMap).map(([k, v]) => [+k, v])
        );
        if (internalIds.length === 0) {
            return {groupId, data: [], total: 0};
        }

        const fromDate = new Date(from);
        const toDate = new Date(to);
        const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
        if (toDate.getTime() - fromDate.getTime() > maxRangeMs) {
            fromDate.setTime(toDate.getTime() - maxRangeMs);
        }

        const rep = await PostgresProvider.callMethod(
            'device_em.fn_report_stats',
            {
                p_devices: internalIds,
                p_from: fromDate,
                p_to: toDate,
                p_tags: reportDef.tags,
                p_bucket: bucket,
                p_per_device: true
            }
        ).catch(() => ({rows: []}));

        // For voltage/current: merge tags (voltage, min_voltage, max_voltage) into single rows
        const isMultiTag = metric === 'voltage' || metric === 'current';
        const baseTag = metric === 'voltage' ? 'voltage' : 'current';

        let data: any[];
        if (isMultiTag) {
            // Group rows by bucket+device, merge tag values
            const grouped = new Map<string, any>();
            for (const r of rep?.rows || []) {
                const key = `${r.bucket}_${r.device}`;
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        bucket: r.bucket,
                        deviceId: r.device,
                        value: 0,
                        min: null as number | null,
                        max: null as number | null,
                        shellyId: deviceMap.get(r.device) || null
                    });
                }
                const entry = grouped.get(key)!;
                const val = +(r.agg_value / reportDef.divisor).toFixed(
                    reportDef.precision
                );
                if (r.tag === baseTag) {
                    entry.value = val;
                } else if (r.tag === `min_${baseTag}`) {
                    entry.min = val;
                } else if (r.tag === `max_${baseTag}`) {
                    entry.max = val;
                }
            }
            // For devices that only have min/max (EM devices), use avg of min+max as value
            data = Array.from(grouped.values()).map((e) => {
                if (e.value === 0 && e.min !== null && e.max !== null) {
                    e.value = +((e.min + e.max) / 2).toFixed(
                        reportDef.precision
                    );
                }
                return e;
            });
        } else {
            data = (rep?.rows || []).map((r: any) => ({
                bucket: r.bucket,
                deviceId: r.device,
                value: +(r.agg_value / reportDef.divisor).toFixed(
                    reportDef.precision
                ),
                shellyId: deviceMap.get(r.device) || null
            }));
        }

        const total = data.reduce(
            (sum: number, r: any) => sum + (r.value || 0),
            0
        );

        return {groupId, metric, data, total, from, to, granularity};
    }

    @Component.Expose('GetEnvironmentalHistory')
    @Component.NoPermissions
    async getEnvironmentalHistory(params: {
        groupId: number;
        from: string;
        to: string;
        metric: 'temperature' | 'humidity' | 'luminance';
    }) {
        const {groupId, from, to, metric} = params || ({} as any);

        if (typeof groupId !== 'number' || groupId <= 0) {
            throw RpcError.InvalidParams('groupId must be a positive number');
        }
        if (!from || !to) {
            throw RpcError.InvalidParams('from and to dates are required');
        }
        if (!['temperature', 'humidity', 'luminance'].includes(metric)) {
            throw RpcError.InvalidParams(
                'metric must be temperature, humidity, or luminance'
            );
        }

        // Get group with its devices array (shelly IDs)
        const groupRes = await PostgresProvider.callMethod(
            'device.fn_groups_get',
            {p_id: groupId}
        );
        const group = groupRes?.rows?.[0];
        const shellyIds: string[] = group?.devices || [];

        if (shellyIds.length === 0) {
            return {groupId, data: [], metric};
        }

        // Batch-convert shelly IDs to internal device IDs
        const {internalIds} = await resolveDeviceIds(shellyIds);

        if (internalIds.length === 0) {
            return {groupId, data: [], metric};
        }

        // Limit date range to prevent excessive data (max 30 days for environmental data)
        const fromDate = new Date(from);
        const toDate = new Date(to);
        const maxRangeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        if (toDate.getTime() - fromDate.getTime() > maxRangeMs) {
            fromDate.setTime(toDate.getTime() - maxRangeMs);
        }

        // Query environmental data from device.status
        // Field mapping for different metrics
        const fieldMap: Record<string, string> = {
            temperature: 'temperature:%',
            humidity: 'humidity:%',
            luminance: 'illuminance:%'
        };

        const fieldPattern = fieldMap[metric];

        try {
            const statsRes = await PostgresProvider.callMethod(
                'device.fn_status_environmental_history',
                {
                    p_device_ids: internalIds,
                    p_field_pattern: fieldPattern,
                    p_from: fromDate.toISOString(),
                    p_to: toDate.toISOString()
                }
            );

            // Limit results to prevent memory issues (max 10000 rows)
            const rows = statsRes?.rows || [];
            const limitedData = rows.slice(0, 10000);

            return {
                groupId,
                data: limitedData,
                metric,
                from,
                to,
                truncated: rows.length > 10000
            };
        } catch (err: any) {
            this.logger.error('GetEnvironmentalHistory failed:', err);
            return {groupId, data: [], metric, from, to, error: err.message};
        }
    }

    @Component.Expose('GetDeviceHistory')
    @Component.NoPermissions
    async getDeviceHistory(params: {
        shellyId: string;
        from: string;
        to: string;
        metric:
            | 'consumption'
            | 'returned_energy'
            | 'voltage'
            | 'current'
            | 'power';
        granularity?: 'hour' | 'day' | 'month';
    }) {
        const {
            shellyId,
            from,
            to,
            metric,
            granularity = 'hour'
        } = params || ({} as any);

        if (!shellyId || typeof shellyId !== 'string') {
            throw RpcError.InvalidParams('shellyId is required');
        }
        if (!from || !to) {
            throw RpcError.InvalidParams('from and to dates are required');
        }
        const reportDef = REPORT_TYPES[metric];
        if (!reportDef) {
            throw RpcError.InvalidParams(
                `Invalid metric "${metric}". Valid: ${Object.keys(REPORT_TYPES).join(', ')}`
            );
        }
        const bucket = GRANULARITY_MAP[granularity];
        if (!bucket) {
            throw RpcError.InvalidParams('Invalid granularity');
        }

        const {internalIds} = await resolveDeviceIds([shellyId]);
        if (internalIds.length === 0) {
            return {shellyId, metric, data: [], from, to, granularity};
        }

        const fromDate = new Date(from);
        const toDate = new Date(to);
        const maxRangeMs = 90 * 24 * 60 * 60 * 1000; // 90 days
        if (toDate.getTime() - fromDate.getTime() > maxRangeMs) {
            fromDate.setTime(toDate.getTime() - maxRangeMs);
        }

        const rep = await PostgresProvider.callMethod(
            'device_em.fn_report_stats',
            {
                p_devices: internalIds,
                p_from: fromDate,
                p_to: toDate,
                p_tags: reportDef.tags,
                p_bucket: bucket,
                p_per_device: false
            }
        ).catch(() => ({rows: []}));

        const isMultiTag = metric === 'voltage' || metric === 'current';
        const baseTag = metric === 'voltage' ? 'voltage' : 'current';

        let data: any[];
        if (isMultiTag) {
            const grouped = new Map<string, any>();
            for (const r of rep?.rows || []) {
                const key = String(r.bucket);
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        bucket: r.bucket,
                        value: 0,
                        min: null as number | null,
                        max: null as number | null
                    });
                }
                const entry = grouped.get(key)!;
                const val = +(r.agg_value / reportDef.divisor).toFixed(
                    reportDef.precision
                );
                if (r.tag === baseTag) {
                    entry.value = val;
                } else if (r.tag === `min_${baseTag}`) {
                    entry.min = val;
                } else if (r.tag === `max_${baseTag}`) {
                    entry.max = val;
                }
            }
            data = Array.from(grouped.values()).map((e) => {
                if (e.value === 0 && e.min !== null && e.max !== null) {
                    e.value = +((e.min + e.max) / 2).toFixed(
                        reportDef.precision
                    );
                }
                return e;
            });
        } else {
            data = (rep?.rows || []).map((r: any) => ({
                bucket: r.bucket,
                value: +(r.agg_value / reportDef.divisor).toFixed(
                    reportDef.precision
                )
            }));
        }

        return {shellyId, metric, data, from, to, granularity};
    }

    @Component.Expose('GetGroupCapabilities')
    @Component.NoPermissions
    async getGroupCapabilities(params: {groupId: number}) {
        const {groupId} = params || ({} as any);

        if (typeof groupId !== 'number' || groupId <= 0) {
            throw RpcError.InvalidParams('groupId must be a positive number');
        }

        // Get group with its devices array (shelly IDs)
        const groupRes = await PostgresProvider.callMethod(
            'device.fn_groups_get',
            {p_id: groupId}
        );
        const group = groupRes?.rows?.[0];
        const shellyIds: string[] = group?.devices || [];

        const capabilities = new Set<string>();

        for (const shellyId of shellyIds) {
            try {
                const device = DeviceCollector.getDevice(shellyId);
                if (device) {
                    // All devices have uptime
                    capabilities.add('uptime');

                    const entities = device.entities || [];
                    for (const entity of entities) {
                        // Detect capability from entity type
                        const entityType = entity.type;
                        if (entityType === 'em' || entityType === 'em1') {
                            capabilities.add('voltage');
                            capabilities.add('current');
                            capabilities.add('power');
                            capabilities.add('consumption');
                            capabilities.add('returned_energy');
                        }
                        if (entityType === 'switch' || entityType === 'pm1') {
                            capabilities.add('voltage');
                            capabilities.add('current');
                            capabilities.add('power');
                            capabilities.add('consumption');
                        }
                        if (entityType === 'temperature') {
                            capabilities.add('temperature');
                        }
                        if (entityType === 'humidity') {
                            capabilities.add('humidity');
                        }
                        if (
                            entityType === 'illuminance' ||
                            entityType === 'lux'
                        ) {
                            capabilities.add('luminance');
                        }
                    }
                }
            } catch {
                // Skip devices that can't be queried
            }
        }

        return {
            groupId,
            capabilities: Array.from(capabilities),
            deviceCount: shellyIds.length
        };
    }

    @Component.Expose('GetDashboardSettings')
    @Component.NoPermissions
    async getDashboardSettings(params: {dashboardId: number}) {
        const {dashboardId} = params || ({} as any);

        if (typeof dashboardId !== 'number' || dashboardId <= 0) {
            throw RpcError.InvalidParams(
                'dashboardId must be a positive number'
            );
        }

        const res = await PostgresProvider.callMethod(
            'ui.fn_dashboard_settings_fetch',
            {p_dashboard_id: dashboardId}
        );

        const settings = res?.rows?.[0];
        if (!settings) {
            // Return defaults if no settings exist
            return {
                dashboardId,
                tariff: 0,
                currency: 'EUR',
                defaultRange: 'last_7_days',
                refreshInterval: 60000,
                enabledMetrics: [
                    'voltage',
                    'current',
                    'power',
                    'consumption',
                    'temperature',
                    'humidity',
                    'luminance'
                ],
                chartSettings: {}
            };
        }

        return {
            dashboardId,
            tariff: settings.tariff,
            currency: settings.currency,
            defaultRange: settings.default_range,
            refreshInterval: settings.refresh_interval,
            enabledMetrics: settings.enabled_metrics,
            chartSettings: settings.chart_settings
        };
    }

    @Component.Expose('SetDashboardSettings')
    @Component.NoPermissions
    async setDashboardSettings(params: {
        dashboardId: number;
        tariff?: number;
        currency?: string;
        defaultRange?: string;
        refreshInterval?: number;
        enabledMetrics?: string[];
        chartSettings?: Record<string, any>;
    }) {
        const {
            dashboardId,
            tariff,
            currency,
            defaultRange,
            refreshInterval,
            enabledMetrics,
            chartSettings
        } = params || ({} as any);

        if (typeof dashboardId !== 'number' || dashboardId <= 0) {
            throw RpcError.InvalidParams(
                'dashboardId must be a positive number'
            );
        }

        await PostgresProvider.callMethod('ui.fn_dashboard_settings_update', {
            p_dashboard_id: dashboardId,
            p_tariff: tariff ?? null,
            p_currency: currency ?? null,
            p_default_range: defaultRange ?? null,
            p_refresh_interval: refreshInterval ?? null,
            p_enabled_metrics: enabledMetrics
                ? JSON.stringify(enabledMetrics)
                : null,
            p_chart_settings: chartSettings
                ? JSON.stringify(chartSettings)
                : null
        });

        return {success: true, dashboardId};
    }

    @Component.Expose('CreateAnalyticsDashboard')
    @Component.NoPermissions
    async createAnalyticsDashboard(params: {name: string; groupId: number}) {
        const {name, groupId} = params || ({} as any);

        if (!name || typeof name !== 'string') {
            throw RpcError.InvalidParams('name is required');
        }
        if (typeof groupId !== 'number' || groupId <= 0) {
            throw RpcError.InvalidParams('groupId must be a positive number');
        }

        // Verify group exists
        const groupRes = await PostgresProvider.callMethod(
            'device_group.fn_list_fetch_by_id',
            {p_id: groupId}
        );
        if (!groupRes?.rows?.[0]) {
            throw RpcError.InvalidParams('Group not found');
        }

        // Create the dashboard with analytics type
        const dashRes = await PostgresProvider.callMethod(
            'ui.fn_dashboard_add',
            {
                p_name: name,
                p_group_id: groupId,
                p_dashboard_type: 'analytics'
            }
        );

        const dashboardId =
            dashRes?.rows?.[0]?.fn_dashboard_add ?? dashRes?.rows?.[0];

        return {
            id: dashboardId,
            name,
            groupId,
            dashboardType: 'analytics'
        };
    }

    // ==================== END ANALYTICS DASHBOARD METHODS ====================

    override async getStatus() {
        const status: Record<string, any> = {};
        for (const [name, comp] of Commander.getComponents().entries()) {
            if (comp === this) continue;
            try {
                const st = await Commander.getStatus(name);
                if (Object.keys(st).length) status[name] = st;
            } catch (err) {
                status[name] = {error: String(err)};
            }
        }
        return status;
    }

    override async getConfig() {
        const cfg: Record<string, any> = {};
        for (const name of Commander.getComponents().keys()) {
            if (name === this.name) continue;
            try {
                const c = await Commander.getConfig(name);
                if (Object.keys(c).length) cfg[name] = c;
            } catch (err) {
                cfg[name] = {error: String(err)};
            }
        }
        return cfg;
    }

    protected override getDefaultConfig() {
        return {};
    }
}
