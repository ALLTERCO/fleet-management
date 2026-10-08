/** The single framework-independent contract for deployment-owned values exposed to a template. */
export type OperationalBindings = Readonly<{
    energy?: Readonly<{
        tariffId?: number;
        exportTariffId?: number;
    }>;
    location?: Readonly<{id: number}>;
    device?: Readonly<{id: number}>;
    virtualDevice?: Readonly<{
        externalId: string;
        roleKey?: string;
    }>;
}>;

export const MAX_OPERATIONAL_INTEGER_ID = 2_147_483_647;
export const VIRTUAL_DEVICE_EXTERNAL_ID_PATTERN = '^vdev_[A-Za-z0-9_-]+$';
export const VIRTUAL_DEVICE_EXTERNAL_ID_MIN_LENGTH = 6;
export const VIRTUAL_DEVICE_EXTERNAL_ID_MAX_LENGTH = 50;
export const VIRTUAL_DEVICE_ROLE_KEY_PATTERN = '^[a-z][a-z0-9_]*$';
export const VIRTUAL_DEVICE_ROLE_KEY_MIN_LENGTH = 1;
export const VIRTUAL_DEVICE_ROLE_KEY_MAX_LENGTH = 80;

export const OPERATIONAL_BINDING_SPECS = Object.freeze({
    'energy.tariffId': Object.freeze({type: 'positive-integer'}),
    'energy.exportTariffId': Object.freeze({type: 'positive-integer'}),
    'location.id': Object.freeze({type: 'positive-integer'}),
    'device.id': Object.freeze({type: 'positive-integer'}),
    'virtualDevice.externalId': Object.freeze({
        type: 'virtual-device-external-id'
    }),
    'virtualDevice.roleKey': Object.freeze({type: 'virtual-device-role-key'})
} as const);

export type OperationalBindingKey = keyof typeof OPERATIONAL_BINDING_SPECS;
export type OperationalBindingDeclarationType =
    (typeof OPERATIONAL_BINDING_SPECS)[OperationalBindingKey]['type'];

export class OperationalBindingsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OperationalBindingsError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    prefix = ''
): void {
    const unknown = Object.keys(value).find((key) => !allowed.includes(key));
    if (unknown) {
        throw new OperationalBindingsError(
            `unknown operational binding: ${prefix}${unknown}`
        );
    }
}

function positiveInteger(value: unknown, path: string): number {
    if (
        !Number.isInteger(value) ||
        Number(value) < 1 ||
        Number(value) > MAX_OPERATIONAL_INTEGER_ID
    ) {
        throw new OperationalBindingsError(
            `operationalBindings.${path} must be an integer from 1 to ${MAX_OPERATIONAL_INTEGER_ID}`
        );
    }
    return Number(value);
}

function virtualExternalId(value: unknown): string {
    if (
        typeof value !== 'string' ||
        !new RegExp(VIRTUAL_DEVICE_EXTERNAL_ID_PATTERN).test(value) ||
        value.length < VIRTUAL_DEVICE_EXTERNAL_ID_MIN_LENGTH ||
        value.length > VIRTUAL_DEVICE_EXTERNAL_ID_MAX_LENGTH
    ) {
        throw new OperationalBindingsError(
            'operationalBindings.virtualDevice.externalId must be a valid custom-device external id'
        );
    }
    return value;
}

function virtualRoleKey(value: unknown): string {
    if (
        typeof value !== 'string' ||
        !new RegExp(VIRTUAL_DEVICE_ROLE_KEY_PATTERN).test(value) ||
        value.length < VIRTUAL_DEVICE_ROLE_KEY_MIN_LENGTH ||
        value.length > VIRTUAL_DEVICE_ROLE_KEY_MAX_LENGTH
    ) {
        throw new OperationalBindingsError(
            'operationalBindings.virtualDevice.roleKey must be a valid role key'
        );
    }
    return value;
}

function validateEnergyBinding(value: unknown): OperationalBindings['energy'] {
    if (!isRecord(value)) {
        throw new OperationalBindingsError(
            'operationalBindings.energy must be an object'
        );
    }
    rejectUnknownKeys(value, ['tariffId', 'exportTariffId'], 'energy.');
    const energy: {tariffId?: number; exportTariffId?: number} = {};
    for (const key of ['tariffId', 'exportTariffId'] as const) {
        if (value[key] !== undefined) {
            energy[key] = positiveInteger(value[key], `energy.${key}`);
        }
    }
    if (Object.keys(energy).length === 0) {
        throw new OperationalBindingsError(
            'operationalBindings.energy must contain tariffId or exportTariffId'
        );
    }
    return Object.freeze(energy);
}

function validateIdBinding(
    value: unknown,
    root: 'location' | 'device'
): Readonly<{id: number}> {
    if (!isRecord(value)) {
        throw new OperationalBindingsError(
            `operationalBindings.${root} must be an object`
        );
    }
    rejectUnknownKeys(value, ['id'], `${root}.`);
    return Object.freeze({id: positiveInteger(value.id, `${root}.id`)});
}

function validateVirtualDeviceBinding(
    value: unknown
): NonNullable<OperationalBindings['virtualDevice']> {
    if (!isRecord(value)) {
        throw new OperationalBindingsError(
            'operationalBindings.virtualDevice must be an object'
        );
    }
    rejectUnknownKeys(value, ['externalId', 'roleKey'], 'virtualDevice.');
    return Object.freeze({
        externalId: virtualExternalId(value.externalId),
        ...(value.roleKey === undefined
            ? {}
            : {roleKey: virtualRoleKey(value.roleKey)})
    });
}

export const EMPTY_OPERATIONAL_BINDINGS: OperationalBindings = Object.freeze(
    {}
);

export function validateOperationalBindings(
    value: unknown
): OperationalBindings {
    if (!isRecord(value)) {
        throw new OperationalBindingsError(
            'operational bindings must be an object'
        );
    }
    rejectUnknownKeys(value, ['energy', 'location', 'device', 'virtualDevice']);
    const result: {
        energy?: OperationalBindings['energy'];
        location?: OperationalBindings['location'];
        device?: OperationalBindings['device'];
        virtualDevice?: OperationalBindings['virtualDevice'];
    } = {};
    if (value.energy !== undefined) {
        result.energy = validateEnergyBinding(value.energy);
    }
    if (value.location !== undefined) {
        result.location = validateIdBinding(value.location, 'location');
    }
    if (value.device !== undefined) {
        result.device = validateIdBinding(value.device, 'device');
    }
    if (value.virtualDevice !== undefined) {
        result.virtualDevice = validateVirtualDeviceBinding(
            value.virtualDevice
        );
    }
    return Object.keys(result).length === 0
        ? EMPTY_OPERATIONAL_BINDINGS
        : Object.freeze(result);
}

export function listOperationalBindingKeys(
    bindings: OperationalBindings
): OperationalBindingKey[] {
    const keys: OperationalBindingKey[] = [];
    if (bindings.energy?.tariffId !== undefined) keys.push('energy.tariffId');
    if (bindings.energy?.exportTariffId !== undefined) {
        keys.push('energy.exportTariffId');
    }
    if (bindings.location) keys.push('location.id');
    if (bindings.device) keys.push('device.id');
    if (bindings.virtualDevice) keys.push('virtualDevice.externalId');
    if (bindings.virtualDevice?.roleKey) keys.push('virtualDevice.roleKey');
    return keys;
}
