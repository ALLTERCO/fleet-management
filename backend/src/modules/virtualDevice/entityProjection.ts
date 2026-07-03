import type {VirtualDeviceDto} from '../../types/api/virtualdevice';

export interface VirtualEntityBinding {
    roleKey: string;
    sourceExternalId: string;
    sourceComponentKey: string;
    writable: boolean | null;
    sourceSnapshot: Record<string, unknown> | null;
    roleMetadata: Record<string, unknown> | null;
    unit?: string | null;
}

export interface ProjectVirtualEntityInput {
    device: Pick<VirtualDeviceDto, 'externalId'>;
    binding: VirtualEntityBinding;
    available: boolean;
    componentId?: number;
}

export interface ProjectedVirtualEntity {
    id: string;
    name: string;
    type: string;
    source: string;
    properties: {
        id: number;
        roleKey: string;
        sourceDeviceExternalId: string;
        sourceComponentKey: string;
        available: boolean;
        writable: boolean;
        // Optional display affordances — cards render units, gauges, and
        // enum pills when these are present.
        unit?: string;
        min?: number;
        max?: number;
        step?: number;
        options?: Record<string, string>;
        objName?: string;
        sensorType?: string;
        type?: string;
    };
}

export function virtualEntityId(externalId: string, roleKey: string): string {
    return `${externalId}:role:${roleKey}:virtual`;
}

export function projectVirtualEntity(
    input: ProjectVirtualEntityInput
): ProjectedVirtualEntity {
    const {device, binding, available} = input;
    const display = displayHints(binding);
    return {
        id: virtualEntityId(device.externalId, binding.roleKey),
        name: virtualEntityName(binding),
        type: virtualEntityType(binding),
        source: device.externalId,
        properties: {
            id:
                input.componentId ??
                sourceComponentId(binding.sourceComponentKey),
            roleKey: binding.roleKey,
            sourceDeviceExternalId: binding.sourceExternalId,
            sourceComponentKey: binding.sourceComponentKey,
            available,
            writable: binding.writable === true && available,
            ...display
        }
    };
}

// Pull unit + min/max/step/options from the role's unit field or its
// metadata. The snapshot intentionally does NOT carry these — the snapshot
// is provenance, not config — so authors put display hints on the profile
// role's metadata block.
function displayHints(binding: VirtualEntityBinding): {
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: Record<string, string>;
    objName?: string;
    sensorType?: string;
    type?: string;
} {
    const out: ReturnType<typeof displayHints> = {};
    const unit =
        nonEmptyString(binding.unit) ??
        stringField(binding.roleMetadata, 'unit');
    if (unit) out.unit = unit;
    const min = numberField(binding.roleMetadata, 'min');
    if (min !== null) out.min = min;
    const max = numberField(binding.roleMetadata, 'max');
    if (max !== null) out.max = max;
    const step = numberField(binding.roleMetadata, 'step');
    if (step !== null) out.step = step;
    const options = optionsField(binding.roleMetadata, 'options');
    if (options) out.options = options;
    const objName = stringField(binding.roleMetadata, 'objName');
    if (objName) out.objName = objName;
    const sensorType = stringField(binding.roleMetadata, 'sensorType');
    if (sensorType) out.sensorType = sensorType;
    const inputType = stringField(binding.roleMetadata, 'inputType');
    if (inputType) out.type = inputType;
    return out;
}

function numberField(
    record: Record<string, unknown> | null,
    key: string
): number | null {
    const v = record?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function optionsField(
    record: Record<string, unknown> | null,
    key: string
): Record<string, string> | null {
    const v = record?.[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === 'string') out[k] = val;
    }
    return Object.keys(out).length > 0 ? out : null;
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

export function virtualEntityType(binding: VirtualEntityBinding): string {
    return (
        stringField(binding.roleMetadata, 'entityType') ??
        stringField(binding.roleMetadata, 'componentType') ??
        stringField(binding.sourceSnapshot, 'componentType') ??
        sourceComponentType(binding.sourceComponentKey)
    );
}

function virtualEntityName(binding: VirtualEntityBinding): string {
    return (
        stringField(binding.roleMetadata, 'displayName') ??
        stringField(binding.roleMetadata, 'label') ??
        stringField(binding.sourceSnapshot, 'label') ??
        humanizeRoleKey(binding.roleKey)
    );
}

function sourceComponentType(componentKey: string): string {
    return componentKey.split(':')[0] ?? 'component';
}

function sourceComponentId(componentKey: string): number {
    const raw = componentKey.split(':')[1] ?? '';
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : 0;
}

function stringField(
    record: Record<string, unknown> | null,
    key: string
): string | null {
    const value = record?.[key];
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function humanizeRoleKey(key: string): string {
    return key
        .split(/[_-]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
