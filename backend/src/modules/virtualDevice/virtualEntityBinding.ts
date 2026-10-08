import type {VirtualDeviceKind} from '../../types/api/virtualdevice';

/** One active binding row: a virtual device role bound to a source. */
export interface VirtualEntityBinding {
    device_list_id: number;
    external_id: string;
    organization_id: string;
    kind: VirtualDeviceKind;
    role_key: string;
    source_device_list_id: number;
    source_external_id: string;
    source_component_key: string;
    writable: boolean | null;
    required: boolean | null;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
    transform_json: Record<string, unknown> | null;
    unit: string | null;
    value_type: string | null;
}
