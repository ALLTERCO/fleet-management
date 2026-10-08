// Entities: the things on a device you can actually act on.
//
// A device carries an `entities` list, and until now that was all a template
// had — ids with nothing to do with them. This is the other half.
//
// `getActionSchema` before `invokeAction` on purpose. What an entity accepts
// differs by model and firmware, so a hardcoded payload works on the device
// in front of you and fails on the next one. Ask, then send.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type EntityMethod = Extract<HostMethod, `entity.${string}`>;

export type FleetEntitiesDomain = ReturnType<typeof createEntitiesDomain>;

export function createEntitiesDomain(access: FleetRpcAccess) {
    const entity = namespaceCaller<EntityMethod>(access);

    return {
        list: (params: HostParams<'entity.list'> = {}) =>
            entity('entity.list', params),
        get: (params: HostParams<'entity.get'>) => entity('entity.get', params),
        /** What this entity can do. Differs per model and firmware. */
        capabilities: (params: HostParams<'entity.getcapabilities'>) =>
            entity('entity.getcapabilities', params),
        /** The exact shape one action takes. Ask before building a payload. */
        actionSchema: (params: HostParams<'entity.getactionschema'>) =>
            entity('entity.getactionschema', params),
        /** Acts on real hardware. Validate against actionSchema first. */
        invokeAction: (params: HostParams<'entity.invokeaction'>) =>
            entity('entity.invokeaction', params)
    };
}
