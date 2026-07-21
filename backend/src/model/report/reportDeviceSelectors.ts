import * as PostgresProvider from '../../modules/PostgresProvider';
import RpcError from '../../rpc/RpcError';

const DEVICE_SELECTOR_KEYS = new Set([
    'devices',
    'main_meter_ids',
    'peak_device_ids'
]);

export interface ReportDeviceSelectorDeps {
    resolveLogicalIds(
        externalIds: string[]
    ): Promise<ReadonlyMap<string, number>>;
    resolveCurrentExternalIds(
        logicalIds: number[]
    ): Promise<ReadonlyMap<number, string>>;
}

const PRODUCTION_DEPS: ReportDeviceSelectorDeps = {
    async resolveLogicalIds(externalIds) {
        const {idMap} = await PostgresProvider.resolveDeviceIds(externalIds);
        const logicalIds = new Map<string, number>();
        for (const [logicalId, externalId] of Object.entries(idMap)) {
            logicalIds.set(externalId, Number(logicalId));
        }
        return logicalIds;
    },
    async resolveCurrentExternalIds(logicalIds) {
        const rows = await PostgresProvider.getBatchByIds(logicalIds);
        const externalIds = new Map<number, string>();
        for (const row of rows) {
            if (row.external_id) externalIds.set(row.id, row.external_id);
        }
        return externalIds;
    }
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectSelectorValues<T extends string | number>(
    value: unknown,
    expectedType: 'string' | 'number',
    values: Set<T>
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectSelectorValues(item, expectedType, values);
        }
        return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
        if (!DEVICE_SELECTOR_KEYS.has(key)) {
            collectSelectorValues(child, expectedType, values);
            continue;
        }
        if (!Array.isArray(child)) {
            throw RpcError.InvalidParams(`${key} must be an array`);
        }
        for (const selector of child) {
            if (typeof selector !== expectedType) {
                throw RpcError.InvalidParams(
                    `${key} must contain ${expectedType} device identifiers`
                );
            }
            values.add(selector as T);
        }
    }
}

function mapSelectorValues(
    value: unknown,
    mapSelector: (selector: string | number) => string | number
): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => mapSelectorValues(item, mapSelector));
    }
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
            key,
            DEVICE_SELECTOR_KEYS.has(key) && Array.isArray(child)
                ? child.map((selector) =>
                      mapSelector(selector as string | number)
                  )
                : mapSelectorValues(child, mapSelector)
        ])
    );
}

export async function snapshotLogicalReportSelectors(
    rawParams: unknown,
    deps: ReportDeviceSelectorDeps = PRODUCTION_DEPS
): Promise<unknown> {
    const externalIds = new Set<string>();
    collectSelectorValues(rawParams, 'string', externalIds);
    const logicalIds = await deps.resolveLogicalIds([...externalIds]);
    const missing = [...externalIds].filter((id) => !logicalIds.has(id));
    if (missing.length > 0) {
        throw RpcError.InvalidParams(
            `Unknown device selector(s): ${missing.join(', ')}`
        );
    }
    return mapSelectorValues(
        rawParams,
        (externalId) => logicalIds.get(String(externalId)) as number
    );
}

export async function projectCurrentReportSelectors(
    logicalParams: unknown,
    deps: ReportDeviceSelectorDeps = PRODUCTION_DEPS
): Promise<unknown> {
    const logicalIds = new Set<number>();
    collectSelectorValues(logicalParams, 'number', logicalIds);
    const externalIds = await deps.resolveCurrentExternalIds([...logicalIds]);
    const missing = [...logicalIds].filter((id) => !externalIds.has(id));
    if (missing.length > 0) {
        throw new Error(
            `Report selector references missing logical device id(s): ${missing.join(', ')}`
        );
    }
    return mapSelectorValues(
        logicalParams,
        (logicalId) => externalIds.get(Number(logicalId)) as string
    );
}
