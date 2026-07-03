export function firmwareListReferenceMeta(): Record<string, unknown> {
    return {source: 'firmware_list_rpc'};
}

export function firmwareListItemMeta(input: {
    method: string;
    enabled: boolean | null;
    running: boolean | null;
    item?: Record<string, unknown>;
}): Record<string, unknown> {
    return removeUndefinedValues({
        source: 'firmware_list_rpc',
        method: input.method,
        enabled: input.enabled,
        running: input.running,
        role: safeString(input.item?.role),
        type: safeString(input.item?.type),
        profileId: safeId(input.item?.profile_id ?? input.item?.profileId)
    });
}

export function firmwareSnapshotMeta(): Record<string, unknown> {
    return {source: 'live_component_snapshot'};
}

export function externalConnectionMeta(input: {
    enabled: boolean | null;
    source: string;
    item?: Record<string, unknown>;
}): Record<string, unknown> {
    return removeUndefinedValues({
        enabled: input.enabled,
        source: input.source,
        role: safeString(input.item?.role),
        type: safeString(input.item?.type)
    });
}

export function sourceMeta(source: string): Record<string, unknown> {
    return {source};
}

export function connectorPointMeta(input: {
    valueType?: string | null;
    writable?: boolean | null;
}): Record<string, unknown> {
    return removeUndefinedValues({
        source: 'connector_jdoc',
        valueType: input.valueType,
        writable: input.writable
    });
}

export function operationJobMeta(input: {
    jobStatus: string;
    unitStatus: string | null;
    unitPhase: string | null;
    sampleUnitId: string;
}): Record<string, unknown> {
    return removeUndefinedValues({
        jobStatus: input.jobStatus,
        unitStatus: input.unitStatus,
        unitPhase: input.unitPhase,
        sampleUnitId: input.sampleUnitId
    });
}

export function operationUnitMeta(input: {
    jobId: string;
    jobStatus: string;
    unitStatus: string | null;
}): Record<string, unknown> {
    return removeUndefinedValues({
        jobId: input.jobId,
        jobStatus: input.jobStatus,
        unitStatus: input.unitStatus
    });
}

export function credentialStateMeta(input: {
    username: string | null;
    realm: string | null;
    rotatedAt: string | null;
}): Record<string, unknown> {
    return removeUndefinedValues({
        username: input.username,
        realm: input.realm,
        rotatedAt: input.rotatedAt
    });
}

export function componentRefMeta(source: string): Record<string, unknown> {
    return {source};
}

export function bluAssistantConnectionMeta(input: {
    openedAt: number;
    discoveredAt?: number;
    mtu?: number;
}): Record<string, unknown> {
    return removeUndefinedValues({
        source: 'bluassist_connection_tracker',
        openedAt: safeDate(input.openedAt),
        discoveredAt: safeDate(input.discoveredAt),
        mtu: safeInteger(input.mtu)
    });
}

export function bluAssistantBondMeta(input: {
    haveBond: boolean | null;
}): Record<string, unknown> {
    return removeUndefinedValues({
        source: 'GATTC.HaveBond',
        haveBond: input.haveBond
    });
}

export function safeFirmwareItemLabel(
    item: Record<string, unknown>
): string | null {
    return safeString(item.name ?? item.title ?? item.label) ?? null;
}

export function nodeRedFlowMeta(): Record<string, unknown> {
    return {source: 'node_red_flow_file'};
}

export function nodeRedNodeMeta(input: {
    flowLabel: string;
}): Record<string, unknown> {
    return {
        source: 'node_red_flow_file',
        flowLabel: input.flowLabel
    };
}

function safeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeId(value: unknown): string | number | undefined {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Number.isInteger(value)) return Number(value);
    return undefined;
}

function safeInteger(value: unknown): number | undefined {
    return Number.isInteger(value) ? Number(value) : undefined;
}

function safeDate(value: unknown): string | undefined {
    if (!Number.isFinite(value)) return undefined;
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function removeUndefinedValues(
    input: Record<string, unknown>
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
    );
}
