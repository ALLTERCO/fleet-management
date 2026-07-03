/**
 * Pure handlers for the `Tariff.*` namespace.
 *
 * Extracted from TariffComponent so unit tests can exercise the logic
 * without importing the Component base class. The component methods
 * become one-line adapters.
 */

import {
    createRawIngressToken,
    hashIngressToken
} from '../../modules/deviceIngress/tokenHash.js';
import {isValidTimezone} from '../../modules/location/isoData.js';
import type {LiveTariffRepository} from '../../modules/repositories/LiveTariffRepository.js';
import type {TariffRepository} from '../../modules/repositories/TariffRepository.js';
import RpcError from '../../rpc/RpcError.js';
import {validateOrThrow} from '../../rpc/validateOrThrow.js';
import {
    TARIFF_ASSIGNMENT_SCHEMA,
    TARIFF_EMPTY_PARAMS_SCHEMA,
    TARIFF_SET_LIVE_SOURCE_SCHEMA,
    TARIFF_SPEC_SCHEMA,
    type TariffAssignmentSpec,
    type TariffSpec
} from '../../types/api/tariff.js';
import {assertTariffCoverage} from './tariffCoverage.js';

/**
 * Minimal sender contract — structural so tests can pass a plain object
 * without importing the full CommandSender class.
 */
export interface TariffSenderCapabilities {
    getOrganizationId(): string | undefined;
}

function requireOrg(sender: TariffSenderCapabilities): string {
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();
    return org;
}

// A tariff prices day/night and seasons in its own zone; an invalid zone would
// silently fall back to UTC and misprice. Reject it at write time.
function assertValidTimezone(spec: TariffSpec): void {
    if (!isValidTimezone(spec.timezone)) {
        throw RpcError.InvalidParams(
            `timezone '${spec.timezone}' is not a valid IANA zone`
        );
    }
}

export async function handleTariffList(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    validateOrThrow<Record<string, never>>(
        params ?? {},
        TARIFF_EMPTY_PARAMS_SCHEMA
    );
    const org = requireOrg(sender);
    return {items: await repo.list(org)};
}

export async function handleTariffGet(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{id: number}>(params, {
        type: 'object',
        required: ['id'],
        properties: {id: {type: 'integer', minimum: 1}}
    });
    const tariff = await repo.get(org, p.id);
    if (!tariff) throw RpcError.NotFound('tariff', p.id);
    return {tariff};
}

export async function handleTariffAdd(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const spec = validateOrThrow<TariffSpec>(params, TARIFF_SPEC_SCHEMA);
    assertValidTimezone(spec);
    assertTariffCoverage(spec);
    return {id: await repo.upsert(org, spec)};
}

export async function handleTariffUpdate(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{id: number} & TariffSpec>(params, {
        type: 'object',
        required: ['id', ...(TARIFF_SPEC_SCHEMA.required as string[])],
        properties: {
            id: {type: 'integer', minimum: 1},
            ...(TARIFF_SPEC_SCHEMA.properties as object)
        }
    });
    const {id, ...rest} = p;
    const spec: TariffSpec = {...rest, id};
    assertValidTimezone(spec);
    assertTariffCoverage(spec);
    return {id: await repo.upsert(org, spec)};
}

export async function handleTariffDelete(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{id: number}>(params, {
        type: 'object',
        required: ['id'],
        properties: {id: {type: 'integer', minimum: 1}}
    });
    return {deleted: await repo.delete(org, p.id)};
}

export async function handleTariffAssign(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<TariffAssignmentSpec & {delete?: boolean}>(
        params,
        {
            ...TARIFF_ASSIGNMENT_SCHEMA,
            properties: {
                ...TARIFF_ASSIGNMENT_SCHEMA.properties,
                delete: {type: 'boolean'}
            }
        }
    );
    const {delete: del = false, ...spec} = p;
    await repo.assign(org, spec, del);
    return {ok: true};
}

export async function handleTariffSetLiveSource(
    params: unknown,
    sender: TariffSenderCapabilities,
    repo: TariffRepository,
    liveRepo: LiveTariffRepository
) {
    const org = requireOrg(sender);
    const p = validateOrThrow<{
        tariffId: number;
        mode: 'push' | 'pull';
        provider?: string;
        providerConfig?: unknown;
    }>(params, TARIFF_SET_LIVE_SOURCE_SCHEMA);

    const tariff = await repo.get(org, p.tariffId);
    if (!tariff) throw RpcError.NotFound('tariff', p.tariffId);

    if (p.mode === 'push') {
        const {token} = createRawIngressToken();
        const hash = hashIngressToken(token);
        await liveRepo.upsertSource({
            tariffId: p.tariffId,
            mode: 'push',
            pushTokenHash: hash,
            provider: null,
            providerConfig: null
        });
        return {token, url: `/api/tariff/live/${token}`};
    }

    await liveRepo.upsertSource({
        tariffId: p.tariffId,
        mode: 'pull',
        provider: p.provider ?? null,
        providerConfig: p.providerConfig ?? null
    });
    return {ok: true};
}
