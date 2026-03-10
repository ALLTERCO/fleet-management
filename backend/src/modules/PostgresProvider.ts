import exposeMethods from 'expose-sql-methods/lib/postgres';
import * as log4js from 'log4js';
import migration from 'migration-collection/lib/postgres';
import {configRc} from '../config';
import ShellyDeviceFactory from '../model/ShellyDeviceFactory';
import * as DeviceCollector from '../modules/DeviceCollector';
import * as Observability from '../modules/Observability';

const logger = log4js.getLogger('postgres');

export type get_resp_t = {
    external_id: string;
    created: Date;
    updated: Date;
    jdoc: any;
    control_access: number;
    id: number;
};
const MAX_SLEEP_COUNT = 30;
const SLEEP_MS = 1000;
let sleeps = 0;

export const ACCESS_CONTROL = {
    PENDING: 1,
    DENIED: 2,
    ALLOWED: 3
};

// make sure we hoist that and make it accessible everywhere
let callDbMethod: <T = any>(
    name: string,
    params: any,
    txId?: number
) => Promise<T>;

async function sleepUntil(time: number, assert: () => boolean) {
    return new Promise((resolve, reject) => {
        if (++sleeps > MAX_SLEEP_COUNT) {
            reject('TIMEOUT');
            return;
        }

        if (assert()) {
            resolve(1);
            return;
        }
        setTimeout(() => resolve(sleepUntil(time, assert)), time);
    });
}

export async function rawCall(name: string, params: any) {
    if (!callDbMethod) throw new Error('Database not ready');
    return callDbMethod(name, params);
}

export async function get(
    shellyID: string | null = null,
    controlAccess: number | null = null
): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod('device.fn_fetch', {
        p_external_id: shellyID,
        p_control_access: controlAccess || null
    });

    return result.rows;
}

export async function getBatch(shellyIDs: string[]): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (shellyIDs.length === 0) return [];
    const result = await callDbMethod('device.fn_fetch_batch', {
        p_external_ids: shellyIDs
    });
    return result.rows;
}

export async function getPendingDevices() {
    return get(null, ACCESS_CONTROL.PENDING);
}

export async function getDeniedDevices() {
    return get(null, ACCESS_CONTROL.DENIED);
}

export async function accessControl(
    shellyID?: string,
    id?: number,
    controlAccess?: number
): Promise<get_resp_t | undefined> {
    if (!callDbMethod) throw new Error('Database not ready');
    const rows = (
        await callDbMethod('device.fn_fetch', {
            p_external_id: shellyID,
            p_id: id,
            p_control_access: controlAccess
        })
    ).rows;
    if (!rows[0]) return undefined;
    return rows[0] as get_resp_t;
}

export async function allowAccessControl(id: number) {
    return await callDbMethod<void>('device.fn_control_access_allow', {
        p_id: id
    });
}

export async function allowAccessControlBatch(ids: number[]) {
    if (!callDbMethod) throw new Error('Database not ready');
    if (ids.length === 0) return;
    return await callDbMethod<void>('device.fn_control_access_allow_batch', {
        p_ids: ids
    });
}

export async function getBatchByIds(ids: number[]): Promise<get_resp_t[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (ids.length === 0) return [];
    const result = await callDbMethod('device.fn_fetch_batch_by_ids', {
        p_ids: ids
    });
    return result.rows;
}

export async function denyAccessControl(id: number) {
    return await callDbMethod<void>('device.fn_control_access_deny', {
        p_id: id
    });
}

export async function userCheck(name: string, password: string) {
    return await callDbMethod<void>('user.fn_get', {
        p_name: name,
        p_password: password
    });
}

export async function userList({
    id,
    name,
    password
}: {
    id?: number;
    name?: string;
    password?: string;
}) {
    return await callDbMethod<{rows: any[]}>('user.fn_get', {
        p_id: id,
        p_name: name,
        p_password: password
    });
}

export async function userDelete({id}: {id: number}) {
    return await callDbMethod<void>('user.fn_delete', {p_id: id});
}

export async function deviceDelete(shellyID: string) {
    const device = (await get(shellyID))[0];
    if (!device) throw new Error(`Device ${shellyID} not found`);
    return await callDbMethod<void>('device.fn_full_delete', {
        p_id: device.id
    });
}

export async function userCreate({
    name,
    enabled,
    password,
    fullName,
    group,
    email,
    permissions
}: {
    name: string;
    enabled: boolean;
    password: string;
    fullName: string;
    group: string;
    email: string;
    permissions: string[];
}) {
    return await callDbMethod<void>('user.fn_add', {
        p_name: name,
        p_email: email,
        p_enabled: enabled,
        p_password: password,
        p_full_name: fullName,
        p_group: group,
        p_permissions: permissions
    });
}

export async function userUpdate({
    id,
    enabled,
    password,
    fullName,
    group,
    permissions,
    email
}: {
    id: number;
    enabled?: boolean;
    password?: string;
    fullName?: string;
    group?: string;
    permissions?: string[];
    email?: string;
}) {
    return await callDbMethod<void>('user.fn_update', {
        p_id: id,
        p_enabled: enabled,
        p_password: password,
        p_full_name: fullName,
        p_group: group,
        p_permissions: permissions,
        p_email: email
    });
}

export async function store(shellyID: string, data: any) {
    if (!callDbMethod) throw new Error('Database not ready');
    return await callDbMethod('device.fn_add', {
        p_external_id: shellyID,
        p_jdoc: data
    });
}
export async function callMethod(method: string, params: any, txId?: number) {
    if (!callDbMethod) throw new Error('Database not ready');
    return await callDbMethod(method, params, txId);
}

export async function initDatabase() {
    logger.debug('init started');
    let allReady = 0;
    const config = Object.assign({}, configRc.internalStorage);

    if (!config || Object.keys(config).length === 0) {
        logger.warn('init config error, no postgres config found');
        // return empty array
        return;
    }

    if (config?.cwd) {
        allReady = allReady - 1;
        config.cwd = config.cwd.map((e: string) => `${process.cwd()}/${e}`);
        // run in background
        try {
            await migration(config);
            allReady = allReady + 1;
        } catch (err: any) {
            logger.error('Migration failed %s', err.message);
            throw err;
        }
    }

    await sleepUntil(SLEEP_MS, () => allReady === 0);

    const expConfig = {
        ...config,
        schemas: config.link.schemas
    };

    const expDB = await exposeMethods<Record<string, any>>(expConfig, {
        log: (level: 'error' | 'info' | 'warn', ...rest: [any]) => {
            logger[level](...rest);
        }
    });

    // pass state to global variable
    callDbMethod = async (name: string, params: any, txId?: number) => {
        const m = expDB.methods[name];
        if (!m) {
            if (name === 'tx') {
                return {
                    async begin() {
                        return await expDB.txBegin();
                    },
                    async end(id: number, query: string) {
                        return await expDB.txEnd(id, query);
                    }
                };
            }
            throw new Error('MethodNotFound');
        }
        const timed = Observability.getLevel() >= 2;
        const t0 = timed ? performance.now() : 0;
        const result = await m(params, txId);
        if (timed) Observability.recordDbTiming(name, performance.now() - t0);
        return result;
    };
    allReady = allReady + 1;

    // Register DB pool stats (if pool is accessible)
    try {
        const db = expDB as any;
        const pool = db.pool ?? db.client?.pool;
        if (pool && typeof pool.totalCount === 'number') {
            Observability.registerModule('dbPool', () => ({
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount
            }));
        }
    } catch {
        /* pool stats not available — skip */
    }

    logger.debug('init finished');
}

// ==================== GROUP FUNCTIONS ====================

export interface DbGroup {
    id: number;
    name: string;
    metadata: Record<string, any>;
    parent_id: number | null;
    devices: string[];
    created: Date;
    updated: Date | null;
}

export async function groupList(parentId?: number | null): Promise<DbGroup[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: DbGroup[]}>(
        'device.fn_groups_list',
        {
            p_parent_id: parentId ?? null
        }
    );
    return result.rows;
}

export async function groupGet(id: number): Promise<DbGroup | null> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: DbGroup[]}>(
        'device.fn_groups_get',
        {
            p_id: id
        }
    );
    return result.rows[0] || null;
}

export async function groupCreate(
    name: string,
    metadata: Record<string, any> = {},
    parentId: number | null = null,
    devices: string[] = []
): Promise<DbGroup | null> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: DbGroup[]}>(
        'device.fn_groups_create',
        {
            p_name: name,
            p_devices: devices,
            p_metadata: metadata,
            p_parent_id: parentId
        }
    );
    return result.rows[0] || null;
}

export async function groupUpdate(
    id: number,
    name?: string,
    metadata?: Record<string, any>,
    parentId?: number | null,
    devices?: string[],
    clearParent = false
): Promise<DbGroup | null> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: DbGroup[]}>(
        'device.fn_groups_update',
        {
            p_id: id,
            p_name: name ?? null,
            p_devices: devices ?? null,
            p_metadata: metadata ?? null,
            p_parent_id: parentId ?? null,
            p_clear_parent: clearParent
        }
    );
    return result.rows[0] || null;
}

export async function groupDelete(id: number): Promise<boolean> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<any>('device.fn_groups_delete', {
        p_id: id
    });
    return result.rows?.[0]?.fn_groups_delete ?? false;
}

export async function groupAddDevice(
    groupId: number,
    shellyId: string
): Promise<boolean> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<any>('device.fn_groups_add_device', {
        p_group_id: groupId,
        p_shelly_id: shellyId
    });
    return result.rows?.[0]?.fn_groups_add_device ?? false;
}

export async function groupAddDevicesBatch(
    groupId: number,
    shellyIds: string[]
): Promise<number> {
    if (!callDbMethod) throw new Error('Database not ready');
    if (shellyIds.length === 0) return 0;
    const result = await callDbMethod<any>(
        'device.fn_groups_add_devices_batch',
        {p_group_id: groupId, p_shelly_ids: shellyIds}
    );
    return result.rows?.[0]?.fn_groups_add_devices_batch ?? 0;
}

export async function groupRemoveDevice(
    groupId: number,
    shellyId: string
): Promise<boolean> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<any>('device.fn_groups_remove_device', {
        p_group_id: groupId,
        p_shelly_id: shellyId
    });
    return result.rows?.[0]?.fn_groups_remove_device ?? false;
}

export async function groupFindByDevice(shellyId: string): Promise<number[]> {
    if (!callDbMethod) throw new Error('Database not ready');
    const result = await callDbMethod<{rows: {group_id: number}[]}>(
        'device.fn_groups_find_by_device',
        {
            p_shelly_id: shellyId
        }
    );
    return result.rows.map((r) => r.group_id);
}

// ==================== GROUP JSON MIGRATION ====================

import * as fs from 'node:fs';
import * as path from 'node:path';

interface LegacyGroup {
    id: number;
    name: string;
    devices?: string[];
    metadata?: Record<string, any>;
    parentId?: number | null;
}

interface LegacyGroupConfig {
    groups: Record<string, LegacyGroup>;
    enable?: boolean;
}

/**
 * Migrates groups from the legacy JSON file to the database.
 * After successful migration, the JSON file is deleted.
 * This function is idempotent - groups that already exist in DB are skipped.
 */
export async function migrateGroupsFromJson(): Promise<void> {
    const jsonPath = path.join(
        process.cwd(),
        'cfg',
        'components',
        'group.json'
    );

    // Check if file exists
    if (!fs.existsSync(jsonPath)) {
        logger.info('No legacy group.json found, skipping migration');
        return;
    }

    let config: LegacyGroupConfig;
    try {
        const content = fs.readFileSync(jsonPath, 'utf-8');
        config = JSON.parse(content);
    } catch (error: any) {
        logger.error('Failed to read group.json: %s', error.message);
        return;
    }

    if (!config.groups || Object.keys(config.groups).length === 0) {
        logger.info('No groups in group.json to migrate');
        // Delete empty file
        try {
            fs.unlinkSync(jsonPath);
            logger.info('Deleted empty group.json');
        } catch (e: any) {
            logger.warn('Failed to delete empty group.json: %s', e.message);
        }
        return;
    }

    const groups = Object.values(config.groups);
    logger.info(
        'Starting migration of %d groups from group.json',
        groups.length
    );

    // Sort groups to ensure parents are created before children
    // Groups without parentId come first, then sort by parentId
    const sortedGroups = [...groups].sort((a, b) => {
        if (!a.parentId && !b.parentId) return a.id - b.id;
        if (!a.parentId) return -1;
        if (!b.parentId) return 1;
        return a.parentId - b.parentId;
    });

    // Map old IDs to new IDs for parent references
    const idMapping = new Map<number, number>();
    let migratedCount = 0;
    let skippedCount = 0;

    for (const group of sortedGroups) {
        try {
            // Check if group with same name already exists
            const existingGroups = await groupList();
            const existing = existingGroups.find((g) => g.name === group.name);

            if (existing) {
                logger.debug(
                    'Group "%s" already exists in DB, skipping',
                    group.name
                );
                idMapping.set(group.id, existing.id);
                skippedCount++;
                continue;
            }

            // Resolve parent ID if exists
            let resolvedParentId: number | null = null;
            if (group.parentId) {
                resolvedParentId = idMapping.get(group.parentId) ?? null;
                if (!resolvedParentId) {
                    logger.warn(
                        'Parent group %d not found for group "%s", setting parent to null',
                        group.parentId,
                        group.name
                    );
                }
            }

            // Create group in database
            const dbGroup = await groupCreate(
                group.name,
                group.metadata || {},
                resolvedParentId,
                group.devices || []
            );

            if (dbGroup) {
                idMapping.set(group.id, dbGroup.id);
                migratedCount++;
                logger.debug(
                    'Migrated group "%s" (old id: %d, new id: %d)',
                    group.name,
                    group.id,
                    dbGroup.id
                );
            } else {
                logger.error(
                    'Failed to create group "%s" in database',
                    group.name
                );
            }
        } catch (error: any) {
            logger.error(
                'Error migrating group "%s": %s',
                group.name,
                error.message
            );
        }
    }

    logger.info(
        'Group migration complete: %d migrated, %d skipped',
        migratedCount,
        skippedCount
    );

    // Delete the JSON file after successful migration
    try {
        fs.unlinkSync(jsonPath);
        logger.info('Deleted group.json after successful migration');
    } catch (error: any) {
        logger.error('Failed to delete group.json: %s', error.message);
    }
}

export async function loadSavedDevices() {
    const devices = await get();
    logger.info('found %s saved devices', devices.length);
    let registered = 0;
    for (const external of devices) {
        // parse saved state to actual device object
        try {
            const device = ShellyDeviceFactory.fromDatabase(external);
            if (device) {
                DeviceCollector.register(device);
                registered++;
            } else {
                logger.warn(
                    'Cannot create device from db entry',
                    external.jdoc
                );
            }
        } catch (error) {
            logger.warn(
                'failed to load saved device state=[%s] err=[%s]',
                JSON.stringify(external.jdoc),
                String(error)
            );
        }
    }

    if (registered < devices.length) {
        logger.warn(
            'failed to load %s saved devices',
            devices.length - registered
        );
    }
}
