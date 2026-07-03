// Ownership projection: `_attrs.owner` → parent+role on every entity.

import {getLogger} from 'log4js';
import {boundedLogDedupeSet} from '../../modules/boundedLogDedupeSet';
import type {DeviceInfo} from '../deviceInfo';

const logger = getLogger('composerOwnership');
const loggedOwnershipAnomalies = boundedLogDedupeSet();

// Real I/O included so PLC switches/inputs surface with parent+role too.
export const SERVICE_GROUPABLE_TYPES: readonly string[] = [
    'boolean',
    'number',
    'text',
    'enum',
    'button',
    'object',
    'switch',
    'input',
    'cover',
    'light',
    'cct',
    'rgb',
    'rgbw',
    'rgbcct',
    'em',
    'em1',
    'pm1',
    'voltmeter',
    'temperature',
    'humidity'
];

export interface OwnershipProjection {
    parent?: string;
    role?: string;
}

interface ProjectOwnershipInput {
    componentConfig: unknown;
    deviceShellyID: string;
}

export function projectOwnership(
    input: ProjectOwnershipInput
): OwnershipProjection {
    const attrs = readAttrs(input.componentConfig);
    if (!attrs) return {};
    const owner = parseOwnerKey(attrs.owner);
    if (!owner) return {};
    const out: OwnershipProjection = {
        parent: `${input.deviceShellyID}_${owner.id}:${owner.type}`
    };
    if (typeof attrs.role === 'string') out.role = attrs.role;
    return out;
}

interface PartitionInput {
    deviceStatus: Record<string, unknown>;
    deviceConfig: Record<string, unknown>;
    // Carried into warn-dedupe keys so per-device anomalies surface.
    deviceShellyID: string;
}

export interface ServiceGroup {
    serviceKey: string;
    components: Record<string, string>;
}

// One ServiceGroup per distinct service — multi-service XT1 devices stop
// collapsing into a single bag.
export function partitionServiceOwnedComponents(
    input: PartitionInput
): ServiceGroup[] {
    const groups = new Map<string, Record<string, string>>();
    for (const type of SERVICE_GROUPABLE_TYPES) {
        for (const key of instanceKeysOfType(type, input.deviceStatus)) {
            addServiceOwnedComponent({
                config: input.deviceConfig[key],
                componentKey: key,
                groups,
                deviceShellyID: input.deviceShellyID
            });
        }
    }
    return Array.from(groups, ([serviceKey, components]) => ({
        serviceKey,
        components
    }));
}

interface AddOwnedInput {
    config: unknown;
    componentKey: string;
    groups: Map<string, Record<string, string>>;
    deviceShellyID: string;
}

function addServiceOwnedComponent(input: AddOwnedInput): void {
    const attrs = readAttrs(input.config);
    const owner = parseOwnerKey(attrs?.owner);
    if (!owner || owner.type !== 'service') return;
    if (typeof attrs?.role !== 'string') {
        warnMissingRole(input);
        return;
    }
    const serviceKey = `service:${owner.id}`;
    const existing = input.groups.get(serviceKey) ?? {};
    if (existing[attrs.role]) {
        warnRoleCollision({
            input,
            serviceKey,
            role: attrs.role,
            previousKey: existing[attrs.role]
        });
    }
    existing[attrs.role] = input.componentKey;
    input.groups.set(serviceKey, existing);
}

function warnMissingRole(input: AddOwnedInput): void {
    const key = `missing-role|${input.deviceShellyID}|${input.componentKey}`;
    if (loggedOwnershipAnomalies.has(key)) return;
    loggedOwnershipAnomalies.record(key);
    logger.warn(
        'Service-owned component %s on %s has no _attrs.role — skipped',
        input.componentKey,
        input.deviceShellyID
    );
}

interface RoleCollisionInput {
    input: AddOwnedInput;
    serviceKey: string;
    role: string;
    previousKey: string;
}

function warnRoleCollision(c: RoleCollisionInput): void {
    const key = `collision|${c.input.deviceShellyID}|${c.serviceKey}|${c.role}`;
    if (loggedOwnershipAnomalies.has(key)) return;
    loggedOwnershipAnomalies.record(key);
    logger.warn(
        'Device %s service %s already owns role "%s" via %s; replacing with %s',
        c.input.deviceShellyID,
        c.serviceKey,
        c.role,
        c.previousKey,
        c.input.componentKey
    );
}

// Used to skip owned keys in the virtual-composer pass.
export function serviceOwnedKeys(groups: readonly ServiceGroup[]): Set<string> {
    const out = new Set<string>();
    for (const g of groups)
        for (const key of Object.values(g.components)) out.add(key);
    return out;
}

interface ParsedOwner {
    type: string;
    id: string;
}

function parseOwnerKey(raw: unknown): ParsedOwner | undefined {
    if (typeof raw !== 'string') return undefined;
    const colon = raw.indexOf(':');
    if (colon === -1) return undefined;
    return {type: raw.slice(0, colon), id: raw.slice(colon + 1)};
}

interface AttrsBag {
    owner?: unknown;
    role?: unknown;
}

function readAttrs(cfg: unknown): AttrsBag | undefined {
    if (!cfg || typeof cfg !== 'object') return undefined;
    const attrs = (cfg as {_attrs?: unknown})._attrs;
    if (!attrs || typeof attrs !== 'object') return undefined;
    return attrs as AttrsBag;
}

function instanceKeysOfType(
    type: string,
    status: Record<string, unknown>
): string[] {
    const out: string[] = [];
    const prefix = `${type}:`;
    for (const k in status) if (k.startsWith(prefix)) out.push(k);
    return out;
}

export function resolveServiceType(
    info: DeviceInfo,
    serviceIndex: string
): string {
    const jwtKey = `svc${serviceIndex}`;
    const fromJwt = info.jwt?.xt1?.[jwtKey]?.type;
    if (typeof fromJwt === 'string') return fromJwt;
    const claim = (info as unknown as Record<string, unknown>)[jwtKey];
    if (
        claim &&
        typeof claim === 'object' &&
        typeof (claim as {type?: unknown}).type === 'string'
    ) {
        return (claim as {type: string}).type;
    }
    return '';
}
