import type {
    VirtualDeviceBindingSourceCandidateDto,
    VirtualDeviceRoleValueType
} from '../../types/api/virtualdevice';

export interface ConnectorPoint {
    componentKey: string;
    protocol: string;
    pointId: string | null;
    label: string | null;
    valueType: VirtualDeviceRoleValueType | null;
    writable: boolean | null;
}

export function connectorComponentKeys(
    jdoc: Record<string, unknown>
): string[] {
    return connectorPoints(jdoc).map((point) => point.componentKey);
}

export function connectorCandidateMetadata(
    jdoc: Record<string, unknown>,
    componentKey: string
): Pick<
    VirtualDeviceBindingSourceCandidateDto,
    'label' | 'valueType' | 'writable' | 'connector'
> | null {
    const point = connectorPoints(jdoc).find(
        (item) => item.componentKey === componentKey
    );
    if (!point) return null;
    return {
        label: point.label,
        valueType: point.valueType ?? valueTypeFromComponentKey(componentKey),
        writable: point.writable ?? false,
        connector: {
            protocol: point.protocol,
            pointId: point.pointId
        }
    };
}

export function connectorPoints(
    jdoc: Record<string, unknown>
): ConnectorPoint[] {
    return rawPointRecords(jdoc)
        .map(connectorPointFromRecord)
        .filter((point): point is ConnectorPoint => point !== null);
}

function rawPointRecords(
    jdoc: Record<string, unknown>
): Record<string, unknown>[] {
    return [
        ...recordArray(recordAt(jdoc, 'connector'), 'points'),
        ...recordArray(
            recordAt(recordAt(jdoc, 'settings'), 'connector'),
            'points'
        ),
        ...recordArray(
            recordAt(recordAt(jdoc, 'status'), 'connector'),
            'points'
        )
    ];
}

function connectorPointFromRecord(
    record: Record<string, unknown>
): ConnectorPoint | null {
    const componentKey = firstString(record, [
        'componentKey',
        'component_key',
        'key'
    ]);
    if (!componentKey || !isComponentKey(componentKey)) return null;
    const protocol = firstString(record, [
        'protocol',
        'provider',
        'connectorType',
        'connector_type'
    ]);
    return {
        componentKey,
        protocol: protocol ?? 'connector',
        pointId: firstString(record, [
            'pointId',
            'point_id',
            'address',
            'topic',
            'objectId',
            'object_id'
        ]),
        label: firstString(record, ['label', 'name']),
        valueType: parseValueType(
            firstString(record, ['valueType', 'value_type'])
        ),
        writable: firstBoolean(record, ['writable', 'canWrite', 'can_write'])
    };
}

function valueTypeFromComponentKey(
    componentKey: string
): VirtualDeviceRoleValueType {
    const type = componentKey.split(':', 1)[0];
    if (['switch', 'boolean', 'input'].includes(type)) return 'boolean';
    if (['button'].includes(type)) return 'event';
    if (['text', 'enum'].includes(type)) return 'string';
    return 'number';
}

function parseValueType(
    value: string | null
): VirtualDeviceRoleValueType | null {
    if (
        value === 'boolean' ||
        value === 'number' ||
        value === 'string' ||
        value === 'event' ||
        value === 'json'
    ) {
        return value;
    }
    return null;
}

function firstString(
    record: Record<string, unknown>,
    keys: readonly string[]
): string | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value))
            return String(value);
    }
    return null;
}

function firstBoolean(
    record: Record<string, unknown>,
    keys: readonly string[]
): boolean | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'boolean') return value;
    }
    return null;
}

function recordArray(
    record: Record<string, unknown>,
    key: string
): Record<string, unknown>[] {
    const value = record[key];
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord);
}

function recordAt(
    record: Record<string, unknown>,
    key: string
): Record<string, unknown> {
    const value = record[key];
    return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComponentKey(value: string): boolean {
    return /^[a-z][a-z0-9_]*:\d+$/.test(value);
}
