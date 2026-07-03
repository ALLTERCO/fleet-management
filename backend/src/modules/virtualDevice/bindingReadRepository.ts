import type {VirtualDeviceBindingDto} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';

export interface ActiveVirtualDeviceBinding {
    virtualDeviceListId: number;
    roleKey: string;
    sourceDeviceListId: number;
    sourceExternalId: string;
    sourceComponentKey: string;
    mode: VirtualDeviceBindingDto['mode'];
    valueType: string | null;
    writable: boolean | null;
    required: boolean | null;
    unit: string | null;
    sourceSnapshot: Record<string, unknown> | null;
    roleMetadata: Record<string, unknown> | null;
}

export interface ActiveBindingReadDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

interface ActiveBindingRow {
    virtual_device_list_id: number;
    role_key: string;
    source_device_list_id: number;
    source_external_id: string;
    source_component_key: string;
    mode: VirtualDeviceBindingDto['mode'];
    value_type: string | null;
    writable: boolean | null;
    required: boolean | null;
    unit: string | null;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
}

const defaultDeps: ActiveBindingReadDeps = {
    queryRows: postgres.queryRows
};

export async function loadActiveVirtualDeviceBindings(
    input: {
        organizationId: string;
        deviceListIds: readonly number[];
    },
    deps: ActiveBindingReadDeps = defaultDeps
): Promise<Map<number, ActiveVirtualDeviceBinding[]>> {
    if (input.deviceListIds.length === 0) return new Map();
    const rows = await deps.queryRows<ActiveBindingRow>(
        `SELECT
            b.virtual_device_list_id,
            b.role_key,
            b.source_device_list_id,
            src.external_id AS source_external_id,
            b.source_component_key,
            b.mode,
            b.value_type,
            b.writable,
            b.required,
            b.unit,
            b.source_snapshot_json,
            b.role_metadata_json
           FROM device.virtual_device_binding b
           JOIN device.list src
             ON src.id = b.source_device_list_id
            AND src.organization_id = b.organization_id
          WHERE b.organization_id = $1
            AND b.virtual_device_list_id = ANY($2::integer[])
            AND b.effective_to IS NULL
            AND b.effective_from <= NOW()
          ORDER BY b.virtual_device_list_id, b.role_key`,
        [input.organizationId, input.deviceListIds]
    );
    return groupActiveBindings(rows.map(rowToBinding));
}

function groupActiveBindings(
    bindings: readonly ActiveVirtualDeviceBinding[]
): Map<number, ActiveVirtualDeviceBinding[]> {
    const out = new Map<number, ActiveVirtualDeviceBinding[]>();
    for (const binding of bindings) {
        const bucket = out.get(binding.virtualDeviceListId) ?? [];
        bucket.push(binding);
        out.set(binding.virtualDeviceListId, bucket);
    }
    return out;
}

function rowToBinding(row: ActiveBindingRow): ActiveVirtualDeviceBinding {
    return {
        virtualDeviceListId: row.virtual_device_list_id,
        roleKey: row.role_key,
        sourceDeviceListId: row.source_device_list_id,
        sourceExternalId: row.source_external_id,
        sourceComponentKey: row.source_component_key,
        mode: row.mode,
        valueType: row.value_type,
        writable: row.writable,
        required: row.required,
        unit: row.unit,
        sourceSnapshot: row.source_snapshot_json,
        roleMetadata: row.role_metadata_json
    };
}
